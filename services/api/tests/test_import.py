"""Taking a bank statement in, more than once.

Import is the one operation people repeat by accident. They import the same
file again because they are not sure it worked; they import this month's
export, which overlaps last month's by a fortnight. The honest answer to both
is "nothing happened" - and the only way to give it is to recognise a payment
by its own identity rather than by hunting for rows that look similar.

The tests below are mostly about that, and about the two ways a bulk endpoint
can quietly do damage: taking somebody else's row, and taking a row it should
have refused.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import create_access_token, hash_password
from app.db.database import get_db
from app.models.models import Account, Base, Transaction, User
from main import app

pytestmark = pytest.mark.asyncio

EMAIL = "importer@example.com"
PASSWORD = "ImportPass123"


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
        session.add(User(id=user_id, email=EMAIL, password_hash=hash_password(PASSWORD),
                         display_name="Importer", currency="INR"))
        session.add(Account(id=account_id, user_id=user_id, name="HDFC Bank",
                            account_type="asset", currency="INR", opening_balance_minor=0))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Minted rather than fetched through /auth/login.
        #
        # Login is rate limited by client IP - 20 in five minutes - and every
        # test in the suite arrives from the same one. A fixture that logs in
        # per test spends that budget on nothing: this file alone was fifteen
        # of the twenty, and the last test in it failed at SETUP with a
        # missing access_token while passing perfectly in isolation.
        #
        # Nothing here is testing the login route, so it does not need to call
        # it. The rate limiter is left for the tests that do.
        token = create_access_token({"sub": str(user_id)})
        client.headers["Authorization"] = f"Bearer {token}"
        yield client, factory, str(account_id), str(user_id)

    app.dependency_overrides.clear()


def row(mutation_id=None, *, amount=25000, kind="expense", description="SWIGGY", days_ago=1):
    return {
        "client_mutation_id": str(mutation_id or uuid.uuid4()),
        "transaction_type": kind,
        "amount_minor": amount,
        "currency": "INR",
        "description": description,
        "transaction_date": (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat(),
    }


async def send(client, account_id, rows):
    return await client.post("/api/transactions/import",
                             json={"account_id": account_id, "rows": rows})


class TestTakingAStatementIn:
    async def test_a_chunk_of_rows_becomes_transactions(self, api):
        client, factory, account_id, _u = api
        res = await send(client, account_id, [row(), row(kind="income", amount=6500000), row()])
        assert res.status_code == 200, res.text
        assert res.json() == {"created": 3, "duplicates": 0, "rejected": []}

        async with factory() as session:
            stored = (await session.execute(select(Transaction))).scalars().all()
        assert len(stored) == 3
        # Tagged, so an import can be told apart from a payment the phone saw.
        assert {t.device_id for t in stored} == {"statement-import"}

    async def test_the_amounts_and_directions_survive(self, api):
        client, factory, account_id, _u = api
        await send(client, account_id, [
            row(amount=64900, kind="expense", description="Netflix"),
            row(amount=250000, kind="income", description="RAJESH KUMAR"),
        ])
        async with factory() as session:
            stored = (await session.execute(select(Transaction))).scalars().all()
        by_desc = {t.description: t for t in stored}
        assert by_desc["Netflix"].amount_minor == 64900
        assert by_desc["Netflix"].transaction_type == "expense"
        assert by_desc["RAJESH KUMAR"].transaction_type == "income"


class TestImportingTheSameFileTwice:
    """The whole point. This is what people actually do."""

    async def test_the_same_file_again_changes_nothing(self, api):
        client, factory, account_id, _u = api
        rows = [row(uuid.uuid4()), row(uuid.uuid4()), row(uuid.uuid4())]

        first = await send(client, account_id, rows)
        second = await send(client, account_id, rows)

        assert first.json()["created"] == 3
        assert second.json() == {"created": 0, "duplicates": 3, "rejected": []}

        async with factory() as session:
            stored = (await session.execute(select(Transaction))).scalars().all()
        assert len(stored) == 3, "the second import duplicated the statement"

    async def test_an_overlapping_export_adds_only_the_new_rows(self, api):
        """Next month's export, which repeats a fortnight of last month's."""
        client, factory, account_id, _u = api
        shared = [row(uuid.uuid4()), row(uuid.uuid4())]
        fresh = [row(uuid.uuid4()), row(uuid.uuid4()), row(uuid.uuid4())]

        await send(client, account_id, shared)
        result = (await send(client, account_id, shared + fresh)).json()

        assert result["created"] == 3
        assert result["duplicates"] == 2

        async with factory() as session:
            stored = (await session.execute(select(Transaction))).scalars().all()
        assert len(stored) == 5

    async def test_a_line_repeated_inside_one_chunk(self, api):
        """A file that lists the same payment twice.

        Both rows pass the "already stored?" check, because neither is stored
        yet - so without a guard they collide on the unique constraint at
        commit and take the entire chunk down with them.
        """
        client, factory, account_id, _u = api
        twice = str(uuid.uuid4())
        result = (await send(client, account_id, [
            row(twice), row(twice), row(uuid.uuid4()),
        ])).json()

        assert result["created"] == 2
        assert result["duplicates"] == 1

        async with factory() as session:
            stored = (await session.execute(select(Transaction))).scalars().all()
        assert len(stored) == 2


class TestWhatItRefuses:
    async def test_an_account_that_is_not_yours(self, api):
        client, _f, _a, _u = api
        res = await send(client, str(uuid.uuid4()), [row()])
        assert res.status_code == 404

    async def test_a_row_belonging_to_another_user_is_not_absorbed(self, api):
        """Somebody else's id is not this user's duplicate to swallow.

        Counting it as a duplicate would report success for a row that was
        never written, and the user would believe a payment had imported.
        """
        client, factory, account_id, _u = api
        stranger = uuid.uuid4()
        stranger_mutation = uuid.uuid4()
        async with factory() as session:
            session.add(User(id=stranger, email="other@example.com",
                             password_hash=hash_password(PASSWORD), display_name="Other"))
            other_account = uuid.uuid4()
            session.add(Account(id=other_account, user_id=stranger, name="Theirs",
                                account_type="asset", currency="INR", opening_balance_minor=0))
            await session.commit()
            session.add(Transaction(
                client_mutation_id=stranger_mutation, user_id=stranger, account_id=other_account,
                transaction_type="expense", amount_minor=100, currency="INR",
                transaction_date=datetime.now(timezone.utc), device_id="test"))
            await session.commit()

        result = (await send(client, account_id, [row(stranger_mutation), row()])).json()
        assert result["created"] == 1
        assert result["duplicates"] == 0
        # The reason is deliberately vague - see TestNotLeakingOtherPeoplesLedgers.
        assert result["rejected"] == [{"index": 0, "reason": "Could not be added."}]

    async def test_a_zero_or_negative_amount(self, api):
        client, _f, account_id, _u = api
        result = (await send(client, account_id, [row(amount=0), row(amount=-500), row()])).json()
        assert result["created"] == 1
        assert [r["index"] for r in result["rejected"]] == [0, 1]

    async def test_a_transfer_cannot_be_imported(self, api):
        """A statement line cannot say which of your own accounts it went to.

        Filing it as a transfer with no destination gives the ledger a
        movement it cannot balance; filing it as spending would be a lie. So
        it is refused, and named in the result rather than dropped.
        """
        client, _f, account_id, _u = api
        result = (await send(client, account_id, [row(kind="transfer"), row()])).json()
        assert result["created"] == 1
        assert result["rejected"][0]["reason"] == "Only income and expense can be imported."

    async def test_one_bad_row_does_not_lose_the_good_ones(self, api):
        client, factory, account_id, _u = api
        result = (await send(client, account_id, [
            row(), row(amount=0), row(), row(kind="transfer"), row(),
        ])).json()
        assert result["created"] == 3
        async with factory() as session:
            stored = (await session.execute(select(Transaction))).scalars().all()
        assert len(stored) == 3

    async def test_a_chunk_larger_than_the_cap_is_refused(self, api):
        """The cap is part of the contract, not a detail.

        A statement can hold years, and an unbounded list is an unbounded
        transaction on a shared database. The client sends chunks.
        """
        client, _f, account_id, _u = api
        res = await send(client, account_id, [row() for _ in range(501)])
        # 400, not FastAPI's default 422: this API maps malformed bodies to
        # Bad Request everywhere, and one endpoint answering differently is
        # worse than the convention being unusual.
        assert res.status_code == 400

    async def test_an_empty_chunk_is_refused(self, api):
        client, _f, account_id, _u = api
        assert (await send(client, account_id, [])).status_code == 400

    async def test_it_needs_a_signed_in_user(self, api):
        client, _f, account_id, _u = api
        res = await client.post("/api/transactions/import",
                                json={"account_id": account_id, "rows": [row()]},
                                headers={"Authorization": "Bearer nonsense"})
        assert res.status_code == 401


class TestARaceWithAnotherImport:
    """Two imports of the same file, overlapping in time.

    The lookup that decides "already stored?" happens before the commit, so a
    second import committing in between makes the first one's picture stale.
    It dies on the unique constraint and the whole chunk rolls back - INCLUDING
    rows that were genuinely new.

    The original code caught that and reported every row as a duplicate. The
    rows were gone and the user was told they were safely stored, which is the
    worst combination available: data loss reported as success.
    """

    async def test_a_stale_commit_is_retried_rather_than_reported_as_success(self, api, monkeypatch):
        client, factory, account_id, _u = api
        rows = [row(uuid.uuid4()), row(uuid.uuid4()), row(uuid.uuid4())]

        from sqlalchemy.exc import IntegrityError
        from sqlalchemy.ext.asyncio import AsyncSession

        real_commit = AsyncSession.commit
        state = {"failed": False}

        async def commit_once_badly(self, *a, **kw):
            # Exactly the shape of the race: the first commit loses.
            if not state["failed"]:
                state["failed"] = True
                raise IntegrityError("stale", None, Exception("unique constraint"))
            return await real_commit(self, *a, **kw)

        monkeypatch.setattr(AsyncSession, "commit", commit_once_badly)
        result = await send(client, account_id, rows)
        monkeypatch.setattr(AsyncSession, "commit", real_commit)

        assert result.status_code == 200, result.text
        # The retry ran against a fresh read and stored everything.
        assert result.json()["created"] == 3

        async with factory() as session:
            stored = (await session.execute(select(Transaction))).scalars().all()
        assert len(stored) == 3, "rows were lost to the race and reported as duplicates"

    async def test_it_gives_up_honestly_rather_than_claiming_success(self, api, monkeypatch):
        """If the retry loses too, say so. Never report rows that are not there."""
        client, factory, account_id, _u = api

        from sqlalchemy.exc import IntegrityError
        from sqlalchemy.ext.asyncio import AsyncSession

        async def always_fail(self, *a, **kw):
            raise IntegrityError("stale", None, Exception("unique constraint"))

        monkeypatch.setattr(AsyncSession, "commit", always_fail)
        result = await send(client, account_id, [row(), row()])

        assert result.status_code == 409
        assert "try this file again" in result.json()["detail"].lower()


class TestReadingASpreadsheet:
    """Banks push .xlsx harder than .csv.

    Until this existed the answer to an Excel statement was "find the CSV
    download instead", which for several banks does not exist at all.

    The endpoint converts and stops. Reading columns, dates and amounts stays
    in the client's parser - a second implementation here would be a second
    set of rules to keep in step, and the one place they drifted would be a
    silent, wrong import.
    """

    @staticmethod
    def _workbook(rows):
        import base64, io as _io
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Statement"
        for r in rows:
            ws.append(r)
        buf = _io.BytesIO()
        wb.save(buf)
        return base64.b64encode(buf.getvalue()).decode()

    async def test_it_turns_a_sheet_into_csv(self, api):
        client, _f, _a, _u = api
        from datetime import date
        content = self._workbook([
            ["Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
            [date(2026, 6, 5), "UPI-SWIGGY-9812", 250.00, None, 45320.00],
            [date(2026, 6, 7), "SALARY JUNE", None, 65000.00, 110320.00],
        ])
        res = await client.post("/api/transactions/import/sheet",
                                json={"filename": "s.xlsx", "content_base64": content})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["sheet_name"] == "Statement"
        assert body["rows"] == 3
        assert "Narration" in body["csv"]
        assert "UPI-SWIGGY-9812" in body["csv"]

    async def test_dates_come_back_unambiguous(self, api):
        """The one place the day/month problem can be SOLVED rather than guessed.

        A spreadsheet stores a real date, not text, so it is written back as
        ISO and the client never has to infer an order for it.
        """
        client, _f, _a, _u = api
        from datetime import date
        content = self._workbook([
            ["Date", "Description", "Amount"],
            [date(2026, 6, 5), "NETFLIX", -649.00],
        ])
        body = (await client.post("/api/transactions/import/sheet",
                                  json={"filename": "s.xlsx", "content_base64": content})).json()
        assert "2026-06-05" in body["csv"]
        # Not the 6th of May, and not a serial number.
        assert "05/06" not in body["csv"]

    async def test_a_file_that_is_not_a_spreadsheet(self, api):
        client, _f, _a, _u = api
        import base64
        junk = base64.b64encode(b"this is just some text, not a workbook").decode()
        res = await client.post("/api/transactions/import/sheet",
                                json={"filename": "x.xlsx", "content_base64": junk})
        assert res.status_code == 400
        assert "spreadsheet" in res.json()["detail"].lower()

    async def test_content_that_is_not_base64(self, api):
        client, _f, _a, _u = api
        res = await client.post("/api/transactions/import/sheet",
                                json={"filename": "x.xlsx", "content_base64": "!!!not base64!!!"})
        assert res.status_code == 400

    async def test_a_file_too_large_to_decode_into_memory(self, api):
        client, _f, _a, _u = api
        import base64
        oversized = base64.b64encode(b"\0" * (7 * 1024 * 1024)).decode()
        res = await client.post("/api/transactions/import/sheet",
                                json={"filename": "big.xlsx", "content_base64": oversized})
        assert res.status_code == 400
        assert "too large" in res.json()["detail"].lower()

    async def test_it_needs_a_signed_in_user(self, api):
        client, _f, _a, _u = api
        res = await client.post("/api/transactions/import/sheet",
                                json={"filename": "s.xlsx", "content_base64": "AAAA"},
                                headers={"Authorization": "Bearer nonsense"})
        assert res.status_code == 401


class TestTheLimitsOnWhatOneRequestCanCarry:
    """A bulk route is where a missing bound stops being theoretical.

    Every field here was unbounded while the single-transaction route capped
    the description at 500 characters. One request of 500 rows could therefore
    write a hundred megabytes, from an ordinary signed-in account.
    """

    async def test_a_description_longer_than_the_normal_limit(self, api):
        client, _f, account_id, _u = api
        res = await send(client, account_id, [row(description="A" * 200_000)])
        assert res.status_code == 400

    async def test_the_same_cap_as_a_single_transaction(self, api):
        client, _f, account_id, _u = api
        assert (await send(client, account_id, [row(description="A" * 500)])).status_code == 200
        assert (await send(client, account_id, [row(description="A" * 501)])).status_code == 400

    async def test_a_currency_that_is_not_a_currency(self, api):
        client, _f, account_id, _u = api
        payload = row()
        payload["currency"] = "X" * 5000
        assert (await send(client, account_id, [payload])).status_code == 400

    async def test_an_absurd_amount(self, api):
        client, _f, account_id, _u = api
        payload = row()
        payload["amount_minor"] = 10 ** 20
        assert (await send(client, account_id, [payload])).status_code == 400

    async def test_a_transaction_type_of_unbounded_length(self, api):
        client, _f, account_id, _u = api
        payload = row()
        payload["transaction_type"] = "expense" * 1000
        assert (await send(client, account_id, [payload])).status_code == 400


class TestNotLeakingOtherPeoplesLedgers:
    """The ids are derived from the payment, so they can be GUESSED.

    Without care that turns import into a question: craft the id for a payment
    you suspect somebody made, send it, and read the answer off the response.
    The first defence is that ids are scoped to the importing user, so a
    stranger's id cannot be constructed at all. This is the second: even when
    a collision does occur, the reason given says nothing about why.
    """

    async def test_the_reason_does_not_confirm_another_account(self, api):
        client, factory, account_id, _u = api
        stranger, stranger_mutation = uuid.uuid4(), uuid.uuid4()
        async with factory() as session:
            session.add(User(id=stranger, email="leak@example.com",
                             password_hash=hash_password(PASSWORD), display_name="Other"))
            other_account = uuid.uuid4()
            session.add(Account(id=other_account, user_id=stranger, name="Theirs",
                                account_type="asset", currency="INR", opening_balance_minor=0))
            await session.commit()
            session.add(Transaction(
                client_mutation_id=stranger_mutation, user_id=stranger, account_id=other_account,
                transaction_type="expense", amount_minor=100, currency="INR",
                transaction_date=datetime.now(timezone.utc), device_id="test"))
            await session.commit()

        result = (await send(client, account_id, [row(stranger_mutation)])).json()
        reason = result["rejected"][0]["reason"]
        # It must not name another account, or say the id is taken.
        assert "another" not in reason.lower()
        assert "already" not in reason.lower()
        assert reason == "Could not be added."

    async def test_the_row_is_still_not_counted_as_stored(self, api):
        """Vague, but not dishonest - it must never be reported as saved."""
        client, factory, account_id, _u = api
        stranger, stranger_mutation = uuid.uuid4(), uuid.uuid4()
        async with factory() as session:
            session.add(User(id=stranger, email="leak2@example.com",
                             password_hash=hash_password(PASSWORD), display_name="Other"))
            other_account = uuid.uuid4()
            session.add(Account(id=other_account, user_id=stranger, name="Theirs",
                                account_type="asset", currency="INR", opening_balance_minor=0))
            await session.commit()
            session.add(Transaction(
                client_mutation_id=stranger_mutation, user_id=stranger, account_id=other_account,
                transaction_type="expense", amount_minor=100, currency="INR",
                transaction_date=datetime.now(timezone.utc), device_id="test"))
            await session.commit()

        result = (await send(client, account_id, [row(stranger_mutation)])).json()
        assert result["created"] == 0
        assert result["duplicates"] == 0


class TestASpreadsheetBuiltToBeHostile:
    """An .xlsx is a ZIP, and the size cap was on the COMPRESSED bytes.

    A few hundred kilobytes of highly repetitive XML decompresses to
    gigabytes. openpyxl would have started expanding it before anything
    noticed, on a shared instance. A limit on compressed size alone is not a
    limit at all against a file built to exploit exactly that.
    """

    @staticmethod
    def _bomb(uncompressed_mb: int) -> str:
        """A small archive that declares an enormous member."""
        import base64, io as _io, zipfile
        buf = _io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            # Highly repetitive, so it compresses to almost nothing.
            z.writestr("xl/worksheets/sheet1.xml", b"A" * (uncompressed_mb * 1024 * 1024))
        return base64.b64encode(buf.getvalue()).decode()

    async def test_a_zip_bomb_is_refused_before_it_is_expanded(self, api):
        client, _f, _a, _u = api
        payload = self._bomb(120)          # ~120 MB declared, a few KB on the wire
        # It really is small on the wire - which is the whole point.
        assert len(payload) < 1024 * 1024, "the probe is not actually a bomb"

        res = await client.post("/api/transactions/import/sheet",
                                json={"filename": "bomb.xlsx", "content_base64": payload})
        assert res.status_code == 400
        assert "expands" in res.json()["detail"].lower()

    async def test_an_ordinary_workbook_still_passes(self, api):
        """The guard must not refuse real statements."""
        client, _f, _a, _u = api
        import base64, io as _io
        from datetime import date
        from openpyxl import Workbook
        wb = Workbook(); ws = wb.active
        ws.append(["Date", "Description", "Amount"])
        for i in range(500):
            ws.append([date(2026, 6, 5), f"ROW {i}", -100.00])
        buf = _io.BytesIO(); wb.save(buf)
        content = base64.b64encode(buf.getvalue()).decode()

        res = await client.post("/api/transactions/import/sheet",
                                json={"filename": "real.xlsx", "content_base64": content})
        assert res.status_code == 200, res.text[:200]
        assert res.json()["rows"] == 501

    async def test_something_that_is_not_a_zip_at_all(self, api):
        client, _f, _a, _u = api
        import base64
        res = await client.post("/api/transactions/import/sheet",
                                json={"filename": "x.xlsx",
                                      "content_base64": base64.b64encode(b"plain text").decode()})
        assert res.status_code == 400


class TestTheImportRoutesAreBounded:
    """Authenticated, so this bounds one account rather than a flood.

    Generous on purpose - a decade of history is fifty chunks of two hundred
    rows, and somebody doing that must not be stopped half way. It is here to
    bound a runaway loop, not to police normal use.
    """

    async def test_the_sheet_route_gives_up_after_enough_conversions(self, api):
        client, _f, _a, _u = api
        import base64
        junk = base64.b64encode(b"not a zip").decode()
        statuses = set()
        for _ in range(40):
            res = await client.post("/api/transactions/import/sheet",
                                    json={"filename": "x.xlsx", "content_base64": junk})
            statuses.add(res.status_code)
            if res.status_code == 429:
                break
        assert 429 in statuses, "the conversion route accepted an unbounded number of requests"
