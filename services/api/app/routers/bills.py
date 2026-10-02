import uuid
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Bill, Account, Transaction
from app.schemas.schemas import BillCreate, BillUpdate, BillResponse, BillPayPayload, TransactionResponse
from app.services.recurring import _as_utc, next_after

router = APIRouter(prefix="/bills", tags=["Bills"])

#: Recurrences that produce another bill after this one is settled.
#:
#: "one-time" and an empty recurrence are the opposite case and must stay the
#: opposite case: those really are finished when paid, and rolling them forward
#: would resurrect a bill the user settled for good.
RECURRING_BILL_PERIODS = frozenset(
    {"daily", "weekly", "fortnightly", "biweekly", "monthly", "quarterly", "yearly", "annually"}
)

@router.get("", response_model=List[BillResponse])
async def list_bills(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists bills for current user."""
    stmt = select(Bill).where(Bill.user_id == current_user.id)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("", response_model=BillResponse, status_code=status.HTTP_201_CREATED)
async def create_bill(
    payload: BillCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a bill record. Creating a bill does NOT alter any account balance."""
    if payload.amount_minor <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="amount_minor must be > 0.")

    b = Bill(
        user_id=current_user.id,
        name=payload.name.strip(),
        amount_minor=payload.amount_minor,
        currency=payload.currency or current_user.currency,
        due_date=payload.due_date,
        # The day the user meant, kept so a 31st bill survives February.
        anchor_day=payload.due_date.day,
        recurrence=payload.recurrence,
        category_id=payload.category_id,
        status=payload.status or "upcoming",
        reminder_enabled=payload.reminder_enabled if payload.reminder_enabled is not None else True
    )
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return b


@router.get("/{bill_id}", response_model=BillResponse)
async def get_bill(
    bill_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves a single bill."""
    stmt = select(Bill).where(and_(Bill.id == bill_id, Bill.user_id == current_user.id))
    res = await db.execute(stmt)
    b = res.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found.")
    return b


@router.patch("/{bill_id}", response_model=BillResponse)
async def update_bill(
    bill_id: uuid.UUID,
    payload: BillUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates bill metadata."""
    stmt = select(Bill).where(and_(Bill.id == bill_id, Bill.user_id == current_user.id))
    res = await db.execute(stmt)
    b = res.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found.")

    if payload.name is not None:
        b.name = payload.name.strip()
    if payload.amount_minor is not None:
        if payload.amount_minor <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Amount must be > 0.")
        b.amount_minor = payload.amount_minor
    if payload.due_date is not None:
        b.due_date = payload.due_date
        # Moving the due date re-states which day of the month is meant, so
        # the anchor follows it. Without this, editing a 15th bill to the 31st
        # would advance it on the 15th forever.
        b.anchor_day = payload.due_date.day
    if payload.recurrence is not None:
        b.recurrence = payload.recurrence
    if payload.category_id is not None:
        b.category_id = payload.category_id
    if payload.status is not None:
        b.status = payload.status
    if payload.reminder_enabled is not None:
        b.reminder_enabled = payload.reminder_enabled

    await db.commit()
    await db.refresh(b)
    return b


@router.delete("/{bill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bill(
    bill_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Deletes a bill."""
    stmt = select(Bill).where(and_(Bill.id == bill_id, Bill.user_id == current_user.id))
    res = await db.execute(stmt)
    b = res.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found.")

    await db.delete(b)
    await db.commit()
    return None


@router.post("/{bill_id}/pay", response_model=TransactionResponse)
async def pay_bill(
    bill_id: uuid.UUID,
    payload: BillPayPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Marks a bill as paid and creates the corresponding expense Transaction event
    in an atomic database transaction.
    """
    # Read once, up front. A rollback expires every ORM object in the session,
    # so reading current_user.id AFTER one triggers a lazy reload - which is a
    # blocking database call on an async session, and raises MissingGreenlet
    # instead of recovering. The recovery path below is exactly where that
    # happens, so it must not touch the User object at all.
    user_id = current_user.id

    # 1. User-scoped Idempotency Check
    existing_stmt = select(Transaction).where(
        and_(
            Transaction.client_mutation_id == payload.client_mutation_id,
            Transaction.user_id == current_user.id
        )
    )
    existing_res = await db.execute(existing_stmt)
    existing_tx = existing_res.scalar_one_or_none()
    if existing_tx:
        return existing_tx

    # 2. Acquire lock on Bill for concurrency protection
    stmt = select(Bill).where(and_(Bill.id == bill_id, Bill.user_id == current_user.id)).with_for_update()
    res = await db.execute(stmt)
    b = res.scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bill not found.")

    if b.status == "paid":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This bill has already been paid.")

    # Validate payment account
    acc_stmt = select(Account).where(and_(Account.id == payload.account_id, Account.user_id == current_user.id))
    acc_res = await db.execute(acc_stmt)
    account = acc_res.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment account not found.")

    # Settle it - and, if it repeats, line up the next one.
    #
    # `recurrence` was stored and shown and nothing ever acted on it: paying a
    # monthly bill set it to "paid" and left the due date where it was, so the
    # bill never came back. A Spotify autopay on the 3rd showed "Monthly",
    # settled once, and then sat Paid for the next ten years while the money
    # kept leaving the account every month.
    #
    # The next date is anchored to the DUE date, not to when it was paid: a
    # subscription that bills on the 3rd still bills on the 3rd when February
    # is paid late on the 9th. `next_after` carries the anchor day through
    # short months, so the 31st survives February instead of sticking at 28.
    paid_at = payload.payment_date or datetime.now(timezone.utc)
    if (b.recurrence or "").strip().lower() in RECURRING_BILL_PERIODS:
        anchor_day = b.anchor_day or b.due_date.day
        nxt = _as_utc(b.due_date)
        # Several periods can have gone by on a bill nobody settled. Walk
        # forward to the first one still ahead of this payment rather than
        # landing on another date already in the past.
        while nxt <= _as_utc(paid_at):
            nxt = next_after(nxt, b.recurrence, anchor_day)
        b.due_date = nxt
        b.status = "upcoming"
    else:
        b.status = "paid"

    # Create expense transaction
    tx_payment = Transaction(
        client_mutation_id=payload.client_mutation_id,
        user_id=current_user.id,
        account_id=payload.account_id,
        category_id=b.category_id,
        transaction_type="expense",
        amount_minor=b.amount_minor,
        currency=b.currency,
        description=f"Paid Bill: {b.name}",
        transaction_date=payload.payment_date or datetime.now(timezone.utc),
        device_id=payload.device_id,
        sync_status="synced"
    )
    db.add(tx_payment)

    try:
        await db.commit()
        await db.refresh(tx_payment)
        return tx_payment
    except IntegrityError:
        await db.rollback()
        # Fallback check for concurrent completion
        fallback_res = await db.execute(
            select(Transaction).where(
                and_(
                    Transaction.client_mutation_id == payload.client_mutation_id,
                    Transaction.user_id == user_id
                )
            )
        )
        race_tx = fallback_res.scalar_one_or_none()
        if race_tx:
            return race_tx
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This bill has already been paid.")
