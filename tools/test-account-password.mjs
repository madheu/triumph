/* /api/account/password 的行为测试。
 *
 * 这是安全相关的端点，每种分支都要单独走一遍：
 * 无密码账号（magic-only）设密码、有密码账号改密码、旧密码错误、
 * 新旧相同、越权。改坏了就是"别人能改你密码"或者"你自己改不了密码"。
 *
 * 跑法：node tools/test-account-password.mjs
 */
import { hAccountPassword } from '../worker-src/account-password.mjs';
import { signJwt, hashPassword } from '../worker-src/crypto.mjs';

const SECRET = 'test-secret';
const EMAIL = 'test@example.com';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   %s', name); }
  else { fail++; console.log('  FAIL %s %s', name, extra ? JSON.stringify(extra) : ''); }
}

function memKV() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    _m: m,
  };
}

function req(token, body) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token) headers.set('Authorization', 'Bearer ' + token);
  return { headers, json: async () => body };
}

async function call(env, token, body) {
  const res = await hAccountPassword(req(token, body), env);
  return { status: res.status, body: await res.json() };
}

const env = { JWT_SECRET: SECRET, TRIUMPH_KV: memKV() };
const USER_KEY = `users:${EMAIL}`;

// 一个通过 /api/magic 建出来的账号：没有密码哈希
await env.TRIUMPH_KV.put(USER_KEY, JSON.stringify({
  id: 'sub-1', email: EMAIL, verified: true, magicOnly: true, createdAt: Date.now(),
}));
const token = await signJwt({ sub: 'sub-1', email: EMAIL, exp: Date.now() + 864e5 }, SECRET);

console.log('1) 没有 token -> 401 unauthorized');
{
  const r = await call(env, null, { new_password: 'abcdefgh' });
  ok('status 401', r.status === 401, r);
  ok('code unauthorized', r.body.error && r.body.error.code === 'unauthorized', r.body.error);
}

console.log('2) 新密码少于 8 位 -> 400 password_too_short');
{
  const r = await call(env, token, { new_password: 'short' });
  ok('status 400', r.status === 400, r);
  ok('code', r.body.error && r.body.error.code === 'password_too_short', r.body.error);
}

console.log('3) magic-only 账号直接设密码 -> 成功，mode=set，magicOnly 被清掉');
{
  const r = await call(env, token, { new_password: 'firstpass123' });
  ok('status 200', r.status === 200, r);
  ok('mode=set', r.body.mode === 'set', r.body);
  const rec = JSON.parse(await env.TRIUMPH_KV.get(USER_KEY));
  ok('写入了 hashHex', !!rec.hashHex);
  ok('magicOnly 已删除', rec.magicOnly === undefined, Object.keys(rec));
  ok('记录了 passwordChangedAt', typeof rec.passwordChangedAt === 'number');
}

console.log('4) 现在有密码了，不带旧密码改 -> 400 current_password_required');
{
  const r = await call(env, token, { new_password: 'secondpass456' });
  ok('status 400', r.status === 400, r);
  ok('code', r.body.error && r.body.error.code === 'current_password_required', r.body.error);
}

console.log('5) 旧密码错误 -> 401 invalid_credentials');
{
  const r = await call(env, token, { current_password: 'wrongwrong', new_password: 'secondpass456' });
  ok('status 401', r.status === 401, r);
  ok('code', r.body.error && r.body.error.code === 'invalid_credentials', r.body.error);
  const rec = JSON.parse(await env.TRIUMPH_KV.get(USER_KEY));
  const { hashHex } = await hashPassword('firstpass123', rec.saltHex);
  ok('密码没有被改掉', rec.hashHex === hashHex);
}

console.log('6) 旧密码正确 -> 成功，mode=changed，新密码可验');
{
  const r = await call(env, token, { current_password: 'firstpass123', new_password: 'secondpass456' });
  ok('status 200', r.status === 200, r);
  ok('mode=changed', r.body.mode === 'changed', r.body);
  const rec = JSON.parse(await env.TRIUMPH_KV.get(USER_KEY));
  const { hashHex } = await hashPassword('secondpass456', rec.saltHex);
  ok('新密码哈希匹配', rec.hashHex === hashHex);
}

console.log('7) 新旧密码相同 -> 400 same_password');
{
  const r = await call(env, token, { current_password: 'secondpass456', new_password: 'secondpass456' });
  ok('status 400', r.status === 400, r);
  ok('code', r.body.error && r.body.error.code === 'same_password', r.body.error);
}

console.log('8) 越权：A 的 token 改不了 B 的账号');
{
  const other = 'victim@example.com';
  await env.TRIUMPH_KV.put(`users:${other}`, JSON.stringify({
    id: 'sub-2', email: other, verified: true, magicOnly: true,
  }));
  /* 这里必须带旧密码：到第 6 步为止 test@example.com 已经有密码了，
     不带旧密码会被 current_password_required 挡下，那就没测到"改的是谁"。
     带上旧密码走通，才能验证改动只落在持 token 者自己头上。 */
  const r = await call(env, token, { current_password: 'secondpass456', new_password: 'thirdpass789' });
  ok('持 token 者自己改成功了', r.status === 200 && r.body.email === EMAIL, r.body);
  const victim = JSON.parse(await env.TRIUMPH_KV.get(`users:${other}`));
  ok('受害者记录没被动过', victim.hashHex === undefined, victim);
  const me = JSON.parse(await env.TRIUMPH_KV.get(USER_KEY));
  const { hashHex } = await hashPassword('thirdpass789', me.saltHex);
  ok('改动落在自己账号上', me.hashHex === hashHex);
}

console.log('9) 账号不存在 -> 404 not_registered');
{
  const env2 = { JWT_SECRET: SECRET, TRIUMPH_KV: memKV() };
  const ghost = await signJwt({ sub: 'sub-9', email: 'ghost@example.com', exp: Date.now() + 864e5 }, SECRET);
  const r = await call(env2, ghost, { new_password: 'abcdefghij' });
  ok('status 404', r.status === 404, r);
  ok('code', r.body.error && r.body.error.code === 'not_registered', r.body.error);
}

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
