import uuid
from datetime import datetime, timezone
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from main import app
from app.db.database import get_db
from app.models.models import Base, User, Category

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

@pytest_asyncio.fixture
async def api_client():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.mark.asyncio
async def test_auth_register_login_flow(api_client: AsyncClient):
    """
    Test 1 & 2: User registration, login, and token generation.
    """
    reg_payload = {
        "email": "testuser@example.com",
        "password": "Jhelum-Ferry-1892",
        "display_name": "Test User",
        "currency": "INR",
        "timezone": "Asia/Kolkata"
    }
    reg_res = await api_client.post("/api/auth/register", json=reg_payload)
    assert reg_res.status_code == 201
    reg_data = reg_res.json()
    assert "access_token" in reg_data
    assert "refresh_token" in reg_data

    # Login with same credentials
    login_payload = {
        "email": "testuser@example.com",
        "password": "Jhelum-Ferry-1892"
    }
    login_res = await api_client.post("/api/auth/login", json=login_payload)
    assert login_res.status_code == 200
    login_data = login_res.json()
    assert "access_token" in login_data


@pytest.mark.asyncio
async def test_protected_endpoints_auth_enforcement(api_client: AsyncClient):
    """
    Test 3 & 4: Unauthenticated and invalid token requests are rejected with 401.
    """
    # 1. No authentication header
    res_no_auth = await api_client.get("/api/auth/me")
    assert res_no_auth.status_code == 401

    # 2. Invalid Bearer token
    res_invalid_token = await api_client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer invalid_junk_token_value"}
    )
    assert res_invalid_token.status_code == 401


@pytest.mark.asyncio
async def test_accounts_crud_and_user_isolation(api_client: AsyncClient):
    """
    Test 5 & 6: Account CRUD and user isolation (User 2 cannot access User 1's account).
    """
    # Register User 1
    u1_reg = await api_client.post("/api/auth/register", json={
        "email": "user1_acc@example.com",
        "password": "Jhelum-Ferry-1892",
        "display_name": "User 1"
    })
    token1 = u1_reg.json()["access_token"]
    headers1 = {"Authorization": f"Bearer {token1}"}

    # Register User 2
    u2_reg = await api_client.post("/api/auth/register", json={
        "email": "user2_acc@example.com",
        "password": "Jhelum-Ferry-1892",
        "display_name": "User 2"
    })
    token2 = u2_reg.json()["access_token"]
    headers2 = {"Authorization": f"Bearer {token2}"}

    # User 1 creates an Account
    create_acc_res = await api_client.post("/api/accounts", json={
        "name": "User 1 Savings",
        "account_type": "asset",
        "opening_balance_minor": 100000
    }, headers=headers1)
    assert create_acc_res.status_code == 201
    acc_id = create_acc_res.json()["id"]

    # User 1 can view the account
    u1_get = await api_client.get(f"/api/accounts/{acc_id}", headers=headers1)
    assert u1_get.status_code == 200
    assert u1_get.json()["name"] == "User 1 Savings"

    # User 2 attempts to view User 1's account => Rejected with 404 (IDOR Prevention)
    u2_get = await api_client.get(f"/api/accounts/{acc_id}", headers=headers2)
    assert u2_get.status_code == 404


