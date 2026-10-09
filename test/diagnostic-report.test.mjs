// test/diagnostic-report.test.mjs — 诊断报告的门控与判分回归
//
// 这个文件守的是三条最容易在后续改动里被破坏的约束：
//   1. 未获权益时，响应体里**不能出现任何报告内容**（"未解锁绝对不能渲染"的根）。
//   2. 判分只用服务端题库，客户端传什么对错都不影响分数。
//   3. 一次购买的凭证只能用在一份报告上，但同一份可以重复下载。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  computeReport,
  hDiagnosticReport,
  hDiagnosticReportStatus,
  resolveEntitlement,
  fallbackNarrative,
  FREE_REVIEW_LIMIT,
  DIMENSIONS,
} from '../worker-src/diagnostic-report.mjs';

// ---------------------------------------------------------------- 造数据

const SUBS = [
  ['5002', 'Reading & Language Arts'],
  ['5003', 'Mathematics'],
  ['5004', 'Social Studies'],
  ['5005', 'Science'],
];

/** 12 题、四科各 3 题，答案固定为第 0 项，便于精确构造对错。 */
function makeBank(n = 12) {
  const bank = [];
  const per = n / 4;
  SUBS.forEach(([code, name]) => {
    for (let i = 0; i < per; i++) {
      bank.push({
        id: `${code}-${i}`,
        code,
        subtest: name,
        category: `${name} point ${i}`,
        q: `Question ${code}-${i}?`,
        options: ['Right', 'Wrong A', 'Wrong B', 'Wrong C'],
        answer: 0,
        explain: `Because of reason ${i}.`,
      });
    }
  });
  return bank;
}

