"""The admin panel's data.

WHAT THIS DELIBERATELY CANNOT DO. It reads accounts and counts; it never reads
a figure. No endpoint here returns a transaction's amount, an account balance,
a description, a note or a merchant - only how MANY of a thing a user has.
A panel is one leaked login, and the difference between "this person has 312
transactions" and "this person spent Rs 4,000 at a hospital" is the difference
between a metric and somebody's private life.

WHY 404 AND NOT 403. `require_admin` answers a non-admin exactly as the app
answers a path that does not exist. A 403 confirms there is an admin surface
here and that this account merely lacks the key, which turns a guess into a
target. The panel is also unlisted, but being unlisted is not a defence - it
is one shared link away from being public, so the authentication is the
defence and obscurity is only a second lock.

PROMOTION IS NOT AN ENDPOINT. There is no route that makes somebody an admin.
`users.is_admin` is set by hand in the database, because a route that can
grant this privilege is a route that can be tricked into granting it.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import Account, AppDownload, Transaction, User
from app.schemas.schemas import (
    AdminOverview,
    AdminUserRow,
    DownloadPoint,
    DownloadStats,
)

router = APIRouter(prefix="/admin", tags=["Admin"])

#: What a non-admin gets. Identical to any unrouted path, on purpose.
_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Admins only, and everybody else is told the page does not exist."""
    if not current_user.is_admin or not current_user.is_active:
        raise _NOT_FOUND
    return current_user


