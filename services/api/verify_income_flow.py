import asyncio
import uuid
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"income_test_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": password,
            "display_name": f"Income Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. INITIAL INCOME CHECK (EMPTY INCOME HISTORY) ---")
        inc_empty = (await client.get("/income", headers=headers)).json()
        assert len(inc_empty) == 0
        print("Verified empty income transactions list for new user.")

        print("--- 3. CREATE ACCOUNT & INCOME CATEGORY ---")
        acc_res = await client.post("/accounts", json={
            "name": "Salary Checking",
            "account_type": "asset",
            "opening_balance_minor": 1000000 # INR 10,000.00
        }, headers=headers)
        assert acc_res.status_code == 201
        acc_id = acc_res.json()["id"]

        cat_res = await client.post("/categories", json={
            "name": "Salary & Wages",
            "type": "income",
            "icon": "Wallet",
            "color": "#2563EB"
        }, headers=headers)
        assert cat_res.status_code == 201
        cat_id = cat_res.json()["id"]

        print("--- 4. CREATE RECURRING SALARY RULE ---")
        rec_res = await client.post("/income/recurring", json={
            "source": "Tech Corp Salary",
            "amount_minor": 7500000, # Expected INR 75,000.00
            "frequency": "monthly",
            "next_occurrence": "2026-09-01T00:00:00Z",
            "active": True
        }, headers=headers)
        assert rec_res.status_code == 201
        rec_id = rec_res.json()["id"]
        print("Recurring salary rule created: 'Tech Corp Salary' expected INR 75,000.00")

        print("--- 5. VERIFY RECURRING RULE DOES NOT MUTATE LEDGER AUTOMATICALLY ---")
        # Transaction history must still be empty!
        txs_before = (await client.get("/income", headers=headers)).json()
        assert len(txs_before) == 0
        # Account balance must still be opening balance!
        acc_before = (await client.get(f"/accounts/{acc_id}", headers=headers)).json()
        assert acc_before["balance_paise"] == 1000000
        print("CRITICAL CHECK PASSED: Recurring salary rule did NOT automatically mutate ledger or balance!")

        print("--- 6. SIMULATE 'I GOT MY SALARY TODAY' CONFIRMATION & SAVE INCOME ---")
        mutation_id = str(uuid.uuid4())
        inc_tx = await client.post("/transactions", json={
            "client_mutation_id": mutation_id,
            "account_id": acc_id,
            "category_id": cat_id,
            "transaction_type": "income",
            "amount_minor": 7500000, # INR 75,000.00
            "currency": "INR",
            "description": "Salary Received: Tech Corp Salary",
            "transaction_date": "2026-08-31T11:00:00Z",
            "device_id": "api-test"
        }, headers=headers)
        assert inc_tx.status_code == 201
        tx_data = inc_tx.json()
        assert tx_data["amount_minor"] == 7500000
        print(f"Salary income confirmed and recorded! ID: {tx_data['id']}, Amount: INR {tx_data['amount_minor']/100}")

        print("--- 7. IDEMPOTENCY CHECK (REPEATED CLIENT MUTATION ID) ---")
        dup_tx = await client.post("/transactions", json={
            "client_mutation_id": mutation_id,
            "account_id": acc_id,
            "category_id": cat_id,
            "transaction_type": "income",
            "amount_minor": 7500000,
            "currency": "INR",
            "description": "Salary Received: Tech Corp Salary",
            "transaction_date": "2026-08-31T11:00:00Z",
            "device_id": "api-test"
        }, headers=headers)
        assert dup_tx.status_code in [200, 201, 400]
        inc_after = (await client.get("/income", headers=headers)).json()
        assert len(inc_after) == 1 # Duplicate was NOT inserted into ledger
        print("Idempotency verified: duplicate client_mutation_id did NOT duplicate ledger entries.")

        print("--- 8. VERIFY CROSS-MODULE UPDATES ---")
        # Account Balance Update
        acc_updated = (await client.get(f"/accounts/{acc_id}", headers=headers)).json()
        assert acc_updated["balance_paise"] == 8500000 # 1000000 + 7500000 = 8500000 (INR 85,000.00)
        print(f"Account balance dynamically updated to: INR {acc_updated['balance_paise']/100}")

        # Home Financial Summary Update
        summary = (await client.get("/finance/summary", headers=headers)).json()
        assert summary["income_minor"] == 7500000
        print(f"Home Summary income_minor dynamically updated to: INR {summary['income_minor']/100}")

        print("--- 9. RE-LOGIN & PERSISTENCE VERIFICATION ---")
        login_res = await client.post("/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_res.status_code == 200
        new_headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        persisted_inc = (await client.get("/income", headers=new_headers)).json()
        assert len(persisted_inc) == 1
        assert persisted_inc[0]["amount_minor"] == 7500000
        print("Re-login verified: all income transaction data persisted cleanly across sessions!")
        print("--- ALL INCOME & SALARY MANAGEMENT USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
