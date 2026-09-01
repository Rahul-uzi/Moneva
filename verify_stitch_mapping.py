import json

path = r'C:\Users\LENOVO\.gemini\antigravity-ide\brain\d59cca5c-58fd-4239-a984-76918216d903\.system_generated\steps\2056\output.txt'
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

screens = data.get('screens', [])

# Map of exact title -> id
exact_map = {}
for s in screens:
    title = s.get('title', '').strip()
    name = s.get('name', '').strip()
    screen_id = name.split('/')[-1] if '/' in name else name
    exact_map[title] = screen_id

print(f"Total live screens loaded: {len(screens)}")

targets = [
    ("Home", ["Home", "MONEVA Home"]),
    ("Activity", ["Activity", "MONEVA Activity"]),
    ("Accounts", ["Accounts"]),
    ("Plan", ["Plan", "MONEVA Plan"]),
    ("Assistant", ["Assistant", "MONEVA Assistant", "MONEVA AI Assistant", "AI Assistant"]),
    ("Expense", ["Expense", "Add Expense"]),
    ("Income", ["Income", "Add Income"]),
    ("Salary Setup", ["Salary Setup", "Salary"]),
    ("Salary Received", ["Salary Received"]),
    ("Budget", ["Budget"]),
    ("Savings Goals", ["Savings Goal", "Savings Goals"]),
    ("Goal Details", ["Goal Details"]),
    ("Bills", ["Bill", "Bills"]),
    ("Bill Details", ["Bill Details"]),
    ("Profile", ["Profile"]),
    ("Security & Privacy", ["Security"]),
    ("Appearance & Preferences", ["Appearance"]),
    ("Notification Center", ["Notification Center"]),
    ("Notification Settings", ["Notification Settings"]),
    ("Analytics", ["Analytics"]),
    ("Reports & Cash Flow", ["Reports"])
]

for label, keywords in targets:
    matching_titles = []
    for title in sorted(exact_map.keys()):
        if any(kw.lower() in title.lower() for kw in keywords):
            matching_titles.append((title, exact_map[title]))
    
    print(f"\n==========================================")
    print(f"TARGET: {label} ({len(matching_titles)} matching titles found)")
    print(f"==========================================")
    for title, sid in matching_titles:
        print(f"  * Exact Title: '{title}' | ID: {sid}")
