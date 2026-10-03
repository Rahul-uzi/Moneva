"""The admin panel, and the two things it must never do.

It must not be reachable by somebody who is not an admin, and it must not
return anybody's figures. The first is the obvious one; the second is the one
that would be easy to lose later, when somebody adds "just the balance" to a
row that already has the person's name on it.

So the leak test below does not check particular fields. It asserts that the
whole serialised response contains none of the amounts planted in the
database - which keeps failing however the leak is introduced.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import create_access_token, hash_password
from app.db.database import get_db
from app.models.models import Account, AppDownload, Base, Transaction, User
from main import app

pytestmark = pytest.mark.asyncio
UTC = timezone.utc

#: Planted in the database and then hunted for in every admin response.
SECRET_AMOUNT = 1234567
SECRET_TEXT = "PRIVATE-MERCHANT-DO-NOT-LEAK"


@pytest_asyncio.fixture
async def api():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async def _db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _db

    admin_id, plain_id, account_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    async with factory() as s:
        s.add(User(id=admin_id, email="admin@example.com", password_hash=hash_password("Jhelum-Ferry-1892"),
                   display_name="Admin", currency="INR", is_admin=True))
        s.add(User(id=plain_id, email="person@example.com", password_hash=hash_password("Jhelum-Ferry-1892"),
                   display_name="Ordinary Person", currency="INR", is_admin=False))
        s.add(Account(id=account_id, user_id=plain_id, name="SBI", account_type="asset",
                      currency="INR", opening_balance_minor=0))
        s.add(Transaction(id=uuid.uuid4(), client_mutation_id=uuid.uuid4(), user_id=plain_id,
                          account_id=account_id, transaction_type="expense",
                          amount_minor=SECRET_AMOUNT, currency="INR", description=SECRET_TEXT,
                          transaction_date=datetime.now(UTC), device_id="test"))
        s.add(AppDownload(id=uuid.uuid4(), version_name="1.0.5", source="website",
                          platform="android", created_at=datetime.now(UTC)))
        await s.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, factory, str(admin_id), str(plain_id)

    app.dependency_overrides.clear()


def auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': user_id})}"}


class TestWhoCanSeeIt:
    async def test_an_admin_can_read_the_overview(self, api):
        client, _f, admin_id, _p = api
        res = await client.get("/api/admin/overview", headers=auth(admin_id))
        assert res.status_code == 200, res.text
        assert res.json()["total_users"] == 2

    async def test_an_ordinary_user_is_told_it_does_not_exist(self, api):
        """404, not 403.

        A 403 confirms there is an admin surface here and that this account
        merely lacks the key, which turns a guess into a target.
        """
        client, _f, _a, plain_id = api
        for path in ("/api/admin/overview", "/api/admin/users", "/api/admin/downloads"):
            res = await client.get(path, headers=auth(plain_id))
            assert res.status_code == 404, f"{path} answered {res.status_code}"
            assert "admin" not in res.text.lower(), f"{path} admitted what it was"

    async def test_signed_out_cannot_reach_it(self, api):
        client, _f, _a, _p = api
        res = await client.get("/api/admin/overview")
        assert res.status_code in (401, 403)

    async def test_a_suspended_admin_loses_the_panel(self, api):
        client, factory, admin_id, _p = api
        async with factory() as s:
            u = await s.get(User, uuid.UUID(admin_id))
            u.is_active = False
            await s.commit()
        res = await client.get("/api/admin/overview", headers=auth(admin_id))
        # 401 from the auth layer, which rejects an inactive account before
        # this router is reached. Either way the panel is gone, and neither
        # answer admits that an admin surface exists.
        assert res.status_code in (401, 403, 404)
        assert "admin" not in res.text.lower()


class TestItNeverReturnsAnybodysFigures:
    """The rule that matters most, checked against the whole response body."""

    async def test_the_overview_leaks_no_amount(self, api):
        client, _f, admin_id, _p = api
        body = (await client.get("/api/admin/overview", headers=auth(admin_id))).text
        assert str(SECRET_AMOUNT) not in body
        assert SECRET_TEXT not in body

    async def test_the_user_list_leaks_no_amount(self, api):
        client, _f, admin_id, _p = api
        res = await client.get("/api/admin/users", headers=auth(admin_id))
        assert res.status_code == 200, res.text
        assert str(SECRET_AMOUNT) not in res.text, "an amount reached the admin panel"
        assert SECRET_TEXT not in res.text, "a merchant reached the admin panel"

    async def test_the_user_list_still_says_how_much_they_use_it(self, api):
        """Counts are the point - they separate a real user from a dead signup."""
        client, _f, admin_id, plain_id = api
        rows = (await client.get("/api/admin/users", headers=auth(admin_id))).json()
        person = next(r for r in rows if r["id"] == plain_id)
        assert person["transaction_count"] == 1
        assert person["account_count"] == 1
        assert person["email"] == "person@example.com"

    async def test_counts_are_not_shared_between_users(self, api):
        """A join written carelessly here would credit one user's activity to another."""
        client, _f, admin_id, _p = api
        rows = (await client.get("/api/admin/users", headers=auth(admin_id))).json()
        admin_row = next(r for r in rows if r["id"] == admin_id)
        assert admin_row["transaction_count"] == 0
        assert admin_row["account_count"] == 0


