import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ratelimit import EMI_WRITES_BY_ACCOUNT, enforce
from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Account, Emi
from app.schemas.schemas import EmiCreate, EmiUpdate, EmiResponse

router = APIRouter(prefix="/emis", tags=["EMIs"])

#: One person cannot plausibly be paying off more than this at once, and the
#: cap is what stops a stuck client from filling the table. Chosen high enough
#: that nobody legitimate meets it.
MAX_ACTIVE_PLANS = 60


async def _owned_account(db: AsyncSession, user: User, account_id):
    """The account, if it is this user's. Refuses a stranger's id.

    Without this an id from another account could be attached to a plan, and
    the card screen would then read one user's instalments against another
    user's card.
    """
    if account_id is None:
        return None
    res = await db.execute(
        select(Account).where(and_(Account.id == account_id, Account.user_id == user.id))
    )
    account = res.scalar_one_or_none()
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That account was not found.",
        )
    return account


@router.get("", response_model=List[EmiResponse])
async def list_emis(
    include_closed: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Every instalment plan this user is paying.

    Plans that have run their course are still returned: a plan is finished by
    its own dates, and the screen says so. Only a plan the user closed by hand
    is hidden, and even that can be asked for.
    """
    stmt = select(Emi).where(Emi.user_id == current_user.id)
    if not include_closed:
        stmt = stmt.where(Emi.is_active == True)  # noqa: E712
    stmt = stmt.order_by(Emi.started_at.desc())
    res = await db.execute(stmt)
    return list(res.scalars().all())


@router.post("", response_model=EmiResponse, status_code=status.HTTP_201_CREATED)
async def create_emi(
    payload: EmiCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Records a plan the user is already committed to."""
    enforce(EMI_WRITES_BY_ACCOUNT, str(current_user.id))
    account = await _owned_account(db, current_user, payload.account_id)

    # Counted in the database rather than by loading the rows and measuring
    # the list: the cap is checked on every create, and a rejected create
    # should cost less than an accepted one, not more.
    count = await db.execute(
        select(func.count()).select_from(Emi).where(
            and_(Emi.user_id == current_user.id, Emi.is_active == True)  # noqa: E712
        )
    )
    if (count.scalar_one() or 0) >= MAX_ACTIVE_PLANS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"That is more than {MAX_ACTIVE_PLANS} running plans. Close one first.",
        )

    emi = Emi(
        user_id=current_user.id,
        account_id=payload.account_id,
        name=payload.name.strip(),
        monthly_minor=payload.monthly_minor,
        months=payload.months,
        started_at=payload.started_at,
        # The card it is charged to decides the currency; a plan on no account
        # follows the user's own.
        currency=(account.currency if account else None) or payload.currency or current_user.currency,
    )
    db.add(emi)
    await db.commit()
    await db.refresh(emi)
    return emi


@router.patch("/{emi_id}", response_model=EmiResponse)
async def update_emi(
    emi_id: uuid.UUID,
    payload: EmiUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Corrects a plan that was entered wrong, or closes one settled early."""
    enforce(EMI_WRITES_BY_ACCOUNT, str(current_user.id))
    res = await db.execute(
        select(Emi).where(and_(Emi.id == emi_id, Emi.user_id == current_user.id))
    )
    emi = res.scalar_one_or_none()
    if emi is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That plan was not found.")

    sent = payload.model_fields_set
    if "account_id" in sent:
        # Null detaches the plan from its card, which stays legal - the
        # commitment outlives the account record.
        await _owned_account(db, current_user, payload.account_id)
        emi.account_id = payload.account_id
    if payload.name is not None:
        emi.name = payload.name.strip()
    if payload.monthly_minor is not None:
        emi.monthly_minor = payload.monthly_minor
    if payload.months is not None:
        emi.months = payload.months
    if payload.started_at is not None:
        emi.started_at = payload.started_at
    if payload.is_active is not None:
        emi.is_active = payload.is_active

    await db.commit()
    await db.refresh(emi)
    return emi


@router.delete("/{emi_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_emi(
    emi_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Removes a plan entered by mistake.

    A real plan that was settled early should be closed - PATCH is_active
    false - rather than deleted, so the record of what was being paid off
    survives. This is here for the mistyped row.
    """
    enforce(EMI_WRITES_BY_ACCOUNT, str(current_user.id))
    res = await db.execute(
        select(Emi).where(and_(Emi.id == emi_id, Emi.user_id == current_user.id))
    )
    emi = res.scalar_one_or_none()
    if emi is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That plan was not found.")

    await db.delete(emi)
    await db.commit()
    return None
