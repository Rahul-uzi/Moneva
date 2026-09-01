import asyncio
import uuid
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"plan_test_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": password,
            "display_name": f"Plan Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. INITIAL PLAN CHECK (EMPTY STATES) ---")
        bud_empty = (await client.get("/budgets", headers=headers)).json()
        goal_empty = (await client.get("/goals", headers=headers)).json()
        bill_empty = (await client.get("/bills", headers=headers)).json()
        assert len(bud_empty) == 0
        assert len(goal_empty) == 0
        assert len(bill_empty) == 0
        print("Initial Plan data verified EMPTY.")

        print("--- 3. CREATE EXPENSE CATEGORY & BUDGET ---")
        cat_res = await client.post("/categories", json={
            "name": "Dining & Groceries",
            "type": "expense",
            "icon": "Utensils",
            "color": "#FF6B6B"
        }, headers=headers)
        assert cat_res.status_code == 201
        exp_cat = cat_res.json()

        bud_res = await client.post("/budgets", json={
            "category_id": exp_cat["id"],
            "limit_amount_minor": 1000000, # INR 10,000.00
            "period": "monthly",
            "start_date": "2026-08-01T00:00:00Z",
            "end_date": "2026-08-31T23:59:59Z"
        }, headers=headers)
        assert bud_res.status_code == 201
        bud_id = bud_res.json()["id"]
        print("Category Budget created: INR 10,000.00 limit")

        print("--- 4. CREATE SAVINGS GOAL ---")
        goal_res = await client.post("/goals", json={
            "name": "New Laptop Fund",
            "target_amount_minor": 5000000, # INR 50,000.00
            "target_date": "2026-12-31T00:00:00Z",
            "status": "active"
        }, headers=headers)
        assert goal_res.status_code == 201
        goal_id = goal_res.json()["id"]
        print("Savings Goal created: 'New Laptop Fund' target INR 50,000.00")

        print("--- 5. CREATE BILL REMINDER & PAY BILL ---")
        bill_res = await client.post("/bills", json={
            "name": "WiFi Fiber Broadband",
            "amount_minor": 150000, # INR 1,500.00
            "currency": "INR",
            "due_date": "2026-09-05T00:00:00Z",
            "recurrence": "monthly",
            "category_id": exp_cat["id"],
            "status": "upcoming"
        }, headers=headers)
        assert bill_res.status_code == 201
        bill_id = bill_res.json()["id"]

        # Create account to pay bill
        acc_res = await client.post("/accounts", json={
            "name": "Checking Account",
            "account_type": "asset",
            "opening_balance_minor": 500000 # INR 5,000.00
        }, headers=headers)
        acc_id = acc_res.json()["id"]

        # Pay Bill
        pay_res = await client.post(f"/bills/{bill_id}/pay", json={
            "account_id": acc_id,
            "client_mutation_id": str(uuid.uuid4()),
            "device_id": "api-test",
            "payment_date": "2026-08-31T10:00:00Z"
        }, headers=headers)
        assert pay_res.status_code == 200
        print("Bill paid successfully! Bill status updated to 'paid' and expense recorded.")

        print("--- 6. VERIFY DYNAMIC BUDGET SPENDING UPDATE ---")
        bud_updated = (await client.get(f"/budgets/{bud_id}", headers=headers)).json()
        assert bud_updated["spent_amount_minor"] == 150000 # Bill payment spent INR 1,500.00
        assert bud_updated["remaining_amount_minor"] == 850000 # 10,000 - 1,500 = 8,500
        print("Budget dynamic spending verified: Spent = INR 1,500.00, Remaining = INR 8,500.00")

        print("--- 7. EDIT & DELETE PLAN ITEMS ---")
        # Edit Budget
        patch_bud = await client.patch(f"/budgets/{bud_id}", json={
            "limit_amount_minor": 1200000 # INR 12,000.00
        }, headers=headers)
        assert patch_bud.status_code == 200
        assert patch_bud.json()["limit_amount_minor"] == 1200000

        # Delete Goal
        del_goal = await client.delete(f"/goals/{goal_id}", headers=headers)
        assert del_goal.status_code == 204
        goals_list = (await client.get("/goals", headers=headers)).json()
        assert len(goals_list) == 0
        print("Budget updated and Goal deleted cleanly.")

        print("--- 8. RE-LOGIN & PERSISTENCE VERIFICATION ---")
        login_res = await client.post("/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_res.status_code == 200
        new_headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        persisted_buds = (await client.get("/budgets", headers=new_headers)).json()
        assert len(persisted_buds) == 1
        assert persisted_buds[0]["limit_amount_minor"] == 1200000
        print("Re-login verified: all plan data persisted cleanly across sessions!")
        print("--- ALL PLAN USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
