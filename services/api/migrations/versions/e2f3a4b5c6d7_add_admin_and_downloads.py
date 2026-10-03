"""Add users.is_admin and the app_downloads table

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-10-03

Two things the admin panel needs and the schema had no room for.

users.is_admin: there was no role concept at all. Defaults to false for every
existing row, and nothing in the API can set it - an account is promoted by
hand in the database, deliberately, because an endpoint that can make an admin
is an endpoint that can be tricked into making one.

app_downloads: downloads were never counted. The Worker serving the site is
assets-only, so Cloudflare hands the APK off its edge and no number exists
anywhere. One row per recorded tap, carrying no address and no identifier -
a download is interesting as a count, and the endpoint that writes these is
public.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'e2f3a4b5c6d7'
down_revision = 'd1e2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'users',
        # server_default, not just a Python default: existing rows are updated
        # by the database itself, and the column can be NOT NULL immediately
        # rather than going through a nullable phase.
        sa.Column('is_admin', sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    bind = op.get_bind()
    uuid_type = postgresql.UUID(as_uuid=True) if bind.dialect.name == 'postgresql' else sa.String(36)

    op.create_table(
        'app_downloads',
        sa.Column('id', uuid_type, primary_key=True),
        sa.Column('version_name', sa.String(), nullable=True),
        sa.Column('source', sa.String(), nullable=True),
        sa.Column('platform', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    # Every question asked of this table is "how many, over what period", so
    # the date is the only index worth carrying.
    op.create_index('ix_app_downloads_created_at', 'app_downloads', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_app_downloads_created_at', table_name='app_downloads')
    op.drop_table('app_downloads')
    op.drop_column('users', 'is_admin')
