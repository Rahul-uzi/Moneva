import uuid
from datetime import datetime, timezone
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.exc import IntegrityError

from app.models.models import Base, User, Account, Category, Transaction, Budget, SavingsGoal, Bill
from app.services.finance import (
    calculate_account_balance,
    calculate_net_worth,
    calculate_income_totals,
    calculate_expense_totals,
    calculate_cash_flow,
    calculate_budget_spending,
    calculate_budget_remaining,
    calculate_savings_goal_progress
)

# Test setup using in-memory SQLite
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.mark.asyncio
async def test_income_and_expense_balance(db_session: AsyncSession):
    """
    Test: ₹100 income (10000 paise) + ₹40 expense (4000 paise) => Balance = ₹60 (6000 paise).
    """
    user = User(email="user1@example.com", password_hash="hash", display_name="User One")
    db_session.add(user)
    await db_session.commit()

    account = Account(user_id=user.id, name="Bank Account", account_type="asset", opening_balance_minor=0)
    db_session.add(account)
    await db_session.commit()

    # Add ₹100 income
    tx_income = Transaction(
        client_mutation_id=uuid.uuid4(),
        user_id=user.id,
        account_id=account.id,
        transaction_type="income",
        amount_minor=10000,
        currency="INR",
        transaction_date=datetime.now(timezone.utc),
        device_id="dev1"
    )
    # Add ₹40 expense
    tx_expense = Transaction(
        client_mutation_id=uuid.uuid4(),
        user_id=user.id,
        account_id=account.id,
        transaction_type="expense",
        amount_minor=4000,
        currency="INR",
        transaction_date=datetime.now(timezone.utc),
        device_id="dev1"
    )
    db_session.add_all([tx_income, tx_expense])
    await db_session.commit()

    balance = await calculate_account_balance(db_session, account.id)
    assert balance == 6000  # ₹60 in paise


@pytest.mark.asyncio
async def test_transfer_between_accounts_and_net_worth(db_session: AsyncSession):
    """
    Test: Transfer between two accounts moves money without altering net worth.
    """
    user = User(email="user2@example.com", password_hash="hash", display_name="User Two")
    db_session.add(user)
    await db_session.commit()

    acc_a = Account(user_id=user.id, name="Bank A", account_type="asset", opening_balance_minor=10000) # ₹100
    acc_b = Account(user_id=user.id, name="Cash", account_type="asset", opening_balance_minor=0)
    db_session.add_all([acc_a, acc_b])
    await db_session.commit()

    net_worth_before = await calculate_net_worth(db_session, user.id)
    assert net_worth_before == 10000

    # Transfer ₹30 (3000 paise) from Bank A to Cash
    tx_transfer = Transaction(
        client_mutation_id=uuid.uuid4(),
        user_id=user.id,
        account_id=acc_a.id,
        to_account_id=acc_b.id,
        transaction_type="transfer",
        amount_minor=3000,
        currency="INR",
        transaction_date=datetime.now(timezone.utc),
        device_id="dev1"
    )
    db_session.add(tx_transfer)
    await db_session.commit()

    bal_a = await calculate_account_balance(db_session, acc_a.id)
    bal_b = await calculate_account_balance(db_session, acc_b.id)
    net_worth_after = await calculate_net_worth(db_session, user.id)

    assert bal_a == 7000   # ₹70 remaining
    assert bal_b == 3000   # ₹30 received
    assert net_worth_after == 10000  # Net worth unchanged!


@pytest.mark.asyncio
async def test_transfer_asset_to_asset_accounting_rules(db_session: AsyncSession):
    """
    TEST 1 — ASSET TO ASSET:
    Bank -> Cash transfer:
    - Bank balance decreases
    - Cash balance increases
    - Net worth remains unchanged
    - Excluded from income and expense totals
    """
    user = User(email="asset_asset@example.com", password_hash="hash", display_name="User Asset")
    db_session.add(user)
    await db_session.commit()

    bank = Account(user_id=user.id, name="Bank", account_type="asset", opening_balance_minor=1000000) # ₹10,000
    cash = Account(user_id=user.id, name="Cash", account_type="asset", opening_balance_minor=100000)  # ₹1,000
    db_session.add_all([bank, cash])
    await db_session.commit()

    net_worth_before = await calculate_net_worth(db_session, user.id)
    assert net_worth_before == 1100000 # ₹11,000

    # Transfer ₹2,000 (200000 paise) Bank -> Cash
    tx = Transaction(
        client_mutation_id=uuid.uuid4(),
        user_id=user.id,
        account_id=bank.id,
        to_account_id=cash.id,
        transaction_type="transfer",
        amount_minor=200000,
        currency="INR",
        transaction_date=datetime.now(timezone.utc),
        device_id="dev1"
    )
    db_session.add(tx)
    await db_session.commit()

    bank_bal = await calculate_account_balance(db_session, bank.id)
    cash_bal = await calculate_account_balance(db_session, cash.id)
    net_worth_after = await calculate_net_worth(db_session, user.id)
    income_totals = await calculate_income_totals(db_session, user.id)
    expense_totals = await calculate_expense_totals(db_session, user.id)

    assert bank_bal == 800000   # ₹8,000
    assert cash_bal == 300000   # ₹3,000
    assert net_worth_after == 1100000  # Net worth unchanged
    assert income_totals == 0   # Excluded from income
    assert expense_totals == 0  # Excluded from expense


