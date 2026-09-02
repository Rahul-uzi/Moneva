import logging
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
from app.services.finance import calculate_cash_flow, calculate_account_balance
from app.services import ai_query
from app.services.ai_tools import (
    get_financial_summary_tool,
    get_account_balances_tool,
    get_category_breakdown_tool,
    get_recent_transactions_tool,
    get_budgets_tool,
    get_goals_tool,
    get_bills_tool
)

logger = logging.getLogger(__name__)


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
            # Postgres aborts the whole transaction when a statement fails, and
            # every later query on the same session then errors too. Without
            # this rollback the fall-through below inherits a dead session and
            # the rule engine fails for reasons that have nothing to do with it.
            logger.exception("AI model path failed; falling back to the rule engine")
            try:
                await db.rollback()
            except Exception:
                logger.exception("Could not roll back the session after an AI failure")

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
        # A greeting is the first thing most people type; it used to land on
        # the "I could not work that out" fallback.
        stripped = lower.strip().strip("!.,?")
        if stripped in {
            "hi", "hey", "hello", "yo", "hola", "namaste", "good morning",
            "good afternoon", "good evening", "hi there", "hey there",
            "hello there", "hii", "helo", "hey!", "good day",
        } or any(k in lower for k in ["what can you do", "how can you help", "what do you do"]):
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=(
                    "Hello! Ask me about your net worth, what you have spent this month, "
                    "your biggest expense category, account balances, upcoming bills "
                    "or savings goals. You can also just tell me what you spent "
                    + chr(8212)
                    + " something like " + chr(8220) + "refuelled the bike for 711.83"
                    + chr(8221) + " " + chr(8212) + " and I will draft the transaction."
                ),
            )

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

        # "What do I spend most on" - the breakdown is already available, and
        # without this the word "expense" fell through to the create-expense
        # intent below, which answered a question by asking for an amount.
        if any(k in lower for k in [
            "biggest expense", "largest expense", "top category", "biggest category",
            "most on", "spend most", "highest spending", "biggest spend",
        ]):
            breakdown = await get_category_breakdown_tool(user_id, db)
            if not breakdown:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message="You have no expenses recorded this month yet, so there is no category to rank.",
                )
            ranked = sorted(breakdown, key=lambda b: b["amount_minor"], reverse=True)
            top = ranked[0]
            lines = [
                f"• {b['category_name']}: ₹{b['amount_minor'] / 100:,.2f}"
                for b in ranked[:3]
            ]
            header = (
                f"Your biggest expense this month is {top['category_name']} "
                f"at ₹{top['amount_minor'] / 100:,.2f}."
            )
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message="\n".join([header] + lines),
            )

        # "Did I spend more than last month" - compares the two windows rather
        # than falling through to the not-understood reply.
        if ("last month" in lower or "previous month" in lower) and any(
            k in lower for k in ["spend", "spent", "spending", "expense", "more", "less", "compare"]
        ):
            now = datetime.now(timezone.utc)
            this_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            last_end = this_start - timedelta(microseconds=1)
            last_start = last_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

            this_flow = await calculate_cash_flow(db, user_id, this_start, now)
            last_flow = await calculate_cash_flow(db, user_id, last_start, last_end)
            this_exp = int(this_flow["expense_minor"])
            last_exp = int(last_flow["expense_minor"])

            if last_exp == 0:
                verdict = (
                    "There is nothing recorded for last month, so there is no "
                    "comparison to make yet."
                )
            else:
                diff = this_exp - last_exp
                pct = abs(diff) * 100.0 / last_exp
                if diff > 0:
                    verdict = f"That is ₹{abs(diff) / 100:,.2f} more ({pct:.0f}% up)."
                elif diff < 0:
                    verdict = f"That is ₹{abs(diff) / 100:,.2f} less ({pct:.0f}% down)."
                else:
                    verdict = "That is exactly the same."
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=(
                    f"This month you have spent ₹{this_exp / 100:,.2f}; "
                    f"last month it was ₹{last_exp / 100:,.2f}. {verdict}"
                ),
            )

        # Spending questions, resolved against the user's own data. This used to
        # special-case food/groceries/dining and answer everything else with the
        # month TOTAL - so "how much on entertainment" reported the whole month.
        if any(k in lower for k in [
            "spent", "spend", "spending", "how much did i", "how much have i",
            "how much on", "total spend",
        ]):
            start_at, end_at, period_label = ai_query.resolve_period(lower)

            # 1. A category the user actually has.
            category = ai_query.match_by_name(lower, categories)
            if category is not None:
                total, count = await ai_query.spend_in_category(
                    db, user_id, category.id, start_at, end_at
                )
                if count == 0:
                    return AIQueryResponse(
                        response_type=ResponseType.ANSWER,
                        message=f"Nothing recorded under {category.name} for {period_label}.",
                    )
                noun = "transaction" if count == 1 else "transactions"
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message=(
                        f"You spent ₹{total / 100:,.2f} on {category.name} {period_label} "
                        f"across {count} {noun}."
                    ),
                )

            # 2. A merchant or payee from the descriptions they typed.
            merchant_terms = [
                t for t in ai_query._tokens(lower)
                if t not in {"income", "worth", "net", "budget", "budgets", "goal", "goals"}
            ]
            for term in sorted(merchant_terms, key=len, reverse=True):
                total, rows = await ai_query.search_transactions(
                    db, user_id, term, start_at, end_at
                )
                if rows:
                    label = (rows[0].description or term).strip()
                    noun = "transaction" if len(rows) == 1 else "transactions"
                    return AIQueryResponse(
                        response_type=ResponseType.ANSWER,
                        message=(
                            f"You spent ₹{total / 100:,.2f} on “{term}” {period_label} "
                            f"across {len(rows)} {noun}. Most recent: {label}."
                        ),
                    )

            # 3. No category or merchant named - the period total, and the label
            #    says which window it covers so the number cannot be misread.
            total = await ai_query.spend_in_period(db, user_id, start_at, end_at)
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=f"You spent ₹{total / 100:,.2f} in total {period_label}.",
            )

        # "Can I afford X" - measured against liquid asset balances, not net
        # worth, since money tied up in assets cannot be spent today.
        if "afford" in lower:
            price = parse_amount_to_minor(clean_prompt)
            if not price:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message="Tell me the amount and I will check it against your available balance.",
                )
            balances = await get_account_balances_tool(user_id, db)
            liquid = sum(
                int(a["balance_paise"]) for a in balances if a["account_type"] == "asset"
            )
            if price <= liquid:
                left = liquid - price
                message = (
                    f"Yes. ₹{price / 100:,.2f} against ₹{liquid / 100:,.2f} available "
                    f"leaves you ₹{left / 100:,.2f}."
                )
            else:
                short = price - liquid
                message = (
                    f"Not right now. ₹{price / 100:,.2f} is ₹{short / 100:,.2f} more "
                    f"than the ₹{liquid / 100:,.2f} you have available."
                )
            return AIQueryResponse(response_type=ResponseType.ANSWER, message=message)

        if any(k in lower for k in ["cash flow", "income vs expense", "total income"]):
            summary = await get_financial_summary_tool(user_id, db)
            inc = summary["total_income_minor"] / 100.0
            exp = summary["total_expense_minor"] / 100.0
            net = summary["net_cash_flow_minor"] / 100.0
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=f"This month's Total Income is ₹{inc:,.2f}, Total Expenses are ₹{exp:,.2f}, resulting in a Net Cash Flow of ₹{net:,.2f}."
            )

        # A named account: "what is my HDFC balance". The generic branch below
        # lists everything, which is not what was asked.
        if any(k in lower for k in ["balance", "how much is in", "how much do i have in"]):
            account = ai_query.match_by_name(lower, accounts)
            if account is not None:
                bal = await calculate_account_balance(db, account.id)
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message=f"{account.name} holds ₹{int(bal) / 100:,.2f}.",
                )

        # Recent activity, straight from the ledger.
        if any(k in lower for k in [
            "recent transaction", "last transaction", "latest transaction",
            "recent activity", "what did i buy", "my transactions",
        ]):
            rows = await ai_query.recent_transactions(db, user_id, limit=5)
            if not rows:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message="You have not recorded any transactions yet.",
                )
            cat_names = {c.id: c.name for c in categories}
            lines = []
            for t in rows:
                sign = "-" if t.transaction_type == "expense" else "+"
                cat = cat_names.get(t.category_id, "Uncategorised")
                when = t.transaction_date.strftime("%d %b")
                lines.append(
                    f"• {when} {sign}₹{int(t.amount_minor) / 100:,.2f} "
                    f"{(t.description or cat)} ({cat})"
                )
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message="Your most recent transactions:\n" + "\n".join(lines),
            )

        # Budget status against real spending.
        if "budget" in lower and any(k in lower for k in [
            "over", "under", "left", "status", "how am i", "doing", "on track", "my budget",
        ]):
            budgets = await get_budgets_tool(user_id, db)
            if not budgets:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message="You have no budgets set. Add one in Plan to track a category.",
                )
            lines, over = [], 0
            for b in budgets:
                # get_budgets_tool returns spent_amount_minor. Guessing at the
                # key name reported every budget as 0 spent and therefore "within
                # limits" - a wrong number stated with full confidence.
                limit = int(b.get("limit_amount_minor") or 0)
                spent = int(b.get("spent_amount_minor") or 0)
                name = b.get("category_name") or "Budget"
                if limit and spent > limit:
                    over += 1
                    lines.append(
                        f"• {name}: ₹{spent / 100:,.2f} of ₹{limit / 100:,.2f} "
                        f"- over by ₹{(spent - limit) / 100:,.2f}"
                    )
                else:
                    lines.append(
                        f"• {name}: ₹{spent / 100:,.2f} of ₹{limit / 100:,.2f} "
                        f"- ₹{max(0, limit - spent) / 100:,.2f} left"
                    )
            head = (
                f"You are over on {over} of {len(budgets)} budgets."
                if over else f"All {len(budgets)} budgets are within their limits."
            )
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=head + "\n" + "\n".join(lines),
            )

        # Savings rate for the window asked about.
        if "savings rate" in lower or ("saving" in lower and "rate" in lower) or "how much am i saving" in lower:
            start_at, end_at, period_label = ai_query.resolve_period(lower)
            income = await ai_query.spend_in_period(db, user_id, start_at, end_at, "income")
            expense = await ai_query.spend_in_period(db, user_id, start_at, end_at, "expense")
            if income <= 0:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message=f"No income is recorded for {period_label}, so a savings rate cannot be worked out yet.",
                )
            saved = income - expense
            rate = saved * 100.0 / income
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=(
                    f"You kept ₹{saved / 100:,.2f} of ₹{income / 100:,.2f} earned "
                    f"{period_label} - a savings rate of {rate:.0f}%."
                ),
            )

        # The categories they actually have, grouped by type.
        if any(k in lower for k in ["list my categories", "my categories", "what categories"]):
            exp = [c.name for c in categories if c.type == "expense"]
            inc = [c.name for c in categories if c.type == "income"]
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=(
                    f"Expense ({len(exp)}): " + ", ".join(exp) + "\n"
                    + f"Income ({len(inc)}): " + ", ".join(inc)
                ),
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

        # Natural phrasings, not just the three exact strings the chips happened
        # to use. "Which bills are due soon" matched none of them and fell all
        # the way through to the not-understood reply.
        # Excludes payment commands: this answer branch runs before the pay-bill
        # action, so "pay my electricity bill" would otherwise just list bills.
        if not any(k in lower for k in ["pay ", "paid ", "mark "]) and (
            "bill" in lower or any(k in lower for k in ["what do i owe", "due soon", "what is due"])
        ):
            bills_list = await get_bills_tool(user_id, db)
            if not bills_list:
                return AIQueryResponse(
                    response_type=ResponseType.ANSWER,
                    message="You have no unpaid upcoming bills."
                )
            # Soonest first, and an overdue bill is called overdue rather than
            # listed last under a heading that says "upcoming".
            today = datetime.now(timezone.utc)
            ordered = sorted(bills_list, key=lambda b: b["due_date"][:10])
            lines, overdue = [], 0
            for b in ordered:
                due_txt = b["due_date"][:10]
                try:
                    due_dt = datetime.strptime(due_txt, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                except ValueError:
                    due_dt = None
                amount = f"₹{b['amount_minor'] / 100:,.2f}"
                if due_dt is not None and due_dt.date() < today.date():
                    overdue += 1
                    days = (today.date() - due_dt.date()).days
                    plural = "s" if days != 1 else ""
                    lines.append(f"• {b['name']}: {amount} — OVERDUE by {days} day{plural} ({due_txt})")
                elif due_dt is not None:
                    days = (due_dt.date() - today.date()).days
                    plural = "s" if days != 1 else ""
                    when = "due today" if days == 0 else f"due in {days} day{plural}"
                    lines.append(f"• {b['name']}: {amount} — {when} ({due_txt})")
                else:
                    lines.append(f"• {b['name']}: {amount} (Due: {due_txt})")

            total = sum(int(b["amount_minor"]) for b in ordered)
            if overdue:
                verb = "is" if overdue == 1 else "are"
                head = (f"{overdue} of your {len(ordered)} unpaid bills {verb} overdue. "
                        f"Total outstanding ₹{total / 100:,.2f}:")
            else:
                plural = "s" if len(ordered) != 1 else ""
                head = (f"You have {len(ordered)} unpaid bill{plural} "
                        f"totalling ₹{total / 100:,.2f}:")
            return AIQueryResponse(
                response_type=ResponseType.ANSWER,
                message=head + "\n" + "\n".join(lines),
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
        # A question is never a command. Without this guard the action keywords
        # below fire on questions that merely mention them - "what is my biggest
        # expense" matched the create-an-expense branch and replied by asking
        # for an amount. Anything phrased as a question skips to the fallback,
        # which offers what the assistant can actually answer.
        # "Can you add 500 for lunch" opens like a question but is a request, so
        # the polite prefixes are excluded before the question test.
        polite_command = lower.startswith((
            "can you ", "could you ", "would you ", "please ", "pls ",
        ))
        is_question = not polite_command and (clean_prompt.strip().endswith("?") or lower.split(" ")[0] in {
            "what", "whats", "what's", "how", "why", "when", "where", "which",
            "who", "show", "list", "tell", "give", "do", "does", "did", "is",
            "are", "am", "can", "could", "should", "was", "were", "have", "has",
        })

        # B1: BILL PAYMENT INTENT
        if not is_question and "pay" in lower and "bill" in lower:
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
        if not is_question and ("contribute" in lower or ("goal" in lower and ("save" in lower or "add" in lower))):
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
        if not is_question and any(k in lower for k in ["transfer", "move money", "move funds", "send to savings", "move to savings"]):
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
        if not is_question and any(k in lower for k in [
            "spent", "spend", "expense", "paid", "pay", "bought", "buy", "cost",
            "income", "received", "earned", "got paid",
            # Plain verbs for "add 500 for lunch" / "record 1200 petrol".
            "add", "record", "log",
            # Fuel and top-up phrasings people actually use.
            "refuel", "refueled", "refuelled", "refuelling", "refueling",
            "filled up", "fuelled", "fueled", "fuel", "petrol", "diesel", "recharge",
            "topped up", "top up",
        ]):
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

            # Resolve the category from the user's own names first, then from
            # everyday words ("petrol" -> Fuel). Falling back to the FIRST
            # expense category filed petrol under Food & Dining; an explicit
            # catch-all, or none at all, is honest where a guess is not.
            target_cat = ai_query.guess_category(lower, categories, is_income)
            if target_cat is None:
                target_cat = ai_query.fallback_category(categories, is_income)

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

        # Bare "<thing> <amount>" with no verb at all - "bike 711.8", "chai 40".
        # This is how people actually jot an expense, and it reached the
        # not-understood reply because every branch above wants a keyword.
        if not is_question:
            bare_amount = parse_amount_to_minor(clean_prompt)
            words = [w for w in re.findall(r"[a-zA-Z]+", clean_prompt) if len(w) > 1]
            # Short and concrete: a couple of words naming a thing, plus a number.
            if bare_amount and 1 <= len(words) <= 4:
                target_acc = accounts[0] if accounts else None
                target_cat = (
                    ai_query.guess_category(lower, categories)
                    or ai_query.fallback_category(categories)
                )
                proposal = ProposedActionSchema(
                    type="add_expense",
                    amount_minor=bare_amount,
                    description=clean_prompt[:50],
                    account_id=str(target_acc.id) if target_acc else None,
                    account_name=target_acc.name if target_acc else "Default Account",
                    category_id=str(target_cat.id) if target_cat else None,
                    category_name=target_cat.name if target_cat else "Uncategorised",
                )
                return AIQueryResponse(
                    response_type=ResponseType.ACTION_PROPOSAL,
                    message="I have prepared a proposed transaction based on your request. Please review and confirm before I execute it:",
                    proposal=proposal,
                )

        # Default fallback. It used to open with "I analyzed your request for
        # <prompt>", which was not true of anything that reached this point.
        return AIQueryResponse(
            response_type=ResponseType.ANSWER,
            message=(
                "I could not work that one out. Try asking about your net worth, "
                "what you spent this month, your biggest expense category, your "
                "account balances, upcoming bills or savings goals — or tell me "
                "something like “refuelled the bike for 711.83” and I will draft "
                "the transaction for you."
            ),
        )
    except Exception:
        # Logged with a traceback so a production failure is diagnosable; the
        # user still gets a neutral message.
        logger.exception("Assistant rule engine failed for user %s", user_id)
        return AIQueryResponse(
            response_type=ResponseType.ERROR,
            message="An error occurred while processing your financial query. Please try again."
        )
