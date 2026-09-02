"""
Data-driven resolvers for the assistant.

The rule engine used to answer "how much did I spend on entertainment" with the
month's TOTAL, because only food/groceries/dining were special-cased and
everything else fell through to a generic summary. A confidently wrong number is
worse than no answer, so these helpers resolve a question against the user own
categories, accounts and transaction descriptions before anything is said.
"""
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Category, Transaction


def _month_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def resolve_period(prompt: str, now: Optional[datetime] = None) -> Tuple[datetime, datetime, str]:
    """
    Maps the phrasing to a concrete window.

    Returns (start, end, label). Defaults to the current month, which is the
    window every other figure in the app reports.
    """
    now = now or datetime.now(timezone.utc)
    text = prompt.lower()
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if "yesterday" in text:
        return midnight - timedelta(days=1), midnight - timedelta(microseconds=1), "yesterday"
    if "today" in text:
        return midnight, now, "today"
    if "last week" in text or "past week" in text:
        return midnight - timedelta(days=7), now, "the last 7 days"
    if "this week" in text:
        return midnight - timedelta(days=midnight.weekday()), now, "this week"
    if "last month" in text or "previous month" in text:
        end = _month_start(now) - timedelta(microseconds=1)
        return _month_start(end), end, "last month"
    if "this year" in text:
        return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0), now, "this year"
    if "last 30 days" in text or "past 30 days" in text:
        return midnight - timedelta(days=30), now, "the last 30 days"
    return _month_start(now), now, "this month"


_STOPWORDS = {
    "how", "much", "did", "do", "does", "my", "me", "the", "for", "and", "from",
    "spend", "spent", "spending", "what", "whats", "was", "this", "that", "last",
    "week", "month", "year", "today", "yesterday", "show", "tell", "give", "total",
    "balance", "account", "have", "has", "get", "money", "rupees", "please", "all",
    "expenses", "expense", "cost", "costs", "paid", "much?",
}


def _tokens(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9&]+", text.lower())
            if t not in _STOPWORDS and len(t) > 2]


def match_by_name(prompt: str, records: List[Any], name_attr: str = "name") -> Optional[Any]:
    """
    Finds the record the prompt refers to.

    Longest match wins, so "Food & Dining" beats "Food" when both exist. Matching
    works in both directions: the prompt may contain the record name ("spend on
    entertainment"), or a prompt word may identify it ("hdfc" -> "HDFC Savings").
    """
    text = prompt.lower()
    words = set(_tokens(prompt))
    best, best_len = None, 0

    for rec in records:
        name = (getattr(rec, name_attr, None) or "").strip()
        if not name:
            continue
        low = name.lower()
        score = 0
        if low in text:
            score = len(low)
        else:
            parts = [p for p in re.findall(r"[a-z0-9&]+", low) if len(p) > 2]
            if parts and all(p in words for p in parts):
                score = len(low)
            elif parts:
                hits = [p for p in parts if p in words]
                if hits:
                    score = max(len(p) for p in hits)
        if score > best_len:
            best, best_len = rec, score
    return best


async def spend_in_category(
    db: AsyncSession, user_id: uuid.UUID, category_id: uuid.UUID,
    start: datetime, end: datetime,
) -> Tuple[int, int]:
    """Returns (total_minor, transaction_count) for one category in a window."""
    stmt = select(
        func.coalesce(func.sum(Transaction.amount_minor), 0), func.count(Transaction.id)
    ).where(and_(
        Transaction.user_id == user_id,
        Transaction.category_id == category_id,
        Transaction.transaction_type == "expense",
        Transaction.transaction_date >= start,
        Transaction.transaction_date <= end,
    ))
    total, count = (await db.execute(stmt)).one()
    return int(total or 0), int(count or 0)


async def spend_in_period(
    db: AsyncSession, user_id: uuid.UUID, start: datetime, end: datetime,
    transaction_type: str = "expense",
) -> int:
    stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(and_(
        Transaction.user_id == user_id,
        Transaction.transaction_type == transaction_type,
        Transaction.transaction_date >= start,
        Transaction.transaction_date <= end,
    ))
    return int((await db.execute(stmt)).scalar() or 0)


async def search_transactions(
    db: AsyncSession, user_id: uuid.UUID, term: str,
    start: datetime, end: datetime, limit: int = 50,
) -> Tuple[int, List[Transaction]]:
    """Free-text search over descriptions - the merchant the user actually typed."""
    stmt = select(Transaction).where(and_(
        Transaction.user_id == user_id,
        Transaction.transaction_date >= start,
        Transaction.transaction_date <= end,
        Transaction.description.ilike("%" + term + "%"),
    )).order_by(Transaction.transaction_date.desc()).limit(limit)
    rows = list((await db.execute(stmt)).scalars().all())
    total = sum(int(r.amount_minor) for r in rows if r.transaction_type == "expense")
    return total, rows


