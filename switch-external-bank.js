// switch-external-bank.js — diagnostic.html 改用外部题库（一次性工具）
const fs = require('fs');
const f = 'E:\Triumph\praxis-5001/site/diagnostic.html';
let c = fs.readFileSync(f, 'utf8');

// 1. 替换内嵌 DM_BANK 数组为外部引用
const start = c.indexOf('const DM_BANK = [');
if (start < 0) { console.error('未找到 DM_BANK'); process.exit(1); }
const end = c.indexOf('\n    ];', start);
if (end < 0) { console.error('未找到数组结尾'); process.exit(1); }
const replacement = 'const DM_BANK = window.DM_BANK_EXT || []; // 题库来自 questions.js（build-questions-js.js 生成）';
c = c.slice(0, start) + replacement + c.slice(end + '\n    ];'.length);

// 2. 在 babel script 前加载 questions.js
const babelTag = '<script type="text/babel">';
const qsTag = '<script src="questions.js"></script>\n  ' + babelTag;
if (c.includes('src="questions.js"')) {
  console.log('questions.js 标签已存在');
} else {
  c = c.replace(babelTag, qsTag);
}
fs.writeFileSync(f, c, 'utf8');
console.log('diagnostic.html 已更新：外部题库 + 加载标签');
