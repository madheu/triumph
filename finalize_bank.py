import json,glob,os,hashlib,re,collections
ROOT=r'E:\Triumph\praxis-5001';BD=os.path.join(ROOT,'assets','batches');OUT=os.path.join(ROOT,'assets','questions-full.json')
files=sorted(glob.glob(os.path.join(BD,'B*.json')),key=lambda p:int(os.path.basename(p)[1:-5]));qs=[]
for p in files: qs.extend(json.load(open(p,encoding='utf-8'))['questions'])
sub=collections.Counter(q['subtest'] for q in qs);cat=collections.Counter((q['subtest'],q['category']) for q in qs)
out={'version':'3.0','exam':'Praxis 5001','exam_name':'Elementary Education: Multiple Subjects','blueprint':'official','blueprint_note':'ETS Study Companion; categories per official-blueprint-5001.json','review_status':'machine-audited plus targeted independent subject review; human pilot calibration still recommended before commercial release','question_count':len(qs),'subtests':dict(sorted(sub.items())),'questions':qs}
with open(OUT,'w',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
raw=open(OUT,'rb').read();sha=hashlib.sha256(raw).hexdigest()
result={'count':len(qs),'unique_ids':len({q['id'] for q in qs}),'unique_stems':len({re.sub(r'[^a-z0-9]+',' ',q['question'].lower()).strip() for q in qs}),'subtests':dict(sorted(sub.items())),'answer_indices':dict(sorted(collections.Counter(q['answer_index'] for q in qs).items())),'sha256':sha,'bytes':len(raw)}
with open(os.path.join(ROOT,'final-validation.json'),'w',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
print(json.dumps(result,ensure_ascii=False,indent=2))
