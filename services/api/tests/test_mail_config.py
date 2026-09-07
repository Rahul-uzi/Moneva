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
        from app.services import mailer
        mailer._remember_send.__globals__["_last_send_succeeded"] = None

        status = delivery_status()
        # Pinned whole rather than key by key: this payload is read by a human
        # under pressure, and a key quietly appearing or vanishing changes what
        # they conclude.
        assert status == {
            "configured": True,
            "working": True,
            "last_send_succeeded": None,
            "relay_set": False,
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


class TestSmtpPortFallback:
    """A blocked port hangs; it does not refuse. So try the other one.

    Measured on the real deployment: correct Gmail credentials that log in
    from a laptop in 2.02s produced a connection from the host that sat there
    until the socket timed out ~20s later, and no mail was ever sent. Nothing
    in any log said "blocked" - there is no such signal.
    """

    def _settings(self, port):
        return {"host": "smtp.example", "port": port, "user": "a@example.com",
                "password": "abcdefghijklmnop", "from": "MONEVA <a@example.com>"}

    def test_it_falls_back_to_the_other_port(self, monkeypatch):
        import smtplib

        from app.services import mailer

        attempted = []

        class _Blocked:
            def __init__(self, host, port, timeout=None):
                attempted.append(port)
                raise TimeoutError("no answer")

        class _Works:
            def __init__(self, host, port, timeout=None):
                attempted.append(port)
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def login(self, *a): pass
            def send_message(self, *a): pass

        monkeypatch.setattr(smtplib, "SMTP", _Blocked)       # 587 blocked
        monkeypatch.setattr(smtplib, "SMTP_SSL", _Works)     # 465 open

        assert mailer._send_over_smtp(self._settings(587), "b@example.com", "t", "<p>t</p>")
        assert attempted == [587, 465], attempted

    def test_bad_credentials_do_not_retry_on_another_port(self, monkeypatch):
        import smtplib

        from app.services import mailer

        attempted = []

        class _Refuses:
            def __init__(self, host, port, timeout=None):
                attempted.append(port)
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def ehlo(self): pass
            def starttls(self): pass
            def login(self, *a):
                raise smtplib.SMTPAuthenticationError(535, b"Username and Password not accepted")
            def send_message(self, *a): pass

        monkeypatch.setattr(smtplib, "SMTP", _Refuses)

        with pytest.raises(smtplib.SMTPAuthenticationError):
            mailer._send_over_smtp(self._settings(587), "b@example.com", "t", "<p>t</p>")
        # A rejected password is rejected everywhere. Trying a second port
        # would only delay saying so, and looks like a login attempt storm.
        assert attempted == [587], attempted

    def test_every_port_failing_raises_the_last_error(self, monkeypatch):
        import smtplib

        from app.services import mailer

        class _Blocked:
            def __init__(self, host, port, timeout=None):
                raise TimeoutError("no answer")

        monkeypatch.setattr(smtplib, "SMTP", _Blocked)
        monkeypatch.setattr(smtplib, "SMTP_SSL", _Blocked)

        with pytest.raises(TimeoutError):
            mailer._send_over_smtp(self._settings(587), "b@example.com", "t", "<p>t</p>")


class TestPortProbe:
    def test_it_reports_a_blocked_port_without_raising(self, monkeypatch):
        import socket

        from app.services import mailer

        def _blocked(address, timeout=None):
            raise TimeoutError("nothing there")

        monkeypatch.setattr(socket, "create_connection", _blocked)
        result = mailer.probe_smtp_ports("smtp.example")
        assert result["any_open"] is False
        assert result["ports"]["587"]["open"] is False
        assert result["ports"]["587"]["error"] == "TimeoutError"

    def test_it_never_touches_a_credential(self, monkeypatch):
        # A bare TCP connect. If this ever grew a login, the probe would become
        # something you could not safely expose.
        from app.services import mailer

        monkeypatch.setenv("SMTP_PASSWORD", "abcdefghijklmnop")
        assert "abcdefghijklmnop" not in repr(mailer.probe_smtp_ports("smtp.example"))


class TestTheScreenIsNotToldALie:
    """`configured` and `working` are different questions.

    On a host that blocks SMTP every variable is set, so `configured` is true
    and the app told the person "a reset code is on its way" for a code that
    could never leave. `working` is what the screen should be shown.
    """

    def setup_method(self):
        from app.services import mailer
        mailer._remember_send.__globals__["_last_send_succeeded"] = None

    def test_a_configured_route_is_taken_at_its_word_at_first(self, env):
        from app.services import mailer
        env(SMTP_HOST="smtp.gmail.com", SMTP_USER="a@example.com",
            SMTP_PASSWORD="abcdefghijklmnop")
        assert mailer.delivery_working() is True

    def test_after_a_failure_it_stops_promising(self, env):
        from app.services import mailer
        env(SMTP_HOST="smtp.gmail.com", SMTP_USER="a@example.com",
            SMTP_PASSWORD="abcdefghijklmnop")
        mailer._remember_send(False)
        assert mailer.delivery_configured() is True   # the variables are fine
        assert mailer.delivery_working() is False     # the mail is not

    def test_it_recovers_on_the_next_success(self, env):
        from app.services import mailer
        env(SMTP_HOST="smtp.gmail.com", SMTP_USER="a@example.com",
            SMTP_PASSWORD="abcdefghijklmnop")
        mailer._remember_send(False)
        mailer._remember_send(True)
        assert mailer.delivery_working() is True

    def test_nothing_configured_is_never_working(self, env):
        from app.services import mailer
        mailer._remember_send(True)
        assert mailer.delivery_working() is False


class TestHttpsRelay:
    """A relay you host yourself, because port 443 is never blocked."""

    def test_https_is_required(self, env, monkeypatch):
        from app.services import mailer
        monkeypatch.setenv("MAIL_RELAY_URL", "http://example.com/mail")
        # Plain HTTP would put a live reset code on the wire in clear.
        assert mailer._relay_settings() is None

    def test_an_https_url_configures_it(self, env, monkeypatch):
        from app.services import mailer
        monkeypatch.setenv("MAIL_RELAY_URL", "https://script.google.com/macros/s/abc/exec")
        monkeypatch.setenv("MAIL_RELAY_TOKEN", "shared-secret")
        settings = mailer._relay_settings()
        assert settings["url"].startswith("https://")
        assert settings["token"] == "shared-secret"
        assert mailer.delivery_configured() is True
        assert mailer.delivery_status()["route"] == "relay"
        assert mailer.delivery_status()["relay_set"] is True

    @pytest.mark.asyncio
    async def test_the_relay_is_used_when_smtp_is_blocked(self, env, monkeypatch):
        import httpx as _httpx

        from app.services import mailer

        env(SMTP_HOST="smtp.gmail.com", SMTP_USER="a@example.com",
            SMTP_PASSWORD="abcdefghijklmnop")
        monkeypatch.setenv("MAIL_RELAY_URL", "https://relay.example/exec")
        monkeypatch.setenv("MAIL_RELAY_TOKEN", "s3cret")

        # Exactly what Render does: the kernel refuses the outbound socket.
        def _blocked(*_a, **_k):
            raise OSError(101, "Network is unreachable")

        monkeypatch.setattr(mailer, "_send_over_smtp", _blocked)

        posted = {}

        class _FakeClient:
            def __init__(self, *a, **k): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def post(self, url, json=None, **k):
                posted["url"] = url
                posted["json"] = json
                return _httpx.Response(200, text="OK")

        monkeypatch.setattr(mailer.httpx, "AsyncClient", _FakeClient)

        assert await mailer.send_password_reset("b@example.com", "123456") is True
        assert posted["url"] == "https://relay.example/exec"
        assert posted["json"]["to"] == "b@example.com"
        assert posted["json"]["token"] == "s3cret"
        assert "123456" in posted["json"]["text"]
        # A send that worked must clear the "do not promise mail" state.
        assert mailer.delivery_working() is True


class TestARelayMustConfirmTheSend:
    """Apps Script answers 200 to everything, including what it refused.

    Trusting the status code here would have recreated the exact failure this
    whole exercise was about: a send that reports success and never arrives.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("body,expected", [
        ("OK", True),
        ("ok", True),
        ("OK sent", True),
        ("forbidden", False),          # wrong shared token
        ("error: Invalid email", False),
        ("", False),
        ("<!DOCTYPE html><html>Google sign-in</html>", False),  # deploy not public
    ])
    async def test_only_an_explicit_ok_counts(self, env, monkeypatch, body, expected):
        import httpx as _httpx

        from app.services import mailer

        mailer._remember_send.__globals__["_last_send_succeeded"] = None
        monkeypatch.setenv("MAIL_RELAY_URL", "https://relay.example/exec")

        class _FakeClient:
            def __init__(self, *a, **k): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def post(self, url, json=None, **k):
                return _httpx.Response(200, text=body)

        monkeypatch.setattr(mailer.httpx, "AsyncClient", _FakeClient)
        assert await mailer.send_password_reset("b@example.com", "123456") is expected
