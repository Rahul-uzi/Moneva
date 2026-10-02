"""Add bills.anchor_day so recurring bills stop drifting

Revision ID: d1e2f3a4b5c6
Revises: c9d0e1f2a3b4
Create Date: 2026-10-02

Paying a bill now produces the next one instead of marking it Paid for good,
which means a bill's due date is advanced month after month - and advancing by
reading only the last date drifts exactly as a salary stream did: a bill due on
the 31st clamps to 28 in February and never climbs back to 31.

Same remedy as recurring_incomes.anchor_day: keep the intended day of the month
alongside, and let the clamp apply only to the month that is too short.

Backfilled from the day already stored in due_date, so existing bills keep the
date they are on today.
"""
from alembic import op
import sqlalchemy as sa

revision = 'd1e2f3a4b5c6'
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'bills',
        sa.Column('anchor_day', sa.SmallInteger(), nullable=True),
    )
    # Postgres and SQLite spell day-of-month extraction differently.
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute(
            "UPDATE bills "
            "SET anchor_day = EXTRACT(DAY FROM due_date)::smallint "
            "WHERE anchor_day IS NULL"
        )
    else:
        op.execute(
            "UPDATE bills "
            "SET anchor_day = CAST(strftime('%d', due_date) AS INTEGER) "
            "WHERE anchor_day IS NULL"
        )


def downgrade() -> None:
    op.drop_column('bills', 'anchor_day')
