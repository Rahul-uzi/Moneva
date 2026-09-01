import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Account
from app.schemas.schemas import AccountCreate, AccountUpdate, AccountResponse
from app.services.finance import calculate_account_balance

router = APIRouter(prefix="/accounts", tags=["Accounts"])

@router.get("", response_model=List[AccountResponse])
async def list_accounts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns all accounts owned by the authenticated user with dynamically calculated balances."""
    stmt = select(Account).where(and_(Account.user_id == current_user.id, Account.is_active == True))
    res = await db.execute(stmt)
    accounts = res.scalars().all()

    response_list = []
    for acc in accounts:
        bal = await calculate_account_balance(db, acc.id)
        acc_dict = AccountResponse.model_validate(acc)
        acc_dict.balance_paise = bal
        response_list.append(acc_dict)

    return response_list


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: AccountCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a new financial account for the current user."""
    if payload.account_type.lower() not in ["asset", "liability"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="account_type must be either 'asset' or 'liability'."
        )

    new_acc = Account(
        user_id=current_user.id,
        name=payload.name.strip(),
        account_type=payload.account_type.lower(),
        currency=payload.currency or current_user.currency,
        opening_balance_minor=payload.opening_balance_minor or 0
    )
    db.add(new_acc)
    await db.commit()
    await db.refresh(new_acc)

    bal = await calculate_account_balance(db, new_acc.id)
    resp = AccountResponse.model_validate(new_acc)
    resp.balance_paise = bal
    return resp


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(
    account_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves a single account by ID (user isolated)."""
    stmt = select(Account).where(and_(Account.id == account_id, Account.user_id == current_user.id))
    res = await db.execute(stmt)
    acc = res.scalar_one_or_none()

    if not acc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

    bal = await calculate_account_balance(db, acc.id)
    resp = AccountResponse.model_validate(acc)
    resp.balance_paise = bal
    return resp


@router.patch("/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: uuid.UUID,
    payload: AccountUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates account properties (user isolated). Balance is calculated dynamically, not mutated."""
    stmt = select(Account).where(and_(Account.id == account_id, Account.user_id == current_user.id))
    res = await db.execute(stmt)
    acc = res.scalar_one_or_none()

    if not acc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

    if payload.name is not None:
        acc.name = payload.name.strip()
    if payload.account_type is not None:
        if payload.account_type.lower() not in ["asset", "liability"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account_type.")
        acc.account_type = payload.account_type.lower()
    if payload.currency is not None:
        acc.currency = payload.currency
    if payload.is_active is not None:
        acc.is_active = payload.is_active

    await db.commit()
    await db.refresh(acc)

    bal = await calculate_account_balance(db, acc.id)
    resp = AccountResponse.model_validate(acc)
    resp.balance_paise = bal
    return resp


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Soft-deletes or deactivates an account to preserve transaction ledger history."""
    stmt = select(Account).where(and_(Account.id == account_id, Account.user_id == current_user.id))
    res = await db.execute(stmt)
    acc = res.scalar_one_or_none()

    if not acc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

    acc.is_active = False
    await db.commit()
    return None
