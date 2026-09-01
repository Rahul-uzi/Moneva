import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Notification, Bill, Budget, SavingsGoal, RecurringIncome
from app.schemas.schemas import (
    NotificationResponse,
    NotificationPreferencesUpdate,
    NotificationPreferencesResponse
)
from app.services.finance import calculate_budget_spending, calculate_savings_goal_progress

router = APIRouter(prefix="/notifications", tags=["Notifications"])

@router.get("", response_model=List[NotificationResponse])
async def list_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists notifications for current user ordered by creation timestamp."""
    stmt = select(Notification).where(Notification.user_id == current_user.id).order_by(Notification.created_at.desc())
    res = await db.execute(stmt)
    return res.scalars().all()


@router.get("/unread-count")
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns number of unread notifications for current user."""
    stmt = select(func.count()).select_from(Notification).where(
        and_(Notification.user_id == current_user.id, Notification.is_read == False)
    )
    res = await db.execute(stmt)
    count = res.scalar() or 0
    return {"unread_count": count}


@router.get("/preferences", response_model=NotificationPreferencesResponse)
async def get_preferences(current_user: User = Depends(get_current_user)):
    """Returns user notification preference settings."""
    return NotificationPreferencesResponse(
        notif_bills=current_user.notif_bills,
        notif_budgets=current_user.notif_budgets,
        notif_goals=current_user.notif_goals,
        notif_salary=current_user.notif_salary
    )


