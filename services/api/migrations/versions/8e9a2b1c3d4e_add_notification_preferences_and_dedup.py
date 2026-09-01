"""Add notification preferences and dedup key

Revision ID: 8e9a2b1c3d4e
Revises: 7d6bfa64d62f
Create Date: 2026-08-31 11:47:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8e9a2b1c3d4e'
down_revision: Union[str, Sequence[str], None] = '7d6bfa64d62f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('notif_bills', sa.Boolean(), server_default='1', nullable=False))
        batch_op.add_column(sa.Column('notif_budgets', sa.Boolean(), server_default='1', nullable=False))
        batch_op.add_column(sa.Column('notif_goals', sa.Boolean(), server_default='1', nullable=False))
        batch_op.add_column(sa.Column('notif_salary', sa.Boolean(), server_default='1', nullable=False))

    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.add_column(sa.Column('dedup_key', sa.String(), nullable=True))
        batch_op.create_index(batch_op.f('ix_notifications_dedup_key'), ['dedup_key'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_notifications_dedup_key'))
        batch_op.drop_column('dedup_key')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('notif_salary')
        batch_op.drop_column('notif_goals')
        batch_op.drop_column('notif_budgets')
        batch_op.drop_column('notif_bills')
