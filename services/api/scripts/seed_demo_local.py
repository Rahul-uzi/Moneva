"""Create the LOCAL demo account and fill it with invented data.

For a throwaway API on this computer only (see the demo server notes in the
session that made it): it refuses any base URL that is not localhost, so it
can never create anything on the live server. Every name and amount here is
made up - the repo is public.

    python services/api/scripts/seed_demo_local.py [http://127.0.0.1:8000/api]

Sign in to the local demo with DEMO_EMAIL / DEMO_PASSWORD below.
"""
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

DEMO_EMAIL = "demo@moneva.test"
DEMO_PASSWORD = "Lime-Ledger-7319"
DEMO_NAME = "Demo User"

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/api").rstrip("/")
if urlparse(BASE).hostname not in ("127.0.0.1", "localhost"):
    sys.exit(f"refusing to seed {BASE}: the demo account is for a local server only")

IST = timezone(timedelta(hours=5, minutes=30))
TOKEN = None


def call(method, path, body=None):
    req = Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urlopen(req) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except HTTPError as err:
        sys.exit(f"{method} {path} -> {err.code}: {err.read().decode()[:300]}")


def at(day: str, hm: str = "12:00") -> str:
    """'2026-10-14', '16:32' (India time) -> UTC ISO string."""
    return datetime.fromisoformat(f"{day}T{hm}:00").replace(tzinfo=IST).astimezone(timezone.utc).isoformat()


def money(rupees: float) -> int:
    return round(rupees * 100)


# --- account ---------------------------------------------------------------
reg = call("POST", "/auth/register", {
    "email": DEMO_EMAIL, "password": DEMO_PASSWORD, "display_name": DEMO_NAME, "currency": "INR",
})
TOKEN = reg["access_token"]
cats = {c["name"]: c["id"] for c in call("GET", "/categories")}

bank = call("POST", "/accounts", {"name": "City Bank Savings", "account_type": "asset", "opening_balance_minor": money(45000)})["id"]
cash = call("POST", "/accounts", {"name": "Cash Wallet", "account_type": "asset", "opening_balance_minor": money(3000)})["id"]
card = call("POST", "/accounts", {"name": "Rewards Credit Card", "account_type": "liability", "opening_balance_minor": 0})["id"]

# --- goals (needed before their contributions) ------------------------------
fund = call("POST", "/goals", {"name": "Emergency Fund", "target_amount_minor": money(100000), "target_date": at("2027-06-30")})["id"]
phone = call("POST", "/goals", {"name": "New Phone", "target_amount_minor": money(25000), "target_date": at("2026-12-31")})["id"]


def tx(kind, amount, day, hm, desc, account=bank, category=None, note=None, to=None, goal=None):
    call("POST", "/transactions", {
        "client_mutation_id": str(uuid.uuid4()), "device_id": "demo-seed",
        "account_id": account, "to_account_id": to, "savings_goal_id": goal,
        "category_id": cats[category] if category else None,
        "transaction_type": kind, "amount_minor": money(amount), "currency": "INR",
        "description": desc, "notes": note, "transaction_date": at(day, hm),
    })


for month in ("2026-09", "2026-10"):
    tx("income", 60000, f"{month}-01", "10:05", "Salary Received: Office Salary", category="Salary")
    tx("expense", 15000, f"{month}-02", "09:30", "Rent", category="Rent & Housing", note="Monthly rent for the flat.")
    tx("expense", 1800, f"{month}-06", "18:10", "Power Board", category="Utilities")
    tx("expense", 799, f"{month}-05", "08:00", "City Fibre", category="Utilities", note="Home internet.")
    tx("transfer", 2000, f"{month}-03", "19:20", "Cash withdrawal", to=cash)

