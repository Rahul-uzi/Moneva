"""A small in-process rate limiter for the endpoints worth guessing at.

There was none at all: `/auth/login` would take passwords as fast as they
could be posted, with no lockout. Adding a password reset makes that worse -
a six-digit code is trivially guessable at unlimited speed.

In-process, not Redis. That is a real limitation and worth being clear about:
the counters live in this worker, so with several workers or several instances
the effective limit multiplies by that number. It is still the difference
between thousands of attempts a minute and a handful, and it needs no new
infrastructure. Redis is the upgrade when there is more than one instance.

A sliding window rather than a fixed one, so an attacker cannot get a double
allowance by straddling a window boundary.
"""
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Tuple

from fastapi import HTTPException, Request, status


class SlidingWindow:
    """`limit` events per `window` seconds, keyed by whatever the caller picks."""

    def __init__(self, limit: int, window_seconds: int, name: str):
        self.limit = limit
        self.window = window_seconds
        self.name = name
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> Deque[float]:
        hits = self._hits[key]
        cutoff = now - self.window
        while hits and hits[0] < cutoff:
            hits.popleft()
        return hits

    def check(self, key: str) -> Tuple[bool, int]:
        """(allowed, seconds until the next attempt is allowed)."""
        now = time.monotonic()
        hits = self._prune(key, now)
        if len(hits) >= self.limit:
            return False, max(1, int(self.window - (now - hits[0])))
        return True, 0

    def record(self, key: str) -> None:
        self._hits[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        """Forget a key. Called after a success, so one good login clears the
        count and a person who simply mistyped is not punished afterwards."""
        self._hits.pop(key, None)

    def sweep(self, max_keys: int = 10_000) -> None:
        """Drop empty buckets so a long-running process cannot grow forever on
        keys that will never be seen again."""
        if len(self._hits) < max_keys:
            return
        now = time.monotonic()
        for key in list(self._hits.keys()):
            if not self._prune(key, now):
                self._hits.pop(key, None)


# Per IP and per account, because they stop different attacks: one address
# trying many accounts, and many addresses trying one account.
LOGIN_BY_IP = SlidingWindow(limit=20, window_seconds=300, name="login-ip")
LOGIN_BY_ACCOUNT = SlidingWindow(limit=8, window_seconds=900, name="login-account")

# Asking for a reset is cheap for the asker and costs an email each time, so
# it is held much tighter than a login attempt.
FORGOT_BY_IP = SlidingWindow(limit=10, window_seconds=3600, name="forgot-ip")
FORGOT_BY_ACCOUNT = SlidingWindow(limit=4, window_seconds=3600, name="forgot-account")

# Submitting a code. The per-account attempt counter in the database is the
# real defence; this stops the noise before it reaches the database at all.
RESET_BY_IP = SlidingWindow(limit=20, window_seconds=900, name="reset-ip")


def client_ip(request: Request) -> str:
    """
    The caller's address, trusting the proxy header Render sets.

    X-Forwarded-For is client-controllable in general, so this is only safe
    because the app sits behind a proxy that overwrites it. Taking the FIRST
    entry is the client as the proxy saw it.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce(window: SlidingWindow, key: str) -> None:
    """Raise 429 when the key is over its limit, otherwise count the attempt."""
    allowed, retry_after = window.check(key)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Try again in a moment.",
            headers={"Retry-After": str(retry_after)},
        )
    window.record(key)
    window.sweep()