async def recent_transactions(
    db: AsyncSession, user_id: uuid.UUID, limit: int = 5,
) -> List[Transaction]:
    stmt = select(Transaction).where(
        Transaction.user_id == user_id
    ).order_by(Transaction.transaction_date.desc()).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


async def category_totals(
    db: AsyncSession, user_id: uuid.UUID, start: datetime, end: datetime,
) -> List[Dict[str, Any]]:
    """Per-category expense totals for a window, largest first."""
    stmt = select(
        Category.name, func.coalesce(func.sum(Transaction.amount_minor), 0)
    ).join(Transaction, Transaction.category_id == Category.id).where(and_(
        Transaction.user_id == user_id,
        Transaction.transaction_type == "expense",
        Transaction.transaction_date >= start,
        Transaction.transaction_date <= end,
    )).group_by(Category.name).order_by(func.sum(Transaction.amount_minor).desc())
    return [{"name": n, "amount_minor": int(a or 0)}
            for n, a in (await db.execute(stmt)).all()]


# --------------------------------------------------------------------------
# Category guessing
# --------------------------------------------------------------------------
# Everyday words map to the default category they belong to. Without this,
# "petrol 711.8" found no category called "petrol" and the caller fell back to
# the FIRST expense category - filing fuel under Food & Dining.
_CATEGORY_HINTS: Dict[str, Tuple[str, ...]] = {
    "Fuel": ("petrol", "diesel", "fuel", "refuel", "refuelled", "refueled",
             "gas", "cng", "bunk", "hp", "indianoil", "shell"),
    "Food & Dining": ("lunch", "dinner", "breakfast", "brunch", "snack", "cafe",
                      "coffee", "tea", "restaurant", "swiggy", "zomato", "pizza",
                      "burger", "meal", "eat", "dining", "food"),
    "Groceries": ("grocery", "groceries", "bigbasket", "blinkit", "zepto",
                  "supermarket", "vegetables", "milk", "kirana", "dmart"),
    "Transport": ("uber", "ola", "cab", "taxi", "bus", "metro", "train", "auto",
                  "rapido", "ticket", "travel", "transport"),
    "Entertainment": ("netflix", "spotify", "movie", "cinema", "prime", "hotstar",
                      "game", "concert", "entertainment"),
    "Shopping": ("amazon", "flipkart", "myntra", "shopping", "clothes", "shoes",
                 "shirt", "dress", "myntra"),
    "Health": ("doctor", "medicine", "pharmacy", "hospital", "clinic", "medical",
               "apollo", "health", "gym"),
    "Utilities": ("electricity", "water bill", "broadband", "internet", "wifi",
                  "recharge", "mobile bill", "utility", "utilities"),
    "Rent & Housing": ("rent", "landlord", "maintenance", "housing"),
    "Education": ("course", "tuition", "school", "college", "books", "exam",
                  "education", "udemy"),
}


def guess_category(prompt: str, categories: List[Any], is_income: bool = False) -> Optional[Any]:
    """
    Picks the category a phrase belongs to, or None.

    Returns None rather than guessing when nothing matches - the caller should
    leave the transaction uncategorised instead of asserting a wrong one.
    """
    wanted_type = "income" if is_income else "expense"
    pool = [c for c in categories if getattr(c, "type", None) == wanted_type]
    if not pool:
        return None

    # The user's own category names come first: they may have renamed or added
    # their own, and those matter more than any built-in hint.
    direct = match_by_name(prompt, pool)
    if direct is not None:
        return direct

    words = set(_tokens(prompt)) | set(re.findall(r"[a-z]+", prompt.lower()))
    by_name = {(getattr(c, "name", "") or "").lower(): c for c in pool}
    for cat_name, hints in _CATEGORY_HINTS.items():
        if not any(h in words or h in prompt.lower() for h in hints):
            continue
        target = by_name.get(cat_name.lower())
        if target is not None:
            return target
        # Renamed category: match on the first significant word of the default.
        head = cat_name.split(" ")[0].lower()
        for name, cat in by_name.items():
            if head in name:
                return cat
    return None


def fallback_category(categories: List[Any], is_income: bool = False) -> Optional[Any]:
    """The explicit catch-all, never just the first category in the list."""
    wanted_type = "income" if is_income else "expense"
    pool = [c for c in categories if getattr(c, "type", None) == wanted_type]
    for name in ("other", "others", "miscellaneous", "misc", "general"):
        for c in pool:
            if (getattr(c, "name", "") or "").strip().lower() == name:
                return c
    return None
