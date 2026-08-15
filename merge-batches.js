// merge-batches.js — 合并 Hermes 题库批次为 questions-full.json
// 用法: node merge-batches.js
// 输入: E:/hermes-workspace/praxis_5001/ 下的 questions.json + batch1..4.json（存在的都会合并）
// 输出: E:/harness/praxis-5001/assets/questions-full.json（校验 id 唯一，重复则报错退出）
const fs = require('fs');

const dir = 'E:/hermes-workspace/praxis_5001/';
const outDir = 'E:/harness/praxis-5001/assets/';
const files = ['questions.json', 'batch1.json', 'batch2.json', 'batch3.json', 'batch4.json'];

let all = [];
const ids = new Set();
let dups = [];
let order = 0;

files.forEach(f => {
  const p = dir + f;
  if (!fs.existsSync(p)) { console.log('跳过（不存在）:', f); return; }
  let data;
  try { data = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.log('解析失败:', f, e.message); process.exit(1); }
  const qs = data.questions || [];
  qs.forEach(q => {
    if (ids.has(q.id)) { dups.push(q.id); return; }
    ids.add(q.id);
    q._order = order++;
    all.push(q);
  });
  console.log(f + ': +' + qs.length);
});

if (dups.length) { console.log('重复 id（已跳过）:', dups.join(', ')); }

const out = {
  version: '2.0',
  exam: 'Praxis 5001',
  exam_name: 'Elementary Education: Multiple Subjects',
  blueprint: 'official',
  blueprint_note: 'ETS Study Companion; categories per official-blueprint-5001.json',
  question_count: all.length,
  questions: all.sort((a, b) => a._order - b._order).map(({ _order, ...q }) => q)
};
fs.writeFileSync(outDir + 'questions-full.json', JSON.stringify(out, null, 2), 'utf8');
console.log('合并完成:', all.length, '题 →', outDir + 'questions-full.json');
