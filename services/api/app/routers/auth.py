import io as _io
import json
import secrets
import uuid
from datetime import timedelta

import pyotp
import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, HTTPException, status
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
from app.db.database import get_db
from app.models.models import User
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
)

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
    await db.commit()
    await db.refresh(new_user)

    # Generate JWT Tokens
    access_token = create_access_token(data={"sub": str(new_user.id)})
    refresh_token = create_refresh_token(data={"sub": str(new_user.id)})

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )


@router.post("/login", response_model=None)
async def login_user(payload: UserLogin, db: AsyncSession = Depends(get_db)):
    """Authenticates user credentials and returns JWT access and refresh tokens."""
    stmt = select(User).where(User.email == payload.email.lower().strip())
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
    if user.totp_enabled:
        return TwoFactorChallengeResponse(
            challenge_token=create_2fa_challenge_token({"sub": str(user.id)})
        )

    access_token = create_access_token(data={"sub": str(user.id)})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})

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

    access_token = create_access_token(data={"sub": str(user.id)})
    new_refresh_token = create_refresh_token(data={"sub": str(user.id)})

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )


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
        access_token=create_access_token(data={"sub": str(user.id)}),
        refresh_token=create_refresh_token(data={"sub": str(user.id)}),
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
