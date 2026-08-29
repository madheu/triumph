// admin-gate.test.mjs — 后台管理员门禁测试（/api/admin/me）
// 覆盖四场景：无 token / 伪 token / 非管理员 / 白名单管理员（含大小写归一）
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const worker = (await import(pathToFileURL(ROOT + 'site/_worker.js').href)).default;

function makeEnv(adminEmails) {
  return { JWT_SECRET: 'test-secret', ADMIN_EMAILS: adminEmails, TRIUMPH_KV: { get: async () => null, put: async () => {}, delete: async () => {} } };
}

const call = (env, token) =>
  worker.fetch(new Request('https://learndiag.com/api/admin/me', {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  }), env, {});

async function signJwt(payload, secret) {
  const enc = new TextEncoder();
  const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const data = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return data + '.' + b64(Buffer.from(sig));
}

const token = payload => signJwt({ sub: 'u1', email: payload, iat: Date.now(), exp: Date.now() + 1e6 }, 'test-secret');

test('admin gate: no token → admin:false (200, no endpoint leak)', async () => {
  const r = await call(makeEnv('boss@triumph.com'), null);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, false);
  assert.equal(d.admin, false);
});

test('admin gate: forged token → admin:false', async () => {
  const r = await call(makeEnv('boss@triumph.com'), 'fake.token.here');
  const d = await r.json();
  assert.equal(d.admin, false);
});

test('admin gate: valid JWT but not on whitelist → admin:false', async () => {
  const r = await call(makeEnv('boss@triumph.com'), await token('attacker@evil.com'));
  const d = await r.json();
  assert.equal(d.admin, false);
});

test('admin gate: whitelisted admin (uppercase email) → admin:true', async () => {
  const r = await call(makeEnv('boss@triumph.com, other@x.com'), await token('BOSS@TRIUMPH.COM'));
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.admin, true);
  assert.equal(d.user.email, 'boss@triumph.com');
});

test('admin gate: multi-email whitelist with spaces', async () => {
  const r = await call(makeEnv('a@x.com,  b@y.com  ,c@z.com'), await token('b@y.com'));
  const d = await r.json();
  assert.equal(d.admin, true);
});