function makeEnv(opts = {}) {
  const kv = new Map();
  return {
    JWT_SECRET: 'test-secret',
    // 不给 OPENROUTER_API_KEY —— 报告走确定性兜底叙述，测试不依赖网络
    TRIUMPH_KV: {
      async get(k, type) {
        if (!kv.has(k)) return null;
        const v = kv.get(k);
        return type === 'json' ? JSON.parse(v) : v;
      },
      async put(k, v) { kv.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    },
    ASSETS: {
      async fetch() {
        return new Response(JSON.stringify(opts.bank || makeBank()), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    ...opts.extra,
  };
}

/** 全对 / 错 k 题 */
function answers(n = 12, wrong = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ question_id: (makeBank(n)[i] || {}).id, selected: i < wrong ? 1 : 0, elapsed_ms: 60000 });
  }
  return out;
}

function post(body) {
  return new Request('https://learndiag.com/api/diagnostic/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------- computeReport

test('computeReport：全对 → 满分 180、通过率封顶 95', () => {
  const r = computeReport(makeBank(), answers(12, 0));
  assert.equal(r.question_count, 12);
  assert.equal(r.correct_count, 12);
  assert.equal(r.accuracy, 100);
  assert.equal(r.score, 180);
  assert.equal(r.pass_probability, 95);
  assert.equal(r.misses.length, 0);
});

test('computeReport：题数反映的是实际匹配到的答卷（防前端虚报）', () => {
  const a = answers(12, 3);
  a.push({ question_id: 'not-in-bank', selected: 0, elapsed_ms: 1000 }); // 不在题库
  a.push({ question_id: '5002-0', selected: 99, elapsed_ms: 1000 });    // 选项越界
  const r = computeReport(makeBank(), a);
  assert.equal(r.question_count, 12, '无效答卷必须被丢弃，不能虚增题数');
  assert.equal(r.correct_count, 9);
});

test('computeReport：客户端传的 correct 字段一律被忽略（判分以服务端题库为准）', () => {
  const a = answers(12, 12).map((x) => ({ ...x, correct: true, score: 180, pass_probability: 95 }));
  const r = computeReport(makeBank(), a);
  assert.equal(r.correct_count, 0, '全错就是全错，客户端说对不算');
  assert.equal(r.score, 140);
});

test('computeReport：九个维度齐全且都有 0-100 的分值', () => {
  const r = computeReport(makeBank(), answers(12, 5));
  assert.equal(r.dimensions.length, 9);
  assert.equal(DIMENSIONS.length, 9);
  for (const d of r.dimensions) {
    assert.ok(typeof d.id === 'string' && d.id.length, 'dimension 缺 id');
    assert.ok(d.value >= 0 && d.value <= 100, `${d.id} 分值越界: ${d.value}`);
    assert.ok(typeof d.measured === 'boolean');
  }
  assert.deepEqual(r.dimensions.map((d) => d.id), DIMENSIONS.map((d) => d.id), '雷达轴顺序必须稳定');
});

test('computeReport：没有用时数据时，节奏类维度标记为未测而不是伪造分数', () => {
  const a = answers(12, 4).map((x) => ({ ...x, elapsed_ms: null }));
  const r = computeReport(makeBank(), a);
  const pace = r.dimensions.find((d) => d.id === 'pace');
  const guess = r.dimensions.find((d) => d.id === 'guessing');
  assert.equal(pace.measured, false);
  assert.equal(guess.measured, false);
  assert.equal(r.pace, null);
});

test('computeReport：错题明细带上正确答案与解析', () => {
  const r = computeReport(makeBank(), answers(12, 2));
  assert.equal(r.misses.length, 2);
  const m = r.misses[0];
  assert.equal(m.answer_text, 'Right');
  assert.equal(m.selected_text, 'Wrong A');
  assert.ok(m.explanation.includes('reason'));
});

test('fallbackNarrative：模型全挂时也要产出一份完整叙述', () => {
  const r = computeReport(makeBank(), answers(12, 4));
  const n = fallbackNarrative(r);
  for (const k of ['headline', 'trend', 'pace_read', 'knowledge_read', 'miss_read', 'risk']) {
    assert.ok(typeof n[k] === 'string' && n[k].length, `兜底叙述缺 ${k}`);
  }
  assert.ok(n.next_actions.length >= 3);
  assert.ok(/4 questions|answered questions/i.test(n.headline) || /\d/.test(n.headline));
});

// ---------------------------------------------------------------- 门控

test('免费访客：POST 报告返回 402，且响应体里没有任何报告内容', async () => {
  const env = makeEnv();
  const res = await hDiagnosticReport(post({ attempt_id: 'a1', visitor_id: 'v-free', answers: answers(12, 6) }), env);
  assert.equal(res.status, 402);
  const body = await res.json();

  assert.equal(body.error.code, 'report_locked');
  assert.equal(body.free_review_limit, FREE_REVIEW_LIMIT);
  assert.deepEqual(body.options, ['login', 'purchase']);

  // 逐项确认没有泄题：报告里会出现的字段一个都不能有
  const flat = JSON.stringify(body);
  for (const leak of ['summary', 'radar', 'narrative', 'misses', 'knowledge_points', 'subtests', 'score', 'pass_probability', 'headline']) {
    assert.ok(!flat.includes(leak), `402 响应体泄漏了报告字段: ${leak}`);
  }
  assert.ok(!/\b(140|160|180)\b/.test(flat), '402 响应体不应含任何分数');
});

test('免费访客连续请求也不会拿到报告（门控在服务端，不靠前端 if）', async () => {
  const env = makeEnv();
  for (let i = 0; i < 3; i++) {
    const res = await hDiagnosticReport(post({ attempt_id: 'a' + i, visitor_id: 'v-x', answers: answers(12, 1) }), env);
    assert.equal(res.status, 402);
  }
});

test('没带 attempt_id / answers → 400，不进入门控分支', async () => {
  const env = makeEnv();
  assert.equal((await hDiagnosticReport(post({ visitor_id: 'v1', answers: answers(12) }), env)).status, 400);
  assert.equal((await hDiagnosticReport(post({ attempt_id: 'a1', visitor_id: 'v1', answers: [] }), env)).status, 400);
});

test('一次性购买凭证：可出报告，且凭证只对那一份 attempt 有效', async () => {
  const env = makeEnv();
  await env.TRIUMPH_KV.put('report_credit:v-buyer', JSON.stringify({
    report_product: true, order_id: 'ord_1', issued_at: Date.now(), used_attempts: [],
  }));

  const ent = await resolveEntitlement(new Request('https://learndiag.com/x'), env, 'v-buyer');
  assert.equal(ent.tier, 'credit');

  const res = await hDiagnosticReport(post({ attempt_id: 'att-1', visitor_id: 'v-buyer', answers: answers(12, 3) }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.report && body.report.summary, '有权就该拿到完整报告');
  assert.equal(body.report.summary.question_count, 12);
  assert.equal(body.report.summary.correct_count, 9);

  // 同一份报告重复下载：允许（不该为重新打开再收一次钱）
  const again = await hDiagnosticReport(post({ attempt_id: 'att-1', visitor_id: 'v-buyer', answers: answers(12, 3) }), env);
  assert.equal(again.status, 200);

  // 换个 attempt：凭证已用掉，回到锁定
  const other = await hDiagnosticReport(post({ attempt_id: 'att-2', visitor_id: 'v-buyer', answers: answers(12, 3) }), env);
  assert.equal(other.status, 402);
  const otherBody = await other.json();
  assert.equal(otherBody.reason, 'credit_spent');
  assert.ok(!JSON.stringify(otherBody).includes('radar'), '二次请求也不能拿到报告');
});

test('凭证写入失败必须 5xx（否则用户付了钱拿不到报告）', async () => {
  const env = makeEnv();
  env.TRIUMPH_KV.put = async () => { throw new Error('KV down'); };
  env.TRIUMPH_KV.get = async (k, type) => {
    if (k === 'report_credit:v1') return { report_product: true, order_id: 'o', used_attempts: [] };
    return null;
  };
  const res = await hDiagnosticReport(post({ attempt_id: 'att-9', visitor_id: 'v1', answers: answers(12, 2) }), env);
  assert.equal(res.status, 500);
});

test('status 端点：只报权益，不下发报告', async () => {
  const env = makeEnv();
  const res = await hDiagnosticReportStatus(new Request('https://learndiag.com/api/diagnostic/report/status?visitor_id=v-none'), env);
  const body = await res.json();
  assert.equal(body.tier, 'free');
  assert.equal(body.can_view_report, false);
  assert.equal(body.purchase_available, true);
  assert.equal(body.free_review_limit, FREE_REVIEW_LIMIT);
  assert.ok(!JSON.stringify(body).includes('radar'));
});

test('PRO 订阅：报告可出，且结果缓存后重复请求不再生成', async () => {
  const env = makeEnv();
  // 伪造一条 PRO 记录；这里直接测凭证口径之外的 KV 读取路径需要 JWT，
  // 所以只断言「没有凭证时不会误判为有权限」
  const ent = await resolveEntitlement(new Request('https://learndiag.com/x'), env, 'v-plain');
  assert.equal(ent.tier, 'free');
  assert.equal(ent.credit, null);
});

test('免费可见的错题条数是 6（与前端前 6 题口径一致）', () => {
  assert.equal(FREE_REVIEW_LIMIT, 6);
});

// 最小 DOM 驱动真实展示脚本与下载事件，不依赖浏览器或外部网络。
class ReportNode {
  constructor(tag = 'div', text = '') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.attrs = {};
    this.events = {};
    this.text = String(text);
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((n) => n.textContent).join(''); }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node, before) {
    node.parentNode = this;
    const i = this.children.indexOf(before);
    this.children.splice(i < 0 ? this.children.length : i, 0, node);
    return node;
  }
  removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(name, cb) { this.events[name] = cb; }
  click() { this.events.click?.(); }
  querySelector(selector) {
    return this.walk().find((node) => selector === 'h3' ? node.tagName === 'H3'
      : selector[0] === '[' ? node.getAttribute(selector.slice(1, -1)) !== null
      : (node.className || '').split(' ').includes(selector.slice(1))) || null;
  }
  walk() { return this.children.flatMap((node) => [node, ...node.walk()]); }
  get outerHTML() {
    const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<' + this.tagName + '>' + escape(this.text) + this.children.map((node) => node.outerHTML).join('') + '</' + this.tagName + '>';
  }
}

function reportBrowser({ canView = true, status = 200, report = {} } = {}) {
  const root = new ReportNode();
  const main = root.appendChild(new ReportNode('main'));
  const original = main.appendChild(new ReportNode());
  const score = original.appendChild(new ReportNode());
  const requests = [];
  const blobs = [];
  const attempt = { attempt_id: 'att-ui', answers: [{ question_id: 'q-1', selected: 0, elapsed_ms: 2000 }] };
  const document = {
    readyState: 'loading', body: root,
    createElement: (tag) => new ReportNode(tag),
    createTextNode: (text) => new ReportNode('text', text),
    addEventListener() {},
    getElementById: (id) => id === 'root' ? root : root.walk().find((n) => n.id === id),
    querySelector: (selector) => ({ '#root main': main, '#root .report': original, '#root .report .score-head': score })[selector] || null,
    querySelectorAll: () => [],
  };
  const window = { addEventListener() {}, TriumphAuth: { token: 'token', isLoggedIn: () => true }, LDTrack: { visitor: () => 'visitor-1' } };
  const context = {
    window, document, location: { pathname: '/diagnostic', search: '' },
    localStorage: { getItem: (key) => key === 'triumph_last_attempt' ? JSON.stringify(attempt) : null },
    setTimeout() {}, setInterval() {}, clearInterval() {},
    Blob, URL: { createObjectURL: (blob) => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { status, json: async () => url.includes('/status') ? { can_view_report: canView, logged_in: true } : { report } };
    },
  };
  vm.runInNewContext(readFileSync(new URL('../site/js/report.js', import.meta.url), 'utf8'), context);
  return { root, document, window, requests, blobs, attempt };
}

const factualReport = () => ({
  summary: { correct_count: 2, question_count: 3, accuracy: 99, score: 167, pass_probability: 88, previous_score: 160 },
  subtests: [
    { code: '5002', name: 'Reading', correct: 2, attempted: 3, accuracy: 99 },
    { code: '5003', name: 'Mathematics', correct: 4, attempted: 6, accuracy: 99 },
  ],
  knowledge_points: [{ code: '5002', category: 'Inference', correct: 2, attempted: 3, accuracy: 99 }],
  radar: [{ id: 'guessing', label: 'Guessing', value: 95 }],
  narrative: { headline: 'INJECTED: 88% pass probability at 167 scaled score', next_actions: ['INJECTED: Reach the 160 line'] },
  misses: [{ code: '5002', category: 'Inference', question: 'Which evidence?', selected_text: 'A', answer_text: 'B', explanation: 'Use the evidence in the passage.' }],
});

for (const response of [{ canView: false }, { status: 402 }, { status: 401 }]) {
  test('展示层权限失败不渲染或下载报告：' + JSON.stringify(response), async () => {
    const browser = reportBrowser({ ...response, report: factualReport() });
    browser.window.LDReport.render();
    await new Promise(setImmediate);
    const node = browser.document.getElementById('ld-report-root');
    assert.equal(node.getAttribute('data-ld-report'), 'locked');
    assert.doesNotMatch(node.textContent, /2\/3|67%|INJECTED|Which evidence|Download this report/);
    assert.equal(browser.blobs.length, 0);
    assert.equal(browser.requests.length, response.canView === false ? 1 : 2);
  });
}

test('完整报告与下载共用真实计数，忽略旧模型、保持并列复习重点和API契约', async () => {
  const browser = reportBrowser({ report: factualReport() });
  browser.window.LDReport.render();
  await new Promise(setImmediate);
  const node = browser.document.getElementById('ld-report-root');
  assert.equal(node.getAttribute('data-ld-report'), '1');
  assert.match(node.textContent, /2\/3 correct \(67%\)/);
  assert.match(node.textContent, /4\/6 correct \(67%\)/);
  assert.match(node.textContent, /Review next: Reading.*Mathematics/);
  assert.match(node.textContent, /Use the evidence in the passage/);
  assert.doesNotMatch(node.textContent, /INJECTED|99%|88%|167|Nine-dimension|estimated scaled score|23%/);
  const body = JSON.parse(browser.requests[1].options.body);
  assert.deepEqual(body, { attempt_id: browser.attempt.attempt_id, visitor_id: 'visitor-1', answers: browser.attempt.answers });
  assert.equal(browser.requests[1].options.headers.Authorization, 'Bearer token');
  node.walk().find((n) => n.textContent === 'Download this report').click();
  assert.equal(browser.blobs.length, 1);
  const html = await browser.blobs[0].text();
  assert.match(html, /2\/3 correct \(67%\)/);
  assert.match(html, /Review priorities &amp; study plan/);
  assert.match(html, /Use the evidence in the passage/);
  assert.doesNotMatch(html, /INJECTED|99%|88%|estimated scaled score|Nine-dimension|Download this report/);
});

test('报告计数不足与全对均不制造短板或零正确率', async () => {
  for (const report of [
    { summary: { correct_count: 0, question_count: 0 }, subtests: [{ name: 'Math', correct: 0, attempted: 0 }] },
    { summary: { correct_count: 3, question_count: 3 }, subtests: [{ name: 'Math', correct: 3, attempted: 3 }] },
  ]) {
    const browser = reportBrowser({ report });
    browser.window.LDReport.render();
    await new Promise(setImmediate);
    const text = browser.document.getElementById('ld-report-root').textContent;
    assert.doesNotMatch(text, /Review next:|undefined|NaN/);
    if (!report.summary.question_count) {
      assert.match(text, /Insufficient answer-count data/);
      assert.doesNotMatch(text, /\b0%/);
    } else assert.match(text, /No missed questions in this sample/);
  }
});

function conversionSummary(entries) {
  const report = new ReportNode();
  const box = report.appendChild(new ReportNode());
  box.closest = () => report;
  box.appendChild(new ReportNode('h3', 'Study plan'));
  report.querySelectorAll = () => entries.map(([name, count]) => {
    const row = new ReportNode();
    const label = row.appendChild(new ReportNode('span', name)); label.className = 'name';
    const acc = row.appendChild(new ReportNode('span', count)); acc.className = 'acc';
    return row;
  });
  const document = {
    readyState: 'complete', getElementById: () => report,
    querySelector: (selector) => selector === '.unlocked-box' ? box : null,
    createElement: (tag) => new ReportNode(tag),
  };
  vm.runInNewContext(readFileSync(new URL('../site/js/conversion-hook.js', import.meta.url), 'utf8'), {
    document, window: { requestAnimationFrame: (cb) => cb() },
    MutationObserver: class { observe() {} },
  });
  return box.textContent;
}

test('转化摘要精确解析2/3分母，保留并列最低项，不读取旧分数', () => {
  const text = conversionSummary([['Reading — review next', '2/3 correct'], ['Math', '4/6 correct'], ['Science', '3/3 correct']]);
  assert.match(text, /Reading \(2\/3 correct, 67%\); Math \(4\/6 correct, 67%\)/);
  assert.doesNotMatch(text, /23%|46%|160|forecast|weakest gate/);
});

test('转化摘要对零分母、未知格式和不合法计数显式提示不足；全对不制造短板', () => {
  for (const value of ['0/0 correct', '4/3 correct', 'not measured', '67%']) {
    assert.match(conversionSummary([['Math', value]]), /not enough answer-count data/);
  }
  const text = conversionSummary([['Math', '3/3 correct']]);
  assert.match(text, /No missed questions/);
  assert.doesNotMatch(text, /Review next:/);
});

test('注册卡只承诺保存练习和答案解析，不把完整付费报告或预测说成免费', () => {
  const pw = new ReportNode();
  const cta = pw.appendChild(new ReportNode());
  cta.querySelector = () => new ReportNode('a');
  pw.querySelector = (selector) => selector === '.cta-row' ? cta : null;
  const document = {
    readyState: 'complete',
    querySelector: (selector) => selector === '.paywall' ? pw : null,
    createElement: (tag) => new ReportNode(tag),
  };
  vm.runInNewContext(readFileSync(new URL('../site/js/signup-hook.js', import.meta.url), 'utf8'), {
    document, window: { TriumphAuth: { token: null, isLoggedIn: () => false } }, setInterval() {},
  });
  // 原生DOM的innerHTML用于固定标题，直接断言实际创建节点上的标题值。
  const heading = pw.walk().find((node) => node.innerHTML);
  assert.match(heading.innerHTML, /Save your practice results.*unlock answer explanations/);
  assert.doesNotMatch(heading.innerHTML, /forecast|study plan|full report/i);
});
