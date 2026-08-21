import json, glob, os, re, hashlib
from collections import Counter, defaultdict

ROOT = r'E:\Triumph\praxis-5001'
BATCH_DIR = os.path.join(ROOT, 'assets', 'batches')
VALID_SUBTESTS = {'5002','5003','5004','5005'}
VALID_CATEGORIES = {
 '5002': {'Reading','Writing, Speaking, and Listening'},
 '5003': {'Numbers and Operations','Algebraic Thinking','Geometry and Measurement, Data, Statistics, and Probability'},
 '5004': {'United States History, Government, and Citizenship','Geography, Anthropology, and Sociology','World History and Economics'},
 '5005': {'Earth Science','Life Science','Physical Science'},
}
REQ = ['id','subtest','category','difficulty','type','question','options','answer_index','explanation','source']

def norm(s):
    return re.sub(r'[^a-z0-9]+',' ',str(s).lower()).strip()

def batch_num(path):
    return int(re.search(r'B(\d+)\.json$', path, re.I).group(1))

files = sorted(glob.glob(os.path.join(BATCH_DIR,'B*.json')), key=batch_num)
issues=[]; rows=[]
for path in files:
    with open(path,encoding='utf-8') as f: d=json.load(f)
    qs=d.get('questions',[])
    if d.get('count') is not None and d['count'] != len(qs):
        issues.append({'severity':'error','code':'batch_count','file':os.path.basename(path),'id':'','detail':f"count={d['count']} actual={len(qs)}"})
    for i,q in enumerate(qs):
        row={'file':os.path.basename(path),'pos':i+1,'q':q}; rows.append(row)
        qid=q.get('id','')
        for k in REQ:
            if k not in q: issues.append({'severity':'error','code':'missing_field','file':row['file'],'id':qid,'detail':k})
        st=str(q.get('subtest',''))
        if st not in VALID_SUBTESTS: issues.append({'severity':'error','code':'bad_subtest','file':row['file'],'id':qid,'detail':st})
        if st in VALID_CATEGORIES and q.get('category') not in VALID_CATEGORIES[st]: issues.append({'severity':'error','code':'bad_category','file':row['file'],'id':qid,'detail':str(q.get('category'))})
        if not re.fullmatch(r'500[2-5]-\d{3}',qid): issues.append({'severity':'error','code':'bad_id_format','file':row['file'],'id':qid,'detail':''})
        if qid and st and not qid.startswith(st+'-'): issues.append({'severity':'error','code':'id_subtest_mismatch','file':row['file'],'id':qid,'detail':st})
        opts=q.get('options')
        if not isinstance(opts,list) or len(opts)!=4: issues.append({'severity':'error','code':'bad_options_count','file':row['file'],'id':qid,'detail':str(len(opts) if isinstance(opts,list) else type(opts).__name__)})
        ai=q.get('answer_index')
        if not isinstance(ai,int) or isinstance(ai,bool) or ai not in range(4): issues.append({'severity':'error','code':'bad_answer_index','file':row['file'],'id':qid,'detail':str(ai)})
        if isinstance(opts,list):
            # Preserve punctuation, signs, and case because capitalization itself may be tested.
            no=[re.sub(r'\\s+',' ',str(x)).strip() for x in opts]
            if len(set(no))<len(no): issues.append({'severity':'error','code':'duplicate_options','file':row['file'],'id':qid,'detail':str(opts)})
        if q.get('difficulty') not in {'easy','medium','hard'}: issues.append({'severity':'error','code':'bad_difficulty','file':row['file'],'id':qid,'detail':str(q.get('difficulty'))})
        if q.get('type') not in {'knowledge','concept','pedagogy'}: issues.append({'severity':'error','code':'bad_type','file':row['file'],'id':qid,'detail':str(q.get('type'))})
        if not isinstance(q.get('source'),dict) or q.get('source',{}).get('type')!='original': issues.append({'severity':'error','code':'bad_source','file':row['file'],'id':qid,'detail':str(q.get('source'))})
        text=' '.join(map(str,[q.get('question',''),q.get('explanation','')]+(opts if isinstance(opts,list) else [])))
        if re.search(r'[\u4e00-\u9fff]', text): issues.append({'severity':'error','code':'non_english_char','file':row['file'],'id':qid,'detail':re.findall(r'[\u4e00-\u9fff]+',text)[0]})
        if len(str(q.get('explanation','')).split())<8: issues.append({'severity':'warning','code':'short_explanation','file':row['file'],'id':qid,'detail':str(len(str(q.get('explanation','')).split()))})
        if isinstance(opts,list) and ai in range(4):
            lens=[len(str(x)) for x in opts]
            if lens[ai] >= 1.8*(sum(lens)-lens[ai])/3 and lens[ai]>=55:
                issues.append({'severity':'warning','code':'answer_length_cue','file':row['file'],'id':qid,'detail':str(lens)})

id_groups=defaultdict(list); question_groups=defaultdict(list); combo_groups=defaultdict(list)
for r in rows:
    q=r['q']; id_groups[q.get('id','')].append(r)
    question_groups[norm(q.get('question',''))].append(r)
    combo_groups[norm(q.get('question',''))+'||'+'||'.join(sorted(norm(x) for x in q.get('options',[])))].append(r)
for key,group in id_groups.items():
    if key and len(group)>1:
        for r in group: issues.append({'severity':'error','code':'duplicate_id','file':r['file'],'id':key,'detail':f'count={len(group)}'})
for key,group in question_groups.items():
    if key and len(group)>1:
        for r in group: issues.append({'severity':'error','code':'duplicate_question','file':r['file'],'id':r['q'].get('id',''),'detail':f'count={len(group)}'})

report={
 'batch_files':len(files), 'raw_questions':len(rows), 'unique_ids':len(id_groups),
 'unique_question_texts':len(question_groups),
 'issue_counts':dict(Counter(i['code'] for i in issues)),
 'subtests':dict(Counter(str(r['q'].get('subtest')) for r in rows)),
 'categories':dict(Counter(str(r['q'].get('subtest'))+'|'+str(r['q'].get('category')) for r in rows)),
 'difficulties':dict(Counter(str(r['q'].get('difficulty')) for r in rows)),
 'types':dict(Counter(str(r['q'].get('type')) for r in rows)),
 'answer_indices':dict(Counter(str(r['q'].get('answer_index')) for r in rows)),
 'issues':issues,
}
out=os.path.join(ROOT,'audit-before.json')
with open(out,'w',encoding='utf-8') as f: json.dump(report,f,ensure_ascii=False,indent=2)
print(json.dumps({k:v for k,v in report.items() if k!='issues'},ensure_ascii=False,indent=2))
print('issue_rows',len(issues),'report',out)
