"""
Database URL normalisation.

Render (and Heroku) hand out connection strings as `postgres://...`. SQLAlchemy
dropped that alias, and this app's engine is async, so the URL has to become
`postgresql+asyncpg://...` before it reaches create_async_engine.

Alembic runs synchronously, so it needs the same URL with a *sync* driver
instead. Both transformations live here so the app and the migration runner can
never disagree about which database they are pointing at.
"""
import os

DEFAULT_URL = "sqlite+aiosqlite:///./monevadb.db"


def _strip_query(url: str, keys: tuple[str, ...]) -> str:
    """Removes query params a given driver does not understand (e.g. sslmode)."""
    if "?" not in url:
        return url
    base, _, query = url.partition("?")
    kept = [p for p in query.split("&") if p and p.split("=")[0] not in keys]
    return base + ("?" + "&".join(kept) if kept else "")


def normalise(raw: str | None = None) -> str:
    """Returns a URL suitable for the ASYNC engine."""
    url = (raw if raw is not None else os.getenv("DATABASE_URL")) or DEFAULT_URL
    url = url.strip()

    # Render/Heroku style aliases -> the async driver this app uses.
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    elif url.startswith("sqlite:///"):
        url = "sqlite+aiosqlite:///" + url[len("sqlite:///"):]

    # asyncpg configures TLS in code, not via the libpq query string.
    if "+asyncpg" in url:
        url = _strip_query(url, ("sslmode", "channel_binding"))
    return url


def to_sync(url: str) -> str:
    """Returns the same database with a SYNC driver, for Alembic."""
    if "+asyncpg" in url:
        return url.replace("postgresql+asyncpg", "postgresql+psycopg2", 1)
    if "+aiosqlite" in url:
        return url.replace("sqlite+aiosqlite", "sqlite", 1)
    return url
