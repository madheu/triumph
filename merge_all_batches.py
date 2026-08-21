import json
import os
from pathlib import Path

PROJECT_DIR = Path(r"E:\Triumph\praxis-5001")
BATCHES_DIR = PROJECT_DIR / "assets" / "batches"
FULL_FILE = PROJECT_DIR / "assets" / "questions-full.json"

# Load existing full questions
existing = []
max_ids = {}
if FULL_FILE.exists():
    with open(FULL_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    existing = data.get('questions', [])
    for q in existing:
        st = q['subtest']
        num = int(q['id'].split('-')[1])
        if st not in max_ids or num > max_ids[st]:
            max_ids[st] = num

all_questions = list(existing)
new_count = 0

# Load all batches
batch_files = sorted([f for f in os.listdir(BATCHES_DIR) if f.startswith('B') and f.endswith('.json')])
print(f"Found {len(batch_files)} batch files")

for bf in batch_files:
    batch_path = BATCHES_DIR / bf
    with open(batch_path, 'r', encoding='utf-8') as f:
        batch = json.load(f)
    
    questions = batch.get('questions', [])
    for q in questions:
        # Check if ID already exists
        if q['id'] in [x['id'] for x in all_questions]:
            print(f"  Skipping duplicate: {q['id']}")
            continue
        
        all_questions.append(q)
        new_count += 1
        
        st = q['subtest']
        num = int(q['id'].split('-')[1])
        if st not in max_ids or num > max_ids[st]:
            max_ids[st] = num

# Build output
output = {
    "version": "2.0",
    "exam": "Praxis 5001",
    "exam_name": "Elementary Education: Multiple Subjects",
    "blueprint": "official",
    "blueprint_source": {
        "publisher": "ETS",
        "document": "The Praxis Study Companion: Elementary Education: Multiple Subjects (5001)",
        "url": "https://www.ets.org/content/dam/ets-org/pdfs/praxis/5001.pdf"
    },
    "question_count": len(all_questions),
    "last_updated": "2026-08-16",
    "statistics": {
        "by_subtest": {},
        "by_category": {},
        "by_difficulty": {},
        "by_type": {}
    },
    "questions": all_questions
}

for q in all_questions:
    st = q.get('subtest', 'unknown')
    cat = q.get('category', 'unknown')
    diff = q.get('difficulty', 'unknown')
    typ = q.get('type', 'unknown')
    
    output['statistics']['by_subtest'][st] = output['statistics']['by_subtest'].get(st, 0) + 1
    output['statistics']['by_category'][f"{st}-{cat}"] = output['statistics']['by_category'].get(f"{st}-{cat}", 0) + 1
    output['statistics']['by_difficulty'][diff] = output['statistics']['by_difficulty'].get(diff, 0) + 1
    output['statistics']['by_type'][typ] = output['statistics']['by_type'].get(typ, 0) + 1

with open(FULL_FILE, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"\nTotal questions: {len(all_questions)}")
print(f"New questions added: {new_count}")
print(f"\nBy subtest:")
for k, v in sorted(output['statistics']['by_subtest'].items()):
    print(f"  {k}: {v}")
print(f"\nBy category:")
for k, v in sorted(output['statistics']['by_category'].items()):
    print(f"  {k}: {v}")
print(f"\nBy difficulty:")
for k, v in sorted(output['statistics']['by_difficulty'].items()):
    print(f"  {k}: {v}")
print(f"\nBy type:")
for k, v in sorted(output['statistics']['by_type'].items()):
    print(f"  {k}: {v}")
