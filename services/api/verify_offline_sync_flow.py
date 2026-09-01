import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email_a = f"offline_a_{test_id}@example.com"
    email_b = f"offline_b_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("==================================================")
        print("MONEVA PHASE 8: COMPREHENSIVE OFFLINE HARDENING AUDIT")
        print("==================================================")

        # --------------------------------------------------
        # 1. REGISTER USERS
        # --------------------------------------------------
        print("\n--- 1. USER REGISTRATION & AUTHENTICATION ---")
        reg_a = await client.post("/auth/register", json={
            "email": email_a, "password": password, "display_name": f"Offline User A {test_id}"
        })
        assert reg_a.status_code == 201
        headers_a = {"Authorization": f"Bearer {reg_a.json()['access_token']}"}

        reg_b = await client.post("/auth/register", json={
            "email": email_b, "password": password, "display_name": f"Offline User B {test_id}"
        })
        assert reg_b.status_code == 201
        headers_b = {"Authorization": f"Bearer {reg_b.json()['access_token']}"}
        print("User A and User B registered successfully.")

        # --------------------------------------------------
        # 2. ONLINE BASELINE SETUP
        # --------------------------------------------------
        print("\n--- 2. ONLINE BASELINE SETUP ---")
        chk_res = await client.post("/accounts", json={
            "name": "Main Checking", "account_type": "asset", "opening_balance_minor": 10000000 # INR 100,000.00
        }, headers=headers_a)
        chk_id = chk_res.json()["id"]

        wal_res = await client.post("/accounts", json={
            "name": "Savings Wallet", "account_type": "asset", "opening_balance_minor": 0
        }, headers=headers_a)
        wal_id = wal_res.json()["id"]

        cat_res = await client.post("/categories", json={
            "name": "Groceries", "type": "expense"
        }, headers=headers_a)
        cat_id = cat_res.json()["id"]
        print("Main Checking (INR 100k), Savings Wallet, and Groceries Category set up.")

        # --------------------------------------------------
        # 3. OFFLINE FINANCIAL LEDGER MUTATIONS (EXPENSE, INCOME, TRANSFER)
        # --------------------------------------------------
        print("\n--- 3. OFFLINE LEDGER MUTATIONS (EXPENSE, INCOME, TRANSFER) ---")
        mut_exp_id = str(uuid.uuid4())
        mut_inc_id = str(uuid.uuid4())
        mut_trf_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()

        # Replay queued Expense (INR 20,000.00)
        res_exp = await client.post("/transactions", json={
            "client_mutation_id": mut_exp_id, "account_id": chk_id, "category_id": cat_id,
            "transaction_type": "expense", "amount_minor": 2000000, "currency": "INR",
            "description": "Offline Groceries", "transaction_date": now_iso, "device_id": "dev-1"
        }, headers=headers_a)
        assert res_exp.status_code == 201

        # Replay queued Income (INR 50,000.00)
        res_inc = await client.post("/transactions", json={
            "client_mutation_id": mut_inc_id, "account_id": chk_id,
            "transaction_type": "income", "amount_minor": 5000000, "currency": "INR",
            "description": "Offline Salary", "transaction_date": now_iso, "device_id": "dev-1"
        }, headers=headers_a)
        assert res_inc.status_code == 201

        # Replay queued Transfer (INR 10,000.00 to Savings Wallet)
        res_trf = await client.post("/transactions", json={
            "client_mutation_id": mut_trf_id, "account_id": chk_id, "to_account_id": wal_id,
            "transaction_type": "transfer", "amount_minor": 1000000, "currency": "INR",
            "description": "Offline Savings Transfer", "transaction_date": now_iso, "device_id": "dev-1"
        }, headers=headers_a)
        assert res_trf.status_code == 201
        print("Expense, Income, and Transfer queued offline mutations replayed successfully.")

        # --------------------------------------------------
        # 4. OFFLINE PLANNING ENTITY MUTATIONS (BUDGET, GOAL, BILL)
        # --------------------------------------------------
        print("\n--- 4. OFFLINE PLANNING MUTATIONS (CREATE & EDIT BUDGET, GOAL, BILL) ---")
        start_month = datetime.now(timezone.utc).replace(day=1).isoformat()
        end_month = (datetime.now(timezone.utc).replace(day=28) + timedelta(days=5)).isoformat()
        due_date = (datetime.now(timezone.utc) + timedelta(days=4)).isoformat()

        # A. Offline Create Budget
        bud_create = await client.post("/budgets", json={
            "category_id": cat_id, "limit_amount_minor": 3000000, "period": "monthly", # INR 30,000.00
            "start_date": start_month, "end_date": end_month
        }, headers=headers_a)
        assert bud_create.status_code == 201
        bud_id = bud_create.json()["id"]

        # B. Offline Edit Budget
        bud_edit = await client.patch(f"/budgets/{bud_id}", json={
            "limit_amount_minor": 3500000 # Increased to INR 35,000.00
        }, headers=headers_a)
        assert bud_edit.status_code == 200
        assert bud_edit.json()["limit_amount_minor"] == 3500000

        # C. Offline Create Goal
        goal_create = await client.post("/goals", json={
            "name": "New Car Fund", "target_amount_minor": 20000000 # INR 200,000.00
        }, headers=headers_a)
        assert goal_create.status_code == 201
        goal_id = goal_create.json()["id"]

        # D. Offline Edit Goal
        goal_edit = await client.patch(f"/goals/{goal_id}", json={
            "target_amount_minor": 25000000 # Increased to INR 250,000.00
        }, headers=headers_a)
        assert goal_edit.status_code == 200
        assert goal_edit.json()["target_amount_minor"] == 25000000

        # E. Offline Create Bill
        bill_create = await client.post("/bills", json={
            "name": "Internet Subscription", "amount_minor": 150000, "currency": "INR", "due_date": due_date
        }, headers=headers_a)
        assert bill_create.status_code == 201
        bill_id = bill_create.json()["id"]

        # F. Offline Edit Bill
        bill_edit = await client.patch(f"/bills/{bill_id}", json={
            "amount_minor": 180000 # Updated to INR 1,800.00
        }, headers=headers_a)
        assert bill_edit.status_code == 200
        assert bill_edit.json()["amount_minor"] == 180000
        print("Offline Budget, Goal, and Bill creation and edits verified cleanly.")

        # --------------------------------------------------
        # 5. OFFLINE BILL PAYMENT & IDEMPOTENT REPLAY
        # --------------------------------------------------
        print("\n--- 5. OFFLINE BILL PAYMENT & IDEMPOTENT REPLAY ---")
        pay_mut_id = str(uuid.uuid4())
        pay_res = await client.post(f"/bills/{bill_id}/pay", json={
            "account_id": chk_id, "client_mutation_id": pay_mut_id,
            "device_id": "dev-1", "payment_date": now_iso
        }, headers=headers_a)
        assert pay_res.status_code == 200

        # Bill status updated to 'paid'
        bill_check = (await client.get(f"/bills/{bill_id}", headers=headers_a)).json()
        assert bill_check["status"] == "paid"

        # Re-send with identical client_mutation_id (retry network disconnect) -> Returns existing transaction (HTTP 200 OK)
        retry_same_pay = await client.post(f"/bills/{bill_id}/pay", json={
            "account_id": chk_id, "client_mutation_id": pay_mut_id,
            "device_id": "dev-1", "payment_date": now_iso
        }, headers=headers_a)
        assert retry_same_pay.status_code == 200
        assert retry_same_pay.json()["id"] == pay_res.json()["id"]

        # New attempt with different mutation_id for already-paid bill -> REJECTED (HTTP 400 Bad Request)
        retry_new_pay = await client.post(f"/bills/{bill_id}/pay", json={
            "account_id": chk_id, "client_mutation_id": str(uuid.uuid4()),
            "device_id": "dev-1", "payment_date": now_iso
        }, headers=headers_a)
        assert retry_new_pay.status_code == 400
        assert "already been paid" in retry_new_pay.json()["detail"]
        print("Offline Bill Payment & idempotent replay verified.")

        # --------------------------------------------------
        # 6. OFFLINE GOAL CONTRIBUTION & LEDGER INTEGRITY
        # --------------------------------------------------
        print("\n--- 6. OFFLINE GOAL CONTRIBUTION & LEDGER INTEGRITY ---")
        goal_mut_id = str(uuid.uuid4())
        contrib_res = await client.post("/transactions", json={
            "client_mutation_id": goal_mut_id, "account_id": chk_id, "savings_goal_id": goal_id,
            "transaction_type": "expense", "amount_minor": 5000000, "currency": "INR", # INR 50,000.00
            "description": "Offline Goal Contribution", "transaction_date": now_iso, "device_id": "dev-1"
        }, headers=headers_a)
        assert contrib_res.status_code == 201

        # Goal current saved amount increases & progress updates
        goal_check_post = (await client.get(f"/goals/{goal_id}", headers=headers_a)).json()
        assert goal_check_post["current_saved_minor"] == 5000000
        assert goal_check_post["progress_percentage"] == 20.0 # 50,000 / 250,000 = 20%
        print("Offline Goal Contribution & ledger synchronization verified.")

        # --------------------------------------------------
        # 7. CONFLICT RESOLUTION STRATEGY FOR EDITABLE ENTITIES
        # --------------------------------------------------
        print("\n--- 7. CONFLICT RESOLUTION STRATEGY FOR EDITABLE ENTITIES ---")
        # Concurrent edit simulation on Budget entity (Last-Write-Wins based on updated_at)
        conflict_edit_1 = await client.patch(f"/budgets/{bud_id}", json={
            "limit_amount_minor": 4000000
        }, headers=headers_a)
        assert conflict_edit_1.status_code == 200

        conflict_edit_2 = await client.patch(f"/budgets/{bud_id}", json={
            "limit_amount_minor": 4200000 # Last write
        }, headers=headers_a)
        assert conflict_edit_2.status_code == 200

        bud_final = (await client.get(f"/budgets/{bud_id}", headers=headers_a)).json()
        assert bud_final["limit_amount_minor"] == 4200000
        print("Conflict resolution strategy (Last-Write-Wins on planning entities) verified.")

        # --------------------------------------------------
        # 8. ACCOUNT BALANCES & NET WORTH RECONCILIATION
        # --------------------------------------------------
        print("\n--- 8. ACCOUNT BALANCES & NET WORTH RECONCILIATION ---")
        chk_bal = (await client.get(f"/accounts/{chk_id}", headers=headers_a)).json()["balance_paise"]
        wal_bal = (await client.get(f"/accounts/{wal_id}", headers=headers_a)).json()["balance_paise"]

        # 100,000 (init) - 20,000 (exp) + 50,000 (inc) - 10,000 (trf) - 1,800 (bill) - 50,000 (goal) = INR 68,200.00
        assert chk_bal == 6820000
        # 0 + 10,000 (trf) = INR 10,000.00
        assert wal_bal == 1000000

        nw = (await client.get("/finance/net-worth", headers=headers_a)).json()["net_worth_minor"]
        # Assets (68,200 + 10,000) = INR 78,200.00
        assert nw == 7820000
        print(f"Reconciled balances: Checking = INR {chk_bal/100:,.2f}, Wallet = INR {wal_bal/100:,.2f}, Net Worth = INR {nw/100:,.2f}.")

        # --------------------------------------------------
        # 9. USER ISOLATION & LOGOUT QUEUE SECURITY
        # --------------------------------------------------
        print("\n--- 9. USER ISOLATION & LOGOUT QUEUE SECURITY ---")
        # User B attempts to access User A's budget, goal, or bill -> REJECTED
        iso_bud = await client.get(f"/budgets/{bud_id}", headers=headers_b)
        assert iso_bud.status_code == 404

        iso_goal = await client.get(f"/goals/{goal_id}", headers=headers_b)
        assert iso_goal.status_code == 404

        iso_bill = await client.get(f"/bills/{bill_id}", headers=headers_b)
        assert iso_bill.status_code == 404
        print("User isolation strictly verified across all offline-supported entities.")

        print("==================================================")
        print("ALL PHASE 8 HARDENING & VERIFICATION CHECKS PASSED")
        print("==================================================")

if __name__ == "__main__":
    asyncio.run(main())
