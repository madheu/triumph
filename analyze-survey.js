#!/usr/bin/env node
/**
 * analyze-survey.js — Triumph 付费意愿判定脚本
 *
 * 用法:  node analyze-survey.js <Google Forms导出的CSV路径>
 * 例:    node analyze-survey.js survey-responses.csv
 *
 * 判定口径（与验证问卷.md / 项目 goal 一致）:
 *   严格口径（默认）: 愿付 $15/mo = Q5 选 "Yes, definitely (up to $15/mo)"
 *                     或 Q6 选 "$15–19/mo" / "$20+/mo"
 *   宽松口径（参考）: Q5 任一 "Yes" 或 Q6 非 "I wouldn't pay monthly"
 *   通过条件: 愿付人数 ≥ 10 且 比例 ≥ 30%
 *
 * 注意: 多选题列（Q2 等）Google Forms 会导出为带引号的多值字段，
 *       本脚本只统计 Q5/Q6（单选题列），其余列不影响结果。
 */
'use strict';

const fs = require('fs');

// ---------- 简易 RFC4180 CSV 解析（不依赖第三方库） ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ---------- 列匹配（按问题文本关键词，Google Forms 导出即问题全文） ----------
function findCol(header, re) {
  const idx = header.findIndex(h => re.test(h));
  return idx;
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('用法: node analyze-survey.js <survey.csv>');
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`找不到文件: ${csvPath}`);
    process.exit(1);
  }

  const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
  if (rows.length < 2) {
    console.error('CSV 没有数据行（只有表头？）');
    process.exit(1);
  }

  const header = rows[0].map(h => String(h).replace(/^\uFEFF/, '').trim());
  const q5 = findCol(header, /would you pay for it/i);          // Q5: If a tool could tell you ... would you pay for it?
  const q6 = findCol(header, /How much would you pay monthly/i); // Q6: How much would you pay monthly for ...
  if (q5 < 0 || q6 < 0) {
    console.error('未找到 Q5/Q6 列。表头为:');
    header.forEach((h, i) => console.error(`  [${i}] ${h}`));
    console.error('请确认 CSV 来自 验证问卷.md 对应的 Google Forms。');
    process.exit(1);
  }

  const data = rows.slice(1);
  const N = data.length;

  // 严格口径: 愿付 $15/mo
  const strict = data.filter(r => {
    const a = (r[q5] || '').trim();
    const b = (r[q6] || '').trim();
    return a === 'Yes, definitely (up to $15/mo)'
        || b.includes('15–19') || b.includes('15-19')
        || b.includes('20+');
  }).length;

  // 宽松口径: 任何形式的愿付
  const loose = data.filter(r => {
    const a = (r[q5] || '').trim();
    const b = (r[q6] || '').trim();
    return a.startsWith('Yes')
        || (b.length > 0 && !/wouldn't pay|I wouldn't/i.test(b));
  }).length;

  // Q4（已花费）分布: 与愿付交叉看强信号
  const q4 = findCol(header, /How much have you spent/i);
  const spent150plus = q4 >= 0
    ? data.filter(r => /151|300/.test((r[q4] || '').trim())).length
    : null;

  // ---------- 输出 ----------
  const pct = n => ((n / N) * 100).toFixed(1) + '%';
  console.log('='.repeat(56));
  console.log('Triumph · 付费意愿判定（付费意愿验证问卷）');
  console.log('='.repeat(56));
  console.log(`总答卷数 N          : ${N}`);
  console.log(`Q5 列 (would you pay): ${header[q5]}`);
  console.log(`Q6 列 (pay monthly) : ${header[q6]}`);
  if (q4 >= 0) console.log(`Q4 列 (spent so far) : ${header[q4]}`);
  console.log('-'.repeat(56));
  console.log(`[严格口径] 愿付 $15/mo   : ${strict} 人  (${pct(strict)})`);
  console.log(`[宽松口径] 任何愿付      : ${loose} 人  (${pct(loose)})`);
  if (spent150plus !== null) {
    console.log(`已花费 $150+          : ${spent150plus} 人  (${pct(spent150plus)})`);
  }
  console.log('-'.repeat(56));

  // 判定（用严格口径，与 goal 一致）
  const pass = strict >= 10 && strict / N >= 0.30;
  console.log(`判定标准: 愿付 $15/mo ≥ 10 人 且 比例 ≥ 30%`);
  if (pass) {
    console.log('>>> ✅ 判定通过: MVP 付费假设成立，可进入正式开发');
    process.exit(0);
  } else {
    const reasons = [];
    if (N < 10) reasons.push('样本不足 10 人，先继续收集');
    else if (strict < 10) reasons.push('愿付人数不足 10');
    else reasons.push('愿付比例不足 30%');
    console.log(`>>> ❌ 判定未通过（${reasons.join('；')}）`);
    console.log('>>> 建议: 换钩子 / 调价 / 改定位后再验证，详见 验证问卷.md 中文说明');
    process.exit(1);
  }
}

main();
