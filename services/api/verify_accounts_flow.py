import asyncio
import uuid
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"accounts_test_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": password,
            "display_name": f"Accounts Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. INITIAL ACCOUNTS CHECK (EMPTY STATE) ---")
        empty_res = await client.get("/accounts", headers=headers)
        assert empty_res.status_code == 200
        assert len(empty_res.json()) == 0
        print("Accounts list verified EMPTY for new user.")

        print("--- 3. ADD ASSET ACCOUNT ---")
        acc1_res = await client.post("/accounts", json={
            "name": "Main Bank Account",
            "account_type": "asset",
            "opening_balance_minor": 1000000 # INR 10,000.00
        }, headers=headers)
        assert acc1_res.status_code == 201
        acc1 = acc1_res.json()
        acc1_id = acc1["id"]
        assert acc1["balance_paise"] == 1000000
        print("Created Asset Account 'Main Bank Account' with opening balance INR 10,000.00")

        print("--- 4. ADD LIABILITY ACCOUNT ---")
        acc2_res = await client.post("/accounts", json={
            "name": "Credit Card",
            "account_type": "liability",
            "opening_balance_minor": 250000 # INR 2,500.00
        }, headers=headers)
        assert acc2_res.status_code == 201
        acc2 = acc2_res.json()
        acc2_id = acc2["id"]
        assert acc2["balance_paise"] == 250000
        print("Created Liability Account 'Credit Card' with opening balance INR 2,500.00")

        print("--- 5. VERIFY ACCOUNTS OVERVIEW METRICS ---")
        accounts_list = (await client.get("/accounts", headers=headers)).json()
        assert len(accounts_list) == 2
        assets_total = sum(a["balance_paise"] for a in accounts_list if a["account_type"] == "asset")
        liabilities_total = sum(a["balance_paise"] for a in accounts_list if a["account_type"] == "liability")
        assert assets_total == 1000000
        assert liabilities_total == 250000
        print(f"Overview Metrics verified: Assets = INR {assets_total/100}, Liabilities = INR {liabilities_total/100}")

        print("--- 6. ADD EXPENSE TRANSACTION (MUTATES ACCOUNT 1 BALANCE) ---")
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc1_id,
            "transaction_type": "expense",
            "amount_minor": 125000, # INR 1,250.00
            "currency": "INR",
            "description": "Electronics Purchase",
            "transaction_date": "2026-08-31T10:00:00Z",
            "device_id": "api-test"
        }, headers=headers)

        acc1_after_exp = (await client.get(f"/accounts/{acc1_id}", headers=headers)).json()
        assert acc1_after_exp["balance_paise"] == 875000 # 1000000 - 125000 = 875000
        print(f"Account 1 balance updated after Expense: INR {acc1_after_exp['balance_paise']/100}")

        print("--- 7. ADD INCOME TRANSACTION (MUTATES ACCOUNT 1 BALANCE) ---")
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc1_id,
            "transaction_type": "income",
            "amount_minor": 300000, # INR 3,000.00
            "currency": "INR",
            "description": "Consulting Income",
            "transaction_date": "2026-08-31T10:10:00Z",
            "device_id": "api-test"
        }, headers=headers)

        acc1_after_inc = (await client.get(f"/accounts/{acc1_id}", headers=headers)).json()
        assert acc1_after_inc["balance_paise"] == 1175000 # 875000 + 300000 = 1175000
        print(f"Account 1 balance updated after Income: INR {acc1_after_inc['balance_paise']/100}")

        print("--- 8. TRANSFER BETWEEN ACCOUNTS ---")
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc1_id,
            "to_account_id": acc2_id,
            "transaction_type": "transfer",
            "amount_minor": 50000, # INR 500.00
            "currency": "INR",
            "description": "Credit Card Bill Pay",
            "transaction_date": "2026-08-31T10:20:00Z",
            "device_id": "api-test"
        }, headers=headers)

        acc1_after_trf = (await client.get(f"/accounts/{acc1_id}", headers=headers)).json()
        acc2_after_trf = (await client.get(f"/accounts/{acc2_id}", headers=headers)).json()
        assert acc1_after_trf["balance_paise"] == 1125000 # 1175000 - 50000
        assert acc2_after_trf["balance_paise"] == 200000  # 250000 - 50000 (liability payment reduces liability)
        print("Transfer verified: Account 1 = INR 11,250.00, Account 2 = INR 2,000.00")

        print("--- 9. EDIT ACCOUNT ---")
        edit_res = await client.patch(f"/accounts/{acc1_id}", json={
            "name": "Primary Checking HDFC"
        }, headers=headers)
        assert edit_res.status_code == 200
        assert edit_res.json()["name"] == "Primary Checking HDFC"
        print("Account edited name to 'Primary Checking HDFC'")

        print("--- 10. DELETE (DEACTIVATE) ACCOUNT ---")
        del_res = await client.delete(f"/accounts/{acc2_id}", headers=headers)
        assert del_res.status_code == 204
        accounts_after_del = (await client.get("/accounts", headers=headers)).json()
        assert len(accounts_after_del) == 1
        assert accounts_after_del[0]["id"] == acc1_id
        print("Account 2 deactivated. Active accounts list now contains 1 account.")

        print("--- 11. RE-LOGIN & PERSISTENCE VERIFICATION ---")
        login_res = await client.post("/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_res.status_code == 200
        new_headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        persisted_accs = (await client.get("/accounts", headers=new_headers)).json()
        assert len(persisted_accs) == 1
        assert persisted_accs[0]["name"] == "Primary Checking HDFC"
        assert persisted_accs[0]["balance_paise"] == 1125000
        print("Re-login verified: all accounts and ledger balances persisted cleanly!")
        print("--- ALL ACCOUNTS USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
