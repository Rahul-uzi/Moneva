import json

path = r'C:\Users\LENOVO\.gemini\antigravity-ide\brain\d59cca5c-58fd-4239-a984-76918216d903\.system_generated\steps\2034\output.txt'
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

screens = data.get('screens', [])

# Map titles to items
screen_map = []
for s in screens:
    title = s.get('title', '')
    name = s.get('name', '')
    screen_id = name.split('/')[-1] if '/' in name else name
    screen_map.append({
        'title': title,
        'id': screen_id,
        'full_name': name,
        'width': s.get('width'),
        'height': s.get('height')
    })

# Print matching categories
targets = [
    "Home", "Activity", "Accounts", "Plan", "Assistant", "Expense", "Income",
    "Salary Setup", "Salary Received", "Budget", "Savings Goals", "Goal Details",
    "Bills", "Bill Details", "Profile", "Security", "Appearance", "Notification",
    "Analytics", "Reports"
]

for t in targets:
    matches = [s for s in screen_map if t.lower() in s['title'].lower()]
    print(f"\n=== TARGET: {t} ({len(matches)} matches) ===")
    for m in matches:
        print(f" - {m['title']} | ID: {m['id']}")
