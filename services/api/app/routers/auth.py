import io as _io
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pyotp
import qrcode
import qrcode.image.svg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.passwords import password_problem
from app.core import sessions as session_store
from app.core.sessions import ReuseDetected
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    create_2fa_challenge_token,
    decode_token,
    get_current_user
)
from app.core.ratelimit import (
    FORGOT_BY_ACCOUNT,
    FORGOT_BY_IP,
    LOGIN_BY_ACCOUNT,
    LOGIN_BY_IP,
    RESET_BY_IP,
    TOTP_BY_ACCOUNT,
    TOTP_BY_IP,
    client_ip,
    enforce,
)
from app.db.database import get_db
from app.services.mailer import (
    delivery_configured,
    masked,
    send_email_verification,
    send_password_reset,
)
from app.models.models import User, Category
from app.schemas.schemas import (
    UserCreate,
    UserLogin,
    UserResponse,
    TokenResponse,
    RefreshTokenRequest,
    TotpSetupResponse,
    TotpCodeRequest,
    TotpEnableResponse,
    TotpDisableRequest,
    TwoFactorChallengeResponse,
    TotpVerifyRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    ResetPasswordRequest,
    VerifyEmailRequest,
    SendVerificationResponse,
)

# How long a reset code is good for. Long enough to fetch it from a phone that
# is slow to sync mail, short enough that a code sitting in an old inbox is not
# a standing key to the account.
RESET_CODE_TTL_MINUTES = 30

# How long a confirmation code is good for, and how long before another may
# be sent. The resend gap is per account and deliberately short: the usual
# reason someone asks again is that the first one went to spam, and making
# them wait five minutes to discover that is its own problem.
VERIFY_CODE_TTL_MINUTES = 30
VERIFY_RESEND_SECONDS = 60
# A six-digit code inside a thirty-minute window is guessable at unlimited
# speed; this is what stops that. Lower than the reset ceiling because there
# is no legitimate reason to mistype a code from an email ten times.
VERIFY_MAX_ATTEMPTS = 6
# Wrong codes accepted before the code is destroyed. Six digits is a million
# combinations, but five guesses is far below what a person needs.
RESET_MAX_ATTEMPTS = 5

# Starter categories every new account gets. The Category model already had
# is_default/icon/colour fields for this, but nothing ever populated them, so
# users landed on an empty Plan screen with nothing to file spending under.
# Colours come from the locked MONEVA palette; icons are lucide names the app
# already bundles.
DEFAULT_CATEGORIES = [
    # --- expenses ---
    ("Food & Dining", "expense", "UtensilsCrossed", "#FF6B6B"),
    ("Groceries", "expense", "ShoppingCart", "#F59E0B"),
    ("Transport", "expense", "Bus", "#2563EB"),
    ("Fuel", "expense", "Fuel", "#F59E0B"),
    ("Rent & Housing", "expense", "Home", "#7C3AED"),
    ("Utilities", "expense", "Zap", "#2563EB"),
    ("Shopping", "expense", "ShoppingBag", "#FF6B6B"),
    ("Health", "expense", "HeartPulse", "#10B981"),
    ("Entertainment", "expense", "Clapperboard", "#7C3AED"),
    ("Education", "expense", "GraduationCap", "#2563EB"),
    ("Other", "expense", "Tag", "#64748B"),
    # --- income ---
    ("Salary", "income", "Wallet", "#10B981"),
    ("Business", "income", "Briefcase", "#10B981"),
    ("Investments", "income", "TrendingUp", "#10B981"),
    ("Other Income", "income", "PiggyBank", "#64748B"),
]


router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_user(
    request: Request,
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    """Registers a new user with secure password hashing and returns JWT tokens."""
    # One definition of "strong enough", shared by registration, reset and
    # change. Three call sites with three opinions is how an app ends up
    # refusing a password on one screen and accepting it on another.
    problem = password_problem(payload.password, email=payload.email, display_name=payload.display_name)
    if problem:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=problem)

    # Check if email is already taken
    stmt = select(User).where(User.email == payload.email.lower().strip())
    res = await db.execute(stmt)
    if res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email address is already registered."
        )

    # Create new user
    new_user = User(
        email=payload.email.lower().strip(),
        password_hash=hash_password(payload.password),
        display_name=payload.display_name.strip(),
        currency=payload.currency or "INR",
        timezone=payload.timezone or "UTC"
    )
    db.add(new_user)
    await db.flush()  # assigns new_user.id without a second round trip

    # Give the account something to file spending under from the first screen.
    for name, kind, icon, colour in DEFAULT_CATEGORIES:
        db.add(Category(
            user_id=new_user.id,
            name=name,
            type=kind,
            icon=icon,
            color=colour,
            is_default=True,
        ))

    await db.commit()
    await db.refresh(new_user)

    # A tracked session from the very first token, so this device's chain has
    # an identity to rotate. Without one the first refresh would silently adopt
    # the token into a fresh family, which works but loses the sign-in record.
    jti = await session_store.start_session(
        db, new_user, device_label=_device_label(request), ip=client_ip(request)
    )
    await db.commit()

    return _issue_token_pair(new_user, jti)


