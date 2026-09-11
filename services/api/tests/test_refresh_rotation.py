"""Refresh tokens are single-use, and reuse ends the session.

WHAT THIS IS PROTECTING AGAINST.

A refresh token used to be valid for sixty days and reusable without limit.
Stolen once - off a backed-up device, out of storage on a rooted phone - it
granted sixty days of access that nothing could detect. The owner stayed signed
in the whole time, because a thief using the token did not disturb their
session. There was no signal to notice.

Rotation does not stop the theft; it bounds it, and then it makes the theft
announce itself. That second half is the part these tests are mostly about, and
it is the part that would still "work" if it were quietly broken - a passing
sign-in flow says nothing about whether a retired token is actually refused.

The awkward property of this feature is that it is invisible when correct and
also invisible when absent. Only a test that presents an already-spent token
can tell the difference.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from main import app
from app.db.database import get_db
from app.models.models import Base

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

PASSWORD = "Jhelum-Ferry-1892"


@pytest_asyncio.fixture
async def api_client():
    """A fresh database AND fresh rate-limit counters.

    The counters are module-level and in-process, so they survive between
    tests: every test in the run signs in from the same client IP, and by the
    time this file executes the login limiter has been tripped by other files.
    That produced a failure that appeared only in the full suite and never when
    this file was run alone - which is the most misleading way for a test to
    fail, because the obvious reading is that the feature is order-dependent.

    Reset here rather than in the limiter itself: production wants exactly this
    persistence, and a limiter that forgot its counters on demand would be no
    limiter at all.
    """
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
        yield client

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def register(client: AsyncClient, email: str = "rotate@example.com") -> dict:
    res = await client.post("/api/auth/register", json={
        "email": email,
        "password": PASSWORD,
        "display_name": "Rotation Test",
        "currency": "INR",
        "timezone": "Asia/Kolkata",
    })
    assert res.status_code == 201, res.text
    return res.json()


async def refresh(client: AsyncClient, token: str):
    return await client.post("/api/auth/refresh", json={"refresh_token": token})


@pytest.mark.asyncio
async def test_a_refresh_returns_a_different_token(api_client: AsyncClient):
    """Rotation at its most basic: the token you get back is not the one you sent.

    Worth asserting explicitly, because the endpoint returned a valid pair both
    before and after this change. Only the identity of the refresh token tells
    you which behaviour you have.
    """
    first = await register(api_client)
    res = await refresh(api_client, first["refresh_token"])
    assert res.status_code == 200, res.text
    assert res.json()["refresh_token"] != first["refresh_token"]


@pytest.mark.asyncio
async def test_the_new_token_works(api_client: AsyncClient):
    # Rotation is worthless if the successor cannot itself be exchanged - that
    # would sign everyone out after one refresh.
    first = await register(api_client)
    second = (await refresh(api_client, first["refresh_token"])).json()
    third = await refresh(api_client, second["refresh_token"])
    assert third.status_code == 200, third.text


@pytest.mark.asyncio
async def test_a_chain_of_refreshes_keeps_working(api_client: AsyncClient):
    # Five in a row, because an off-by-one in the family bookkeeping would
    # plausibly survive a single hop and fail on the second or third.
    token = (await register(api_client))["refresh_token"]
    for hop in range(5):
        res = await refresh(api_client, token)
        assert res.status_code == 200, f"hop {hop}: {res.text}"
        token = res.json()["refresh_token"]


@pytest.mark.asyncio
async def test_a_spent_token_is_refused(api_client: AsyncClient):
    """THE test. A retired token presented again must not mint anything.

    This is the whole feature. If this passes when the mechanism is removed,
    nothing else here means anything.
    """
    first = await register(api_client)
    spent = first["refresh_token"]

    assert (await refresh(api_client, spent)).status_code == 200

    again = await refresh(api_client, spent)
    assert again.status_code == 401, again.text


@pytest.mark.asyncio
async def test_reuse_ends_the_whole_family(api_client: AsyncClient):
    """The response to theft, and the reason it is not merely "refuse the old one".

    When a spent token comes back, two parties hold credentials descended from
    one sign-in, and nothing in the request says which is the owner. Refusing
    only the replayed token would leave whoever holds the CURRENT one signed in
    - and that may well be the thief, since the thief may have refreshed first.

    So both are disbelieved. The legitimate device's live token stops working
    too, which is the point: the owner is made to sign in again, and therefore
    finds out.
    """
    first = await register(api_client)
    live = (await refresh(api_client, first["refresh_token"])).json()["refresh_token"]

    # The thief replays the spent one.
    assert (await refresh(api_client, first["refresh_token"])).status_code == 401

    # The owner's still-unused token is now dead as well.
    after = await refresh(api_client, live)
    assert after.status_code == 401, after.text


@pytest.mark.asyncio
async def test_the_refusal_does_not_explain_itself(api_client: AsyncClient):
    """Says the session ended; does not say how that was noticed.

    The owner needs to know it was deliberate rather than a glitch. Whoever
    else holds the token should learn nothing about the mechanism - in
    particular, nothing that distinguishes "reuse detected" from an ordinary
    expiry, which would confirm to an attacker that their replay was seen.
    """
    first = await register(api_client)
    await refresh(api_client, first["refresh_token"])
    res = await refresh(api_client, first["refresh_token"])

    detail = res.json().get("detail", "").lower()
    assert "sign in again" in detail
    for leak in ("reuse", "replay", "family", "jti", "detected"):
        assert leak not in detail, f"the refusal names its own mechanism: {detail!r}"


@pytest.mark.asyncio
async def test_two_devices_do_not_interfere(api_client: AsyncClient):
    """Separate sign-ins are separate families.

    A phone and a laptop each refresh on their own schedule. If they shared a
    family, one device's ordinary refresh would look like reuse to the other
    and both would be signed out - constantly, and for no reason.
    """
    await register(api_client, "twodevices@example.com")

    creds = {"email": "twodevices@example.com", "password": PASSWORD}
    phone = (await api_client.post("/api/auth/login", json=creds)).json()
    laptop = (await api_client.post("/api/auth/login", json=creds)).json()

    assert (await refresh(api_client, phone["refresh_token"])).status_code == 200
    # The laptop has done nothing wrong and must be unaffected.
    assert (await refresh(api_client, laptop["refresh_token"])).status_code == 200


@pytest.mark.asyncio
async def test_reuse_on_one_device_leaves_the_other_alone(api_client: AsyncClient):
    # Revocation is scoped to the family, not the account. A compromise on one
    # device should not sign the person out of every other one - that would
    # make the feature something users learn to dread.
    await register(api_client, "scoped@example.com")
    creds = {"email": "scoped@example.com", "password": PASSWORD}

    phone = (await api_client.post("/api/auth/login", json=creds)).json()
    laptop = (await api_client.post("/api/auth/login", json=creds)).json()

    await refresh(api_client, phone["refresh_token"])
    assert (await refresh(api_client, phone["refresh_token"])).status_code == 401

    assert (await refresh(api_client, laptop["refresh_token"])).status_code == 200


@pytest.mark.asyncio
async def test_a_token_from_before_rotation_still_works(api_client: AsyncClient):
    """Nobody is signed out by the deploy that adds this.

    Every refresh token in the wild when this ships carries no jti and has no
    row. Treating that as an attack would sign out the entire user base on
    upgrade. It is adopted into a fresh family instead.
    """
    from app.core.security import create_refresh_token

    tokens = await register(api_client, "legacy@example.com")
    from app.core.security import decode_token
    sub = decode_token(tokens["refresh_token"])["sub"]

    # Exactly the old shape: subject and token version, no jti.
    legacy = create_refresh_token(data={"sub": sub, "tv": 0})

    res = await refresh(api_client, legacy)
    assert res.status_code == 200, res.text
    # And the replacement is tracked, so it rotates from here on.
    rotated = res.json()["refresh_token"]
    assert (await refresh(api_client, rotated)).status_code == 200
    assert (await refresh(api_client, rotated)).status_code == 401
