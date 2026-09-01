import uuid
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Bill, Account, Transaction
from app.schemas.schemas import BillCreate, BillUpdate, BillResponse, BillPayPayload, TransactionResponse

router = APIRouter(prefix="/bills", tags=["Bills"])

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

    # Mark bill paid
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
                    Transaction.user_id == current_user.id
                )
            )
        )
        race_tx = fallback_res.scalar_one_or_none()
        if race_tx:
            return race_tx
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This bill has already been paid.")
