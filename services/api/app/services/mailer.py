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
import re
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"

# Resend requires a verified domain for anything else; this address works from
# a fresh account with nothing set up, which keeps first-run friction at zero.
DEFAULT_FROM = "MONEVA <onboarding@resend.dev>"


# Google shows an app password as four groups of four - "abcd efgh ijkl mnop" -
# and that is exactly what gets pasted into a settings field. The spaces are
# presentation only; the secret is the sixteen letters, and Gmail refuses the
# spaced form. The resulting failure is invisible from outside, because the
# reset endpoint answers identically whether the mail was sent or the login was
# refused, so this cost a long afternoon of guessing.
#
# Deliberately narrow: ONLY a value that is exactly four groups of four letters
# is touched. A password that merely happens to contain a space is left alone -
# for a provider that is not Google, that space may be part of the secret.
_APP_PASSWORD_SHAPE = re.compile(r"^[A-Za-z]{4}(?: [A-Za-z]{4}){3}$")


def _normalise_app_password(password: str) -> str:
    """An app password pasted in Google's display format, made usable."""
    return password.replace(" ", "") if _APP_PASSWORD_SHAPE.match(password) else password


def _smtp_settings() -> Optional[dict]:
    """SMTP configuration, or None when it is not fully set."""
    host = (os.getenv("SMTP_HOST") or "").strip()
    user = (os.getenv("SMTP_USER") or "").strip()
    password = _normalise_app_password((os.getenv("SMTP_PASSWORD") or "").strip())
    if not (host and user and password):
        return None
    return {
        "host": host,
        "port": int((os.getenv("SMTP_PORT") or "587").strip()),
        "user": user,
        "password": password,
        "from": (os.getenv("RESET_EMAIL_FROM") or f"MONEVA <{user}>").strip(),
    }


def _scrub(text: str, *addresses: Optional[str]) -> str:
    """
    Text from outside, with any address we know about replaced by its mask.

    Written for exception messages. A library is under no obligation to keep a
    recipient out of the string it raises, and smtplib does not: it puts the
    whole envelope in there. Masking the address in one log argument achieves
    nothing if the next argument spells it out.

    Belt and braces: the local part is replaced on its own too, so a message
    that quotes only "victim" rather than the full address is caught as well.
    """
    cleaned = text
    for address in addresses:
        if not address:
            continue
        cleaned = cleaned.replace(address, masked(address))
        local = address.partition("@")[0]
        if len(local) > 2:
            cleaned = cleaned.replace(local, f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}")
    return cleaned


def _relay_settings() -> Optional[dict]:
    """A self-hosted HTTPS relay, or None when it is not set."""
    url = (os.getenv("MAIL_RELAY_URL") or "").strip()
    if not url.startswith("https://"):
        # Plain HTTP would put the reset code on the wire in clear.
        return None
    return {"url": url, "token": (os.getenv("MAIL_RELAY_TOKEN") or "").strip()}


# Whether the last attempt actually delivered. None until one is tried.
#
# `delivery_configured()` answers "is a route set up", which is what the health
# check wants. It is the wrong question to put to a person: on a host that
# blocks SMTP, every variable is set, so the app told them "a reset code is on
# its way" for a code that could never leave. This remembers what happened last
# time, so the screen can say something true.
_last_send_succeeded: Optional[bool] = None


def _remember_send(succeeded: bool) -> None:
    global _last_send_succeeded
    _last_send_succeeded = succeeded


def delivery_configured() -> bool:
    """True when a real email can actually be sent, by any route."""
    return (
        _smtp_settings() is not None
        or _relay_settings() is not None
        or bool((os.getenv("RESEND_API_KEY") or "").strip())
    )


def delivery_working() -> bool:
    """
    What to tell the person waiting on the screen.

    Configured AND not known to be broken. Before a first attempt there is
    nothing to go on, so a configured route is taken at its word; once one has
    failed, the app stops promising an email that is not coming, and says
    plainly that mail is not switched on here. It flips back on its own the
    moment a send succeeds.
    """
    if not delivery_configured():
        return False
    return _last_send_succeeded is not False


