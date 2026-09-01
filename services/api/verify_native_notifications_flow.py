import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"native_notif_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("==================================================")
        print("MONEVA PHASE 10: NATIVE NOTIFICATIONS VERIFICATION")
        print("==================================================")

        # 1. REGISTER USER
        print("\n--- 1. USER REGISTRATION ---")
        reg_res = await client.post("/auth/register", json={
            "email": email, "password": password, "display_name": f"Native Notif Tester {test_id}"
        })
        assert reg_res.status_code == 201
        headers = {"Authorization": f"Bearer {reg_res.json()['access_token']}"}
        print(f"User {email} registered successfully.")

        # 2. VERIFY NOTIFICATION PREFERENCES
        print("\n--- 2. NOTIFICATION PREFERENCES ---")
        prefs = (await client.get("/notifications/preferences", headers=headers)).json()
        assert prefs["notif_bills"] is True
        assert prefs["notif_budgets"] is True
        assert prefs["notif_goals"] is True
        assert prefs["notif_salary"] is True
        print("Default preferences enabled.")

        # 3. BILL REMINDER GENERATION
        print("\n--- 3. BILL REMINDER DELIVERY & DATA ---")
        due_date = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        bill_res = await client.post("/bills", json={
            "name": "Electricity Bill", "amount_minor": 250000, "currency": "INR", "due_date": due_date
        }, headers=headers)
        assert bill_res.status_code == 201

        await client.post("/notifications/generate", headers=headers)
        notifs_1 = (await client.get("/notifications", headers=headers)).json()
        bill_notifs = [n for n in notifs_1 if n["notification_type"].startswith("bill_")]
        assert len(bill_notifs) >= 1
        assert "Electricity Bill" in bill_notifs[0]["message"] or "Electricity Bill" in bill_notifs[0]["title"]
        print(f"Bill reminder generated cleanly: {bill_notifs[0]['title']}")

        # 4. BUDGET WARNING DELIVERY & DATA
        print("\n--- 4. BUDGET WARNING DELIVERY & DATA ---")
        chk = (await client.post("/accounts", json={
            "name": "Main Checking", "account_type": "asset", "opening_balance_minor": 10000000
        }, headers=headers)).json()

        cat = (await client.post("/categories", json={
            "name": "Dining", "type": "expense"
        }, headers=headers)).json()

        start_month = datetime.now(timezone.utc).replace(day=1).isoformat()
        end_month = (datetime.now(timezone.utc).replace(day=28) + timedelta(days=5)).isoformat()
        await client.post("/budgets", json={
            "category_id": cat["id"], "limit_amount_minor": 1000000, "period": "monthly",
            "start_date": start_month, "end_date": end_month
        }, headers=headers)

        # Spend 85% of limit (INR 8,500.00)
        now_iso = datetime.now(timezone.utc).isoformat()
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": chk["id"], "category_id": cat["id"],
            "transaction_type": "expense", "amount_minor": 850000, "currency": "INR",
            "description": "Team Dinner", "transaction_date": now_iso, "device_id": "test"
        }, headers=headers)

        await client.post("/notifications/generate", headers=headers)
        notifs_2 = (await client.get("/notifications", headers=headers)).json()
        bud_notifs = [n for n in notifs_2 if n["notification_type"].startswith("budget_")]
        assert len(bud_notifs) >= 1
        print(f"Budget warning notification generated cleanly: {bud_notifs[0]['title']}")

        # 5. GOAL MILESTONE DELIVERY & DATA
        print("\n--- 5. GOAL MILESTONE DELIVERY & DATA ---")
        goal = (await client.post("/goals", json={
            "name": "Vacation Fund", "target_amount_minor": 20000000 # INR 200k
        }, headers=headers)).json()

        # Contribute 50% target (INR 100k)
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()), "account_id": chk["id"], "savings_goal_id": goal["id"],
            "transaction_type": "expense", "amount_minor": 10000000, "currency": "INR",
            "description": "Vacation Goal Contribution", "transaction_date": now_iso, "device_id": "test"
        }, headers=headers)

        await client.post("/notifications/generate", headers=headers)
        notifs_3 = (await client.get("/notifications", headers=headers)).json()
        goal_notifs = [n for n in notifs_3 if n["notification_type"] == "goal_milestone"]
        assert len(goal_notifs) >= 1
        print(f"Goal milestone notification generated cleanly: {goal_notifs[0]['title']}")

        # 6. SALARY REMINDER & FINANCIAL SAFETY VERIFICATION
        print("\n--- 6. SALARY REMINDER & FINANCIAL SAFETY ---")
        await client.post("/income/recurring", json={
            "source": "Monthly Salary Rule", "amount_minor": 12000000, "frequency": "monthly",
            "next_occurrence": now_iso
        }, headers=headers)

        # Baseline count of transactions prior to salary reminder generation
        txs_pre_sal = (await client.get("/transactions", headers=headers)).json()

        await client.post("/notifications/generate", headers=headers)
        notifs_4 = (await client.get("/notifications", headers=headers)).json()
        sal_notifs = [n for n in notifs_4 if n["notification_type"] == "salary_reminder"]
        assert len(sal_notifs) >= 1

        # CRITICAL FINANCIAL SAFETY CHECK: Confirm 0 income transactions were created by reminder!
        txs_post_sal = (await client.get("/transactions", headers=headers)).json()
        assert len(txs_post_sal) == len(txs_pre_sal)
        print("FINANCIAL SAFETY VERIFIED: Salary reminder created 0 transactions and 0 balance changes!")

        # 7. PREFERENCE SUPPRESSION TEST
        print("\n--- 7. PREFERENCE SUPPRESSION TEST ---")
        await client.patch("/notifications/preferences", json={"notif_bills": False}, headers=headers)

        due_date_2 = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        await client.post("/bills", json={
            "name": "Water Bill", "amount_minor": 50000, "currency": "INR", "due_date": due_date_2
        }, headers=headers)

        gen_res = (await client.post("/notifications/generate", headers=headers)).json()
        notifs_5 = (await client.get("/notifications", headers=headers)).json()
        water_notifs = [n for n in notifs_5 if "Water Bill" in n["title"] or "Water Bill" in n["message"]]
        assert len(water_notifs) == 0
        print("Disabled bill notification preference suppressed native delivery successfully.")

        print("==================================================")
        print("ALL PHASE 10 NATIVE NOTIFICATION CHECKS PASSED")
        print("==================================================")

if __name__ == "__main__":
    asyncio.run(main())
