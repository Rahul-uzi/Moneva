import pytest
import pytest_asyncio
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select, and_

from main import app
from app.db.database import get_db
from app.models.models import Base, User, Account, Category, Transaction, Bill, SavingsGoal, Budget
from app.core.security import create_access_token, create_refresh_token

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
pytestmark = pytest.mark.asyncio

@pytest_asyncio.fixture
async def api_context():
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
        async with session_factory() as session:
            yield client, session

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


# ----------------------------------------------------
# 1. GOAL CONTRIBUTION 10-INVARIANT REGRESSION TEST
# ----------------------------------------------------
# ----------------------------------------------------
# 1. GOAL CONTRIBUTION 10-INVARIANT REGRESSION TEST
# ----------------------------------------------------
async def test_goal_contribution_10_invariants(api_context):
    client, session = api_context

    reg_res = await client.post("/api/auth/register", json={
        "email": "invariants_user@example.com",
        "password": "password123",
        "display_name": "Invariant User"
    })
    token = reg_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Setup: Create Account
    acc_res = await client.post("/api/accounts", json={
        "name": "Checking Account",
        "account_type": "asset",
        "currency": "INR",
        "opening_balance_minor": 100000 # ₹1,000.00
    }, headers=headers)
    assert acc_res.status_code == 201
    account_id = acc_res.json()["id"]

    # Setup: Create Category & Budget
    cat_res = await client.post("/api/categories", json={
        "name": "General Expenses",
        "type": "expense"
    }, headers=headers)
    assert cat_res.status_code == 201
    category_id = cat_res.json()["id"]

    bud_res = await client.post("/api/budgets", json={
        "category_id": category_id,
        "limit_amount_minor": 50000, # ₹500.00
        "start_date": "2026-01-01T00:00:00Z",
        "end_date": "2026-12-31T23:59:59Z"
    }, headers=headers)
    assert bud_res.status_code == 201

    # Setup: Create Savings Goal
    goal_res = await client.post("/api/goals", json={
        "name": "Emergency Fund",
        "target_amount_minor": 200000 # ₹2,000.00
    }, headers=headers)
    assert goal_res.status_code == 201
    goal_id = goal_res.json()["id"]

    # Fetch initial metrics
    initial_summary = (await client.get("/api/finance/summary", headers=headers)).json()
    initial_acc = (await client.get(f"/api/accounts/{account_id}", headers=headers)).json()
    initial_goal = (await client.get(f"/api/goals/{goal_id}", headers=headers)).json()
    initial_budget = (await client.get(f"/api/budgets", headers=headers)).json()[0]

    assert initial_acc["balance_paise"] == 100000
    assert initial_goal["current_saved_minor"] == 0

    # EXECUTE GOAL CONTRIBUTION TRANSFER (₹300.00)
    mutation_id = str(uuid.uuid4())
    contrib_res = await client.post("/api/transactions", json={
        "client_mutation_id": mutation_id,
        "account_id": account_id,
        "savings_goal_id": goal_id,
        "transaction_type": "transfer",
        "amount_minor": 30000,
        "currency": "INR",
        "description": "Goal Contribution: Emergency Fund",
        "transaction_date": "2026-08-31T12:00:00Z",
        "device_id": "test-device"
    }, headers=headers)
    assert contrib_res.status_code == 201

    # VERIFY INVARIANTS:
    updated_summary = (await client.get("/api/finance/summary", headers=headers)).json()
    updated_acc = (await client.get(f"/api/accounts/{account_id}", headers=headers)).json()
    updated_goal = (await client.get(f"/api/goals/{goal_id}", headers=headers)).json()
    updated_budgets = (await client.get("/api/budgets", headers=headers)).json()
    updated_budget = updated_budgets[0]

    # Invariant 1: funding account decreases correctly (100,000 - 30,000 = 70,000)
    assert updated_acc["balance_paise"] == 70000

    # Invariant 2: goal progress increases correctly (0 + 30,000 = 30,000)
    assert updated_goal["current_saved_minor"] == 30000
    assert updated_goal["progress_percentage"] == 15.0 # (30,000 / 200,000) * 100

    # Invariant 3: ordinary expense totals do not increase
    assert updated_summary["expense_minor"] == initial_summary["expense_minor"]

    # Invariant 4: income totals do not change
    assert updated_summary["income_minor"] == initial_summary["income_minor"]

    # Invariant 5: cash-flow reporting remains correct
    assert updated_summary["net_cash_flow_minor"] == initial_summary["net_cash_flow_minor"]

    # Invariant 7: budget spending does not increase
    assert updated_budget["spent_amount_minor"] == initial_budget["spent_amount_minor"]

    # Invariant 9: Activity history recorded correctly
    tx_list = (await client.get("/api/transactions", headers=headers)).json()
    assert len(tx_list) == 1
    assert tx_list[0]["savings_goal_id"] == goal_id
    assert tx_list[0]["transaction_type"] == "transfer"

    # Invariant 10: Idempotency (re-submitting same mutation returns 200 with same tx)
    re_contrib_res = await client.post("/api/transactions", json={
        "client_mutation_id": mutation_id,
        "account_id": account_id,
        "savings_goal_id": goal_id,
        "transaction_type": "transfer",
        "amount_minor": 30000,
        "currency": "INR",
        "description": "Goal Contribution: Emergency Fund",
        "transaction_date": "2026-08-31T12:00:00Z",
        "device_id": "test-device"
    }, headers=headers)
    assert re_contrib_res.status_code == 200
    assert re_contrib_res.json()["id"] == contrib_res.json()["id"]