def delivery_status() -> dict:
    """
    Which mail settings are present. Never what they contain.

    A broken mail setup is otherwise undiagnosable from outside. The reset
    endpoint answers identically whether the code was sent or the login was
    refused - deliberately, because "delivery failed for this address" would
    confirm the address has an account - and in production a failed send does
    not write the code to the log either. Correct, and it leaves whoever is
    trying to fix the deployment with nothing whatsoever to look at.

    So this publishes the small set of facts that are safe: which variables
    are set, whether the sender agrees with the authenticated user, and
    whether the password is even shaped like an app password. No values, no
    lengths - enough to name the wrong variable, not enough to help anyone
    guess it.
    """
    host = (os.getenv("SMTP_HOST") or "").strip()
    user = (os.getenv("SMTP_USER") or "").strip()
    raw_password = (os.getenv("SMTP_PASSWORD") or "").strip()
    password = _normalise_app_password(raw_password)
    sender = (os.getenv("RESET_EMAIL_FROM") or "").strip()

    if _smtp_settings():
        route = "smtp"
    elif _relay_settings():
        route = "relay"
    elif (os.getenv("RESEND_API_KEY") or "").strip():
        route = "resend"
    else:
        route = "none"

    # NOT published here: delivery_working() and _last_send_succeeded.
    #
    # They were, and it recreated the very oracle that was just removed from
    # /auth/forgot-password. Both move only when send_password_reset runs, and
    # that is queued only after the endpoint confirms the address has an active
    # account. /api/health needs no authentication and is not rate limited, so:
    # read health, probe an address, read health again - a changed value says
    # the account exists. Relocating a leak from one unauthenticated endpoint to
    # another is not a fix.
    #
    # Everything below depends on CONFIGURATION only, which no attacker-supplied
    # address can influence. Whether a send actually worked is answerable from
    # the service log, which is not public.
    return {
        "configured": delivery_configured(),
        "relay_set": _relay_settings() is not None,
        "route": route,
        "smtp_host_set": bool(host),
        "smtp_user_set": bool(user),
        "smtp_password_set": bool(password),
        # A Google app password is sixteen letters. Anything else here is
        # usually a placeholder that got pasted in by mistake.
        "smtp_password_looks_like_app_password": bool(
            password and len(password) == 16 and password.isalpha()
        ),
        # Gmail refuses to send as an address it does not own, so a From that
        # disagrees with the authenticated user fails every time.
        "from_matches_user": (user.lower() in sender.lower()) if (user and sender) else None,
    }


# Gmail answers on both of these. A host that blocks outbound mail usually
# blocks every well-known SMTP port, but not always - and finding out costs one
# connection attempt, against an afternoon of not knowing.
SMTP_PORTS_TO_TRY = (587, 465)

# Shorter than the old 20s. A blocked port does not refuse, it hangs until the
# socket gives up, and two attempts at 20s each is a worker thread tied up for
# most of a minute for a message that was never going to leave.
SMTP_TIMEOUT_SECONDS = 12


def probe_smtp_ports(host: Optional[str] = None, timeout: float = 4.0) -> dict:
    """
    Which SMTP ports this machine can actually open a socket to.

    Written because the failure it diagnoses is completely silent. A blocked
    outbound port does not refuse the connection - nothing answers, the socket
    times out, and the log says only that the send failed. The same
    credentials work in two seconds from a laptop, so every visible signal
    points at the credentials, which are fine.

    A bare TCP connect, not a login: it answers "can this host reach Gmail's
    mail ports at all", which is the question, and it involves no secret.
    """
    import socket
    import time as _time

    target = host or (os.getenv("SMTP_HOST") or "smtp.gmail.com").strip()
    results = {}
    # Only ports Gmail actually serves. 2525 was here briefly and cost ten
    # seconds of timeout every call to prove something nobody asked.
    for port in (587, 465, 25):
        started = _time.perf_counter()
        try:
            with socket.create_connection((target, port), timeout=timeout):
                results[str(port)] = {
                    "open": True,
                    "ms": round((_time.perf_counter() - started) * 1000),
                }
        except Exception as exc:  # noqa: BLE001 - every failure is a datapoint
            results[str(port)] = {
                "open": False,
                "error": type(exc).__name__,
                "ms": round((_time.perf_counter() - started) * 1000),
            }
    return {"host": target, "ports": results,
            "any_open": any(v["open"] for v in results.values())}


