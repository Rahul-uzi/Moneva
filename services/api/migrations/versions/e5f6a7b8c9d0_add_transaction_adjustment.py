"""Mark a transaction as a balance correction.

A parsed-alert app has no live link to the bank, so its running balance is a
sum of what it managed to see. Anything it missed - cash, a payment whose alert
never arrived, a wrong opening balance - leaves the figure quietly wrong, with
no way to put it right. That is one of the loudest complaints in this category:
not "it does not sync", but "my balance is wrong and I cannot fix it".

The fix is a correction the user makes, recorded as a real ledger event rather
than a silent rewrite of the opening balance. It moves the balance exactly like
an income or an expense, and the history keeps showing what happened and when.

It needs its own flag because it must NOT be counted as spending. Without that,
reconciling a drift of a few thousand rupees would appear as the largest
purchase of the month and wreck every budget and category percentage - the
exact class of bug this feature exists to repair.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default is what lets NOT NULL work on a table that already has
    # rows: every existing transaction is, correctly, not an adjustment.
    op.add_column(
        'transactions',
        sa.Column('is_adjustment', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('transactions', 'is_adjustment')
