import asyncio
import uuid
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"activity_test_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": password,
            "display_name": f"Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. FETCH ME & INITIAL ACTIVITY (EMPTY CHECK) ---")
        me_res = await client.get("/auth/me", headers=headers)
        assert me_res.status_code == 200
        print(f"Logged in as: {me_res.json()['display_name']} ({me_res.json()['email']})")

        tx_empty_res = await client.get("/transactions", headers=headers)
        assert tx_empty_res.status_code == 200
        assert len(tx_empty_res.json()) == 0
        print("Initial Activity log verified EMPTY.")

        print("--- 3. CREATE ACCOUNTS ---")
        acc_res = await client.post("/accounts", json={
            "name": "Main Checking",
            "account_type": "asset",
            "opening_balance_minor": 100000 # INR 1000
        }, headers=headers)
        assert acc_res.status_code == 201
        acc_id = acc_res.json()["id"]

        acc2_res = await client.post("/accounts", json={
            "name": "Savings Reserve",
            "account_type": "asset",
            "opening_balance_minor": 50000 # INR 500
        }, headers=headers)
        assert acc2_res.status_code == 201
        acc2_id = acc2_res.json()["id"]

        print("--- 4. ADD EXPENSE TRANSACTION ---")
        exp_res = await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc_id,
            "transaction_type": "expense",
            "amount_minor": 25050, # INR 250.50
            "currency": "INR",
            "description": "Supermarket Grocery",
            "transaction_date": "2026-08-31T10:00:00Z",
            "device_id": "api-test"
        }, headers=headers)
        assert exp_res.status_code == 201
        print("Expense created: INR 250.50")

        print("--- 5. ADD INCOME TRANSACTION ---")
        inc_res = await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc_id,
            "transaction_type": "income",
            "amount_minor": 500000, # INR 5,000.00
            "currency": "INR",
            "description": "Freelance Payment",
            "transaction_date": "2026-08-31T10:10:00Z",
            "device_id": "api-test"
        }, headers=headers)
        assert inc_res.status_code == 201
        print("Income created: INR 5,000.00")

        print("--- 6. ADD TRANSFER TRANSACTION ---")
        trf_res = await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc_id,
            "to_account_id": acc2_id,
            "transaction_type": "transfer",
            "amount_minor": 20000, # INR 200.00
            "currency": "INR",
            "description": "Vault Transfer",
            "transaction_date": "2026-08-31T10:15:00Z",
            "device_id": "api-test"
        }, headers=headers)
        assert trf_res.status_code == 201
        print("Transfer created: INR 200.00")

        print("--- 7. VERIFY ALL TRANSACTIONS IN ACTIVITY LOG ---")
        all_txs = (await client.get("/transactions", headers=headers)).json()
        assert len(all_txs) == 3
        types = [t["transaction_type"] for t in all_txs]
        assert "expense" in types
        assert "income" in types
        assert "transfer" in types
        print(f"Activity Log returned all 3 transactions cleanly: {types}")

        print("--- 8. VERIFY RE-LOGIN & DATA PERSISTENCE ---")
        login_res = await client.post("/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_res.status_code == 200
        new_headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        persisted_txs = (await client.get("/transactions", headers=new_headers)).json()
        assert len(persisted_txs) == 3
        print("Re-login verified: all transaction activity persisted across sessions!")
        print("--- ALL USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
