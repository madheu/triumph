import json,glob,os
ROOT=r'E:\Triumph\praxis-5001';BD=os.path.join(ROOT,'assets','batches')
fixes={
 'Which rhetorical strategy is the author employing?':{
  'options':['Appeal to emotion through vivid imagery','Situational irony highlighting the contrast between intention and outcome','Direct argument with supporting evidence','Simple chronological narration'],'answer_index':1,
  'explanation':'The sentence highlights situational irony: a well-intentioned policy produces the opposite of its intended result. A paradox would require an apparently self-contradictory statement that reveals a truth; this sentence instead contrasts expectation with outcome.'},
 'When ice melts into water, what happens to the energy and arrangement of molecules?':{
  'options':['Energy decreases; molecules lock into a rigid lattice','Energy is absorbed; the open ice lattice breaks down and molecules move more freely','Energy is destroyed; molecules stop moving','Energy stays the same; molecules form a more ordered crystal'],'answer_index':1,
  'explanation':'Melting absorbs energy and disrupts the ordered hydrogen-bonded lattice of ice, allowing molecules to move more freely. Because ordinary ice has an open lattice, liquid water is denser near its melting point; it is inaccurate to say the molecules simply move farther apart.'},
 'Which model best represents the relationship between producers, consumers, and decomposers in an ecosystem?':{
  'options':['A diagram of a single plant','A food web showing energy transfer among organisms and decomposers connected to remains and wastes from multiple trophic levels','A weather chart','A list of animals arranged alphabetically'],'answer_index':1,
  'explanation':'A food web shows feeding relationships, while links from organisms and wastes to decomposers show nutrient recycling across trophic levels. A simple chain placing decomposers only at the end misrepresents their role.'},
 'Which ancient wonder was located in Egypt?':{
  'question':'Which ancient wonder is located at Giza in Egypt and still stands today?','options':['Temple of Artemis at Ephesus','Hanging Gardens of Babylon','Great Pyramid of Giza','Colossus of Rhodes'],'answer_index':2,
  'explanation':'The Great Pyramid of Giza is in Egypt and is the only one of the traditional Seven Wonders of the Ancient World still substantially standing. The other listed wonders were located outside Egypt.'},
 'Students think that all civilizations follow the same developmental path. Which evidence challenges this?':{
  'options':['Compare case studies showing how geography, resources, institutions, and contact shaped different development paths','Present a single timeline as the universal sequence','Ask students to memorize the names of early civilizations','Avoid comparing civilizations'],'answer_index':0,
  'explanation':'Comparative case studies show that societies developed differently in response to distinct environments, resources, institutions, and contacts. A single universal timeline would reinforce rather than challenge the misconception.'}
}
changes=[]
for p in glob.glob(os.path.join(BD,'B*.json')):
 d=json.load(open(p,encoding='utf-8'));touch=False
 for q in d['questions']:
  old_question=q['question']
  if old_question in fixes:
   spec=fixes[old_question]
   before={k:q.get(k) for k in spec};q.update(spec);touch=True;changes.append({'file':os.path.basename(p),'id':q['id'],'before':before,'after':spec})
 if touch:
  with open(p,'w',encoding='utf-8') as f:json.dump(d,f,ensure_ascii=False,indent=2)
files=sorted(glob.glob(os.path.join(BD,'B*.json')),key=lambda p:int(os.path.basename(p)[1:-5]));qs=[]
for p in files:qs+=json.load(open(p,encoding='utf-8'))['questions']
outp=os.path.join(ROOT,'assets','questions-full.json');out=json.load(open(outp,encoding='utf-8'));out['questions']=qs;out['question_count']=len(qs)
with open(outp,'w',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
rp=os.path.join(ROOT,'review-fixes.json');r=json.load(open(rp,encoding='utf-8'));r.setdefault('manual_changes',[]).extend({'change':'independent_reviewer_fix',**x} for x in changes);r['independent_reviewer_fixes']=len(changes)
with open(rp,'w',encoding='utf-8') as f:json.dump(r,f,ensure_ascii=False,indent=2)
print('reviewer fixes',len(changes),changes)
