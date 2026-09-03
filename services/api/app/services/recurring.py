"""Working out when a recurring income is due, and what it missed.

A saved salary stream used to be inert: `next_occurrence` was written by the
client and read back for display, and nothing ever compared it to today. A
salary set up in January was still "due 1 February" in June, and the user was
never told. This module is the part that was missing.

Nothing here writes to the database or creates money. It answers two questions -
"is this stream due?" and "what is the date after this one?" - so the API can
prompt the user, who stays the one who decides that the money actually arrived.
"""
from calendar import monthrange
from datetime import datetime, timedelta, timezone
from typing import List, Optional

#: How many missed occurrences we will ever hand back at once. A stream left
#: alone for years should produce a prompt, not thousands of them.
MAX_CATCH_UP = 24

_WEEKS = {"weekly": 1, "fortnightly": 2, "biweekly": 2}


def _as_utc(dt: datetime) -> datetime:
    """Naive timestamps out of SQLite are UTC; comparisons need them aware."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def add_months(dt: datetime, months: int, anchor_day: Optional[int] = None) -> datetime:
    """Adds calendar months, keeping the intended day of the month.

    The naive approach - remembering only the last date used - drifts: a salary
    paid on the 31st becomes the 28th after one February and stays there. So the
    day is taken from `anchor_day`, the day the stream was set up on, and only
    clamped down when the target month is too short. 31 Jan -> 28 Feb -> 31 Mar.
    """
    day = anchor_day or dt.day
    total = dt.month - 1 + months
    year = dt.year + total // 12
    month = total % 12 + 1
    return dt.replace(year=year, month=month, day=min(day, monthrange(year, month)[1]))


def next_after(dt: datetime, frequency: str, anchor_day: Optional[int] = None) -> datetime:
    """The occurrence following `dt` for a stream of this frequency."""
    freq = (frequency or "monthly").strip().lower()
    if freq in _WEEKS:
        return dt + timedelta(weeks=_WEEKS[freq])
    if freq == "daily":
        return dt + timedelta(days=1)
    if freq in ("yearly", "annually"):
        return add_months(dt, 12, anchor_day)
    if freq == "quarterly":
        return add_months(dt, 3, anchor_day)
    # Monthly is the default: it is what a salary is, and what the app offers.
    return add_months(dt, 1, anchor_day)


def due_occurrences(
    next_occurrence: datetime,
    frequency: str,
    anchor_day: Optional[int] = None,
    now: Optional[datetime] = None,
    cap: int = MAX_CATCH_UP,
) -> List[datetime]:
    """Every occurrence that has come round but was never recorded.

    Returns oldest first, so a stream that missed three months is confirmed in
    the order the money would have arrived. Empty when nothing is due yet.
    """
    now = _as_utc(now or datetime.now(timezone.utc))
    cursor = _as_utc(next_occurrence)
    out: List[datetime] = []
    while cursor <= now and len(out) < cap:
        out.append(cursor)
        cursor = next_after(cursor, frequency, anchor_day)
    return out
