"""
Assistant rule-engine behaviour.

These cover the disambiguation the engine gets wrong most easily: a question
that merely mentions an action keyword must never be answered by proposing a
transaction. There was no coverage here at all, and that is exactly how
"what is my biggest expense category" came to be answered with
"Could you specify the amount for this transaction?".
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from main import app
from app.db.database import get_db
from app.models.models import Base

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def api_client():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _signed_in(client: AsyncClient):
    """Registers a user with an account and one fuel expense; returns headers."""
    email = f"assistant.{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post("/api/auth/register", json={
        "email": email, "password": "Jhelum-Ferry-1892", "display_name": "Tester",
        "currency": "INR", "timezone": "Asia/Kolkata",
    })
    assert res.status_code == 201, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}

    acc = await client.post("/api/accounts", headers=headers, json={
        "name": "HDFC", "account_type": "asset",
        "opening_balance_minor": 10_000_000, "currency": "INR",
    })
    assert acc.status_code == 201, acc.text

    cats = (await client.get("/api/categories", headers=headers)).json()
    fuel = next(c for c in cats if c["name"] == "Fuel")
    tx = await client.post("/api/transactions", headers=headers, json={
        "client_mutation_id": str(uuid.uuid4()), "account_id": acc.json()["id"],
        "category_id": fuel["id"], "transaction_type": "expense",
        "amount_minor": 71183, "currency": "INR", "description": "Petrol",
        "transaction_date": datetime.now(timezone.utc).isoformat(), "device_id": "test",
    })
    assert tx.status_code == 201, tx.text
    return headers


async def _ask(client: AsyncClient, headers: dict, prompt: str) -> dict:
    res = await client.post("/api/ai/query", headers=headers, json={"prompt": prompt})
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt", [
    "what is my biggest expense category",
    "what did i spend the most on?",
    "show my expenses",
    "how much income did i get?",
])
async def test_questions_never_propose_a_transaction(api_client: AsyncClient, prompt: str):
    """A question mentioning an action keyword must be answered, not acted on."""
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, prompt)
    assert body["response_type"] != "ACTION_PROPOSAL", f"{prompt!r} proposed {body.get('proposal')}"
    assert body.get("proposal") is None
    # The old failure mode: replying to a question by asking for an amount.
    text = (body.get("message") or "") + (body.get("clarification_prompt") or "")
    assert "specify the amount" not in text.lower(), text


@pytest.mark.asyncio
async def test_biggest_expense_category_is_answered_from_data(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, "what is my biggest expense category")
    assert body["response_type"] == "ANSWER"
    assert "Fuel" in body["message"]
    assert "711.83" in body["message"]


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt,expected_minor", [
    ("bike refueled at 711.83", 71183),
    ("refuelled the bike for 500", 50000),
    ("filled up for 1200.50", 120050),
    ("can you add 500 for lunch", 50000),
    ("please record 1200 for petrol", 120000),
])
async def test_spending_phrasings_produce_a_proposal(
    api_client: AsyncClient, prompt: str, expected_minor: int
):
    """Everyday phrasings, including polite commands, must reach a proposal."""
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, prompt)
    assert body["response_type"] == "ACTION_PROPOSAL", body
    assert body["proposal"]["amount_minor"] == expected_minor


@pytest.mark.asyncio
async def test_refuelling_is_filed_under_fuel(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, "bike refueled at 711.83")
    assert body["proposal"]["category_name"] == "Fuel"


@pytest.mark.asyncio
@pytest.mark.parametrize("greeting", ["hi", "hello", "Hey!", "what can you do"])
async def test_greeting_is_answered(api_client: AsyncClient, greeting: str):
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, greeting)
    assert body["response_type"] == "ANSWER"
    assert "could not work that one out" not in body["message"].lower()


@pytest.mark.asyncio
async def test_unrecognised_input_does_not_claim_to_have_analysed_it(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, "asdfghjkl")
    assert body["response_type"] == "ANSWER"
    assert "i analyzed your request" not in body["message"].lower()


@pytest.mark.asyncio
async def test_empty_prompt_is_rejected(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    res = await api_client.post("/api/ai/query", headers=headers, json={"prompt": "   "})
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_assistant_requires_authentication(api_client: AsyncClient):
    res = await api_client.post("/api/ai/query", json={"prompt": "what is my net worth"})
    assert res.status_code in (401, 403)


@pytest.mark.asyncio
async def test_afford_check_uses_liquid_balance(api_client: AsyncClient):
    """The fixture leaves 100,000.00 in assets less a 711.83 expense."""
    headers = await _signed_in(api_client)
    yes = await _ask(api_client, headers, "can i afford a 5000 phone")
    assert yes["response_type"] == "ANSWER"
    assert yes["message"].startswith("Yes")

    no = await _ask(api_client, headers, "can i afford a 500000 car")
    assert no["response_type"] == "ANSWER"
    assert "Not right now" in no["message"]


@pytest.mark.asyncio
async def test_afford_without_an_amount_asks_for_one(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, "can i afford it")
    assert "amount" in body["message"].lower()


@pytest.mark.asyncio
async def test_month_comparison_reports_both_windows(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, "did i spend more this month than last month")
    assert body["response_type"] == "ANSWER"
    assert "711.83" in body["message"]
    # Nothing was recorded for last month in the fixture.
    assert "last month" in body["message"].lower()


@pytest.mark.asyncio
async def test_placeholder_api_key_does_not_enable_the_model(monkeypatch):
    """A key left as a placeholder must not trigger a doomed network call."""
    from app.services import ai_llm

    monkeypatch.setenv("GEMINI_API_KEY", "your-gemini-api-key")
    assert ai_llm.is_enabled() is False

    monkeypatch.setenv("GEMINI_API_KEY", "short")
    assert ai_llm.is_enabled() is False

    monkeypatch.setenv("GEMINI_API_KEY", "AIza" + "x" * 32)
    assert ai_llm.is_enabled() is True


# ---------------------------------------------------------------------------
# Data-driven answers. The engine used to reply to any spending question with
# the month TOTAL unless the words food/groceries/dining appeared, so these
# guard against a confident number that answers a different question.
# ---------------------------------------------------------------------------
async def _with_spread(client: AsyncClient):
    """A user with several categories used, plus a named second account."""
    email = f"spread.{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post("/api/auth/register", json={
        "email": email, "password": "Jhelum-Ferry-1892", "display_name": "Tester",
        "currency": "INR", "timezone": "Asia/Kolkata",
    })
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    hdfc = (await client.post("/api/accounts", headers=headers, json={
        "name": "HDFC Savings", "account_type": "asset",
        "opening_balance_minor": 10_000_000, "currency": "INR",
    })).json()
    await client.post("/api/accounts", headers=headers, json={
        "name": "Cash Wallet", "account_type": "asset",
        "opening_balance_minor": 500_000, "currency": "INR",
    })
    cats = {c["name"]: c["id"] for c in (await client.get("/api/categories", headers=headers)).json()}
    now = datetime.now(timezone.utc)
    for cat, amount, desc in [
        ("Entertainment", 99_900, "Netflix"),
        ("Groceries", 230_000, "BigBasket"),
        ("Food & Dining", 145_000, "Swiggy dinner"),
    ]:
        await client.post("/api/transactions", headers=headers, json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": hdfc["id"],
            "category_id": cats[cat], "transaction_type": "expense",
            "amount_minor": amount, "currency": "INR", "description": desc,
            "transaction_date": now.isoformat(), "device_id": "test",
        })
    return headers


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt,expected,not_expected", [
    ("how much did i spend on entertainment", "999.00", "3,749.00"),
    ("how much on groceries", "2,300.00", "3,749.00"),
    ("what did i spend on food & dining", "1,450.00", "3,749.00"),
])
async def test_category_spend_is_that_category_not_the_month_total(
    api_client: AsyncClient, prompt: str, expected: str, not_expected: str
):
    headers = await _with_spread(api_client)
    body = await _ask(api_client, headers, prompt)
    assert body["response_type"] == "ANSWER"
    assert expected in body["message"], body["message"]
    assert not_expected not in body["message"], "answered with the month total"


@pytest.mark.asyncio
async def test_merchant_search_uses_the_description(api_client: AsyncClient):
    headers = await _with_spread(api_client)
    body = await _ask(api_client, headers, "how much did i spend at swiggy")
    assert "1,450.00" in body["message"], body["message"]


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt,account", [
    ("what is my hdfc balance", "HDFC Savings"),
    ("how much is in my cash wallet", "Cash Wallet"),
])
async def test_named_account_balance(api_client: AsyncClient, prompt: str, account: str):
    headers = await _with_spread(api_client)
    body = await _ask(api_client, headers, prompt)
    assert account in body["message"], body["message"]


@pytest.mark.asyncio
async def test_recent_transactions_come_from_the_ledger(api_client: AsyncClient):
    headers = await _with_spread(api_client)
    body = await _ask(api_client, headers, "show me my recent transactions")
    assert "Netflix" in body["message"] or "Swiggy" in body["message"], body["message"]


@pytest.mark.asyncio
async def test_period_label_states_the_window(api_client: AsyncClient):
    """A total must say what window it covers so it cannot be misread."""
    headers = await _with_spread(api_client)
    body = await _ask(api_client, headers, "how much did i spend last week")
    assert "last 7 days" in body["message"], body["message"]


@pytest.mark.asyncio
async def test_budget_status_reports_real_spending(api_client: AsyncClient):
    """Reading the wrong key reported every budget as 0 spent and within limits."""
    headers = await _with_spread(api_client)
    cats = {c["name"]: c["id"] for c in (await api_client.get("/api/categories", headers=headers)).json()}
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    res = await api_client.post("/api/budgets", headers=headers, json={
        "category_id": cats["Groceries"], "limit_amount_minor": 100_000,
        "period": "monthly", "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=27)).isoformat(),
    })
    assert res.status_code in (200, 201), res.text

    body = await _ask(api_client, headers, "am i over budget")
    assert "2,300.00" in body["message"], body["message"]
    assert "over" in body["message"].lower()


@pytest.mark.asyncio
async def test_savings_rate_uses_income_and_expense(api_client: AsyncClient):
    headers = await _with_spread(api_client)
    body = await _ask(api_client, headers, "what is my savings rate")
    # No income recorded for this fixture, so it must say so rather than divide.
    assert "no income" in body["message"].lower(), body["message"]


@pytest.mark.asyncio
async def test_listing_categories_reflects_the_users_own(api_client: AsyncClient):
    headers = await _with_spread(api_client)
    body = await _ask(api_client, headers, "list my categories")
    assert "Groceries" in body["message"] and "Salary" in body["message"]


# ---------------------------------------------------------------------------
# The suggestion chips send fixed prompts. If a prompt stops matching, the chip
# silently starts replying "I could not work that one out" - which is what
# "Which bills are due soon and how much are they?" was doing.
# ---------------------------------------------------------------------------
CHIP_PROMPTS = [
    "What is my total net worth right now?",
    "How much of my income this month is left after expenses?",
    "How am I doing against my budgets this month?",
    "What is the progress on my savings goals?",
    "Which bills are due soon and how much are they?",
    "What are my account balances?",
    "What did I spend the most on this month?",
    "How much did I spend this week?",
    "What is my savings rate this month?",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt", CHIP_PROMPTS)
async def test_every_suggestion_chip_gets_a_real_answer(api_client: AsyncClient, prompt: str):
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, prompt)
    assert body["response_type"] == "ANSWER", body
    assert "could not work that one out" not in body["message"].lower(), prompt


@pytest.mark.asyncio
async def test_paying_a_bill_still_proposes_rather_than_listing(api_client: AsyncClient):
    """The bills ANSWER branch runs first, so it must ignore payment commands."""
    headers = await _signed_in(api_client)
    cats = {c["name"]: c["id"] for c in (await api_client.get("/api/categories", headers=headers)).json()}
    due = datetime.now(timezone.utc) + timedelta(days=5)
    res = await api_client.post("/api/bills", headers=headers, json={
        "name": "Electricity", "amount_minor": 250_000,
        "due_date": due.isoformat(), "category_id": cats["Utilities"],
        "recurrence": "monthly",
    })
    assert res.status_code in (200, 201), res.text

    pay = await _ask(api_client, headers, "pay my electricity bill")
    assert pay["response_type"] == "ACTION_PROPOSAL", pay
    assert pay["proposal"]["type"] == "bill_payment"

    ask = await _ask(api_client, headers, "which bills are due soon")
    assert ask["response_type"] == "ANSWER"
    assert "Electricity" in ask["message"]


# ---------------------------------------------------------------------------
# Shorthand entry and bill listings.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize("prompt,expected_minor", [
    ("bike 711.8", 71_180),      # no verb at all
    ("bike 711.83", 71_183),
    ("petrol 711.8", 71_180),
    ("bike fuel 711.8", 71_180),
    ("chai 40", 4_000),
])
async def test_shorthand_entry_creates_a_proposal(
    api_client: AsyncClient, prompt: str, expected_minor: int
):
    """People jot "<thing> <amount>" with no verb; that must still be understood."""
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, prompt)
    assert body["response_type"] == "ACTION_PROPOSAL", body
    assert body["proposal"]["amount_minor"] == expected_minor


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt", ["petrol 711.8", "bike fuel 711.8", "diesel 500"])
async def test_fuel_words_are_filed_under_fuel(api_client: AsyncClient, prompt: str):
    """Falling back to the first expense category filed petrol under Food & Dining."""
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, prompt)
    assert body["proposal"]["category_name"] == "Fuel", body["proposal"]


@pytest.mark.asyncio
async def test_unknown_thing_is_not_filed_under_a_guessed_category(api_client: AsyncClient):
    """"bike" matches no category, so it must use the catch-all, not Food & Dining."""
    headers = await _signed_in(api_client)
    body = await _ask(api_client, headers, "bike 711.8")
    assert body["proposal"]["category_name"] in ("Other", "Uncategorised"), body["proposal"]


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt", [
    "show bill", "show bills", "upcoming bills", "due bills", "bills due",
    "what bills are due", "what do i owe",
])
async def test_every_bill_phrasing_lists_bills(api_client: AsyncClient, prompt: str):
    headers = await _signed_in(api_client)
    cats = {c["name"]: c["id"] for c in (await api_client.get("/api/categories", headers=headers)).json()}
    due = datetime.now(timezone.utc) + timedelta(days=5)
    await api_client.post("/api/bills", headers=headers, json={
        "name": "Electricity", "amount_minor": 250_000, "due_date": due.isoformat(),
        "category_id": cats["Utilities"], "recurrence": "monthly",
    })
    body = await _ask(api_client, headers, prompt)
    assert body["response_type"] == "ANSWER", body
    assert "Electricity" in body["message"], body["message"]


@pytest.mark.asyncio
async def test_overdue_bills_are_flagged_and_listed_first(api_client: AsyncClient):
    """An overdue bill used to sit last under the heading "upcoming"."""
    headers = await _signed_in(api_client)
    cats = {c["name"]: c["id"] for c in (await api_client.get("/api/categories", headers=headers)).json()}
    now = datetime.now(timezone.utc)
    for name, amount, days in [("Electricity", 250_000, 5), ("Rent", 1_500_000, -2)]:
        await api_client.post("/api/bills", headers=headers, json={
            "name": name, "amount_minor": amount,
            "due_date": (now + timedelta(days=days)).isoformat(),
            "category_id": cats["Utilities"], "recurrence": "monthly",
        })
    body = await _ask(api_client, headers, "show bills")
    message = body["message"]
    assert "OVERDUE" in message, message
    # Soonest first: the overdue one leads.
    assert message.index("Rent") < message.index("Electricity"), message
    assert "17,500.00" in message, message  # 15,000 + 2,500
