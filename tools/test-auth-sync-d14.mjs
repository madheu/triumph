// tools/test-auth-sync-d14.mjs — D14 前端同步层集成测试
//
// 跑法：node tools/test-auth-sync-d14.mjs
//
// 为什么不用 jsdom：这文件测的是 auth.js 的同步契约，不需要 DOM。用最小 stub
// 伪造 window / localStorage / fetch，直接加载真实的 site/js/auth.js 并驱动它，
// 测的是真代码而不是抄一份逻辑来测。
//
// 覆盖的契约：
//   1. buildLocalState 默认按 5001，key 不带后缀（存量页面零改动）
//   2. 8006 的 key 带 _8006 后缀，与 5001 物理隔离
//   3. packState 产出 v2 结构
//   4. syncPush 在服务端已有别的考试时，不覆盖对方（整体替换 -> per-test 合并）
//   5. syncPull 从 v2 结构正确回填当前考试
//   6. 旧扁平结构（服务端还没迁移）能被前端正确读取
//   7. 5001 与 8006 数据双向隔离，互不串味

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const AUTH_SRC = join(here, '..', 'site', 'js', 'auth.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; failures.push(name); console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// ---------------------------------------------------------------- 最小 stub
function makeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
    _dump: () => Object.fromEntries(map),
  };
}

// 服务端 KV 的替身，同时模拟 worker 端的 normalize + per-test merge 语义
function makeServer() {
  let stored = null;
  const normalize = s => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { v: 2, createdAt: Date.now(), prefs: {}, tests: {} };
    if (s.tests && typeof s.tests === 'object') return { v: 2, createdAt: s.createdAt || Date.now(), prefs: s.prefs || {}, tests: s.tests };
    const GLOBAL = ['prefs', 'v', 'createdAt', 'updatedAt'];
    const legacy = {}; const global = {};
    for (const k of Object.keys(s)) (GLOBAL.includes(k) ? global : legacy)[k] = s[k];
    return { v: 2, createdAt: global.createdAt || Date.now(), prefs: global.prefs || {}, tests: Object.keys(legacy).length ? { '5001': legacy } : {} };
  };
  const cnt = b => (b && Array.isArray(b.answers) ? b.answers.length : 0);
  const mergeBucket = (a, b) => {
    if (!a) return { answers: [], mastery: {}, plan: null, srs: {}, tasks: {}, ...(b || {}) };
    if (!b) return { answers: [], mastery: {}, plan: null, srs: {}, tasks: {}, ...a };
    const rich = cnt(b) > cnt(a) ? b : a, poor = rich === a ? b : a;
    return { answers: [], mastery: {}, plan: null, srs: {}, tasks: {}, ...poor, ...rich };
  };
  const merge = (a, b) => {
    const A = normalize(a), B = normalize(b), tests = {};
    for (const c of new Set([...Object.keys(A.tests), ...Object.keys(B.tests)])) tests[c] = mergeBucket(A.tests[c], B.tests[c]);
    return { v: 2, createdAt: Math.min(A.createdAt || Infinity, B.createdAt || Infinity) || Date.now(), updatedAt: Date.now(), prefs: { ...A.prefs, ...B.prefs }, tests };
  };
  return {
    put: s => { stored = merge(stored, s); },
    get: () => stored,
    seed: s => { stored = s; },
    raw: () => stored,
  };
}

