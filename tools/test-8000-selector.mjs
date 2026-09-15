#!/usr/bin/env node
/**
 * tools/test-8000-selector.mjs — D13 自测：迁移枢纽页 (praxis-5001-vs-8000-series) 的
 * 「Which test should I take?」选择器。
 *
 * 为什么需要这个脚本
 * ------------------
 * 选择器是纯前端内联 JS：构建期不报错，`node --test test/*.mjs` 也跑不到它。它有两种致命的
 * 失败模式，两种都不会在构建期暴露：
 *   1) 某个输入组合下输出空白 —— 考生点完看到一个空框，功能等于不存在；
 *   2) 输出滑向「你就该考 X」这种绝对结论 —— 各州要求不同，这会让人花 $79 报错考试。
 * 所以这里用**假 DOM 跑页面里真实的那段内联脚本**（不是另抄一份逻辑，抄一份就等于没测），
 * 对全部下拉选项的交叉组合断言上面两件事都不发生。
 *
 * 覆盖：
 *   A 选择器行为：全组合非空白 / 不给绝对结论 / 不泄露与所选州无关的合格分 / 不出现被证伪数据
 *   B 页面结构：五科映射表内链、州状态表 6 列、三个 CTA、dateModified、无 JS 时的静态兜底文案
 *   C 不变量：TDK 逐字未变、基线每一行都还在（只做加法）—— 需要 git 能读到基线，读不到则跳过
 *
 * 用法：node tools/test-8000-selector.mjs        （或 node --test tools/test-8000-selector.mjs）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = ROOT + 'site/praxis-5001-vs-8000-series.html';
const REL = 'site/praxis-5001-vs-8000-series.html';

const html = readFileSync(PAGE, 'utf8');

/* ---------- 1. 取出页面里真实的内联选择器脚本，用假 DOM 执行 ---------- */

function extractSelectorScript(src) {
  const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const hit = blocks.filter((b) => b.includes('ld-which-test'));
  assert.equal(hit.length, 1, '页面上应恰好有一段带 ld-which-test 标记的内联脚本');
  return hit[0];
}

function makeEl(id) {
  const handlers = Object.create(null);
  return {
    id,
    value: '',
    innerHTML: '',
    addEventListener(type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },
    fire(type, ev) {
      for (const fn of handlers[type] || []) fn(ev || { preventDefault() {} });
    },
  };
}

function bootSelector() {
  const ids = [
    'ld-which-test-form',
    'ld-wt-out',
    'ld-wt-state',
    'ld-wt-program',
    'ld-wt-date',
    'ld-wt-code',
  ];
  const els = new Map(ids.map((id) => [id, makeEl(id)]));
  const doc = {
    readyState: 'complete',
    addEventListener() {},
    getElementById: (id) => els.get(id) || null,
  };
  const sandbox = { document: doc, console };
  sandbox.window = sandbox;
  vm.runInNewContext(extractSelectorScript(html), sandbox, { filename: 'ld-which-test.js' });
  assert.ok(sandbox.LDWhichTest, '脚本应挂出 window.LDWhichTest');
  return { LD: sandbox.LDWhichTest, els, doc };
}

const { LD, els } = bootSelector();

/* ---------- 2. 从页面 markup 里读出下拉选项，用「UI 真实提供的值」做网格 ---------- */

function optionsOf(selectId) {
  const m = html.match(new RegExp(`<select id="${selectId}">([\\s\\S]*?)</select>`));
  assert.ok(m, `页面应有 <select id="${selectId}">`);
  const opts = [...m[1].matchAll(/<option value="([^"]*)"/g)].map((x) => x[1]);
  assert.ok(opts.length >= 4, `${selectId} 选项太少：${opts.length}`);
  assert.equal(new Set(opts).size, opts.length, `${selectId} 有重复 option value`);
  return opts;
}

const STATE_OPTS = optionsOf('ld-wt-state');
const PROGRAM_OPTS = optionsOf('ld-wt-program');
const CODE_OPTS = optionsOf('ld-wt-code');
// 日期是 <input type="date">，没有 option 列表；这里覆盖空值 + 各关键分界点前后
const DATE_OPTS = ['', '2026-10-15', '2027-06-01', '2027-09-01', '2028-07-31', '2028-08-01', '2029-03-10'];

