import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from sqlalchemy import select, and_, or_, desc
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Account, Category, Transaction, SavingsGoal
from app.schemas.schemas import TransactionCreate, TransactionUpdate, TransactionResponse

router = APIRouter(prefix="/transactions", tags=["Transactions"])

@router.get("", response_model=List[TransactionResponse])
async def list_transactions(
    account_id: Optional[uuid.UUID] = Query(None),
    category_id: Optional[uuid.UUID] = Query(None),
    transaction_type: Optional[str] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    # The dashboard needs the five most recent rows. Without a limit it had to
    # download every transaction the user has ever recorded to show them.
    limit: Optional[int] = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists transactions for current user with optional filtering by account, category, date, or type."""
    filters = [Transaction.user_id == current_user.id]
    if account_id:
        filters.append(Transaction.account_id == account_id)
    if category_id:
        filters.append(Transaction.category_id == category_id)
    if transaction_type:
        filters.append(Transaction.transaction_type == transaction_type.lower())
    if start_date:
        filters.append(Transaction.transaction_date >= start_date)
    if end_date:
        filters.append(Transaction.transaction_date <= end_date)

    stmt = select(Transaction).where(and_(*filters)).order_by(
        desc(Transaction.transaction_date), desc(Transaction.id)
    )
    if offset:
        stmt = stmt.offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates a new transaction idempotently.
    Repeated requests with the same client_mutation_id return the existing record cleanly.
    """
    # 1. Idempotency Check
    existing_stmt = select(Transaction).where(Transaction.client_mutation_id == payload.client_mutation_id)
    existing_res = await db.execute(existing_stmt)
    existing_tx = existing_res.scalar_one_or_none()
    if existing_tx:
        if existing_tx.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to mutation record.")
        response.status_code = status.HTTP_200_OK
        return existing_tx

    # 2. Validation
    if payload.amount_minor <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transaction amount_minor must be greater than zero."
        )

    if payload.transaction_type.lower() not in ["income", "expense", "transfer"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="transaction_type must be 'income', 'expense', or 'transfer'."
        )

    # Account ownership check
    acc_stmt = select(Account).where(and_(Account.id == payload.account_id, Account.user_id == current_user.id))
    acc_res = await db.execute(acc_stmt)
    account = acc_res.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found or access denied.")

    # Transfer target account / savings goal validation
    if payload.transaction_type.lower() == "transfer":
        if not payload.to_account_id and not payload.savings_goal_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transfers require either a to_account_id or a savings_goal_id."
            )
        if payload.to_account_id:
            if payload.account_id == payload.to_account_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Source and target transfer accounts cannot be the same."
                )
            to_acc_stmt = select(Account).where(and_(Account.id == payload.to_account_id, Account.user_id == current_user.id))
            to_acc_res = await db.execute(to_acc_stmt)
            if not to_acc_res.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Target transfer account not found or access denied."
                )

    # Category validation
    if payload.category_id:
        cat_stmt = select(Category).where(
            and_(
                Category.id == payload.category_id,
                or_(Category.user_id == current_user.id, Category.user_id == None)
            )
        )
        cat_res = await db.execute(cat_stmt)
        if not cat_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found or access denied.")

    # Savings goal validation
    if payload.savings_goal_id:
        goal_stmt = select(SavingsGoal).where(and_(SavingsGoal.id == payload.savings_goal_id, SavingsGoal.user_id == current_user.id))
        goal_res = await db.execute(goal_stmt)
        if not goal_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Savings goal not found or access denied.")

    # 3. Create Transaction record
    tx = Transaction(
        client_mutation_id=payload.client_mutation_id,
        user_id=current_user.id,
        account_id=payload.account_id,
        to_account_id=payload.to_account_id if payload.transaction_type.lower() == "transfer" else None,
        category_id=payload.category_id,
        savings_goal_id=payload.savings_goal_id,
        transaction_type=payload.transaction_type.lower(),
        amount_minor=payload.amount_minor,
        currency=payload.currency or current_user.currency,
        description=payload.description,
        transaction_date=payload.transaction_date,
        device_id=payload.device_id,
        sync_status=payload.sync_status or "synced"
    )
    db.add(tx)

    try:
        await db.commit()
        await db.refresh(tx)
        return tx
    except IntegrityError:
        await db.rollback()
        # Fallback concurrency race check
        fallback_res = await db.execute(
            select(Transaction).where(
                and_(
                    Transaction.client_mutation_id == payload.client_mutation_id,
                    Transaction.user_id == current_user.id
                )
            )
        )
        existing_race_tx = fallback_res.scalar_one_or_none()
        if existing_race_tx:
            return existing_race_tx
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Transaction mutation conflict.")


@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves a single transaction by ID."""
    stmt = select(Transaction).where(and_(Transaction.id == transaction_id, Transaction.user_id == current_user.id))
    res = await db.execute(stmt)
    tx = res.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found.")
    return tx


@router.patch("/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: uuid.UUID,
    payload: TransactionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates non-mutation fields of a transaction with ownership and concurrency validation."""
    stmt = select(Transaction).where(and_(Transaction.id == transaction_id, Transaction.user_id == current_user.id))
    res = await db.execute(stmt)
    tx = res.scalar_one_or_none()

    if not tx:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found.")

    if payload.expected_version is not None and tx.version != payload.expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Transaction update conflict: version mismatch."
        )

    if payload.amount_minor is not None:
        if payload.amount_minor <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Amount must be greater than zero.")
        tx.amount_minor = payload.amount_minor
    if payload.description is not None:
        tx.description = payload.description
    if payload.transaction_date is not None:
        tx.transaction_date = payload.transaction_date

    if payload.category_id is not None:
        cat_stmt = select(Category).where(
            and_(
                Category.id == payload.category_id,
                or_(Category.user_id == current_user.id, Category.user_id == None)
            )
        )
        cat_res = await db.execute(cat_stmt)
        if not cat_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found or access denied.")
        tx.category_id = payload.category_id

    if payload.savings_goal_id is not None:
        goal_stmt = select(SavingsGoal).where(and_(SavingsGoal.id == payload.savings_goal_id, SavingsGoal.user_id == current_user.id))
        goal_res = await db.execute(goal_stmt)
        if not goal_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Savings goal not found or access denied.")
        tx.savings_goal_id = payload.savings_goal_id

    tx.version += 1
    await db.commit()
    await db.refresh(tx)
    return tx


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Deletes a transaction from the ledger."""
    stmt = select(Transaction).where(and_(Transaction.id == transaction_id, Transaction.user_id == current_user.id))
    res = await db.execute(stmt)
    tx = res.scalar_one_or_none()

    if not tx:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found.")

    await db.delete(tx)
    await db.commit()
    return None
