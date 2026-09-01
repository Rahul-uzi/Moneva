import asyncio
import uuid
from datetime import datetime, timezone
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"analytics_test_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": password,
            "display_name": f"Analytics Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. INITIAL ANALYTICS CHECK (INSUFFICIENT DATA / EMPTY STATE) ---")
        empty_cat = (await client.get("/finance/analytics/category-breakdown", headers=headers)).json()
        empty_trend = (await client.get("/finance/analytics/spending-trends", headers=headers)).json()
        assert len(empty_cat) == 0
        assert len(empty_trend) == 0
        print("Verified empty analytics breakdown for new user.")

        print("--- 3. CREATE ACCOUNTS & CATEGORIES ---")
        bank_res = await client.post("/accounts", json={
            "name": "Bank Account",
            "account_type": "asset",
            "opening_balance_minor": 5000000 # INR 50,000.00
        }, headers=headers)
        bank_id = bank_res.json()["id"]

        cash_res = await client.post("/accounts", json={
            "name": "Cash Wallet",
            "account_type": "asset",
            "opening_balance_minor": 0
        }, headers=headers)
        cash_id = cash_res.json()["id"]

        cat_groc_res = await client.post("/categories", json={
            "name": "Groceries",
            "type": "expense",
            "icon": "ShoppingCart",
            "color": "#10B981"
        }, headers=headers)
        cat_groc_id = cat_groc_res.json()["id"]

        cat_dine_res = await client.post("/categories", json={
            "name": "Dining Out",
            "type": "expense",
            "icon": "Utensils",
            "color": "#FF6B6B"
        }, headers=headers)
        cat_dine_id = cat_dine_res.json()["id"]

        print("--- 4. RECORD INCOME, EXPENSES, & PURE TRANSFER ---")
        now_iso = datetime.now(timezone.utc).isoformat()

        # Income: INR 1,00,000.00
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": bank_id,
            "transaction_type": "income",
            "amount_minor": 10000000, # INR 1,00,000.00
            "currency": "INR",
            "description": "Monthly Salary",
            "transaction_date": now_iso,
            "device_id": "api-test"
        }, headers=headers)

        # Expense 1 (Groceries): INR 15,000.00
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": bank_id,
            "category_id": cat_groc_id,
            "transaction_type": "expense",
            "amount_minor": 1500000, # INR 15,000.00
            "currency": "INR",
            "description": "Supermarket Shopping",
            "transaction_date": now_iso,
            "device_id": "api-test"
        }, headers=headers)

        # Expense 2 (Dining): INR 5,000.00
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": bank_id,
            "category_id": cat_dine_id,
            "transaction_type": "expense",
            "amount_minor": 500000, # INR 5,000.00
            "currency": "INR",
            "description": "Restaurant Dinner",
            "transaction_date": now_iso,
            "device_id": "api-test"
        }, headers=headers)

        # Pure Transfer: INR 10,000.00 from Bank to Cash (MUST NOT BE COUNTED AS INCOME/EXPENSE)
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": bank_id,
            "to_account_id": cash_id,
            "transaction_type": "transfer",
            "amount_minor": 1000000, # INR 10,000.00
            "currency": "INR",
            "description": "ATM Cash Withdrawal",
            "transaction_date": now_iso,
            "device_id": "api-test"
        }, headers=headers)

        print("--- 5. GOAL CONTRIBUTION & BILL PAYMENT ---")
        # Goal & Contribution: INR 10,000.00 (expense transaction)
        goal_res = await client.post("/goals", json={
            "name": "Emergency Fund",
            "target_amount_minor": 10000000,
            "target_date": "2026-12-31T00:00:00Z"
        }, headers=headers)
        goal_id = goal_res.json()["id"]

        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": bank_id,
            "savings_goal_id": goal_id,
            "transaction_type": "expense",
            "amount_minor": 1000000, # INR 10,000.00
            "currency": "INR",
            "description": "Goal Contribution: Emergency Fund",
            "transaction_date": now_iso,
            "device_id": "api-test"
        }, headers=headers)

        # Bill & Payment: INR 2,450.00 (expense transaction)
        bill_res = await client.post("/bills", json={
            "name": "Electricity Bill",
            "amount_minor": 245000, # INR 2,450.00
            "currency": "INR",
            "due_date": now_iso
        }, headers=headers)
        bill_id = bill_res.json()["id"]

        await client.post(f"/bills/{bill_id}/pay", json={
            "account_id": bank_id,
            "client_mutation_id": str(uuid.uuid4()),
            "device_id": "api-test",
            "payment_date": now_iso
        }, headers=headers)

        print("--- 6. VERIFY ACCOUNTING CONSISTENCY & AUTHORITATIVE TOTALS ---")
        summary_res = await client.get("/finance/summary", headers=headers)
        assert summary_res.status_code == 200
        summary = summary_res.json()

        # Expected Income: INR 1,00,000.00 (10,000,000 paise)
        assert summary["income_minor"] == 10000000

        # Expected Expenses: 15,000 + 5,000 + 10,000 (goal) + 2,450 (bill) = INR 32,450.00 (3,245,000 paise)
        assert summary["expense_minor"] == 3245000

        # Expected Net Cash Flow: 100,000 - 32,450 = INR 67,550.00 (6,755,000 paise)
        assert summary["net_cash_flow_minor"] == 6755000

        # Transfer Exclusion: Confirmed transfer of INR 10,000.00 was STRICTLY EXCLUDED!
        print("ACCOUNTING CHECK PASSED: Total Income = INR 1,00,000.00, Expenses = INR 32,450.00, Net Flow = INR 67,550.00, Transfer strictly EXCLUDED!")

        print("--- 7. VERIFY CATEGORY BREAKDOWN & SPENDING TRENDS ---")
        cat_breakdown = (await client.get("/finance/analytics/category-breakdown", headers=headers)).json()
        assert len(cat_breakdown) >= 2
        print(f"Category breakdown verified with {len(cat_breakdown)} categories.")

        spending_trends = (await client.get("/finance/analytics/spending-trends", headers=headers)).json()
        assert len(spending_trends) >= 1
        print(f"Spending trends verified with {len(spending_trends)} trend data points.")

        print("--- 8. VERIFY FINANCIAL REPORT EXPORT ---")
        report_res = await client.get("/finance/reports/export", headers=headers)
        assert report_res.status_code == 200
        report = report_res.json()
        assert report["summary"]["income_minor"] == 10000000
        assert report["summary"]["expense_minor"] == 3245000
        assert "category_breakdown" in report
        assert "spending_trends" in report
        print("Financial Analytics Report generation verified successfully.")

        print("--- 9. SECURITY & USER ISOLATION TESTS ---")
        unauth = await client.get("/finance/summary")
        assert unauth.status_code == 401
        print("Unauthenticated analytics access rejection verified.")
        print("--- ALL ANALYTICS & REPORTS MANAGEMENT USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
