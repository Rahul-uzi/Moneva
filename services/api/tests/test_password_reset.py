"""The password reset flow, and the login throttling that guards it.

Until now a forgotten password meant a permanently lost account: there was no
reset endpoint at all. These cover the two things that make the new one safe
rather than merely present - that it never reveals which addresses have
accounts, and that a code cannot be guessed, replayed or reused.
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import ratelimit
from app.core.security import hash_password, verify_password
from app.db.database import get_db
from app.models.models import Base, User
from main import app

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
pytestmark = pytest.mark.asyncio

PASSWORD = "OriginalPass123"
EMAIL = "reset.subject@example.com"


@pytest_asyncio.fixture
async def api_context(monkeypatch):
    # No key, so the mailer logs rather than sends. The code is read back from
    # the database instead of an inbox.
    monkeypatch.delenv("RESEND_API_KEY", raising=False)

    # The limiter is process-global; without clearing it, one test's attempts
    # would throttle the next and the failure would look like a logic bug.
    for window in (
        ratelimit.LOGIN_BY_IP, ratelimit.LOGIN_BY_ACCOUNT,
        ratelimit.FORGOT_BY_IP, ratelimit.FORGOT_BY_ACCOUNT,
        ratelimit.RESET_BY_IP,
    ):
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
        async with session_factory() as session:
            session.add(User(
                id=uuid.uuid4(), email=EMAIL, password_hash=hash_password(PASSWORD),
                display_name="Reset Subject",
            ))
            await session.commit()
            yield client, session

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _user(session) -> User:
    res = await session.execute(select(User).where(User.email == EMAIL))
    return res.scalar_one()


async def _request_code(client, session, email=EMAIL) -> str | None:
    """Ask for a reset and read the code back out of the database.

    The code only exists hashed, so the test brute-forces its own six digits -
    a million bcrypt checks is far too slow, so instead the hash is replaced
    with a known one. That keeps the endpoint's real behaviour under test and
    only fakes the part the test cannot see.
    """
    r = await client.post("/api/auth/forgot-password", json={"email": email})
    assert r.status_code == 200
    user = await _user(session)
    await session.refresh(user)
    if not user.reset_code_hash:
        return None
    user.reset_code_hash = hash_password("123456")
    await session.commit()
    return "123456"


class TestNoEnumeration:
    async def test_unknown_and_known_addresses_answer_identically(self, api_context):
        client, _ = api_context
        known = await client.post("/api/auth/forgot-password", json={"email": EMAIL})
        unknown = await client.post("/api/auth/forgot-password",
                                    json={"email": "nobody.at.all@example.com"})
        assert known.status_code == unknown.status_code == 200
        # Byte-identical, or the endpoint becomes the oracle that /login refuses to be.
        assert known.json() == unknown.json()

    async def test_a_wrong_code_and_a_wrong_address_answer_identically(self, api_context):
        client, session = api_context
        await _request_code(client, session)
        wrong_code = await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": "000000", "new_password": "NewPass123"})
        wrong_email = await client.post("/api/auth/reset-password", json={
            "email": "nobody.at.all@example.com", "code": "123456", "new_password": "NewPass123"})
        assert wrong_code.status_code == wrong_email.status_code == 400
        assert wrong_code.json() == wrong_email.json()


class TestTheHappyPath:
    async def test_a_valid_code_changes_the_password(self, api_context):
        client, session = api_context
        code = await _request_code(client, session)

        r = await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": code, "new_password": "BrandNewPass456"})
        assert r.status_code == 200

        assert (await client.post("/api/auth/login", json={
            "email": EMAIL, "password": "BrandNewPass456"})).status_code == 200
        assert (await client.post("/api/auth/login", json={
            "email": EMAIL, "password": PASSWORD})).status_code == 401

    async def test_the_code_is_never_stored_in_the_clear(self, api_context):
        client, session = api_context
        await client.post("/api/auth/forgot-password", json={"email": EMAIL})
        user = await _user(session)
        await session.refresh(user)
        assert user.reset_code_hash
        assert len(user.reset_code_hash) > 20      # a hash, not six digits
        assert not user.reset_code_hash.isdigit()

    async def test_resetting_signs_every_existing_session_out(self, api_context):
        client, session = api_context
        before = (await _user(session)).token_version
        code = await _request_code(client, session)
        await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": code, "new_password": "BrandNewPass456"})
        user = await _user(session)
        await session.refresh(user)
        # Otherwise whoever was already signed in on another device stays in,
        # which is precisely the person a reset is often protecting against.
        assert user.token_version == before + 1


class TestTheCodeCannotBeAbused:
    async def test_a_code_works_only_once(self, api_context):
        client, session = api_context
        code = await _request_code(client, session)
        first = await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": code, "new_password": "FirstNew123"})
        second = await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": code, "new_password": "SecondNew123"})
        assert first.status_code == 200
        assert second.status_code == 400

    async def test_the_code_dies_after_five_wrong_guesses(self, api_context):
        client, session = api_context
        code = await _request_code(client, session)
        for _ in range(5):
            await client.post("/api/auth/reset-password", json={
                "email": EMAIL, "code": "000000", "new_password": "Whatever123"})
        # Even the RIGHT code is refused now - the code was destroyed, not just
        # the attempt rejected.
        r = await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": code, "new_password": "Whatever123"})
        assert r.status_code == 400

    async def test_an_expired_code_is_refused(self, api_context):
        from datetime import datetime, timedelta, timezone
        client, session = api_context
        code = await _request_code(client, session)
        user = await _user(session)
        user.reset_code_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await session.commit()

        r = await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": code, "new_password": "Whatever123"})
        assert r.status_code == 400
        # And the dead code is cleared rather than left lying in the row.
        refreshed = await _user(session)
        await session.refresh(refreshed)
        assert refreshed.reset_code_hash is None

    async def test_asking_again_invalidates_the_previous_code(self, api_context):
        client, session = api_context
        first_code = await _request_code(client, session)
        await client.post("/api/auth/forgot-password", json={"email": EMAIL})
        r = await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": first_code, "new_password": "Whatever123"})
        assert r.status_code == 400


class TestRecoveryCodeFallback:
    async def test_a_2fa_recovery_code_can_reset_the_password(self, api_context):
        import json as _json
        client, session = api_context
        user = await _user(session)
        user.totp_enabled = True
        user.totp_recovery_codes = _json.dumps([hash_password("ABCD-1234"), hash_password("EFGH-5678")])
        await session.commit()

        # No emailed code at all - this is the path for someone locked out of
        # their inbox.
        r = await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": "ABCD-1234", "new_password": "ViaRecovery789"})
        assert r.status_code == 200
        assert (await client.post("/api/auth/login", json={
            "email": EMAIL, "password": "ViaRecovery789"})).status_code == 200

    async def test_a_recovery_code_is_burned_after_use(self, api_context):
        import json as _json
        client, session = api_context
        user = await _user(session)
        user.totp_enabled = True
        user.totp_recovery_codes = _json.dumps([hash_password("ABCD-1234")])
        await session.commit()

        await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": "ABCD-1234", "new_password": "ViaRecovery789"})
        again = await client.post("/api/auth/reset-password", json={
            "email": EMAIL, "code": "ABCD-1234", "new_password": "AgainPlease123"})
        assert again.status_code == 400


class TestLoginThrottling:
    async def test_repeated_wrong_passwords_are_eventually_refused(self, api_context):
        client, _ = api_context
        statuses = []
        for _ in range(12):
            r = await client.post("/api/auth/login",
                                  json={"email": EMAIL, "password": "wrong-every-time"})
            statuses.append(r.status_code)
        # Before this existed, all twelve were 401 and guessing was unbounded.
        assert 429 in statuses, statuses

    async def test_an_unknown_account_is_throttled_too(self, api_context):
        client, _ = api_context
        statuses = []
        for _ in range(12):
            r = await client.post("/api/auth/login",
                                  json={"email": "ghost@example.com", "password": "wrong"})
            statuses.append(r.status_code)
        # Throttling only real accounts would make the limiter itself say which
        # addresses exist.
        assert 429 in statuses, statuses

    async def test_signing_in_clears_the_count(self, api_context):
        client, _ = api_context
        for _ in range(3):
            await client.post("/api/auth/login", json={"email": EMAIL, "password": "wrong"})
        assert (await client.post("/api/auth/login",
                                  json={"email": EMAIL, "password": PASSWORD})).status_code == 200
        assert ratelimit.LOGIN_BY_ACCOUNT.check(EMAIL)[0] is True