const plain = (h) =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/\s+/g, ' ')
    .trim();

const combos = [];
for (const state of STATE_OPTS)
  for (const program of PROGRAM_OPTS)
    for (const date of DATE_OPTS)
      for (const code of CODE_OPTS) combos.push({ state, program, date, code });

/* ---------- A. 选择器行为 ---------- */

test('A1 全部输入组合都不空白：有状态、有结论引导、至少两条要核实的动作、有免责声明', () => {
  assert.ok(combos.length > 1000, `组合数应足够大，实际 ${combos.length}`);
  const bad = [];
  for (const input of combos) {
    const m = LD.guidance(input);
    const out = plain(LD.html(m));
    const why = [];
    if (!m.status || !m.status.trim()) why.push('status 空');
    if (!m.headline || m.headline.trim().length < 20) why.push('headline 太短');
    if (!Array.isArray(m.checks) || m.checks.length < 2) why.push('checks 少于 2 条');
    if (m.checks.some((c) => !c || !c.trim())) why.push('checks 有空项');
    if (!m.closing || !m.closing.trim()) why.push('closing 空');
    if (out.length < 300) why.push(`渲染文本过短(${out.length})`);
    if (!out.includes('What to verify')) why.push('没有「要核实什么」的标题');
    if (!/<ul class="checklist">/.test(LD.html(m))) why.push('动作列表没渲染出来');
    if (why.length) bad.push({ input, why });
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length}/${combos.length} 个组合输出不合格`);
});

test('A2 每一档输出都给绝对结论吗？不 —— 每档都必须带「不能替你决定」的免责声明', () => {
  const missing = [];
  for (const input of combos) {
    const out = plain(LD.html(LD.guidance(input)));
    if (!out.includes('cannot tell you which test you must register for')) missing.push(input);
  }
  assert.deepEqual(missing.slice(0, 5), [], `${missing.length} 档输出缺少免责声明`);
});

test('A3 全部输出不得出现「你一定该考 X」这类绝对结论', () => {
  const forbidden = [
    [/you should (?:take|register|book|sign up)/i, '给出「你应该考」的断言'],
    [
      /you (?:must|need to|have to) (?:take|book|register for) (?:8002|8003|8004|8005|8006|5001|5002|5003|5004|5005)/i,
      '用 must/need to 直接指定考哪一科',
    ],
    [/the (?:only )?test for you is/i, '「你的唯一考试是」'],
    [/your (?:state|program) requires (?:the )?\d{4}/i, '断言该州/项目要求某个代码'],
    [/\bdefinitely\b/i, 'definitely'],
    [/\bguaranteed?\b/i, 'guaranteed'],
    [/the answer is \d{4}/i, '把代码说成答案'],
  ];
  const hits = [];
  for (const input of combos) {
    const out = plain(LD.html(LD.guidance(input)));
    for (const [re, label] of forbidden) {
      if (re.test(out)) hits.push({ input, label, sample: out.match(re)[0] });
    }
  }
  assert.deepEqual(hits.slice(0, 5), [], `${hits.length} 处出现绝对结论`);
});

test('A4 不出现被证伪的第三方说法（100–300 尺度 / 合格分 240）', () => {
  const hits = [];
  for (const input of combos) {
    const out = plain(LD.html(LD.guidance(input)));
    if (/(?<!\d)240(?!\d)/.test(out)) hits.push({ input, why: '出现 240' });
    if (/100[\u2013-]300/.test(out)) hits.push({ input, why: '出现 100-300 尺度' });
  }
  assert.deepEqual(hits.slice(0, 5), [], `${hits.length} 处出现错误信息`);
});

test('A5 未核实州：只说 Not verified，且不泄露与所选州无关的合格分', () => {
  const unverified = STATE_OPTS.filter((s) => s !== 'West Virginia' && s !== 'Arkansas');
  assert.ok(unverified.length >= 50, `未核实州应≥50（含「未选州」「其他州」两档），实际 ${unverified.length}`);
  const bad = [];
  for (const state of unverified) {
    const named = state && state !== 'Other';
    for (const program of PROGRAM_OPTS) {
      for (const date of DATE_OPTS) {
        for (const code of CODE_OPTS) {
          const out = plain(LD.html(LD.guidance({ state, program, date, code })));
          if (/Adoption status[^.]*: Confirmed/i.test(out)) bad.push({ state, why: '被标成 Confirmed' });
          // 没选州 = 信息不足；选了未核实州/其他州 = 必须写 Not verified。两种都不得沉默
          const ok = named ? /not verified/i.test(out) : /not enough information|not verified/i.test(out);
          if (!ok) bad.push({ state, why: '既没说 Not verified 也没说信息不足' });
          const leak = out.match(/\b(152|147|143|137|136|130|126)\b/);
          if (leak) bad.push({ state, why: `泄露了别州合格分 ${leak[0]}` });
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} 处问题`);
});

