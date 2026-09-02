import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Budget, Category
from app.schemas.schemas import BudgetCreate, BudgetUpdate, BudgetResponse
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
