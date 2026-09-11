"""Refresh-token rotation, reuse detection, and the list of signed-in devices.

All three are the same mechanism seen from different sides, which is why they
live in one file.

THE PROBLEM THIS SOLVES.

A refresh token was a bearer credential valid for sixty days and reusable
without limit. Stolen once, it granted sixty days of access that nothing could
detect: the owner stayed signed in the whole time, because a thief using the
token did not disturb their session. There was no signal to notice, no record
to inspect, and `logout-all` - the only remedy - required knowing to use it.

ROTATION does not prevent the theft; it bounds the window. Every refresh mints
a new token and retires the one presented, so a stolen token stops working the
moment the real device refreshes - minutes, normally.

REUSE DETECTION is the part that matters. Once a token is retired, presenting
it again is something no correct client ever does. It means two parties hold
the same credential, and there is no way to tell from the request which one is
the owner. So both are disbelieved: the whole family is revoked and everyone
signs in again. The owner is inconvenienced and, crucially, INFORMED - which is
strictly better than a thief with sixty silent days.

WHAT IS DELIBERATELY NOT DONE.

A missing session row is treated as "already rotated away", not as an attack.
Rows are pruned once expired, and a token whose row has been cleaned up would
otherwise look identical to a stolen one - condemning a family because of
housekeeping would sign people out at random and teach them to ignore it.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import RefreshSession, User


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_jti(jti: str) -> str:
    """sha256, not bcrypt.

    Unlike a password or a reset code, a jti is a 128-bit random value that
    nobody has to remember and nobody can guess - so there is nothing for a
    slow hash to buy. It is hashed only so that a leaked database does not hand
    over live session identifiers, and this runs on every refresh.
    """
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    """Postgres gives back tz-aware datetimes; SQLite does not.

    Comparing a naive datetime to an aware one raises, and the tests run on
    SQLite while production runs on Postgres - so the failure would only ever
    appear in one of them.
    """
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def start_session(
    db: AsyncSession,
    user: User,
    *,
    device_label: Optional[str] = None,
    ip: Optional[str] = None,
) -> str:
    """Begin a new family for a fresh sign-in. Returns the jti to embed."""
    jti = uuid.uuid4().hex
    session = RefreshSession(
        user_id=user.id,
        family_id=uuid.uuid4(),
        jti_hash=hash_jti(jti),
        device_label=(device_label or "").strip()[:120] or None,
        last_ip=(ip or None),
        expires_at=_now() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    await db.flush()
    return jti


async def revoke_family(db: AsyncSession, family_id, reason: str) -> None:
    """End every session in a family that is not already ended."""
    await db.execute(
        update(RefreshSession)
        .where(RefreshSession.family_id == family_id)
        .where(RefreshSession.revoked_at.is_(None))
        .values(revoked_at=_now(), revoked_reason=reason)
    )


class ReuseDetected(Exception):
    """A retired refresh token came back. Two parties hold the same credential."""


async def rotate(
    db: AsyncSession,
    user: User,
    jti: Optional[str],
    *,
    ip: Optional[str] = None,
) -> Tuple[str, bool]:
    """Exchange one refresh token for the next.

    Returns (new_jti, was_tracked). `was_tracked` is False when the presented
    token predates this mechanism or its row has been pruned - those are
    carried on a fresh family rather than refused, so shipping rotation does
    not sign out everyone who is already using the app.

    Raises ReuseDetected when a token that has already been exchanged is
    presented again. The caller must treat that as the end of the family.
    """
    if not jti:
        # A token issued before rotation existed. Adopt it into a new family.
        return await start_session(db, user, ip=ip), False

    res = await db.execute(
        select(RefreshSession).where(RefreshSession.jti_hash == hash_jti(jti))
    )
    session = res.scalar_one_or_none()

    if session is None:
        # Pruned, or from another environment's database. Not evidence of
        # anything - see the note at the top about not condemning housekeeping.
        return await start_session(db, user, ip=ip), False

    if session.revoked_at is not None:
        # The family is already condemned. Say nothing about why.
        raise ReuseDetected()

    if session.used_at is not None:
        # THE SIGNAL. A correct client never presents the same refresh token
        # twice; two parties hold it, and nothing in this request says which
        # one is the owner. Disbelieve both.
        await revoke_family(db, session.family_id, "reuse")
        raise ReuseDetected()

    expires = _aware(session.expires_at)
    if expires and expires < _now():
        raise ReuseDetected()

    now = _now()
    session.used_at = now
    session.last_seen_at = now
    if ip:
        session.last_ip = ip

    # The successor inherits the family, so reuse anywhere in the chain
    # condemns the whole line back to the original sign-in.
    new_jti = uuid.uuid4().hex
    db.add(
        RefreshSession(
            user_id=user.id,
            family_id=session.family_id,
            jti_hash=hash_jti(new_jti),
            device_label=session.device_label,
            last_ip=ip or session.last_ip,
            expires_at=_aware(session.expires_at) or (now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)),
        )
    )
    await db.flush()
    return new_jti, True


async def active_sessions(db: AsyncSession, user: User) -> list[RefreshSession]:
    """The live end of each family - one row per device, newest first.

    A family accumulates one row per refresh, which for a daily user is
    hundreds. Only the tip is a session anyone would recognise, so the rest are
    collapsed away here rather than shown as hundreds of "devices".
    """
    res = await db.execute(
        select(RefreshSession)
        .where(RefreshSession.user_id == user.id)
        .where(RefreshSession.revoked_at.is_(None))
        .where(RefreshSession.used_at.is_(None))
        .order_by(RefreshSession.last_seen_at.desc())
    )
    rows = list(res.scalars().all())

    now = _now()
    live = []
    seen_families = set()
    for row in rows:
        expires = _aware(row.expires_at)
        if expires and expires < now:
            continue
        if row.family_id in seen_families:
            continue
        seen_families.add(row.family_id)
        live.append(row)
    return live


async def prune_expired(db: AsyncSession, user: User) -> None:
    """Delete rows that can no longer authorise anything.

    Every refresh adds a row, so without this the table grows without bound -
    a daily user leaves several hundred rows a year, all of them long dead.
    Run opportunistically on sign-in rather than as a scheduled job, because
    the table only grows when someone signs in anyway.
    """
    cutoff = _now() - timedelta(days=1)
    res = await db.execute(
        select(RefreshSession)
        .where(RefreshSession.user_id == user.id)
        .where(RefreshSession.expires_at < cutoff)
    )
    for row in res.scalars().all():
        await db.delete(row)