class TestSuspendingAnAccount:
    async def test_an_admin_can_suspend_and_restore(self, api):
        client, _f, admin_id, plain_id = api
        off = await client.post(f"/api/admin/users/{plain_id}/active?active=false", headers=auth(admin_id))
        assert off.status_code == 200, off.text
        assert off.json()["is_active"] is False

        on = await client.post(f"/api/admin/users/{plain_id}/active?active=true", headers=auth(admin_id))
        assert on.json()["is_active"] is True

    async def test_an_admin_cannot_suspend_themselves(self, api):
        """It is a one-way door: the way back is inside the panel."""
        client, _f, admin_id, _p = api
        res = await client.post(f"/api/admin/users/{admin_id}/active?active=false", headers=auth(admin_id))
        assert res.status_code == 400

    async def test_an_ordinary_user_cannot_suspend_anybody(self, api):
        client, _f, admin_id, plain_id = api
        res = await client.post(f"/api/admin/users/{admin_id}/active?active=false", headers=auth(plain_id))
        assert res.status_code == 404


class TestDownloadTraffic:
    async def test_the_public_beacon_records_one(self, api):
        client, _f, admin_id, _p = api
        before = (await client.get("/api/admin/downloads", headers=auth(admin_id))).json()["total"]

        res = await client.post("/api/app/download-hit",
                                json={"version_name": "1.0.5", "source": "website", "platform": "android"})
        assert res.status_code == 204, res.text

        after = (await client.get("/api/admin/downloads", headers=auth(admin_id))).json()
        assert after["total"] == before + 1
        assert after["by_version"]["1.0.5"] >= 1

    async def test_the_beacon_needs_no_login(self, api):
        """It fires from a static public page about to serve a public file."""
        client, _f, _a, _p = api
        res = await client.post("/api/app/download-hit", json={"platform": "windows"})
        assert res.status_code == 204

    async def test_an_odd_platform_is_bucketed_not_stored_raw(self, api):
        """A free-text field on a public endpoint is a free-text field for anyone."""
        client, _f, admin_id, _p = api
        await client.post("/api/app/download-hit",
                          json={"platform": "Mozilla/5.0 (X11; Linux) Totally/1.0"})
        stats = (await client.get("/api/admin/downloads", headers=auth(admin_id))).json()
        assert "Mozilla/5.0 (X11; Linux) Totally/1.0" not in str(stats)
        assert "other" in stats["by_platform"]

    async def test_the_series_includes_the_quiet_days(self, api):
        """A chart with the empty days missing reads as busier than it was."""
        client, _f, admin_id, _p = api
        stats = (await client.get("/api/admin/downloads?days=7", headers=auth(admin_id))).json()
        assert len(stats["series"]) == 7
        assert all("date" in p and "count" in p for p in stats["series"])

    async def test_downloads_are_not_reachable_without_the_panel(self, api):
        client, _f, _a, plain_id = api
        assert (await client.get("/api/admin/downloads", headers=auth(plain_id))).status_code == 404


class TestGrowth:
    async def test_it_charts_signups_and_separates_real_users(self, api):
        """A signup that never recorded anything is not a user yet.

        That split is the whole point of the panel's growth view: two accounts
        exist, and only one of them has ever put a transaction in.
        """
        client, _f, admin_id, _p = api
        res = await client.get("/api/admin/growth?days=30", headers=auth(admin_id))
        assert res.status_code == 200, res.text
        g = res.json()
        assert g["total"] == 2
        assert len(g["series"]) == 30
        assert g["by_platform"]["recorded something"] == 1
        assert g["by_platform"]["never recorded"] == 1

    async def test_growth_leaks_no_amount(self, api):
        client, _f, admin_id, _p = api
        body = (await client.get("/api/admin/growth", headers=auth(admin_id))).text
        assert str(SECRET_AMOUNT) not in body
        assert SECRET_TEXT not in body

    async def test_growth_is_admin_only(self, api):
        client, _f, _a, plain_id = api
        assert (await client.get("/api/admin/growth", headers=auth(plain_id))).status_code == 404
