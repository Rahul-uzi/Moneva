import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Account, Category, Transaction, Budget, SavingsGoal, Bill, RecurringIncome, PersonDebt
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
    """Returns recent transactions for the user, each with its category and account.

    The category and account names are the point. Without them the assistant
    received a list of descriptions and amounts and was then asked things like
    "how much did I spend on food" - questions it could only answer by guessing
    from the wording, which is exactly the kind of confident wrong answer that
    makes an assistant useless. Joined here rather than looked up per row: one
    query for the categories and one for the accounts, not one per transaction.
    """
    stmt = select(Transaction).where(Transaction.user_id == user_id).order_by(Transaction.transaction_date.desc()).limit(limit)
    res = await db.execute(stmt)
    txs = res.scalars().all()

    cat_ids = {tx.category_id for tx in txs if tx.category_id}
    acc_ids = {tx.account_id for tx in txs if tx.account_id}
    cat_names: Dict[Any, str] = {}
    acc_names: Dict[Any, str] = {}
    if cat_ids:
        rows = await db.execute(select(Category.id, Category.name).where(Category.id.in_(cat_ids)))
        cat_names = {cid: name for cid, name in rows.all()}
    if acc_ids:
        rows = await db.execute(select(Account.id, Account.name).where(Account.id.in_(acc_ids)))
        acc_names = {aid: name for aid, name in rows.all()}

    return [
        {
            "id": str(tx.id),
            "transaction_type": tx.transaction_type,
            "amount_minor": tx.amount_minor,
            "description": tx.description,
            # Explicitly null rather than omitted: "this payment has no
            # category" is a fact worth the assistant knowing, and the user's
            # imported history is full of them.
            "category_name": cat_names.get(tx.category_id),
            "account_name": acc_names.get(tx.account_id),
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


async def get_person_debts_tool(user_id: uuid.UUID, db: AsyncSession) -> Dict[str, Any]:
    """Who has the user's money, and whose money the user has.

    Only what is still open: a settled debt is history, and listing it would
    invite the assistant to tell somebody to chase money already returned.

    These are REMINDERS, not balances. Nothing here is part of net worth -
    the rupees left the bank when they were lent and the ledger recorded that
    already, and the repayment will arrive as ordinary income.
    """
    stmt = select(PersonDebt).where(
        and_(PersonDebt.user_id == user_id, PersonDebt.settled_at.is_(None))
    ).order_by(PersonDebt.created_at.asc())
    res = await db.execute(stmt)
    debts = res.scalars().all()

    owed_to_me, i_owe = [], []
    for d in debts:
        outstanding = max(0, int(d.amount_minor) - int(d.repaid_minor or 0))
        if outstanding == 0:
            continue
        row = {
            "id": str(d.id),
            "person": d.person,
            "outstanding_minor": outstanding,
            "original_minor": int(d.amount_minor),
            "note": d.note,
            "since": d.occurred_on.isoformat() if d.occurred_on else None,
        }
        (i_owe if d.direction == "i_owe" else owed_to_me).append(row)

    return {
        "owed_to_me": owed_to_me,
        "i_owe": i_owe,
        "total_owed_to_me_minor": sum(r["outstanding_minor"] for r in owed_to_me),
        "total_i_owe_minor": sum(r["outstanding_minor"] for r in i_owe),
    }
