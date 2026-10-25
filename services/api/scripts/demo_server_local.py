"""Run a throwaway MONEVA API on 127.0.0.1:8000 for the test phone.

    services/api/.venv/Scripts/python.exe services/api/scripts/demo_server_local.py

Its database and JWT secret live in services/api/demo-data/ (git-ignored), so
a restart keeps the demo account and keeps the phone signed in. Every outside
service is blanked BEFORE the app is imported (real environment variables
beat services/api/.env), so this can never reach the live Neon database, send
mail or call an AI provider.

The test phone reaches it through `adb reverse tcp:8000 tcp:8000`, which
drops whenever the phone reconnects - set it again after replugging. Fill a
fresh database with seed_demo_local.py.
"""
import asyncio
import os
import secrets
import sys
from pathlib import Path

API = Path(__file__).resolve().parents[1]
DATA = API / "demo-data"
DATA.mkdir(exist_ok=True)
DB = DATA / "moneva-demo.db"
SECRET = DATA / "jwt_secret"
if not SECRET.exists():
    SECRET.write_text(secrets.token_hex(32), encoding="utf-8")

os.environ.update({
    "DATABASE_URL": f"sqlite+aiosqlite:///{DB.as_posix()}",
    "ENVIRONMENT": "development",
    "JWT_SECRET": SECRET.read_text(encoding="utf-8").strip(),
    "ACCESS_TOKEN_EXPIRE_MINUTES": "720",
    # No outside services, whatever .env says.
    "SMTP_HOST": "", "SMTP_USER": "", "SMTP_PASSWORD": "", "SMTP_PORT": "",
    "MAIL_RELAY_URL": "", "MAIL_RELAY_TOKEN": "", "RESEND_API_KEY": "",
    "GEMINI_API_KEY": "", "GROQ_API_KEY": "",
})

os.chdir(API)
sys.path.insert(0, str(API))

from app.core.config import settings  # noqa: E402
assert settings.DATABASE_URL.startswith("sqlite") and "demo-data" in settings.DATABASE_URL, "refusing: not the demo database"

from app.db.database import engine  # noqa: E402
from app.models.models import Base  # noqa: E402


async def create_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


asyncio.run(create_tables())
print(f"demo API on http://127.0.0.1:8000 - database {DB}", flush=True)

import uvicorn  # noqa: E402
from main import app  # noqa: E402

uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
