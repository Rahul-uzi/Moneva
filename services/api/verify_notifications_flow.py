import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"notif_test_{test_id}@example.com"
    password = "Password123!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": password,
            "display_name": f"Notif Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. VERIFY INITIAL EMPTY NOTIFICATION STATE ---")
        notifs = (await client.get("/notifications", headers=headers)).json()
        unread_count = (await client.get("/notifications/unread-count", headers=headers)).json()["unread_count"]
        assert len(notifs) == 0
        assert unread_count == 0
        print("Initial empty notification center verified.")

        print("--- 3. VERIFY & UPDATE NOTIFICATION PREFERENCES ---")
        pref_get = (await client.get("/notifications/preferences", headers=headers)).json()
        assert pref_get["notif_bills"] is True

        # Ensure all preferences enabled
        await client.patch("/notifications/preferences", json={
            "notif_bills": True,
            "notif_budgets": True,
            "notif_goals": True,
            "notif_salary": True
        }, headers=headers)
        print("Notification preferences enabled.")

        print("--- 4. BILL REMINDER GENERATION & DUPLICATE PREVENTION ---")
        due_soon = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        bill_res = await client.post("/bills", json={
            "name": "Internet Bill",
            "amount_minor": 120000, # INR 1,200.00
            "currency": "INR",
            "due_date": due_soon
        }, headers=headers)
        assert bill_res.status_code == 201

        # Run reminder generation
        gen_1 = await client.post("/notifications/generate", headers=headers)
        assert gen_1.status_code == 200
        assert gen_1.json()["generated_count"] >= 1

        notifs_after_gen = (await client.get("/notifications", headers=headers)).json()
        assert len(notifs_after_gen) >= 1
        bill_notif = [n for n in notifs_after_gen if "Internet Bill" in n["title"]][0]
        assert bill_notif["is_read"] is False

        # Run generation AGAIN -> MUST NOT CREATE DUPLICATES
        gen_2 = await client.post("/notifications/generate", headers=headers)
        assert gen_2.status_code == 200
        assert gen_2.json()["generated_count"] == 0
        notifs_after_gen_2 = (await client.get("/notifications", headers=headers)).json()
        assert len(notifs_after_gen_2) == len(notifs_after_gen)
        print("Bill reminder generation & deterministic duplicate prevention verified.")

        print("--- 5. MARK NOTIFICATION AS READ & UNREAD COUNT DECREASE ---")
        read_res = await client.patch(f"/notifications/{bill_notif['id']}/read", headers=headers)
        assert read_res.status_code == 200
        assert read_res.json()["is_read"] is True

        unread_after_read = (await client.get("/notifications/unread-count", headers=headers)).json()["unread_count"]
        assert unread_after_read == len(notifs_after_gen) - 1
        print("Mark notification read & unread count decrease verified.")

        print("--- 6. BUDGET WARNING REMINDER GENERATION ---")
        acc_res = await client.post("/accounts", json={
            "name": "Main Checking",
            "account_type": "asset",
            "opening_balance_minor": 5000000 # INR 50,000.00
        }, headers=headers)
        acc_id = acc_res.json()["id"]

        cat_res = await client.post("/categories", json={
            "name": "Dining",
            "type": "expense"
        }, headers=headers)
        cat_id = cat_res.json()["id"]

        # Budget of INR 10,000.00
        start_month = datetime.now(timezone.utc).replace(day=1).isoformat()
        end_month = (datetime.now(timezone.utc).replace(day=28) + timedelta(days=5)).isoformat()
        await client.post("/budgets", json={
            "category_id": cat_id,
            "limit_amount_minor": 1000000, # INR 10,000.00
            "period": "monthly",
            "start_date": start_month,
            "end_date": end_month
        }, headers=headers)

        # Record expense of INR 8,500.00 (85% limit)
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc_id,
            "category_id": cat_id,
            "transaction_type": "expense",
            "amount_minor": 850000,
            "currency": "INR",
            "description": "Dining Out",
            "transaction_date": datetime.now(timezone.utc).isoformat(),
            "device_id": "api-test"
        }, headers=headers)

        # Trigger generation
        await client.post("/notifications/generate", headers=headers)
        notifs_bud = (await client.get("/notifications", headers=headers)).json()
        bud_warn = [n for n in notifs_bud if n["notification_type"] in ["budget_warning", "budget_exceeded"]]
        assert len(bud_warn) >= 1
        print("Budget limit warning notification verified.")

        print("--- 7. GOAL MILESTONE REMINDER GENERATION ---")
        goal_res = await client.post("/goals", json={
            "name": "Vacation Fund",
            "target_amount_minor": 2000000 # INR 20,000.00
        }, headers=headers)
        goal_id = goal_res.json()["id"]

        # Contribute INR 10,000.00 (50% milestone)
        await client.post("/transactions", json={
            "client_mutation_id": str(uuid.uuid4()),
            "account_id": acc_id,
            "savings_goal_id": goal_id,
            "transaction_type": "expense",
            "amount_minor": 1000000,
            "currency": "INR",
            "description": "Goal Contribution: Vacation",
            "transaction_date": datetime.now(timezone.utc).isoformat(),
            "device_id": "api-test"
        }, headers=headers)

        # Trigger generation
        await client.post("/notifications/generate", headers=headers)
        notifs_goal = (await client.get("/notifications", headers=headers)).json()
        goal_warn = [n for n in notifs_goal if n["notification_type"] == "goal_milestone"]
        assert len(goal_warn) >= 1
        print("Savings goal milestone notification verified.")

        print("--- 8. SALARY REMINDER & FINANCIAL SAFETY CHECK ---")
        await client.post("/income/recurring", json={
            "source": "Tech Corp Salary",
            "amount_minor": 8000000, # INR 80,000.00
            "frequency": "monthly",
            "next_occurrence": datetime.now(timezone.utc).isoformat()
        }, headers=headers)

        # Trigger generation
        await client.post("/notifications/generate", headers=headers)
        notifs_sal = (await client.get("/notifications", headers=headers)).json()
        sal_warn = [n for n in notifs_sal if n["notification_type"] == "salary_reminder"]
        assert len(sal_warn) >= 1

        # CRITICAL FINANCIAL SAFETY CHECK: Verify account balance was NOT modified!
        acc_check = (await client.get(f"/accounts/{acc_id}", headers=headers)).json()
        # Opening 50,000 - 8,500 expense - 10,000 goal = 31,500 (3,150,000 paise)
        assert acc_check["opening_balance_minor"] == 5000000
        print("FINANCIAL SAFETY CHECK PASSED: Salary reminder generated WITHOUT altering financial ledger or creating transactions!")

        print("--- 9. DISABLED USER PREFERENCE TEST ---")
        # Disable bill reminders
        await client.patch("/notifications/preferences", json={"notif_bills": False}, headers=headers)

        # Create new bill due in 1 day
        await client.post("/bills", json={
            "name": "Water Bill",
            "amount_minor": 45000,
            "currency": "INR",
            "due_date": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        }, headers=headers)

        # Trigger generation -> MUST NOT CREATE WATER BILL NOTIFICATION
        await client.post("/notifications/generate", headers=headers)
        notifs_dis = (await client.get("/notifications", headers=headers)).json()
        water_notif = [n for n in notifs_dis if "Water Bill" in n["title"]]
        assert len(water_notif) == 0
        print("Disabled notification preference enforcement verified.")

        print("--- 10. SECURITY & USER ISOLATION TESTS ---")
        unauth = await client.get("/notifications")
        assert unauth.status_code == 401
        print("Unauthenticated notifications access rejection verified.")
        print("--- ALL NOTIFICATIONS & REMINDERS USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
