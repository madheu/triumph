import json, os, glob

ROOT=r'E:\Triumph\praxis-5001'
BATCH=os.path.join(ROOT,'assets','batches')
REPORT=os.path.join(ROOT,'review-fixes.json')

def dump(p,d):
    with open(p,'w',encoding='utf-8') as f: json.dump(d,f,ensure_ascii=False,indent=2)

# Target questions by their normalized post-review IDs.
fixes={
 ('B46.json','5003-075'):{
  'options':['3x - 2','3(x + 2)','3x + 2','3x + 6']
 },
 ('B38.json','5003-061'):{
  'explanation':'Absolute value measures distance from zero, so it is never negative. Therefore |-7| = 7; -7 is the original number, not its absolute value.'
 },
 ('B69.json','5003-101'):{
  'explanation':'Slope is the change in y divided by the change in x: (7 - 3) ÷ (4 - 2) = 4 ÷ 2 = 2. Reversing only one subtraction would incorrectly produce a negative value.'
 },
 ('B75.json','5003-110'):{
  'explanation':'Dividing 2 by 5 gives 0.4, and multiplying by 100 converts the decimal to 40%. The distractor 20% reverses the numerator and denominator relationship.'
 },
 ('B81.json','5003-125'):{
  'explanation':'The slope is (11 - 3) ÷ (4 - 0) = 8 ÷ 4 = 2. Using only the change in y would incorrectly give 8 instead of a rate of change.'
 },
 ('B91.json','5003-148'):{
  'explanation':'The mean is the sum divided by the number of values: (12 + 15 + 18 + 21 + 24) ÷ 5 = 90 ÷ 5 = 18. Choosing 21 would confuse the mean with one of the upper data values.'
 },
 ('B95.json','5003-158'):{
  'explanation':'Dividing the numerator by the denominator gives 3 ÷ 8 = 0.375. The distractor 0.38 is only a rough rounding and is not the exact decimal requested.'
 },
 ('B95.json','5003-161'):{
  'explanation':'Converting 2.5 to a fraction gives 25/10, which simplifies by 5 to 5/2, or 2 1/2. The fraction 2/5 instead equals 0.4.'
 }
}
changes=[]
for p in glob.glob(os.path.join(BATCH,'B*.json')):
    d=json.load(open(p,encoding='utf-8')); name=os.path.basename(p); touched=False
    for q in d['questions']:
        k=(name,q['id'])
        if k in fixes:
            before={x:q.get(x) for x in fixes[k]}; q.update(fixes[k]); touched=True
            changes.append({'file':name,'id':q['id'],'change':'secondary_quality_fix','before':before,'after':fixes[k]})
    if touched: dump(p,d)

# Rebuild full bank from reviewed batches without deduplication because IDs and stems are now unique.
files=sorted(glob.glob(os.path.join(BATCH,'B*.json')),key=lambda p:int(os.path.basename(p)[1:-5]))
qs=[]
for p in files: qs.extend(json.load(open(p,encoding='utf-8'))['questions'])
out={
 'version':'3.0','exam':'Praxis 5001','exam_name':'Elementary Education: Multiple Subjects',
 'blueprint':'official','blueprint_note':'ETS Study Companion; categories per official-blueprint-5001.json',
 'review_status':'machine-audited and targeted subject-matter review; human calibration still recommended before commercial release',
 'question_count':len(qs),'subtests':{},'questions':qs
}
for q in qs: out['subtests'][q['subtest']]=out['subtests'].get(q['subtest'],0)+1
dump(os.path.join(ROOT,'assets','questions-full.json'),out)

r=json.load(open(REPORT,encoding='utf-8')); r.setdefault('manual_changes',[]).extend(changes); r['secondary_quality_fixes']=len(changes); dump(REPORT,r)
print('secondary fixes',len(changes),'final',len(qs))
