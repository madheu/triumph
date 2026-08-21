// build-questions-js.js — 从 questions-full.json 生成 site/questions.js（外部题库数据文件）
// 用法: node build-questions-js.js
// 输出: E:\Triumph\praxis-5001/site/questions.js  →  window.DM_BANK_EXT = [ ... 969 题 ... ]
// diagnostic.html 通过 <script src="questions.js"></script> 加载（避免内嵌大数组拖慢渲染）
const fs = require('fs');

const srcPath = 'E:\Triumph\praxis-5001/assets/questions-full.json';
const outPath = 'E:\Triumph\praxis-5001/site/questions.js';
const SUB = { '5002': 'Reading and Language Arts', '5003': 'Mathematics', '5004': 'Social Studies', '5005': 'Science' };

const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
const qs = data.questions || [];
if (!qs.length) { console.error('题库为空'); process.exit(1); }

const esc = s => JSON.stringify(String(s)); // JSON 字符串（自动转义引号/换行）

const lines = ['/* Triumph question bank — generated from questions-full.json (do not edit by hand) */',
  'window.DM_BANK_EXT = ['];
qs.forEach(q => {
  lines.push(`  { id: ${esc(q.id)}, code: ${esc(q.subtest)}, subtest: ${esc(SUB[q.subtest] || q.subtest)}, category: ${esc(q.category || '')}, q: ${esc(q.question)}, options: [${q.options.map(esc).join(', ')}], answer: ${q.answer_index}, explain: ${esc(q.explanation)} },`);
});
lines.push('];');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log('生成完成:', qs.length, '题 →', outPath);