test('A6 West Virginia / Arkansas：只给官方确认过的事实（合格分、8006 未采用、AR 过渡窗口）', () => {
  const wv = plain(LD.html(LD.guidance({ state: 'West Virginia', program: '5000', date: '2026-10-15', code: 'both' })));
  assert.match(wv, /Confirmed/);
  for (const v of ['152', '147', '143', '5205', '8006']) assert.ok(wv.includes(v), `WV 输出应含 ${v}`);

  const ar = plain(LD.html(LD.guidance({ state: 'Arkansas', program: '5000', date: '2026-10-15', code: '8000' })));
  assert.match(ar, /Confirmed/);
  for (const v of ['137', '136', '130', '126', '2027', '2031']) assert.ok(ar.includes(v), `AR 输出应含 ${v}`);

  // AR + 晚于 2027-08-31 的日期 → 必须提示那次窗口结束
  const late = plain(LD.html(LD.guidance({ state: 'Arkansas', program: '', date: '2027-09-01', code: '' })));
  assert.match(late, /after September 1, 2027/);

  // 同一日期在别州不得出现 AR 专属提示
  const other = plain(LD.html(LD.guidance({ state: 'Ohio', program: '', date: '2027-09-01', code: '' })));
  assert.ok(!other.includes('after September 1, 2027'), 'AR 专属窗口提示不该出现在俄亥俄');
});

test('A7 旧系列退役分界：2028-08 前后给不同引导', () => {
  const before = plain(LD.html(LD.guidance({ state: 'Ohio', program: '', date: '2028-07-31', code: '' })));
  const after = plain(LD.html(LD.guidance({ state: 'Ohio', program: '', date: '2028-08-01', code: '' })));
  assert.match(before, /before the published retirement target/);
  assert.match(after, /at or after the published retirement target/);
  assert.notEqual(before, after);
});

test('A8 空输入 / 脏输入不崩、不空白', () => {
  for (const input of [undefined, null, {}, { state: null, program: 5, date: {}, code: [] }]) {
    const m = LD.guidance(input);
    const out = plain(LD.html(m));
    assert.ok(out.length > 300, `输入 ${JSON.stringify(input)} 输出过短`);
    assert.match(out, /Choose the state|Not verified/);
  }
  // 非法日期字符串按「未填写」处理，不把原文回显进页面
  const junk = plain(LD.html(LD.guidance({ state: 'Ohio', date: '<img src=x onerror=alert(1)>', code: '' })));
  assert.ok(!junk.includes('onerror'), '非法日期不得回显');
  assert.ok(!junk.includes('<img'), '非法日期不得回显成标签');
});

