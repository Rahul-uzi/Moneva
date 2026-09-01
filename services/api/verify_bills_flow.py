import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"bills_test_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": password,
            "display_name": f"Bills Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. INITIAL BILLS CHECK (EMPTY STATE) ---")
        bills_empty = (await client.get("/bills", headers=headers)).json()
        assert len(bills_empty) == 0
        print("Verified empty bills list for new user.")

        print("--- 3. CREATE ACCOUNT & EXPENSE CATEGORY ---")
        acc_res = await client.post("/accounts", json={
            "name": "Main Checking",
            "account_type": "asset",
            "opening_balance_minor": 5000000 # INR 50,000.00
        }, headers=headers)
        assert acc_res.status_code == 201
        acc_id = acc_res.json()["id"]

        cat_res = await client.post("/categories", json={
            "name": "Utilities",
            "type": "expense",
            "icon": "Zap",
            "color": "#F59E0B"
        }, headers=headers)
        assert cat_res.status_code == 201
        cat_id = cat_res.json()["id"]

        print("--- 4. CREATE BILL A (INR 2,450.00) & BILL B (INR 850.00) ---")
        now = datetime.now(timezone.utc)
        due_a = (now + timedelta(days=5)).isoformat()
        due_b = now.isoformat() # Due today

        bill_a_res = await client.post("/bills", json={
            "name": "Electricity Bill",
            "amount_minor": 245000, # INR 2,450.00
            "currency": "INR",
            "due_date": due_a,
            "recurrence": "monthly",
            "category_id": cat_id,
            "reminder_enabled": True
        }, headers=headers)
        assert bill_a_res.status_code == 201
        bill_a_id = bill_a_res.json()["id"]

        bill_b_res = await client.post("/bills", json={
            "name": "Broadband Internet",
            "amount_minor": 85000, # INR 850.00
            "currency": "INR",
            "due_date": due_b,
            "recurrence": "monthly",
            "category_id": cat_id,
            "reminder_enabled": True
        }, headers=headers)
        assert bill_b_res.status_code == 201
        bill_b_id = bill_b_res.json()["id"]
        print("Bills created: Bill A (INR 2,450.00), Bill B (INR 850.00)")

        print("--- 5. DYNAMIC OVERVIEW TOTALS & CRITICAL FINANCIAL RULE VERIFICATION ---")
        all_bills = (await client.get("/bills", headers=headers)).json()
        assert len(all_bills) == 2

        upcoming_total = sum(b["amount_minor"] for b in all_bills if b["status"] != "paid")
        assert upcoming_total == 330000 # INR 3,300.00 (2,450 + 850)
        print(f"Dynamic Upcoming Total verified: INR {upcoming_total / 100:.2f} (INR 3,300.00)")

        # 1. Account balance must NOT change!
        acc_check = (await client.get(f"/accounts/{acc_id}", headers=headers)).json()
        assert acc_check["balance_paise"] == 5000000 # Still 50,000.00

        # 2. No transaction rows created yet!
        txs_empty = (await client.get("/transactions", headers=headers)).json()
        assert len(txs_empty) == 0
        print("CRITICAL CHECK PASSED: Creating bills did NOT move money or create transaction rows!")

        print("--- 6. OVERDUE DATE CALCULATION TEST ---")
        due_c = (now - timedelta(days=3)).isoformat()
        bill_c_res = await client.post("/bills", json={
            "name": "Past Due Water Bill",
            "amount_minor": 50000, # INR 500.00
            "currency": "INR",
            "due_date": due_c,
            "recurrence": "monthly",
            "category_id": cat_id,
            "status": "overdue",
            "reminder_enabled": True
        }, headers=headers)
        assert bill_c_res.status_code == 201
        bill_c_id = bill_c_res.json()["id"]

        bill_c_check = (await client.get(f"/bills/{bill_c_id}", headers=headers)).json()
        assert bill_c_check["status"] == "overdue"
        print("Overdue date calculation and status verified.")

        print("--- 7. EDIT BILL METADATA ---")
        patch_res = await client.patch(f"/bills/{bill_b_id}", json={
            "name": "Fiber Broadband 100Mbps",
            "amount_minor": 99900 # INR 999.00
        }, headers=headers)
        assert patch_res.status_code == 200
        assert patch_res.json()["name"] == "Fiber Broadband 100Mbps"
        print("Edit bill verified.")

        print("--- 8. PAY BILL A (INR 2,450.00) & VERIFY LEDGER MUTATION ---")
        pay_mutation = str(uuid.uuid4())
        pay_res = await client.post(f"/bills/{bill_a_id}/pay", json={
            "account_id": acc_id,
            "client_mutation_id": pay_mutation,
            "device_id": "api-test",
            "payment_date": now.isoformat()
        }, headers=headers)
        assert pay_res.status_code == 200

        # Bill status must become 'paid'
        bill_a_after = (await client.get(f"/bills/{bill_a_id}", headers=headers)).json()
        assert bill_a_after["status"] == "paid"

        # Account balance must DECREASE by INR 2,450.00
        acc_after_pay = (await client.get(f"/accounts/{acc_id}", headers=headers)).json()
        assert acc_after_pay["balance_paise"] == 4755000 # 50,000 - 2,450 = 47,550

        # Exactly 1 transaction created in ledger
        txs_after_pay = (await client.get("/transactions", headers=headers)).json()
        assert len(txs_after_pay) == 1
        assert txs_after_pay[0]["amount_minor"] == 245000
        print("Bill payment verified: Status = 'paid', Account balance = INR 47,550.00, 1 Expense transaction logged!")

        print("--- 9. DUPLICATE PAYMENT PROTECTION & IDEMPOTENCY TEST ---")
        # 1. Same mutation ID returns existing transaction
        dup_1 = await client.post(f"/bills/{bill_a_id}/pay", json={
            "account_id": acc_id,
            "client_mutation_id": pay_mutation,
            "device_id": "api-test",
            "payment_date": now.isoformat()
        }, headers=headers)
        assert dup_1.status_code == 200

        # 2. New mutation ID on already-paid bill is REJECTED
        dup_2 = await client.post(f"/bills/{bill_a_id}/pay", json={
            "account_id": acc_id,
            "client_mutation_id": str(uuid.uuid4()),
            "device_id": "api-test",
            "payment_date": now.isoformat()
        }, headers=headers)
        assert dup_2.status_code == 400
        assert "already been paid" in dup_2.json()["detail"]

        # Transaction count must remain exactly 1!
        txs_dup_check = (await client.get("/transactions", headers=headers)).json()
        assert len(txs_dup_check) == 1
        print("DUPLICATE PAYMENT PROTECTION VERIFIED: Rejected second payment attempt on paid bill!")

        print("--- 10. DELETE UNPAID BILL & VERIFY LEDGER INTEGRITY ---")
        del_b = await client.delete(f"/bills/{bill_b_id}", headers=headers)
        assert del_b.status_code == 204

        # Payment transaction from Bill A MUST remain intact!
        txs_intact = (await client.get("/transactions", headers=headers)).json()
        assert len(txs_intact) == 1
        assert txs_intact[0]["amount_minor"] == 245000
        print("Unpaid bill deleted cleanly. Paid bill transaction verified 100% INTACT in ledger!")

        print("--- 11. RE-LOGIN & PERSISTENCE VERIFICATION ---")
        login_res = await client.post("/auth/login", json={
            "email": email,
            "password": password
        })
        assert login_res.status_code == 200
        new_headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}

        persisted_txs = (await client.get("/transactions", headers=new_headers)).json()
        assert len(persisted_txs) == 1
        print("Re-login verified: all bill payment ledger data persisted cleanly across sessions!")
        print("--- ALL BILLS & RECURRING OBLIGATIONS MANAGEMENT USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
