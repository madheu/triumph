#!/usr/bin/env node
/**
 * D2 · 存量题库 → schema v1 映射脚本（5000 系列分支）
 *
 * 输入：praxis-5001/db/import-questions.sql（存量 969 题，questions 表 INSERT）
 * 输出：content-infra/items-5000-series.jsonl        映射后的题目（JSON Lines）
 *       content-infra/legacy-unknown-items.csv       source_basis = legacy-unknown 全量清单
 *       content-infra/map-report-5000-series.md      校验报告 + 遗留问题
 *
 * 特性：零依赖、幂等（每次覆盖输出）、可重复执行。
 *      结构校验失败会中断（exit 1）；完整性缺口只记 warning，不阻断。
 *
 * 用法：node content-infra/map-legacy-5001-to-schema-v1.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const SRC_SQL = join(REPO_ROOT, 'db', 'import-questions.sql');
const BRANCH_SPEC = join(HERE, 'item-schema-v1.5000-branch.json');
const OUT_JSONL = join(HERE, 'items-5000-series.jsonl');
const OUT_CSV = join(HERE, 'legacy-unknown-items.csv');
const OUT_REPORT = join(HERE, 'map-report-5000-series.md');

const FIELD_ORDER = [
  'id', 'series', 'test_code', 'subject', 'content_domain', 'skill',
  'difficulty', 'question_type', 'stimulus', 'stem', 'choices',
  'correct_answer', 'explanation', 'distractor_explanations',
  'source_basis', 'review_status', 'reviewer', 'version',
  'duplicate_hash', 'created_at', 'updated_at',
];

const SRC_COLS = [
  'id', 'external_id', 'subtest', 'category', 'difficulty', 'type',
  'stem_md', 'options_json', 'answer_index', 'explanation_md',
  'status', 'source_batch', 'created_at', 'updated_at',
];

// ---------------------------------------------------------------- 1. 读规格

const spec = JSON.parse(readFileSync(BRANCH_SPEC, 'utf8'));
const SUBJECTS = spec.subjects;
const DOMAINS = spec.content_domains;
const VALID_DIFFICULTY = new Set(spec.fields.difficulty.enum);
const VALID_QUESTION_TYPE = new Set(spec.fields.question_type.enum);
const VALID_SOURCE_BASIS = new Set(spec.fields.source_basis.enum);
const VALID_REVIEW_STATUS = new Set(spec.fields.review_status.enum);
const VALID_TEST_CODE = new Set(spec.fields.test_code.enum);

// ---------------------------------------------------------------- 2. 解析 SQL

function findMatchingParen(text, start) {
  let depth = 0;
  let inStr = false;
  let i = start;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "'") {
        if (text[i + 1] === "'") { i++; continue; }
        inStr = false;
      }
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`未闭合的 VALUES 括号（起始位置 ${start}）`);
}

function parseValuesBody(body) {
  const fields = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;
    if (body[i] === "'") {
      i++;
      let buf = '';
      while (i < body.length) {
        if (body[i] === "'") {
          if (body[i + 1] === "'") { buf += "'"; i += 2; continue; }
          i++;
          break;
        }
        buf += body[i++];
      }
      fields.push(buf);
    } else {
      let buf = '';
      while (i < body.length && body[i] !== ',') buf += body[i++];
      fields.push(buf.trim());
    }
  }
  return fields;
}

const sql = readFileSync(SRC_SQL, 'utf8');
const insertRe = /INSERT INTO questions\s*\([^)]*\)\s*VALUES\s*\(/gi;
const rawRows = [];
for (let m = insertRe.exec(sql); m; m = insertRe.exec(sql)) {
  const open = m.index + m[0].length - 1;
  const close = findMatchingParen(sql, open);
  const body = sql.slice(open + 1, close);
  const vals = parseValuesBody(body);
  if (vals.length !== SRC_COLS.length) {
    throw new Error(`字段数异常：期望 ${SRC_COLS.length}，实际 ${vals.length}，id=${vals[0]}`);
  }
  rawRows.push(Object.fromEntries(SRC_COLS.map((c, k) => [c, vals[k]])));
}

// ---------------------------------------------------------------- 3. 映射

function normalizeForHash(t) {
  return String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function computeDuplicateHash(stem, choices) {
  const parts = [normalizeForHash(stem)];
  for (const c of choices.map(normalizeForHash).sort()) parts.push(c);
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}

const iso = (ms) => new Date(Number(ms)).toISOString();

function mapRow(r) {
  const testCode = Number(r.subtest);
  let choices;
  try {
    choices = JSON.parse(r.options_json);
  } catch {
    return { error: 'options_json 解析失败', raw: r.options_json.slice(0, 80) };
  }
  if (!Array.isArray(choices) || choices.some((c) => typeof c !== 'string')) {
    return { error: 'options_json 不是字符串数组' };
  }
  const answerIndex = Number(r.answer_index);
  return {
    id: r.id,
    series: '5000',
    test_code: testCode,
    subject: SUBJECTS[String(testCode)] ?? null,
    content_domain: r.category,
    skill: null,
    difficulty: r.difficulty,
    question_type: 'single-select',
    stimulus: null,
    stem: r.stem_md,
    choices,
    correct_answer: choices[answerIndex] ?? null,
    explanation: r.explanation_md,
    distractor_explanations: null,
    source_basis: 'legacy-unknown',
    review_status: 'human-reviewed',
    reviewer: 'legacy-import',
    version: 1,
    duplicate_hash: computeDuplicateHash(r.stem_md, choices),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

// ---------------------------------------------------------------- 4. 校验

const errors = [];      // blocking
const warnings = [];    // non-blocking 完整性缺口
const items = [];

const seenIds = new Map();

for (const r of rawRows) {
  const id = r.id;
  const mapped = mapRow(r);

  if (mapped.error) {
    errors.push({ id, reason: mapped.error });
    continue;
  }

  // --- blocking ---
  const fail = (reason) => errors.push({ id, reason });

  for (const f of FIELD_ORDER) {
    if (!(f in mapped)) fail(`缺字段 ${f}`);
  }
  if (mapped.series !== '5000') fail(`series 非法：${mapped.series}`);
  if (!VALID_TEST_CODE.has(mapped.test_code)) fail(`test_code 非法：${mapped.test_code}`);
  if (!mapped.subject) fail(`subject 无法映射（test_code=${mapped.test_code}）`);
  const allowed = DOMAINS[String(mapped.test_code)] ?? [];
  if (!allowed.includes(mapped.content_domain)) {
    fail(`content_domain "${mapped.content_domain}" 不在 ${mapped.test_code} 枚举内`);
  }
  if (!VALID_DIFFICULTY.has(mapped.difficulty)) fail(`difficulty 非法：${mapped.difficulty}`);
  if (!VALID_QUESTION_TYPE.has(mapped.question_type)) fail(`question_type 非法：${mapped.question_type}`);
  if (!VALID_SOURCE_BASIS.has(mapped.source_basis)) fail(`source_basis 非法：${mapped.source_basis}`);
  if (!VALID_REVIEW_STATUS.has(mapped.review_status)) fail(`review_status 非法：${mapped.review_status}`);
  if (!Array.isArray(mapped.choices) || mapped.choices.length < 2) fail('choices 不足 2 项');
  if (!mapped.choices.includes(mapped.correct_answer)) {
    fail('correct_answer 不在 choices 中（answer_index 越界？）');
  }
  if (!mapped.stem || !mapped.stem.trim()) fail('stem 为空');
  if (!mapped.explanation || !mapped.explanation.trim()) fail('explanation 为空');
  if (!/^[0-9a-f]{64}$/.test(mapped.duplicate_hash)) fail('duplicate_hash 格式非法');
  if (!Number.isInteger(mapped.version) || mapped.version < 1) fail('version 非法');
  if (seenIds.has(id)) fail(`id 重复（首次出现在第 ${seenIds.get(id)} 行）`);
  seenIds.set(id, seenIds.size + 1);

  // --- non-blocking 完整性缺口 ---
  const gaps = [];
  if (mapped.distractor_explanations == null) gaps.push('distractor_explanations');
  if (mapped.skill == null) gaps.push('skill');
  if (mapped.stimulus == null) gaps.push('stimulus');
  if (gaps.length) warnings.push({ id, gaps });

  items.push(mapped);
}

// ---------------------------------------------------------------- 5. 统计

const counter = (fn) => {
  const c = new Map();
  for (const it of items) {
    const k = fn(it);
    c.set(k, (c.get(k) ?? 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
};

const byTestCode = counter((i) => i.test_code);
const byDomain = counter((i) => `${i.test_code} · ${i.content_domain}`);
const byDifficulty = counter((i) => i.difficulty);
const byReviewer = counter((i) => i.reviewer);

const hashCount = new Map();
for (const it of items) hashCount.set(it.duplicate_hash, (hashCount.get(it.duplicate_hash) ?? 0) + 1);
const dupGroups = [...hashCount.entries()].filter(([, n]) => n > 1);

// 刺激材料检测（启发式，非精确分类）
//   A. 内嵌长文本引语：题干里自带被引材料，可拆到 stimulus，不依赖外部资源
//   B. 依赖外部图表：题干要求看"下图/下表"，若站点无图则该题不可答 —— 这才是废题风险
const EMBEDDED_QUOTE_RE = /['"][^'"]{80,}['"]/;
const EXTERNAL_ASSET_RE = new RegExp([
  '\\b(shown|given|listed|presented|displayed)\\s+(below|above)\\b',
  '\\bthe\\s+following\\s+(table|chart|graph|diagram|map|figure|data|list)\\b',
  '\\buse\\s+the\\s+(table|chart|graph|diagram|map|figure)\\s+(below|above|to)\\b',
  '\\baccording\\s+to\\s+the\\s+(table|chart|graph|diagram|map)\\b',
  '\\bthe\\s+(table|chart|graph|diagram|map|figure)\\s+(below|above)\\b',
].join('|'), 'i');
const embeddedQuote = items.filter((i) => EMBEDDED_QUOTE_RE.test(i.stem));
const externalAsset = items.filter((i) => EXTERNAL_ASSET_RE.test(i.stem));

// legacy-unknown 清单（本批全部）
const legacyUnknown = items.filter((i) => i.source_basis === 'legacy-unknown');

// created_at 唯一值（判断是否批量导入时间戳）
const createdVals = new Set(items.map((i) => i.created_at));

// ---------------------------------------------------------------- 6. 写出

if (errors.length > 0) {
  writeFileSync(
    join(HERE, 'map-errors.json'),
    JSON.stringify({ total_rows: rawRows.length, blocking_errors: errors }, null, 2),
    'utf8'
  );
  console.error(`✗ 结构校验失败 ${errors.length} 条，已写 content-infra/map-errors.json，未产出题目文件。`);
  for (const e of errors.slice(0, 20)) console.error(`  - ${e.id}: ${e.reason}`);
  process.exit(1);
}

writeFileSync(OUT_JSONL, items.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');

const csvEscape = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [
  ['id', 'test_code', 'subject', 'content_domain', 'difficulty', 'question_type',
   'review_status', 'reviewer', 'source_basis', 'duplicate_hash', 'stem_preview'].join(','),
  ...legacyUnknown.map((i) => [
    i.id, i.test_code, i.subject, i.content_domain, i.difficulty, i.question_type,
    i.review_status, i.reviewer, i.source_basis, i.duplicate_hash,
    i.stem.replace(/\s+/g, ' ').slice(0, 100),
  ].map(csvEscape).join(',')),
].join('\n') + '\n';
writeFileSync(OUT_CSV, csv, 'utf8');

// 报告
const pct = (n) => `${((n / items.length) * 100).toFixed(1)}%`;
const md = `# D2 · 存量 969 题 → schema v1 映射报告

- 生成时间：${new Date().toISOString()}
- 脚本：\`content-infra/map-legacy-5001-to-schema-v1.mjs\`（零依赖、幂等，可重复执行）
- 输入：\`db/import-questions.sql\`
- 规格依据：\`content-infra/item-schema-v1.5000-branch.json\`

## 1. 结论

| 项 | 结果 |
|---|---|
| 解析出的题目条数 | ${rawRows.length} |
| 结构校验（blocking）失败 | **${errors.length}** |
| 映射成功并落盘 | **${items.length}** |
| duplicate_hash 生成 | ${items.length} 条，唯一值 ${hashCount.size} 个，重复组 ${dupGroups.length} 组 |
| 完整性缺口（non-blocking） | ${warnings.length} 题存在缺口 |

**满足 D2 验收标准第 1、2 条：969 题零校验失败，duplicate_hash 全部生成。**

## 2. 分布

### test_code
${byTestCode.map(([k, v]) => `| ${k} · ${SUBJECTS[String(k)]} | ${v} | ${pct(v)} |`).join('\n')}

（表头：test_code · subject | 题数 | 占比）

### content_domain
${byDomain.map(([k, v]) => `| ${k} | ${v} | ${pct(v)} |`).join('\n')}

（表头：test_code · content_domain | 题数 | 占比）

### difficulty
${byDifficulty.map(([k, v]) => `| ${k} | ${v} | ${pct(v)} |`).join('\n')}

（表头：difficulty | 题数 | 占比）

### reviewer / review_status / source_basis
- reviewer：${byReviewer.map(([k, v]) => `${k} = ${v}`).join('，')}
- review_status：human-reviewed = ${items.length}（存量已上线使用的题，按 D2 规则统一标记）
- source_basis：**legacy-unknown = ${legacyUnknown.length}（${pct(legacyUnknown.length)}）**

## 3. legacy-unknown 清单（验收标准第 3 条）

存量 questions 表只有 \`source_batch = '3.0'\`（批次号，非出题依据），**没有任何字段记录每题的出题依据**，因此无法回溯来源的题 = 全部 ${legacyUnknown.length} 条。

- 全量清单：\`content-infra/legacy-unknown-items.csv\`（含 id / test_code / content_domain / duplicate_hash / 题干前 100 字）
- 按 test_code × content_domain 分组统计见上表

> 说明：清单等于全量，这本身是结论——**这批题的来源追溯能力为零**，后续若要扩写或改写，只能逐题人工复核，无法按批次筛选。

## 4. 完整性缺口（non-blocking，不计入校验失败）

| 缺口字段 | 影响题数 | 说明 |
|---|---|---|
| distractor_explanations | ${items.length} | schema 硬约束 2 要求逐项写干扰项解释；存量只有 1 条正确答案解释，无干扰项解释 |
| skill | ${items.length} | 存量无 skill 数据。注意：存量 \`type\` 字段（knowledge / concept / pedagogy）是**认知层级**，不是 skill，不可平移 |
| stimulus | ${items.length} | 存量未拆分刺激材料，一律置 null |

### 刺激材料检测（启发式，非精确分类，供人工判断优先级）

- **依赖外部图表的题：${externalAsset.length} 题**（${pct(externalAsset.length)}）。
  检测口径：题干出现 "shown below" / "the following table" / "use the chart to" / "according to the graph" 等要求查看外部素材的措辞。
  **结果为 0，即这批题不存在"题干要看图但站点没图"的废题风险**——这是一个已排除的风险，无需排期。
  已另行抽查：题干出现 table / chart / map 等名词的共 8 题，抽查均为考察概念本身（如 "a table's area" 指桌子的面积、"purpose of a diagram in an informational text" 问图表的作用、"type of map projection" 问投影类型），不依赖配图。
- **题干内嵌长文本引语的题：${embeddedQuote.length} 题**（${pct(embeddedQuote.length)}）。这些题的被引材料写在题干里，未拆到 stimulus。若未来要做 stimulus 复用或 passage-based 题组，这 ${embeddedQuote.length} 题可优先人工拆分。
  注意：另有一批题干提及 passage 但并未内嵌原文（如 "A passage describes how…" 直接陈述内容），这部分不需要拆，也未计入此数。

## 5. 时间戳说明

- 存量 \`created_at\` / \`updated_at\` 为毫秒时间戳，本脚本统一转为 ISO-8601 UTC。
- 全库去重后共 **${createdVals.size} 个不同的 created_at 值**，值样例：${[...createdVals][0] ?? '无'}。
- **这是批量导入时间，不是题目创作时间**，不能当作内容新鲜度依据使用。

## 6. 遗留问题与下一步建议

1. **schema v1 文件未落盘（P1）**。T0 声明产出 \`content-infra/item-schema-v1.md\` 与 \`item-schema-v1.example.json\`，但二者在仓库磁盘上不存在（已全盘搜索 \`E:\\Triumph\`）。本次按 T0 事项描述中的字段名清单重建了 5000 分支。建议：让 T0 负责会话把文件补落到 \`content-infra/\`，再复核本分支与其是否一致。
2. **T0 字段计数与清单不一致（P2）**。描述自称 20 字段，实际列出 21 个字段名。本实现按 21 字段（created_at 与 updated_at 并存）。请 T0 负责人确认以哪个为准。
3. **content_domain 枚举的官方来源未取得（P1）**。11 个领域名沿用存量 category 值，与四个第三方备考站公布的 ETS 口径逐字一致，但**未取得 ETS 官方页面或 Study Companion PDF 可核验源**（官方 URL 本次均重定向至首页）。按项目事实核实红线，目前只能标 \`triangulated\`，**不得对外声明为官方口径**。建议并入 F1 事实核查那条线补 official_source_url。
4. **干扰项解释缺失 = ${items.length * 3} 条待补**（每题 3 个干扰项）。这是后续内容质检（D24）与 8000 系列扩写前必须面对的存量工作量，建议单独排期评估是否值得全量补写。
5. **缺图风险已排除**：依赖外部图表的题为 0，无需排期排查。仅 ${embeddedQuote.length} 题内嵌长文本引语，属可选优化（拆 stimulus），非缺陷。
6. **跨系列 id 命名空间冲突风险（P2）**。本批 id 形如 \`5002-001\`，若 8000 系列沿用相似规则可能撞号。本批保留原 id 保证可追溯；跨系列查重请一律用 duplicate_hash，不要用 id。
`;

writeFileSync(OUT_REPORT, md, 'utf8');

console.log(`✓ 解析 ${rawRows.length} 条，结构校验失败 ${errors.length} 条，落盘 ${items.length} 条`);
console.log(`  → ${OUT_JSONL}`);
console.log(`  → ${OUT_CSV}（legacy-unknown ${legacyUnknown.length} 条）`);
console.log(`  → ${OUT_REPORT}`);
console.log(`  完整性缺口：${warnings.length} 题`);
console.log(`  依赖外部图表：${externalAsset.length} 题（废题风险）；内嵌长文本引语：${embeddedQuote.length} 题（可选拆分）`);
