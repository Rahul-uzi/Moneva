"""Add profile avatar and TOTP two-factor authentication columns

Revision ID: 9f1c4d2e5a6b
Revises: 8e9a2b1c3d4e
Create Date: 2026-08-31

Adds:
  - users.avatar_data_url      profile picture, stored as an image/jpeg data URL
  - users.totp_secret          base32 TOTP secret (null until 2FA is enabled)
  - users.totp_enabled         whether TOTP is active for the account
  - users.totp_recovery_codes  JSON list of bcrypt-hashed single-use recovery codes
"""
from alembic import op
import sqlalchemy as sa

revision = '9f1c4d2e5a6b'
down_revision = '8e9a2b1c3d4e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('avatar_data_url', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('totp_secret', sa.String(), nullable=True))
    op.add_column('users', sa.Column('totp_enabled', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('totp_recovery_codes', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'totp_recovery_codes')
    op.drop_column('users', 'totp_enabled')
    op.drop_column('users', 'totp_secret')
    op.drop_column('users', 'avatar_data_url')
