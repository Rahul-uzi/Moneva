import asyncio
import uuid
from httpx import AsyncClient

BASE_URL = "http://127.0.0.1:8000/api"

async def main():
    test_id = str(uuid.uuid4())[:8]
    email = f"profile_test_{test_id}@example.com"
    original_password = "OriginalPassword123!"
    new_password = "UpdatedPassword456!"

    async with AsyncClient(base_url=BASE_URL) as client:
        print("--- 1. REGISTER NEW USER ---")
        reg_res = await client.post("/auth/register", json={
            "email": email,
            "password": original_password,
            "display_name": f"Profile Tester {test_id}",
            "currency": "INR",
            "timezone": "Asia/Kolkata"
        })
        assert reg_res.status_code == 201, f"Registration failed: {reg_res.text}"
        tokens = reg_res.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        print(f"User {email} registered successfully.")

        print("--- 2. VERIFY REAL PROFILE DATA (NO FAKE / SAMPLE DATA) ---")
        prof_res = await client.get("/profile", headers=headers)
        assert prof_res.status_code == 200
        prof = prof_res.json()
        assert prof["email"] == email
        assert prof["display_name"] == f"Profile Tester {test_id}"
        assert prof["currency"] == "INR"
        assert prof["timezone"] == "Asia/Kolkata"
        print("Real profile data verified successfully.")

        print("--- 3. EDIT PROFILE METADATA & PERSISTENCE CHECK ---")
        patch_res = await client.patch("/profile", json={
            "display_name": "Alex Updated",
            "currency": "USD",
            "timezone": "America/New_York"
        }, headers=headers)
        assert patch_res.status_code == 200
        patched_prof = patch_res.json()
        assert patched_prof["display_name"] == "Alex Updated"
        assert patched_prof["currency"] == "USD"
        assert patched_prof["timezone"] == "America/New_York"

        # Re-fetch profile to confirm backend database persistence
        prof_reload = (await client.get("/profile", headers=headers)).json()
        assert prof_reload["display_name"] == "Alex Updated"
        assert prof_reload["currency"] == "USD"
        assert prof_reload["timezone"] == "America/New_York"
        print("Profile update & database persistence verified.")

        print("--- 4. CHANGE PASSWORD SECURITY FLOW ---")
        # 1. Wrong current password attempt -> REJECTED
        bad_pwd = await client.post("/profile/change-password", json={
            "current_password": "WrongPassword999!",
            "new_password": new_password
        }, headers=headers)
        assert bad_pwd.status_code == 400
        assert "incorrect" in bad_pwd.json()["detail"].lower()

        # 2. Short new password attempt -> REJECTED
        short_pwd = await client.post("/profile/change-password", json={
            "current_password": original_password,
            "new_password": "short"
        }, headers=headers)
        assert short_pwd.status_code == 400
        assert "at least 8 characters" in short_pwd.json()["detail"].lower()

        # 3. Valid password change -> SUCCESS
        good_pwd = await client.post("/profile/change-password", json={
            "current_password": original_password,
            "new_password": new_password
        }, headers=headers)
        assert good_pwd.status_code == 200
        print("Password change flow verified.")

        print("--- 5. AUTHENTICATION & CREDENTIAL UPDATED CHECK ---")
        # 1. Login with old password -> REJECTED
        old_login = await client.post("/auth/login", json={
            "email": email,
            "password": original_password
        })
        assert old_login.status_code == 401

        # 2. Login with updated password -> SUCCESS
        new_login = await client.post("/auth/login", json={
            "email": email,
            "password": new_password
        })
        assert new_login.status_code == 200
        new_tokens = new_login.json()
        new_headers = {"Authorization": f"Bearer {new_tokens['access_token']}"}
        print("Re-login with updated password verified.")

        print("--- 6. DATA EXPORT VERIFICATION ---")
        export_res = await client.get("/profile/export", headers=new_headers)
        assert export_res.status_code == 200
        export_data = export_res.json()
        assert "user" in export_data
        assert export_data["user"]["email"] == email
        assert "accounts" in export_data
        assert "transactions" in export_data
        assert "budgets" in export_data
        assert "savings_goals" in export_data
        assert "bills" in export_data
        print("Structured JSON data export verified.")

        print("--- 7. SECURITY & USER ISOLATION TESTS ---")
        # Unauthenticated request -> REJECTED
        unauth_res = await client.get("/profile")
        assert unauth_res.status_code == 401
        print("Unauthenticated profile access rejection verified.")

        print("--- 8. DESTRUCTIVE ACCOUNT DELETION FLOW ---")
        del_res = await client.delete("/profile", headers=new_headers)
        assert del_res.status_code == 204

        # Login with deleted account credentials -> REJECTED
        deleted_login = await client.post("/auth/login", json={
            "email": email,
            "password": new_password
        })
        assert deleted_login.status_code == 401
        print("Disposable test user account deletion verified.")
        print("--- ALL PROFILE & SETTINGS USER FLOW CHECKS PASSED PERFECTLY ---")

if __name__ == "__main__":
    asyncio.run(main())
