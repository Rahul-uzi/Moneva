"""The assistant's half of remembering who owes what.

The user's own words for what they wanted: "remember that I need to get 500 rs
back from neha - when I ask you, just tell to whom I need to take money back".

That is two separate abilities. Being TOLD a debt is a proposal the user
confirms; being ASKED about it is read straight off the snapshot. The second is
the one that matters, because the last ten messages of chat history can carry a
debt through one conversation and then lose it completely in the next - which
is worse than never remembering, since by then the user has stopped keeping
track themselves.
"""
import asyncio
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from main import app
from app.db.database import get_db
from app.models.models import Base, User, PersonDebt
from app.services import ai_llm
from app.services.ai_service import _resolve_proposal_names

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


class TestBeingToldAboutADebt:
    """What survives validation on the way back from the model."""

    def _snapshot(self):
        return {"currency": "INR", "today": "2026-10-09", "debts": {
            "owed_to_me": [], "i_owe": [],
            "total_owed_to_me_minor": 0, "total_i_owe_minor": 0,
        }}

    def _run(self, monkeypatch, reply: str):
        async def groq(_payload):
            return reply

        async def gemini_unused(_payload):  # pragma: no cover - must not run
            raise AssertionError("the backup provider ran while the first answered")

        monkeypatch.setattr(ai_llm, "_call_groq", groq)
        monkeypatch.setattr(ai_llm, "_call_gemini", gemini_unused)
        return asyncio.run(ai_llm.query_llm("remember neha owes me 500", self._snapshot()))

    def test_a_named_debt_comes_through(self, monkeypatch):
        out = self._run(monkeypatch, """
            {"response_type": "ACTION_PROPOSAL",
             "message": "I will note that Neha owes you Rs 500.00.",
             "proposal": {"type": "remember_debt", "amount_minor": 50000,
                          "description": "Lent to Neha", "person": "Neha",
                          "debt_direction": "owed_to_me"}}
        """)
        assert out is not None
        assert out["proposal"]["type"] == "remember_debt"
        assert out["proposal"]["person"] == "Neha"
        assert out["proposal"]["amount_minor"] == 50000
        assert out["proposal"]["debt_direction"] == "owed_to_me"

    def test_a_debt_with_nobody_attached_is_refused(self, monkeypatch):
        """"Somebody owes me 500" is no more use than not recording it."""
        out = self._run(monkeypatch, """
            {"response_type": "ACTION_PROPOSAL", "message": "Noted.",
             "proposal": {"type": "remember_debt", "amount_minor": 50000,
                          "description": "A loan"}}
        """)
        assert out is None

    def test_money_the_user_owes_keeps_its_direction(self, monkeypatch):
        out = self._run(monkeypatch, """
            {"response_type": "ACTION_PROPOSAL", "message": "Noted.",
             "proposal": {"type": "remember_debt", "amount_minor": 200000,
                          "description": "Borrowed", "person": "Mum",
                          "debt_direction": "i_owe"}}
        """)
        assert out["proposal"]["debt_direction"] == "i_owe"

    def test_an_unrecognised_direction_defaults_to_being_owed(self, monkeypatch):
        """The overwhelming case, and the safer reading of a model's invention."""
        out = self._run(monkeypatch, """
            {"response_type": "ACTION_PROPOSAL", "message": "Noted.",
             "proposal": {"type": "remember_debt", "amount_minor": 50000,
                          "description": "Lent", "person": "Neha",
                          "debt_direction": "sideways"}}
        """)
        assert out["proposal"]["debt_direction"] == "owed_to_me"

    def test_an_invented_action_type_is_still_refused(self, monkeypatch):
        out = self._run(monkeypatch, """
            {"response_type": "ACTION_PROPOSAL", "message": "Done.",
             "proposal": {"type": "delete_everything", "amount_minor": 1,
                          "description": "x", "person": "Neha"}}
        """)
        assert out is None


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _user_with_debt(db: AsyncSession, **over) -> tuple[uuid.UUID, PersonDebt]:
    user = User(
        id=uuid.uuid4(),
        email=f"ai.debt.{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="Debt Tester",
    )
    db.add(user)
    fields = dict(person="Neha", direction="owed_to_me", amount_minor=50000, repaid_minor=0)
    fields.update(over)
    debt = PersonDebt(id=uuid.uuid4(), user_id=user.id, **fields)
    db.add(debt)
    await db.commit()
    return user.id, debt


@pytest.mark.asyncio
async def test_the_snapshot_says_who_owes_what(db_session: AsyncSession):
    from app.services.ai_tools import get_person_debts_tool

    user_id, _ = await _user_with_debt(db_session)
    out = await get_person_debts_tool(user_id, db_session)

    assert [d["person"] for d in out["owed_to_me"]] == ["Neha"]
    assert out["owed_to_me"][0]["outstanding_minor"] == 50000
    assert out["total_owed_to_me_minor"] == 50000
    assert out["i_owe"] == []


@pytest.mark.asyncio
async def test_a_settled_debt_is_not_offered_for_chasing(db_session: AsyncSession):
    from datetime import datetime, timezone
    from app.services.ai_tools import get_person_debts_tool

    user_id, _ = await _user_with_debt(
        db_session, repaid_minor=50000, settled_at=datetime.now(timezone.utc)
    )
    out = await get_person_debts_tool(user_id, db_session)
    assert out["owed_to_me"] == []
    assert out["total_owed_to_me_minor"] == 0


@pytest.mark.asyncio
async def test_a_part_paid_debt_reports_only_what_is_left(db_session: AsyncSession):
    from app.services.ai_tools import get_person_debts_tool

    user_id, _ = await _user_with_debt(db_session, repaid_minor=20000)
    out = await get_person_debts_tool(user_id, db_session)
    assert out["owed_to_me"][0]["outstanding_minor"] == 30000
    assert out["owed_to_me"][0]["original_minor"] == 50000


@pytest.mark.asyncio
async def test_settling_by_name_finds_the_existing_debt(db_session: AsyncSession):
    """The model is handed names, never ids - the row is found here."""
    user_id, debt = await _user_with_debt(db_session)

    resolved = await _resolve_proposal_names(
        {"type": "settle_debt", "amount_minor": 50000, "description": "Neha paid back",
         "person": "neha"},
        user_id, db_session,
    )
    assert resolved.debt_id == str(debt.id)
    assert resolved.person == "neha"


@pytest.mark.asyncio
async def test_settling_a_name_with_no_debt_points_at_nothing(db_session: AsyncSession):
    user_id, _ = await _user_with_debt(db_session)

    resolved = await _resolve_proposal_names(
        {"type": "settle_debt", "amount_minor": 50000, "description": "x", "person": "Stranger"},
        user_id, db_session,
    )
    assert resolved.debt_id is None


@pytest.mark.asyncio
async def test_one_users_debt_is_never_settled_for_another(db_session: AsyncSession):
    mine, my_debt = await _user_with_debt(db_session)
    theirs, _ = await _user_with_debt(db_session, person="Nobody", amount_minor=100)

    resolved = await _resolve_proposal_names(
        {"type": "settle_debt", "amount_minor": 50000, "description": "x", "person": "Neha"},
        theirs, db_session,
    )
    assert resolved.debt_id is None, "a debt was matched across users"
