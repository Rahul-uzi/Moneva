"""A note the person writes on a transaction.

Why this is not just "put it in the description": the description is written
by the PARSER on almost every captured row - "UPI/ZOMATO ONLINE/9812",
"Rs.161.70 to McDonald's". It is what the row is titled by, what the
categoriser reads, and what the brand-logo matcher searches. Typing "split
with Anita, she owes me half" into it renames the payment, hides its merchant,
and can move it into a different category.

So the note is its own column, and the tests below are mostly about the two
ways a free-text field goes wrong: it must be genuinely optional, and clearing
it must actually clear it rather than leave the old text in place.
"""
import uuid
from datetime import datetime, timezone

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

EMAIL = "notes@example.com"
PASSWORD = "NotesPass12345"


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

    user_id, account_id, category_id, tx_id = (uuid.uuid4() for _ in range(4))
    async with factory() as session:
        session.add(User(id=user_id, email=EMAIL, password_hash=hash_password(PASSWORD),
                         display_name="Note Taker", currency="INR"))
        session.add(Account(id=account_id, user_id=user_id, name="Canara Bank",
                            account_type="asset", currency="INR",
                            opening_balance_minor=100_000))
        session.add(Category(id=category_id, user_id=user_id, name="Food & Dining",
                             type="expense"))
        await session.commit()

        session.add(Transaction(
            id=tx_id, client_mutation_id=uuid.uuid4(), user_id=user_id,
            account_id=account_id, category_id=category_id,
            transaction_type="expense", amount_minor=16_170, currency="INR",
            description="McDonald's",
            transaction_date=datetime.now(timezone.utc), device_id="test"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
        yield client, factory, str(account_id), str(category_id), str(tx_id)

    app.dependency_overrides.clear()


class TestWritingANote:
    async def test_a_transaction_starts_with_no_note(self, api):
        client, _f, _a, _c, tx_id = api
        res = await client.get("/api/transactions")
        assert res.status_code == 200, res.text
        row = next(r for r in res.json() if r["id"] == tx_id)
        assert row["notes"] is None

    async def test_a_note_is_saved_and_read_back(self, api):
        client, _f, _a, _c, tx_id = api
        res = await client.patch(f"/api/transactions/{tx_id}",
                                 json={"notes": "Split with Anita - she owes me half"})
        assert res.status_code == 200, res.text
        assert res.json()["notes"] == "Split with Anita - she owes me half"

        again = await client.get("/api/transactions")
        row = next(r for r in again.json() if r["id"] == tx_id)
        assert row["notes"] == "Split with Anita - she owes me half"

    async def test_the_note_never_touches_the_description(self, api):
        """The whole reason for a separate column.

        The description drives the row's title, its category and its logo. A
        note that leaked into it would rename this payment and could move it
        out of Food & Dining.
        """
        client, _f, _a, _c, tx_id = api
        await client.patch(f"/api/transactions/{tx_id}", json={"notes": "paid by Swiggy voucher"})
        res = await client.get("/api/transactions")
        row = next(r for r in res.json() if r["id"] == tx_id)
        assert row["description"] == "McDonald's"
        assert row["notes"] == "paid by Swiggy voucher"

    async def test_editing_something_else_leaves_the_note_alone(self, api):
        """An absent field means "unchanged", not "cleared".

        The edit form sends the amount and the date on every save. If absence
        were read as an instruction to blank the note, correcting a typo in an
        amount would silently delete what the user had written.
        """
        client, _f, _a, _c, tx_id = api
        await client.patch(f"/api/transactions/{tx_id}", json={"notes": "keep me"})
        await client.patch(f"/api/transactions/{tx_id}", json={"amount_minor": 20_000})
        res = await client.get("/api/transactions")
        row = next(r for r in res.json() if r["id"] == tx_id)
        assert row["amount_minor"] == 20_000
        assert row["notes"] == "keep me"


class TestClearingANote:
    async def test_an_emptied_note_is_cleared(self, api):
        """Sending "" is how the form says "I deleted the text"."""
        client, _f, _a, _c, tx_id = api
        await client.patch(f"/api/transactions/{tx_id}", json={"notes": "written by mistake"})
        res = await client.patch(f"/api/transactions/{tx_id}", json={"notes": ""})
        assert res.status_code == 200, res.text
        assert res.json()["notes"] is None

    async def test_whitespace_is_not_a_note(self, api):
        """A field holding three spaces looks empty and is not.

        Stored as given, it would make `notes` truthy, so the detail screen
        would draw a Note row containing nothing at all.
        """
        client, factory, _a, _c, tx_id = api
        await client.patch(f"/api/transactions/{tx_id}", json={"notes": "   \n  "})
        async with factory() as session:
            tx = (await session.execute(
                select(Transaction).where(Transaction.id == uuid.UUID(tx_id)))).scalar_one()
            # NULL specifically, not "": one spelling of absence, so no reader
            # has to test for both.
            assert tx.notes is None

    async def test_surrounding_whitespace_is_trimmed(self, api):
        client, _f, _a, _c, tx_id = api
        res = await client.patch(f"/api/transactions/{tx_id}",
                                 json={"notes": "  reimbursed by work  "})
        assert res.json()["notes"] == "reimbursed by work"
