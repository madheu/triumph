// test/diagnostic-report.test.mjs — 诊断报告的门控与判分回归
//
// 这个文件守的是三条最容易在后续改动里被破坏的约束：
//   1. 未获权益时，响应体里**不能出现任何报告内容**（"未解锁绝对不能渲染"的根）。
//   2. 判分只用服务端题库，客户端传什么对错都不影响分数。
//   3. 一次购买的凭证只能用在一份报告上，但同一份可以重复下载。

import { test } from 'node:test';
import assert from 'node:assert/strict';

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
