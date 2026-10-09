"""Money lent to a person, and getting it back.

A debt row is a REMINDER, not money. These tests hold that line in both
directions: the figures have to add up and settle correctly, and recording a
debt must not touch a single balance.
"""
import uuid

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


async def _signed_in(api_client: AsyncClient, email: str | None = None) -> dict:
    email = email or f"debt.{uuid.uuid4().hex[:8]}@example.com"
    res = await api_client.post("/api/auth/register", json={
        "email": email,
        "password": "Jhelum-Ferry-1892",
        "display_name": "Debt Tester",
        "currency": "INR",
        "timezone": "Asia/Kolkata",
    })
    assert res.status_code in (200, 201), res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_lend_and_get_it_all_back(api_client: AsyncClient):
    headers = await _signed_in(api_client)

    created = await api_client.post("/api/debts", json={
        "person": "Vishal",
        "amount_minor": 50000,
        "note": "Helped him out",
    }, headers=headers)
    assert created.status_code == 201, created.text
    debt = created.json()
    assert debt["person"] == "Vishal"
    assert debt["direction"] == "owed_to_me"
    assert debt["outstanding_minor"] == 50000
    assert debt["settled_at"] is None

    # Open debts are what the user is asked about, so they are the default.
    listed = (await api_client.get("/api/debts", headers=headers)).json()
    assert [d["person"] for d in listed] == ["Vishal"]

    repaid = await api_client.post(f"/api/debts/{debt['id']}/repay", json={}, headers=headers)
    assert repaid.status_code == 200, repaid.text
    assert repaid.json()["outstanding_minor"] == 0
    assert repaid.json()["settled_at"] is not None

    # Settled, so it stops being a reminder - but it is not destroyed, because
    # "he paid me back" is worth being able to see.
    assert (await api_client.get("/api/debts", headers=headers)).json() == []
    kept = (await api_client.get("/api/debts?include_settled=true", headers=headers)).json()
    assert len(kept) == 1


