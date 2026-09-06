"""Password reset codes on the user.

Three columns rather than a table: a user has at most one live reset code, so
a row per code buys nothing and costs a join. The shape follows the recovery
codes already on this model - the value is stored hashed, and it is consumed
rather than merely checked.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
"""
from alembic import op
import sqlalchemy as sa

revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('reset_code_hash', sa.String(), nullable=True))
    op.add_column('users', sa.Column('reset_code_expires_at', sa.DateTime(timezone=True), nullable=True))
    # server_default so the column can be NOT NULL on a table that already has
    # rows; without it the migration fails on any existing database.
    op.add_column(
        'users',
        sa.Column('reset_code_attempts', sa.SmallInteger(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_column('users', 'reset_code_attempts')
    op.drop_column('users', 'reset_code_expires_at')
    op.drop_column('users', 'reset_code_hash')
