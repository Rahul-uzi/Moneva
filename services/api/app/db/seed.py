import asyncio
import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import SessionLocal, engine
from app.models.models import Base, User, Account, Category, Transaction, Budget, SavingsGoal, Bill

async def seed_development_data():
    """
    Seeds initial development data for a dedicated dev user.
    WARNING: Do NOT run this script in production environments.
    """
    async with SessionLocal() as db:
        # Check if dev user already exists
        from sqlalchemy import select
        res = await db.execute(select(User).where(User.email == "devuser@moneva.app"))
        if res.scalar_one_or_none():
            print("Development seed data already exists. Skipping.")
            return

        # 1. Create Dev User
        dev_user = User(
            email="devuser@moneva.app",
            password_hash="$2b$12$devhashplaceholderforlocaltestingonly",
            display_name="MONEVA Dev User",
            currency="INR",
            timezone="Asia/Kolkata"
        )
        db.add(dev_user)
        await db.flush()

        # 2. Create Accounts (Asset & Liability)
        bank_acc = Account(
            user_id=dev_user.id,
            name="HDFC Bank",
            account_type="asset",
            currency="INR",
            opening_balance_minor=5000000  # ₹50,000.00
        )
        cash_acc = Account(
            user_id=dev_user.id,
            name="Physical Cash",
            account_type="asset",
            currency="INR",
            opening_balance_minor=500000   # ₹5,000.00
        )
        credit_card = Account(
            user_id=dev_user.id,
            name="Amazon Pay ICICI Card",
            account_type="liability",
            currency="INR",
            opening_balance_minor=0
        )
        db.add_all([bank_acc, cash_acc, credit_card])
        await db.flush()

        # 3. Create Categories (Income & Expense)
        cat_salary = Category(user_id=dev_user.id, name="Salary", type="income", icon="wallet", color="#10B981", is_default=True)
        cat_food = Category(user_id=dev_user.id, name="Food & Dining", type="expense", icon="utensils", color="#FF6B6B", is_default=True)
        cat_bills = Category(user_id=dev_user.id, name="Utilities & Bills", type="expense", icon="file-text", color="#F59E0B", is_default=True)
        cat_shopping = Category(user_id=dev_user.id, name="Shopping", type="expense", icon="shopping-bag", color="#7C3AED", is_default=True)
        db.add_all([cat_salary, cat_food, cat_bills, cat_shopping])
        await db.flush()

        # 4. Create Sample Transactions
        tx1 = Transaction(
            client_mutation_id=uuid.uuid4(),
            user_id=dev_user.id,
            account_id=bank_acc.id,
            category_id=cat_salary.id,
            transaction_type="income",
            amount_minor=8500000,  # ₹85,000.00 salary
            currency="INR",
            description="Monthly Salary Credit",
            transaction_date=datetime.now(timezone.utc),
            device_id="dev-device-1"
        )
        tx2 = Transaction(
            client_mutation_id=uuid.uuid4(),
            user_id=dev_user.id,
            account_id=bank_acc.id,
            category_id=cat_food.id,
            transaction_type="expense",
            amount_minor=245000,   # ₹2,450.00 groceries
            currency="INR",
            description="Supermarket Groceries",
            transaction_date=datetime.now(timezone.utc),
            device_id="dev-device-1"
        )
        tx3 = Transaction(
            client_mutation_id=uuid.uuid4(),
            user_id=dev_user.id,
            account_id=bank_acc.id,
            to_account_id=cash_acc.id,
            transaction_type="transfer",
            amount_minor=200000,   # ₹2,000.00 ATM Withdrawal
            currency="INR",
            description="ATM Cash Withdrawal",
            transaction_date=datetime.now(timezone.utc),
            device_id="dev-device-1"
        )
        db.add_all([tx1, tx2, tx3])

        # 5. Create Sample Budget & Savings Goal
        budget_food = Budget(
            user_id=dev_user.id,
            category_id=cat_food.id,
            limit_amount_minor=1500000,  # ₹15,000.00 monthly food limit
            period="monthly",
            start_date=datetime(2026, 8, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 8, 31, tzinfo=timezone.utc)
        )
        goal_emergency = SavingsGoal(
            user_id=dev_user.id,
            name="Emergency Reserve Fund",
            target_amount_minor=30000000, # ₹3,00,000.00 target
            status="active"
        )
        bill_wifi = Bill(
            user_id=dev_user.id,
            name="Broadband WiFi Bill",
            amount_minor=85000,           # ₹850.00
            due_date=datetime(2026, 9, 5, tzinfo=timezone.utc),
            recurrence="monthly",
            category_id=cat_bills.id,
            status="upcoming"
        )
        db.add_all([budget_food, goal_emergency, bill_wifi])

        await db.commit()
        print("Development seed data created successfully for devuser@moneva.app!")

if __name__ == "__main__":
    asyncio.run(seed_development_data())
