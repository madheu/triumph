import json

with open(r'E:\Triumph\praxis-5001\assets\questions-full.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

total = len(data['questions'])
print(f'Total questions: {total}')

# Count by category
cats = {}
for q in data['questions']:
    key = q.get('category', 'Unknown')
    cats[key] = cats.get(key, 0) + 1

print('\nBy category:')
for k, v in sorted(cats.items()):
    print(f'  {k}: {v}')

# Count by difficulty
diffs = {'easy': 0, 'medium': 0, 'hard': 0}
for q in data['questions']:
    d = q.get('difficulty', 'unknown')
    if d in diffs:
        diffs[d] += 1

print('\nBy difficulty:')
for k, v in sorted(diffs.items()):
    print(f'  {k}: {v}')

# Count by type
types = {'knowledge': 0, 'concept': 0, 'pedagogy': 0}
for q in data['questions']:
    t = q.get('type', 'unknown')
    if t in types:
        types[t] += 1

print('\nBy type:')
for k, v in sorted(types.items()):
    print(f'  {k}: {v}')
