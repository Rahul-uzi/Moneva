"""
Budget responses must carry the category they cap.

Without category_name the home page had nothing to label a budget with and
rendered the literal placeholder "Category" on every card, so two budgets were
indistinguishable.
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
    email = f"budget.{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post("/api/auth/register", json={
        "email": email, "password": "Budget@2026!!", "display_name": "Tester",
        "currency": "INR", "timezone": "Asia/Kolkata",
    })
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.mark.asyncio
async def test_listed_budgets_name_their_category(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    cats = {c["name"]: c["id"] for c in (await api_client.get("/api/categories", headers=headers)).json()}
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    for category in ("Food & Dining", "Fuel"):
        res = await api_client.post("/api/budgets", headers=headers, json={
            "category_id": cats[category], "limit_amount_minor": 500_000,
            "period": "monthly", "start_date": start.isoformat(),
            "end_date": (start + timedelta(days=27)).isoformat(),
        })
        assert res.status_code in (200, 201), res.text

    listed = (await api_client.get("/api/budgets", headers=headers)).json()
    names = sorted(b.get("category_name") for b in listed)
    assert names == ["Food & Dining", "Fuel"], listed
    # The bug: every card showed the same placeholder because this was missing.
    assert all(b.get("category_name") for b in listed)


@pytest.mark.asyncio
async def test_budget_spending_is_reported_against_the_limit(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    cats = {c["name"]: c["id"] for c in (await api_client.get("/api/categories", headers=headers)).json()}
    acc = (await api_client.post("/api/accounts", headers=headers, json={
        "name": "HDFC", "account_type": "asset",
        "opening_balance_minor": 10_000_000, "currency": "INR",
    })).json()
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    await api_client.post("/api/budgets", headers=headers, json={
        "category_id": cats["Fuel"], "limit_amount_minor": 500_000,
        "period": "monthly", "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=27)).isoformat(),
    })
    await api_client.post("/api/transactions", headers=headers, json={
        "client_mutation_id": str(uuid.uuid4()), "account_id": acc["id"],
        "category_id": cats["Fuel"], "transaction_type": "expense",
        "amount_minor": 600_000, "currency": "INR", "description": "Petrol",
        "transaction_date": now.isoformat(), "device_id": "test",
    })

    budget = (await api_client.get("/api/budgets", headers=headers)).json()[0]
    assert budget["category_name"] == "Fuel"
    assert budget["spent_amount_minor"] == 600_000
    assert budget["remaining_amount_minor"] == -100_000


@pytest.mark.asyncio
async def test_transactions_can_be_limited(api_client: AsyncClient):
    """
    The dashboard shows five rows. Without a limit it downloaded the user's
    entire transaction history and discarded all but five.
    """
    headers = await _signed_in(api_client)
    cats = {c["name"]: c["id"] for c in (await api_client.get("/api/categories", headers=headers)).json()}
    acc = (await api_client.post("/api/accounts", headers=headers, json={
        "name": "HDFC", "account_type": "asset",
        "opening_balance_minor": 10_000_000, "currency": "INR",
    })).json()
    now = datetime.now(timezone.utc)
    for i in range(12):
        await api_client.post("/api/transactions", headers=headers, json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": acc["id"],
            "category_id": cats["Fuel"], "transaction_type": "expense",
            "amount_minor": 1_000 + i, "currency": "INR", "description": f"Txn {i}",
            "transaction_date": (now - timedelta(hours=i)).isoformat(), "device_id": "test",
        })

    assert len((await api_client.get("/api/transactions", headers=headers)).json()) == 12
    limited = (await api_client.get("/api/transactions?limit=5", headers=headers)).json()
    assert len(limited) == 5

    # Newest first, so the dashboard shows the most recent activity.
    assert limited[0]["description"] == "Txn 0"
    assert limited[4]["description"] == "Txn 4"


@pytest.mark.asyncio
async def test_transaction_offset_pages_without_repeating(api_client: AsyncClient):
    headers = await _signed_in(api_client)
    cats = {c["name"]: c["id"] for c in (await api_client.get("/api/categories", headers=headers)).json()}
    acc = (await api_client.post("/api/accounts", headers=headers, json={
        "name": "HDFC", "account_type": "asset",
        "opening_balance_minor": 10_000_000, "currency": "INR",
    })).json()
    now = datetime.now(timezone.utc)
    for i in range(6):
        await api_client.post("/api/transactions", headers=headers, json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": acc["id"],
            "category_id": cats["Fuel"], "transaction_type": "expense",
            "amount_minor": 1_000 + i, "currency": "INR", "description": f"Row {i}",
            "transaction_date": (now - timedelta(hours=i)).isoformat(), "device_id": "test",
        })

    first = (await api_client.get("/api/transactions?limit=3", headers=headers)).json()
    second = (await api_client.get("/api/transactions?limit=3&offset=3", headers=headers)).json()
    ids = {t["id"] for t in first} | {t["id"] for t in second}
    assert len(ids) == 6, "pages overlapped"


@pytest.mark.asyncio
async def test_transaction_limit_is_bounded(api_client: AsyncClient):
    """An unbounded limit would defeat the point."""
    headers = await _signed_in(api_client)
    # This app maps request validation failures to 400 rather than FastAPI's 422.
    assert (await api_client.get("/api/transactions?limit=0", headers=headers)).status_code == 400
    assert (await api_client.get("/api/transactions?limit=5000", headers=headers)).status_code == 400
