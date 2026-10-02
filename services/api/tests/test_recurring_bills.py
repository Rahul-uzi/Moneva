"""A monthly bill has to come back next month.

`recurrence` was stored, shown as a pill on the card, and acted on by nothing.
Paying a bill set its status to "paid" and left `due_date` exactly where it
was, so a monthly subscription was settled once and then sat Paid forever
while the money kept leaving the account every month. The user's Spotify
autopay - taken on the 3rd, mandate running to 2036 - would have been marked
paid once and never prompted again.

The rule these tests pin down: settling a bill that repeats produces the NEXT
one, anchored to the due date rather than to the day it happened to be paid.
Settling a one-off still finishes it for good.
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
UTC = timezone.utc


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
        "email": f"bills.{uuid.uuid4().hex[:8]}@example.com",
        "password": "Jhelum-Ferry-1892", "display_name": "Tester",
        "currency": "INR", "timezone": "Asia/Kolkata",
    })
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _account(client, headers):
    res = await client.post("/api/accounts", headers=headers, json={
        "name": "SBI", "account_type": "asset", "currency": "INR", "opening_balance_minor": 0,
    })
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


async def _bill(client, headers, *, due_on, recurrence="monthly", amount=6900, name="Spotify"):
    res = await client.post("/api/bills", headers=headers, json={
        "name": name, "amount_minor": amount, "currency": "INR",
        "due_date": due_on.isoformat(), "recurrence": recurrence,
    })
    assert res.status_code in (200, 201), res.text
    return res.json()


async def _pay(client, headers, bill_id, account_id, *, when):
    res = await client.post(f"/api/bills/{bill_id}/pay", headers=headers, json={
        "client_mutation_id": str(uuid.uuid4()),
        "account_id": account_id,
        "payment_date": when.isoformat(),
        "device_id": "test",
    })
    assert res.status_code == 200, res.text
    return res.json()


async def _read(client, headers, bill_id):
    res = await client.get(f"/api/bills/{bill_id}", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.asyncio
async def test_a_monthly_bill_comes_back_next_month(api_client):
    """The whole point. Due 3 Oct, paid, now due 3 Nov - not Paid forever."""
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 10, 3, tzinfo=UTC))

    await _pay(api_client, headers, bill["id"], account, when=datetime(2026, 10, 3, 9, 0, tzinfo=UTC))

    after = await _read(api_client, headers, bill["id"])
    assert after["due_date"].startswith("2026-11-03"), after["due_date"]
    assert after["status"] == "upcoming"


@pytest.mark.asyncio
async def test_the_payment_still_lands_in_the_ledger(api_client):
    """Rolling the date forward must not cost the expense it was paid with."""
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 10, 3, tzinfo=UTC))

    tx = await _pay(api_client, headers, bill["id"], account, when=datetime(2026, 10, 3, tzinfo=UTC))
    assert tx["amount_minor"] == 6900
    assert tx["transaction_type"] == "expense"
    assert "Spotify" in tx["description"]


@pytest.mark.asyncio
async def test_the_next_date_follows_the_due_date_not_the_payment(api_client):
    """Billed on the 3rd, paid late on the 9th - still billed on the 3rd.

    Anchoring to the payment would walk the date later every month until a
    subscription taken on the 3rd was being expected on the 20th.
    """
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 10, 3, tzinfo=UTC))

    await _pay(api_client, headers, bill["id"], account, when=datetime(2026, 10, 9, tzinfo=UTC))

    after = await _read(api_client, headers, bill["id"])
    assert after["due_date"].startswith("2026-11-03"), after["due_date"]


@pytest.mark.asyncio
async def test_a_month_end_bill_does_not_drift(api_client):
    """31 Jan -> 28 Feb, and the 31st must come back in March."""
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 1, 31, tzinfo=UTC))

    await _pay(api_client, headers, bill["id"], account, when=datetime(2026, 1, 31, tzinfo=UTC))
    feb = await _read(api_client, headers, bill["id"])
    assert feb["due_date"].startswith("2026-02-28"), feb["due_date"]

    await _pay(api_client, headers, bill["id"], account, when=datetime(2026, 2, 28, tzinfo=UTC))
    mar = await _read(api_client, headers, bill["id"])
    assert mar["due_date"].startswith("2026-03-31"), mar["due_date"]


@pytest.mark.asyncio
async def test_a_long_overdue_bill_lands_in_the_future(api_client):
    """Advancing by one period alone would leave it in the past again."""
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 1, 3, tzinfo=UTC))

    await _pay(api_client, headers, bill["id"], account, when=datetime(2026, 6, 10, tzinfo=UTC))

    after = await _read(api_client, headers, bill["id"])
    assert after["due_date"].startswith("2026-07-03"), after["due_date"]
    assert after["status"] == "upcoming"


@pytest.mark.asyncio
async def test_a_one_time_bill_is_finished_when_paid(api_client):
    """The opposite case, and it must stay the opposite case."""
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 10, 3, tzinfo=UTC),
                       recurrence="one-time", name="Deposit")

    await _pay(api_client, headers, bill["id"], account, when=datetime(2026, 10, 3, tzinfo=UTC))

    after = await _read(api_client, headers, bill["id"])
    assert after["status"] == "paid"
    assert after["due_date"].startswith("2026-10-03")


@pytest.mark.asyncio
async def test_a_bill_with_no_recurrence_is_finished_when_paid(api_client):
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 10, 3, tzinfo=UTC),
                       recurrence=None, name="One off")

    await _pay(api_client, headers, bill["id"], account, when=datetime(2026, 10, 3, tzinfo=UTC))

    after = await _read(api_client, headers, bill["id"])
    assert after["status"] == "paid"


@pytest.mark.asyncio
async def test_a_yearly_bill_rolls_a_year(api_client):
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 10, 3, tzinfo=UTC),
                       recurrence="yearly", name="Domain")

    await _pay(api_client, headers, bill["id"], account, when=datetime(2026, 10, 3, tzinfo=UTC))

    after = await _read(api_client, headers, bill["id"])
    assert after["due_date"].startswith("2027-10-03"), after["due_date"]


@pytest.mark.asyncio
async def test_a_weekly_bill_rolls_seven_days(api_client):
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 10, 3, tzinfo=UTC),
                       recurrence="weekly", name="Tiffin")

    await _pay(api_client, headers, bill["id"], account, when=datetime(2026, 10, 3, tzinfo=UTC))

    after = await _read(api_client, headers, bill["id"])
    assert after["due_date"].startswith("2026-10-10"), after["due_date"]


@pytest.mark.asyncio
async def test_paying_twelve_months_walks_the_whole_year(api_client):
    """The shape the user actually cares about: it keeps coming back."""
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 10, 3, tzinfo=UTC))

    seen = []
    for _ in range(12):
        current = await _read(api_client, headers, bill["id"])
        seen.append(current["due_date"][:10])
        paid_on = datetime.fromisoformat(current["due_date"].replace("Z", "+00:00"))
        await _pay(api_client, headers, bill["id"], account, when=paid_on)

    assert seen[:3] == ["2026-10-03", "2026-11-03", "2026-12-03"]
    assert seen[-1] == "2027-09-03"
    # Still live at the end of the year, not stranded on "paid".
    assert (await _read(api_client, headers, bill["id"]))["status"] == "upcoming"


@pytest.mark.asyncio
async def test_paying_the_same_bill_twice_with_one_id_is_idempotent(api_client):
    """The existing guarantee, re-checked now that paying also moves a date.

    Without this the retry of a request that already succeeded would roll the
    bill forward a second time and quietly skip a month.
    """
    headers = await _signed_in(api_client)
    account = await _account(api_client, headers)
    bill = await _bill(api_client, headers, due_on=datetime(2026, 10, 3, tzinfo=UTC))

    body = {
        "client_mutation_id": str(uuid.uuid4()),
        "account_id": account,
        "payment_date": datetime(2026, 10, 3, tzinfo=UTC).isoformat(),
        "device_id": "test",
    }
    first = await api_client.post(f"/api/bills/{bill['id']}/pay", headers=headers, json=body)
    second = await api_client.post(f"/api/bills/{bill['id']}/pay", headers=headers, json=body)
    assert first.status_code == 200 and second.status_code == 200, second.text
    assert first.json()["id"] == second.json()["id"]

    after = await _read(api_client, headers, bill["id"])
    assert after["due_date"].startswith("2026-11-03"), "a retry moved the bill a second time"
