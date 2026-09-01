import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Account, Category, Transaction, Budget, SavingsGoal, Bill, RecurringIncome
from app.services.finance import calculate_net_worth, calculate_cash_flow, calculate_category_breakdown, calculate_account_balance, calculate_savings_goal_progress

async def get_financial_summary_tool(user_id: uuid.UUID, db: AsyncSession) -> Dict[str, Any]:
    """Returns net worth, total income, total expense, and cash flow for the user."""
    nw = await calculate_net_worth(db, user_id)
    cash_flow = await calculate_cash_flow(db, user_id)
    return {
        "net_worth_minor": nw,
        "total_income_minor": cash_flow["income_minor"],
        "total_expense_minor": cash_flow["expense_minor"],
        "net_cash_flow_minor": cash_flow["net_cash_flow_minor"],
        "currency": "INR"
    }

async def get_account_balances_tool(user_id: uuid.UUID, db: AsyncSession) -> List[Dict[str, Any]]:
    """Returns a list of accounts with their current minor unit balances."""
    stmt = select(Account).where(and_(Account.user_id == user_id, Account.is_active == True))
    res = await db.execute(stmt)
    accounts = res.scalars().all()

    result = []
    for acc in accounts:
        balance = await calculate_account_balance(db, acc.id)
        result.append({
            "id": str(acc.id),
            "name": acc.name,
            "account_type": acc.account_type,
            "balance_paise": balance,
            "currency": acc.currency
        })
    return result

async def get_category_breakdown_tool(user_id: uuid.UUID, db: AsyncSession) -> List[Dict[str, Any]]:
    """Returns spending breakdown by category for the user."""
    items = await calculate_category_breakdown(db, user_id)
    return [
        {
            "category_id": str(item["category_id"]),
            "category_name": item["name"],
            "color": item.get("color"),
            "amount_minor": item["total_minor"],
            "percentage": item.get("percentage", 0.0)
        }
        for item in items
    ]

async def get_recent_transactions_tool(user_id: uuid.UUID, db: AsyncSession, limit: int = 5) -> List[Dict[str, Any]]:
    """Returns recent transactions for the user."""
    stmt = select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.transaction_date.desc()).limit(limit)
    res = await db.execute(stmt)
    txs = res.scalars().all()

    return [
        {
            "id": str(tx.id),
            "transaction_type": tx.transaction_type,
            "amount_minor": tx.amount_minor,
            "description": tx.description,
            "transaction_date": tx.transaction_date.isoformat()
        }
        for tx in txs
    ]

async def get_budgets_tool(user_id: uuid.UUID, db: AsyncSession) -> List[Dict[str, Any]]:
    """Returns active budgets with spent and remaining amounts."""
    stmt = select(Budget, Category.name.label("category_name")).join(Category).where(Budget.user_id == user_id)
    res = await db.execute(stmt)
    rows = res.all()

    results = []
    for b, cat_name in rows:
        spent_stmt = select(func.coalesce(func.sum(Transaction.amount_minor), 0)).where(
            and_(
                Transaction.user_id == user_id,
                Transaction.category_id == b.category_id,
                Transaction.transaction_type == 'expense',
                Transaction.transaction_date >= b.start_date,
                Transaction.transaction_date <= b.end_date
            )
        )
        spent = (await db.execute(spent_stmt)).scalar() or 0
        remaining = max(0, b.limit_amount_minor - spent)

        results.append({
            "id": str(b.id),
            "category_name": cat_name,
            "limit_amount_minor": b.limit_amount_minor,
            "spent_amount_minor": spent,
            "remaining_amount_minor": remaining
        })
    return results

async def get_goals_tool(user_id: uuid.UUID, db: AsyncSession) -> List[Dict[str, Any]]:
    """Returns savings goals and current saved amounts."""
    stmt = select(SavingsGoal).where(SavingsGoal.user_id == user_id)
    res = await db.execute(stmt)
    goals = res.scalars().all()

    results = []
    for g in goals:
        progress_data = await calculate_savings_goal_progress(db, g.id)
        results.append({
            "id": str(g.id),
            "name": g.name,
            "target_amount_minor": g.target_amount_minor,
            "current_saved_minor": progress_data["current_saved_minor"],
            "progress_percentage": progress_data["progress_percentage"]
        })
    return results

async def get_bills_tool(user_id: uuid.UUID, db: AsyncSession) -> List[Dict[str, Any]]:
    """Returns upcoming and unpaid bills."""
    stmt = select(Bill).where(and_(Bill.user_id == user_id, Bill.status != 'paid'))
    res = await db.execute(stmt)
    bills = res.scalars().all()

    return [
        {
            "id": str(b.id),
            "name": b.name,
            "amount_minor": b.amount_minor,
            "due_date": b.due_date.isoformat(),
            "status": b.status
        }
        for b in bills
    ]
