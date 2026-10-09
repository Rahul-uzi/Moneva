import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, PersonDebt
from app.schemas.schemas import (
    PersonDebtCreate,
    PersonDebtRepay,
    PersonDebtResponse,
    PersonDebtUpdate,
)

router = APIRouter(prefix="/debts", tags=["Debts"])

"""Who owes whom, and nothing else.

A debt here does NOT move money. The rupees left the bank when they were lent
and the ledger recorded that already; these rows add the part a ledger cannot
hold - a name, and whether it has come back. Reading it as money too would
answer "how much do I have" twice, differently, and would count the repayment
a second time when it arrives as income.
"""


def _as_response(d: PersonDebt) -> PersonDebtResponse:
    """Outstanding is computed in one place, so it can never disagree."""
    outstanding = max(0, int(d.amount_minor) - int(d.repaid_minor or 0))
    return PersonDebtResponse(
        id=d.id,
        person=d.person,
        direction=d.direction,
        amount_minor=int(d.amount_minor),
        repaid_minor=int(d.repaid_minor or 0),
        outstanding_minor=outstanding,
        note=d.note,
        occurred_on=d.occurred_on,
        settled_at=d.settled_at,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


async def _load(db: AsyncSession, user: User, id: uuid.UUID) -> PersonDebt:
    res = await db.execute(
        select(PersonDebt).where(and_(PersonDebt.id == id, PersonDebt.user_id == user.id))
    )
    debt = res.scalar_one_or_none()
    if not debt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debt not found.")
    return debt


@router.get("", response_model=List[PersonDebtResponse])
async def list_debts(
    include_settled: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Open debts, oldest first - the one waiting longest is the one to chase."""
    conditions = [PersonDebt.user_id == current_user.id]
    if not include_settled:
        conditions.append(PersonDebt.settled_at.is_(None))
    res = await db.execute(
        select(PersonDebt).where(and_(*conditions)).order_by(PersonDebt.created_at.asc())
    )
    return [_as_response(d) for d in res.scalars().all()]


@router.post("", response_model=PersonDebtResponse, status_code=status.HTTP_201_CREATED)
async def create_debt(
    payload: PersonDebtCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Records that somebody has the user's money, or the user has theirs.

    Deliberately NOT deduplicated. Lending the same friend the same amount
    twice is an ordinary thing to do, and merging the second into the first
    would quietly halve what is owed.
    """
    debt = PersonDebt(
        user_id=current_user.id,
        person=payload.person,
        direction=payload.direction,
        amount_minor=payload.amount_minor,
        repaid_minor=0,
        note=payload.note,
        occurred_on=payload.occurred_on or datetime.now(timezone.utc),
    )
    db.add(debt)
    await db.commit()
    await db.refresh(debt)
    return _as_response(debt)


@router.post("/{id}/repay", response_model=PersonDebtResponse)
async def repay_debt(
    id: uuid.UUID,
    payload: PersonDebtRepay,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Some of it, or all of it, has come back."""
    debt = await _load(db, current_user, id)

    outstanding = max(0, int(debt.amount_minor) - int(debt.repaid_minor or 0))
    if outstanding == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This one is already settled."
        )

    # Omitting the amount means the whole thing, which is what usually happens.
    paid = payload.amount_minor if payload.amount_minor is not None else outstanding
    # Clamped rather than refused: being handed back MORE than was lent is a
    # rounding story, not an error, and refusing it would leave the debt open
    # with no way to close it.
    debt.repaid_minor = int(debt.repaid_minor or 0) + min(paid, outstanding)

    if int(debt.repaid_minor) >= int(debt.amount_minor):
        debt.settled_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(debt)
    return _as_response(debt)


@router.patch("/{id}", response_model=PersonDebtResponse)
async def update_debt(
    id: uuid.UUID,
    payload: PersonDebtUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fixes a wrong name, amount or note."""
    debt = await _load(db, current_user, id)

    if payload.person is not None:
        debt.person = payload.person.strip() or debt.person
    if payload.amount_minor is not None:
        debt.amount_minor = payload.amount_minor
    if payload.note is not None:
        debt.note = payload.note
    if payload.repaid_minor is not None:
        debt.repaid_minor = min(int(payload.repaid_minor), int(debt.amount_minor))

    # The settled flag is derived from the figures on every edit, so correcting
    # an amount downwards closes the debt and correcting it upwards reopens it
    # instead of leaving a settled row that is no longer settled.
    if int(debt.repaid_minor or 0) >= int(debt.amount_minor):
        debt.settled_at = debt.settled_at or datetime.now(timezone.utc)
    else:
        debt.settled_at = None

    await db.commit()
    await db.refresh(debt)
    return _as_response(debt)


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_debt(
    id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Removes a debt that should never have been recorded.

    Settling and deleting are different things: a settled debt is kept, because
    "he paid me back" is worth being able to see. This is for the mistake.
    """
    debt = await _load(db, current_user, id)
    await db.delete(debt)
    await db.commit()
    return None
