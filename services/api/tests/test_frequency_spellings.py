"""A frequency means the same thing however it was spelled.

The salary schedule screen saved "bi-weekly", which nothing recognised: every
fortnightly salary was advanced a MONTH at a time. Rows saved that way are read
correctly now, without a migration.
"""
from datetime import datetime, timezone

import pytest

from app.services.recurring import next_after, normalise_frequency

D = datetime(2026, 10, 10, tzinfo=timezone.utc)


@pytest.mark.parametrize("spelling", ["bi-weekly", "Bi Weekly", "bi_weekly", "BIWEEKLY", "biweekly"])
def test_every_spelling_of_biweekly_is_a_fortnight(spelling):
    assert normalise_frequency(spelling) == "biweekly"
    assert next_after(D, spelling).date().isoformat() == "2026-10-24"


def test_monthly_and_missing_stay_monthly():
    assert next_after(D, "Monthly").date().isoformat() == "2026-11-10"
    assert next_after(D, None).date().isoformat() == "2026-11-10"


def test_weekly_is_untouched():
    assert next_after(D, "weekly").date().isoformat() == "2026-10-17"