@pytest.mark.asyncio
async def test_transaction_idempotency_and_transfer_integrity(api_client: AsyncClient):
    """
    Test 7, 8 & 9: Transaction CRUD, creation idempotency, and transfer integrity.
    """
    u_reg = await api_client.post("/api/auth/register", json={
        "email": "tx_user@example.com",
        "password": "Jhelum-Ferry-1892",
        "display_name": "Tx User"
    })
    headers = {"Authorization": f"Bearer {u_reg.json()['access_token']}"}

    # Create two accounts
    acc_a = (await api_client.post("/api/accounts", json={"name": "Bank A", "account_type": "asset", "opening_balance_minor": 50000}, headers=headers)).json()
    acc_b = (await api_client.post("/api/accounts", json={"name": "Bank B", "account_type": "asset", "opening_balance_minor": 0}, headers=headers)).json()

    mutation_id = str(uuid.uuid4())

    # 1. Execute Transfer transaction
    trf_payload = {
        "client_mutation_id": mutation_id,
        "account_id": acc_a["id"],
        "to_account_id": acc_b["id"],
        "transaction_type": "transfer",
        "amount_minor": 20000, # ₹200
        "currency": "INR",
        "transaction_date": datetime.now(timezone.utc).isoformat(),
        "device_id": "test-device"
    }
    res_trf1 = await api_client.post("/api/transactions", json=trf_payload, headers=headers)
    assert res_trf1.status_code == 201
    tx_id = res_trf1.json()["id"]

    # 2. Duplicate mutation submission (Idempotency test)
    res_trf2 = await api_client.post("/api/transactions", json=trf_payload, headers=headers)
    assert res_trf2.status_code == 200 # Returns existing transaction cleanly!
    assert res_trf2.json()["id"] == tx_id

    # 3. Check balances & Net worth
    fin_summary = (await api_client.get("/api/finance/summary", headers=headers)).json()
    acc_balances = (await api_client.get("/api/finance/account-balances", headers=headers)).json()

    bal_a = next(a["balance_minor"] for a in acc_balances if a["account_id"] == acc_a["id"])
    bal_b = next(a["balance_minor"] for a in acc_balances if a["account_id"] == acc_b["id"])

    assert bal_a == 30000  # 50000 - 20000
    assert bal_b == 20000  # 0 + 20000
    assert fin_summary["net_worth_minor"] == 50000 # Total Net worth unchanged!


@pytest.mark.asyncio
async def test_bill_creation_and_payment_flow(api_client: AsyncClient):
    """
    Test 12 & 13: Bill creation leaves balance unchanged until explicit bill payment transaction.
    """
    u_reg = await api_client.post("/api/auth/register", json={
        "email": "bill_user@example.com",
        "password": "Jhelum-Ferry-1892",
        "display_name": "Bill User"
    })
    headers = {"Authorization": f"Bearer {u_reg.json()['access_token']}"}

    account = (await api_client.post("/api/accounts", json={"name": "Checking", "account_type": "asset", "opening_balance_minor": 80000}, headers=headers)).json()

    # 1. Create a Bill of ₹1,500 (150000 paise)
    bill_res = await api_client.post("/api/bills", json={
        "name": "Wifi Internet",
        "amount_minor": 150000,
        "due_date": datetime.now(timezone.utc).isoformat()
    }, headers=headers)
    assert bill_res.status_code == 201
    bill_id = bill_res.json()["id"]

    # Verify balance is still ₹800 (80000 paise)
    bal_initial = (await api_client.get(f"/api/accounts/{account['id']}", headers=headers)).json()["balance_paise"]
    assert bal_initial == 80000

    # 2. Pay Bill
    pay_res = await api_client.post(f"/api/bills/{bill_id}/pay", json={
        "account_id": account["id"],
        "client_mutation_id": str(uuid.uuid4()),
        "device_id": "test-device"
    }, headers=headers)
    assert pay_res.status_code == 200
    assert pay_res.json()["transaction_type"] == "expense"

    # Verify balance reduced by 150000 paise (or opening 80000 - 150000 = -70000 paise)
    bal_after = (await api_client.get(f"/api/accounts/{account['id']}", headers=headers)).json()["balance_paise"]
    assert bal_after == -70000


@pytest.mark.asyncio
async def test_profile_update(api_client: AsyncClient):
    """
    Test 15: Profile update endpoint.
    """
    u_reg = await api_client.post("/api/auth/register", json={
        "email": "profile_user@example.com",
        "password": "Jhelum-Ferry-1892",
        "display_name": "Original Name"
    })
    headers = {"Authorization": f"Bearer {u_reg.json()['access_token']}"}

    patch_res = await api_client.patch("/api/profile", json={
        "display_name": "Updated Name"
    }, headers=headers)
    assert patch_res.status_code == 200
    assert patch_res.json()["display_name"] == "Updated Name"

    # Currency is deliberately NOT changeable here. Amounts are stored as plain
    # integer minor units, so swapping the label alone would silently misreport
    # every figure the user owns.
    reject = await api_client.patch("/api/profile", json={
        "currency": "EUR"
    }, headers=headers)
    assert reject.status_code == 400

    # The dedicated endpoint makes the choice explicit. Relabel-only leaves the
    # stored numbers untouched.
    changed = await api_client.post("/api/profile/currency", json={
        "currency": "EUR",
        "convert": False
    }, headers=headers)
    assert changed.status_code == 200
    assert changed.json()["currency"] == "EUR"
    assert changed.json()["converted"] is False
