"""Store all timestamps as TIMESTAMPTZ

Revision ID: a1b2c3d4e5f6
Revises: 9f1c4d2e5a6b
Create Date: 2026-09-01

The application writes timezone-AWARE datetimes (datetime.now(timezone.utc)),
but the columns were created as TIMESTAMP WITHOUT TIME ZONE. SQLite tolerates
that; asyncpg does not - it refuses an aware datetime for a naive column, so
every INSERT would fail on Postgres.

Switching to TIMESTAMPTZ is also the correct choice for a finance app: a
transaction time has to be unambiguous.

SQLite has no timezone-aware type and DateTime(timezone=True) is a no-op there,
so this migration only does work on Postgres and is skipped otherwise.
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = '9f1c4d2e5a6b'
branch_labels = None
depends_on = None

# (table, column, nullable)
COLUMNS = [
    ("users", "created_at", False),
    ("users", "updated_at", False),
    ("accounts", "created_at", False),
    ("accounts", "updated_at", False),
    ("categories", "created_at", False),
    ("categories", "updated_at", False),
    ("notifications", "created_at", False),
    ("recurring_incomes", "next_occurrence", False),
    ("recurring_incomes", "created_at", False),
    ("recurring_incomes", "updated_at", False),
    ("savings_goals", "target_date", True),
    ("savings_goals", "created_at", False),
    ("savings_goals", "updated_at", False),
    ("sync_metadata", "created_at", False),
    ("sync_metadata", "updated_at", False),
    ("bills", "due_date", False),
    ("bills", "created_at", False),
    ("bills", "updated_at", False),
    ("budgets", "start_date", False),
    ("budgets", "end_date", False),
    ("budgets", "created_at", False),
    ("budgets", "updated_at", False),
    ("transactions", "transaction_date", False),
    ("transactions", "created_at", False),
    ("transactions", "updated_at", False),
]


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table, column, nullable in COLUMNS:
        op.alter_column(
            table,
            column,
            type_=sa.DateTime(timezone=True),
            existing_type=sa.DateTime(),
            existing_nullable=nullable,
            # Existing rows were written as UTC; label them as such rather than
            # letting Postgres assume the server's local timezone.
            postgresql_using=f"{column} AT TIME ZONE 'UTC'",
        )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table, column, nullable in COLUMNS:
        op.alter_column(
            table,
            column,
            type_=sa.DateTime(),
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=nullable,
        )
