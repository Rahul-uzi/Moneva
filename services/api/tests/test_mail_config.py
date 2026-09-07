"""Reading the mail configuration, and surviving how it is really typed.

Both of these come from one afternoon of a password reset silently not
arriving. The endpoint answered "a reset code is on its way" every time,
because it must answer identically whether the send worked or the login was
refused - otherwise it would confirm which addresses have accounts. In
production a failed send does not log the code either. So the deployment was
broken in a way that produced no signal anywhere.

Two answers: stop the most common way it breaks, and publish enough to name
the wrong variable without publishing anything worth stealing.
"""
import os

import pytest

from app.services.mailer import (
    _normalise_app_password,
    _smtp_settings,
    delivery_configured,
    delivery_status,
)

MAIL_VARS = ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD",
             "RESET_EMAIL_FROM", "RESEND_API_KEY")


@pytest.fixture
def env(monkeypatch):
    """A clean mail environment, so a developer's own .env cannot leak in."""
    for name in MAIL_VARS:
        monkeypatch.delenv(name, raising=False)

    def configure(**values):
        for name, value in values.items():
            monkeypatch.setenv(name, value)

    return configure


class TestAppPasswordAsTyped:
    """Google shows sixteen letters as four groups of four. People paste that."""

    def test_the_display_format_is_accepted(self):
        assert _normalise_app_password("abcd efgh ijkl mnop") == "abcdefghijklmnop"

    def test_a_plain_app_password_is_untouched(self):
        assert _normalise_app_password("abcdefghijklmnop") == "abcdefghijklmnop"

    def test_a_passphrase_with_spaces_is_untouched(self):
        # The rule is narrow on purpose: for a provider that is not Google,
        # a space may be part of the secret, and eating it would break a
        # working deployment to fix a Gmail-shaped mistake.
        assert _normalise_app_password("correct horse battery staple") == \
            "correct horse battery staple"

    def test_a_nearly_right_shape_is_untouched(self):
        assert _normalise_app_password("abcd efgh ijkl") == "abcd efgh ijkl"
        assert _normalise_app_password("abcd efgh ijkl mnopq") == "abcd efgh ijkl mnopq"

    def test_the_settings_carry_the_normalised_form(self, env):
        env(SMTP_HOST="smtp.gmail.com", SMTP_USER="a@example.com",
            SMTP_PASSWORD="abcd efgh ijkl mnop")
        assert _smtp_settings()["password"] == "abcdefghijklmnop"


class TestDeliveryStatus:
    """Enough to name the wrong variable. Nothing worth stealing."""

    def test_nothing_configured(self, env):
        status = delivery_status()
        assert status["configured"] is False
        assert status["route"] == "none"
        assert status["from_matches_user"] is None

    def test_a_correct_setup_reads_as_correct(self, env):
        env(SMTP_HOST="smtp.gmail.com", SMTP_USER="a@example.com",
            SMTP_PASSWORD="abcdefghijklmnop",
            RESET_EMAIL_FROM="MONEVA <a@example.com>")
        status = delivery_status()
        assert status == {
            "configured": True,
            "route": "smtp",
            "smtp_host_set": True,
            "smtp_user_set": True,
            "smtp_password_set": True,
            "smtp_password_looks_like_app_password": True,
            "from_matches_user": True,
        }

    def test_a_placeholder_pasted_into_the_password_is_visible(self, env):
        # The exact mistake this is here to catch: a value that is present -
        # so `configured` is true - but is prose rather than a secret.
        env(SMTP_HOST="smtp.gmail.com", SMTP_USER="a@example.com",
            SMTP_PASSWORD="a fresh Gmail app password",
            RESET_EMAIL_FROM="MONEVA <a@example.com>")
        status = delivery_status()
        assert status["configured"] is True
        assert status["smtp_password_looks_like_app_password"] is False

    def test_a_sender_that_disagrees_with_the_login_is_visible(self, env):
        # Gmail refuses to send as an address it does not own.
        env(SMTP_HOST="smtp.gmail.com", SMTP_USER="a@example.com",
            SMTP_PASSWORD="abcdefghijklmnop",
            RESET_EMAIL_FROM="MONEVA <noreply@elsewhere.example>")
        assert delivery_status()["from_matches_user"] is False

    def test_it_never_publishes_a_value(self, env):
        secret = "abcdefghijklmnop"
        env(SMTP_HOST="smtp.gmail.com", SMTP_USER="a@example.com",
            SMTP_PASSWORD=secret, RESET_EMAIL_FROM="MONEVA <a@example.com>")
        rendered = repr(delivery_status())
        assert secret not in rendered
        assert "smtp.gmail.com" not in rendered
        assert "a@example.com" not in rendered
        # Not even the length, which would narrow a guess for no real benefit.
        assert str(len(secret)) not in rendered

    def test_resend_is_reported_when_it_is_the_only_route(self, env):
        env(RESEND_API_KEY="re_something")
        status = delivery_status()
        assert status["route"] == "resend"
        assert status["configured"] is True
        assert delivery_configured() is True


@pytest.mark.asyncio
async def test_health_endpoint_carries_the_mail_status(env):
    """The whole point: one call to /api/health names the broken variable."""
    from httpx import ASGITransport, AsyncClient

    from main import app

    env(SMTP_HOST="smtp.gmail.com", SMTP_USER="a@example.com",
        SMTP_PASSWORD="not-an-app-password",
        RESET_EMAIL_FROM="MONEVA <a@example.com>")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/health")

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "healthy"
    assert body["email"]["configured"] is True
    assert body["email"]["smtp_password_looks_like_app_password"] is False
    assert "not-an-app-password" not in res.text
