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
    client_ip,
    enforce,
)
from app.db.database import get_db
from app.services.mailer import delivery_configured, masked, send_password_reset
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
)

# How long a reset code is good for. Long enough to fetch it from a phone that
# is slow to sync mail, short enough that a code sitting in an old inbox is not
# a standing key to the account.
RESET_CODE_TTL_MINUTES = 30
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
async def register_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    """Registers a new user with secure password hashing and returns JWT tokens."""
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

    # Generate JWT Tokens
    access_token = create_access_token(data={"sub": str(new_user.id), "tv": new_user.token_version or 0})
    refresh_token = create_refresh_token(data={"sub": str(new_user.id), "tv": new_user.token_version or 0})

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )


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

    # Signing in clears the count, so somebody who mistyped twice and then got
    # it right is not left throttled.
    LOGIN_BY_ACCOUNT.reset(email)

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated."
        )

    # Password was correct. If TOTP is on, stop here and demand the second factor.
    if user.totp_enabled:
        return TwoFactorChallengeResponse(
            challenge_token=create_2fa_challenge_token({"sub": str(user.id), "tv": user.token_version or 0})
        )

    access_token = create_access_token(data={"sub": str(user.id), "tv": user.token_version or 0})
    refresh_token = create_refresh_token(data={"sub": str(user.id), "tv": user.token_version or 0})

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(payload: RefreshTokenRequest, db: AsyncSession = Depends(get_db)):
    """Validates refresh token and issues a new access token."""
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

    access_token = create_access_token(data={"sub": str(user.id), "tv": user.token_version or 0})
    new_refresh_token = create_refresh_token(data={"sub": str(user.id), "tv": user.token_version or 0})

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )


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
    somebody locked out of their inbox. It reuses `_consume_second_factor`,
    which already burns a recovery code on use, so a code cannot be replayed.
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
    if not accepted and user.totp_recovery_codes:
        if _consume_second_factor(user, submitted):
            accepted = True

    if not accepted:
        raise rejected()

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


def _issue_token_pair(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(data={"sub": str(user.id), "tv": user.token_version or 0}),
        refresh_token=create_refresh_token(data={"sub": str(user.id), "tv": user.token_version or 0}),
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


def _consume_second_factor(user: User, code: str) -> bool:
    """
    Accepts either a live TOTP code or an unused recovery code.
    A recovery code is burned on use so it can never be replayed.
    """
    cleaned = code.strip().replace(" ", "").upper()

    if user.totp_secret and pyotp.TOTP(user.totp_secret).verify(cleaned.replace("-", ""), valid_window=1):
        return True

    if user.totp_recovery_codes:
        remaining = json.loads(user.totp_recovery_codes)
        for hashed in remaining:
            if verify_password(cleaned, hashed):
                remaining.remove(hashed)
                user.totp_recovery_codes = json.dumps(remaining)
                return True
    return False


@router.post("/2fa/verify", response_model=TokenResponse)
async def totp_verify(
    payload: TotpVerifyRequest,
    db: AsyncSession = Depends(get_db)
):
    """Exchanges a login challenge plus a second factor for real session tokens."""
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

    if not _consume_second_factor(user, payload.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authentication code.")

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
