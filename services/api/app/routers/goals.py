import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, SavingsGoal, Transaction
from app.schemas.schemas import SavingsGoalCreate, SavingsGoalUpdate, SavingsGoalResponse
from app.services.finance import calculate_savings_goal_progress

router = APIRouter(prefix="/goals", tags=["Savings Goals"])

@router.get("", response_model=List[SavingsGoalResponse])
async def list_goals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Lists all savings goals for current user with dynamically computed progress."""
    stmt = select(SavingsGoal).where(SavingsGoal.user_id == current_user.id)
    res = await db.execute(stmt)
    goals = res.scalars().all()

    result = []
    for g in goals:
        prog = await calculate_savings_goal_progress(db, g.id)
        resp = SavingsGoalResponse.model_validate(g)
        resp.current_saved_minor = prog["current_saved_minor"]
        resp.progress_percentage = prog["progress_percentage"]
        result.append(resp)

    return result


@router.post("", response_model=SavingsGoalResponse, status_code=status.HTTP_201_CREATED)
async def create_goal(
    payload: SavingsGoalCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a new savings goal."""
    if payload.target_amount_minor <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_amount_minor must be > 0.")

    g = SavingsGoal(
        user_id=current_user.id,
        name=payload.name.strip(),
        target_amount_minor=payload.target_amount_minor,
        target_date=payload.target_date,
        status=payload.status or "active"
    )
    db.add(g)
    await db.commit()
    await db.refresh(g)

    prog = await calculate_savings_goal_progress(db, g.id)
    resp = SavingsGoalResponse.model_validate(g)
    resp.current_saved_minor = prog["current_saved_minor"]
    resp.progress_percentage = prog["progress_percentage"]
    return resp


@router.get("/{goal_id}", response_model=SavingsGoalResponse)
async def get_goal(
    goal_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves single goal by ID."""
    stmt = select(SavingsGoal).where(and_(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id))
    res = await db.execute(stmt)
    g = res.scalar_one_or_none()
    if not g:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Savings goal not found.")

    prog = await calculate_savings_goal_progress(db, g.id)
    resp = SavingsGoalResponse.model_validate(g)
    resp.current_saved_minor = prog["current_saved_minor"]
    resp.progress_percentage = prog["progress_percentage"]
    return resp


@router.patch("/{goal_id}", response_model=SavingsGoalResponse)
async def update_goal(
    goal_id: uuid.UUID,
    payload: SavingsGoalUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates goal properties."""
    stmt = select(SavingsGoal).where(and_(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id))
    res = await db.execute(stmt)
    g = res.scalar_one_or_none()
    if not g:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Savings goal not found.")

    if payload.name is not None:
        g.name = payload.name.strip()
    if payload.target_amount_minor is not None:
        if payload.target_amount_minor <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target must be > 0.")
        g.target_amount_minor = payload.target_amount_minor
    if payload.target_date is not None:
        g.target_date = payload.target_date
    if payload.status is not None:
        g.status = payload.status

    await db.commit()
    await db.refresh(g)

    prog = await calculate_savings_goal_progress(db, g.id)
    resp = SavingsGoalResponse.model_validate(g)
    resp.current_saved_minor = prog["current_saved_minor"]
    resp.progress_percentage = prog["progress_percentage"]
    return resp


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal(
    goal_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Deletes a savings goal."""
    stmt = select(SavingsGoal).where(and_(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id))
    res = await db.execute(stmt)
    g = res.scalar_one_or_none()

    if not g:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Savings goal not found.")

    # Unbind savings_goal_id on transactions to preserve historical financial ledger history
    from sqlalchemy import update
    await db.execute(
        update(Transaction)
        .where(Transaction.savings_goal_id == goal_id)
        .values(savings_goal_id=None)
    )

    await db.delete(g)
    await db.commit()
    return None
