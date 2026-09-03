import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Transaction, RecurringIncome, Account
from app.schemas.schemas import (
    TransactionCreate,
    TransactionResponse,
    RecurringIncomeCreate,
    RecurringIncomeUpdate,
    RecurringIncomeResponse,
    SalaryUsageResponse,
    DueIncomeResponse,
    ConfirmIncomePayload,
    SkipIncomePayload,
)
from app.services.recurring import due_occurrences, next_after

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
        # Remembered so the stream can be advanced without drifting; the client
        # need not send it.
        anchor_day=payload.anchor_day or payload.next_occurrence.day,
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
    if payload.anchor_day is not None:
        rec.anchor_day = payload.anchor_day

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


async def _load_rule(db: AsyncSession, user: User, id: uuid.UUID) -> RecurringIncome:
    stmt = select(RecurringIncome).where(
        and_(RecurringIncome.id == id, RecurringIncome.user_id == user.id)
    )
    rec = (await db.execute(stmt)).scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurring income source not found.")
    return rec


@router.get("/recurring/due", response_model=List[DueIncomeResponse])
async def list_due_income(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Streams whose date has come round without the money being recorded.

    A saved stream never posted anything by itself and nothing compared it to
    today, so a salary set up in January was silently still "due 1 February" in
    June. This is what the app asks about; the money is only recorded once the
    user confirms it arrived, because a salary can be late, short, or missed.
    """
    stmt = select(RecurringIncome).where(
        and_(RecurringIncome.user_id == current_user.id, RecurringIncome.active == True)
    )
    rules = (await db.execute(stmt)).scalars().all()

    out = []
    for r in rules:
        missed = due_occurrences(r.next_occurrence, r.frequency, r.anchor_day)
        if not missed:
            continue
        out.append(DueIncomeResponse(
            id=r.id,
            source=r.source,
            frequency=r.frequency,
            due_on=missed[0],
            expected_amount_minor=r.amount_minor,
            missed_count=len(missed),
        ))
    out.sort(key=lambda d: d.due_on)
    return out


@router.post("/recurring/{id}/confirm", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def confirm_due_income(
    id: uuid.UUID,
    payload: ConfirmIncomePayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Records one occurrence as received and moves the stream to its next date.

    Idempotent by construction: the mutation id is derived from the stream and
    the occurrence, so a double tap or a retried request returns the entry that
    already exists instead of paying the salary twice.
    """
    rec = await _load_rule(db, current_user, id)
    missed = due_occurrences(rec.next_occurrence, rec.frequency, rec.anchor_day)
    if not missed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing is due on this stream yet.")
    occurrence = missed[0]

    acct = (await db.execute(select(Account).where(
        and_(Account.id == payload.account_id, Account.user_id == current_user.id)
    ))).scalar_one_or_none()
    if not acct:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receiving account not found.")

    # Same stream + same occurrence must always produce the same id, so a retry
    # cannot create a second salary for one month.
    mutation_id = uuid.uuid5(uuid.NAMESPACE_URL, f"recurring:{rec.id}:{occurrence.isoformat()}")

    existing = (await db.execute(select(Transaction).where(
        and_(Transaction.user_id == current_user.id, Transaction.client_mutation_id == mutation_id)
    ))).scalar_one_or_none()
    if existing:
        # Already recorded; make sure the stream is not left pointing at it.
        if due_occurrences(rec.next_occurrence, rec.frequency, rec.anchor_day):
            rec.next_occurrence = next_after(occurrence, rec.frequency, rec.anchor_day)
            await db.commit()
        return existing

    amount = payload.amount_minor if payload.amount_minor is not None else rec.amount_minor
    if amount <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Amount must be > 0.")

    tx = Transaction(
        user_id=current_user.id,
        account_id=acct.id,
        category_id=payload.category_id,
        transaction_type="income",
        amount_minor=amount,
        currency=acct.currency or "INR",
        description=f"Salary Received: {rec.source}",
        transaction_date=payload.received_on or occurrence,
        client_mutation_id=mutation_id,
        device_id=payload.device_id or "recurring",
        sync_status="synced",
    )
    db.add(tx)

    # Advance one occurrence only. A stream that missed three months asks three
    # times, so each month is confirmed for the amount that actually arrived.
    rec.next_occurrence = next_after(occurrence, rec.frequency, rec.anchor_day)
    await db.commit()
    await db.refresh(tx)
    return tx


@router.post("/recurring/{id}/skip", response_model=RecurringIncomeResponse)
async def skip_due_income(
    id: uuid.UUID,
    payload: Optional[SkipIncomePayload] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Moves past due occurrences without recording them - the money never came.

    `all_missed` clears the whole backlog at once. Advancing a single month at
    a time left a stream months behind looking unchanged after each tap, since
    only the date and the "N months behind" line moved.
    """
    rec = await _load_rule(db, current_user, id)
    missed = due_occurrences(rec.next_occurrence, rec.frequency, rec.anchor_day)
    if not missed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing is due on this stream yet.")

    last = missed[-1] if (payload and payload.all_missed) else missed[0]
    rec.next_occurrence = next_after(last, rec.frequency, rec.anchor_day)
    await db.commit()
    await db.refresh(rec)
    return rec


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
