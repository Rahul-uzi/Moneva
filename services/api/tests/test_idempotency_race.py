"""What happens when the same payment is submitted twice at once.

Both write paths - creating a transaction and paying a bill - already had a
recovery branch for a lost race with the database's unique constraint. Neither
branch worked: one referred to an exception it never imported, and both read
`current_user.id` AFTER a rollback. A rollback expires every ORM object in the
session, so that read issues a lazy reload, and a lazy reload on an async
session raises MissingGreenlet. The recovery path was itself a 500.

Nothing in the suite caught it because a duplicate submitted SEQUENTIALLY never
reaches the branch - the cheap duplicate check at the top of each handler
returns first. Only genuinely concurrent requests get there, so these tests
fire them concurrently and assert on the line coverage to prove they did.

THE DATABASE IS A FILE, NOT :memory:. An in-memory SQLite hands every session
the same connection, so concurrent sessions corrupt each other and the test
reports failures that belong to the harness. NullPool over a file gives each
session its own connection, which is the minimum for any of this to mean
anything.
"""
import asyncio
import pathlib
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.security import hash_password
from app.db.database import get_db
from app.models.models import Account, Base, Bill, User
from main import app

PASSWORD = "RacePass123!"
CONCURRENCY = 8


class LineWatch:
    """Records which lines of one module actually ran.

    Without this a passing test is ambiguous: a loser that recovered through
    the branch under test and a loser the duplicate check caught first look
    identical from outside. Only the first proves anything.
    """

    def __init__(self, module_tail: str):
        self.tail = module_tail
        self.hit: set[int] = set()

    def _trace(self, frame, event_name, _arg):
        if self.tail in frame.f_code.co_filename.replace("\\", "/"):
            if event_name == "line":
                self.hit.add(frame.f_lineno)
        return self._trace

    def __enter__(self):
        sys.settrace(self._trace)
        return self

    def __exit__(self, *_exc):
        sys.settrace(None)
        return False

    def ran(self, source_fragment: str, path: str) -> bool:
        """True when the line containing `source_fragment` was executed."""
        for number, text in enumerate(pathlib.Path(path).read_text(encoding="utf-8").splitlines(), 1):
            if source_fragment in text:
                return number in self.hit
        raise AssertionError(f"{source_fragment!r} is no longer in {path}")


