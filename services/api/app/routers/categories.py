import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Category
from app.schemas.schemas import CategoryCreate, CategoryUpdate, CategoryResponse

router = APIRouter(prefix="/categories", tags=["Categories"])

@router.get("", response_model=List[CategoryResponse])
async def list_categories(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns custom categories for the current user plus default global categories."""
    stmt = select(Category).where(
        or_(Category.user_id == current_user.id, Category.is_default == True)
    )
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Creates a user-scoped custom category."""
    if payload.type.lower() not in ["income", "expense"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category type must be 'income' or 'expense'."
        )

    # Check for duplicate category name for this user
    stmt = select(Category).where(
        and_(Category.user_id == current_user.id, Category.name == payload.name.strip())
    )
    res = await db.execute(stmt)
    if res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Category '{payload.name}' already exists."
        )

    cat = Category(
        user_id=current_user.id,
        name=payload.name.strip(),
        type=payload.type.lower(),
        icon=payload.icon,
        color=payload.color,
        is_default=False
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.patch("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: uuid.UUID,
    payload: CategoryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates a custom user-scoped category."""
    stmt = select(Category).where(
        and_(Category.id == category_id, Category.user_id == current_user.id)
    )
    res = await db.execute(stmt)
    cat = res.scalar_one_or_none()

    if not cat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found or cannot edit default category."
        )

    if payload.name is not None:
        cat.name = payload.name.strip()
    if payload.type is not None:
        if payload.type.lower() not in ["income", "expense"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category type.")
        cat.type = payload.type.lower()
    if payload.icon is not None:
        cat.icon = payload.icon
    if payload.color is not None:
        cat.color = payload.color

    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Deletes a custom user category."""
    stmt = select(Category).where(
        and_(Category.id == category_id, Category.user_id == current_user.id)
    )
    res = await db.execute(stmt)
    cat = res.scalar_one_or_none()

    if not cat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found or default system category cannot be deleted."
        )

    await db.delete(cat)
    await db.commit()
    return None