@pytest.mark.asyncio
async def test_transfer_asset_to_liability_accounting_rules(db_session: AsyncSession):
    """
    TEST 2 — ASSET TO LIABILITY:
    Bank -> Credit Card transfer (Debt settlement):
    - Reduces source asset balance
    - Reduces liability balance owed
    - NOT counted as income
    - NOT counted as ordinary expense
    - Net worth remains unchanged
    """
    user = User(email="asset_liab@example.com", password_hash="hash", display_name="User Liab")
    db_session.add(user)
    await db_session.commit()

    bank = Account(user_id=user.id, name="Bank", account_type="asset", opening_balance_minor=1000000)      # ₹10,000 asset
    card = Account(user_id=user.id, name="Credit Card", account_type="liability", opening_balance_minor=500000) # ₹5,000 debt
    db_session.add_all([bank, card])
    await db_session.commit()

    # Net worth before = Assets (1000000) - Liabilities (500000) = 500000 (₹5,000)
    net_worth_before = await calculate_net_worth(db_session, user.id)
    assert net_worth_before == 500000

    # Transfer ₹2,000 (200000 paise) Bank -> Credit Card (Pay off credit card debt)
    tx = Transaction(
        client_mutation_id=uuid.uuid4(),
        user_id=user.id,
        account_id=bank.id,
        to_account_id=card.id,
        transaction_type="transfer",
        amount_minor=200000,
        currency="INR",
        transaction_date=datetime.now(timezone.utc),
        device_id="dev1"
    )
    db_session.add(tx)
    await db_session.commit()

    bank_bal = await calculate_account_balance(db_session, bank.id)
    card_bal = await calculate_account_balance(db_session, card.id)
    net_worth_after = await calculate_net_worth(db_session, user.id)
    income_totals = await calculate_income_totals(db_session, user.id)
    expense_totals = await calculate_expense_totals(db_session, user.id)

    assert bank_bal == 800000    # ₹8,000 asset remaining
    assert card_bal == 300000    # ₹3,000 debt remaining (reduced from ₹5,000)
    assert net_worth_after == 500000  # Net worth unchanged: Assets (800000) - Liabilities (300000) = 500000
    assert income_totals == 0    # Not counted as income
    assert expense_totals == 0   # Not counted as ordinary expense (liability settlement)


@pytest.mark.asyncio
async def test_budget_spending_and_remaining(db_session: AsyncSession):
    """
    Test: Dynamic budget spending and remaining calculation.
    """
    user = User(email="user3@example.com", password_hash="hash", display_name="User Three")
    category = Category(user_id=user.id, name="Food", type="expense")
    db_session.add_all([user, category])
    await db_session.commit()

    account = Account(user_id=user.id, name="Wallet", account_type="asset", opening_balance_minor=50000)
    db_session.add(account)
    await db_session.commit()

    now = datetime.now(timezone.utc)
    budget = Budget(
        user_id=user.id,
        category_id=category.id,
        limit_amount_minor=100000,  # ₹1,000 limit
        start_date=datetime(2026, 8, 1, tzinfo=timezone.utc),
        end_date=datetime(2026, 8, 31, tzinfo=timezone.utc)
    )
    db_session.add(budget)
    await db_session.commit()

    # Expense of ₹35 (3500 paise) in Food category
    tx = Transaction(
        client_mutation_id=uuid.uuid4(),
        user_id=user.id,
        account_id=account.id,
        category_id=category.id,
        transaction_type="expense",
        amount_minor=3500,
        currency="INR",
        transaction_date=datetime(2026, 8, 15, tzinfo=timezone.utc),
        device_id="dev1"
    )
    db_session.add(tx)
    await db_session.commit()

    result = await calculate_budget_remaining(db_session, budget.id)
    assert result["spent_amount_minor"] == 3500
    assert result["remaining_amount_minor"] == 96500  # 100000 - 3500


@pytest.mark.asyncio
async def test_savings_goal_progress(db_session: AsyncSession):
    """
    Test: Savings goal progress calculation and clamping.
    """
    user = User(email="user4@example.com", password_hash="hash", display_name="User Four")
    db_session.add(user)
    await db_session.flush()
    account = Account(user_id=user.id, name="Savings Acc", account_type="asset", opening_balance_minor=100000)
    goal = SavingsGoal(user_id=user.id, name="New Phone", target_amount_minor=100000) # ₹1,000 target
    db_session.add_all([account, goal])
    await db_session.commit()

    # Add ₹250 contribution linked to goal
    tx = Transaction(
        client_mutation_id=uuid.uuid4(),
        user_id=user.id,
        account_id=account.id,
        savings_goal_id=goal.id,
        transaction_type="transfer",
        amount_minor=25000,
        currency="INR",
        transaction_date=datetime.now(timezone.utc),
        device_id="dev1"
    )
    db_session.add(tx)
    await db_session.commit()

    res = await calculate_savings_goal_progress(db_session, goal.id)
    assert res["current_saved_minor"] == 25000
    assert res["progress_percentage"] == 25.0


