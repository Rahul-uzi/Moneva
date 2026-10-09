import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Tuple
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Budget, Category
from app.schemas.schemas import (
    BudgetCreate,
    BudgetUpdate,
    BudgetResponse,
    BudgetPlanApply,
    BudgetPlanResult,
)
from app.services.finance import calculate_budget_spending

router = APIRouter(prefix="/budgets", tags=["Budgets"])

@router.get("", response_model=List[BudgetResponse])
async def list_budgets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists budgets for the current user with dynamically computed spending and remaining limits."""
    # Joined so each budget carries the category it caps; the UI had no name to
    # show and rendered the placeholder "Category" on every card.
    stmt = (
        select(Budget, Category.name)
        .join(Category, Category.id == Budget.category_id, isouter=True)
        .where(Budget.user_id == current_user.id)
    )
    rows = (await db.execute(stmt)).all()

    result = []
    for b, category_name in rows:
        spent = await calculate_budget_spending(db, current_user.id, b.category_id, b.start_date, b.end_date)
        resp = BudgetResponse.model_validate(b)
        resp.category_name = category_name
        resp.spent_amount_minor = spent
        resp.remaining_amount_minor = b.limit_amount_minor - spent
        result.append(resp)

    return result


@router.post("", response_model=BudgetResponse, status_code=status.HTTP_201_CREATED)
async def create_budget(
    payload: BudgetCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a new category budget."""
    if payload.limit_amount_minor <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Budget limit_amount_minor must be > 0.")

    # Validate category exists and belongs to user or is system default
    cat_stmt = select(Category).where(
        and_(
            Category.id == payload.category_id,
            or_(Category.user_id == current_user.id, Category.user_id == None)
        )
    )
    cat_res = await db.execute(cat_stmt)
    if not cat_res.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found or access denied.")

    b = Budget(
        user_id=current_user.id,
        category_id=payload.category_id,
        limit_amount_minor=payload.limit_amount_minor,
        period=payload.period or "monthly",
        start_date=payload.start_date,
        end_date=payload.end_date
    )
    db.add(b)
    await db.commit()
    await db.refresh(b)

    spent = await calculate_budget_spending(db, current_user.id, b.category_id, b.start_date, b.end_date)
    resp = BudgetResponse.model_validate(b)
    resp.spent_amount_minor = spent
    resp.remaining_amount_minor = b.limit_amount_minor - spent
    return resp


def _current_month(tz_name: str, now: datetime | None = None) -> Tuple[datetime, datetime]:
    """This calendar month in the USER's timezone, as UTC instants.

    "This month" for someone in India starts at midnight in India, not in
    London. Computing it in UTC puts the first five and a half hours of the 1st
    in last month's budget. An unknown or unloadable zone falls back to UTC
    rather than failing the save.
    """
    try:
        zone = ZoneInfo(tz_name or "UTC")
    except Exception:
        zone = timezone.utc
    local_now = (now or datetime.now(timezone.utc)).astimezone(zone)
    start = local_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    nxt = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    end = nxt - timedelta(microseconds=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


@router.post("/plan", response_model=BudgetPlanResult)
async def apply_budget_plan(
    payload: BudgetPlanApply,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Saves a spending plan as this month's category budgets.

    UPDATES RATHER THAN DUPLICATES. Creating a budget never checked whether
    that category already had one this month, so saying yes to a plan twice -
    or to a plan for a category already budgeted - left two budgets for the
    same money, each counting the same spending. A category that already has a
    budget overlapping this month keeps that budget, with its dates, and only
    its limit changes.

    ALL OR NOTHING. Every category is checked before anything is written; one
    that is not the user's, or is an income category, refuses the whole plan.
    """
    ids = [item.category_id for item in payload.items]
    if len(set(ids)) != len(ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Each category can appear only once in a plan.",
        )

    cat_res = await db.execute(select(Category).where(and_(
        Category.id.in_(ids),
        or_(Category.user_id == current_user.id, Category.user_id == None),  # noqa: E711
    )))
    categories = {c.id: c for c in cat_res.scalars().all()}
    if len(categories) != len(ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="A category in this plan was not found.",
        )
    if any((c.type or "").lower() != "expense" for c in categories.values()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A plan can only budget spending categories.",
        )

    start, end = _current_month(current_user.timezone)

    existing_res = await db.execute(
        select(Budget)
        .where(and_(
            Budget.user_id == current_user.id,
            Budget.category_id.in_(ids),
            Budget.start_date <= end,
            Budget.end_date >= start,
        ))
        .order_by(Budget.start_date.desc())
    )
    existing: dict = {}
    for b in existing_res.scalars().all():
        # Newest first, so if a category somehow has two overlapping budgets
        # already, the plan lands on the most recent one.
        existing.setdefault(b.category_id, b)

    created = updated = 0
    touched: List[Budget] = []
    for item in payload.items:
        b = existing.get(item.category_id)
        if b is not None:
            b.limit_amount_minor = item.limit_amount_minor
            updated += 1
        else:
            b = Budget(
                user_id=current_user.id,
                category_id=item.category_id,
                limit_amount_minor=item.limit_amount_minor,
                period="monthly",
                start_date=start,
                end_date=end,
            )
            db.add(b)
            created += 1
        touched.append(b)

    await db.commit()

    out: List[BudgetResponse] = []
    for b in touched:
        await db.refresh(b)
        spent = await calculate_budget_spending(db, current_user.id, b.category_id, b.start_date, b.end_date)
        resp = BudgetResponse.model_validate(b)
        resp.category_name = categories[b.category_id].name
        resp.spent_amount_minor = spent
        resp.remaining_amount_minor = b.limit_amount_minor - spent
        out.append(resp)

    return BudgetPlanResult(created=created, updated=updated, budgets=out)


@router.get("/{budget_id}", response_model=BudgetResponse)
async def get_budget(
    budget_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves a single budget by ID."""
    stmt = select(Budget).where(and_(Budget.id == budget_id, Budget.user_id == current_user.id))
    res = await db.execute(stmt)
    b = res.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")

    spent = await calculate_budget_spending(db, current_user.id, b.category_id, b.start_date, b.end_date)
    resp = BudgetResponse.model_validate(b)
    resp.spent_amount_minor = spent
    resp.remaining_amount_minor = b.limit_amount_minor - spent
    return resp


@router.patch("/{budget_id}", response_model=BudgetResponse)
async def update_budget(
    budget_id: uuid.UUID,
    payload: BudgetUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates budget properties."""
    stmt = select(Budget).where(and_(Budget.id == budget_id, Budget.user_id == current_user.id))
    res = await db.execute(stmt)
    b = res.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")

    if payload.limit_amount_minor is not None:
        if payload.limit_amount_minor <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Limit must be > 0.")
        b.limit_amount_minor = payload.limit_amount_minor
    if payload.period is not None:
        b.period = payload.period
    if payload.start_date is not None:
        b.start_date = payload.start_date
    if payload.end_date is not None:
        b.end_date = payload.end_date

    await db.commit()
    await db.refresh(b)

    spent = await calculate_budget_spending(db, current_user.id, b.category_id, b.start_date, b.end_date)
    resp = BudgetResponse.model_validate(b)
    resp.spent_amount_minor = spent
    resp.remaining_amount_minor = b.limit_amount_minor - spent
    return resp


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(
    budget_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Deletes a budget."""
    stmt = select(Budget).where(and_(Budget.id == budget_id, Budget.user_id == current_user.id))
    res = await db.execute(stmt)
    b = res.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")

    await db.delete(b)
    await db.commit()
    return None
