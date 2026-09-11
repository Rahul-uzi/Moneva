"""Proving you own the address you signed up with.

WHY IT MATTERS, and it is not the reason people assume.

Impersonation is the obvious story - someone registers with your address and
squats it. Real, but rare, and it half-heals: the real owner can run a password
reset, because the code goes to their inbox.

The failure that actually bites is a TYPO. An account attached to a mailbox
its owner cannot read behaves completely normally - they sign in, they enter
months of transactions, everything works. They discover the problem the day
they forget their password, and at that point the reset code goes to an address
that is not theirs and the ledger is unreachable for good. There is no support
desk to appeal to.

So the tests below care most about the code being single-use, expiring, and
guess-limited - the properties that decide whether "verified" means anything.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from main import app
from app.db.database import get_db
from app.models.models import Base, User
from app.core.security import hash_password

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
PASSWORD = "Jhelum-Ferry-1892"
EMAIL = "verify@example.com"


@pytest_asyncio.fixture
async def ctx():
    from app.core import ratelimit
    for window in vars(ratelimit).values():
        if isinstance(window, ratelimit.SlidingWindow):
            window._hits.clear()

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
        res = await client.post("/api/auth/register", json={
            "email": EMAIL, "password": PASSWORD, "display_name": "Verify Test",
            "currency": "INR", "timezone": "Asia/Kolkata",
        })
        assert res.status_code == 201, res.text
        client.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
        yield client, session_factory

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def plant_code(session_factory, code: str, *, minutes: int = 30, attempts: int = 0):
    """Put a known code on the account.

    The real one is emailed and hashed, so a test cannot read it back - which
    is the point of hashing it. Writing a known hash directly exercises exactly
    the same comparison path the endpoint uses.
    """
    from datetime import datetime, timedelta, timezone
    async with session_factory() as db:
        user = (await db.execute(select(User).where(User.email == EMAIL))).scalar_one()
        user.verify_code_hash = hash_password(code)
        user.verify_code_expires_at = datetime.now(timezone.utc) + timedelta(minutes=minutes)
        user.verify_code_attempts = attempts
        await db.commit()


@pytest.mark.asyncio
async def test_a_new_account_is_not_verified(ctx):
    client, _ = ctx
    me = await client.get("/api/auth/me")
    assert me.status_code == 200, me.text
    # The truthful answer: nobody has proved anything yet.
    assert me.json()["email_verified"] is False


@pytest.mark.asyncio
async def test_the_right_code_verifies(ctx):
    client, factory = ctx
    await plant_code(factory, "123456")
    res = await client.post("/api/auth/verify-email", json={"code": "123456"})
    assert res.status_code == 200, res.text
    assert res.json()["email_verified"] is True


@pytest.mark.asyncio
async def test_a_wrong_code_does_not(ctx):
    client, factory = ctx
    await plant_code(factory, "123456")
    res = await client.post("/api/auth/verify-email", json={"code": "999999"})
    assert res.status_code == 400
    assert (await client.get("/api/auth/me")).json()["email_verified"] is False


@pytest.mark.asyncio
async def test_a_code_works_only_once(ctx):
    """Single use.

    A code left live after it has worked still works for whoever read it over
    somebody's shoulder, or for anyone who later reaches the same inbox.
    """
    client, factory = ctx
    await plant_code(factory, "123456")
    assert (await client.post("/api/auth/verify-email", json={"code": "123456"})).status_code == 200

    # Already verified, so the endpoint is a no-op rather than an error - but
    # the code itself must be gone from the row.
    async with factory() as db:
        user = (await db.execute(select(User).where(User.email == EMAIL))).scalar_one()
        assert user.verify_code_hash is None
        assert user.verify_code_expires_at is None


@pytest.mark.asyncio
async def test_an_expired_code_is_refused(ctx):
    client, factory = ctx
    await plant_code(factory, "123456", minutes=-1)
    res = await client.post("/api/auth/verify-email", json={"code": "123456"})
    assert res.status_code == 400
    assert "expired" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_guessing_is_capped(ctx):
    """Six digits inside a thirty-minute window is guessable at unlimited speed.

    The cap is the only thing standing between an attacker and a verified
    address, so it is checked at the boundary rather than somewhere comfortably
    past it.
    """
    from app.routers.auth import VERIFY_MAX_ATTEMPTS

    client, factory = ctx
    await plant_code(factory, "123456")

    for _ in range(VERIFY_MAX_ATTEMPTS):
        assert (await client.post("/api/auth/verify-email", json={"code": "000000"})).status_code == 400

    over = await client.post("/api/auth/verify-email", json={"code": "000000"})
    assert over.status_code == 429


@pytest.mark.asyncio
async def test_spending_the_cap_burns_the_code(ctx):
    """Not merely refused - destroyed.

    If the code survived the ceiling, an attacker would simply wait for the
    counter and carry on. The right code must stop working too.
    """
    from app.routers.auth import VERIFY_MAX_ATTEMPTS

    client, factory = ctx
    await plant_code(factory, "123456")
    for _ in range(VERIFY_MAX_ATTEMPTS + 1):
        await client.post("/api/auth/verify-email", json={"code": "000000"})

    after = await client.post("/api/auth/verify-email", json={"code": "123456"})
    assert after.status_code in (400, 429)
    assert (await client.get("/api/auth/me")).json()["email_verified"] is False


@pytest.mark.asyncio
async def test_verifying_needs_a_session(ctx):
    # No token, no verification. Without this the endpoint would let anyone
    # brute-force any account's code.
    client, factory = ctx
    await plant_code(factory, "123456")
    res = await client.post("/api/auth/verify-email", json={"code": "123456"},
                            headers={"Authorization": ""})
    assert res.status_code in (401, 403)


@pytest.mark.asyncio
async def test_a_resend_is_throttled(ctx):
    """One send, then a wait.

    A signed-in account with no throttle is an unlimited mail generator pointed
    at its own address, which is a spam complaint against whatever relay is
    configured.
    """
    client, _ = ctx
    first = await client.post("/api/auth/send-verification")
    assert first.status_code == 200, first.text

    second = await client.post("/api/auth/send-verification")
    assert second.status_code == 200
    # Answered, but says to wait - and says how long, so the screen can disable
    # its own button instead of letting someone tap into a refusal.
    assert second.json()["retry_after_seconds"] > 0


@pytest.mark.asyncio
async def test_sending_never_reveals_the_code(ctx):
    # The response is read by the client and may end up in a log. The code goes
    # to the inbox and nowhere else.
    client, factory = ctx
    res = await client.post("/api/auth/send-verification")
    body = res.text
    async with factory() as db:
        user = (await db.execute(select(User).where(User.email == EMAIL))).scalar_one()
        assert user.verify_code_hash is not None
    assert user.verify_code_hash not in body
    # And the address is masked rather than echoed in full.
    assert EMAIL not in body


@pytest.mark.asyncio
async def test_the_signed_in_device_is_listed(ctx):
    """The sessions list, which registration itself creates a row for."""
    client, _ = ctx
    res = await client.get("/api/auth/sessions")
    assert res.status_code == 200, res.text
    sessions = res.json()
    assert len(sessions) == 1
    assert "id" in sessions[0] and "device" in sessions[0]


@pytest.mark.asyncio
async def test_a_session_can_be_ended_on_its_own(ctx):
    client, _ = ctx
    creds = {"email": EMAIL, "password": PASSWORD}
    second = await client.post("/api/auth/login", json=creds)
    assert second.status_code == 200, second.text

    sessions = (await client.get("/api/auth/sessions")).json()
    assert len(sessions) == 2

    ended = await client.delete(f"/api/auth/sessions/{sessions[0]['id']}")
    assert ended.status_code == 204

    remaining = (await client.get("/api/auth/sessions")).json()
    assert len(remaining) == 1


@pytest.mark.asyncio
async def test_ending_a_session_kills_only_that_refresh_token(ctx):
    # The list is worthless if "end this device" does not actually end it.
    client, _ = ctx
    other = (await client.post("/api/auth/login",
                               json={"email": EMAIL, "password": PASSWORD})).json()

    sessions = (await client.get("/api/auth/sessions")).json()
    # The most recent sign-in is first, so ending it should kill `other`.
    await client.delete(f"/api/auth/sessions/{sessions[0]['id']}")

    dead = await client.post("/api/auth/refresh", json={"refresh_token": other["refresh_token"]})
    assert dead.status_code == 401


@pytest.mark.asyncio
async def test_someone_elses_session_cannot_be_ended(ctx):
    """Scoped to the caller's own families.

    Without the ownership check, a family id from anywhere would end a
    stranger's session - a one-line denial of service against any account whose
    id you could guess or observe.
    """
    client, _ = ctx
    import uuid as _uuid
    res = await client.delete(f"/api/auth/sessions/{_uuid.uuid4()}")
    assert res.status_code == 404