@pytest.mark.asyncio
async def test_bill_creation_does_not_alter_balance(db_session: AsyncSession):
    """
    Test: Creating a bill does NOT alter account balance until explicitly paid via a transaction.
    """
    user = User(email="user5@example.com", password_hash="hash", display_name="User Five")
    db_session.add(user)
    await db_session.flush()
    account = Account(user_id=user.id, name="Checking", account_type="asset", opening_balance_minor=50000) # ₹500
    db_session.add(account)
    await db_session.commit()

    # 1. Create a bill of ₹85 (8500 paise)
    bill = Bill(user_id=user.id, name="Electricity Bill", amount_minor=8500, due_date=datetime.now(timezone.utc))
    db_session.add(bill)
    await db_session.commit()

    # Balance should STILL be ₹500 (50000 paise)
    bal_initial = await calculate_account_balance(db_session, account.id)
    assert bal_initial == 50000

    # 2. Record explicit payment transaction
    tx_pay = Transaction(
        client_mutation_id=uuid.uuid4(),
        user_id=user.id,
        account_id=account.id,
        transaction_type="expense",
        amount_minor=8500,
        currency="INR",
        description="Paid Electricity Bill",
        transaction_date=datetime.now(timezone.utc),
        device_id="dev1"
    )
    bill.status = "paid"
    db_session.add(tx_pay)
    await db_session.commit()

    # Balance is now reduced to ₹415 (41500 paise)
    bal_after_pay = await calculate_account_balance(db_session, account.id)
    assert bal_after_pay == 41500


@pytest.mark.asyncio
async def test_idempotency_duplicate_client_mutation_id_rejected(db_session: AsyncSession):
    """
    Test: Database rejects duplicate client_mutation_id entries.
    """
    user = User(email="user6@example.com", password_hash="hash", display_name="User Six")
    db_session.add(user)
    await db_session.flush()
    account = Account(user_id=user.id, name="Account", account_type="asset", opening_balance_minor=10000)
    db_session.add(account)
    await db_session.commit()

    mutation_id = uuid.uuid4()
    tx1 = Transaction(
        client_mutation_id=mutation_id,
        user_id=user.id,
        account_id=account.id,
        transaction_type="income",
        amount_minor=5000,
        currency="INR",
        transaction_date=datetime.now(timezone.utc),
        device_id="dev1"
    )
    db_session.add(tx1)
    await db_session.commit()

    # Attempt to insert identical mutation ID
    tx2 = Transaction(
        client_mutation_id=mutation_id,
        user_id=user.id,
        account_id=account.id,
        transaction_type="income",
        amount_minor=5000,
        currency="INR",
        transaction_date=datetime.now(timezone.utc),
        device_id="dev1"
    )
    db_session.add(tx2)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_user_data_isolation(db_session: AsyncSession):
    """
    Test: User 2 cannot see or access User 1's accounts or net worth.
    """
    user1 = User(email="user1_iso@example.com", password_hash="hash", display_name="User One")
    user2 = User(email="user2_iso@example.com", password_hash="hash", display_name="User Two")
    db_session.add_all([user1, user2])
    await db_session.commit()

    acc1 = Account(user_id=user1.id, name="User1 Bank", account_type="asset", opening_balance_minor=50000)
    db_session.add(acc1)
    await db_session.commit()

    # User 2 Net worth should be 0 (cannot see User 1's accounts)
    net_worth_user2 = await calculate_net_worth(db_session, user2.id)
    assert net_worth_user2 == 0


@pytest.mark.asyncio
async def test_idempotent_mutation_lookup_pattern(db_session: AsyncSession):
    """
    Test: Simulates API idempotency layer.
    Repeated request with same client_mutation_id retrieves existing record instead of duplicating.
    """
    from sqlalchemy import select
    user = User(email="user7@example.com", password_hash="hash", display_name="User Seven")
    db_session.add(user)
    await db_session.flush()
    account = Account(user_id=user.id, name="Checking", account_type="asset", opening_balance_minor=10000)
    db_session.add(account)
    await db_session.commit()

    client_mutation_id = uuid.uuid4()

    # 1. First mutation creation request
    tx_original = Transaction(
        client_mutation_id=client_mutation_id,
        user_id=user.id,
        account_id=account.id,
        transaction_type="income",
        amount_minor=12000,
        currency="INR",
        transaction_date=datetime.now(timezone.utc),
        device_id="mobile-device-42"
    )
    db_session.add(tx_original)
    await db_session.commit()

    # 2. Repeated mutation request with same client_mutation_id
    stmt = select(Transaction).where(Transaction.client_mutation_id == client_mutation_id)
    res = await db_session.execute(stmt)
    existing_tx = res.scalar_one_or_none()

    assert existing_tx is not None
    assert existing_tx.id == tx_original.id
    assert existing_tx.amount_minor == 12000
