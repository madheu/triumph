import json, glob, os, re
ROOT=r'E:\Triumph\praxis-5001'; BATCH=os.path.join(ROOT,'assets','batches')

def dump(p,d):
 with open(p,'w',encoding='utf-8') as f: json.dump(d,f,ensure_ascii=False,indent=2)

fixes={
 ('B38.json','5003-061'):{'explanation':'Dividing 3 by 4 gives 0.75. The distractor 0.25 reverses the size relationship and equals one fourth, not three fourths.'},
 ('B38.json','5003-069'):{'question':'Which number is not a factor of 24?','options':['8','5','6','12'],'answer_index':1,'explanation':'A factor divides 24 with no remainder: 8, 6, and 12 are factors, but 24 ÷ 5 is not a whole number. Therefore 5 is the only correct choice.'},
 ('B13.json','5002-057'):{'explanation':"'The papers were graded by the teacher' is passive because the subject receives the action. Each distractor makes the teacher the actor and is therefore active voice."},
 ('B13.json','5002-059'):{'explanation':"'Our research yielded positive results' is concise, formal, and active. 'We did the research and the results were good' is grammatical but less precise, while the other alternatives remain awkward or vague."},
 ('B13.json','5002-068'):{'question':"Which revision clearly indicates that Mike made the mistake in 'Tom told Mike that he made a mistake'?",'options':["Tom told Mike, 'You made a mistake.'","Tom told Mike that Tom made a mistake.","Tom told Mike that he had made a mistake.","Tom said that a mistake had been made."],'answer_index':0,'explanation':"Directly quoting Tom as saying 'You made a mistake' identifies Mike as the person who erred. Naming Tom instead changes the meaning, and the pronoun 'he' remains ambiguous."},
 ('B13.json','5002-072'):{'explanation':"'If I were rich, I would travel' correctly uses subjunctive were for a hypothetical condition. The alternatives either use the indicative was or pair incompatible verb forms."},
 ('B13.json','5002-075'):{'explanation':"In 'Running quickly, the finish line came into view,' the opening phrase should modify a runner, but the grammatical subject is 'the finish line.' The other sentences attach their modifiers to a logical subject."},
 ('B13.json','5002-079'):{'explanation':"'Reading, writing, and painting' uses three gerunds and is fully parallel. The infinitive version is also parallel in isolation, so the best answer is the gerund sequence because it follows naturally after 'enjoyed'; the mixed-form distractors are not parallel."},
 ('B15.json','5004-033'):{'explanation':'The Constitution separates federal power among the legislative branch, which makes laws; the executive branch, which enforces laws; and the judicial branch, which interprets laws. The distractors omit a branch or confuse branches with particular institutions.'},
 ('B2.json','5002-022'):{'explanation':"The original leaves no clear person performing 'upon further review.' Naming the reviewers—'we found several discrepancies'—gives the modifier a logical subject; the other revisions keep an awkward or unclear attachment."},
 ('B2.json','5002-028'):{'explanation':'A strong conclusion synthesizes the main idea and shows its significance without adding an unrelated topic. The correct paragraph links individual recycling to broader environmental change, while the distractors merely list points, restate a claim, or introduce a new issue.'},
 ('B2.json','5002-029'):{'explanation':"Parallel structure requires matching grammatical forms. 'To run,' 'to dodge,' and 'to shoot' are three parallel infinitive phrases; the distractors mix forms or change the sentence into an awkward construction."},
 ('B3.json','5003-004'):{'explanation':'Dividing 3 by 4 gives 0.75. The other decimals represent different place values and do not equal three fourths.'},
 ('B8.json','5004-030'):{'explanation':'The Renaissance centered on revived classical learning, art, and humanism, whereas the Reformation challenged practices and authority within Western Christianity. The distractors either oversimplify the movements or assign them incorrect subjects.'},
 ('B21.json','5003-045'):{'question':'Which number is not divisible by 9?','options':['36','28','18','27'],'answer_index':1,'explanation':'A number is divisible by 9 when its digits sum to a multiple of 9. The digit sum of 28 is 10, so 28 is not divisible by 9; 18, 27, and 36 are.'},
 ('B32.json','5002-102'):{'question':'Which sentence uses an idiom to mean that someone identified the exact issue?','options':['He kicked the bucket yesterday.','She hit the nail on the head with her argument.','The carpenter struck a nail with a hammer.','It is raining heavily outside.'],'answer_index':1,'explanation':"'Hit the nail on the head' is an idiom meaning to identify or describe something exactly. The literal carpenter sentence is not idiomatic, and the other choices express different meanings."},
}
changes=[]
for p in glob.glob(os.path.join(BATCH,'B*.json')):
 d=json.load(open(p,encoding='utf-8')); name=os.path.basename(p);touch=False
 for q in d['questions']:
  k=(name,q['id'])
  if k in fixes:
   before={x:q.get(x) for x in fixes[k]};q.update(fixes[k]);touch=True;changes.append({'file':name,'id':q['id'],'change':'reference_and_ambiguity_fix','before':before,'after':fixes[k]})
 if touch:dump(p,d)
# rebuild
files=sorted(glob.glob(os.path.join(BATCH,'B*.json')),key=lambda p:int(os.path.basename(p)[1:-5]));qs=[]
for p in files:qs+=json.load(open(p,encoding='utf-8'))['questions']
out=json.load(open(os.path.join(ROOT,'assets','questions-full.json'),encoding='utf-8'));out['questions']=qs;out['question_count']=len(qs);out['subtests']={}
for q in qs:out['subtests'][q['subtest']]=out['subtests'].get(q['subtest'],0)+1
dump(os.path.join(ROOT,'assets','questions-full.json'),out)
rp=os.path.join(ROOT,'review-fixes.json');r=json.load(open(rp,encoding='utf-8'));r.setdefault('manual_changes',[]).extend(changes);r['reference_and_ambiguity_fixes']=len(changes);dump(rp,r)
print('fixed',len(changes))