@router.post("/login", response_model=None)
async def login_user(request: Request, payload: UserLogin, db: AsyncSession = Depends(get_db)):
    """Authenticates user credentials and returns JWT access and refresh tokens."""
    email = payload.email.lower().strip()

    # Throttled two ways, because they stop different attacks: one address
    # working through many accounts, and many addresses working on one account.
    # Both are counted BEFORE the password is checked, so a wrong guess costs
    # an attempt whether or not the account exists - counting only real
    # accounts would turn the limiter itself into an enumeration oracle.
    enforce(LOGIN_BY_IP, client_ip(request))
    enforce(LOGIN_BY_ACCOUNT, email)

    stmt = select(User).where(User.email == email)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated."
        )

    # Password was correct. If TOTP is on, stop here and demand the second factor.
    #
    # The throttle is deliberately NOT cleared on this branch. It used to be -
    # reset as soon as the password verified, before this check - which meant a
    # correct password alone cleared its own limit and could mint an unbounded
    # supply of five-minute challenge tokens. That is the difference between
    # brute-forcing the second factor being rate limited and being free.
    # /auth/2fa/verify clears it once the login is actually finished.
    if user.totp_enabled:
        return TwoFactorChallengeResponse(
            challenge_token=create_2fa_challenge_token({"sub": str(user.id), "tv": user.token_version or 0})
        )

    # A complete login. Somebody who mistyped twice and then got it right is
    # not left throttled.
    LOGIN_BY_ACCOUNT.reset(email)

    # Sign-in is the only moment the session table reliably grows, so it is
    # also where the dead rows are cleared - no scheduled job for a table that
    # only changes when someone is here.
    await session_store.prune_expired(db, user)
    jti = await session_store.start_session(
        db, user, device_label=_device_label(request), ip=client_ip(request)
    )
    await db.commit()

    return _issue_token_pair(user, jti)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(
    request: Request,
    payload: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchanges a refresh token for a new pair, retiring the one presented.

    The exchange is the security mechanism, not a formality. A refresh token
    used to be reusable for sixty days, so one stolen off a device granted
    sixty days of access that nothing could detect - the owner stayed signed in
    throughout, because a thief using the token did not disturb their session.

    Now each token is single-use. A stolen one works only until the real device
    refreshes, and when the loser of that race presents the retired token, that
    is a fact no correct client ever produces: two parties hold the same
    credential. Nothing in the request says which is the owner, so the whole
    family is revoked and both sign in again. The owner is inconvenienced, and
    - the point - told that something happened.
    """
    decoded = decode_token(payload.refresh_token)
    if decoded.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type for refresh endpoint."
        )

    user_id_str = decoded.get("sub")
    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject."
        )
    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID format in token."
        )

    stmt = select(User).where(User.id == user_id)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive or no longer exists."
        )

    # A refresh token from before a "sign out everywhere" must not mint new ones.
    if int(decoded.get("tv", 0)) != int(user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This session has been signed out."
        )

    try:
        new_jti, _tracked = await session_store.rotate(
            db, user, decoded.get("jti"), ip=client_ip(request)
        )
    except ReuseDetected:
        # Committed before answering: the revocation must survive even if the
        # response never reaches anyone, and the caller here may well be the
        # attacker.
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            # Says what happened without saying how it was detected. The owner
            # needs to know their session ended for a reason; whoever else has
            # the token learns nothing about the mechanism.
            detail="This session was ended for security. Please sign in again.",
        )

    await db.commit()
    return _issue_token_pair(user, new_jti)


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(
    request: Request,
    payload: ForgotPasswordRequest,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Starts a password reset. Answers the same way whichever address is given.

    Every branch below returns the same message. That is the point: `/login`
    already refuses to say whether an address has an account, and an endpoint
    that says "no such user" here would give away exactly what login protects.
    So an unknown address, an inactive account and a successful send are
    indistinguishable from outside.
    """
    email = payload.email.lower().strip()

    enforce(FORGOT_BY_IP, client_ip(request))
    enforce(FORGOT_BY_ACCOUNT, email)

    # delivery_configured(), NOT delivery_working(). The difference is a
    # security one and it is easy to get wrong - it was, briefly.
    #
    # `working` turns false only AFTER a send has failed, and a send is only
    # attempted for an address that HAS an account. That makes it an
    # enumeration oracle: probe an unknown address, probe the target, probe the
    # unknown one again, and a changed answer says the target exists. Every
    # other branch here is careful to answer identically; this field must be
    # too, so it may only depend on configuration, never on what happened to
    # one address.
    #
    # The honest "is mail actually working" signal lives on /api/health, which
    # is not scoped to an address and therefore gives nothing away.
    same_answer = ForgotPasswordResponse(
        message="If that email has an account, a reset code is on its way.",
        delivery_configured=delivery_configured(),
    )

    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if not user or not user.is_active:
        return same_answer

    # Six digits, from a generator meant for secrets rather than randint.
    code = f"{secrets.randbelow(1_000_000):06d}"
    user.reset_code_hash = hash_password(code)
    user.reset_code_expires_at = datetime.now(timezone.utc) + timedelta(minutes=RESET_CODE_TTL_MINUTES)
    user.reset_code_attempts = 0
    await db.commit()

    # Committed before sending: an email that arrives with a code the database
    # does not know about is worse than one that never arrives.
    #
    # Queued rather than awaited. The answer above is identical whether the
    # send succeeds or fails - that is the whole anti-enumeration design - so
    # nothing is gained by making the caller wait for it, and something real
    # is lost: an SMTP connection that a host silently blocks does not fail
    # fast, it hangs until the socket times out. Measured at ~20s against a
    # 15s client timeout, which the app reported to the user as "could not
    # reach the server" while the request was still perfectly alive.
    background.add_task(send_password_reset, user.email, code, RESET_CODE_TTL_MINUTES)
    return same_answer


@router.post("/reset-password")
async def reset_password(
    request: Request,
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Finishes a reset, with either the emailed code or a 2FA recovery code.

    The recovery-code path matters for the case the email path cannot serve:
    somebody locked out of their inbox. It takes a RECOVERY code only, never a
    live TOTP code: a recovery code is burned on use and cannot be replayed,
    while a TOTP code is replayable for its whole step and is meant to be the
    second of two factors rather than a credential in its own right.
    """
    email = payload.email.lower().strip()
    submitted = payload.code.strip().replace(" ", "")

    enforce(RESET_BY_IP, client_ip(request))

    # One message for every failure, for the same reason as above - and so a
    # wrong code cannot be told apart from a wrong address.
    def rejected() -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code is not valid or has expired. Ask for a new one.",
        )

    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if not user or not user.is_active:
        raise rejected()

    accepted = False

    # 1. The emailed code.
    if user.reset_code_hash and user.reset_code_expires_at:
        expires = user.reset_code_expires_at
        # A column read back from SQLite comes without a timezone; treat a
        # naive value as UTC rather than letting the comparison raise.
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)

        if datetime.now(timezone.utc) > expires:
            user.reset_code_hash = None
            user.reset_code_expires_at = None
            user.reset_code_attempts = 0
            await db.commit()
            raise rejected()

        if verify_password(submitted, user.reset_code_hash):
            accepted = True
        else:
            user.reset_code_attempts = int(user.reset_code_attempts or 0) + 1
            if user.reset_code_attempts >= RESET_MAX_ATTEMPTS:
                # Burn it rather than leave a known-under-attack code alive.
                user.reset_code_hash = None
                user.reset_code_expires_at = None
            await db.commit()

    # 2. A 2FA recovery code, for someone who cannot reach their email.
    #
    # _consume_RECOVERY_code, not _consume_second_factor. The latter tries TOTP
    # first and returns true on a live authenticator code without burning it,
    # which made possession of the TOTP secret alone enough to take the account
    # over - no password, no inbox. A recovery code is a written-down one-time
    # secret and is destroyed on use; that is what belongs on this path.
    if not accepted and user.totp_recovery_codes:
        if _consume_recovery_code(user, submitted):
            accepted = True

    if not accepted:
        raise rejected()

    # One definition of "strong enough", shared by registration, reset and
    # change. Three call sites with three opinions is how an app ends up
    # refusing a password on one screen and accepting it on another.
    problem = password_problem(payload.new_password, email=user.email, display_name=user.display_name)
    if problem:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=problem)

    user.password_hash = hash_password(payload.new_password)
    user.reset_code_hash = None
    user.reset_code_expires_at = None
    user.reset_code_attempts = 0
    # Every existing session dies. Whoever reset the password now has to sign
    # in with it - including, importantly, anyone who was already signed in on
    # a device the real owner does not control.
    user.token_version = int(user.token_version or 0) + 1
    await db.commit()

    LOGIN_BY_ACCOUNT.reset(email)
    return {"message": "Password updated. Sign in with your new password."}


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """Logs out the user session."""
    return {"message": "Successfully logged out"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Returns profile info for current authenticated user."""
    return current_user


# ============================================================================
# TWO-FACTOR AUTHENTICATION (TOTP)
# ============================================================================

TOTP_ISSUER = "MONEVA"
RECOVERY_CODE_COUNT = 10


def _device_label(request: Request) -> str | None:
    """A human name for the device, for the signed-in-devices list.

    Taken from the User-Agent, which the client controls, so this is a LABEL
    and never an identity - nothing is decided by it. It exists so the list
    reads "Android 13" rather than a row of identical UUIDs, which is the
    difference between a person recognising their own session and not.

    Deliberately coarse. A full User-Agent is a fingerprint and there is no
    reason to keep one; the platform and major version are enough to tell two
    of your own devices apart.
    """
    ua = (request.headers.get("user-agent") or "").strip()
    if not ua:
        return None
    for needle, label in (
        ("Android", "Android"),
        ("iPhone", "iPhone"),
        ("iPad", "iPad"),
        ("Macintosh", "Mac"),
        ("Windows", "Windows"),
        ("Linux", "Linux"),
    ):
        if needle in ua:
            import re as _re
            version = _re.search(needle + r"[ /]?(\d+)", ua)
            return f"{label} {version.group(1)}" if version else label
    return "Unknown device"


def _issue_token_pair(user: User, jti: str | None = None) -> TokenResponse:
    """The pair a client is given.

    `jti` names the refresh token's row in refresh_sessions. It is what makes
    rotation possible at all: without an identity, a presented token cannot be
    looked up, so it cannot be retired and its reuse cannot be noticed. Access
    tokens carry no jti - they live fifteen minutes and are never exchanged for
    anything, so there is nothing to rotate.

    Optional so the 2FA and logout-all paths can keep calling it while their
    own session handling is added; a pair with no jti still works, it simply
    starts a fresh family on its next refresh.
    """
    claims = {"sub": str(user.id), "tv": user.token_version or 0}
    refresh_claims = dict(claims)
    if jti:
        refresh_claims["jti"] = jti
    return TokenResponse(
        access_token=create_access_token(data=claims),
        refresh_token=create_refresh_token(data=refresh_claims),
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


def _generate_recovery_codes() -> list[str]:
    """Human-typable single-use codes, e.g. 'K3F9-7QD2'."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no look-alike chars
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(alphabet) for _ in range(8))
        codes.append(f"{raw[:4]}-{raw[4:]}")
    return codes


def _qr_svg(otpauth_uri: str) -> str:
    """Renders the provisioning URI as an inline SVG (no PIL dependency)."""
    img = qrcode.make(otpauth_uri, image_factory=qrcode.image.svg.SvgPathImage)
    buf = _io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode("utf-8")


@router.post("/2fa/setup", response_model=TotpSetupResponse)
async def totp_setup(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Starts 2FA enrolment: mints a fresh secret and returns the provisioning QR.
    The secret is stored but stays inactive until /2fa/enable confirms a code,
    so an interrupted enrolment can never lock the user out.
    """
    if current_user.totp_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Two-factor authentication is already enabled."
        )

    secret = pyotp.random_base32()
    current_user.totp_secret = secret
    await db.commit()

    uri = pyotp.TOTP(secret).provisioning_uri(name=current_user.email, issuer_name=TOTP_ISSUER)
    return TotpSetupResponse(secret=secret, otpauth_uri=uri, qr_svg=_qr_svg(uri))


@router.post("/2fa/enable", response_model=TotpEnableResponse)
async def totp_enable(
    payload: TotpCodeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Confirms enrolment with a live code, then returns one-time recovery codes."""
    if current_user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two-factor authentication is already enabled.")
    if not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Call /auth/2fa/setup before enabling.")

    if not pyotp.TOTP(current_user.totp_secret).verify(payload.code.strip().replace(" ", ""), valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authentication code.")

    codes = _generate_recovery_codes()
    current_user.totp_recovery_codes = json.dumps([hash_password(c) for c in codes])
    current_user.totp_enabled = True
    await db.commit()

    # Plaintext codes are returned exactly once; only hashes are persisted.
    return TotpEnableResponse(totp_enabled=True, recovery_codes=codes)


@router.post("/2fa/disable")
async def totp_disable(
    payload: TotpDisableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Turns 2FA off. Requires both the account password and a current code."""
    if not current_user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Two-factor authentication is not enabled.")

    if not verify_password(payload.password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password is incorrect.")

    if not _consume_second_factor(current_user, payload.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authentication code.")

    current_user.totp_enabled = False
    current_user.totp_secret = None
    current_user.totp_recovery_codes = None
    await db.commit()
    return {"message": "Two-factor authentication disabled.", "totp_enabled": False}


def _consume_recovery_code(user: User, code: str) -> bool:
    """
    An unused recovery code, burned on use. TOTP is NOT accepted here.

    The distinction is the whole point. A TOTP code proves possession of the
    authenticator and is designed to be the SECOND of two factors - it is not
    burned, and it is replayable for its whole thirty-second step. A recovery
    code is a one-time secret the person wrote down, and using it destroys it.

    Password reset must only ever take this one. Accepting a live TOTP there
    promoted a second factor into a complete credential: whoever could read the
    authenticator - a photographed enrolment QR, malware with the seed - could
    set a new password with no password and no access to the inbox, and the
    session invalidation that follows would sign the real owner out of every
    device while the attacker signed in.
    """
    cleaned = code.strip().replace(" ", "").upper()
    if not user.totp_recovery_codes:
        return False

    remaining = json.loads(user.totp_recovery_codes)
    for hashed in remaining:
        if verify_password(cleaned, hashed):
            remaining.remove(hashed)
            user.totp_recovery_codes = json.dumps(remaining)
            return True
    return False


def _consume_second_factor(user: User, code: str) -> bool:
    """
    Accepts either a live TOTP code or an unused recovery code.

    Correct for SIGNING IN, where the password has already been checked and
    this is genuinely the second of two factors. Never for password reset -
    see _consume_recovery_code.
    """
    cleaned = code.strip().replace(" ", "").upper()

    if user.totp_secret and pyotp.TOTP(user.totp_secret).verify(cleaned.replace("-", ""), valid_window=1):
        return True

    return _consume_recovery_code(user, code)


@router.post("/2fa/verify", response_model=TokenResponse)
async def totp_verify(
    request: Request,
    payload: TotpVerifyRequest,
    db: AsyncSession = Depends(get_db)
):
    """Exchanges a login challenge plus a second factor for real session tokens."""
    # Throttled like every other route that checks a credential. Without this
    # the second factor was six digits with unlimited guesses: three codes are
    # live at once (valid_window=1), nothing counted a miss, and a fresh
    # challenge token was one /auth/login away for anyone holding the password.
    enforce(TOTP_BY_IP, client_ip(request))

    decoded = decode_token(payload.challenge_token)
    if decoded.get("type") != "2fa_challenge":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid challenge token.")

    try:
        user_id = uuid.UUID(decoded.get("sub", ""))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid challenge subject.")

    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user or not user.is_active or not user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Challenge is no longer valid.")

    # Per-account as well as per-IP: one address working through many sources
    # is the attack the IP window alone does not stop.
    enforce(TOTP_BY_ACCOUNT, str(user.id))

    if not _consume_second_factor(user, payload.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authentication code.")

    # The login is only now complete, so this is where the counters clear.
    TOTP_BY_ACCOUNT.reset(str(user.id))
    LOGIN_BY_ACCOUNT.reset(user.email)

    await db.commit()
    return _issue_token_pair(user)


@router.post("/logout-all")
async def logout_all_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Invalidates every token issued for this account, on every device.

    Bumping token_version makes the claim inside all outstanding access and
    refresh tokens stale, so they are refused on their next use. This is the
    only way to end a session on a lost phone - refresh tokens live 60 days.
    """
    current_user.token_version = int(current_user.token_version or 0) + 1
    await db.commit()
    await db.refresh(current_user)

    # Issue a fresh pair so the device doing the revoking stays signed in.
    return {
        "message": "Signed out on all devices.",
        "tokens": _issue_token_pair(current_user).model_dump(),
    }


@router.post("/send-verification", response_model=SendVerificationResponse)
async def send_verification(
    request: Request,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sends a code to the address on the account.

    Unlike the password-reset endpoint, this one may speak plainly. It requires
    a signed-in user and only ever sends to the address already on that
    account, so there is nothing here to enumerate - the caller has, by
    definition, already proved they hold the account.
    """
    if current_user.email_verified:
        return SendVerificationResponse(
            message="This address is already confirmed.",
            delivery_configured=delivery_configured(),
        )

    # A per-account throttle on top of the IP limiter. Without it a signed-in
    # user is an unlimited mail generator pointed at their own address, which
    # is a spam complaint waiting to happen against whatever relay is set up.
    now = datetime.now(timezone.utc)
    last_sent = current_user.verify_code_sent_at
    if last_sent is not None:
        if last_sent.tzinfo is None:
            last_sent = last_sent.replace(tzinfo=timezone.utc)
        waited = (now - last_sent).total_seconds()
        if waited < VERIFY_RESEND_SECONDS:
            return SendVerificationResponse(
                message="A code was just sent. Check your inbox, including spam.",
                delivery_configured=delivery_configured(),
                retry_after_seconds=int(VERIFY_RESEND_SECONDS - waited),
            )

    enforce(FORGOT_BY_IP, client_ip(request))

    code = f"{secrets.randbelow(1_000_000):06d}"
    # Hashed, for the same reason the reset code and the recovery codes are: a
    # leaked database must not hand over live codes.
    current_user.verify_code_hash = hash_password(code)
    current_user.verify_code_expires_at = now + timedelta(minutes=VERIFY_CODE_TTL_MINUTES)
    current_user.verify_code_attempts = 0
    current_user.verify_code_sent_at = now
    await db.commit()

    background.add_task(
        send_email_verification, current_user.email, code, VERIFY_CODE_TTL_MINUTES
    )

    return SendVerificationResponse(
        message=f"A code is on its way to {masked(current_user.email)}.",
        delivery_configured=delivery_configured(),
        retry_after_seconds=VERIFY_RESEND_SECONDS,
    )


@router.post("/verify-email", response_model=UserResponse)
async def verify_email(
    payload: VerifyEmailRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirms the address, if the code is right and still current."""
    if current_user.email_verified:
        return current_user

    if not current_user.verify_code_hash or not current_user.verify_code_expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ask for a new code first.",
        )

    expires = current_user.verify_code_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code has expired. Ask for a new one.",
        )

    # Counted BEFORE the comparison and committed either way, so a wrong guess
    # costs an attempt even if the request is abandoned mid-flight. Counting
    # after a successful compare would leave the ceiling trivial to bypass.
    attempts = int(current_user.verify_code_attempts or 0) + 1
    current_user.verify_code_attempts = attempts
    if attempts > VERIFY_MAX_ATTEMPTS:
        # Burn the code rather than merely refuse. Someone who has spent the
        # ceiling must not be able to wait out a counter and carry on.
        current_user.verify_code_hash = None
        current_user.verify_code_expires_at = None
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many wrong codes. Ask for a new one.",
        )

    if not verify_password(payload.code.strip(), current_user.verify_code_hash):
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code is not right.",
        )

    current_user.email_verified = True
    # Single use. A spent code left live still works for whoever read it over
    # somebody's shoulder.
    current_user.verify_code_hash = None
    current_user.verify_code_expires_at = None
    current_user.verify_code_attempts = 0
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.get("/sessions")
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The devices currently signed in to this account.

    Built from the refresh-session families that rotation already maintains, so
    it costs nothing extra to keep. Before this, logout-all was the only
    control there was: all or nothing, with no way to see what you were ending
    or to end only the device you actually lost.
    """
    rows = await session_store.active_sessions(db, current_user)
    return [
        {
            "id": str(row.family_id),
            "device": row.device_label or "Unknown device",
            "last_seen_at": row.last_seen_at,
            "started_at": row.issued_at,
        }
        for row in rows
    ]


@router.delete("/sessions/{family_id}", status_code=status.HTTP_204_NO_CONTENT)
async def end_session(
    family_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ends one device without touching the others."""
    rows = await session_store.active_sessions(db, current_user)
    # Scoped to this account's own families. Without the check, a family id
    # from anywhere would end a stranger's session.
    if not any(row.family_id == family_id for row in rows):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such session.")

    await session_store.revoke_family(db, family_id, "you")
    await db.commit()
