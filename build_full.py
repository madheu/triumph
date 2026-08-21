import json
from collections import defaultdict
import os

BATCH_DIR = r'E:\Triumph\praxis-5001\assets\batches'
OUT_FILE = r'E:\Triumph\praxis-5001\assets\questions-full.json'

files = sorted([f for f in os.listdir(BATCH_DIR) if f.endswith('.json')], key=lambda x: int(x[1:-5]))

seen_ids = set()
questions = []

for fname in files:
    path = os.path.join(BATCH_DIR, fname)
    with open(path, 'r', encoding='utf-8') as f:
        batch = json.load(f)
    for q in batch['questions']:
        if q['id'] not in seen_ids:
            seen_ids.add(q['id'])
            questions.append(q)

out = {'subtests': {}, 'questions': questions}
for q in questions:
    st = q.get('subtest', 'unknown')
    out['subtests'].setdefault(st, 0)
    out['subtests'][st] += 1

with open(OUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

# Summary
by_cat = defaultdict(int)
by_diff = defaultdict(int)
by_type = defaultdict(int)
for q in questions:
    by_cat[q.get('category', 'unknown')] += 1
    by_diff[q.get('difficulty', 'unknown')] += 1
    by_type[q.get('type', 'unknown')] += 1

print(f"Total unique questions: {len(questions)}")
print(f"Batches processed: {len(files)}")
print(f"\nBy subtest:")
for k, v in sorted(out['subtests'].items()):
    print(f"  {k}: {v}")
print(f"\nBy category:")
for k, v in sorted(by_cat.items()):
    print(f"  {k}: {v}")
print(f"\nBy difficulty:")
for k, v in sorted(by_diff.items()):
    print(f"  {k}: {v}")
print(f"\nBy type:")
for k, v in sorted(by_type.items()):
    print(f"  {k}: {v}")
