import uuid
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Transaction, RecurringIncome
from app.schemas.schemas import (
    TransactionCreate,
    TransactionResponse,
    RecurringIncomeCreate,
    RecurringIncomeUpdate,
    RecurringIncomeResponse,
    SalaryUsageResponse,
)

router = APIRouter(prefix="/income", tags=["Income"])

# --- INCOMES (Income Transactions) ---
@router.get("", response_model=List[TransactionResponse])
async def list_incomes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists all income transactions for current user."""
    stmt = select(Transaction).where(
        and_(Transaction.user_id == current_user.id, Transaction.transaction_type == "income")
    )
    res = await db.execute(stmt)
    return res.scalars().all()


@router.get("/recurring", response_model=List[RecurringIncomeResponse])
async def list_recurring_income(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists recurring income/salary streams for current user."""
    stmt = select(RecurringIncome).where(RecurringIncome.user_id == current_user.id)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/recurring", response_model=RecurringIncomeResponse, status_code=status.HTTP_201_CREATED)
async def create_recurring_income(
    payload: RecurringIncomeCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a recurring income source (e.g. Salary, Freelance retainer)."""
    if payload.amount_minor <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Amount must be > 0.")

    rec = RecurringIncome(
        user_id=current_user.id,
        source=payload.source.strip(),
        amount_minor=payload.amount_minor,
        frequency=payload.frequency,
        next_occurrence=payload.next_occurrence,
        active=payload.active if payload.active is not None else True
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return rec


@router.patch("/recurring/{id}", response_model=RecurringIncomeResponse)
async def update_recurring_income(
    id: uuid.UUID,
    payload: RecurringIncomeUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates a recurring income stream."""
    stmt = select(RecurringIncome).where(and_(RecurringIncome.id == id, RecurringIncome.user_id == current_user.id))
    res = await db.execute(stmt)
    rec = res.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurring income source not found.")

    if payload.source is not None:
        rec.source = payload.source.strip()
    if payload.amount_minor is not None:
        if payload.amount_minor <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Amount must be > 0.")
        rec.amount_minor = payload.amount_minor
    if payload.frequency is not None:
        rec.frequency = payload.frequency
    if payload.next_occurrence is not None:
        rec.next_occurrence = payload.next_occurrence
    if payload.active is not None:
        rec.active = payload.active

    await db.commit()
    await db.refresh(rec)
    return rec


@router.delete("/recurring/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recurring_income(
    id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Deletes a recurring income stream."""
    stmt = select(RecurringIncome).where(and_(RecurringIncome.id == id, RecurringIncome.user_id == current_user.id))
    res = await db.execute(stmt)
    rec = res.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurring income source not found.")

    await db.delete(rec)
    await db.commit()
    return None


@router.get("/salary-usage", response_model=SalaryUsageResponse)
async def salary_usage(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    This month's income against this month's spending.

    "Remaining" is total income received this calendar month minus every
    expense recorded in it. Transfers are excluded on both sides: moving money
    between your own accounts is not income and not spending.
    """
    now = datetime.now(timezone.utc)
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    period_end = (
        period_start.replace(year=period_start.year + 1, month=1)
        if period_start.month == 12
        else period_start.replace(month=period_start.month + 1)
    )

    in_period = and_(
        Transaction.user_id == current_user.id,
        Transaction.transaction_date >= period_start,
        Transaction.transaction_date < period_end,
    )

    async def total(*extra):
        stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(and_(in_period, *extra))
        return int((await db.execute(stmt)).scalar_one() or 0)

    # Recurring-income sources are what the user set up as salary.
    rules = (await db.execute(
        select(RecurringIncome).where(RecurringIncome.user_id == current_user.id)
    )).scalars().all()
    salary_sources = {r.source.strip().lower() for r in rules if r.source}

    income_rows = (await db.execute(
        select(Transaction).where(and_(in_period, Transaction.transaction_type == "income"))
    )).scalars().all()

    salary_received = 0
    other_income = 0
    for t in income_rows:
        desc = (t.description or "").strip().lower()
        is_salary = any(src and src in desc for src in salary_sources) or "salary" in desc
        if is_salary:
            salary_received += t.amount_minor
        else:
            other_income += t.amount_minor

    spent = await total(Transaction.transaction_type == "expense")
    total_income = salary_received + other_income
    remaining = total_income - spent
    used_percent = round((spent / total_income) * 100, 1) if total_income > 0 else 0.0

    return SalaryUsageResponse(
        period_start=period_start,
        period_end=period_end,
        salary_received_minor=salary_received,
        other_income_minor=other_income,
        total_income_minor=total_income,
        spent_minor=spent,
        remaining_minor=remaining,
        used_percent=used_percent,
        has_salary_configured=bool(rules),
    )
