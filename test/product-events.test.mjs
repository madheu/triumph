// test/product-events.test.mjs
//
// 回归测试：产品事件埋点层（D4 / v1.1）。
//
// 背景（2026-09-10）：对生产库直查发现，埋点虽然已经在跑（215 行 / 8 天），
// 但至少 6 处缺陷让数据不可用 —— 而这些都是「静默失败」：前端不报错、
// 后端返回 200、表里也有行，只是字段是空的或语义是错的。所以必须有回归测试。
//
// 覆盖的真实缺陷：
//   1. elapsed_ms 被写成 0（Number(null) === 0），106/106 条全为 0、零 NULL，
//      「未提供耗时」和「0ms 秒答」在数据里无法区分。
//   2. result_view 触发率 12.5%（2/16）—— observeOnce 写死 threshold 0.5，
//      而 .report 高度远超视口，ratio 上限只有 视口高/元素高，永远达不到。
//   3. return_visit 按 session（30 分钟）判定，与字典的「> 24h」不符，
//      同一访客 1 小时内报过两次。
//   4. question_answer 的 correct / question_id 全为 NULL。
//   5. 付费漏斗三个事件不存在，CHECK 约束会把它们拒掉。
//   6. 事件白名单散在三处（tracking.js / events.mjs / D1 CHECK），
//      加事件时漏一处就被静默丢弃 —— 用一致性测试兜住。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');

const { hEvents } = await import(pathToFileURL(ROOT + 'worker-src/events.mjs').href);

// ---------------------------------------------------------------- 测试脚手架

/** 假 D1：只需要能把 batch 里的绑定参数取出来 */
function makeD1() {
  const inserted = [];
  return {
    inserted,
    prepare() {
      return {
        bind(...params) { this._p = params; return this; },
      };
    },
    async batch(stmts) {
      for (const s of stmts) inserted.push(s._p);
    },
  };
}

