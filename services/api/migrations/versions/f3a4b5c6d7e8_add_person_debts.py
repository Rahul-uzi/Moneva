"""Add the person_debts table

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-10-09

Money lent to a friend had nowhere to live. The rupees leaving the bank were
recorded like any other payment, but nothing anywhere said WHO had them or
that they were coming back - so the only way to remember a loan was to
remember it yourself, which is exactly what people do not do.

One row per debt, in either direction, with a name and a settled flag. It
holds no account and no amount that any balance is derived from: a debt is a
reminder, not a second copy of the money. The repayment, when it lands, is
income like any other, and adding this to net worth as well would count the
same rupees twice.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'f3a4b5c6d7e8'
down_revision = 'e2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'person_debts',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('person', sa.String(), nullable=False),
        # 'owed_to_me' or 'i_owe'. A string rather than an enum: a new kind of
        # debt should not need a migration on a table this small.
        sa.Column('direction', sa.String(), nullable=False, server_default='owed_to_me'),
        sa.Column('amount_minor', sa.BigInteger(), nullable=False),
        sa.Column('repaid_minor', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('note', sa.String(), nullable=True),
        sa.Column('occurred_on', sa.DateTime(timezone=True), nullable=True),
        sa.Column('settled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    # Every read is "this user's open debts", so the index covers the whole
    # of it rather than the user alone.
    op.create_index('ix_person_debts_user_settled', 'person_debts',
                    ['user_id', 'settled_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_person_debts_user_settled', table_name='person_debts')
    op.drop_table('person_debts')
