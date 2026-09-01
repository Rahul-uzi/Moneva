import uuid
from datetime import datetime
from typing import Optional, Dict, Any, List
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Account, Transaction, Budget, SavingsGoal, Category

# Postgres returns SUM(bigint) as NUMERIC, which SQLAlchemy hands back as a
# decimal.Decimal; SQLite returns a plain int. Decimal and float do not mix
# (Decimal * 100.0 raises TypeError), and this app's whole contract is integer
# minor units - so every aggregate is coerced to int at the source.

async def calculate_account_balance(db: AsyncSession, account_id: uuid.UUID) -> int:
    """
    Calculates the dynamic balance of an account in minor units (paise)
    based on authoritative transaction events and opening balance.
    """
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise ValueError(f"Account with ID {account_id} not found.")

    inc_stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
        and_(Transaction.account_id == account_id, Transaction.transaction_type == "income")
    )
    inc_res = await db.execute(inc_stmt)
    income_sum = int(inc_res.scalar() or 0)

    exp_stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
        and_(Transaction.account_id == account_id, Transaction.transaction_type == "expense")
    )
    exp_res = await db.execute(exp_stmt)
    expense_sum = int(exp_res.scalar() or 0)

    in_trf_stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
        and_(Transaction.to_account_id == account_id, Transaction.transaction_type == "transfer")
    )
    in_trf_res = await db.execute(in_trf_stmt)
    incoming_transfers = int(in_trf_res.scalar() or 0)

    out_trf_stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
        and_(Transaction.account_id == account_id, Transaction.transaction_type == "transfer")
    )
    out_trf_res = await db.execute(out_trf_stmt)
    outgoing_transfers = int(out_trf_res.scalar() or 0)

    if account.account_type.lower() == "liability":
        balance = account.opening_balance_minor - income_sum + expense_sum - incoming_transfers + outgoing_transfers
    else:
        balance = account.opening_balance_minor + income_sum - expense_sum + incoming_transfers - outgoing_transfers

    return balance


async def calculate_net_worth(db: AsyncSession, user_id: uuid.UUID) -> int:
    """
    Calculates total Net Worth for a user (Total Assets - Total Liabilities) in minor units.
    """
    stmt = select(Account).where(and_(Account.user_id == user_id, Account.is_active == True))
    res = await db.execute(stmt)
    accounts = res.scalars().all()

    total_net_worth = 0
    for account in accounts:
        balance = await calculate_account_balance(db, account.id)
        if account.account_type.lower() == "liability":
            total_net_worth -= balance
        else:
            total_net_worth += balance

    return total_net_worth


async def calculate_income_totals(
    db: AsyncSession,
    user_id: uuid.UUID,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None
) -> int:
    """
    Calculates total income for a user within an optional date range.
    Excludes transfers to prevent double counting.
    """
    filters = [Transaction.user_id == user_id, Transaction.transaction_type == "income"]
    if start_date:
        filters.append(Transaction.transaction_date >= start_date)
    if end_date:
        filters.append(Transaction.transaction_date <= end_date)

    stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(and_(*filters))
    res = await db.execute(stmt)
    return int(res.scalar() or 0)


async def calculate_expense_totals(
    db: AsyncSession,
    user_id: uuid.UUID,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None
) -> int:
    """
    Calculates total expenses for a user within an optional date range.
    Excludes transfers to prevent double counting.
    """
    filters = [Transaction.user_id == user_id, Transaction.transaction_type == "expense"]
    if start_date:
        filters.append(Transaction.transaction_date >= start_date)
    if end_date:
        filters.append(Transaction.transaction_date <= end_date)

    stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(and_(*filters))
    res = await db.execute(stmt)
    return int(res.scalar() or 0)


async def calculate_cash_flow(
    db: AsyncSession,
    user_id: uuid.UUID,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None
) -> Dict[str, int]:
    """
    Calculates income, expense, and net cash flow for a user.
    """
    income = await calculate_income_totals(db, user_id, start_date, end_date)
    expense = await calculate_expense_totals(db, user_id, start_date, end_date)
    return {
        "income_minor": income,
        "expense_minor": expense,
        "net_cash_flow_minor": income - expense
    }