function post(events) {
  return new Request('https://learndiag.com/api/t/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
}

const evt = (o) => ({ event_uuid: 'u-' + Math.random().toString(36).slice(2), ts: Date.now(), ...o });

// 列顺序与 events.mjs 的 bind 一致
const COL = {
  event_uuid: 0, event: 1, ts: 2, server_ts: 3, visitor_id: 4, session_id: 5,
  user_id: 6, attempt_id: 7, page: 8, test_code: 9, traffic_source: 10, device: 11,
  score_band: 12, weakest_domain: 13, signup_method: 14, content_domain: 15,
  question_id: 16, correct: 17, elapsed_ms: 18, extra_json: 19,
};

/** 最小 window stub，用来跑真实的 site/js/tracking.js */
function makeWindow(overrides = {}) {
  const store = new Map();
  const observers = [];
  const win = {
    _store: store,
    _observers: observers,
    crypto: { randomUUID: () => 'u' + Math.random().toString(36).slice(2, 12) },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    navigator: { sendBeacon: () => true },
    document: { documentElement: { clientHeight: 800 }, referrer: '', addEventListener() {} },
    location: { href: 'https://learndiag.com/practice', pathname: '/practice', hostname: 'learndiag.com', search: '' },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    IntersectionObserver: class {
      constructor(cb, opts) { this.cb = cb; this.opts = opts; observers.push(this); }
      observe() {}
      disconnect() {}
    },
    ...overrides,
  };
  return win;
}

function loadTracking(win) {
  new Function('window', read('site/js/tracking.js'))(win);
  return win.LDTrack;
}

// ------------------------------------------------------------ events.mjs 侧

test('elapsed_ms 缺失写 NULL，而不是 0', async () => {
  const d1 = makeD1();
  const res = await hEvents(post([evt({ event: 'question_answer', visitor_id: 'v1' })]), { TRIUMPH_D1: d1 });
  assert.equal(res.status, 200);
  assert.equal(d1.inserted.length, 1);
  assert.equal(d1.inserted[0][COL.elapsed_ms], null, '缺省耗时必须是 NULL，不能是 0');
});

test('elapsed_ms 显式传 null 同样写 NULL', async () => {
  const d1 = makeD1();
  await hEvents(post([evt({ event: 'question_answer', elapsed_ms: null })]), { TRIUMPH_D1: d1 });
  assert.equal(d1.inserted[0][COL.elapsed_ms], null);
});

test('elapsed_ms 为 0 时保留 0（真实秒答不能被吞）', async () => {
  const d1 = makeD1();
  await hEvents(post([evt({ event: 'question_answer', elapsed_ms: 0 })]), { TRIUMPH_D1: d1 });
  assert.equal(d1.inserted[0][COL.elapsed_ms], 0);
});

test('elapsed_ms 超上限被截断，负数归 NULL', async () => {
  const d1 = makeD1();
  await hEvents(post([
    evt({ event: 'question_answer', elapsed_ms: 9_999_999 }),
    evt({ event: 'question_answer', elapsed_ms: -5 }),
  ]), { TRIUMPH_D1: d1 });
  assert.equal(d1.inserted[0][COL.elapsed_ms], 3600000);
  assert.equal(d1.inserted[1][COL.elapsed_ms], null);
});

test('付费漏斗三个事件都能写入', async () => {
  const d1 = makeD1();
  const res = await hEvents(post([
    evt({ event: 'upgrade_view', page: 'upgrade' }),
    evt({ event: 'checkout_start', page: 'upgrade' }),
    evt({ event: 'purchase_success', page: 'upgrade' }),
  ]), { TRIUMPH_D1: d1 });
  assert.equal(res.status, 200);
  assert.equal(d1.inserted.length, 3);
  assert.deepEqual(d1.inserted.map((r) => r[COL.event]),
    ['upgrade_view', 'checkout_start', 'purchase_success']);
});

test('字典外的事件被丢弃', async () => {
  const d1 = makeD1();
  const res = await hEvents(post([evt({ event: 'totally_made_up' })]), { TRIUMPH_D1: d1 });
  assert.equal(res.status, 400);
  assert.equal(d1.inserted.length, 0);
});

test('signup_success 会回填同 visitor 的历史事件（身份缝合）', async () => {
  const d1 = makeD1();
  await hEvents(post([evt({ event: 'signup_success', user_id: 'u-42', visitor_id: 'v-9' })]), { TRIUMPH_D1: d1 });
  // 最后一条应是回填语句（同样经由 prepare().bind() 入列）
  const stitch = d1.inserted[d1.inserted.length - 1];
  assert.deepEqual(stitch.slice(0, 2), ['u-42', 'v-9']);
});

// --------------------------------------------------------------- tracking.js

test('observeOnce 的阈值按元素高度自适应（修 result_view 不触发）', () => {
  const win = makeWindow();
  const L = loadTracking(win);
  L.init({});

  // 视口 800、元素 3000 → 最大可能 ratio 只有 0.267，写死 0.5 就永远不触发
  const tall = { getBoundingClientRect: () => ({ height: 3000 }) };
  L.observeOnce(tall, 'result_view', {});
  const io = win._observers[win._observers.length - 1];
  assert.ok(Math.abs(io.opts.threshold - 800 / 3000) < 1e-6,
    `期望自适应阈值 ${800 / 3000}，实际 ${io.opts.threshold}`);
});

test('元素矮于视口时仍用 0.5，不因自适应而放松', () => {
  const win = makeWindow();
  const L = loadTracking(win);
  L.init({});
  const short = { getBoundingClientRect: () => ({ height: 200 }) };
  L.observeOnce(short, 'signup_prompt_view', {});
  const io = win._observers[win._observers.length - 1];
  assert.equal(io.opts.threshold, 0.5);
});

test('元素高度取不到时不抛错，退回 0.5', () => {
  const win = makeWindow();
  const L = loadTracking(win);
  L.init({});
  const unknown = { getBoundingClientRect: () => ({ height: 0 }) };
  L.observeOnce(unknown, 'result_view', {});
  const io = win._observers[win._observers.length - 1];
  assert.equal(io.opts.threshold, 0.5);
});

/** 把 sendBeacon 收到的 Blob 读成文本（Blob.toString() 只会得到 "[object Blob]"） */
async function drain(sent) {
  const parts = [];
  for (const b of sent) {
    parts.push(typeof b.text === 'function' ? await b.text() : String(b));
  }
  return parts.join('');
}

test('return_visit：25 小时前访问过才报', async () => {
  const win = makeWindow();
  const sent = [];
  win.navigator.sendBeacon = (url, blob) => { sent.push(blob); return true; };
  const L = loadTracking(win);

  win._store.set('ld_visitor', 'v-old');
  win._store.set('ld_source', 'organic');
  win._store.set('ld_last_visit', String(Date.now() - 25 * 3600 * 1000));
  L.init({});
  L.flushNow();

  const all = await drain(sent);
  assert.ok(sent.length > 0, 'sendBeacon 未被调用');
  assert.ok(all.includes('return_visit'), '超过 24h 应触发 return_visit，实际收到: ' + all.slice(0, 200));
});

test('return_visit：1 小时前访问过不报（原实现会误报）', async () => {
  const win = makeWindow();
  const sent = [];
  win.navigator.sendBeacon = (url, blob) => { sent.push(blob); return true; };
  const L = loadTracking(win);

  win._store.set('ld_visitor', 'v-old');
  win._store.set('ld_source', 'organic');
  win._store.set('ld_last_visit', String(Date.now() - 3600 * 1000));
  L.init({});
  L.flushNow();

  const all = await drain(sent);
  assert.ok(!all.includes('return_visit'), '不足 24h 不应触发 return_visit');
});

test('traffic_source 首次访问即固化，后续不再重算', () => {
  const win = makeWindow({
    location: { href: 'https://learndiag.com/practice', pathname: '/practice', hostname: 'learndiag.com', search: '' },
  });
  win.document.referrer = 'https://www.google.com/search?q=praxis';
  const L = loadTracking(win);
  L.init({});
  assert.equal(win._store.get('ld_source'), 'organic');
  assert.equal(L._state().trafficSource, 'organic');

  // 第二次进站（同域跳转，referrer 变成站内）不应改变已固化的来源
  const win2 = makeWindow({ _store: win._store });
  win2.document.referrer = 'https://learndiag.com/diagnostic';
  const L2 = loadTracking(win2);
  L2.init({});
  assert.equal(win._store.get('ld_source'), 'organic', '固化值不能被站内 referrer 覆盖');
});

test('GA4 侧用推荐事件名，自有表用自描述名', () => {
  const win = makeWindow();
  const ga = [];
  win.gtag = (kind, name, params) => ga.push({ kind, name, params });
  const L = loadTracking(win);
  L.init({});

  L.track('signup_success', { signup_method: 'email_code' });
  L.track('checkout_start', {});
  L.track('purchase_success', {});
  L.track('upgrade_view', {});
  const names = ga.filter((g) => g.kind === 'event').map((g) => g.name);
  assert.ok(names.includes('sign_up'), 'GA4 应使用保留名 sign_up');
  assert.ok(names.includes('begin_checkout'));
  assert.ok(names.includes('purchase'));
  assert.ok(names.includes('view_promotion'));
});

test('GA4 侧不透出 PII（user_id / email）', () => {
  const win = makeWindow();
  const ga = [];
  win.gtag = (kind, name, params) => ga.push({ name, params });
  const L = loadTracking(win);
  L.init({});
  L.track('signup_success', { signup_method: 'email_code', user_id: 'u-7', email: 'a@b.com' });
  const payload = ga.find((g) => g.name === 'sign_up').params;
  assert.equal(payload.user_id, undefined);
  assert.equal(payload.email, undefined);
  assert.equal(payload.signup_method, 'email_code');
});

test('GA4 的 purchase / begin_checkout 带上 value 与 currency', () => {
  const win = makeWindow();
  const ga = [];
  win.gtag = (kind, name, params) => ga.push({ name, params });
  const L = loadTracking(win);
  L.init({});
  const PRO = { plan: 'pro', value: 15, currency: 'usd' };
  L.track('checkout_start', PRO);
  L.track('purchase_success', PRO);

  const bc = ga.find((g) => g.name === 'begin_checkout').params;
  const pu = ga.find((g) => g.name === 'purchase').params;
  for (const p of [bc, pu]) {
    assert.equal(p.value, 15, 'GA4 电商事件缺 value 就基本读不出东西');
    assert.equal(p.currency, 'usd');
    assert.equal(p.plan, 'pro');
  }
});

// -------------------------------------------- 三处白名单与实现的一致性

test('事件白名单三处同步：tracking.js = events.mjs = schema CHECK', () => {
  const trackingSrc = read('site/js/tracking.js');
  const eventsSrc = read('worker-src/events.mjs');
  const schemaSrc = read('drafts/2026-09-03-product-events-schema.sql');

  const pick = (src, re) => [...src.match(re)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

  const a = pick(trackingSrc, /var EVENTS = \[([\s\S]*?)\];/);
  const b = pick(eventsSrc, /const ALLOWED_EVENTS = new Set\(\[([\s\S]*?)\]\)/);
  const c = pick(schemaSrc, /CHECK \(event IN \(([\s\S]*?)\)\)/);

  assert.ok(a.length >= 15, `tracking.js 事件数偏少: ${a.length}`);
  assert.deepEqual(a, b, 'tracking.js 与 events.mjs 的事件列表不一致');
  assert.deepEqual(a, c, 'tracking.js 与 D1 CHECK 约束的事件列表不一致');
});

test('question_answer 的判定改在「Next」捕获阶段，不再依赖 80ms 延时', () => {
  const src = read('site/js/signup-hook.js');
  assert.ok(/\.quiz-actions \.btn-primary/.test(src), '应挂在 Next/See-results 按钮上');
  assert.ok(/quiz\.querySelector\('button\.opt\.correct'\)/.test(src), '应读取已 reveal 的 .correct');
  assert.ok(/lookupQuestion/.test(src), '应通过题库反查 question_id 与领域名');
  assert.ok(!/setTimeout\(function \(\) \{[\s\S]{0,400}opts\.indexOf/.test(src),
    '不应保留旧的 80ms 延时判定');
});

test('diagnostic 的 test_start / test_complete 不再重复埋点', () => {
  const src = read('site/js/signup-hook.js');
  assert.ok(!/L\.track\('test_start'/.test(src),
    'test_start 由 diagnostic 内联脚本负责，signup-hook 不应重复发');
  assert.ok(!/L\.track\('test_complete'/.test(src),
    'test_complete 由 diagnostic 内联脚本负责（它有 score_pct），不应重复发');
});

test('signup_method 取值统一为字典口径', () => {
  const hook = read('site/js/signup-hook.js');
  const track = read('site/js/tracking.js');
  assert.ok(!/magic_code/.test(hook), 'signup-hook 不应再使用 magic_code');
  assert.ok(!/'magic_code'/.test(track), 'tracking.js 默认值不应再使用 magic_code');
  assert.ok(/email_code/.test(hook) && /magic_link/.test(hook), '应使用 email_code / magic_link');
});

test('注册与付费页都已接入埋点层', () => {
  assert.ok(/js\/tracking\.js/.test(read('site/login.html')), 'login.html 应加载 tracking.js');
  assert.ok(/login-tracking\.js/.test(read('site/login.html')), 'login.html 应加载 login-tracking.js');
  assert.ok(/js\/tracking\.js/.test(read('site/upgrade.html')), 'upgrade.html 应加载 tracking.js');
  assert.ok(/upgrade-tracking\.js/.test(read('site/upgrade.html')), 'upgrade.html 应加载 upgrade-tracking.js');
  assert.ok(/js\/tracking\.js/.test(read('site/index.html')), 'index.html 应加载 tracking.js（固化 traffic_source）');
});

test('GA4 的 sign_up 只在注册真正完成时发出', () => {
  const auth = read('site/js/auth.js');
  // 旧实现把 gtag 放在 need_verify 判断之前（逗号表达式），未验证也会计入
  assert.ok(!/window\.gtag\("event","sign_up",\{method:"email"\}\),e\.need_verify\)/.test(auth),
    'sign_up 不应在「提交注册」时就发');
  assert.ok(/typeof window\.gtag=="function"&&window\.gtag\("event","sign_up",\{method:"email"\}\);return this\._setSession/.test(auth),
    'register 直通成功时应发 sign_up');
  assert.ok(/window\.gtag\("event","sign_up",\{method:"email"\}\),this\._setSession/.test(auth),
    'verify 成功时也应发 sign_up');
});
