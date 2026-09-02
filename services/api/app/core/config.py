import os
import sys
from pathlib import Path

from pydantic import BaseModel


def _load_dotenv() -> None:
    """
    Reads services/api/.env into the environment.

    Nothing was loading this file, so a GEMINI_API_KEY (or any other value)
    written there had no effect at all and the assistant silently stayed on the
    rule engine. Real environment variables always win, which keeps Render's
    dashboard values authoritative in production.

    Stdlib only - this is one small file read at import time, not worth a
    dependency.
    """
    env_path = Path(__file__).resolve().parents[2] / ".env"
    try:
        raw = env_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return

    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ[key] = value


_load_dotenv()

class Settings(BaseModel):
    PROJECT_NAME: str = "MONEVA API"
    VERSION: str = "1.0.0"
    API_PREFIX: str = "/api"

    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./monevadb.db")

    # Security
    JWT_SECRET: str = os.getenv("JWT_SECRET", "super_secret_jwt_signing_key_moneva_2026_test_env_only_key")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
    # 60 days keeps users signed in the way a normal mobile app does: each
    # refresh issues a token valid 60 days from that moment (sliding expiry).
    # NOTE: refresh tokens are NOT rotated or revocable - an old one stays valid
    # until it expires. Add a server-side token store before production.
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "60"))

    def model_post_init(self, __context):
        is_testing = os.getenv("TESTING", "").lower() == "true" or "pytest" in os.getenv("PYTEST_CURRENT_TEST", "") or "pytest" in sys.modules
        if not is_testing:
            if not self.JWT_SECRET or len(self.JWT_SECRET) < 32:
                raise ValueError("JWT_SECRET environment variable must be set to a secure secret of at least 32 characters.")

settings = Settings()