test('A9 表单绑定：下拉变化 → 结果区被填上，且提交不会真的跳走', () => {
  const form = els.get('ld-which-test-form');
  const out = els.get('ld-wt-out');
  els.get('ld-wt-state').value = 'West Virginia';
  els.get('ld-wt-program').value = '8000';
  els.get('ld-wt-date').value = '2026-11-20';
  els.get('ld-wt-code').value = '8000';
  assert.equal(out.innerHTML, '', '绑定前结果区应是空的（由页面静态兜底文案承担）');
  let prevented = false;
  form.fire('submit', { preventDefault: () => { prevented = true; } });
  assert.ok(prevented, 'submit 必须 preventDefault，否则整页刷新');
  assert.ok(out.innerHTML.includes('152'), '结果区应被写入 WV 的合格分');
  assert.ok(out.innerHTML.includes('West Virginia'));
  // 换成未核实州，结果区应被覆盖
  els.get('ld-wt-state').value = 'Ohio';
  els.get('ld-wt-code').value = '';
  form.fire('submit');
  assert.ok(out.innerHTML.includes('Not verified'));
  assert.ok(!out.innerHTML.includes('152'), '结果区应被整块替换，不残留上一州数据');
});

test('A10 关掉 JS 也不空白：结果区有静态兜底文案，且全文给出人工核实路径', () => {
  const m = html.match(/<div class="verdict" id="ld-wt-out" aria-live="polite">([\s\S]*?)<\/div>/);
  assert.ok(m, '应有结果容器 #ld-wt-out');
  const fallback = plain(m[1]);
  assert.ok(fallback.length > 80, `兜底文案太短：${fallback.length}`);
  assert.match(fallback, /verify|Choose your state/i);
  assert.ok(html.includes('https://praxis.ets.org/state-requirements.html'), '页面上要给出 ETS 州要求目录');
});

/* ---------- B. 页面结构 ---------- */

