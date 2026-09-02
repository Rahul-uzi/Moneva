"""
Live foreign-exchange rates for the currency-change flow.

Two providers, both free and key-less, tried in order. Rates are cached briefly
so switching currency twice in a row does not hit the network twice, and the
date the rate came from is returned so the UI can be honest about what was used.

Deliberately stdlib-only: this is one call on an explicit user action, not a
hot path, and it avoids adding an HTTP client to the deployment.
"""
import asyncio
import json
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

_CACHE: dict[Tuple[str, str], Tuple[float, str, datetime]] = {}
_CACHE_TTL = timedelta(minutes=30)
_TIMEOUT = 8


class RateUnavailable(RuntimeError):
    """Raised when no provider could supply a rate."""


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "MONEVA/1.0"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as res:
        return json.loads(res.read())


def _from_frankfurter(base: str, quote: str) -> Optional[Tuple[float, str]]:
    """European Central Bank reference rates."""
    try:
        data = _get_json(f"https://api.frankfurter.dev/v1/latest?base={base}&symbols={quote}")
        rate = data.get("rates", {}).get(quote)
        if rate:
            return float(rate), str(data.get("date", ""))
    except (urllib.error.URLError, ValueError, KeyError, TimeoutError):
        return None
    return None


def _from_er_api(base: str, quote: str) -> Optional[Tuple[float, str]]:
    """Fallback provider, used when the ECB feed is unreachable."""
    try:
        data = _get_json(f"https://open.er-api.com/v6/latest/{base}")
        if data.get("result") != "success":
            return None
        rate = data.get("rates", {}).get(quote)
        if rate:
            return float(rate), str(data.get("time_last_update_utc", ""))[:16]
    except (urllib.error.URLError, ValueError, KeyError, TimeoutError):
        return None
    return None


def _lookup(base: str, quote: str) -> Tuple[float, str]:
    for provider in (_from_frankfurter, _from_er_api):
        result = provider(base, quote)
        if result:
            return result
    raise RateUnavailable(
        f"Could not fetch a live {base} to {quote} rate. Check the connection and try again."
    )


async def get_rate(base: str, quote: str) -> Tuple[float, str]:
    """
    Returns (rate, as_of) for converting `base` into `quote`.

    Runs the blocking HTTP call off the event loop so a slow provider cannot
    stall the whole API.
    """
    base, quote = base.upper().strip(), quote.upper().strip()
    if base == quote:
        return 1.0, "same currency"

    cached = _CACHE.get((base, quote))
    if cached and datetime.now(timezone.utc) - cached[2] < _CACHE_TTL:
        return cached[0], cached[1]

    rate, as_of = await asyncio.to_thread(_lookup, base, quote)
    _CACHE[(base, quote)] = (rate, as_of, datetime.now(timezone.utc))
    return rate, as_of
