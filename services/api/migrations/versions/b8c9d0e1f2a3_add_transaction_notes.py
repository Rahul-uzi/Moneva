"""A note the person writes on a transaction.

The description is not a note, and using it as one loses both. It is written
by the PARSER most of the time - "UPI/ZOMATO ONLINE/9812", "Rs.161.70 to
McDonald's" - it is what the row is titled by, what the categoriser reads, and
what the brand logo is matched against. Typing "split with Anita, she owes me
half" into it renames the payment, strips it of its merchant, and can move it
into a different category.

So a note gets its own column: free text the app never parses, never
categorises and never matches a logo against. Nullable and with no default,
because the overwhelming majority of rows will never have one and an empty
string would be a second way of spelling the same absence.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
"""
from alembic import op
import sqlalchemy as sa

revision = 'b8c9d0e1f2a3'
down_revision = 'a7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable, so no server_default is needed to get it onto a table that
    # already has rows: every existing transaction correctly has no note.
    op.add_column('transactions', sa.Column('notes', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('transactions', 'notes')
