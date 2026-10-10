"""Moving an account to a new sign-in email.

The rule everything here protects: `email` only changes once a code sent to the
NEW address has come back. Until then the account keeps signing in with the old
one, so a typo in the new address can never point future reset codes at a
stranger's inbox - and a borrowed, unlocked phone cannot move the account
without the password.
"""

import pytest
import pytest_asyncio
from datetime import datetime, timedelta, timezone
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from main import app
from app.db.database import get_db
from app.models.models import Base, User

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
PASSWORD = "Kestrel-Harbour-4417"
OLD = "old.address@example.com"
NEW = "new.address@example.com"


@pytest_asyncio.fixture
async def ctx(monkeypatch):
    from app.core import ratelimit
    for window in vars(ratelimit).values():
        if isinstance(window, ratelimit.SlidingWindow):
            window._hits.clear()

    # Catch the mail instead of sending it, so the tests can read the real code.
    sent = {"codes": [], "notices": []}

    async def fake_code(to_email, code, minutes=30):
        sent["codes"].append((to_email, code))
        return True

    async def fake_notice(old_email, new_email):
        sent["notices"].append((old_email, new_email))
        return True

    monkeypatch.setattr("app.routers.auth.send_email_change_code", fake_code)
    monkeypatch.setattr("app.routers.auth.send_email_changed_notice", fake_notice)

    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/api/auth/register", json={
            "email": OLD, "password": PASSWORD, "display_name": "Change Test",
            "currency": "INR", "timezone": "Asia/Kolkata",
        })
        assert res.status_code == 201, res.text
        client.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
        yield client, factory, sent

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def start(client, new=NEW, password=PASSWORD):
    return await client.post("/api/auth/change-email/start", json={"new_email": new, "password": password})


async def me(client):
    return (await client.get("/api/auth/me")).json()


@pytest.mark.asyncio
async def test_the_code_goes_to_the_new_address_and_nothing_moves_yet(ctx):
    client, _, sent = ctx
    res = await start(client)
    assert res.status_code == 200, res.text
    assert res.json()["pending_email"] == NEW
    assert [to for to, _ in sent["codes"]] == [NEW]
    # Still the old address until the code comes back.
    assert (await me(client))["email"] == OLD


@pytest.mark.asyncio
async def test_the_right_code_moves_the_account_and_tells_the_old_address(ctx):
    client, _, sent = ctx
    await start(client)
    code = sent["codes"][-1][1]

    res = await client.post("/api/auth/change-email/confirm", json={"code": code})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["email"] == NEW
    # The code could only have been read from the new mailbox, so it is proved.
    assert body["email_verified"] is True
    assert sent["notices"] == [(OLD, NEW)]

    # Signing in follows the address.
    client.headers.pop("Authorization")
    assert (await client.post("/api/auth/login", json={"email": NEW, "password": PASSWORD})).status_code == 200
    assert (await client.post("/api/auth/login", json={"email": OLD, "password": PASSWORD})).status_code == 401


@pytest.mark.asyncio
async def test_an_unverified_account_can_fix_a_typo(ctx):
    """The case this exists for: signed up with a mistyped address, never verified."""
    client, _, sent = ctx
    assert (await me(client))["email_verified"] is False
    await start(client)
    res = await client.post("/api/auth/change-email/confirm", json={"code": sent["codes"][-1][1]})
    assert res.status_code == 200, res.text
    assert res.json()["email"] == NEW


@pytest.mark.asyncio
async def test_a_wrong_password_holds_nothing_and_sends_nothing(ctx):
    client, factory, sent = ctx
    res = await start(client, password="not-the-password")
    assert res.status_code == 400
    assert sent["codes"] == []
    async with factory() as db:
        user = (await db.execute(select(User).where(User.email == OLD))).scalar_one()
        assert user.pending_email is None


@pytest.mark.asyncio
async def test_a_wrong_code_moves_nothing(ctx):
    client, _, sent = ctx
    await start(client)
    real = sent["codes"][-1][1]
    wrong = "000000" if real != "000000" else "111111"
    res = await client.post("/api/auth/change-email/confirm", json={"code": wrong})
    assert res.status_code == 400
    assert (await me(client))["email"] == OLD


@pytest.mark.asyncio
async def test_the_same_address_is_refused(ctx):
    client, _, sent = ctx
    res = await start(client, new=OLD.upper())
    assert res.status_code == 400
    assert "already your email" in res.json()["detail"]
    assert sent["codes"] == []


@pytest.mark.asyncio
async def test_an_address_another_account_uses_is_refused(ctx):
    client, _, sent = ctx
    other = await client.post("/api/auth/register", json={
        "email": NEW, "password": "Granite-Lantern-5093", "display_name": "Someone Else",
        "currency": "INR", "timezone": "Asia/Kolkata",
    }, headers={"Authorization": ""})
    assert other.status_code == 201, other.text
    res = await start(client)
    assert res.status_code == 409
    assert sent["codes"] == []


@pytest.mark.asyncio
async def test_an_address_taken_while_waiting_is_refused_at_confirm(ctx):
    """Somebody signs up with the new address in the half hour after the code went out."""
    client, _, sent = ctx
    await start(client)
    code = sent["codes"][-1][1]
    taken = await client.post("/api/auth/register", json={
        "email": NEW, "password": "Granite-Lantern-5093", "display_name": "Someone Else",
        "currency": "INR", "timezone": "Asia/Kolkata",
    }, headers={"Authorization": ""})
    assert taken.status_code == 201, taken.text

    res = await client.post("/api/auth/change-email/confirm", json={"code": code})
    assert res.status_code == 409
    assert (await me(client))["email"] == OLD


@pytest.mark.asyncio
async def test_guessing_is_capped_and_then_the_code_is_burned(ctx):
    from app.routers.auth import VERIFY_MAX_ATTEMPTS

    client, _, sent = ctx
    await start(client)
    real = sent["codes"][-1][1]
    wrong = "000000" if real != "000000" else "111111"
    for _ in range(VERIFY_MAX_ATTEMPTS):
        assert (await client.post("/api/auth/change-email/confirm", json={"code": wrong})).status_code == 400
    assert (await client.post("/api/auth/change-email/confirm", json={"code": wrong})).status_code == 429

    # The right code no longer works either; waiting out a counter gets nothing.
    after = await client.post("/api/auth/change-email/confirm", json={"code": real})
    assert after.status_code in (400, 429)
    assert (await me(client))["email"] == OLD


@pytest.mark.asyncio
async def test_an_expired_code_is_refused(ctx):
    client, factory, sent = ctx
    await start(client)
    async with factory() as db:
        user = (await db.execute(select(User).where(User.email == OLD))).scalar_one()
        user.email_change_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db.commit()
    res = await client.post("/api/auth/change-email/confirm", json={"code": sent["codes"][-1][1]})
    assert res.status_code == 400
    assert "expired" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_confirming_without_starting_is_refused(ctx):
    client, _, _ = ctx
    res = await client.post("/api/auth/change-email/confirm", json={"code": "123456"})
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_asking_again_at_once_does_not_send_again(ctx):
    client, _, sent = ctx
    await start(client)
    again = await start(client)
    assert again.status_code == 200
    assert again.json()["retry_after_seconds"] > 0
    assert len(sent["codes"]) == 1


@pytest.mark.asyncio
async def test_it_needs_a_session(ctx):
    client, _, sent = ctx
    res = await client.post("/api/auth/change-email/start",
                            json={"new_email": NEW, "password": PASSWORD},
                            headers={"Authorization": ""})
    assert res.status_code in (401, 403)
    assert sent["codes"] == []
