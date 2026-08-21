import json, glob, os, re, shutil, hashlib, random
from collections import defaultdict, Counter
from datetime import datetime

ROOT = r'E:\Triumph\praxis-5001'
BATCH_DIR = os.path.join(ROOT, 'assets', 'batches')
OUT = os.path.join(ROOT, 'assets', 'questions-full.json')
BACKUP_DIR = os.path.join(ROOT, 'backups', 'before-review-2026-08-16')
REPORT = os.path.join(ROOT, 'review-fixes.json')
VALID_CATS = {
 '5002': {'Reading','Writing, Speaking, and Listening'},
 '5003': {'Numbers and Operations','Algebraic Thinking','Geometry and Measurement, Data, Statistics, and Probability'},
 '5004': {'United States History, Government, and Citizenship','Geography, Anthropology, and Sociology','World History and Economics'},
 '5005': {'Earth Science','Life Science','Physical Science'},
}

def norm(s): return re.sub(r'[^a-z0-9]+',' ',str(s).lower()).strip()
def bnum(p): return int(re.search(r'B(\d+)\.json$',p,re.I).group(1))
def dump(path,data):
    with open(path,'w',encoding='utf-8') as f: json.dump(data,f,ensure_ascii=False,indent=2)
def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

os.makedirs(BACKUP_DIR,exist_ok=True)
files=sorted(glob.glob(os.path.join(BATCH_DIR,'B*.json')),key=bnum)
for p in files:
    dst=os.path.join(BACKUP_DIR,os.path.basename(p))
    if not os.path.exists(dst): shutil.copy2(p,dst)
if os.path.exists(OUT):
    dst=os.path.join(BACKUP_DIR,'questions-full.json')
    if not os.path.exists(dst): shutil.copy2(OUT,dst)

manual = {
 ('B2.json','5002-042'): {
  'question': "Which revision best corrects the run-on sentence 'The experiment failed the students tried again'?"
 },
 ('B2.json','5002-053'): {
  'options': [
   "In conclusion, I discussed pollution, recycling, and conservation. That is all.",
   "Recycling is important because it helps the environment and saves resources.",
   "As this essay has shown, individual actions such as recycling can conserve resources, and widespread participation can create meaningful environmental change.",
   "A new topic to consider is whether schools should require students to recycle at home."
  ]
 },
 ('B7.json','5004-018'): {
  'question': 'How many inhabited continents are commonly recognized in the seven-continent model?',
  'options': ['Five','Six','Seven','Eight'], 'answer_index':2,
  'explanation':'The seven-continent model identifies Africa, Antarctica, Asia, Europe, North America, South America, and Australia. Other cultural models group continents differently, so the question specifies the model and asks about the commonly recognized seven.'
 },
 ('B58.json','5005-093'): {
  'question':'Students describe cells as simple building blocks. Which instructional response would best deepen their understanding?',
  'options':['Ask students to memorize a list of organelles','Use a systems model showing how organelles coordinate metabolism, transport, and communication','Tell students that cells are complicated without providing examples','Focus only on the cell membrane'],
  'explanation':'A systems model shows that organelles interact rather than operate as an isolated list of parts. Memorization alone does not reveal how cellular processes are coordinated.'
 },
 ('B69.json','5003-110'): {
  'question':'What does the discriminant b² - 4ac indicate for a quadratic equation?',
  'options':['The slope of its graph','The number and type of solutions','The y-intercept','The coordinates of the vertex'],
  'explanation':'For ax² + bx + c = 0, a positive discriminant gives two distinct real solutions, zero gives one repeated real solution, and a negative value gives two nonreal complex solutions. It does not directly determine the slope, intercept, or vertex.'
 },
 ('B80.json','5004-094'): {
  'options':['A sudden change in climate alone','A combination of political instability, economic strain, military pressures, and invasions','A single volcanic eruption','The invention of printing'],
  'explanation':'Historians explain the fall of the Western Roman Empire through interacting internal and external pressures rather than one event. A single disaster does not account for the long decline.'
 },
 ('B80.json','5004-096'): {
  'options':['Britain had Europe’s largest population','Britain combined accessible coal, investment capital, stable institutions, colonial markets, and agricultural change','Britain was Europe’s largest country by land area','Britain had no competing industries'],
  'explanation':'Industrialization began in Britain because several favorable resources and institutions converged. Population or land area alone cannot explain why mechanized industry developed there first.'
 },
 ('B81.json','5003-123'): {
  'difficulty':'medium','type':'pedagogy',
  'question':"A student translates 'three more than twice a number' as 3(x + 2). Which feedback best addresses the error?",
  'options':["Confirm that 3(x + 2) is correct","Explain that 'twice a number' is 2x and 'three more than' means add 3, so the expression is 2x + 3","Replace x with 3 and keep the expression","Tell the student to reverse every operation word"],
  'answer_index':1,
  'explanation':"The phrase 'twice a number' forms 2x, and 'three more than' adds 3, giving 2x + 3. The expression 3(x + 2) incorrectly multiplies the entire sum by 3."
 },
 ('B90.json','5005-128'): {
  'options':['Read definitions of evaporation and condensation','Seal a small amount of water in a clear bag and place it in sunlight so students can observe evaporation, condensation, and droplets returning downward','Observe clouds outdoors without recording changes','Copy a labeled water-cycle diagram'],
  'explanation':'The sealed-bag model lets students directly observe water changing state and cycling within a closed system. Reading or copying diagrams does not provide the same observable evidence.'
 },
 ('B90.json','5005-131'): {
  'question':'Why can earthquakes occur within tectonic plates as well as at their boundaries?',
  'options':['Earthquakes cannot occur within plates','Stresses can reactivate old faults within a plate, although most earthquakes occur near boundaries','Tectonic plates never deform internally','Only underwater faults produce earthquakes'],
  'explanation':'Most earthquakes occur at plate boundaries, but intraplate stress can reactivate ancient faults, as in the New Madrid seismic zone. Therefore plate interiors are less active, not earthquake-free.'
 },
}