test('B1 五科映射表把五个新页面全部链上（内容页 + 练习页）', () => {
  const guides = [
    '/praxis-8002-reading-and-language-arts',
    '/praxis-8003-mathematics',
    '/praxis-8004-social-studies',
    '/praxis-8005-science',
    '/praxis-8006-teaching-reading',
  ];
  const practices = [
    '/praxis-8002-practice',
    '/praxis-8003-practice',
    '/praxis-8004-practice',
    '/praxis-8005-practice',
    '/praxis-8006-practice',
  ];
  for (const href of [...guides, ...practices]) {
    assert.ok(html.includes(`href="${href}"`), `缺内链 ${href}`);
  }
  // 映射表本体：五行、代码与内容领域逐字对得上
  const table = html.match(/<h2 id="five-8000-series-tests">[\s\S]*?<\/table>/);
  assert.ok(table, '应有五科映射表（id=five-8000-series-tests）');
  const rows = [...table[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => plain(r[1]));
  assert.equal(rows.length, 6, '映射表应为 1 行表头 + 5 行数据');
  const expected = [
    ['Reading and Language Arts', '8002'],
    ['Mathematics', '8003'],
    ['Social Studies', '8004'],
    ['Science', '8005'],
    ['Teaching Reading', '8006'],
  ];
  expected.forEach(([area, code], i) => {
    assert.ok(rows[i + 1].includes(area), `第 ${i + 1} 行缺 ${area}`);
    assert.ok(rows[i + 1].includes(code), `第 ${i + 1} 行缺代码 ${code}`);
  });
});

test('B2 州采用状态表：6 列齐全，只有 WV/AR 是 Confirmed，其余 48 州合并为 Not verified', () => {
  const m = html.match(/<h2 id="state-adoption-status">[\s\S]*?<\/table>/);
  assert.ok(m, '应有州采用状态表（id=state-adoption-status）');
  const head = [...m[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((x) => plain(x[1]));
  assert.deepEqual(head, ['State', 'Accepted code', 'Effective date', 'Official source', 'Last checked', 'Status']);
  const body = m[0].match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
    [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => plain(c[1]))
  );
  assert.equal(rows.length, 3, '应只有 3 行：WV、AR、其余合并行');
  assert.equal(rows[0][0], 'West Virginia');
  assert.equal(rows[0][5], 'Confirmed');
  assert.match(rows[0][1], /8002.*8003.*8004.*8005/);
  assert.match(rows[1][0], /Arkansas/);
  assert.equal(rows[1][5], 'Confirmed');
  assert.equal(rows[2][5], 'Not verified');
  assert.match(rows[2][0], /Other states/);
  assert.match(rows[2][1], /^Not verified$/);
  assert.match(rows[2][2], /^Not verified$/);
  // 官方来源必须真的指到 ETS 州页 / 目录
  assert.ok(m[0].includes('https://praxis.ets.org/state-requirements/westvirginia-tests.html'));
  assert.ok(m[0].includes('https://praxis.ets.org/state-requirements/arkansas-tests.html'));
  assert.ok(m[0].includes('https://praxis.ets.org/state-requirements.html'));
  // 逐字：不得给另外 48 州编造行或把 Not verified 写成事实
  assert.ok(!/Transition/.test(m[0]) || /not currently mark any state as being in transition/.test(html));
});

test('B3 三个 CTA 文案齐全，且指向本页锚点 / 真实存在的页面', () => {
  assert.ok(html.includes('Check the five new tests'), '缺 CTA 1');
  assert.ok(html.includes('Take a free 8000-series readiness check'), '缺 CTA 2');
  assert.ok(html.includes('Compare your current test code'), '缺 CTA 3');
  assert.ok(html.includes('href="#five-8000-series-tests"'));
  assert.ok(html.includes('href="#which-test-selector"'));
  assert.ok(html.includes('id="which-test-selector"'));
});

test('B4 结构化数据仍是合法 JSON，dateModified 与可见核验日期一致（2026-09-15）', () => {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 1, '应有 JSON-LD');
  const parsed = blocks.map((b) => JSON.parse(b.trim()));
  const article = parsed.find((p) => p['@type'] === 'Article');
  assert.ok(article, 'Article 结构化数据应保留且可解析');
  assert.equal(article.dateModified, '2026-09-15');
  assert.equal(article.datePublished, '2026-08-20', 'datePublished 不应被改动');
  assert.equal(article.mainEntityOfPage, 'https://learndiag.com/praxis-5001-vs-8000-series');
  assert.equal(parsed.filter((p) => p['@type'] === 'FAQPage').length, 0, '本页原本没有 FAQPage，不要新增未展示的标记');
  assert.ok(html.includes('Last verified 2026-09-15'), '要有可见的最后核验日期');
});

/* ---------- C. 只做加法 + TDK 未变（需要 git 能读到基线） ---------- */

function baseline() {
  try {
    return execFileSync('git', ['show', `HEAD:${REL}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    return null;
  }
}

const base = baseline();

test('C1 TDK 逐字未变（title / meta description / h1）', (t) => {
  if (!base) return t.skip('读不到 git 基线，跳过（请在仓库内运行）');
  const grab = (src, re) => (src.match(re) || [])[0] || '';
  const h1 = /<h1[^>]*>[\s\S]*?<\/h1>/;
  const title = /<title>[\s\S]*?<\/title>/;
  const desc = /<meta name="description"[^>]*>/;
  assert.equal(grab(html, title), grab(base, title), 'title 被改动了');
  assert.equal(grab(html, desc), grab(base, desc), 'meta description 被改动了');
  assert.equal(grab(html, h1), grab(base, h1), 'h1 被改动了');
  // og / twitter 也不该动
  for (const re of [/<meta property="og:title"[^>]*>/, /<meta name="twitter:title"[^>]*>/]) {
    assert.equal(grab(html, re), grab(base, re));
  }
});

test('C2 只做加法：基线每一行都还在（唯一允许的例外是 dateModified）', (t) => {
  if (!base) return t.skip('读不到 git 基线，跳过（请在仓库内运行）');
  const now = new Set(html.split('\n').map((l) => l.trimEnd()));
  const missing = base
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length && !l.includes('"dateModified"'))
    .filter((l) => !now.has(l));
  assert.deepEqual(missing.slice(0, 5), [], `${missing.length} 行原内容消失或被改写`);
});

test('C3 基线里的内链一个没少', (t) => {
  if (!base) return t.skip('读不到 git 基线，跳过（请在仓库内运行）');
  const links = (src) => new Set([...src.matchAll(/href="([^"]+)"/g)].map((m) => m[1]));
  const before = links(base);
  const after = links(html);
  const gone = [...before].filter((h) => !after.has(h));
  assert.deepEqual(gone, [], '原有内链被删或被改写');
  assert.ok(after.size > before.size, '内链数应增加');
});