@router.get("/overview", response_model=AdminOverview)
async def overview(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The headline numbers. Counts only - see the module docstring."""
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)

    async def count(stmt) -> int:
        return int((await db.execute(stmt)).scalar_one() or 0)

    total_users = await count(select(func.count()).select_from(User))
    active_users = await count(select(func.count()).select_from(User).where(User.is_active.is_(True)))
    verified = await count(
        select(func.count()).select_from(User).where(User.email_verified.is_(True))
    )
    with_2fa = await count(select(func.count()).select_from(User).where(User.totp_enabled.is_(True)))
    new_week = await count(select(func.count()).select_from(User).where(User.created_at >= week_ago))

    return AdminOverview(
        total_users=total_users,
        active_users=active_users,
        verified_users=verified,
        users_with_2fa=with_2fa,
        new_users_7d=new_week,
        # ACTIVE only, in all three places an account is counted.
        #
        # Deactivating an account is a soft delete - the row stays so its
        # transactions keep their history - so counting rows reports accounts
        # the owner has already got rid of. One real user showed 4 here while
        # their app showed 2, because two had been deactivated and replaced.
        # A panel that disagrees with the app is worse than one that is empty.
        total_accounts=await count(
            select(func.count()).select_from(Account).where(Account.is_active.is_(True))
        ),
        total_transactions=await count(select(func.count()).select_from(Transaction)),
        total_downloads=await count(select(func.count()).select_from(AppDownload)),
        downloads_24h=await count(
            select(func.count()).select_from(AppDownload).where(AppDownload.created_at >= day_ago)
        ),
        downloads_7d=await count(
            select(func.count()).select_from(AppDownload).where(AppDownload.created_at >= week_ago)
        ),
        generated_at=now,
    )


@router.get("/users", response_model=List[AdminUserRow])
async def list_users(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Who has signed up, and how much they actually use it.

    The per-user numbers are COUNTS. "312 transactions" says this is a real
    user rather than a dormant signup, which is the question a panel is for;
    what those transactions were is none of its business.

    Counted with correlated subqueries rather than joins: a join would
    multiply the rows and need a group-by over every selected column, and
    getting that subtly wrong inflates somebody's activity rather than
    erroring.
    """
    tx_count = (
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.user_id == User.id)
        .correlate(User)
        .scalar_subquery()
    )
    acc_count = (
        select(func.count())
        .select_from(Account)
        .where(and_(Account.user_id == User.id, Account.is_active.is_(True)))
        .correlate(User)
        .scalar_subquery()
    )

    rows = (
        await db.execute(
            select(
                User.id, User.email, User.display_name, User.created_at,
                User.is_active, User.is_admin, User.totp_enabled,
                User.email_verified, User.currency,
                tx_count.label("transactions"), acc_count.label("accounts"),
            )
            .order_by(User.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    return [
        AdminUserRow(
            id=str(r.id),
            email=r.email,
            display_name=r.display_name,
            created_at=r.created_at,
            is_active=r.is_active,
            is_admin=r.is_admin,
            totp_enabled=r.totp_enabled,
            email_verified=bool(r.email_verified),
            currency=r.currency,
            transaction_count=int(r.transactions or 0),
            account_count=int(r.accounts or 0),
        )
        for r in rows
    ]


@router.post("/users/{user_id}/active", response_model=AdminUserRow)
async def set_user_active(
    user_id: uuid.UUID,
    active: bool = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Suspend or restore an account.

    Reversible on purpose: there is no delete here. Deleting a user cascades
    through every transaction they ever recorded, and a panel should not carry
    a one-tap button for that next to a list of ordinary rows.
    """
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise _NOT_FOUND
    # An admin who suspends themselves loses the panel and cannot restore it,
    # because restoring it is in the panel.
    if target.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot suspend the account you are signed in with.",
        )
    target.is_active = active
    await db.commit()
    await db.refresh(target)

    tx = int((await db.execute(
        select(func.count()).select_from(Transaction).where(Transaction.user_id == target.id)
    )).scalar_one() or 0)
    acc = int((await db.execute(
        select(func.count()).select_from(Account)
        .where(and_(Account.user_id == target.id, Account.is_active.is_(True)))
    )).scalar_one() or 0)

    return AdminUserRow(
        id=str(target.id), email=target.email, display_name=target.display_name,
        created_at=target.created_at, is_active=target.is_active, is_admin=target.is_admin,
        totp_enabled=target.totp_enabled, email_verified=bool(target.email_verified),
        currency=target.currency, transaction_count=tx, account_count=acc,
    )


@router.get("/growth", response_model=DownloadStats)
async def growth(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    days: int = Query(30, ge=1, le=365),
):
    """Signups per day, and what people did with the account afterwards.

    Reuses DownloadStats because the shape is identical - a daily series plus
    two breakdowns - and inventing a second model with the same fields would
    mean two things to keep in step for no gain. `by_version` carries the
    currencies people signed up with and `by_platform` carries whether they
    ever recorded anything, which is the number that separates a signup from
    a user.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)

    rows = (await db.execute(
        select(User.created_at, User.currency, User.id).where(User.created_at >= since)
    )).all()

    active_ids = {
        r[0] for r in (await db.execute(
            select(Transaction.user_id).distinct()
        )).all()
    }

    by_day: dict[str, int] = {}
    by_currency: dict[str, int] = {}
    engaged = {"recorded something": 0, "never recorded": 0}
    for created_at, currency, uid in rows:
        when = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        key = when.date().isoformat()
        by_day[key] = by_day.get(key, 0) + 1
        by_currency[currency or "?"] = by_currency.get(currency or "?", 0) + 1
        engaged["recorded something" if uid in active_ids else "never recorded"] += 1

    series: List[DownloadPoint] = []
    start = (datetime.now(timezone.utc) - timedelta(days=days - 1)).date()
    for i in range(days):
        d = (start + timedelta(days=i)).isoformat()
        series.append(DownloadPoint(date=d, count=by_day.get(d, 0)))

    return DownloadStats(
        total=len(rows), days=days, series=series,
        by_version=dict(sorted(by_currency.items(), key=lambda kv: -kv[1])),
        by_platform={k: v for k, v in engaged.items() if v},
    )


@router.get("/downloads", response_model=DownloadStats)
async def downloads(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    days: int = Query(30, ge=1, le=365),
):
    """Download traffic, by day and by version."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Dialect-neutral: SQLite has no date_trunc and Postgres has no strftime,
    # and the tests run on SQLite while production is Postgres.
    rows = (await db.execute(
        select(AppDownload.created_at, AppDownload.version_name, AppDownload.platform)
        .where(AppDownload.created_at >= since)
    )).all()

    by_day: dict[str, int] = {}
    by_version: dict[str, int] = {}
    by_platform: dict[str, int] = {}
    for created_at, version, platform in rows:
        when = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        by_day[when.date().isoformat()] = by_day.get(when.date().isoformat(), 0) + 1
        by_version[version or "unknown"] = by_version.get(version or "unknown", 0) + 1
        by_platform[platform or "unknown"] = by_platform.get(platform or "unknown", 0) + 1

    # Every day in the window, including the empty ones - a chart with the
    # quiet days missing reads as busier than it was.
    series: List[DownloadPoint] = []
    start = (datetime.now(timezone.utc) - timedelta(days=days - 1)).date()
    for i in range(days):
        d = (start + timedelta(days=i)).isoformat()
        series.append(DownloadPoint(date=d, count=by_day.get(d, 0)))

    return DownloadStats(
        total=len(rows),
        days=days,
        series=series,
        by_version=dict(sorted(by_version.items(), key=lambda kv: -kv[1])),
        by_platform=dict(sorted(by_platform.items(), key=lambda kv: -kv[1])),
    )
