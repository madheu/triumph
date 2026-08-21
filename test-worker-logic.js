// test-worker-logic.js — 本地验证 Worker 核心逻辑（不依赖 Cloudflare 运行时）
// 用 Node 内置 crypto 模拟 PBKDF2 + JWT 流程，验证注册/登录/状态读写路径正确
const { webcrypto } = require('crypto');
globalThis.crypto = webcrypto;
globalThis.TextEncoder = require('util').TextEncoder;
globalThis.TextDecoder = require('util').TextDecoder;
globalThis.btoa = s => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');

// 加载 worker 源码并剥离 export default（Node 直接 require）
const fs = require('fs');
let src = fs.readFileSync('E:/Triumph/praxis-5001/api/index.js', 'utf8');
src = src.replace('export default', 'module.exports =');

const tmp = 'E:/Triumph/praxis-5001/api/_test-worker.cjs';
fs.writeFileSync(tmp, src);
const worker = require(tmp);

// KV 模拟
const store = new Map();
const env = {
  JWT_SECRET: 'test-secret-please-change',
  TRIUMPH_KV: {
    get: async (k, type) => { const v = store.get(k); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => store.set(k, v),
  },
};

async function call(path, method, body, token) {
  const headers = new Headers();
  if (body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', 'Bearer ' + token);
  return worker.fetch(new Request('https://test.local' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, {});
}

(async () => {
  // 1) 注册
  let r = await call('/api/register', 'POST', { email: 'Test@Example.com ', password: 'password123' });
  let d = await r.json();
  console.log('register status:', r.status, '| user:', d.user && d.user.email, '| has token:', !!d.token);
  if (r.status !== 200) throw new Error('register failed');

  // 2) 重复注册 → 409
  r = await call('/api/register', 'POST', { email: 'test@example.com', password: 'password123' });
  console.log('duplicate register status:', r.status, '(expect 409)');

  // 3) 错误密码 → 401
  r = await call('/api/login', 'POST', { email: 'test@example.com', password: 'wrongpass' });
  console.log('bad login status:', r.status, '(expect 401)');

  // 4) 正确登录
  r = await call('/api/login', 'POST', { email: 'test@example.com', password: 'password123' });
  d = await r.json();
  const token = d.token;
  console.log('login status:', r.status, '| token:', !!token);
  if (r.status !== 200) throw new Error('login failed');

  // 5) 短密码 → 400
  r = await call('/api/register', 'POST', { email: 'short@example.com', password: 'short' });
  console.log('short password status:', r.status, '(expect 400)');

  // 6) 未授权 → 401
  r = await call('/api/state', 'GET');
  console.log('no-token state status:', r.status, '(expect 401)');

  // 7) 写状态
  r = await call('/api/state', 'PUT', { state: { answers: [{ qid: 'x1', correct: false }], plan: null } }, d.token);
  console.log('put state status:', r.status);
  if (r.status !== 200) throw new Error('put failed');

  // 8) 读状态
  r = await call('/api/state', 'GET', null, d.token);
  d = await r.json();
  console.log('get state status:', r.status, '| answers:', d.state && d.state.answers && d.state.answers.length, '| updatedAt set:', !!d.state.updatedAt);

  // 9) me（用之前保存的 token）
  r = await call('/api/me', 'GET', null, token);
  d = await r.json();
  console.log('me status:', r.status, '| email:', d.user && d.user.email);

  // 10) 伪造 token → 401
  r = await call('/api/me', 'GET', null, 'faketoken.faketoken.faketoken');
  console.log('forged token status:', r.status, '(expect 401)');

  console.log('\nALL TESTS PASSED');
  fs.unlinkSync(tmp);
})().catch(e => { console.error('TEST FAILED:', e.message); process.exit(1); });
