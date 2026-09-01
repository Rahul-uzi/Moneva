from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.db.url import normalise

# Managed hosts hand out `postgres://...`; normalise() converts that (and any
# other alias) into the async driver this engine needs.
DATABASE_URL = normalise()

# Force sqlite connection options if using SQLite
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

# Create the async engine
# Managed Postgres closes idle connections; pre-ping avoids handing a dead one
# to a request, and recycling keeps them under the provider's idle timeout.
pool_kwargs = {}
if not DATABASE_URL.startswith("sqlite"):
    pool_kwargs = {"pool_pre_ping": True, "pool_recycle": 280, "pool_size": 5, "max_overflow": 5}

engine = create_async_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=False,
    **pool_kwargs,
)

# Setup async session factory
SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

# SQLite pragma event listener to enforce foreign key constraints
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    # Enforce foreign key constraints inside SQLite
    if DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

# Dependency to yield database sessions in FastAPI routes
async def get_db():
    async with SessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
