"""Sending the one email this app needs to send.

Deliberately tiny and provider-shaped rather than SMTP: Resend is one HTTPS
POST with one header, which is the whole integration, and it works from a
container with no mail configuration at all.

WITHOUT a key configured, the code is written to the application log instead of
being sent. That is not a silent failure - it is what makes the flow testable
before anyone signs up for anything, and the log line says plainly that no
email went out. It must never be the configuration in production, so
`delivery_configured()` exists for a health check to assert on.
"""
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"

# Resend requires a verified domain for anything else; this address works from
# a fresh account with nothing set up, which keeps first-run friction at zero.
DEFAULT_FROM = "MONEVA <onboarding@resend.dev>"


def _smtp_settings() -> Optional[dict]:
    """SMTP configuration, or None when it is not fully set."""
    host = (os.getenv("SMTP_HOST") or "").strip()
    user = (os.getenv("SMTP_USER") or "").strip()
    password = (os.getenv("SMTP_PASSWORD") or "").strip()
    if not (host and user and password):
        return None
    return {
        "host": host,
        "port": int((os.getenv("SMTP_PORT") or "587").strip()),
        "user": user,
        "password": password,
        "from": (os.getenv("RESET_EMAIL_FROM") or f"MONEVA <{user}>").strip(),
    }


def delivery_configured() -> bool:
    """True when a real email can actually be sent, by either route."""
    return _smtp_settings() is not None or bool((os.getenv("RESEND_API_KEY") or "").strip())


def _send_over_smtp(settings: dict, to_email: str, text: str, html: str) -> bool:
    """
    Blocking send. Called from a worker thread - see send_password_reset.

    stdlib smtplib rather than an async SMTP library: this is one short email
    on a path that already waits on a database, and it keeps the deployment to
    the packages already in requirements.txt.
    """
    import smtplib
    from email.message import EmailMessage

    message = EmailMessage()
    message["Subject"] = "Your MONEVA password reset code"
    message["From"] = settings["from"]
    message["To"] = to_email
    message.set_content(text)
    message.add_alternative(html, subtype="html")

    # 465 is implicit TLS; anything else (587) starts plain and upgrades.
    if settings["port"] == 465:
        with smtplib.SMTP_SSL(settings["host"], settings["port"], timeout=20) as server:
            server.login(settings["user"], settings["password"])
            server.send_message(message)
    else:
        with smtplib.SMTP(settings["host"], settings["port"], timeout=20) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(settings["user"], settings["password"])
            server.send_message(message)
    return True


def _body(code: str, minutes: int) -> tuple[str, str]:
    text = (
        f"Your MONEVA password reset code is {code}\n\n"
        f"Type it into the app to choose a new password. It expires in "
        f"{minutes} minutes and can only be used once.\n\n"
        "If you did not ask to reset your password, you can ignore this email "
        "- your password has not changed."
    )
    html = (
        '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:420px">'
        '<p style="font-size:15px;color:#333">Your MONEVA password reset code is</p>'
        f'<p style="font-size:32px;font-weight:800;letter-spacing:.18em;margin:16px 0">{code}</p>'
        f'<p style="font-size:14px;color:#555">Type it into the app to choose a new password. '
        f'It expires in {minutes} minutes and can only be used once.</p>'
        '<p style="font-size:13px;color:#888">If you did not ask to reset your password, '
        'ignore this email - your password has not changed.</p>'
        '</div>'
    )
    return text, html


def _log_code_if_stranded(to_email: str, code: str) -> None:
    """
    Last resort when a CONFIGURED mail route fails: put the code in the log.

    Without this the code is lost - it exists only as a hash in the database,
    the email never arrived, and the person is stuck until it expires. That is
    exactly what happened while the Gmail credentials were being sorted out.

    Off in production, because a log is not the right home for a live reset
    code and production logs are frequently shipped somewhere else. Set
    RESET_LOG_CODE_ON_FAILURE=true to force it on for a deliberate diagnosis.
    """
    forced = (os.getenv("RESET_LOG_CODE_ON_FAILURE") or "").strip().lower() in {"1", "true", "yes"}
    is_production = (os.getenv("ENVIRONMENT") or "").strip().lower() == "production"
    if not forced and is_production:
        logger.error(
            "Reset code for %s could not be delivered and was NOT logged "
            "(production). Fix mail delivery, then ask the user to try again.",
            masked(to_email),
        )
        return
    logger.warning(
        "Mail delivery failed, so the code is written here instead. "
        "Password reset code for %s: %s", to_email, code,
    )


async def send_password_reset(to_email: str, code: str, minutes: int = 30) -> bool:
    """
    Sends the reset code. Returns whether it actually went out.

    Never raises: the caller answers the same way whether or not delivery
    worked, because telling the client that sending failed for THIS address
    would confirm the address exists.
    """
    text, html = _body(code, minutes)

    # SMTP first when it is configured: it is the explicit choice, and a host
    # that has both set almost certainly means the one it just set up.
    smtp = _smtp_settings()
    if smtp:
        try:
            import asyncio
            # smtplib blocks, and blocking here would stall the whole event
            # loop for the length of an SMTP conversation.
            await asyncio.to_thread(_send_over_smtp, smtp, to_email, text, html)
            return True
        except Exception as exc:  # noqa: BLE001 - delivery must not break the request
            # Type and message only. An SMTP error can quote the envelope but
            # never the password, and the password is never interpolated here.
            logger.error("Reset email over SMTP failed for %s: %s: %s",
                         masked(to_email), type(exc).__name__, str(exc)[:160])
            _log_code_if_stranded(to_email, code)
            return False

    api_key = (os.getenv("RESEND_API_KEY") or "").strip()

    if not api_key:
        # The code is logged, not sent. Fine for development, and the warning
        # is deliberately loud so this cannot be mistaken for working delivery.
        logger.warning(
            "RESEND_API_KEY is not set - no email sent. Password reset code for %s: %s",
            to_email, code,
        )
        return False

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(
                RESEND_ENDPOINT,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "from": os.getenv("RESET_EMAIL_FROM", DEFAULT_FROM),
                    "to": [to_email],
                    "subject": "Your MONEVA password reset code",
                    "text": text,
                    "html": html,
                },
            )
        if res.status_code >= 400:
            # The body can name the cause (unverified domain, bad key). It does
            # not contain the key, but it is truncated regardless.
            logger.error("Reset email rejected: %s %s", res.status_code, res.text[:200])
            return False
        return True
    except Exception as exc:  # noqa: BLE001 - delivery must never break the request
        logger.error("Reset email could not be sent: %s", type(exc).__name__)
        return False


def masked(email: Optional[str]) -> str:
    """`r****l@example.com`, for logs that should not carry a full address."""
    if not email or "@" not in email:
        return "<none>"
    local, _, domain = email.partition("@")
    if len(local) <= 2:
        return f"{local[0]}*@{domain}"
    return f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}@{domain}"
