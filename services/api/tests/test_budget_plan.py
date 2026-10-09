"""Saving the assistant's spending plan into the Plan tab.

The plan arrives as one decision - "yes, use this plan" - so it has to land as
one: completely or not at all, and never as a second budget beside one the
user already had.
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
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _user(api_client: AsyncClient) -> dict:
    res = await api_client.post("/api/auth/register", json={
        "email": f"plan.{uuid.uuid4().hex[:8]}@example.com",
        "password": "Jhelum-Ferry-1892",
        "display_name": "Plan Tester",
        "currency": "INR",
        "timezone": "Asia/Kolkata",
    })
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _categories(api_client: AsyncClient, headers: dict) -> dict:
    cats = (await api_client.get("/api/categories", headers=headers)).json()
    return {c["name"]: c for c in cats}


@pytest.mark.asyncio
async def test_a_plan_becomes_this_months_budgets(api_client: AsyncClient):
    headers = await _user(api_client)
    cats = await _categories(api_client, headers)

    res = await api_client.post("/api/budgets/plan", json={"items": [
        {"category_id": cats["Food & Dining"]["id"], "limit_amount_minor": 400000},
        {"category_id": cats["Groceries"]["id"], "limit_amount_minor": 250000},
    ]}, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["created"], body["updated"]) == (2, 0)
    assert {b["category_name"] for b in body["budgets"]} == {"Food & Dining", "Groceries"}

    listed = (await api_client.get("/api/budgets", headers=headers)).json()
    assert len(listed) == 2


@pytest.mark.asyncio
async def test_saying_yes_twice_does_not_duplicate(api_client: AsyncClient):
    """The trap this endpoint exists for: two budgets counting the same money."""
    headers = await _user(api_client)
    cats = await _categories(api_client, headers)
    food = cats["Food & Dining"]["id"]

    await api_client.post("/api/budgets/plan", json={"items": [
        {"category_id": food, "limit_amount_minor": 400000},
    ]}, headers=headers)
    again = await api_client.post("/api/budgets/plan", json={"items": [
        {"category_id": food, "limit_amount_minor": 300000},
    ]}, headers=headers)

    assert (again.json()["created"], again.json()["updated"]) == (0, 1)
    listed = (await api_client.get("/api/budgets", headers=headers)).json()
    assert len(listed) == 1
    assert listed[0]["limit_amount_minor"] == 300000


@pytest.mark.asyncio
async def test_a_budget_the_user_made_keeps_its_dates(api_client: AsyncClient):
    """Only the limit changes; the user's own period is theirs."""
    headers = await _user(api_client)
    cats = await _categories(api_client, headers)
    food = cats["Food & Dining"]["id"]

    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    mine = (await api_client.post("/api/budgets", json={
        "category_id": food,
        "limit_amount_minor": 100000,
        "period": "monthly",
        "start_date": (now - timedelta(days=3)).isoformat(),
        "end_date": (now + timedelta(days=20)).isoformat(),
    }, headers=headers)).json()

    await api_client.post("/api/budgets/plan", json={"items": [
        {"category_id": food, "limit_amount_minor": 500000},
    ]}, headers=headers)

    listed = (await api_client.get("/api/budgets", headers=headers)).json()
    assert len(listed) == 1
    assert listed[0]["id"] == mine["id"]
    assert listed[0]["limit_amount_minor"] == 500000
    assert listed[0]["start_date"][:10] == mine["start_date"][:10]


@pytest.mark.asyncio
async def test_one_bad_category_saves_nothing(api_client: AsyncClient):
    headers = await _user(api_client)
    cats = await _categories(api_client, headers)

    res = await api_client.post("/api/budgets/plan", json={"items": [
        {"category_id": cats["Food & Dining"]["id"], "limit_amount_minor": 400000},
        {"category_id": str(uuid.uuid4()), "limit_amount_minor": 100000},
    ]}, headers=headers)
    assert res.status_code == 404
    assert (await api_client.get("/api/budgets", headers=headers)).json() == []


@pytest.mark.asyncio
async def test_income_cannot_be_budgeted(api_client: AsyncClient):
    headers = await _user(api_client)
    cats = await _categories(api_client, headers)

    res = await api_client.post("/api/budgets/plan", json={"items": [
        {"category_id": cats["Salary"]["id"], "limit_amount_minor": 100000},
    ]}, headers=headers)
    assert res.status_code == 400
    assert (await api_client.get("/api/budgets", headers=headers)).json() == []


@pytest.mark.asyncio
async def test_another_users_category_is_refused(api_client: AsyncClient):
    mine = await _user(api_client)
    theirs = await _user(api_client)
    # A category the other user created, which is theirs alone.
    their_cat = (await api_client.post("/api/categories", json={
        "name": "Their private one", "type": "expense",
    }, headers=theirs)).json()

    res = await api_client.post("/api/budgets/plan", json={"items": [
        {"category_id": their_cat["id"], "limit_amount_minor": 100000},
    ]}, headers=mine)
    assert res.status_code == 404
    assert (await api_client.get("/api/budgets", headers=mine)).json() == []


@pytest.mark.asyncio
async def test_the_same_category_twice_in_one_plan_is_refused(api_client: AsyncClient):
    headers = await _user(api_client)
    food = (await _categories(api_client, headers))["Food & Dining"]["id"]
    res = await api_client.post("/api/budgets/plan", json={"items": [
        {"category_id": food, "limit_amount_minor": 1000},
        {"category_id": food, "limit_amount_minor": 2000},
    ]}, headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_an_empty_plan_is_refused(api_client: AsyncClient):
    headers = await _user(api_client)
    res = await api_client.post("/api/budgets/plan", json={"items": []}, headers=headers)
    assert res.status_code in (400, 422)
