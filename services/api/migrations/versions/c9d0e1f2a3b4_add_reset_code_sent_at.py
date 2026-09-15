"""Remember when a reset code was last sent, so a second one can be refused.

The verification endpoint already had this column and used it to enforce a
minimum gap between sends. The password-reset endpoint had no equivalent: it
was rationed to four an hour, with nothing at all stopping those four from
arriving within four seconds of each other.

Two things made that worse in practice. The client retries a timed-out
forgot-password - a deliberate choice, because a sleeping instance takes
longer to wake than the request takes to time out - so one tap could already
post twice. And each send REPLACES the previous code, so a person who tapped
twice and then typed the code from the first email was told it was invalid,
which invites yet another tap.

An in-memory limiter would not have fixed it either: the counters live in the
worker, and the worker sleeps when the instance idles, so every wake starts
the allowance again. Only a column survives that.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
"""
from alembic import op
import sqlalchemy as sa

revision = 'c9d0e1f2a3b4'
down_revision = 'b8c9d0e1f2a3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable: every existing user has simply never been sent one, and NULL
    # says that more honestly than any date would.
    op.add_column(
        'users',
        sa.Column('reset_code_sent_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('users', 'reset_code_sent_at')
