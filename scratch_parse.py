import json

path = r'C:\Users\LENOVO\.gemini\antigravity-ide\brain\d59cca5c-58fd-4239-a984-76918216d903\.system_generated\steps\2034\output.txt'
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

screens = data.get('screens', [])
print(f"TOTAL_SCREENS: {len(screens)}")
for idx, s in enumerate(screens, 1):
    title = s.get('title', 'Untitled')
    name = s.get('name', '')
    screen_id = name.split('/')[-1] if '/' in name else name
    print(f"{idx}. {title} | ID: {screen_id}")
