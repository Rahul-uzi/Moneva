"""The check the Lambda entry point runs before it builds anything.

Kept in its own module, with nothing executed at import, so it can be tested.
When it lived in lambda_handler.py the guard ran on import - which is exactly
what it is for on Lambda, and exactly what stopped a test from importing it:
the test environment has no DATABASE_URL, so merely importing the module to
test the function tripped the function.
"""


def refuse_sqlite(url: str) -> None:
    """Stop before a scratch database is mistaken for the real one.

    SQLite on Lambda is not a smaller database. It is a DIFFERENT database on
    every execution environment, held on a filesystem that is discarded when
    that environment is recycled - so writes appear to succeed and are then
    gone, and two users can be served from two unrelated copies at the same
    moment. Nothing logs anything.

    Takes the NORMALISED url, because that is what the app resolves and builds
    its engine from. The case that matters most is DATABASE_URL being UNSET:
    normalise() falls back to the local SQLite file, so a deploy that simply
    forgot the variable would otherwise come up looking perfectly healthy and
    quietly lose everything written to it.
    """
    if url.startswith("sqlite"):
        raise RuntimeError(
            "DATABASE_URL must point at Postgres when running on Lambda; "
            f"this resolves to {url!r}. SQLite here lives on a per-execution "
            "filesystem that is discarded without warning, so writes would "
            "appear to succeed and then vanish. An unset DATABASE_URL lands "
            "here too, because the app falls back to a local SQLite file."
        )
