"""Email ownership, and refresh sessions that can be rotated and listed.

Two additions that close the two holes in an otherwise solid auth stack.

EMAIL VERIFICATION. Until now an address was only a claim. Anyone could
register with anyone else's, which squats it so the real owner cannot sign up -
and, far more common and far worse, a typo attaches the account to a mailbox
the person cannot read. They find out the day they forget their password, and
by then the ledger is unreachable: the reset code goes somewhere else. The gate
is soft by design; what it protects is the ability to recover an account.

REFRESH SESSIONS. A refresh token was valid for sixty days and reusable without
limit, so one stolen off a device granted sixty days of access that nothing
could detect - the owner stayed signed in throughout. This table gives every
token an identity, which is what makes single-use rotation possible: each
refresh retires the token presented, and a retired token coming back is proof
two parties hold the same credential. The response is to disbelieve both and
end the family, which turns a silent compromise into a visible sign-out.

The same rows answer "which devices are signed in", which the app could not
answer at all before.

BACKWARD COMPATIBILITY. Every existing user is created unverified, and every
refresh token already in the wild carries no jti. Neither is treated as a
fault: an unverified account keeps working, and an untracked token is adopted
into a fresh session on its next refresh rather than refused. Nobody is signed
out by this deploy.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
"""
from alembic import op
import sqlalchemy as sa

revision = 'a7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- email ownership -------------------------------------------------
    #
    # server_default on the boolean because the column is NOT NULL and there
    # are existing rows: without it the ALTER fails on any non-empty table.
    # Existing accounts land on False, which is the truthful answer - nobody
    # has ever proved they own their address.
    op.add_column('users', sa.Column(
        'email_verified', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('verify_code_hash', sa.String(), nullable=True))
    op.add_column('users', sa.Column(
        'verify_code_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column(
        'verify_code_attempts', sa.SmallInteger(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column(
        'verify_code_sent_at', sa.DateTime(timezone=True), nullable=True))

    # --- refresh sessions -------------------------------------------------
    op.create_table(
        'refresh_sessions',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('user_id', sa.UUID(),
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        # Every token descended from one sign-in shares a family, so reuse
        # anywhere in the chain can condemn the whole line.
        sa.Column('family_id', sa.UUID(), nullable=False),
        # sha256 of the jti, never the jti - a leaked database must not hand
        # over live sessions, exactly as with reset codes and recovery codes.
        sa.Column('jti_hash', sa.String(length=64), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_reason', sa.String(length=32), nullable=True),
        sa.Column('device_label', sa.String(length=120), nullable=True),
        sa.Column('last_ip', sa.String(length=45), nullable=True),
        sa.Column('issued_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    )
    # Unique, not merely indexed: two rows sharing a jti would mean one token
    # could be exchanged twice without ever looking reused, which is precisely
    # the case this whole table exists to catch.
    op.create_index('ix_refresh_sessions_jti_hash', 'refresh_sessions',
                    ['jti_hash'], unique=True)
    # Every refresh looks up by jti; every revocation sweeps by family; the
    # devices list and the prune both scan by user.
    op.create_index('ix_refresh_sessions_user_id', 'refresh_sessions', ['user_id'])
    op.create_index('ix_refresh_sessions_family_id', 'refresh_sessions', ['family_id'])

    # The server_defaults STAY.
    #
    # They were there to backfill existing rows, and the tidy instinct is to
    # drop them again afterwards so the application owns the decision. Two
    # reasons not to.
    #
    # It is not portable: `ALTER COLUMN ... DROP DEFAULT` is Postgres syntax
    # and SQLite refuses it outright, so those two statements failed the whole
    # migration when it was run against the local database - production is
    # Postgres, but the local one is not, and a migration that only runs in one
    # place is a migration nobody can test before deploying it.
    #
    # And leaving them is the safer default anyway: a row inserted by anything
    # other than the ORM - a fixture, a repair script, a manual INSERT - still
    # lands on "unverified" and "no attempts" rather than failing a NOT NULL
    # constraint. The application sets both explicitly regardless.


def downgrade() -> None:
    op.drop_index('ix_refresh_sessions_family_id', table_name='refresh_sessions')
    op.drop_index('ix_refresh_sessions_user_id', table_name='refresh_sessions')
    op.drop_index('ix_refresh_sessions_jti_hash', table_name='refresh_sessions')
    op.drop_table('refresh_sessions')
    op.drop_column('users', 'verify_code_sent_at')
    op.drop_column('users', 'verify_code_attempts')
    op.drop_column('users', 'verify_code_expires_at')
    op.drop_column('users', 'verify_code_hash')
    op.drop_column('users', 'email_verified')
