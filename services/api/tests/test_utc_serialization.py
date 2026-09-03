"""A timestamp must never leave the API without a timezone.

SQLite stores UTC but hands back naive datetimes. Serialised without an offset,
a browser reads them as local time and shows every date shifted by its own UTC
offset - 5.5 hours early on an IST device.
"""
from datetime import datetime, timezone

from app.schemas.schemas import (
    TransactionResponse,
    BillResponse,
    BillPayPayload,
    _ensure_utc,
)


def _transaction(dt):
    return TransactionResponse(
        id="11111111-1111-1111-1111-111111111111",
        user_id="22222222-2222-2222-2222-222222222222",
        account_id="33333333-3333-3333-3333-333333333333",
        client_mutation_id="44444444-4444-4444-4444-444444444444",
        transaction_type="expense",
        amount_minor=1480_00,
        currency="INR",
        transaction_date=dt,
        device_id="pytest",
        version=1,
        created_at=dt,
        updated_at=dt,
    )


def test_naive_datetime_is_stamped_utc():
    assert _ensure_utc(datetime(2026, 9, 2, 18, 21)).tzinfo is timezone.utc


def test_aware_datetime_is_left_alone():
    aware = datetime(2026, 9, 2, 18, 21, tzinfo=timezone.utc)
    assert _ensure_utc(aware) is aware


def test_transaction_date_serialises_with_an_offset():
    payload = _transaction(datetime(2026, 9, 2, 18, 21, 40)).model_dump(mode="json")
    # Without the offset a browser would read this as 18:21 local, not UTC.
    assert payload["transaction_date"].endswith("Z") or "+00:00" in payload["transaction_date"]
    assert payload["created_at"].endswith("Z") or "+00:00" in payload["created_at"]


def test_the_instant_itself_is_unchanged():
    naive = datetime(2026, 9, 2, 18, 21, 40)
    stamped = _ensure_utc(naive)
    assert stamped.timestamp() == naive.replace(tzinfo=timezone.utc).timestamp()
    assert (stamped.year, stamped.hour, stamped.minute) == (2026, 18, 21)


def test_optional_datetime_fields_are_stamped_too():
    bill = BillResponse(
        id="11111111-1111-1111-1111-111111111111",
        user_id="22222222-2222-2222-2222-222222222222",
        name="Electricity",
        amount_minor=250_00,
        currency="INR",
        due_date=datetime(2026, 9, 10, 6, 0),
        created_at=datetime(2026, 9, 2, 18, 21),
        updated_at=datetime(2026, 9, 2, 18, 21),
    )
    assert bill.due_date.tzinfo is timezone.utc


def test_none_stays_none():
    """An absent timestamp must not be invented as "now"."""
    payload = BillPayPayload(
        account_id="33333333-3333-3333-3333-333333333333",
        client_mutation_id="44444444-4444-4444-4444-444444444444",
        device_id="pytest",
        version=1,
    )
    assert payload.payment_date is None
