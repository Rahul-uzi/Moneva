"""Add recurring_incomes.anchor_day so monthly streams stop drifting

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-09-03

Advancing a monthly stream by reading only its last date drifts whenever a
short month clamps the day: a salary paid on the 31st becomes the 28th after
one February and never climbs back. The intended day of the month is now kept
alongside, and the clamp applies only to the month that is too short.

Backfilled from the day already stored in next_occurrence, so existing streams
keep the date they are on today.
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'recurring_incomes',
        sa.Column('anchor_day', sa.SmallInteger(), nullable=True),
    )
    # Postgres and SQLite spell day-of-month extraction differently.
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute(
            "UPDATE recurring_incomes "
            "SET anchor_day = EXTRACT(DAY FROM next_occurrence)::smallint "
            "WHERE anchor_day IS NULL"
        )
    else:
        op.execute(
            "UPDATE recurring_incomes "
            "SET anchor_day = CAST(strftime('%d', next_occurrence) AS INTEGER) "
            "WHERE anchor_day IS NULL"
        )


def downgrade() -> None:
    op.drop_column('recurring_incomes', 'anchor_day')
