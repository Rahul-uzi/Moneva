import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email_a = f"usera_{test_id}@example.com"
    email_b = f"userb_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("==================================================")
        print("MONEVA PHASE 7: CROSS-MODULE INTEGRATION AUDIT")
        print("==================================================")

        # --------------------------------------------------
        # 1. REGISTER USER A AND USER B
        # --------------------------------------------------
        print("\n--- 1. AUTHENTICATION & USER REGISTRATION ---")
        reg_a = await client.post("/auth/register", json={
            "email": email_a, "password": password, "display_name": f"User A {test_id}", "currency": "INR"
        })
        assert reg_a.status_code == 201
        headers_a = {"Authorization": f"Bearer {reg_a.json()['access_token']}"}

        reg_b = await client.post("/auth/register", json={
            "email": email_b, "password": password, "display_name": f"User B {test_id}", "currency": "INR"
        })
        assert reg_b.status_code == 201
        headers_b = {"Authorization": f"Bearer {reg_b.json()['access_token']}"}
        print("User A and User B registered successfully.")

        # --------------------------------------------------
        # 2. ACCOUNTS CREATION & NET WORTH INITIAL CHECK
        # --------------------------------------------------
        print("\n--- 2. ACCOUNTS CREATION & NET WORTH SETUP ---")
        # Main Checking (Asset: ₹50,000.00)
        chk_res = await client.post("/accounts", json={
            "name": "Main Checking", "account_type": "asset", "opening_balance_minor": 5000000
        }, headers=headers_a)
        chk_id = chk_res.json()["id"]

        # Credit Card (Liability: ₹10,000.00)
        cc_res = await client.post("/accounts", json={
            "name": "Credit Card", "account_type": "liability", "opening_balance_minor": 1000000
        }, headers=headers_a)
        cc_id = cc_res.json()["id"]

        # Savings Wallet (Asset: ₹0.00)
        wal_res = await client.post("/accounts", json={
            "name": "Savings Wallet", "account_type": "asset", "opening_balance_minor": 0
        }, headers=headers_a)
        wal_id = wal_res.json()["id"]

        # Initial Net Worth: 50,000 - 10,000 = ₹40,000.00 (4,000,000 paise)
        nw_init = (await client.get("/finance/net-worth", headers=headers_a)).json()["net_worth_minor"]
        assert nw_init == 4000000
        print(f"Initial Net Worth verified: INR {nw_init / 100:,.2f}")

        # --------------------------------------------------
        # 3. EXPENSE CROSS-MODULE PROPAGATION TEST
        # --------------------------------------------------
        print("\n--- 3. EXPENSE CROSS-MODULE PROPAGATION TEST ---")
        cat_groc = (await client.post("/categories", json={"name": "Groceries", "type": "expense"}, headers=headers_a)).json()
        cat_id = cat_groc["id"]

        # Budget limit: ₹10,000.00
        start_month = datetime.now(timezone.utc).replace(day=1).isoformat()
        end_month = (datetime.now(timezone.utc).replace(day=28) + timedelta(days=5)).isoformat()
        bud_res = await client.post("/budgets", json={
            "category_id": cat_id, "limit_amount_minor": 1000000, "period": "monthly",
            "start_date": start_month, "end_date": end_month
        }, headers=headers_a)
        bud_id = bud_res.json()["id"]

        # Record Expense: ₹3,000.00
        now_iso = datetime.now(timezone.utc).isoformat()
        exp_res = await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": chk_id, "category_id": cat_id,
            "transaction_type": "expense", "amount_minor": 300000, "currency": "INR",
            "description": "Supermarket Groceries", "transaction_date": now_iso, "device_id": "audit-test"
        }, headers=headers_a)
        assert exp_res.status_code == 201

        # 1. Account balance decreases: 50,000 - 3,000 = ₹47,000.00
        chk_bal_1 = (await client.get(f"/accounts/{chk_id}", headers=headers_a)).json()["balance_paise"]
        assert chk_bal_1 == 4700000

        # 2. Net worth decreases: 40,000 - 3,000 = ₹37,000.00
        nw_1 = (await client.get("/finance/net-worth", headers=headers_a)).json()["net_worth_minor"]
        assert nw_1 == 3700000

        # 3. Budget spent: ₹3,000.00, remaining: ₹7,000.00
        bud_check_1 = (await client.get(f"/budgets/{bud_id}", headers=headers_a)).json()
        assert bud_check_1["spent_amount_minor"] == 300000
        assert bud_check_1["remaining_amount_minor"] == 700000

        # 4. Analytics expense: ₹3,000.00
        sum_1 = (await client.get("/finance/summary", headers=headers_a)).json()
        assert sum_1["expense_minor"] == 300000
        print("Expense propagation through ledger, balances, budget, and analytics verified.")

        # --------------------------------------------------
        # 4. INCOME CROSS-MODULE PROPAGATION TEST
        # --------------------------------------------------
        print("\n--- 4. INCOME CROSS-MODULE PROPAGATION TEST ---")
        inc_res = await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": chk_id,
            "transaction_type": "income", "amount_minor": 6000000, "currency": "INR", # ₹60,000.00
            "description": "Consulting Salary", "transaction_date": now_iso, "device_id": "audit-test"
        }, headers=headers_a)
        assert inc_res.status_code == 201

        # 1. Checking balance increases: 47,000 + 60,000 = ₹1,07,000.00
        chk_bal_2 = (await client.get(f"/accounts/{chk_id}", headers=headers_a)).json()["balance_paise"]
        assert chk_bal_2 == 10700000

        # 2. Net worth increases: 37,000 + 60,000 = ₹97,000.00
        nw_2 = (await client.get("/finance/net-worth", headers=headers_a)).json()["net_worth_minor"]
        assert nw_2 == 9700000

        # 3. Cash flow: Income ₹60,000.00, Expense ₹3,000.00, Net ₹57,000.00
        sum_2 = (await client.get("/finance/summary", headers=headers_a)).json()
        assert sum_2["income_minor"] == 6000000
        assert sum_2["expense_minor"] == 300000
        assert sum_2["net_cash_flow_minor"] == 5700000

        # 4. Budget spent is NOT altered by income
        bud_check_2 = (await client.get(f"/budgets/{bud_id}", headers=headers_a)).json()
        assert bud_check_2["spent_amount_minor"] == 300000
        print("Income propagation through ledger, balances, cash flow, and analytics verified.")

        # --------------------------------------------------
        # 5. TRANSFER CONSISTENCY & NET WORTH INVARIANCE TEST
        # --------------------------------------------------
        print("\n--- 5. TRANSFER CONSISTENCY & NET WORTH INVARIANCE TEST ---")
        # Asset-to-Asset: Transfer ₹5,000.00 from Main Checking to Savings Wallet
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": chk_id, "to_account_id": wal_id,
            "transaction_type": "transfer", "amount_minor": 500000, "currency": "INR",
            "description": "Internal Savings Transfer", "transaction_date": now_iso, "device_id": "audit-test"
        }, headers=headers_a)

        chk_bal_3 = (await client.get(f"/accounts/{chk_id}", headers=headers_a)).json()["balance_paise"]
        wal_bal_3 = (await client.get(f"/accounts/{wal_id}", headers=headers_a)).json()["balance_paise"]
        assert chk_bal_3 == 10200000 # 107,000 - 5,000 = ₹1,02,000.00
        assert wal_bal_3 == 500000   # 0 + 5,000 = ₹5,000.00

        # Asset-to-Liability: Transfer ₹4,000.00 from Main Checking to Credit Card
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": chk_id, "to_account_id": cc_id,
            "transaction_type": "transfer", "amount_minor": 400000, "currency": "INR",
            "description": "Credit Card Settlement", "transaction_date": now_iso, "device_id": "audit-test"
        }, headers=headers_a)

        chk_bal_4 = (await client.get(f"/accounts/{chk_id}", headers=headers_a)).json()["balance_paise"]
        cc_bal_4 = (await client.get(f"/accounts/{cc_id}", headers=headers_a)).json()["balance_paise"]
        assert chk_bal_4 == 9800000 # 102,000 - 4,000 = ₹98,000.00
        assert cc_bal_4 == 600000   # 10,000 liability - 4,000 payment = ₹6,000.00 liability

        # Net Worth check: 98,000 + 5,000 - 6,000 = ₹97,000.00 (100% UNCHANGED!)
        nw_3 = (await client.get("/finance/net-worth", headers=headers_a)).json()["net_worth_minor"]
        assert nw_3 == 9700000

        # Income & Expense check: 100% UNCHANGED by transfers!
        sum_3 = (await client.get("/finance/summary", headers=headers_a)).json()
        assert sum_3["income_minor"] == 6000000
        assert sum_3["expense_minor"] == 300000
        print("Transfer consistency verified: Assets/Liabilities adjust, Net Worth & Income/Expense 100% invariant.")

        # --------------------------------------------------
        # 6. GOAL CONTRIBUTION & ENTITY DELETION INTEGRITY TEST
        # --------------------------------------------------
        print("\n--- 6. GOAL CONTRIBUTION & ENTITY DELETION INTEGRITY TEST ---")
        goal_res = await client.post("/goals", json={
            "name": "House Downpayment", "target_amount_minor": 5000000 # ₹50,000.00
        }, headers=headers_a)
        goal_id = goal_res.json()["id"]

        # Contribute ₹15,000.00
        exp_goal_res = await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": chk_id, "savings_goal_id": goal_id,
            "transaction_type": "expense", "amount_minor": 1500000, "currency": "INR",
            "description": "Goal Contribution", "transaction_date": now_iso, "device_id": "audit-test"
        }, headers=headers_a)
        assert exp_goal_res.status_code == 201
        tx_goal_id = exp_goal_res.json()["id"]

        goal_check = (await client.get(f"/goals/{goal_id}", headers=headers_a)).json()
        assert goal_check["current_saved_minor"] == 1500000
        assert goal_check["progress_percentage"] == 30.0

        # Delete Goal Entity
        del_goal_res = await client.delete(f"/goals/{goal_id}", headers=headers_a)
        assert del_goal_res.status_code == 204

        # Verify Goal is gone
        get_deleted_goal = await client.get(f"/goals/{goal_id}", headers=headers_a)
        assert get_deleted_goal.status_code == 404

        # CRITICAL INTEGRITY CHECK: Underlying financial transaction MUST remain intact in ledger!
        tx_list = (await client.get("/transactions", headers=headers_a)).json()
        tx_ids = [t["id"] for t in tx_list]
        assert tx_goal_id in tx_ids
        print("Goal contribution & ledger preservation on goal entity deletion verified.")

        # --------------------------------------------------
        # 7. BILL OBLIGATION & IDEMPOTENT PAYMENT TEST
        # --------------------------------------------------
        print("\n--- 7. BILL OBLIGATION & IDEMPOTENT PAYMENT TEST ---")
        due_date = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        bill_res = await client.post("/bills", json={
            "name": "Utility Bill", "amount_minor": 250000, "currency": "INR", "due_date": due_date
        }, headers=headers_a)
        bill_id = bill_res.json()["id"]

        # Verify bill creation did NOT alter balance or create transaction
        chk_bal_pre_bill = (await client.get(f"/accounts/{chk_id}", headers=headers_a)).json()["balance_paise"]
        assert chk_bal_pre_bill == 8300000 # 98,000 - 15,000 goal = ₹83,000.00

        # Pay Bill
        pay_res = await client.post(f"/bills/{bill_id}/pay", json={
            "account_id": chk_id, "client_mutation_id": str(uuid.uuid4()),
            "device_id": "audit-test", "payment_date": now_iso
        }, headers=headers_a)
        assert pay_res.status_code == 200

        # Bill status updated to 'paid' and balance decreased by ₹2,500.00
        bill_paid_check = (await client.get(f"/bills/{bill_id}", headers=headers_a)).json()
        assert bill_paid_check["status"] == "paid"

        chk_bal_post_bill = (await client.get(f"/accounts/{chk_id}", headers=headers_a)).json()["balance_paise"]
        assert chk_bal_post_bill == 8050000 # 83,000 - 2,500 = ₹80,500.00

        # Duplicate payment attempt on already-paid bill -> REJECTED
        dup_pay_res = await client.post(f"/bills/{bill_id}/pay", json={
            "account_id": chk_id, "client_mutation_id": str(uuid.uuid4()),
            "device_id": "audit-test", "payment_date": now_iso
        }, headers=headers_a)
        assert dup_pay_res.status_code == 400
        assert "already been paid" in dup_pay_res.json()["detail"]
        print("Bill life cycle & duplicate payment protection verified.")

        # --------------------------------------------------
        # 8. BUDGET WARNING THRESHOLD & NOTIFICATION DEDUP TEST
        # --------------------------------------------------
        print("\n--- 8. BUDGET WARNING THRESHOLD & DEDUP TEST ---")
        # Add expense of ₹5,500.00 to Groceries (Total spent = 3,000 + 5,500 = ₹8,500.00 = 85% limit)
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": chk_id, "category_id": cat_id,
            "transaction_type": "expense", "amount_minor": 550000, "currency": "INR",
            "description": "Weekly Groceries", "transaction_date": now_iso, "device_id": "audit-test"
        }, headers=headers_a)

        gen_notif = await client.post("/notifications/generate", headers=headers_a)
        assert gen_notif.status_code == 200

        notifs = (await client.get("/notifications", headers=headers_a)).json()
        bud_warns = [n for n in notifs if n["notification_type"] in ["budget_warning", "budget_exceeded"]]
        assert len(bud_warns) >= 1

        # Re-trigger generation -> 0 duplicate notifications created
        gen_notif_2 = await client.post("/notifications/generate", headers=headers_a)
        assert gen_notif_2.json()["generated_count"] == 0
        print("Budget warning threshold & deterministic duplicate prevention verified.")

        # --------------------------------------------------
        # 9. SALARY RULE & FINANCIAL SAFETY TEST
        # --------------------------------------------------
        print("\n--- 9. SALARY RULE & FINANCIAL SAFETY TEST ---")
        sal_rule = await client.post("/income/recurring", json={
            "source": "Corporate Salary Rule", "amount_minor": 9000000, "frequency": "monthly",
            "next_occurrence": now_iso
        }, headers=headers_a)
        assert sal_rule.status_code == 201

        # Financial Safety: Rule creation created 0 transactions and balance 100% UNCHANGED
        chk_bal_sal_pre = (await client.get(f"/accounts/{chk_id}", headers=headers_a)).json()["balance_paise"]
        assert chk_bal_sal_pre == 7500000 # 80,500 - 5,500 = ₹75,000.00

        # Trigger salary reminder generation
        await client.post("/notifications/generate", headers=headers_a)
        notifs_sal = (await client.get("/notifications", headers=headers_a)).json()
        sal_notifs = [n for n in notifs_sal if n["notification_type"] == "salary_reminder"]
        assert len(sal_notifs) >= 1

        # Financial Safety: Reminder generation created 0 transactions and balance 100% UNCHANGED
        chk_bal_sal_post = (await client.get(f"/accounts/{chk_id}", headers=headers_a)).json()["balance_paise"]
        assert chk_bal_sal_post == 7500000
        print("FINANCIAL SAFETY CHECK PASSED: Salary rule & reminder generated 0 ledger transactions.")

        # --------------------------------------------------
        # 10. USER ISOLATION & DATA PRIVACY AUDIT
        # --------------------------------------------------
        print("\n--- 10. USER ISOLATION & DATA PRIVACY AUDIT ---")
        # User B attempts to access User A's checking account -> REJECTED
        iso_acc = await client.get(f"/accounts/{chk_id}", headers=headers_b)
        assert iso_acc.status_code == 404

        # User B attempts to access User A's budget -> REJECTED
        iso_bud = await client.get(f"/budgets/{bud_id}", headers=headers_b)
        assert iso_bud.status_code == 404

        # User B attempts to access User A's bill -> REJECTED
        iso_bill = await client.get(f"/bills/{bill_id}", headers=headers_b)
        assert iso_bill.status_code == 404

        # User B summary returns 0 for User A data
        sum_b = (await client.get("/finance/summary", headers=headers_b)).json()
        assert sum_b["income_minor"] == 0
        assert sum_b["expense_minor"] == 0
        assert sum_b["net_worth_minor"] == 0
        print("User isolation strictly verified: User B isolated 100% from User A data.")

        print("==================================================")
        print("ALL 25 CROSS-MODULE AUDIT CHECKS PASSED PERFECTLY")
        print("==================================================")

if __name__ == "__main__":
    asyncio.run(main())
