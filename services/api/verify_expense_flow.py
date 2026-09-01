import asyncio
import uuid
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"expense_test_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": password,
            "display_name": f"Expense Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. INITIAL ACCOUNTS CHECK (EMPTY ACCOUNT STATE) ---")
        accs_empty = (await client.get("/accounts", headers=headers)).json()
        assert len(accs_empty) == 0
        print("Verified empty accounts list for new user.")

        print("--- 3. CREATE ACCOUNT & EXPENSE CATEGORY ---")
        acc_res = await client.post("/accounts", json={
            "name": "Primary Wallet",
            "account_type": "asset",
            "opening_balance_minor": 500000 # INR 5,000.00
        }, headers=headers)
        assert acc_res.status_code == 201
        acc_id = acc_res.json()["id"]

        cat_res = await client.post("/categories", json={
            "name": "Food & Dining",
            "type": "expense",
            "icon": "Utensils",
            "color": "#FF6B6B"
        }, headers=headers)
        assert cat_res.status_code == 201
        cat_id = cat_res.json()["id"]

        print("--- 4. VALIDATION CHECKS (INVALID AMOUNT REJECTION) ---")
        bad_exp = await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc_id,
            "category_id": cat_id,
            "transaction_type": "expense",
            "amount_minor": 0, # Invalid zero amount
            "currency": "INR",
            "description": "Invalid Expense",
            "transaction_date": "2026-08-31T10:00:00Z",
            "device_id": "api-test"
        }, headers=headers)
        assert bad_exp.status_code == 400
        print("Zero amount expense correctly REJECTED by backend validation.")

        print("--- 5. SAVE VALID EXPENSE TRANSACTION ---")
        mutation_id = str(uuid.uuid4())
        valid_exp = await client.post("/transactions", json={
            "client_mutation_id": mutation_id,
            "account_id": acc_id,
            "category_id": cat_id,
            "transaction_type": "expense",
            "amount_minor": 45050, # INR 450.50
            "currency": "INR",
            "description": "Swiggy - Dinner with team",
            "transaction_date": "2026-08-31T10:30:00Z",
            "device_id": "api-test"
        }, headers=headers)
        assert valid_exp.status_code == 201
        exp_data = valid_exp.json()
        assert exp_data["amount_minor"] == 45050
        print(f"Expense saved successfully! ID: {exp_data['id']}, Amount: INR {exp_data['amount_minor']/100}")

        print("--- 6. IDEMPOTENCY CHECK (REPEATED CLIENT MUTATION ID) ---")
        dup_exp = await client.post("/transactions", json={
            "client_mutation_id": mutation_id,
            "account_id": acc_id,
            "category_id": cat_id,
            "transaction_type": "expense",
            "amount_minor": 45050,
            "currency": "INR",
            "description": "Swiggy - Dinner with team",
            "transaction_date": "2026-08-31T10:30:00Z",
            "device_id": "api-test"
        }, headers=headers)
        # Should return existing transaction or rejected duplicate
        assert dup_exp.status_code in [200, 201, 400]
        txs_list = (await client.get("/transactions", headers=headers)).json()
        assert len(txs_list) == 1 # Duplicate was NOT inserted into ledger
        print("Idempotency verified: duplicate client_mutation_id did NOT duplicate ledger entries.")

        print("--- 7. VERIFY CROSS-MODULE UPDATES ---")
        # Account Balance Update
        acc_updated = (await client.get(f"/accounts/{acc_id}", headers=headers)).json()
        assert acc_updated["balance_paise"] == 454950 # 500000 - 45050 = 454950 (INR 4,549.50)
        print(f"Account balance dynamically updated to: INR {acc_updated['balance_paise']/100}")

        # Home Financial Summary Update
        summary = (await client.get("/finance/summary", headers=headers)).json()
        assert summary["expense_minor"] == 45050
        print(f"Home Summary expense_minor dynamically updated to: INR {summary['expense_minor']/100}")

        print("--- 8. RE-LOGIN & PERSISTENCE VERIFICATION ---")
        login_res = await client.post("/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_res.status_code == 200
        new_headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        persisted_txs = (await client.get("/transactions", headers=new_headers)).json()
        assert len(persisted_txs) == 1
        assert persisted_txs[0]["amount_minor"] == 45050
        print("Re-login verified: all expense transaction data persisted cleanly across sessions!")
        print("--- ALL EXPENSE MANAGEMENT USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
