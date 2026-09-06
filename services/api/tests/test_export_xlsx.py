"""The .xlsx export, on an account that actually has records in it.

The export had no test at all, and it returned 500 for anyone who had ever
added a bill: the Bills sheet read `b.frequency`, but the column on the model
is `recurrence`. An empty account exported fine, which is why nothing noticed.

So the point of this test is the fixture, not the assertions - every sheet the
exporter writes needs at least one row behind it, or the attribute that is
wrong is never read.
"""
import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import hash_password
from app.db.database import get_db
from app.models.models import (
    Account, Base, Bill, Budget, Category, RecurringIncome, SavingsGoal, Transaction, User,
)
from main import app

PASSWORD = "ExportPass123!"
NOW = datetime.now(timezone.utc)


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
        session.add(User(id=user_id, email="exporter@example.com",
                         password_hash=hash_password(PASSWORD), display_name="Exporter",
                         currency="INR"))
        session.add(Account(id=account_id, user_id=user_id, name="Everyday",
                            account_type="asset", opening_balance_minor=500000, currency="INR"))
        session.add(Category(id=category_id, user_id=user_id, name="Utilities", type="expense"))
        # Committed first: everything below points at these three by id, and
        # SQLite enforces the foreign keys.
        await session.commit()

        session.add(Transaction(client_mutation_id=uuid.uuid4(), user_id=user_id,
                                account_id=account_id, category_id=category_id,
                                transaction_type="expense", amount_minor=45000, currency="INR",
                                description="Electricity", transaction_date=NOW,
                                device_id="test-device"))
        session.add(Budget(user_id=user_id, category_id=category_id, limit_amount_minor=200000,
                           period="monthly", start_date=NOW, end_date=NOW + timedelta(days=30)))
        session.add(SavingsGoal(user_id=user_id, name="Laptop", target_amount_minor=8000000,
                                status="active", target_date=NOW + timedelta(days=200)))
        session.add(Bill(user_id=user_id, name="Broadband", amount_minor=79900, currency="INR",
                         due_date=NOW + timedelta(days=5), recurrence="monthly",
                         category_id=category_id, status="upcoming"))
        session.add(RecurringIncome(user_id=user_id, source="Salary", amount_minor=6500000,
                                    frequency="monthly",
                                    next_occurrence=NOW + timedelta(days=12)))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post("/api/auth/login",
                                  json={"email": "exporter@example.com", "password": PASSWORD})
        yield client, {"Authorization": f"Bearer {login.json()['access_token']}"}

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_xlsx_export_includes_every_section(api):
    client, headers = api
    response = await client.get("/api/profile/export.xlsx", headers=headers)

    assert response.status_code == 200, response.text[:300]
    assert "spreadsheetml" in response.headers["content-type"]

    from openpyxl import load_workbook
    workbook = load_workbook(io.BytesIO(response.content))

    for sheet in ("Summary", "Transactions", "Accounts", "Budgets",
                  "Savings Goals", "Bills", "Recurring Income", "Categories"):
        assert sheet in workbook.sheetnames, workbook.sheetnames

    # Row 1 is the header, so a populated sheet has a row 2.
    for sheet in ("Transactions", "Accounts", "Budgets", "Bills", "Recurring Income"):
        assert workbook[sheet].max_row >= 2, f"{sheet} exported no rows"

    # The specific cell that used to raise. "Frequency" is the column's label;
    # `recurrence` is the column on the model.
    bills = workbook["Bills"]
    header = [cell.value for cell in bills[1]]
    row = [cell.value for cell in bills[2]]
    assert header[3] == "Frequency"
    assert row[3] == "monthly"

    # Money is written in rupees, not the minor units the database stores.
    assert row[1] == pytest.approx(799.0)


@pytest.mark.asyncio
async def test_xlsx_export_requires_authentication(api):
    client, _ = api
    response = await client.get("/api/profile/export.xlsx")
    assert response.status_code in (401, 403)
