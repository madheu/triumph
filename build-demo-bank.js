// build-demo-bank.js — 把题库 JSON 构建进 Diagnostic Demo.html 的 DM_BANK
// 用法: node build-demo-bank.js [source.json]
// 默认源: E:/hermes-workspace/praxis_5001/template3-all-subtests-86.json
const fs = require('fs');

const demoPath = 'E:/harness/praxis-5001/Diagnostic Demo.html';
const srcPath = process.argv[2] || 'E:/hermes-workspace/praxis_5001/template3-all-subtests-86.json';
const SUB = { '5002': 'Reading and Language Arts', '5003': 'Mathematics', '5004': 'Social Studies', '5005': 'Science' };

// 用反引号包裹文本，转义反引号、反斜杠、${ 插值
const esc = s => '`' + String(s)
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${') + '`';

const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
const qs = data.questions || [];
if (!qs.length) { console.error('题库为空'); process.exit(1); }

const lines = ['const DM_BANK = ['];
qs.forEach(q => {
  lines.push(`      { id: ${esc(q.id)}, code: ${esc(q.subtest)}, subtest: ${esc(SUB[q.subtest] || q.subtest)},`);
  lines.push(`        q: ${esc(q.question)},`);
  lines.push('        options: [');
  q.options.forEach(o => lines.push(`          ${esc(o)},`));
  lines.push('        ], answer: ' + q.answer_index + ',');
  lines.push(`        explain: ${esc(q.explanation)} },`);
});
lines.push('    ];');
const newBlock = lines.join('\n');

let demo = fs.readFileSync(demoPath, 'utf8');
const re = /const DM_BANK = \[[\s\S]*?\n    \];/;
if (!re.test(demo)) { console.error('未找到 DM_BANK 数组（结构可能已变化）'); process.exit(1); }
demo = demo.replace(re, newBlock);
demo = demo.replace(/每次诊断从 DM_BANK 随机抽取（每科 3 题），见 DM_drawSession[^\n]*/,
  `每次诊断从 DM_BANK 随机抽取（每科 3 题），见 DM_drawSession · 题库 ${qs.length} 题（template3，官方蓝图）`);
fs.writeFileSync(demoPath, demo, 'utf8');
console.log('DM_BANK 已更新:', qs.length, '题 →', demoPath);