@router.patch("/preferences", response_model=NotificationPreferencesResponse)
async def update_preferences(
    payload: NotificationPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates user notification preference settings."""
    if payload.notif_bills is not None:
        current_user.notif_bills = payload.notif_bills
    if payload.notif_budgets is not None:
        current_user.notif_budgets = payload.notif_budgets
    if payload.notif_goals is not None:
        current_user.notif_goals = payload.notif_goals
    if payload.notif_salary is not None:
        current_user.notif_salary = payload.notif_salary

    await db.commit()
    await db.refresh(current_user)
    return NotificationPreferencesResponse(
        notif_bills=current_user.notif_bills,
        notif_budgets=current_user.notif_budgets,
        notif_goals=current_user.notif_goals,
        notif_salary=current_user.notif_salary
    )


@router.patch("/{id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Marks a single notification as read."""
    stmt = select(Notification).where(and_(Notification.id == id, Notification.user_id == current_user.id))
    res = await db.execute(stmt)
    notif = res.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")

    notif.is_read = True
    await db.commit()
    await db.refresh(notif)
    return notif


@router.post("/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Marks all user notifications as read."""
    stmt = update(Notification).where(Notification.user_id == current_user.id).values(is_read=True)
    await db.execute(stmt)
    await db.commit()
    return {"message": "All notifications marked as read."}


@router.post("/generate")
async def generate_reminders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Evaluates bill, budget, goal, and salary rules based on user preferences
    and inserts non-duplicate notification reminders without altering financial ledgers.
    """
    now = datetime.now(timezone.utc)
    month_key = now.strftime("%Y-%m")
    created_count = 0

    # 1. BILL REMINDERS
    if current_user.notif_bills:
        bill_stmt = select(Bill).where(and_(Bill.user_id == current_user.id, Bill.status != "paid"))
        bills = (await db.execute(bill_stmt)).scalars().all()
        for b in bills:
            due_dt = b.due_date.replace(tzinfo=timezone.utc) if b.due_date.tzinfo is None else b.due_date
            days_diff = (due_dt.date() - now.date()).days
            due_str = due_dt.strftime("%Y-%m-%d")

            if days_diff < 0:
                # Overdue
                dedup = f"{current_user.id}_bill_{b.id}_overdue_{due_str}"
                title = f"Bill Overdue: {b.name}"
                msg = f"Your bill '{b.name}' for ₹{b.amount_minor / 100:,.2f} was due on {due_str}."
                ntype = "bill_overdue"
            elif days_diff <= 5:
                # Due soon / today
                dedup = f"{current_user.id}_bill_{b.id}_due_{due_str}"
                title = f"Upcoming Bill Due: {b.name}"
                msg = f"Your bill '{b.name}' for ₹{b.amount_minor / 100:,.2f} is due in {days_diff} days."
                ntype = "bill_reminder"
            else:
                continue

            # Check if notification exists with dedup_key
            existing = await db.execute(select(Notification).where(Notification.dedup_key == dedup))
            if not existing.scalar_one_or_none():
                notif = Notification(
                    user_id=current_user.id,
                    title=title,
                    message=msg,
                    notification_type=ntype,
                    dedup_key=dedup
                )
                db.add(notif)
                created_count += 1

    # 2. BUDGET WARNINGS
    if current_user.notif_budgets:
        bud_stmt = select(Budget).where(Budget.user_id == current_user.id)
        budgets = (await db.execute(bud_stmt)).scalars().all()
        for b in budgets:
            spent = await calculate_budget_spending(db, current_user.id, b.category_id, b.start_date, b.end_date)
            pct = (spent / b.limit_amount_minor * 100.0) if b.limit_amount_minor > 0 else 0.0

            if pct >= 80.0:
                is_exceeded = pct >= 100.0
                ntype = "budget_exceeded" if is_exceeded else "budget_warning"
                dedup = f"{current_user.id}_budget_{b.id}_{ntype}_{month_key}"
                title = f"Budget Over-Limit Alert" if is_exceeded else "Budget Warning (80% Limit)"
                msg = f"Category budget limit reaches {pct:.1f}% utilization (Spent ₹{spent / 100:,.2f} of ₹{b.limit_amount_minor / 100:,.2f})."

                existing = await db.execute(select(Notification).where(Notification.dedup_key == dedup))
                if not existing.scalar_one_or_none():
                    notif = Notification(
                        user_id=current_user.id,
                        title=title,
                        message=msg,
                        notification_type=ntype,
                        dedup_key=dedup
                    )
                    db.add(notif)
                    created_count += 1

    # 3. GOAL MILESTONES
    if current_user.notif_goals:
        goal_stmt = select(SavingsGoal).where(SavingsGoal.user_id == current_user.id)
        goals = (await db.execute(goal_stmt)).scalars().all()
        for g in goals:
            prog = await calculate_savings_goal_progress(db, g.id)
            pct = prog["progress_percentage"]

            milestones = []
            if pct >= 100.0:
                milestones.append(100)
            elif pct >= 50.0:
                milestones.append(50)

            for m in milestones:
                dedup = f"{current_user.id}_goal_{g.id}_{m}pct"
                title = f"Goal Milestone Reached ({m}%)"
                msg = f"Savings goal '{g.name}' reached {m}% completion! (Saved ₹{prog['current_saved_minor'] / 100:,.2f})."

                existing = await db.execute(select(Notification).where(Notification.dedup_key == dedup))
                if not existing.scalar_one_or_none():
                    notif = Notification(
                        user_id=current_user.id,
                        title=title,
                        message=msg,
                        notification_type="goal_milestone",
                        dedup_key=dedup
                    )
                    db.add(notif)
                    created_count += 1

    # 4. SALARY REMINDERS
    if current_user.notif_salary:
        inc_stmt = select(RecurringIncome).where(and_(RecurringIncome.user_id == current_user.id, RecurringIncome.active == True))
        incomes = (await db.execute(inc_stmt)).scalars().all()
        for inc in incomes:
            dedup = f"{current_user.id}_salary_{inc.id}_{month_key}"
            title = f"Salary Payday Reminder: {inc.source}"
            msg = f"Expected salary deposit '{inc.source}' for ₹{inc.amount_minor / 100:,.2f} scheduled for this period."

            existing = await db.execute(select(Notification).where(Notification.dedup_key == dedup))
            if not existing.scalar_one_or_none():
                notif = Notification(
                    user_id=current_user.id,
                    title=title,
                    message=msg,
                    notification_type="salary_reminder",
                    dedup_key=dedup
                )
                db.add(notif)
                created_count += 1

    await db.commit()
    return {"generated_count": created_count, "message": f"Generated {created_count} new reminder notifications."}
