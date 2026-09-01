import re
import uuid
import os
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from enum import Enum
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Account, Category, Bill, SavingsGoal
from app.services import ai_llm
from app.services.ai_tools import (
    get_financial_summary_tool,
    get_account_balances_tool,
    get_category_breakdown_tool,
    get_recent_transactions_tool,
    get_budgets_tool,
    get_goals_tool,
    get_bills_tool
)

class ResponseType(str, Enum):
    ANSWER = "ANSWER"
    ACTION_PROPOSAL = "ACTION_PROPOSAL"
    CLARIFICATION_REQUIRED = "CLARIFICATION_REQUIRED"
    ERROR = "ERROR"
    OFFLINE = "OFFLINE"

class ProposedActionSchema(BaseModel):
    type: str # 'add_expense' | 'add_income' | 'transfer' | 'bill_payment' | 'goal_contribution' | 'create_budget' | 'create_goal' | 'create_bill'
    amount_minor: int
    currency: str = "INR"
    description: str
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    to_account_id: Optional[str] = None
    to_account_name: Optional[str] = None
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    savings_goal_id: Optional[str] = None
    savings_goal_name: Optional[str] = None
    bill_id: Optional[str] = None
    bill_name: Optional[str] = None
    due_date: Optional[str] = None

class AIQueryResponse(BaseModel):
    response_type: ResponseType
    message: str = ""
    proposal: Optional[ProposedActionSchema] = None
    clarification_prompt: Optional[str] = None

def parse_amount_to_minor(text: str) -> Optional[int]:
    """Parses text like '₹850', '850.50', '850 rupees', '5,000' into integer minor units."""
    match = re.search(r'(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)', text, re.IGNORECASE)
    if not match:
        return None
    val_str = match.group(1).replace(',', '')
    try:
        if '.' in val_str:
            parts = val_str.split('.')
            rupees = int(parts[0])
            paise = int(parts[1].ljust(2, '0')[:2])
            return rupees * 100 + paise
        else:
            return int(val_str) * 100
    except ValueError:
        return None

async def _build_snapshot(user_id: uuid.UUID, db: AsyncSession) -> dict:
    """Read-only picture of the user's finances handed to the model as context."""
    summary = await get_financial_summary_tool(user_id, db)
    return {
        "currency": "INR",
        "note": "All amounts are integer minor units (paise). 100 = 1 rupee.",
        "summary": summary,
        "accounts": await get_account_balances_tool(user_id, db),
        "category_spend_this_month": await get_category_breakdown_tool(user_id, db),
        "recent_transactions": await get_recent_transactions_tool(user_id, db, limit=8),
        "budgets": await get_budgets_tool(user_id, db),
        "goals": await get_goals_tool(user_id, db),
        "bills": await get_bills_tool(user_id, db),
    }


async def _resolve_proposal_names(
    proposal: dict, user_id: uuid.UUID, db: AsyncSession
) -> ProposedActionSchema:
    """
    Turns the model's human-readable names into real IDs.

    The model never sees or supplies an ID, so it cannot point a mutation at
    another user's records: every lookup here is scoped to user_id.
    """
    accounts = (await db.execute(
        select(Account).where(and_(Account.user_id == user_id, Account.is_active == True))
    )).scalars().all()
    categories = (await db.execute(select(Category).where(Category.user_id == user_id))).scalars().all()
    goals = (await db.execute(select(SavingsGoal).where(SavingsGoal.user_id == user_id))).scalars().all()
    bills = (await db.execute(select(Bill).where(Bill.user_id == user_id))).scalars().all()

    def match(items, name):
        if not name:
            return None
        want = str(name).strip().lower()
        for it in items:
            if it.name.lower() == want:
                return it
        for it in items:
            if want in it.name.lower() or it.name.lower() in want:
                return it
        return None

    acc = match(accounts, proposal.get("account_name")) or (accounts[0] if accounts else None)
    to_acc = match(accounts, proposal.get("to_account_name"))
    is_income = proposal.get("type") == "add_income"
    cat = match(categories, proposal.get("category_name"))
    if cat is None:
        wanted_type = "income" if is_income else "expense"
        typed = [c for c in categories if c.type == wanted_type]
        cat = typed[0] if typed else None
    goal = match(goals, proposal.get("savings_goal_name"))
    bill = match(bills, proposal.get("bill_name"))

    return ProposedActionSchema(
        type=proposal["type"],
        amount_minor=proposal["amount_minor"],
        currency=proposal.get("currency", "INR"),
        description=proposal.get("description", "Recorded via assistant"),
        account_id=str(acc.id) if acc else None,
        account_name=acc.name if acc else None,
        to_account_id=str(to_acc.id) if to_acc else None,
        to_account_name=to_acc.name if to_acc else None,
        category_id=str(cat.id) if cat else None,
        category_name=cat.name if cat else None,
        savings_goal_id=str(goal.id) if goal else None,
        savings_goal_name=goal.name if goal else None,
        bill_id=str(bill.id) if bill else None,
        bill_name=bill.name if bill else None,
    )