@pytest.mark.asyncio
async def test_part_of_it_comes_back(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    debt = (await api_client.post("/api/debts", json={
        "person": "Gautam", "amount_minor": 50000,
    }, headers=headers)).json()

    half = await api_client.post(
        f"/api/debts/{debt['id']}/repay", json={"amount_minor": 20000}, headers=headers
    )
    assert half.json()["outstanding_minor"] == 30000
    assert half.json()["settled_at"] is None

    rest = await api_client.post(
        f"/api/debts/{debt['id']}/repay", json={"amount_minor": 30000}, headers=headers
    )
    assert rest.json()["outstanding_minor"] == 0
    assert rest.json()["settled_at"] is not None


@pytest.mark.asyncio
async def test_a_second_repayment_cannot_overpay_or_reopen(api_client: AsyncClient):
    """A retried tap must not make the debt go negative or come back."""
    headers = await _signed_in(api_client)
    debt = (await api_client.post("/api/debts", json={
        "person": "Vishal", "amount_minor": 50000,
    }, headers=headers)).json()

    await api_client.post(f"/api/debts/{debt['id']}/repay", json={}, headers=headers)
    again = await api_client.post(f"/api/debts/{debt['id']}/repay", json={}, headers=headers)
    assert again.status_code == 400

    still = (await api_client.get("/api/debts?include_settled=true", headers=headers)).json()[0]
    assert still["repaid_minor"] == 50000
    assert still["outstanding_minor"] == 0


@pytest.mark.asyncio
async def test_handed_back_more_than_was_lent(api_client: AsyncClient):
    """Clamped, not refused - otherwise the debt can never be closed."""
    headers = await _signed_in(api_client)
    debt = (await api_client.post("/api/debts", json={
        "person": "Rounding", "amount_minor": 50000,
    }, headers=headers)).json()

    res = await api_client.post(
        f"/api/debts/{debt['id']}/repay", json={"amount_minor": 60000}, headers=headers
    )
    assert res.json()["repaid_minor"] == 50000
    assert res.json()["outstanding_minor"] == 0


@pytest.mark.asyncio
async def test_lending_the_same_person_twice_is_two_debts(api_client: AsyncClient):
    """Merging them would quietly halve what is owed."""
    headers = await _signed_in(api_client)
    for _ in range(2):
        res = await api_client.post("/api/debts", json={
            "person": "Vishal", "amount_minor": 50000,
        }, headers=headers)
        assert res.status_code == 201

    listed = (await api_client.get("/api/debts", headers=headers)).json()
    assert len(listed) == 2
    assert sum(d["outstanding_minor"] for d in listed) == 100000


@pytest.mark.asyncio
async def test_correcting_the_amount_reopens_or_closes(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    debt = (await api_client.post("/api/debts", json={
        "person": "Vishal", "amount_minor": 50000,
    }, headers=headers)).json()
    await api_client.post(f"/api/debts/{debt['id']}/repay", json={}, headers=headers)

    # It was actually 700, not 500 - so 200 is still owed and the debt is open.
    bumped = await api_client.patch(
        f"/api/debts/{debt['id']}", json={"amount_minor": 70000}, headers=headers
    )
    assert bumped.json()["outstanding_minor"] == 20000
    assert bumped.json()["settled_at"] is None
    assert len((await api_client.get("/api/debts", headers=headers)).json()) == 1


@pytest.mark.asyncio
async def test_recording_a_debt_moves_no_money(api_client: AsyncClient):
    """The whole design rests on this: a debt is a note, not a balance.

    The rupees left the bank when they were lent and the ledger recorded that
    already. If this row also counted, the money would exist twice - and once
    more when the repayment arrives as income.
    """
    headers = await _signed_in(api_client)
    acc = (await api_client.post("/api/accounts", json={
        "name": "Bank", "account_type": "asset", "opening_balance_minor": 100000,
    }, headers=headers)).json()

    before = (await api_client.get(f"/api/accounts/{acc['id']}", headers=headers)).json()
    # Named explicitly, not via .get: a renamed field would otherwise compare
    # None to None and this test would pass while proving nothing.
    assert before["balance_paise"] == 100000

    await api_client.post("/api/debts", json={
        "person": "Vishal", "amount_minor": 50000,
    }, headers=headers)
    after = (await api_client.get(f"/api/accounts/{acc['id']}", headers=headers)).json()

    assert after["balance_paise"] == 100000
    txs = (await api_client.get("/api/transactions", headers=headers)).json()
    assert txs == [] or len(txs) == 0


@pytest.mark.asyncio
async def test_one_user_cannot_see_or_settle_anothers_debt(api_client: AsyncClient):
    mine = await _signed_in(api_client)
    theirs = await _signed_in(api_client)

    debt = (await api_client.post("/api/debts", json={
        "person": "Vishal", "amount_minor": 50000,
    }, headers=mine)).json()

    assert (await api_client.get("/api/debts", headers=theirs)).json() == []
    assert (await api_client.post(
        f"/api/debts/{debt['id']}/repay", json={}, headers=theirs
    )).status_code == 404
    assert (await api_client.patch(
        f"/api/debts/{debt['id']}", json={"person": "Hijacked"}, headers=theirs
    )).status_code == 404
    assert (await api_client.delete(
        f"/api/debts/{debt['id']}", headers=theirs
    )).status_code == 404


@pytest.mark.asyncio
async def test_rejects_a_blank_name_and_a_zero_amount(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    assert (await api_client.post("/api/debts", json={
        "person": "   ", "amount_minor": 50000,
    }, headers=headers)).status_code in (400, 422)
    assert (await api_client.post("/api/debts", json={
        "person": "Vishal", "amount_minor": 0,
    }, headers=headers)).status_code in (400, 422)


@pytest.mark.asyncio
async def test_money_the_user_owes_is_the_other_direction(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    res = await api_client.post("/api/debts", json={
        "person": "Mum", "amount_minor": 200000, "direction": "i_owe",
    }, headers=headers)
    assert res.status_code == 201
    assert res.json()["direction"] == "i_owe"