@pytest_asyncio.fixture
async def api():
    """A client over a file-backed database, one connection per session."""
    path = pathlib.Path(tempfile.gettempdir()) / f"moneva_race_{uuid.uuid4().hex}.sqlite"
    engine = create_async_engine(f"sqlite+aiosqlite:///{path.as_posix()}", poolclass=NullPool)

    @event.listens_for(engine.sync_engine, "connect")
    def _pragmas(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")    # a reader never blocks the writer
        cursor.execute("PRAGMA busy_timeout=8000")   # wait for the lock instead of erroring
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async def _db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _db

    user_id, account_id, bill_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    async with factory() as session:
        session.add(User(id=user_id, email="racer@example.com",
                         password_hash=hash_password(PASSWORD), display_name="Racer"))
        session.add(Account(id=account_id, user_id=user_id, name="Everyday",
                            account_type="asset", opening_balance_minor=500000, currency="INR"))
        session.add(Bill(id=bill_id, user_id=user_id, name="Broadband", amount_minor=79900,
                         currency="INR", due_date=datetime.now(timezone.utc) + timedelta(days=5),
                         recurrence="monthly", status="upcoming"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post("/api/auth/login",
                                  json={"email": "racer@example.com", "password": PASSWORD})
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        yield client, headers, {"account": str(account_id), "bill": str(bill_id)}

    app.dependency_overrides.clear()
    await engine.dispose()
    try:
        path.unlink()
    except OSError:  # Windows can still hold the handle; the temp dir is cleaned anyway
        pass


def _outcomes(results):
    """Status codes, with any escaped exception rendered in place of one."""
    return [f"CRASH {type(r).__name__}: {r}"[:140] if isinstance(r, BaseException)
            else r.status_code for r in results]


@pytest.mark.asyncio
async def test_concurrent_transaction_submits_charge_once(api):
    """A double-tap creates one transaction and no errors.

    Retried, because the thing under test is a RACE. Whether any request
    actually loses it is up to the scheduler: often every loser is absorbed by
    the cheap duplicate check at the top of the handler and the recovery branch
    is never entered. Asserting on a single burst made this fail about one run
    in six - and a test that fails at random teaches people to ignore failures,
    which is worse than not having it.

    So the burst is repeated with a fresh mutation id until the branch is
    genuinely reached. Every round still asserts the properties that must hold
    whether or not anyone lost: exactly one transaction, and nobody sees an
    error.
    """
    client, headers, ids = api
    module = "app/routers/transactions.py"

    reached = False
    for attempt in range(6):
        body = {
            "account_id": ids["account"],
            "client_mutation_id": str(uuid.uuid4()),
            "device_id": "race-device",
            "transaction_type": "expense",
            "amount_minor": 12500,
            "currency": "INR",
            "description": f"Concurrent double-tap {attempt}",
            "transaction_date": datetime.now(timezone.utc).isoformat(),
        }

        with LineWatch(module) as watch:
            results = await asyncio.gather(
                *[client.post("/api/transactions", headers=headers, json=body)
                  for _ in range(CONCURRENCY)],
                return_exceptions=True,
            )

        codes = _outcomes(results)
        assert all(isinstance(c, int) and c < 400 for c in codes), codes

        listing = await client.get("/api/transactions", headers=headers)
        rows = listing.json()
        rows = rows if isinstance(rows, list) else rows.get("items", rows)
        # One row per round, however many requests were fired in it.
        assert len(rows) == attempt + 1, (
            f"round {attempt}: charged {len(rows) - attempt} times, not once")

        if watch.ran("except IntegrityError:", module):
            reached = True
            # Entered is not enough - it must also have come out the other side.
            assert watch.ran("existing_race_tx = fallback_res", module), (
                "the recovery branch was entered but did not complete - it raised")
            break

    assert reached, (
        "six concurrent bursts and not one request lost the race, so the "
        "recovery branch was never exercised. Either the scheduler is "
        "serialising them or the duplicate check now absorbs every loser.")


@pytest.mark.asyncio
async def test_concurrent_bill_payments_pay_once(api):
    """Paying one bill twice at once pays it once, and never returns a 500."""
    client, headers, ids = api
    body = {
        "account_id": ids["account"],
        "client_mutation_id": str(uuid.uuid4()),
        "device_id": "race-device",
    }

    module = "app/routers/bills.py"
    with LineWatch(module) as watch:
        results = await asyncio.gather(
            *[client.post(f"/api/bills/{ids['bill']}/pay", headers=headers, json=body)
              for _ in range(CONCURRENCY)],
            return_exceptions=True,
        )

    codes = _outcomes(results)
    assert not [c for c in codes if not isinstance(c, int) or c >= 500], codes

    listing = await client.get("/api/transactions", headers=headers)
    rows = listing.json()
    rows = rows if isinstance(rows, list) else rows.get("items", rows)
    assert len(rows) == 1, f"the bill was paid {len(rows)} times"

    if watch.ran("except IntegrityError:", module):
        assert watch.ran("race_tx = fallback_res", module), (
            "the recovery branch was entered but did not complete - it raised")


@pytest.mark.asyncio
async def test_bill_pay_survives_a_mutation_id_reused_across_accounts(api):
    """The recovery branch, reached without needing to win a race.

    client_mutation_id is unique across the whole transactions table, but each
    handler's duplicate check is scoped to one user. So a token that already
    exists under a DIFFERENT user slips past the check and lands on the
    constraint - the same branch a lost race reaches, on demand.

    A client generating UUIDs makes this vanishingly rare in the field. It is
    here because it is the only deterministic way to prove the branch does not
    crash, and because "rare" is not "never" once a backup gets restored.
    """
    client, headers, ids = api

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as other:
        shared_token = str(uuid.uuid4())

        first = await client.post(
            f"/api/bills/{ids['bill']}/pay", headers=headers,
            json={"account_id": ids["account"], "client_mutation_id": shared_token,
                  "device_id": "device-a"})
        assert first.status_code in (200, 201), first.text[:200]

        # A second account, reusing the same token.
        signup = await other.post("/api/auth/register", json={
            "email": f"second-{uuid.uuid4().hex[:8]}@example.com", "password": PASSWORD,
            "display_name": "Second", "currency": "INR", "timezone": "Asia/Kolkata"})
        assert signup.status_code == 201, signup.text[:200]
        other_headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}

        made = await other.post("/api/accounts", headers=other_headers, json={
            "name": "Everyday", "account_type": "asset",
            "opening_balance_minor": 500000, "currency": "INR"})
        assert made.status_code in (200, 201), made.text[:200]

        billed = await other.post("/api/bills", headers=other_headers, json={
            "name": "Broadband", "amount_minor": 79900, "currency": "INR",
            "due_date": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
            "recurrence": "monthly"})
        assert billed.status_code in (200, 201), billed.text[:200]

        module = "app/routers/bills.py"
        with LineWatch(module) as watch:
            clash = await other.post(
                f"/api/bills/{billed.json()['id']}/pay", headers=other_headers,
                json={"account_id": made.json()["id"], "client_mutation_id": shared_token,
                      "device_id": "device-b"})

        assert watch.ran("except IntegrityError:", module), (
            "the constraint did not fire, so this test proved nothing")
        # Any deliberate answer is fine. A 500 is not - and a 500 is what the
        # missing import and the expired-instance read each produced.
        assert clash.status_code < 500, clash.text[:300]