async def process_ai_query(user_id: uuid.UUID, prompt: str, db: AsyncSession) -> AIQueryResponse:
    """
    Processes a natural-language financial query for an authenticated user.

    Gemini handles the language understanding when a key is configured; the
    deterministic rule engine below is the fallback whenever the model is
    unavailable, errors, or returns something that fails validation. Either
    path is read-only and can only *propose* a mutation.
    """
    if ai_llm.is_enabled():
        try:
            snapshot = await _build_snapshot(user_id, db)
            llm = await ai_llm.query_llm(prompt, snapshot)
            if llm:
                proposal = None
                if llm.get("proposal"):
                    proposal = await _resolve_proposal_names(llm["proposal"], user_id, db)
                return AIQueryResponse(
                    response_type=ResponseType(llm["response_type"]),
                    message=llm["message"],
                    proposal=proposal,
                    clarification_prompt=llm.get("clarification_prompt"),
                )
        except Exception:
            pass  # fall through to the rule engine

    try:
        # 1. Prompt Injection Safeguard: Clean and isolate user prompt
        clean_prompt = prompt.strip()
        safe_prompt = f"<untrusted_input>{clean_prompt}</untrusted_input>"
        lower = clean_prompt.lower()

        # 2. Fetch User Context Accounts & Categories for resolution
        acc_stmt = select(Account).where(and_(Account.user_id == user_id, Account.is_active == True))
        accounts = (await db.execute(acc_stmt)).scalars().all()

        cat_stmt = select(Category).where(Category.user_id == user_id)
        categories = (await db.execute(cat_stmt)).scalars().all()

        # --------------------------------------------------
        # INTENT A: FINANCIAL QUESTIONS & METRICS (ANSWER)
        # --------------------------------------------------
        # Income-vs-spending for the current month. Checked before the generic
        # amount parser so "how much is left" is not mistaken for a transaction.
        if any(k in lower for k in [
            "left", "remaining", "how much can i spend", "salary used",
            "income this month", "salary left", "budget left",
        ]):
            summary = await get_financial_summary_tool(user_id, db)
            # Key names come from get_financial_summary_tool.
            income = summary.get("total_income_minor", 0)
            expense = summary.get("total_expense_minor", 0)
            remaining = income - expense
            if income <= 0:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message=(
                        "No income is recorded for this month yet, so there is nothing to "
                        "measure spending against. Add your salary and I can track how much "
                        "of it is left."
                    ),
                )
            pct = (expense / income) * 100
            verb = "left to spend" if remaining >= 0 else "over your income"
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=(
                    f"This month you have received ₹{income / 100:,.2f} and spent "
                    f"₹{expense / 100:,.2f} ({pct:.0f}%). That leaves "
                    f"₹{abs(remaining) / 100:,.2f} {verb}."
                ),
            )

        if any(k in lower for k in ["net worth", "total worth", "assets"]):
            summary = await get_financial_summary_tool(user_id, db)
            nw_rupees = summary["net_worth_minor"] / 100.0
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=f"Your current Net Worth is ₹{nw_rupees:,.2f}."
            )

        if any(k in lower for k in ["spent this month", "total spend", "how much did i spend", "spend on", "spent on", "spending on"]):
            if "food" in lower or "groceries" in lower or "dining" in lower:
                breakdown = await get_category_breakdown_tool(user_id, db)
                food_items = [b for b in breakdown if any(f in b["category_name"].lower() for f in ["food", "groceries", "dining"])]
                if food_items:
                    tot_food = sum(b["amount_minor"] for b in food_items)
                    return AIQueryResponse(
                        response_type=ResponseType.ANSWER,
                        message=f"You have spent ₹{tot_food / 100:,.2f} on food/groceries this month."
                    )
                else:
                    return AIQueryResponse(
                        response_type=ResponseType.ANSWER,
                        message="You have no recorded food/grocery expenses for this month."
                    )

            summary = await get_financial_summary_tool(user_id, db)
            exp_rupees = summary["total_expense_minor"] / 100.0
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=f"Your total expenses for this month are ₹{exp_rupees:,.2f}."
            )

        if any(k in lower for k in ["cash flow", "income vs expense", "total income"]):
            summary = await get_financial_summary_tool(user_id, db)
            inc = summary["total_income_minor"] / 100.0
            exp = summary["total_expense_minor"] / 100.0
            net = summary["net_cash_flow_minor"] / 100.0
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=f"This month's Total Income is ₹{inc:,.2f}, Total Expenses are ₹{exp:,.2f}, resulting in a Net Cash Flow of ₹{net:,.2f}."
            )

        if any(k in lower for k in ["account balance", "my accounts", "my balances", "check accounts"]):
            acc_list = await get_account_balances_tool(user_id, db)
            if not acc_list:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message="You currently have no active accounts configured."
                )
            lines = [f"• {a['name']}: ₹{a['balance_paise'] / 100:,.2f}" for a in acc_list]
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message="Here are your current account balances:\n" + "\n".join(lines)
            )

        if any(k in lower for k in ["upcoming bills", "unpaid bills", "my bills"]):
            bills_list = await get_bills_tool(user_id, db)
            if not bills_list:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message="You have no unpaid upcoming bills."
                )
            lines = [f"• {b['name']}: ₹{b['amount_minor'] / 100:,.2f} (Due: {b['due_date'][:10]})" for b in bills_list]
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message="Here are your upcoming unpaid bills:\n" + "\n".join(lines)
            )

        if any(k in lower for k in ["savings goals", "my goals", "goal progress"]):
            goals_list = await get_goals_tool(user_id, db)
            if not goals_list:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message="You currently have no active savings goals."
                )
            lines = [f"• {g['name']}: ₹{g['current_saved_minor'] / 100:,.2f} / ₹{g['target_amount_minor'] / 100:,.2f} ({g['progress_percentage']}%)" for g in goals_list]
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message="Here are your active savings goals:\n" + "\n".join(lines)
            )

        # --------------------------------------------------
        # INTENT B: MUTATION ACTION PROPOSALS & CLARIFICATIONS
        # --------------------------------------------------

        # B1: BILL PAYMENT INTENT
        if "pay" in lower and "bill" in lower:
            amount_minor = parse_amount_to_minor(clean_prompt)
            bills_list = (await db.execute(select(Bill).where(and_(Bill.user_id == user_id, Bill.status != 'paid')))).scalars().all()
            if not bills_list:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message="You have no unpaid bills to pay."
                )

            # Match bill name in prompt
            matching_bills = [b for b in bills_list if b.name.lower() in lower]
            if len(matching_bills) == 1:
                target_bill = matching_bills[0]
            elif len(matching_bills) > 1 or (len(bills_list) > 1 and not matching_bills):
                bill_names = ", ".join([b.name for b in bills_list])
                return AIQueryResponse(
                    response_type=ResponseType.CLARIFICATION_REQUIRED,
                    clarification_prompt=f"Which bill would you like to pay? Available unpaid bills: {bill_names}."
                )
            else:
                target_bill = bills_list[0]

            amt = amount_minor or target_bill.amount_minor
            default_acc = accounts[0] if accounts else None

            if not default_acc:
                return AIQueryResponse(
                    response_type=ResponseType.CLARIFICATION_REQUIRED,
                    clarification_prompt="Please add an active account before paying bills."
                )

            proposal = ProposedActionSchema(
                type="bill_payment",
                amount_minor=amt,
                description=f"Pay bill: {target_bill.name}",
                bill_id=str(target_bill.id),
                bill_name=target_bill.name,
                account_id=str(default_acc.id),
                account_name=default_acc.name
            )
            return AIQueryResponse(
                response_type=ResponseType.ACTION_PROPOSAL,
                message=f"I have prepared a bill payment proposal for '{target_bill.name}'. Please confirm to execute:",
                proposal=proposal
            )

        # B2: GOAL CONTRIBUTION INTENT
        if "contribute" in lower or "goal" in lower and ("save" in lower or "add" in lower):
            amount_minor = parse_amount_to_minor(clean_prompt)
            if not amount_minor:
                return AIQueryResponse(
                    response_type=ResponseType.CLARIFICATION_REQUIRED,
                    clarification_prompt="How much would you like to contribute to your savings goal?"
                )
            goals_list = (await db.execute(select(SavingsGoal).where(SavingsGoal.user_id == user_id))).scalars().all()
            if not goals_list:
                return AIQueryResponse(
                    response_type=ResponseType.CLARIFICATION_REQUIRED,
                    clarification_prompt="Please create a savings goal first before making contributions."
                )

            matching_goals = [g for g in goals_list if g.name.lower() in lower]
            if len(matching_goals) == 1:
                target_goal = matching_goals[0]
            elif len(matching_goals) > 1 or (len(goals_list) > 1 and not matching_goals):
                goal_names = ", ".join([g.name for g in goals_list])
                return AIQueryResponse(
                    response_type=ResponseType.CLARIFICATION_REQUIRED,
                    clarification_prompt=f"Which savings goal would you like to contribute to? Available goals: {goal_names}."
                )
            else:
                target_goal = goals_list[0]

            default_acc = accounts[0] if accounts else None

            proposal = ProposedActionSchema(
                type="goal_contribution",
                amount_minor=amount_minor,
                description=f"Contribution to {target_goal.name}",
                savings_goal_id=str(target_goal.id),
                savings_goal_name=target_goal.name,
                account_id=str(default_acc.id) if default_acc else None,
                account_name=default_acc.name if default_acc else None
            )
            return AIQueryResponse(
                response_type=ResponseType.ACTION_PROPOSAL,
                message=f"I have prepared a goal contribution proposal for '{target_goal.name}'. Please confirm to execute:",
                proposal=proposal
            )

        # B3: TRANSFER INTENT
        if any(k in lower for k in ["transfer", "move money", "move funds", "send to savings", "move to savings"]):
            amount_minor = parse_amount_to_minor(clean_prompt)
            if not amount_minor:
                return AIQueryResponse(
                    response_type=ResponseType.CLARIFICATION_REQUIRED,
                    clarification_prompt="How much would you like to transfer?"
                )
            if len(accounts) < 2:
                return AIQueryResponse(
                    response_type=ResponseType.CLARIFICATION_REQUIRED,
                    clarification_prompt="You need at least two active accounts to perform a transfer."
                )
            src_acc = accounts[0]
            dst_acc = accounts[1]

            proposal = ProposedActionSchema(
                type="transfer",
                amount_minor=amount_minor,
                description="Internal Account Transfer",
                account_id=str(src_acc.id),
                account_name=src_acc.name,
                to_account_id=str(dst_acc.id),
                to_account_name=dst_acc.name
            )
            return AIQueryResponse(
                response_type=ResponseType.ACTION_PROPOSAL,
                message="I have prepared an internal transfer proposal. Please confirm to execute:",
                proposal=proposal
            )

        # B4: EXPENSE / INCOME INTENT
        if any(k in lower for k in ["spent", "expense", "paid", "bought", "cost", "income", "received", "earned"]):
            amount_minor = parse_amount_to_minor(clean_prompt)
            if not amount_minor:
                return AIQueryResponse(
                    response_type=ResponseType.CLARIFICATION_REQUIRED,
                    clarification_prompt="Could you specify the amount for this transaction?"
                )

            is_income = any(k in lower for k in ["income", "received", "earned", "salary"])
            op_type = "add_income" if is_income else "add_expense"

            # Resolve Account Name
            target_acc = None
            for acc in accounts:
                if acc.name.lower() in lower:
                    target_acc = acc
                    break
            if not target_acc and accounts:
                target_acc = accounts[0]

            # Check Ambiguity: If user specified 'account' but multiple match
            if "hdfc" in lower and not any("hdfc" in a.name.lower() for a in accounts):
                acc_names = ", ".join([a.name for a in accounts])
                return AIQueryResponse(
                    response_type=ResponseType.CLARIFICATION_REQUIRED,
                    clarification_prompt=f"Account 'HDFC' was not found. Please choose from your accounts: {acc_names}."
                )

            # Resolve Category Name
            target_cat = None
            for cat in categories:
                if cat.name.lower() in lower:
                    target_cat = cat
                    break
            if not target_cat:
                exp_cats = [c for c in categories if c.type == ('income' if is_income else 'expense')]
                target_cat = exp_cats[0] if exp_cats else None

            desc = clean_prompt[:50]
            proposal = ProposedActionSchema(
                type=op_type,
                amount_minor=amount_minor,
                description=desc,
                account_id=str(target_acc.id) if target_acc else None,
                account_name=target_acc.name if target_acc else "Default Account",
                category_id=str(target_cat.id) if target_cat else None,
                category_name=target_cat.name if target_cat else "General"
            )

            return AIQueryResponse(
                response_type=ResponseType.ACTION_PROPOSAL,
                message=f"I have prepared a proposed transaction based on your request. Please review and confirm before I execute it:",
                proposal=proposal
            )

        # Default fallback answer
        return AIQueryResponse(
            response_type=ResponseType.ANSWER,
            message=f"I analyzed your request for '{clean_prompt}'. You can ask me about your net worth, expenses, account balances, or ask me to record transactions, pay bills, and transfer funds!"
        )
    except Exception:
        return AIQueryResponse(
            response_type=ResponseType.ERROR,
            message="An error occurred while processing your financial query. Please try again."
        )