all_rows=[]; changes=[]
for p in files:
    name=os.path.basename(p); d=json.load(open(p,encoding='utf-8'))
    if d.get('count') != len(d.get('questions',[])):
        changes.append({'file':name,'id':'','change':'corrected_batch_count','before':d.get('count'),'after':len(d.get('questions',[]))})
        d['count']=len(d.get('questions',[]))
    for q in d['questions']:
        key=(name,q.get('id'))
        if key in manual:
            before={k:q.get(k) for k in manual[key]}
            q.update(manual[key])
            changes.append({'file':name,'id':q.get('id'),'change':'manual_quality_fix','before':before,'after':manual[key]})
        all_rows.append({'file':name,'question':q})
    dump(p,d)

# Deduplicate by normalized stem, preserving earliest occurrence. The later identical stem is not useful as a separate item.
kept=[]; seen_stems={}; removed=[]
for row in all_rows:
    q=row['question']; k=norm(q.get('question',''))
    if k in seen_stems:
        removed.append({'file':row['file'],'old_id':q.get('id'),'duplicate_of':seen_stems[k]['question'].get('id'),'reason':'identical_question_text'})
    else:
        seen_stems[k]=row; kept.append(row)

# Stable per-subtest renumbering eliminates every reused id. Keep a map for traceability.
seq=Counter(); id_map=[]
for row in kept:
    q=row['question']; st=str(q['subtest']); seq[st]+=1
    old=q.get('id'); new=f'{st}-{seq[st]:03d}'
    q['id']=new
    if old!=new: id_map.append({'file':row['file'],'old_id':old,'new_id':new})

# Rotate options deterministically so the correct answer is not overwhelmingly option B.
# Preserve the answer by moving the selected option together with the index.
rotation_counts=Counter()
for idx,row in enumerate(kept):
    q=row['question']; opts=q['options']; ai=q['answer_index']
    if len(opts)!=4 or ai not in range(4): continue
    target=idx % 4
    correct=opts[ai]
    distractors=[x for i,x in enumerate(opts) if i!=ai]
    seed=int(hashlib.sha256(q['id'].encode()).hexdigest()[:8],16)
    random.Random(seed).shuffle(distractors)
    new=[]; di=0
    for pos in range(4):
        if pos==target: new.append(correct)
        else: new.append(distractors[di]); di+=1
    q['options']=new; q['answer_index']=target; rotation_counts[target]+=1

# Write each batch back with the kept questions belonging to it; remove batches that now only contain duplicate stems.
by_file=defaultdict(list)
for row in kept: by_file[row['file']].append(row['question'])
for p in files:
    name=os.path.basename(p); d=json.load(open(p,encoding='utf-8'))
    d['questions']=by_file[name]
    d['count']=len(d['questions'])
    # Targets now describe actual batch content rather than stale generation plans.
    d['difficulty_target']=dict(Counter(q['difficulty'] for q in d['questions']))
    d['type_target']=dict(Counter(q['type'] for q in d['questions']))
    dump(p,d)

questions=[r['question'] for r in kept]
subtests=Counter(q['subtest'] for q in questions)
out={
 'version':'3.0','exam':'Praxis 5001','exam_name':'Elementary Education: Multiple Subjects',
 'blueprint':'official','blueprint_note':'ETS Study Companion; categories per official-blueprint-5001.json',
 'review_status':'machine-audited and targeted subject-matter review; human calibration still recommended before commercial release',
 'question_count':len(questions),'subtests':dict(sorted(subtests.items())),'questions':questions
}
dump(OUT,out)
report={
 'raw_before':len(all_rows),'removed_identical_questions':len(removed),'final_count':len(questions),
 'renumbered_ids':len(id_map),'manual_quality_fixes':len([c for c in changes if c['change']=='manual_quality_fix']),
 'batch_count_fixes':len([c for c in changes if c['change']=='corrected_batch_count']),
 'answer_index_distribution':dict(sorted(rotation_counts.items())),
 'backup_dir':BACKUP_DIR,'output_sha256':sha(OUT),'manual_changes':changes,'removed':removed,'id_map':id_map
}
dump(REPORT,report)
print(json.dumps({k:v for k,v in report.items() if k not in {'manual_changes','removed','id_map'}},ensure_ascii=False,indent=2))
print('subtests',dict(sorted(subtests.items())))
