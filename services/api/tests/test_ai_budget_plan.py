"""The assistant's plan, offered as something the user can keep.

Tested on the phone, "make a plan for my salary" got an answer and nowhere to
put it. Now the plan comes back as a proposal the user can save to the Plan
tab - and these tests hold the line on what a model is allowed to send there.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models.models import Base, User, Category, Budget
from app.services import ai_llm
from app.services.ai_service import _resolve_proposal_names


def _run(monkeypatch, reply: str):
    async def groq(_payload):
        return reply

    async def gemini_unused(_payload):  # pragma: no cover - must not run
        raise AssertionError("the backup provider ran while the first answered")

    monkeypatch.setattr(ai_llm, "_call_groq", groq)
    monkeypatch.setattr(ai_llm, "_call_gemini", gemini_unused)
    return asyncio.run(ai_llm.query_llm("plan my salary", {"currency": "INR", "today": "2026-10-09"}))


PLAN = """
{"response_type": "ACTION_PROPOSAL",
 "message": "Salary Rs 25,000.00. Save Rs 3,750.00 first...",
 "proposal": {"type": "budget_plan", "amount_minor": 1, "description": "October plan",
   "plan_items": [
     {"category_name": "Food & Dining", "amount_minor": 400000},
     {"category_name": "Groceries", "amount_minor": 250000}
   ]}}
"""


class TestWhatTheModelMaySend:
    def test_a_plan_comes_through_with_its_lines(self, monkeypatch):
        out = _run(monkeypatch, PLAN)
        assert out["proposal"]["type"] == "budget_plan"
        assert [i["category_name"] for i in out["proposal"]["plan_items"]] == ["Food & Dining", "Groceries"]

    def test_the_total_is_worked_out_not_trusted(self, monkeypatch):
        """The model said 1 paisa; the card must show what the lines add to."""
        out = _run(monkeypatch, PLAN)
        assert out["proposal"]["amount_minor"] == 650000

    def test_a_plan_with_no_lines_is_refused(self, monkeypatch):
        out = _run(monkeypatch, """
            {"response_type": "ACTION_PROPOSAL", "message": "Here is a plan.",
             "proposal": {"type": "budget_plan", "amount_minor": 100, "description": "x",
                          "plan_items": []}}
        """)
        assert out is None

    def test_junk_lines_are_dropped_and_repeats_kept_once(self, monkeypatch):
        out = _run(monkeypatch, """
            {"response_type": "ACTION_PROPOSAL", "message": "Plan.",
             "proposal": {"type": "budget_plan", "amount_minor": 1, "description": "x",
               "plan_items": [
                 {"category_name": "Food & Dining", "amount_minor": 400000},
                 {"category_name": "food & dining", "amount_minor": 999},
                 {"category_name": "", "amount_minor": 5000},
                 {"category_name": "Fuel", "amount_minor": -10},
                 "not even an object",
                 {"category_name": "Fuel", "amount_minor": 150000}
               ]}}
        """)
        items = out["proposal"]["plan_items"]
        assert [(i["category_name"], i["amount_minor"]) for i in items] == [
            ("Food & Dining", 400000), ("Fuel", 150000),
        ]


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _user(db: AsyncSession) -> tuple[uuid.UUID, dict]:
    user = User(id=uuid.uuid4(), email=f"p.{uuid.uuid4().hex[:6]}@example.com",
                password_hash="x", display_name="P")
    db.add(user)
    cats = {}
    for name, kind in [("Food & Dining", "expense"), ("Groceries", "expense"), ("Salary", "income")]:
        c = Category(id=uuid.uuid4(), user_id=user.id, name=name, type=kind)
        db.add(c)
        cats[name] = c
    await db.commit()
    return user.id, cats


@pytest.mark.asyncio
async def test_lines_resolve_to_the_users_own_categories(db: AsyncSession):
    user_id, cats = await _user(db)
    resolved = await _resolve_proposal_names({
        "type": "budget_plan", "amount_minor": 650000, "description": "Plan",
        "plan_items": [
            {"category_name": "food & dining", "amount_minor": 400000},
            {"category_name": "Groceries", "amount_minor": 250000},
        ],
    }, user_id, db)
    assert [(l.category_name, l.category_id) for l in resolved.plan_items] == [
        ("Food & Dining", str(cats["Food & Dining"].id)),
        ("Groceries", str(cats["Groceries"].id)),
    ]
    assert resolved.plan_unmatched is None
    assert resolved.amount_minor == 650000


@pytest.mark.asyncio
async def test_a_name_with_no_category_is_reported_not_guessed(db: AsyncSession):
    user_id, _ = await _user(db)
    resolved = await _resolve_proposal_names({
        "type": "budget_plan", "amount_minor": 1, "description": "Plan",
        "plan_items": [
            {"category_name": "Groceries", "amount_minor": 250000},
            {"category_name": "Pet care", "amount_minor": 90000},
        ],
    }, user_id, db)
    assert [l.category_name for l in resolved.plan_items] == ["Groceries"]
    assert resolved.plan_unmatched == ["Pet care"]
    # Only what will actually be saved is counted.
    assert resolved.amount_minor == 250000


@pytest.mark.asyncio
async def test_an_income_category_is_never_budgeted(db: AsyncSession):
    user_id, _ = await _user(db)
    resolved = await _resolve_proposal_names({
        "type": "budget_plan", "amount_minor": 1, "description": "Plan",
        "plan_items": [{"category_name": "Salary", "amount_minor": 100000}],
    }, user_id, db)
    assert resolved.plan_items == []
    assert resolved.plan_unmatched == ["Salary"]


@pytest.mark.asyncio
async def test_the_card_knows_the_current_budget(db: AsyncSession):
    """So it can say "Rs 3,000 -> Rs 4,000", not just "Rs 4,000"."""
    user_id, cats = await _user(db)
    now = datetime.now(timezone.utc)
    db.add(Budget(user_id=user_id, category_id=cats["Food & Dining"].id,
                  limit_amount_minor=300000, period="monthly",
                  start_date=now - timedelta(days=5), end_date=now + timedelta(days=20)))
    await db.commit()

    resolved = await _resolve_proposal_names({
        "type": "budget_plan", "amount_minor": 1, "description": "Plan",
        "plan_items": [{"category_name": "Food & Dining", "amount_minor": 400000}],
    }, user_id, db)
    assert resolved.plan_items[0].current_minor == 300000