function loadAuth(storage, server) {
  global.window = { TRIUMPH_API: '', addEventListener() {}, dispatchEvent() {}, setTimeout, location: { hash: '', pathname: '/', search: '' }, history: { replaceState() {} } };
  global.localStorage = storage;
  global.document = undefined;
  global.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (String(url).endsWith('/api/state')) {
      if (method === 'GET') return { ok: true, json: async () => ({ state: server.get() }) };
      const body = JSON.parse(opts.body || '{}');
      server.put(body.state);
      return { ok: true, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const src = readFileSync(AUTH_SRC, 'utf8');
  // auth.js 是 IIFE，直接 eval 即可拿到 window.TriumphAuth
  // eslint-disable-next-line no-eval
  (0, eval)(src);
  return global.window.TriumphAuth;
}

// ---------------------------------------------------------------- 场景 1：5001 默认零改动
console.log('== 1. 5001 默认行为（存量页面不该受影响）==');
{
  const storage = makeStorage(), server = makeServer();
  storage.setItem('triumph_answers', JSON.stringify([{ id: 'q1' }, { id: 'q2' }]));
  storage.setItem('triumph_mastery', JSON.stringify({ '5002': 0.7 }));
  const T = loadAuth(storage, server);
  T.token = 'fake';
  const st = T.buildLocalState();
  t('默认识别为 5001', T.currentTest() === '5001');
  t('默认 key 不带后缀', Object.keys(storage._dump()).includes('triumph_answers'));
  t('answers 读到', st.answers.length === 2);
  t('mastery 读到', st.mastery['5002'] === 0.7);
  const packed = T.packState();
  t('packState 产出 v2', packed.v === 2 && !!packed.tests);
  t('packState 归到 tests.5001', packed.tests['5001'].answers.length === 2);
  t('packState 不含 8006', !packed.tests['8006']);
}

// ---------------------------------------------------------------- 场景 2：8006 key 隔离
console.log('== 2. 8006 的 localStorage 隔离 ==');
{
  const storage = makeStorage(), server = makeServer();
  storage.setItem('triumph_answers', JSON.stringify([{ id: 'p1' }]));
  storage.setItem('triumph_8006_answers', JSON.stringify([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]));
  storage.setItem('triumph_test_code', '8006');
  const T = loadAuth(storage, server);
  T.token = 'fake';
  const st = T.buildLocalState('8006');
  t('8006 读到自己的 3 条', st.answers.length === 3, st.answers);
  t('currentTest 跟随 8006', T.currentTest() === '8006');
  const p5001 = T.buildLocalState('5001');
  t('显式传 5001 不串味', p5001.answers.length === 1, p5001.answers);
  const packed = T.packState('8006');
  t('packState 归到 tests.8006', packed.tests['8006'].answers.length === 3);
}

// ---------------------------------------------------------------- 场景 3：syncPush 不覆盖别的考试
console.log('== 3. syncPush 不覆盖服务端别的考试（D14 核心）==');
{
  const storage = makeStorage(), server = makeServer();
  // 服务端已有 5001 数据（5 条，数量上"更富"）
  server.seed({ v: 2, createdAt: 100, prefs: {}, tests: { '5001': { answers: [1, 2, 3, 4, 5], mastery: { a: 1 }, plan: null, srs: {}, tasks: {} } } });
  // 本地是 8006，只有 1 条
  storage.setItem('triumph_8006_answers', JSON.stringify([{ id: 'x1' }]));
  storage.setItem('triumph_test_code', '8006');
  const T = loadAuth(storage, server);
  T.token = 'fake';
  await T.syncPush('8006');
  const srv = server.raw();
  t('服务端 5001 仍有 5 条', srv.tests['5001'].answers.length === 5, srv.tests['5001']);
  t('服务端 8006 写入成功', srv.tests['8006'].answers.length === 1, srv.tests['8006']);
  t('两门共存', !!srv.tests['5001'] && !!srv.tests['8006']);
}

// ---------------------------------------------------------------- 场景 4：syncPull 从 v2 回填
console.log('== 4. syncPull 从 v2 结构回填 ==');
{
  const storage = makeStorage(), server = makeServer();
  server.seed({ v: 2, createdAt: 1, prefs: { theme: 'light' }, tests: {
    '5001': { answers: [{ id: 'a' }], mastery: {}, plan: null, srs: {}, tasks: {} },
    '8006': { answers: [{ id: 'b' }, { id: 'c' }], mastery: { FLS: 0.8 }, plan: { week: 1 }, srs: {}, tasks: {} },
  } });
  const T = loadAuth(storage, server);
  T.token = 'fake';
  await T.syncPull('8006');
  const dump = storage._dump();
  t('8006 answers 落到带后缀的 key', JSON.parse(dump['triumph_8006_answers'] || '[]').length === 2);
  t('8006 mastery 落地', JSON.parse(dump['triumph_8006_mastery'] || '{}').FLS === 0.8);
  t('8006 plan 落地', !!dump['triumph_8006_plan']);
  t('未污染 5001 的 answers', !dump['triumph_answers'], dump['triumph_answers']);
  t('prefs 是全局的', !!dump['triumph_prefs']);
}

// ---------------------------------------------------------------- 场景 5：服务端还是旧结构
console.log('== 5. 服务端未迁移（旧扁平结构）也能读 ==');
{
  const storage = makeStorage(), server = makeServer();
  server.seed({ createdAt: 77, answers: [{ id: 'old1' }, { id: 'old2' }], mastery: { '5003': 0.6 }, plan: null, srs: {}, tasks: {}, prefs: {} });
  const T = loadAuth(storage, server);
  T.token = 'fake';
  await T.syncPull('5001');
  const dump = storage._dump();
  t('旧数据被当作 5001 读出', JSON.parse(dump['triumph_answers'] || '[]').length === 2, dump['triumph_answers']);
  t('旧 mastery 读出', JSON.parse(dump['triumph_mastery'] || '{}')['5003'] === 0.6);
}

// ---------------------------------------------------------------- 场景 6：同一考试 push 后再 pull 往返一致
console.log('== 6. push -> pull 往返一致 ==');
{
  const storage = makeStorage(), server = makeServer();
  storage.setItem('triumph_8006_answers', JSON.stringify([{ id: 'r1' }, { id: 'r2' }]));
  storage.setItem('triumph_8006_last_score', JSON.stringify('62%'));
  storage.setItem('triumph_test_code', '8006');
  const T = loadAuth(storage, server);
  T.token = 'fake';
  await T.syncPush('8006');
  storage.removeItem('triumph_8006_answers');
  storage.removeItem('triumph_8006_last_score');
  await T.syncPull('8006');
  const dump = storage._dump();
  t('answers 往返恢复', JSON.parse(dump['triumph_8006_answers'] || '[]').length === 2);
  t('lastScore 往返恢复', JSON.parse(dump['triumph_8006_last_score'] || '""') === '62%');
}

console.log('');
console.log('结果: PASS=' + pass + ' FAIL=' + fail);
if (failures.length) console.log('失败项: ' + failures.join(' | '));
process.exit(fail ? 1 : 0);
