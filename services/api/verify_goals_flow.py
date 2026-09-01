import asyncio
import uuid
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"goals_test_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": password,
            "display_name": f"Goals Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. INITIAL GOALS CHECK (EMPTY STATE) ---")
        goals_empty = (await client.get("/goals", headers=headers)).json()
        assert len(goals_empty) == 0
        print("Verified empty goals list for new user.")

        print("--- 3. CREATE FUNDING ACCOUNT ---")
        acc_res = await client.post("/accounts", json={
            "name": "Main Checking",
            "account_type": "asset",
            "opening_balance_minor": 5000000 # INR 50,000.00
        }, headers=headers)
        assert acc_res.status_code == 201
        acc_id = acc_res.json()["id"]

        print("--- 4. CREATE SAVINGS GOAL (INR 1,00,000.00 TARGET) ---")
        goal_res = await client.post("/goals", json={
            "name": "Emergency Fund",
            "target_amount_minor": 10000000, # INR 1,00,000.00
            "target_date": "2026-12-31T00:00:00Z",
            "status": "active"
        }, headers=headers)
        assert goal_res.status_code == 201
        goal_id = goal_res.json()["id"]
        print("Savings goal created: 'Emergency Fund' target INR 1,00,000.00")

        print("--- 5. CRITICAL FINANCIAL RULE: CREATING GOAL DOES NOT MOVE MONEY ---")
        # 1. Account balance must NOT change!
        acc_check = (await client.get(f"/accounts/{acc_id}", headers=headers)).json()
        assert acc_check["balance_paise"] == 5000000
        # 2. Saved amount must be INR 0.00!
        goal_check = (await client.get(f"/goals/{goal_id}", headers=headers)).json()
        assert goal_check["current_saved_minor"] == 0
        assert goal_check["progress_percentage"] == 0.0
        print("CRITICAL CHECK PASSED: Creating goal did NOT move money or alter account balance!")

        print("--- 6. MAKE CONTRIBUTION 1 (INR 10,000.00) & VERIFY LEDGER MUTATION ---")
        mutation_1 = str(uuid.uuid4())
        tx_1 = await client.post("/transactions", json={
            "client_mutation_id": mutation_1,
            "account_id": acc_id,
            "savings_goal_id": goal_id,
            "transaction_type": "expense",
            "amount_minor": 1000000, # INR 10,000.00
            "currency": "INR",
            "description": "Goal Contribution: Emergency Fund",
            "transaction_date": "2026-08-31T10:00:00Z",
            "device_id": "api-test"
        }, headers=headers)
        assert tx_1.status_code == 201

        # Account balance must DECREASE by INR 10,000.00
        acc_after_1 = (await client.get(f"/accounts/{acc_id}", headers=headers)).json()
        assert acc_after_1["balance_paise"] == 4000000 # 50,000 - 10,000 = 40,000

        # Goal saved amount must INCREASE to INR 10,000.00 (10%)
        goal_after_1 = (await client.get(f"/goals/{goal_id}", headers=headers)).json()
        assert goal_after_1["current_saved_minor"] == 1000000
        assert goal_after_1["progress_percentage"] == 10.0
        print("Contribution 1 verified: Account balance = INR 40,000.00, Saved = INR 10,000.00 (10%)")

        print("--- 7. MAKE CONTRIBUTION 2 (INR 90,000.00) & REACH 100% COMPLETED TARGET ---")
        tx_2 = await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc_id,
            "savings_goal_id": goal_id,
            "transaction_type": "expense",
            "amount_minor": 9000000, # INR 90,000.00
            "currency": "INR",
            "description": "Goal Contribution: Emergency Fund Final",
            "transaction_date": "2026-08-31T11:00:00Z",
            "device_id": "api-test"
        }, headers=headers)
        assert tx_2.status_code == 201

        goal_completed = (await client.get(f"/goals/{goal_id}", headers=headers)).json()
        assert goal_completed["current_saved_minor"] == 10000000 # INR 1,00,000.00
        assert goal_completed["progress_percentage"] == 100.0
        print("Completed state verified: Saved = INR 1,00,000.00 (100.0% Completed)")

        print("--- 8. EDIT GOAL TARGET (INR 1,50,000.00) & RECALCULATE PROGRESS ---")
        patch_res = await client.patch(f"/goals/{goal_id}", json={
            "target_amount_minor": 15000000 # INR 1,50,000.00
        }, headers=headers)
        assert patch_res.status_code == 200
        goal_recalc = patch_res.json()
        assert goal_recalc["target_amount_minor"] == 15000000
        assert goal_recalc["current_saved_minor"] == 10000000
        assert goal_recalc["progress_percentage"] == 66.67 # (100,000 / 150,000) * 100
        print("Edit & progress recalculation verified: New Target = INR 1,50,000.00, Progress = 66.67%")

        print("--- 9. DELETE GOAL & VERIFY LEDGER TRANSACTIONS REMAIN INTACT ---")
        del_res = await client.delete(f"/goals/{goal_id}", headers=headers)
        assert del_res.status_code == 204

        goals_list = (await client.get("/goals", headers=headers)).json()
        assert len(goals_list) == 0

        # Underlying contribution transactions MUST remain intact!
        txs_intact = (await client.get("/transactions", headers=headers)).json()
        assert len(txs_intact) == 2
        print("Goal deleted cleanly. Underlying 2 contribution transactions verified 100% INTACT in ledger!")

        print("--- 10. RE-LOGIN & PERSISTENCE VERIFICATION ---")
        login_res = await client.post("/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_res.status_code == 200
        new_headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        persisted_txs = (await client.get("/transactions", headers=new_headers)).json()
        assert len(persisted_txs) == 2
        print("Re-login verified: all financial contribution ledger data persisted cleanly across sessions!")
        print("--- ALL SAVINGS GOALS MANAGEMENT USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