# September
tx("expense", 2350, "2026-09-07", "11:40", "Fresh Mart", category="Groceries", note="Weekly groceries.")
tx("expense", 640, "2026-09-09", "13:15", "Google Pay - Cafe Corner", category="Food & Dining", note="Lunch with the team.")
tx("expense", 1200, "2026-09-11", "08:45", "Metro card top-up", category="Transport")
tx("expense", 1500, "2026-09-14", "17:30", "Fuel Station", account=card, category="Fuel")
tx("expense", 2999, "2026-09-18", "21:05", "Online Store", account=card, category="Shopping", note="Running shoes.")
tx("expense", 420, "2026-09-20", "10:20", "Neighbourhood Pharmacy", account=cash, category="Health", note="Cold medicine.")
tx("expense", 560, "2026-09-26", "20:30", "Movie tickets", account=card, category="Entertainment")
tx("transfer", 10000, "2026-09-28", "09:00", "Goal Contribution: Emergency Fund", goal=fund)

# October
tx("expense", 2780, "2026-10-04", "11:10", "Fresh Mart", category="Groceries", note="Weekly groceries.")
tx("expense", 85, "2026-10-08", "16:40", "Google Pay - Fruit stall", account=cash, category="Groceries", note="Bananas and apples.")
tx("expense", 450, "2026-10-10", "13:25", "Google Pay - Cafe Corner", category="Food & Dining", note="Lunch.")
tx("income", 1200, "2026-10-12", "19:45", "Google Pay - Asha", category="Other Income", note="Her share of the dinner bill.")
tx("expense", 1600, "2026-10-12", "21:10", "Spice Route Restaurant", account=card, category="Food & Dining", note="Dinner with friends; Asha paid her share back.")
tx("expense", 1200, "2026-10-13", "08:40", "Metro card top-up", category="Transport")
tx("income", 150, "2026-10-15", "10:00", "Cashback reward", category="Other Income")
tx("expense", 1500, "2026-10-17", "18:00", "Fuel Station", account=card, category="Fuel")
tx("expense", 649, "2026-10-19", "15:30", "Book Nook", account=cash, category="Education", note="A finance book.")
tx("expense", 1899, "2026-10-21", "22:15", "Online Store", account=card, category="Shopping", note="Desk lamp.")
tx("expense", 250, "2026-10-23", "19:00", "Watch repair", account=cash, category="Other", note="New battery.")
tx("expense", 320, "2026-10-24", "13:05", "Google Pay - Chai Point", category="Food & Dining", note="Snacks.")
tx("transfer", 8000, "2026-10-20", "09:00", "Goal Contribution: Emergency Fund", goal=fund)
tx("transfer", 6000, "2026-10-22", "09:10", "Goal Contribution: New Phone", goal=phone)

# --- salary schedule, budgets, bills, EMI, money lent -----------------------
call("POST", "/income/recurring", {"source": "Office Salary", "amount_minor": money(60000), "frequency": "monthly",
                                   "next_occurrence": at("2026-11-01", "10:00"), "anchor_day": 1})

for name, limit in (("Food & Dining", 4000), ("Groceries", 6000), ("Shopping", 3000), ("Transport", 2500)):
    call("POST", "/budgets", {"category_id": cats[name], "limit_amount_minor": money(limit), "period": "monthly",
                              "start_date": at("2026-10-01", "00:00"), "end_date": at("2026-10-31", "23:59")})

for name, amount, due, rec, cat in (("City Fibre", 799, "2026-11-05", "monthly", "Utilities"),
                                    ("Phone recharge", 299, "2026-10-28", "monthly", "Utilities"),
                                    ("Streaming plan", 149, "2026-11-02", "monthly", "Entertainment")):
    call("POST", "/bills", {"name": name, "amount_minor": money(amount), "due_date": at(due, "09:00"),
                            "recurrence": rec, "category_id": cats[cat]})

call("POST", "/emis", {"name": "Laptop EMI", "monthly_minor": money(3500), "months": 12,
                       "started_at": at("2026-06-05", "10:00"), "account_id": bank})

call("POST", "/debts", {"person": "Ravi", "amount_minor": money(1500), "direction": "owed_to_me",
                        "note": "Concert tickets.", "occurred_on": at("2026-10-16", "20:00")})

summary = call("GET", "/finance/summary")
print(f"seeded {DEMO_EMAIL}: net worth Rs {summary['net_worth_minor'] / 100:,.2f}, "
      f"income Rs {summary['income_minor'] / 100:,.2f}, expenses Rs {summary['expense_minor'] / 100:,.2f}")
