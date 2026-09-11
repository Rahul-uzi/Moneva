"""Correcting a balance that has drifted from the real one.

This app has no live link to a bank. Its balance is the sum of the events it
managed to see, so anything it missed - cash, a payment whose alert never
arrived, a wrong opening figure - leaves the number quietly wrong. Across the
whole category that is one of the loudest complaints, and it is never "it does
not sync"; it is "my balance is wrong and I cannot fix it".

The correction is a ledger event, not a silent rewrite of the opening balance,
so the history keeps showing what was corrected and when. The subtle part - and
the reason for a flag rather than an ordinary row - is that it must move the
balance WITHOUT being counted as spending. A drift of a few thousand rupees
booked as an expense would appear as the largest purchase of the month and
wreck every budget, which is precisely the class of bug this feature exists to
repair.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import hash_password
from app.db.database import get_db
from app.models.models import Account, Base, Category, Transaction, User
from main import app

pytestmark = pytest.mark.asyncio

EMAIL = "reconcile@example.com"
PASSWORD = "ReconcilePass123"
OPENING = 100_000          # Rs 1,000.00


@pytest_asyncio.fixture
async def api():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async def _db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _db

    user_id, account_id, category_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    async with factory() as session:
        session.add(User(id=user_id, email=EMAIL, password_hash=hash_password(PASSWORD),
                         display_name="Reconciler", currency="INR"))
        session.add(Account(id=account_id, user_id=user_id, name="HDFC Bank",
                            account_type="asset", currency="INR",
                            opening_balance_minor=OPENING))
        session.add(Category(id=category_id, user_id=user_id, name="Food & Dining",
                             type="expense"))
        await session.commit()

        session.add(Transaction(
            client_mutation_id=uuid.uuid4(), user_id=user_id, account_id=account_id,
            category_id=category_id, transaction_type="expense", amount_minor=25_000,
            currency="INR", description="Swiggy",
            transaction_date=datetime.now(timezone.utc) - timedelta(days=1),
            device_id="test"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
        yield client, factory, str(account_id), str(category_id)

    app.dependency_overrides.clear()


async def _balance(client, account_id):
    res = await client.get("/api/finance/account-balances")
    assert res.status_code == 200, res.text
    for row in res.json():
        if str(row["account_id"]) == account_id:
            return row["balance_minor"]
    raise AssertionError("account missing from balances")


class TestCorrectingADriftedBalance:
    async def test_the_starting_point(self, api):
        client, _f, account_id, _c = api
        # Rs 1,000 opening less a Rs 250 expense.
        assert await _balance(client, account_id) == OPENING - 25_000

    async def test_a_shortfall_is_added(self, api):
        """The app under-counted: it missed money coming in."""
        client, _f, account_id, _c = api
        res = await client.post(f"/api/accounts/{account_id}/reconcile",
                                json={"actual_balance_minor": 90_000})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["previous_balance_minor"] == 75_000
        assert body["difference_minor"] == 15_000
        assert body["adjustment_transaction_id"]
        assert await _balance(client, account_id) == 90_000

    async def test_an_overcount_is_removed(self, api):
        """The app over-counted: the real balance is lower, usually missed cash."""
        client, _f, account_id, _c = api
        res = await client.post(f"/api/accounts/{account_id}/reconcile",
                                json={"actual_balance_minor": 60_000})
        assert res.status_code == 200, res.text
        assert res.json()["difference_minor"] == -15_000
        assert await _balance(client, account_id) == 60_000

    async def test_a_matching_balance_writes_nothing(self, api):
        client, factory, account_id, _c = api
        res = await client.post(f"/api/accounts/{account_id}/reconcile",
                                json={"actual_balance_minor": 75_000})
        assert res.status_code == 200
        assert res.json()["difference_minor"] == 0
        assert res.json()["adjustment_transaction_id"] is None
        async with factory() as session:
            rows = (await session.execute(select(Transaction))).scalars().all()
        # Still just the Swiggy expense - no empty correction row.
        assert len(rows) == 1

    async def test_a_negative_balance_is_allowed(self, api):
        """A credit card or an overdraft is legitimately below zero."""
        client, _f, account_id, _c = api
        res = await client.post(f"/api/accounts/{account_id}/reconcile",
                                json={"actual_balance_minor": -50_000})
        assert res.status_code == 200, res.text
        assert await _balance(client, account_id) == -50_000

    async def test_two_corrections_both_stay_in_history(self, api):
        """Reconciling twice should show it happened twice, and by how much."""
        client, factory, account_id, _c = api
        await client.post(f"/api/accounts/{account_id}/reconcile",
                          json={"actual_balance_minor": 90_000})
        await client.post(f"/api/accounts/{account_id}/reconcile",
                          json={"actual_balance_minor": 80_000})
        async with factory() as session:
            adjustments = (await session.execute(
                select(Transaction).where(Transaction.is_adjustment.is_(True)))).scalars().all()
        assert len(adjustments) == 2
        assert await _balance(client, account_id) == 80_000

    async def test_the_opening_balance_is_never_rewritten(self, api):
        """The ledger stays the single source of truth."""
        client, factory, account_id, _c = api
        await client.post(f"/api/accounts/{account_id}/reconcile",
                          json={"actual_balance_minor": 500_000})
        async with factory() as session:
            account = (await session.execute(
                select(Account).where(Account.id == uuid.UUID(account_id)))).scalar_one()
        assert account.opening_balance_minor == OPENING

    async def test_someone_elses_account_cannot_be_reconciled(self, api):
        client, _f, _a, _c = api
        res = await client.post(f"/api/accounts/{uuid.uuid4()}/reconcile",
                                json={"actual_balance_minor": 1})
        assert res.status_code == 404


class TestACorrectionIsNotSpending:
    """The point of the flag. Get this wrong and reconciling ruins the budgets."""

    async def _spending(self, client):
        res = await client.get("/api/finance/summary")
        assert res.status_code == 200, res.text
        return res.json()

    async def test_a_downward_correction_is_not_counted_as_an_expense(self, api):
        client, _f, account_id, _c = api
        before = await self._spending(client)
        await client.post(f"/api/accounts/{account_id}/reconcile",
                          json={"actual_balance_minor": 20_000, "note": "missed cash spends"})
        after = await self._spending(client)
        assert after["expense_minor"] == before["expense_minor"], (
            "the correction was counted as spending - it would show as the "
            "largest purchase of the month and wreck every budget")

    async def test_an_upward_correction_is_not_counted_as_income(self, api):
        client, _f, account_id, _c = api
        before = await self._spending(client)
        await client.post(f"/api/accounts/{account_id}/reconcile",
                          json={"actual_balance_minor": 500_000})
        after = await self._spending(client)
        assert after["income_minor"] == before["income_minor"], (
            "the correction was counted as income - salary-usage and every "
            "'left to spend' figure would be wrong")

    async def test_it_stays_out_of_the_category_breakdown(self, api):
        client, _f, account_id, _c = api
        await client.post(f"/api/accounts/{account_id}/reconcile",
                          json={"actual_balance_minor": 10_000})
        res = await client.get("/api/finance/analytics/category-breakdown")
        assert res.status_code == 200, res.text
        total = sum(row.get("total_minor", row.get("amount_minor", 0)) for row in res.json())
        assert total == 25_000, f"the correction leaked into the breakdown: {res.json()}"

    async def test_it_does_not_eat_into_a_budget(self, api):
        client, _f, account_id, category_id = api
        now = datetime.now(timezone.utc)
        made = await client.post("/api/budgets", json={
            "category_id": category_id, "limit_amount_minor": 100_000, "period": "monthly",
            "start_date": (now - timedelta(days=5)).isoformat(),
            "end_date": (now + timedelta(days=25)).isoformat()})
        assert made.status_code in (200, 201), made.text

        await client.post(f"/api/accounts/{account_id}/reconcile",
                          json={"actual_balance_minor": 5_000})

        res = await client.get("/api/budgets")
        assert res.status_code == 200
        row = res.json()[0]
        spent = row.get("spent_amount_minor", row.get("spent_minor"))
        assert spent == 25_000, (
            f"the correction was charged to the budget: spent={spent}")

    async def test_it_still_moves_the_balance(self, api):
        """The other half: excluded from spending, but never from the balance."""
        client, _f, account_id, _c = api
        await client.post(f"/api/accounts/{account_id}/reconcile",
                          json={"actual_balance_minor": 42_000})
        assert await _balance(client, account_id) == 42_000
