"""Nothing in this suite may send a real email.

WHAT HAPPENED. There was no conftest at all, so nothing stood between the
tests and the mailer. `services/api/.env` holds working Gmail SMTP
credentials - it has to, for the app to send anything - and pytest loads the
same settings the app does. Two test files register users at
`reset.subject@example.com` and `verify@example.com` and then exercise the
real endpoints, so every run posted genuine mail to two addresses that do not
exist. Gmail accepted them, failed to deliver, and returned a bounce to the
sending account.

The result was a real inbox filling with "Your MONEVA password reset code -
Address not found", a pair per run, with nobody having touched the app. The
throttle on /auth/forgot-password does not help here: these are not resends,
they are separate tests, each legitimately asking for one code.

THE FIX IS A FLOOR, NOT A PATCH IN TWO FILES. Repairing only the two files
that happen to do it today leaves the next test free to do it again, and the
failure is silent - the suite passes either way and the evidence lands in a
mailbox nobody reads during a test run. So this is autouse: it applies to
every test here whether or not the author thought about mail.

IT CUTS AT CONFIGURATION, NOT AT THE MAILER. The first attempt replaced
`_deliver`, the funnel every send passes through. That stopped the mail and
broke ten tests in test_mail_config.py, which exist to test `_deliver` itself
- its SMTP-to-relay fallback, its redirect handling, its refusal to print a
code in production. Those need the real function.

Removing the CREDENTIALS instead leaves every line of that logic running and
simply gives it no transport to reach: `_deliver` finds no SMTP settings, no
relay and no API key, and sends nothing. A test that wants a transport sets
one with monkeypatch, which is applied after this fixture and wins - which is
exactly how test_mail_config already works.

`_deliver` is still wrapped, but only to record. It delegates to the real one.
"""
import smtplib

import pytest

# Everything the mailer reads to decide it can send. Missing one would leave a
# live route open, which is the whole failure being prevented here.
DELIVERY_ENV = (
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "MAIL_RELAY_URL",
    "MAIL_RELAY_TOKEN",
    "RESEND_API_KEY",
)


@pytest.fixture(autouse=True)
def never_send_real_mail(monkeypatch):
    """Leave the mailer no way out, and record what it tried to send.

    Yields the list of attempted sends, so a test that cares can assert on it:

        def test_x(never_send_real_mail):
            ...
            assert never_send_real_mail[0]["to"] == "someone@example.com"
    """
    for name in DELIVERY_ENV:
        monkeypatch.delenv(name, raising=False)

    # Also clear the parsed settings object, which reads the environment once
    # at import. Deleting the variables alone would leave a live host and
    # password sitting on it for anything that consults it instead of getenv.
    try:
        from app.core.config import settings as _settings
        for name in DELIVERY_ENV:
            if hasattr(_settings, name):
                monkeypatch.setattr(_settings, name, None, raising=False)
            lower = name.lower()
            if hasattr(_settings, lower):
                monkeypatch.setattr(_settings, lower, None, raising=False)
    except Exception:  # noqa: BLE001 - the guard must not depend on this shape
        pass

    from app.services import mailer

    attempted: list[dict] = []
    real_deliver = mailer._deliver

    async def _record_then_delegate(to_email, subject, text, html, code):
        attempted.append({"to": to_email, "subject": subject, "code": code})
        # Delegates on purpose. With no credentials there is nothing for the
        # real function to reach, and running it keeps the tests that examine
        # its behaviour honest instead of measuring this fixture.
        return await real_deliver(to_email, subject, text, html, code)

    monkeypatch.setattr(mailer, "_deliver", _record_then_delegate)

    def _no_sockets(*args, **kwargs):
        raise RuntimeError(
            "A test tried to open a real SMTP connection. Mail is disabled in "
            "the suite - see tests/conftest.py. If this test is meant to "
            "exercise smtplib, stub it in the test itself."
        )

    # The backstop, for anything that reaches a socket without consulting the
    # settings above. A test that drives the SMTP fallback installs its own
    # stub with monkeypatch, which is applied after this and takes precedence.
    monkeypatch.setattr(smtplib, "SMTP", _no_sockets)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _no_sockets)

    yield attempted
