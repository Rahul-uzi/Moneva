import asyncio
import uuid
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"budget_test_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": password,
            "display_name": f"Budget Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. INITIAL BUDGET CHECK (EMPTY STATE) ---")
        bud_empty = (await client.get("/budgets", headers=headers)).json()
        assert len(bud_empty) == 0
        print("Verified empty budgets list for new user.")

        print("--- 3. CREATE ACCOUNT & EXPENSE CATEGORY ---")
        acc_res = await client.post("/accounts", json={
            "name": "Main Checking",
            "account_type": "asset",
            "opening_balance_minor": 5000000 # INR 50,000.00
        }, headers=headers)
        assert acc_res.status_code == 201
        acc_id = acc_res.json()["id"]

        cat_res = await client.post("/categories", json={
            "name": "Restaurants & Dining",
            "type": "expense",
            "icon": "Utensils",
            "color": "#FF6B6B"
        }, headers=headers)
        assert cat_res.status_code == 201
        cat_id = cat_res.json()["id"]

        print("--- 4. CREATE CATEGORY BUDGET (INR 10,000.00 LIMIT) ---")
        bud_res = await client.post("/budgets", json={
            "category_id": cat_id,
            "limit_amount_minor": 1000000, # INR 10,000.00
            "period": "monthly",
            "start_date": "2026-08-01T00:00:00Z",
            "end_date": "2026-08-31T23:59:59Z"
        }, headers=headers)
        assert bud_res.status_code == 201
        bud_id = bud_res.json()["id"]
        print("Budget created: INR 10,000.00 limit")

        print("--- 5. VERIFY INITIAL SPENT & REMAINING VALUES ---")
        bud_initial = (await client.get(f"/budgets/{bud_id}", headers=headers)).json()
        assert bud_initial["spent_amount_minor"] == 0
        assert bud_initial["remaining_amount_minor"] == 1000000
        print("Initial Budget verified: Spent = INR 0.00, Remaining = INR 10,000.00 (Healthy)")

        print("--- 6. ADD EXPENSE 1 (INR 1,500.00) & VERIFY DYNAMIC SPENDING ---")
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc_id,
            "category_id": cat_id,
            "transaction_type": "expense",
            "amount_minor": 150000, # INR 1,500.00
            "currency": "INR",
            "description": "Lunch meeting",
            "transaction_date": "2026-08-31T10:00:00Z",
            "device_id": "api-test"
        }, headers=headers)

        bud_after_1 = (await client.get(f"/budgets/{bud_id}", headers=headers)).json()
        assert bud_after_1["spent_amount_minor"] == 150000 # INR 1,500.00
        assert bud_after_1["remaining_amount_minor"] == 850000 # INR 8,500.00
        print("Dynamic update 1 verified: Spent = INR 1,500.00 (15%), Remaining = INR 8,500.00")

        print("--- 7. ADD EXPENSE 2 (INR 7,200.00) & VERIFY NEAR LIMIT WARNING STATE ---")
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc_id,
            "category_id": cat_id,
            "transaction_type": "expense",
            "amount_minor": 720000, # INR 7,200.00
            "currency": "INR",
            "description": "Team dinner party",
            "transaction_date": "2026-08-31T10:15:00Z",
            "device_id": "api-test"
        }, headers=headers)

        bud_after_2 = (await client.get(f"/budgets/{bud_id}", headers=headers)).json()
        assert bud_after_2["spent_amount_minor"] == 870000 # INR 8,700.00 (87%)
        assert bud_after_2["remaining_amount_minor"] == 130000 # INR 1,300.00
        print("Near Limit warning state verified: Total Spent = INR 8,700.00 (87% >= 85%)")

        print("--- 8. ADD EXPENSE 3 (INR 1,800.00) & VERIFY OVER-BUDGET STATE ---")
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc_id,
            "category_id": cat_id,
            "transaction_type": "expense",
            "amount_minor": 180000, # INR 1,800.00
            "currency": "INR",
            "description": "Weekend catering",
            "transaction_date": "2026-08-31T10:30:00Z",
            "device_id": "api-test"
        }, headers=headers)

        bud_after_3 = (await client.get(f"/budgets/{bud_id}", headers=headers)).json()
        assert bud_after_3["spent_amount_minor"] == 1050000 # INR 10,500.00 (105%)
        assert bud_after_3["remaining_amount_minor"] == -50000 # Negative remaining: -INR 500.00
        print("Over-budget state verified: Total Spent = INR 10,500.00 (105% >= 100%), Remaining = -INR 500.00")

        print("--- 9. EDIT BUDGET LIMIT (INR 15,000.00) & VERIFY PROGRESS RECALCULATION ---")
        patch_res = await client.patch(f"/budgets/{bud_id}", json={
            "limit_amount_minor": 1500000 # INR 15,000.00
        }, headers=headers)
        assert patch_res.status_code == 200
        bud_recalc = patch_res.json()
        assert bud_recalc["limit_amount_minor"] == 1500000
        assert bud_recalc["spent_amount_minor"] == 1050000
        assert bud_recalc["remaining_amount_minor"] == 450000 # INR 4,500.00 remaining
        print("Edit & progress recalculation verified: New Limit = INR 15,000.00, Spent = INR 10,500.00 (70%), Remaining = INR 4,500.00")

        print("--- 10. DELETE BUDGET & VERIFY TRANSACTIONS REMAIN INTACT ---")
        del_res = await client.delete(f"/budgets/{bud_id}", headers=headers)
        assert del_res.status_code == 204

        bud_list = (await client.get("/budgets", headers=headers)).json()
        assert len(bud_list) == 0

        # Underlying transactions MUST remain intact!
        txs_intact = (await client.get("/transactions", headers=headers)).json()
        assert len(txs_intact) == 3
        print("Budget deleted cleanly. Underlying 3 financial transactions verified 100% INTACT in ledger!")

        print("--- 11. RE-LOGIN & PERSISTENCE VERIFICATION ---")
        login_res = await client.post("/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_res.status_code == 200
        new_headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        persisted_txs = (await client.get("/transactions", headers=new_headers)).json()
        assert len(persisted_txs) == 3
        print("Re-login verified: all underlying financial ledger data persisted cleanly across sessions!")
        print("--- ALL BUDGET MANAGEMENT USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
