"""Card billing terms, and the instalment plans charged to them.

Two things a ledger cannot answer on its own, so two things that have to be
stored rather than derived.

A card's cycle needs its two dates: without them there is no way to know which
purchases are on the statement that just closed, or how many days are left to
pay it. An instalment plan needs to be entered because the bank takes it
whether or not the app saw the alert - a plan rebuilt from captured payments
would under-report the month a notification went missing, and tell somebody
they owe less than they do.

The calendar arithmetic itself is tested in the client (cardCycle.test.ts) and
is deliberately not repeated here: it lives in one place so the two cannot
drift apart. What is tested here is what the server must not get wrong -
ownership, and the shapes it agrees to store.
"""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import create_access_token, hash_password
from app.db.database import get_db
from app.models.models import Account, Base, User
from main import app

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def env():
    """Two users with an account each, so isolation is testable, not assumed."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async def _db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _db

    mine, theirs = uuid.uuid4(), uuid.uuid4()
    my_account, their_account = uuid.uuid4(), uuid.uuid4()
    async with factory() as session:
        for uid, email in ((mine, "mine@example.com"), (theirs, "theirs@example.com")):
            session.add(User(id=uid, email=email, password_hash=hash_password("x"),
                             display_name=email.split("@")[0]))
        await session.commit()
        session.add(Account(id=my_account, user_id=mine, name="HDFC card",
                            account_type="liability", currency="INR", opening_balance_minor=0))
        session.add(Account(id=their_account, user_id=theirs, name="Their card",
                            account_type="liability", currency="INR", opening_balance_minor=0))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.headers["Authorization"] = f"Bearer {create_access_token({'sub': str(mine)})}"
        yield {
            "client": client,
            "account_id": str(my_account),
            "their_account_id": str(their_account),
            "their_token": create_access_token({"sub": str(theirs)}),
        }

    app.dependency_overrides.clear()


CARD = {"name": "HDFC Millennia", "account_type": "liability",
        "statement_day": 18, "due_day": 8, "credit_limit_minor": 2_000_000}


class TestACardIsAnAccountWithTwoDates:
    async def test_the_terms_are_stored_and_returned(self, env):
        res = await env["client"].post("/api/accounts", json=CARD)
        assert res.status_code == 201, res.text[:300]
        body = res.json()
        assert (body["statement_day"], body["due_day"]) == (18, 8)
        assert body["credit_limit_minor"] == 2_000_000

        listed = await env["client"].get("/api/accounts")
        card = next(a for a in listed.json() if a["id"] == body["id"])
        assert card["statement_day"] == 18

    async def test_an_ordinary_account_has_neither(self, env):
        """The absence of the days is what says "not a card".

        A default would silently turn every savings account into one, and the
        card screen would then draw a billing cycle for a bank account.
        """
        res = await env["client"].post(
            "/api/accounts", json={"name": "Savings", "account_type": "asset"})
        assert res.status_code == 201
        assert res.json()["statement_day"] is None
        assert res.json()["due_day"] is None

    @pytest.mark.parametrize("half", [
        {"statement_day": 18},
        {"due_day": 8},
    ])
    async def test_half_a_card_is_refused(self, env, half):
        """One day without the other describes no cycle at all.

        Stored, it would leave a screen that cannot render a cycle and a
        reminder that cannot know when to fire.
        """
        res = await env["client"].post(
            "/api/accounts", json={"name": "Half", "account_type": "liability", **half})
        assert res.status_code == 400, res.text[:300]

    @pytest.mark.parametrize("day", [0, 32, -1])
    async def test_a_day_outside_the_month_is_refused(self, env, day):
        res = await env["client"].post(
            "/api/accounts",
            json={"name": "Bad", "account_type": "liability",
                  "statement_day": day, "due_day": 8})
        assert res.status_code == 400, res.text[:300]

    async def test_the_31st_is_accepted_and_kept_as_31(self, env):
        """Not rewritten to 28 at the edge.

        February has no 31st, but the card still closes on the 31st in every
        month that has one. Clamping on the way in would move the closing date
        of ten months to fix one.
        """
        res = await env["client"].post(
            "/api/accounts",
            json={"name": "Closes on the 31st", "account_type": "liability",
                  "statement_day": 31, "due_day": 20})
        assert res.status_code == 201
        assert res.json()["statement_day"] == 31


class TestChangingTheTerms:
    async def test_a_plain_account_can_become_a_card(self, env):
        res = await env["client"].patch(
            f"/api/accounts/{env['account_id']}",
            json={"statement_day": 5, "due_day": 25})
        assert res.status_code == 200, res.text[:300]
        assert (res.json()["statement_day"], res.json()["due_day"]) == (5, 25)

    async def test_a_card_can_stop_being_one(self, env):
        """Null has to mean something different from omitted.

        With an is-not-None test the terms could be set but never cleared, and
        a wrongly-marked account would stay a card for good.
        """
        await env["client"].patch(f"/api/accounts/{env['account_id']}",
                                  json={"statement_day": 5, "due_day": 25})
        res = await env["client"].patch(
            f"/api/accounts/{env['account_id']}",
            json={"statement_day": None, "due_day": None})
        assert res.status_code == 200, res.text[:300]
        assert res.json()["statement_day"] is None

    async def test_one_day_may_be_changed_when_the_other_is_stored(self, env):
        await env["client"].patch(f"/api/accounts/{env['account_id']}",
                                  json={"statement_day": 5, "due_day": 25})
        res = await env["client"].patch(f"/api/accounts/{env['account_id']}",
                                        json={"due_day": 26})
        assert res.status_code == 200, res.text[:300]
        assert (res.json()["statement_day"], res.json()["due_day"]) == (5, 26)

    async def test_clearing_only_one_day_is_refused(self, env):
        await env["client"].patch(f"/api/accounts/{env['account_id']}",
                                  json={"statement_day": 5, "due_day": 25})
        res = await env["client"].patch(f"/api/accounts/{env['account_id']}",
                                        json={"due_day": None})
        assert res.status_code == 400, res.text[:300]
        # And nothing was half-applied.
        after = await env["client"].get(f"/api/accounts/{env['account_id']}")
        assert after.json()["due_day"] == 25

    async def test_renaming_a_card_leaves_its_terms_alone(self, env):
        await env["client"].patch(f"/api/accounts/{env['account_id']}",
                                  json={"statement_day": 5, "due_day": 25})
        res = await env["client"].patch(f"/api/accounts/{env['account_id']}",
                                        json={"name": "Renamed"})
        assert res.status_code == 200, res.text[:300]
        assert (res.json()["statement_day"], res.json()["due_day"]) == (5, 25)


PLAN = {"name": "iPhone", "monthly_minor": 650000, "months": 12,
        "started_at": "2026-03-10T00:00:00Z"}


class TestInstalmentPlans:
    async def test_a_plan_is_stored_and_listed(self, env):
        res = await env["client"].post("/api/emis", json=PLAN)
        assert res.status_code == 201, res.text[:300]
        assert res.json()["monthly_minor"] == 650000
        assert res.json()["months"] == 12

        listed = await env["client"].get("/api/emis")
        assert [p["name"] for p in listed.json()] == ["iPhone"]

    async def test_a_plan_can_name_the_card_it_is_charged_to(self, env):
        res = await env["client"].post(
            "/api/emis", json={**PLAN, "account_id": env["account_id"]})
        assert res.status_code == 201, res.text[:300]
        assert res.json()["account_id"] == env["account_id"]

    async def test_a_plan_needs_no_card(self, env):
        """Plenty of people are paying something off on a card not added here.

        Refusing the plan until the card exists would lose the very figure the
        feature is for.
        """
        res = await env["client"].post("/api/emis", json=PLAN)
        assert res.status_code == 201
        assert res.json()["account_id"] is None

    async def test_someone_elses_account_is_not_found(self, env):
        """Not "forbidden" - not found.

        Saying "forbidden" would confirm the id belongs to somebody.
        """
        res = await env["client"].post(
            "/api/emis", json={**PLAN, "account_id": env["their_account_id"]})
        assert res.status_code == 404, res.text[:300]

    async def test_one_users_plans_are_invisible_to_another(self, env):
        await env["client"].post("/api/emis", json=PLAN)
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://test") as other:
            other.headers["Authorization"] = f"Bearer {env['their_token']}"
            res = await other.get("/api/emis")
            assert res.status_code == 200
            assert res.json() == []

    async def test_another_users_plan_cannot_be_edited_or_deleted(self, env):
        created = await env["client"].post("/api/emis", json=PLAN)
        emi_id = created.json()["id"]
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://test") as other:
            other.headers["Authorization"] = f"Bearer {env['their_token']}"
            assert (await other.patch(f"/api/emis/{emi_id}",
                                      json={"name": "Hijacked"})).status_code == 404
            assert (await other.delete(f"/api/emis/{emi_id}")).status_code == 404
        # Untouched.
        still = await env["client"].get("/api/emis")
        assert still.json()[0]["name"] == "iPhone"

    @pytest.mark.parametrize("bad", [
        {"monthly_minor": 0},        # not a plan
        {"monthly_minor": -100},     # not a refund either
        {"months": 0},
        {"months": 601},             # fifty years is past any real loan
        {"name": ""},
    ])
    async def test_a_plan_that_makes_no_sense_is_refused(self, env, bad):
        res = await env["client"].post("/api/emis", json={**PLAN, **bad})
        assert res.status_code == 400, res.text[:300]

    async def test_a_plan_settled_early_is_closed_not_deleted(self, env):
        """Closing keeps the record of what was being paid off."""
        created = await env["client"].post("/api/emis", json=PLAN)
        emi_id = created.json()["id"]

        closed = await env["client"].patch(f"/api/emis/{emi_id}", json={"is_active": False})
        assert closed.status_code == 200
        assert closed.json()["is_active"] is False

        assert (await env["client"].get("/api/emis")).json() == []
        assert len((await env["client"].get("/api/emis?include_closed=true")).json()) == 1

    async def test_a_mistyped_plan_can_be_removed(self, env):
        created = await env["client"].post("/api/emis", json=PLAN)
        emi_id = created.json()["id"]
        assert (await env["client"].delete(f"/api/emis/{emi_id}")).status_code == 204
        assert (await env["client"].get("/api/emis?include_closed=true")).json() == []

    async def test_the_start_date_survives_the_round_trip_with_its_offset(self, env):
        """A date read back without an offset is read as local time.

        Progress is counted forward from this date, so a silent shift of a few
        hours can move an instalment into the wrong month.
        """
        created = await env["client"].post("/api/emis", json=PLAN)
        started = created.json()["started_at"]
        assert started.endswith("Z") or "+00:00" in started, started
        parsed = datetime.fromisoformat(started.replace("Z", "+00:00"))
        assert parsed == datetime(2026, 3, 10, tzinfo=timezone.utc)
