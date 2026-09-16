"""The one piece of logic in the Lambda entry point.

Everything else in lambda_handler.py is a Mangum call and a long comment. This
is the part that can be wrong, and the failure it prevents is the quietest one
in the whole move: SQLite on Lambda lives on a filesystem that belongs to a
single execution environment and is discarded when that environment is
recycled. Writes succeed, return 200, and are gone. Two users can be served
from two unrelated copies of the database in the same second, and nothing logs
anything.

The case that actually happens is not somebody choosing SQLite - it is
DATABASE_URL being left unset, because normalise() then falls back to the local
file and the deploy comes up looking perfectly healthy.

Imported from lambda_guard rather than reimplemented here, so a change to the
guard is a change to what these tests exercise. It lives in its own module for
exactly this reason: in lambda_handler the check runs at import, so importing
it to test it tripped it.
"""
import pytest

from app.db.url import DEFAULT_URL, normalise
from lambda_guard import refuse_sqlite

POSTGRES = "postgresql+asyncpg://user:pass@db.example.com/moneva"


class TestItRefusesADisposableDatabase:
    def test_an_unset_url_is_refused(self):
        """The one that would really happen.

        normalise() with nothing set returns the local SQLite file, so without
        this the function would start, serve requests, and lose every write.
        """
        assert DEFAULT_URL.startswith("sqlite"), "the fallback is what makes this dangerous"
        with pytest.raises(RuntimeError, match="unset DATABASE_URL"):
            refuse_sqlite(normalise(DEFAULT_URL))

    def test_an_explicit_sqlite_url_is_refused(self):
        with pytest.raises(RuntimeError, match="Postgres"):
            refuse_sqlite(normalise("sqlite:///./monevadb.db"))

    def test_the_message_names_the_url_it_objected_to(self):
        # A deploy failure that does not say what it read leaves somebody
        # guessing between a missing variable and a malformed one.
        with pytest.raises(RuntimeError, match="aiosqlite"):
            refuse_sqlite(normalise("sqlite:///./whatever.db"))


class TestItAllowsARealDatabase:
    def test_postgres_passes(self):
        refuse_sqlite(normalise(POSTGRES))  # must not raise

    def test_the_render_style_alias_passes(self):
        """Managed hosts hand out `postgres://`, which normalise() rewrites.

        Checked because the guard reads the NORMALISED url: a guard that read
        the raw environment instead would be testing a different string from
        the one the engine is built with.
        """
        refuse_sqlite(normalise("postgres://user:pass@db.example.com/moneva"))

    def test_a_pooled_endpoint_with_query_params_passes(self):
        # What a serverless Postgres actually hands you, sslmode and all - and
        # pooling is required here, since each execution environment holds its
        # own connections.
        refuse_sqlite(normalise(
            "postgresql://user:pass@pooler.example.com/moneva?sslmode=require"))
