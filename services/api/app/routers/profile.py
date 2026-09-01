from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, verify_password, hash_password
from app.db.database import get_db
from app.models.models import User, Account, Transaction, Budget, SavingsGoal, Bill, Category, RecurringIncome
from app.schemas.schemas import UserResponse, UserProfileUpdate, PasswordChangeRequest, AvatarUpdate

router = APIRouter(prefix="/profile", tags=["Profile"])

@router.get("", response_model=UserResponse)
async def get_profile(current_user: User = Depends(get_current_user)):
    """Returns profile for current authenticated user."""
    return current_user


@router.patch("", response_model=UserResponse)
async def update_profile(
    payload: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates user display name, currency, and timezone settings."""
    if payload.display_name is not None:
        if not payload.display_name.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="display_name cannot be empty.")
        current_user.display_name = payload.display_name.strip()
    if payload.currency is not None:
        current_user.currency = payload.currency.upper().strip()
    if payload.timezone is not None:
        current_user.timezone = payload.timezone.strip()

    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/change-password")
async def change_password(
    payload: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Changes password after verifying current password."""
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect."
        )

    if len(payload.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 8 characters long."
        )

    current_user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return {"message": "Password changed successfully."}


@router.put("/avatar", response_model=UserResponse)
async def set_avatar(
    payload: AvatarUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Sets or replaces the user's profile picture. Idempotent: same call updates."""
    current_user.avatar_data_url = payload.avatar_data_url
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.delete("/avatar", response_model=UserResponse)
async def remove_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Removes the user's profile picture, reverting to the initials avatar."""
    current_user.avatar_data_url = None
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.get("/export")
async def export_data(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Exports structured JSON data of all user financial records."""
    acc_res = await db.execute(select(Account).where(Account.user_id == current_user.id))
    tx_res = await db.execute(select(Transaction).where(Transaction.user_id == current_user.id))
    bud_res = await db.execute(select(Budget).where(Budget.user_id == current_user.id))
    goal_res = await db.execute(select(SavingsGoal).where(SavingsGoal.user_id == current_user.id))
    bill_res = await db.execute(select(Bill).where(Bill.user_id == current_user.id))
    cat_res = await db.execute(select(Category).where(Category.user_id == current_user.id))
    inc_res = await db.execute(select(RecurringIncome).where(RecurringIncome.user_id == current_user.id))

    return {
        "user": {
            "email": current_user.email,
            "display_name": current_user.display_name,
            "currency": current_user.currency,
            "timezone": current_user.timezone,
            "created_at": current_user.created_at.isoformat()
        },
        "accounts": [
            {
                "id": str(a.id),
                "name": a.name,
                "type": a.account_type,
                "opening_balance_minor": a.opening_balance_minor,
                "currency": a.currency
            }
            for a in acc_res.scalars().all()
        ],
        "transactions": [
            {
                "id": str(t.id),
                "type": t.transaction_type,
                "amount_minor": t.amount_minor,
                "description": t.description,
                "date": t.transaction_date.isoformat()
            }
            for t in tx_res.scalars().all()
        ],
        "budgets": [
            {"id": str(b.id), "limit_minor": b.limit_amount_minor, "period": b.period}
            for b in bud_res.scalars().all()
        ],
        "savings_goals": [
            {"id": str(g.id), "name": g.name, "target_minor": g.target_amount_minor, "status": g.status}
            for g in goal_res.scalars().all()
        ],
        "bills": [
            {"id": str(b.id), "name": b.name, "amount_minor": b.amount_minor, "status": b.status}
            for b in bill_res.scalars().all()
        ],
        "categories": [
            {"id": str(c.id), "name": c.name, "type": c.type}
            for c in cat_res.scalars().all()
        ],
        "recurring_incomes": [
            {"id": str(r.id), "source": r.source, "amount_minor": r.amount_minor, "frequency": r.frequency}
            for r in inc_res.scalars().all()
        ]
    }


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Deletes current user account and all associated user data."""
    await db.delete(current_user)
    await db.commit()
    return None
