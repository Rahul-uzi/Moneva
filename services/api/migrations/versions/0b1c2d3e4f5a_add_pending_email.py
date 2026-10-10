"""Add the columns that hold an email change until it is confirmed

Revision ID: 0b1c2d3e4f5a
Revises: f3a4b5c6d7e8
Create Date: 2026-10-10

There was no way to change the address an account signs in with, so a typo at
sign-up was permanent. The new address waits in pending_email, with its own
code, until that code comes back from the new mailbox. Only then does `email`
move. Every column is nullable or defaulted, so existing rows need nothing.
"""
from alembic import op
import sqlalchemy as sa

revision = '0b1c2d3e4f5a'
down_revision = 'f3a4b5c6d7e8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('pending_email', sa.String(), nullable=True))
    op.add_column('users', sa.Column('email_change_code_hash', sa.String(), nullable=True))
    op.add_column('users', sa.Column('email_change_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('email_change_attempts', sa.SmallInteger(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('email_change_sent_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'email_change_sent_at')
    op.drop_column('users', 'email_change_attempts')
    op.drop_column('users', 'email_change_expires_at')
    op.drop_column('users', 'email_change_code_hash')
    op.drop_column('users', 'pending_email')
