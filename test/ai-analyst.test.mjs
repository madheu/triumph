// ai-analyst.test.mjs — /api/ai/analyze 测试：鉴权、校验、缓存不扣次、每日限额、PRO 不限量、降级回退
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// 读 **worker-src 源码**而不是 site/_worker.js 产物 —— 读产物时"改了源码忘了 build"会假绿。
const workerUrl = pathToFileURL('E:/Triumph/praxis-5001/worker-src/worker.mjs').href;
const worker = (await import(workerUrl)).default;
const { signJwt } = await import(pathToFileURL('E:/Triumph/praxis-5001/worker-src/crypto.mjs').href);

const siteRoot = 'E:/Triumph/praxis-5001/site';
const store = new Map();
const env = {
  JWT_SECRET: 'ai-test-secret',
  OPENROUTER_API_KEY: 'test-key',
  TRIUMPH_KV: {
    get: async (k, type) => {
      if (!store.has(k)) return null;
      const v = store.get(k);
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (k, v, opts) => { store.set(k, v); },
    delete: async k => { store.delete(k); },
  },
  ASSETS: {
    async fetch(req) {
      const u = new URL(req.url);
      const p = u.pathname === '/' ? '/index.html' : u.pathname;
      try {
        const body = readFileSync(siteRoot + p);
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    },
  },
};

const realFetch = globalThis.fetch;
let orMode = 'ok'; // ok | fail
let orCalls = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('openrouter.ai')) {
    orCalls++;
    if (orMode === 'fail') return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 });
    const content = JSON.stringify({ misconception: 'm', why_wrong: 'w', key_point: 'k', review_topic: 'r' });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }
  return realFetch(url, init);
};

const call = async (path, method = 'GET', body, token) =>
  worker.fetch(new Request('https://learndiag.com' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env, {});

const assert = (cond, msg) => { if (!cond) throw new Error('AI TEST FAIL: ' + msg); console.log('ok -', msg); };

const t1 = await signJwt({ sub: 'u1', email: 'ai-test@example.com' }, 'ai-test-secret');
const tPro = await signJwt({ sub: 'upro', email: 'ai-pro@example.com' }, 'ai-test-secret');
store.set('users:ai-pro@example.com', JSON.stringify({ plan: 'pro' }));

// 1. 未登录 → 401
let r = await call('/api/ai/analyze', 'POST', { questionId: '5003-004', selected: 0 });
assert(r.status === 401, 'unauthenticated returns 401');

// 2. 非法 selected → 400
r = await call('/api/ai/analyze', 'POST', { questionId: '5003-004', selected: 'abc' }, t1);
assert(r.status === 400, 'non-integer selected returns 400');

// 3. 未知题目 → 404
r = await call('/api/ai/analyze', 'POST', { questionId: 'nope-999', selected: 0 }, t1);
assert(r.status === 404, 'unknown question returns 404');

// 4. 答对了 → already_correct
r = await call('/api/ai/analyze', 'POST', { questionId: '5003-004', selected: 1 }, t1);
let d = await r.json();
assert(r.status === 200 && d.already_correct === true, 'correct answer short-circuits');

// 5. 正常分析（模型成功）→ remaining 2
r = await call('/api/ai/analyze', 'POST', { questionId: '5003-004', selected: 0 }, t1);
d = await r.json();
assert(r.status === 200 && d.analysis && d.analysis.misconception === 'm', 'successful analysis returned');
assert(d.cached === false && d.remaining === 2, 'first real call: remaining=2');

// 6. 同题同错项 → 缓存命中不扣次
r = await call('/api/ai/analyze', 'POST', { questionId: '5003-004', selected: 0 }, t1);
d = await r.json();
assert(d.cached === true && d.remaining === 2, 'cache hit does not consume quota');

// 7-8. 另两个错项 → remaining 1, 0
r = await call('/api/ai/analyze', 'POST', { questionId: '5003-004', selected: 2 }, t1);
d = await r.json();
assert(d.remaining === 1, 'second distinct analysis: remaining=1');
r = await call('/api/ai/analyze', 'POST', { questionId: '5003-004', selected: 3 }, t1);
d = await r.json();
assert(d.remaining === 0, 'third distinct analysis: remaining=0');

// 9. 超限 → 429 quota_exceeded（selected=1 是 5002-001 的错项；0 是正确项会短路）
r = await call('/api/ai/analyze', 'POST', { questionId: '5002-001', selected: 1 }, t1);
d = await r.json();
assert(r.status === 429 && d.error && d.error.code === 'quota_exceeded', '429 quota_exceeded after 3 analyses');

// 10. 模型全挂 → fallback 不扣次（新用户 + 未缓存过的题目组合，否则会命中全局缓存）
orMode = 'fail';
const t2 = await signJwt({ sub: 'u2', email: 'ai-fallback@example.com' }, 'ai-test-secret');
r = await call('/api/ai/analyze', 'POST', { questionId: '5004-004', selected: 0 }, t2);
d = await r.json();
assert(r.status === 200 && d.fallback === true && d.explanation && d.explanation.includes('Role-play'), 'all-models-fail falls back to official explanation');
orMode = 'ok';
r = await call('/api/ai/analyze', 'POST', { questionId: '5004-004', selected: 0 }, t2);
d = await r.json();
assert(d.cached === false && d.remaining === 2, 'fallback did not consume quota (still 3 left, now 2)');

// 11. PRO 不限量
for (const sel of [0, 2, 3]) {
  r = await call('/api/ai/analyze', 'POST', { questionId: '5003-004', selected: sel }, tPro);
  d = await r.json();
  assert(r.status === 200 && d.remaining === null, 'PRO unlimited: remaining=null for selected=' + sel);
}
r = await call('/api/ai/analyze', 'POST', { questionId: '5002-001', selected: 2 }, tPro);
assert(r.status === 200, 'PRO never hits quota');

globalThis.fetch = realFetch;
console.log('\nALL AI ANALYST TESTS PASSED');