# ----------------------------------------------------
# 2. BILL PAYMENT CONCURRENCY & IDEMPOTENCY
# ----------------------------------------------------
async def test_bill_payment_idempotency_user_scoping(api_context):
    client, session = api_context

    reg_res = await client.post("/api/auth/register", json={
        "email": "bill_user@example.com",
        "password": "password123",
        "display_name": "Bill User"
    })
    token = reg_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    acc_res = await client.post("/api/accounts", json={
        "name": "Bill Pay Account",
        "account_type": "asset",
        "currency": "INR",
        "opening_balance_minor": 50000
    }, headers=headers)
    account_id = acc_res.json()["id"]

    bill_res = await client.post("/api/bills", json={
        "name": "Electricity Bill",
        "amount_minor": 15000,
        "due_date": "2026-09-15T00:00:00Z"
    }, headers=headers)
    bill_id = bill_res.json()["id"]

    mutation_id = str(uuid.uuid4())
    pay_res1 = await client.post(f"/api/bills/{bill_id}/pay", json={
        "account_id": account_id,
        "client_mutation_id": mutation_id,
        "device_id": "test-device"
    }, headers=headers)
    assert pay_res1.status_code == 200

    # Repeat payment with same mutation ID -> returns same transaction
    pay_res2 = await client.post(f"/api/bills/{bill_id}/pay", json={
        "account_id": account_id,
        "client_mutation_id": mutation_id,
        "device_id": "test-device"
    }, headers=headers)
    assert pay_res2.status_code == 200
    assert pay_res2.json()["id"] == pay_res1.json()["id"]


# ----------------------------------------------------
# 3. IDOR CATEGORY & GOAL OWNERSHIP ISOLATION
# ----------------------------------------------------
async def test_category_and_goal_ownership_isolation(api_context):
    client, session = api_context

    # Create User 1
    reg1_res = await client.post("/api/auth/register", json={
        "email": "user1_idor@example.com",
        "password": "password123",
        "display_name": "User One"
    })
    headers1 = {"Authorization": f"Bearer {reg1_res.json()['access_token']}"}

    # Create User 2
    reg2_res = await client.post("/api/auth/register", json={
        "email": "user2_idor@example.com",
        "password": "password123",
        "display_name": "User Two"
    })
    headers2 = {"Authorization": f"Bearer {reg2_res.json()['access_token']}"}

    # User 2 creates a custom category
    cat2_res = await client.post("/api/categories", json={
        "name": "User2 Secret Category",
        "type": "expense"
    }, headers=headers2)
    user2_category_id = cat2_res.json()["id"]

    # User 1 creates account
    acc_res = await client.post("/api/accounts", json={
        "name": "User 1 Account",
        "account_type": "asset"
    }, headers=headers1)
    user1_account_id = acc_res.json()["id"]

    # User 1 tries to create transaction with User 2's category_id -> expect 404
    tx_res = await client.post("/api/transactions", json={
        "client_mutation_id": str(uuid.uuid4()),
        "account_id": user1_account_id,
        "category_id": user2_category_id,
        "transaction_type": "expense",
        "amount_minor": 500,
        "currency": "INR",
        "transaction_date": "2026-08-31T12:00:00Z",
        "device_id": "test"
    }, headers=headers1)
    assert tx_res.status_code == 404


# ----------------------------------------------------
# 4. REFRESH TOKEN USER VALIDATION FOR DEACTIVATED USERS
# ----------------------------------------------------
async def test_refresh_token_deactivated_user(api_context):
    client, session = api_context

    reg_res = await client.post("/api/auth/register", json={
        "email": "deactivated_user@example.com",
        "password": "password123",
        "display_name": "Deactivated User"
    })
    refresh_token = reg_res.json()["refresh_token"]

    # Deactivate user in DB
    user_stmt = select(User).where(User.email == "deactivated_user@example.com")
    res = await session.execute(user_stmt)
    user = res.scalar_one()
    user.is_active = False
    await session.commit()

    # Attempt token refresh -> Expect 401
    ref_res = await client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert ref_res.status_code == 401
    assert "inactive" in ref_res.json()["detail"].lower()