async def calculate_budget_spending(
    db: AsyncSession,
    user_id: uuid.UUID,
    category_id: uuid.UUID,
    start_date: datetime,
    end_date: datetime
) -> int:
    """
    Dynamically calculates actual spent amount for a budget category within a period.
    """
    stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
        and_(
            Transaction.user_id == user_id,
            Transaction.category_id == category_id,
            Transaction.transaction_type == "expense",
            Transaction.transaction_date >= start_date,
            Transaction.transaction_date <= end_date
        )
    )
    res = await db.execute(stmt)
    return int(res.scalar() or 0)


async def calculate_budget_remaining(db: AsyncSession, budget_id: uuid.UUID) -> Dict[str, Any]:
    """
    Returns limit, spent, and remaining amount for a specific budget.
    """
    result = await db.execute(select(Budget).where(Budget.id == budget_id))
    budget = result.scalar_one_or_none()
    if not budget:
        raise ValueError(f"Budget with ID {budget_id} not found.")

    spent = await calculate_budget_spending(
        db, budget.user_id, budget.category_id, budget.start_date, budget.end_date
    )
    remaining = budget.limit_amount_minor - spent

    return {
        "budget_id": budget.id,
        "limit_amount_minor": budget.limit_amount_minor,
        "spent_amount_minor": spent,
        "remaining_amount_minor": remaining
    }


async def calculate_savings_goal_progress(db: AsyncSession, goal_id: uuid.UUID) -> Dict[str, Any]:
    """
    Calculates progress towards a savings goal based on linked transactions.
    """
    result = await db.execute(select(SavingsGoal).where(SavingsGoal.id == goal_id))
    goal = result.scalar_one_or_none()
    if not goal:
        raise ValueError(f"Savings goal with ID {goal_id} not found.")

    stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
        and_(
            Transaction.savings_goal_id == goal_id,
            Transaction.user_id == goal.user_id
        )
    )
    res = await db.execute(stmt)
    current_saved = int(res.scalar() or 0)

    percentage = 0.0
    if goal.target_amount_minor > 0:
        percentage = (current_saved / goal.target_amount_minor) * 100.0
        percentage = max(0.0, min(100.0, percentage))

    return {
        "goal_id": goal.id,
        "target_amount_minor": goal.target_amount_minor,
        "current_saved_minor": current_saved,
        "progress_percentage": round(percentage, 2)
    }


async def calculate_category_breakdown(
    db: AsyncSession,
    user_id: uuid.UUID,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None
) -> List[Dict[str, Any]]:
    """
    Calculates category breakdown for expenses in minor units.
    """
    filters = [Transaction.user_id == user_id, Transaction.transaction_type == "expense"]
    if start_date:
        filters.append(Transaction.transaction_date >= start_date)
    if end_date:
        filters.append(Transaction.transaction_date <= end_date)

    stmt = (
        select(
            Category.id,
            Category.name,
            Category.icon,
            Category.color,
            func.coalesce(func.sum(Transaction.amount_minor), 0).label("total_minor")
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .where(and_(*filters))
        .group_by(Category.id, Category.name, Category.icon, Category.color)
        .order_by(func.sum(Transaction.amount_minor).desc())
    )
    res = await db.execute(stmt)
    rows = res.all()

    total_expense = sum(int(r.total_minor) for r in rows)
    result = []
    for r in rows:
        total = int(r.total_minor)
        pct = (total / total_expense * 100.0) if total_expense > 0 else 0.0
        result.append({
            "category_id": str(r.id),
            "name": r.name,
            "icon": r.icon or "Tag",
            "color": r.color or "#FF6B6B",
            "total_minor": total,
            "percentage": round(pct, 2)
        })
    return result


async def calculate_spending_trends(
    db: AsyncSession,
    user_id: uuid.UUID,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None
) -> List[Dict[str, Any]]:
    """
    Groups expense amounts by date label for spending trends.
    """
    filters = [Transaction.user_id == user_id, Transaction.transaction_type == "expense"]
    if start_date:
        filters.append(Transaction.transaction_date >= start_date)
    if end_date:
        filters.append(Transaction.transaction_date <= end_date)

    stmt = (
        select(
            func.date(Transaction.transaction_date).label("tx_date"),
            func.sum(Transaction.amount_minor).label("daily_total")
        )
        .where(and_(*filters))
        .group_by(func.date(Transaction.transaction_date))
        .order_by(func.date(Transaction.transaction_date).asc())
    )
    res = await db.execute(stmt)
    rows = res.all()

    return [
        {
            "date_label": str(r.tx_date),
            "amount_minor": int(r.daily_total or 0)
        }
        for r in rows
    ]