def _send_over_smtp(settings: dict, to_email: str, text: str, html: str) -> bool:
    """
    Blocking send. Called from a worker thread - see send_password_reset.

    stdlib smtplib rather than an async SMTP library: this is one short email
    on a path that already waits on a database, and it keeps the deployment to
    the packages already in requirements.txt.

    Tries the configured port first, then the other one Gmail speaks. Hosts
    that block outbound mail do not always block both, and the alternative to
    trying is a reset feature that silently never works.
    """
    import smtplib
    from email.message import EmailMessage

    message = EmailMessage()
    message["Subject"] = "Your MONEVA password reset code"
    message["From"] = settings["from"]
    message["To"] = to_email
    message.set_content(text)
    message.add_alternative(html, subtype="html")

    configured = settings["port"]
    ports = [configured] + [p for p in SMTP_PORTS_TO_TRY if p != configured]

    last_error: Optional[Exception] = None
    for port in ports:
        try:
            # 465 is implicit TLS; anything else (587) starts plain and upgrades.
            if port == 465:
                with smtplib.SMTP_SSL(settings["host"], port,
                                      timeout=SMTP_TIMEOUT_SECONDS) as server:
                    server.login(settings["user"], settings["password"])
                    server.send_message(message)
            else:
                with smtplib.SMTP(settings["host"], port,
                                  timeout=SMTP_TIMEOUT_SECONDS) as server:
                    server.ehlo()
                    server.starttls()
                    server.ehlo()
                    server.login(settings["user"], settings["password"])
                    server.send_message(message)
            if port != configured:
                logger.warning(
                    "Reset email went out on port %s; the configured port %s did "
                    "not work. Set SMTP_PORT=%s to stop paying for that attempt.",
                    port, configured, port,
                )
            return True
        except smtplib.SMTPAuthenticationError:
            # The credentials are wrong. Another port will not help, and
            # hammering a second one only delays saying so.
            raise
        except Exception as exc:  # noqa: BLE001 - try the next port
            last_error = exc
            logger.info("SMTP port %s did not work: %s", port, type(exc).__name__)

    raise last_error if last_error else RuntimeError("no SMTP port was attempted")


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
            _remember_send(True)
            return True
        except Exception as exc:  # noqa: BLE001 - delivery must not break the request
            # The message is scrubbed, not merely truncated. The old comment
            # here reasoned only about the password - "an SMTP error can quote
            # the envelope but never the password" - and the envelope was the
            # problem. smtplib puts the recipient IN the exception:
            #   str(SMTPRecipientsRefused({'victim@example.com': (550, ...)}))
            #     == "{'victim@example.com': (550, b'No such user')}"
            # so the address the same log line carefully masked came straight
            # back on the next argument, on the path most likely to fire.
            logger.error("Reset email over SMTP failed for %s: %s: %s",
                         masked(to_email), type(exc).__name__,
                         _scrub(str(exc), to_email)[:160])
            # Fall through to the HTTP provider rather than giving up here.
            # Many hosts - Render among them - block outbound SMTP ports to
            # deter spam, so a correct username and a correct password still
            # produce a connection that simply times out. When that host also
            # has an HTTPS mail provider configured, that route is not blocked
            # and is the one that will actually deliver. Returning False here
            # meant a working provider was never even tried.

    # An HTTPS relay you host yourself. Port 443 is not blocked anywhere, and
    # unlike a mail provider this needs no account with anyone: a Google Apps
    # Script web app calling GmailApp.sendEmail is about ten lines, runs under
    # the Gmail account you already have, and is reached by one POST.
    relay = _relay_settings()
    if relay:
        try:
            # follow_redirects is NOT optional here. A Google Apps Script /exec
            # endpoint answers every POST with a 302 to a one-time
            # script.googleusercontent.com URL and does the work there; httpx
            # does not follow redirects by default, so without this the relay
            # returns a bodiless 302 and every send is recorded as refused.
            #
            # This is exactly how it shipped broken: the local check that
            # "proved" the relay worked passed follow_redirects=True, and the
            # server code did not. Verify with the client you deploy.
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                res = await client.post(relay["url"], json={
                    "token": relay["token"],
                    "to": to_email,
                    "subject": "Your MONEVA password reset code",
                    "text": text,
                    "html": html,
                })
            # The status code is NOT enough. Google Apps Script answers 200 to
            # everything, including a request it rejected, so a wrong shared
            # token would read as a successful send and we would be back to
            # mail silently not arriving. The relay must SAY it sent.
            body = (res.text or "").strip()
            if res.status_code >= 400 or not body.upper().startswith("OK"):
                logger.error("Mail relay did not confirm the send: %s %s",
                             res.status_code, body[:200])
            else:
                _remember_send(True)
                return True
        except Exception as exc:  # noqa: BLE001 - delivery must not break the request
            logger.error("Mail relay failed for %s: %s", masked(to_email), type(exc).__name__)

    api_key = (os.getenv("RESEND_API_KEY") or "").strip()

    if not api_key:
        if smtp or relay:
            # A route WAS configured, was attempted, and failed. The generic
            # "not set" warning below would be a lie here - and, worse, it
            # writes the code and the full address into the log in clear.
            #
            # `relay` belongs in this test as much as `smtp` does. Without it a
            # failing relay fell through to that warning and put a live reset
            # code in a production log, which is the one thing
            # _log_code_if_stranded exists to prevent.
            logger.error(
                "Reset email could not be delivered for %s: every configured "
                "route failed and no HTTPS mail provider remains as a fallback.",
                masked(to_email),
            )
            _log_code_if_stranded(to_email, code)
            _remember_send(False)
            return False
        # Nothing at all is configured. The code goes to the log so the flow can
        # be exercised before anyone signs up for a provider - but through
        # _log_code_if_stranded, which refuses to do that in production. Writing
        # it directly here meant a misconfigured production deployment printed
        # live reset codes next to full email addresses.
        logger.warning("No mail route is configured - nothing was sent for %s.",
                       masked(to_email))
        _log_code_if_stranded(to_email, code)
        _remember_send(False)
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
            _log_code_if_stranded(to_email, code)
            _remember_send(False)
            return False
        _remember_send(True)
        return True
    except Exception as exc:  # noqa: BLE001 - delivery must never break the request
        logger.error("Reset email could not be sent: %s", type(exc).__name__)
        _log_code_if_stranded(to_email, code)
        _remember_send(False)
        return False


def masked(email: Optional[str]) -> str:
    """`r****l@example.com`, for logs that should not carry a full address."""
    if not email or "@" not in email:
        return "<none>"
    local, _, domain = email.partition("@")
    if len(local) <= 2:
        return f"{local[0]}*@{domain}"
    return f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}@{domain}"
