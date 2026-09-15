"""Stopping the password-reset email from filling somebody's inbox.

WHAT WENT WRONG. The endpoint was rationed to four sends an hour per account
and nothing else. Nothing stopped those four arriving within four seconds, and
three separate things pushed them to:

  - the client RETRIES a forgot-password that timed out, deliberately, because
    a sleeping instance takes longer to wake than the request takes to give up.
    One tap could already post twice.
  - the screen had no countdown and no resend button, so somebody waiting on
    an email that had not arrived went back and sent again.
  - every send REPLACED the previous code, so the code in the first email
    stopped working - which invites another tap, and another.

The in-memory limiter could not have fixed it either: its counters live in the
worker, and a free instance that sleeps when idle starts the allowance over on
every wake. Hence a column.

THE THING THAT MAKES THIS DELICATE. `/auth/forgot-password` answers
identically whether or not an address has an account - that is what stops it
being used to find out who has one. A cooldown is a per-account fact, so the
obvious implementations leak: a 429 only real users can trigger, or a
retry_after that counts down only for them. The last class of test below is
about that, and it matters more than the throttle itself.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.ratelimit import FORGOT_BY_ACCOUNT, FORGOT_BY_IP
from app.core.security import hash_password
from app.db.database import get_db
from app.models.models import Base, User
from app.routers.auth import RESET_RESEND_SECONDS
from main import app

pytestmark = pytest.mark.asyncio

EMAIL = "floodme@example.com"
PASSWORD = "FloodMePass123"
UNKNOWN = "nobody-at-all@example.com"


@pytest_asyncio.fixture
async def api(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async def _db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _db

    # Count the mails instead of sending them. The queued task is what proves
    # a send happened; the response deliberately says the same either way.
    sent: list[str] = []

    async def _capture(to_email, code, minutes=30):
        sent.append(to_email)
        return True

    monkeypatch.setattr("app.routers.auth.send_password_reset", _capture)

    # The sliding windows are module-level and outlive a test, so a previous
    # one's hits would exhaust the allowance here and the test would pass for
    # entirely the wrong reason.
    FORGOT_BY_IP._hits.clear()
    FORGOT_BY_ACCOUNT._hits.clear()

    user_id = uuid.uuid4()
    async with factory() as session:
        session.add(User(id=user_id, email=EMAIL, password_hash=hash_password(PASSWORD),
                         display_name="Flooded", currency="INR"))
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, factory, sent, str(user_id)

    app.dependency_overrides.clear()


async def _ask(client, email=EMAIL):
    return await client.post("/api/auth/forgot-password", json={"email": email})


class TestTheSecondRequestSendsNothing:
    async def test_one_ask_sends_one_mail(self, api):
        client, _f, sent, _u = api
        res = await _ask(client)
        assert res.status_code == 200, res.text
        assert sent == [EMAIL]

    async def test_asking_again_immediately_sends_nothing(self, api):
        """The whole point. Four permitted sends must not mean four emails."""
        client, _f, sent, _u = api
        for _ in range(4):
            await _ask(client)
        assert sent == [EMAIL], f"expected one mail, got {len(sent)}"

    async def test_the_retry_of_a_timed_out_request_is_absorbed(self, api):
        """The client resends a forgot-password that got no answer.

        That is deliberate - a waking instance outlasts the client's patience -
        but it means a request that DID arrive gets posted twice. The cooldown
        is what makes the retry harmless rather than a second email.
        """
        client, _f, sent, _u = api
        await _ask(client)
        await _ask(client)
        assert len(sent) == 1

    async def test_the_first_code_still_works_after_a_second_ask(self, api):
        """A refused resend must LEAVE the live code alone.

        If the second ask quietly issued a new code while sending no mail, the
        only code the person has - the one in the email that did arrive -
        would stop working, and nothing on screen would explain why.
        """
        client, factory, _s, user_id = api
        await _ask(client)
        async with factory() as session:
            before = (await session.execute(
                select(User).where(User.id == uuid.UUID(user_id)))).scalar_one()
            first_hash, first_expiry = before.reset_code_hash, before.reset_code_expires_at

        await _ask(client)
        async with factory() as session:
            after = (await session.execute(
                select(User).where(User.id == uuid.UUID(user_id)))).scalar_one()
        assert after.reset_code_hash == first_hash
        assert after.reset_code_expires_at == first_expiry

    async def test_a_send_is_allowed_once_the_gap_has_passed(self, api):
        """The cooldown delays a resend; it must not prevent one.

        Somebody whose first email genuinely went astray has to be able to ask
        again, so the clock is wound back rather than the rule relaxed.
        """
        client, factory, sent, user_id = api
        await _ask(client)
        async with factory() as session:
            user = (await session.execute(
                select(User).where(User.id == uuid.UUID(user_id)))).scalar_one()
            user.reset_code_sent_at = (
                datetime.now(timezone.utc) - timedelta(seconds=RESET_RESEND_SECONDS + 5))
            await session.commit()

        await _ask(client)
        assert len(sent) == 2


class TestItStillGivesNothingAway:
    """The property that constrains every line of the throttle."""

    async def test_an_unknown_address_gets_the_same_body(self, api):
        client, _f, _s, _u = api
        known = (await _ask(client)).json()
        unknown = (await _ask(client, UNKNOWN)).json()
        assert known == unknown

    async def test_an_address_in_cooldown_looks_like_an_unknown_one(self, api):
        """The subtle leak, and the reason retry_after is a constant.

        Reporting the time REMAINING would answer "has this address been sent
        a code in the last minute?" - which is to say, "does this address have
        an account?" - to anyone who cared to ask twice.
        """
        client, _f, _s, _u = api
        await _ask(client)                      # puts the real account into cooldown
        throttled = (await _ask(client)).json()
        unknown = (await _ask(client, UNKNOWN)).json()
        assert throttled == unknown

    async def test_the_status_code_never_differs(self, api):
        # A 429 for the real account and a 200 for an unknown one would be the
        # same tell, moved from the body to the status line.
        client, _f, _s, _u = api
        first = await _ask(client)
        throttled = await _ask(client)
        unknown = await _ask(client, UNKNOWN)
        assert first.status_code == throttled.status_code == unknown.status_code == 200

    async def test_the_countdown_is_offered_to_everyone(self, api):
        client, _f, _s, _u = api
        body = (await _ask(client, UNKNOWN)).json()
        assert body["retry_after_seconds"] == RESET_RESEND_SECONDS
