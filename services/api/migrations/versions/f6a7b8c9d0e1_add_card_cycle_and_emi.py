"""Credit-card billing terms, and instalment plans.

Two things a ledger cannot answer on its own.

A credit card is the one account where the balance is not the question. What
matters is which cycle a purchase landed in, what closed on the statement, and
how many days are left to pay it - and none of that is derivable from a list of
transactions without knowing the card's two dates. People miss due dates on
cards they have the money to pay, which is the most expensive avoidable mistake
in personal finance: interest on an Indian card runs 36-46 percent a year,
backdated to the purchase date, and a late fee on top.

An EMI is worse, because it is invisible. A purchase converted into instalments
shows up nowhere in a month's spending until the month it lands in, so the
running total of what is already committed is the one figure nobody has - and
it is the figure that decides whether the next one is affordable.

Both are nullable additions. Every existing account is, correctly, not a card,
and nobody has any instalment plans until they enter one.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
"""
from alembic import op
import sqlalchemy as sa

revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable, not defaulted: an account with no statement day is not a card,
    # and that is what distinguishes one. Defaulting these to a number would
    # silently turn every savings account into a credit card.
    op.add_column('accounts', sa.Column('statement_day', sa.SmallInteger(), nullable=True))
    op.add_column('accounts', sa.Column('due_day', sa.SmallInteger(), nullable=True))
    op.add_column('accounts', sa.Column('credit_limit_minor', sa.BigInteger(), nullable=True))

    op.create_table(
        'emis',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('user_id', sa.UUID(),
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        # SET NULL rather than CASCADE: closing the card does not cancel what
        # is still owed on it, and deleting the plan would erase the record of
        # a commitment the user is still paying.
        sa.Column('account_id', sa.UUID(),
                  sa.ForeignKey('accounts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('monthly_minor', sa.BigInteger(), nullable=False),
        sa.Column('months', sa.SmallInteger(), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('currency', sa.String(), nullable=False, server_default='INR'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    # Every read is "this user's plans", so that is the index.
    op.create_index('ix_emis_user_id', 'emis', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_emis_user_id', table_name='emis')
    op.drop_table('emis')
    op.drop_column('accounts', 'credit_limit_minor')
    op.drop_column('accounts', 'due_day')
    op.drop_column('accounts', 'statement_day')
