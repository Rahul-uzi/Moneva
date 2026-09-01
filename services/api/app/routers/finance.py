from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User, Account, Budget, SavingsGoal, Bill, Transaction
from app.schemas.schemas import (
    FinancialSummaryResponse,
    CashFlowResponse,
    AccountBalanceResponse
)
from app.services.finance import (
    calculate_account_balance,
    calculate_net_worth,
    calculate_income_totals,
    calculate_expense_totals,
    calculate_cash_flow,
    calculate_category_breakdown,
    calculate_spending_trends,
    calculate_budget_spending,
    calculate_savings_goal_progress
)

router = APIRouter(prefix="/finance", tags=["Financial Read APIs"])

@router.get("/summary", response_model=FinancialSummaryResponse)
async def get_financial_summary(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns total net worth, income, expenses, and net cash flow in integer minor units."""
    net_worth = await calculate_net_worth(db, current_user.id)
    cash_flow = await calculate_cash_flow(db, current_user.id, start_date, end_date)

    return FinancialSummaryResponse(
        net_worth_minor=net_worth,
        income_minor=cash_flow["income_minor"],
        expense_minor=cash_flow["expense_minor"],
        net_cash_flow_minor=cash_flow["net_cash_flow_minor"],
        currency=current_user.currency
    )


@router.get("/cash-flow", response_model=CashFlowResponse)
async def get_cash_flow(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns aggregate income, expense, and net cash flow for a date range."""
    res = await calculate_cash_flow(db, current_user.id, start_date, end_date)
    return CashFlowResponse(
        income_minor=res["income_minor"],
        expense_minor=res["expense_minor"],
        net_cash_flow_minor=res["net_cash_flow_minor"]
    )


@router.get("/net-worth")
async def get_net_worth(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns net worth in integer minor units."""
    nw = await calculate_net_worth(db, current_user.id)
    return {"net_worth_minor": nw, "currency": current_user.currency}


@router.get("/account-balances", response_model=List[AccountBalanceResponse])
async def get_account_balances(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns calculated balances for all user accounts."""
    stmt = select(Account).where(and_(Account.user_id == current_user.id, Account.is_active == True))
    res = await db.execute(stmt)
    accounts = res.scalars().all()

    result = []
    for acc in accounts:
        bal = await calculate_account_balance(db, acc.id)
        result.append(AccountBalanceResponse(
            account_id=acc.id,
            account_name=acc.name,
            account_type=acc.account_type,
            balance_minor=bal,
            currency=acc.currency
        ))

    return result


@router.get("/analytics/category-breakdown")
async def get_category_breakdown(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns expense category breakdown for a date range."""
    return await calculate_category_breakdown(db, current_user.id, start_date, end_date)


@router.get("/analytics/spending-trends")
async def get_spending_trends(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns time-bucketed expense spending trends."""
    return await calculate_spending_trends(db, current_user.id, start_date, end_date)


@router.get("/reports/export")
async def export_financial_report(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Generates complete financial analytics report payload for export."""
    net_worth = await calculate_net_worth(db, current_user.id)
    cash_flow = await calculate_cash_flow(db, current_user.id, start_date, end_date)
    categories = await calculate_category_breakdown(db, current_user.id, start_date, end_date)
    trends = await calculate_spending_trends(db, current_user.id, start_date, end_date)

    # Fetch Budgets summary
    bud_res = await db.execute(select(Budget).where(Budget.user_id == current_user.id))
    budgets = bud_res.scalars().all()
    budget_analytics = []
    for b in budgets:
        spent = await calculate_budget_spending(db, current_user.id, b.category_id, b.start_date, b.end_date)
        budget_analytics.append({
            "budget_id": str(b.id),
            "limit_amount_minor": b.limit_amount_minor,
            "spent_amount_minor": spent,
            "remaining_amount_minor": b.limit_amount_minor - spent
        })

    # Fetch Goals summary
    goal_res = await db.execute(select(SavingsGoal).where(SavingsGoal.user_id == current_user.id))
    goals = goal_res.scalars().all()
    goal_analytics = []
    for g in goals:
        prog = await calculate_savings_goal_progress(db, g.id)
        goal_analytics.append(prog)

    # Fetch Bills summary
    bill_res = await db.execute(select(Bill).where(Bill.user_id == current_user.id))
    bills = bill_res.scalars().all()

    return {
        "report_generated_at": datetime.now(timezone.utc).isoformat(),
        "user_email": current_user.email,
        "currency": current_user.currency,
        "period": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None
        },
        "summary": {
            "net_worth_minor": net_worth,
            "income_minor": cash_flow["income_minor"],
            "expense_minor": cash_flow["expense_minor"],
            "net_cash_flow_minor": cash_flow["net_cash_flow_minor"]
        },
        "category_breakdown": categories,
        "spending_trends": trends,
        "budgets_summary": budget_analytics,
        "goals_summary": goal_analytics,
        "bills_count": len(bills)
    }
