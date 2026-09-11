"""A saved salary stream has to actually come due.

Before this, `next_occurrence` was written by the client and read back for
display and nothing ever compared it to today: a salary set up in January was
still "due 1 February" in June, and the user was never told. Money is still
only recorded when the user confirms it arrived - a salary can be late, short,
or never turn up - but the app now asks.
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
from app.services.recurring import add_months, next_after, due_occurrences, MAX_CATCH_UP

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
UTC = timezone.utc


# ----------------------------- date arithmetic -----------------------------

def test_month_end_salary_does_not_drift():
    # The drift bug: advancing from the stored date alone, 31 Jan clamps to
    # 28 Feb and every later month stays on the 28th.
    d = datetime(2026, 1, 31, tzinfo=UTC)
    feb = add_months(d, 1, anchor_day=31)
    mar = add_months(feb, 1, anchor_day=31)
    assert (feb.month, feb.day) == (2, 28)
    assert (mar.month, mar.day) == (3, 31)


def test_leap_february_is_respected():
    assert add_months(datetime(2028, 1, 31, tzinfo=UTC), 1, 31).day == 29


def test_mid_month_dates_are_untouched():
    d = datetime(2026, 1, 15, tzinfo=UTC)
    assert add_months(d, 1, 15) == datetime(2026, 2, 15, tzinfo=UTC)


def test_year_rolls_over():
    assert add_months(datetime(2026, 12, 5, tzinfo=UTC), 1, 5) == datetime(2027, 1, 5, tzinfo=UTC)


@pytest.mark.parametrize("freq,days", [("weekly", 7), ("fortnightly", 14), ("biweekly", 14), ("daily", 1)])
def test_non_monthly_frequencies(freq, days):
    d = datetime(2026, 3, 1, tzinfo=UTC)
    assert next_after(d, freq) == d + timedelta(days=days)


def test_unknown_frequency_falls_back_to_monthly():
    d = datetime(2026, 3, 1, tzinfo=UTC)
    assert next_after(d, "fortnightly-ish") == datetime(2026, 4, 1, tzinfo=UTC)


# ------------------------------- due detection ------------------------------

def test_nothing_due_before_the_date():
    future = datetime(2026, 10, 1, tzinfo=UTC)
    assert due_occurrences(future, "monthly", 1, now=datetime(2026, 9, 3, tzinfo=UTC)) == []


def test_every_missed_month_is_reported_oldest_first():
    missed = due_occurrences(
        datetime(2026, 6, 1, tzinfo=UTC), "monthly", 1, now=datetime(2026, 9, 3, tzinfo=UTC)
    )
    assert [d.month for d in missed] == [6, 7, 8, 9]


def test_catch_up_is_capped():
    # A stream abandoned for years must produce a prompt, not thousands.
    missed = due_occurrences(
        datetime(2000, 1, 1, tzinfo=UTC), "monthly", 1, now=datetime(2026, 9, 3, tzinfo=UTC)
    )
    assert len(missed) == MAX_CATCH_UP


def test_naive_timestamps_are_treated_as_utc():
    # SQLite hands back naive datetimes; comparing them raw would raise.
    assert due_occurrences(datetime(2026, 6, 1), "monthly", 1, now=datetime(2026, 9, 3, tzinfo=UTC))


# --------------------------------- the API ----------------------------------

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
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _signed_in(client: AsyncClient):
    res = await client.post("/api/auth/register", json={
        "email": f"salary.{uuid.uuid4().hex[:8]}@example.com",
        "password": "Jhelum-Ferry-1892", "display_name": "Tester",
        "currency": "INR", "timezone": "Asia/Kolkata",
    })
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _account(client, headers):
    res = await client.post("/api/accounts", headers=headers, json={
        "name": "HDFC", "account_type": "asset", "currency": "INR", "opening_balance_minor": 0,
    })
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


async def _stream(client, headers, *, due_on, amount=95_000_00, source="Acme"):
    res = await client.post("/api/income/recurring", headers=headers, json={
        "source": source, "amount_minor": amount, "frequency": "monthly",
        "next_occurrence": due_on.isoformat(),
    })
    assert res.status_code == 201, res.text
    return res.json()


@pytest.mark.asyncio
async def test_a_future_stream_is_not_due(api_client):
    headers = await _signed_in(api_client)
    await _stream(api_client, headers, due_on=datetime.now(UTC) + timedelta(days=20))
    assert (await api_client.get("/api/income/recurring/due", headers=headers)).json() == []


@pytest.mark.asyncio
async def test_a_past_stream_is_reported_due(api_client):
    headers = await _signed_in(api_client)
    await _stream(api_client, headers, due_on=datetime.now(UTC) - timedelta(days=3))
    due = (await api_client.get("/api/income/recurring/due", headers=headers)).json()
    assert len(due) == 1
    assert due[0]["source"] == "Acme"
    assert due[0]["expected_amount_minor"] == 95_000_00
    assert due[0]["missed_count"] == 1


@pytest.mark.asyncio
async def test_anchor_day_defaults_to_the_setup_day(api_client):
    headers = await _signed_in(api_client)
    rule = await _stream(api_client, headers, due_on=datetime(2026, 1, 31, tzinfo=UTC))
    assert rule["anchor_day"] == 31


@pytest.mark.asyncio
async def test_confirming_records_the_income_and_advances_the_stream(api_client):
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    due_on = datetime.now(UTC) - timedelta(days=2)
    rule = await _stream(api_client, headers, due_on=due_on)

    res = await api_client.post(
        "/api/income/recurring/" + rule["id"] + "/confirm",
        headers=headers, json={"account_id": account},
    )
    assert res.status_code == 201, res.text
    tx = res.json()
    assert tx["transaction_type"] == "income"
    assert tx["amount_minor"] == 95_000_00
    assert "Acme" in tx["description"]

    # The money is really in the ledger, and the stream has moved on.
    assert (await api_client.get("/api/income/recurring/due", headers=headers)).json() == []
    accounts = (await api_client.get("/api/accounts", headers=headers)).json()
    assert accounts[0]["balance_paise"] == 95_000_00


@pytest.mark.asyncio
async def test_the_amount_can_differ_from_what_was_expected(api_client):
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    rule = await _stream(api_client, headers, due_on=datetime.now(UTC) - timedelta(days=1))

    res = await api_client.post(
        "/api/income/recurring/" + rule["id"] + "/confirm",
        headers=headers, json={"account_id": account, "amount_minor": 91_250_00},
    )
    assert res.json()["amount_minor"] == 91_250_00


@pytest.mark.asyncio
async def test_confirming_twice_does_not_pay_the_salary_twice(api_client):
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    rule = await _stream(api_client, headers, due_on=datetime.now(UTC) - timedelta(days=1))

    first = await api_client.post(
        "/api/income/recurring/" + rule["id"] + "/confirm",
        headers=headers, json={"account_id": account},
    )
    assert first.status_code == 201
    # A double tap or a retried request must not create a second month of pay.
    second = await api_client.post(
        "/api/income/recurring/" + rule["id"] + "/confirm",
        headers=headers, json={"account_id": account},
    )
    assert second.status_code == 400
    incomes = (await api_client.get("/api/income", headers=headers)).json()
    assert len(incomes) == 1


@pytest.mark.asyncio
async def test_three_missed_months_are_confirmed_one_at_a_time(api_client):
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=75)
    rule = await _stream(api_client, headers, due_on=start)

    seen = (await api_client.get("/api/income/recurring/due", headers=headers)).json()
    assert seen[0]["missed_count"] >= 2

    for _ in range(seen[0]["missed_count"]):
        res = await api_client.post(
            "/api/income/recurring/" + rule["id"] + "/confirm",
            headers=headers, json={"account_id": account},
        )
        assert res.status_code == 201, res.text

    assert (await api_client.get("/api/income/recurring/due", headers=headers)).json() == []
    assert len((await api_client.get("/api/income", headers=headers)).json()) == seen[0]["missed_count"]


@pytest.mark.asyncio
async def test_skipping_moves_on_without_recording_money(api_client):
    headers = await _signed_in(api_client)
    await _account(api_client, headers)
    rule = await _stream(api_client, headers, due_on=datetime.now(UTC) - timedelta(days=1))

    res = await api_client.post("/api/income/recurring/" + rule["id"] + "/skip", headers=headers)
    assert res.status_code == 200, res.text
    assert (await api_client.get("/api/income/recurring/due", headers=headers)).json() == []
    # Nothing was added to the ledger - the salary simply did not arrive.
    assert (await api_client.get("/api/income", headers=headers)).json() == []


@pytest.mark.asyncio
async def test_skip_all_clears_the_whole_backlog_in_one_go(api_client):
    """One tap per month left the card looking unchanged - a dead button."""
    headers = await _signed_in(api_client)
    await _account(api_client, headers)
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=200)
    rule = await _stream(api_client, headers, due_on=start)

    behind = (await api_client.get("/api/income/recurring/due", headers=headers)).json()[0]
    assert behind["missed_count"] >= 6

    res = await api_client.post(
        "/api/income/recurring/" + rule["id"] + "/skip",
        headers=headers, json={"all_missed": True},
    )
    assert res.status_code == 200, res.text
    assert (await api_client.get("/api/income/recurring/due", headers=headers)).json() == []
    # Still nothing in the ledger: skipping is not recording.
    assert (await api_client.get("/api/income", headers=headers)).json() == []


@pytest.mark.asyncio
async def test_skip_without_a_body_still_advances_one(api_client):
    """The endpoint took no body before; that call must keep working."""
    headers = await _signed_in(api_client)
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=70)
    rule = await _stream(api_client, headers, due_on=start)
    before = (await api_client.get("/api/income/recurring/due", headers=headers)).json()[0]

    res = await api_client.post("/api/income/recurring/" + rule["id"] + "/skip", headers=headers)
    assert res.status_code == 200, res.text
    after = (await api_client.get("/api/income/recurring/due", headers=headers)).json()[0]
    assert after["missed_count"] == before["missed_count"] - 1


@pytest.mark.asyncio
async def test_skip_all_lands_on_a_future_date(api_client):
    headers = await _signed_in(api_client)
    start = datetime.now(UTC) - timedelta(days=200)
    rule = await _stream(api_client, headers, due_on=start)

    res = await api_client.post(
        "/api/income/recurring/" + rule["id"] + "/skip",
        headers=headers, json={"all_missed": True},
    )
    nxt = datetime.fromisoformat(res.json()["next_occurrence"].replace("Z", "+00:00"))
    assert nxt > datetime.now(UTC)


@pytest.mark.asyncio
async def test_a_paused_stream_never_comes_due(api_client):
    headers = await _signed_in(api_client)
    rule = await _stream(api_client, headers, due_on=datetime.now(UTC) - timedelta(days=5))
    await api_client.patch(
        "/api/income/recurring/" + rule["id"], headers=headers, json={"active": False}
    )
    assert (await api_client.get("/api/income/recurring/due", headers=headers)).json() == []


@pytest.mark.asyncio
async def test_confirming_when_nothing_is_due_is_rejected(api_client):
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    rule = await _stream(api_client, headers, due_on=datetime.now(UTC) + timedelta(days=10))
    res = await api_client.post(
        "/api/income/recurring/" + rule["id"] + "/confirm",
        headers=headers, json={"account_id": account},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_another_users_stream_is_not_reachable(api_client):
    mine = await _signed_in(api_client)
    theirs = await _signed_in(api_client)
    account = await _account(api_client, theirs)
    rule = await _stream(api_client, mine, due_on=datetime.now(UTC) - timedelta(days=1))

    res = await api_client.post(
        "/api/income/recurring/" + rule["id"] + "/confirm",
        headers=theirs, json={"account_id": account},
    )
    assert res.status_code == 404
    assert (await api_client.get("/api/income/recurring/due", headers=theirs)).json() == []
