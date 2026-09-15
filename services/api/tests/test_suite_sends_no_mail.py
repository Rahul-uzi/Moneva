"""The suite must not put mail on the wire.

This is the test that would have caught it. Running the suite used to send
genuine email through the Gmail credentials in .env to two addresses that do
not exist, and the only evidence was a bounce arriving in a real inbox
minutes later - nothing failed, nothing was logged, and the suite went green.

So the check is made explicit and it runs with the others: reach for the real
delivery path on purpose and require it to be refused. If someone removes
tests/conftest.py, weakens the fixture, or adds a route around it, this fails
in the terminal rather than in somebody's mailbox.
"""
import smtplib

import pytest

from app.services import mailer

pytestmark = pytest.mark.asyncio


async def test_the_reset_mailer_delivers_nothing(never_send_real_mail):
    """The exact call that was reaching Gmail."""
    ok = await mailer.send_password_reset("reset.subject@example.com", "123456", 30)
    # False, and that is the point: with no credentials the mailer has nothing
    # to reach, so it reports the send as not delivered rather than pretending.
    assert ok is False, "a send with no transport configured must not claim success"
    assert never_send_real_mail == [
        {"to": "reset.subject@example.com",
         "subject": "Your MONEVA password reset code",
         "code": "123456"},
    ]


async def test_the_verification_mailer_delivers_nothing(never_send_real_mail):
    await mailer.send_email_verification("verify@example.com", "654321", 30)
    assert [m["to"] for m in never_send_real_mail] == ["verify@example.com"]
    assert never_send_real_mail[0]["code"] == "654321"


async def test_a_raw_smtp_connection_is_refused():
    """The second layer, for anything that gets past the first.

    Not hypothetical: the mailer opens smtplib directly, and a future helper
    that did the same without going through _deliver would slip the net.

    Matched on the message rather than the class. pytest can load a conftest
    under two names - as `conftest` and as `tests.conftest` - and the guard
    class is then two distinct objects, so importing it here and catching it
    would miss the one actually raised. Discovered by this test failing with
    the very exception it was asking for.
    """
    with pytest.raises(RuntimeError, match="real SMTP connection"):
        smtplib.SMTP("smtp.gmail.com", 587, timeout=1)
    with pytest.raises(RuntimeError, match="real SMTP connection"):
        smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=1)


async def test_no_transport_is_configured_during_a_test_run(never_send_real_mail):
    """The property the whole guard rests on.

    Delivery is stopped by removing the credentials, not by replacing the
    mailer, so this is the assertion that says the credentials are really
    gone. If .env leaks back in - a new variable name, a settings object read
    some other way - mail starts flowing again and this is what notices.
    """
    assert mailer.delivery_configured() is False
    assert mailer._smtp_settings() is None
