"""What the newest build is, and where crashes go.

Both live on this backend rather than a third party, for the same reason.

MONEVA is installed from a website, so nothing updates itself and nothing
reports a crash home. The usual answers - an app store, Sentry, Crashlytics -
each mean a new account, a new dependency, and a new company named in the
privacy page as somebody who receives your data. This server already exists,
already holds the user's records, and is already disclosed. Sending these two
things here adds no third party at all.

WHAT THE CRASH ENDPOINT DELIBERATELY DOES NOT TAKE. No amounts, no account
names, no transaction text. A stack trace and a route are enough to find a
bug; the figures on the screen when it happened are not, and collecting them
would turn a debugging aid into a copy of somebody's ledger.
"""

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ratelimit import SlidingWindow, client_ip, enforce
from app.models.models import AppDownload
from app.schemas.schemas import DownloadHit
from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User

router = APIRouter(prefix="/app", tags=["App"])


# ---------------------------------------------------------------- version ---

class LatestVersion(BaseModel):
    """The newest build, as the server knows it.

    Read from environment variables rather than a table: a release happens
    when a human uploads an APK, which is already a manual act, and a row in a
    database that only ever holds one row is a table nobody remembers to
    update. Changing an env var redeploys and takes effect immediately.
    """

    version_code: int
    version_name: str
    # Where the APK actually is. Empty when unset, and the client then says an
    # update exists without offering a broken link.
    download_url: str
    # One line, shown in the prompt. "What changed" is the difference between
    # an update people take and one they dismiss.
    notes: str
    # True when this release fixes something that makes older builds unsafe or
    # broken. The client nags rather than mentions.
    mandatory: bool


@router.get("/version", response_model=LatestVersion)
async def latest_version():
    """Public on purpose - an app that cannot sign in still needs to know it is
    out of date, and that is often exactly why it cannot sign in."""
    return LatestVersion(
        version_code=int(os.getenv("LATEST_VERSION_CODE", "0") or 0),
        version_name=os.getenv("LATEST_VERSION_NAME", "") or "",
        download_url=os.getenv("APK_DOWNLOAD_URL", "") or "",
        notes=os.getenv("LATEST_RELEASE_NOTES", "") or "",
        mandatory=(os.getenv("LATEST_VERSION_MANDATORY", "") or "").lower() in {"1", "true", "yes"},
    )


# ----------------------------------------------------------------- crashes ---

# A crash loop can fire many times a second. This bounds what one account can
# send without losing the first report, which is the useful one.
CRASH_BY_ACCOUNT = SlidingWindow(limit=20, window_seconds=3600, name="crash-account")
CRASH_BY_IP = SlidingWindow(limit=60, window_seconds=3600, name="crash-ip")


class CrashIn(BaseModel):
    """One crash, as the device saw it.

    Every field is bounded. A client that is already misbehaving badly enough
    to crash is not a client whose payload sizes should be trusted.
    """

    message: str = Field(min_length=1, max_length=300)
    where: str = Field(min_length=1, max_length=120)
    stack: str | None = Field(default=None, max_length=4000)
    app_version: str = Field(min_length=1, max_length=40)
    # Epoch ms from the device. Phone clocks are wrong often enough that the
    # server records its own time too, and this is kept only to order the
    # reports from one device against each other.
    at: int | None = None


@router.post("/crashes", status_code=status.HTTP_202_ACCEPTED)
async def report_crash(
    request: Request,
    payload: CrashIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record a crash that happened on someone's phone.

    Returns 202 and nothing useful. The client is reporting, not asking - and a
    device that has just recovered from a crash should not be made to care
    whether the report landed.

    Signed-in only. That is not to identify anybody: it is because an
    unauthenticated crash endpoint on a public URL is an open write, and the
    reports that matter come from real users of the app anyway.
    """
    enforce(CRASH_BY_IP, client_ip(request))
    enforce(CRASH_BY_ACCOUNT, str(current_user.id))

    # Logged rather than stored in a table. A crash report is operational
    # data, not user data: it belongs in the place you already look when
    # something is wrong, and it must not become another thing to migrate,
    # back up, or delete when somebody closes their account.
    import logging

    logging.getLogger("moneva.crash").error(
        "CRASH v=%s where=%s user=%s at=%s :: %s\n%s",
        payload.app_version,
        payload.where,
        str(current_user.id)[:8],
        datetime.now(timezone.utc).isoformat(),
        payload.message,
        (payload.stack or "")[:2000],
    )
    return {"received": True}


# A download is one deliberate human act, so this is generous for a real
# person and useless for inflating a counter from one address.
DOWNLOAD_BY_IP = SlidingWindow(limit=30, window_seconds=3600, name="download-ip")


@router.post("/download-hit", status_code=status.HTTP_204_NO_CONTENT)
async def record_download(
    payload: DownloadHit,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Counts a tap on the website's download button.

    Reported by a beacon from the page rather than by serving the file through
    here. Routing the APK through this service would put a sleeping free-tier
    instance in front of the one button on the site that has to feel instant -
    a cold start is the better part of a minute, which reads as a broken
    download. The file still comes straight from Cloudflare's edge; only the
    count comes here, and it cannot delay or break the download because
    nothing waits for it.

    Unauthenticated, because the page it fires from is public and the file it
    counts is public. It therefore stores NO address and NO identifier: the IP
    is used for the rate limit and never written down.

    Returns 204 whatever happens. A counter that makes a visitor's download
    look like it failed would be worse than no counter.
    """
    try:
        enforce(DOWNLOAD_BY_IP, client_ip(request))
    except Exception:
        # Over the limit. Silently not counted - the visitor is downloading a
        # public file and owes this endpoint nothing.
        return

    platform = (payload.platform or "").strip().lower()
    if platform not in ("android", "windows", "mac", "linux", "ios", "other"):
        platform = "other"

    try:
        db.add(AppDownload(
            version_name=(payload.version_name or "").strip()[:32] or None,
            source=(payload.source or "website").strip()[:32],
            platform=platform,
            created_at=datetime.now(timezone.utc),
        ))
        await db.commit()
    except Exception:
        # The database being unavailable must not surface on a download
        # button. The count is the least important thing on this page.
        await db.rollback()
    return
