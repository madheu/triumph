// p3-tickets.test.mjs — P3 测试：工单系统 + 做题行为上报
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const worker = (await import(pathToFileURL(ROOT + 'site/_worker.js').href)).default;
const { signJwt } = await import(pathToFileURL(ROOT + 'worker-src/crypto.mjs').href);

function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(ROOT + 'db/schema.sql', 'utf8'));
  return {
    raw: db,
    prepare(sql) {
      const stmt = () => db.prepare(sql);
      const wrap = params => ({
        run: async () => { const info = stmt().run(...params); return { meta: { changes: Number(info.changes) } }; },
        all: async () => ({ results: stmt().all(...params) }),
      });
      return {
        bind: (...params) => wrap(params),
        run: async () => ({ meta: { changes: Number(stmt().run().changes) } }),
        all: async () => ({ results: stmt().all() }),
      };
    },
  };
}

function makeEnv(kvStore = new Map()) {
  const env = {
    JWT_SECRET: 'test-secret',
    SITE_URL: 'https://trytriumph.de5.net',
    ADMIN_EMAILS: 'admin@triumph.com',
    TRIUMPH_KV: {
      get: async (k, ty) => { const v = kvStore.get(k); return v == null ? null : (ty === 'json' ? JSON.parse(v) : v); },
      put: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); },
      list: async opts => {
        const prefix = (opts && opts.prefix) || '';
        const keys = [...kvStore.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name }));
        return { keys, cursor: null, list_complete: true };
      },
    },
  };
  env.TRIUMPH_D1 = makeD1();
  env._d1raw = env.TRIUMPH_D1.raw;
  return env;
}

const call = (env, path, method = 'GET', body, headers = {}) =>
  worker.fetch(new Request('https://trytriumph.de5.net' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }), env, {});

async function userToken(env, email = 'student@test.com') {
  return signJwt({ sub: crypto.randomUUID(), email, iat: Date.now(), exp: Date.now() + 3600000 }, env.JWT_SECRET);
}
async function adminToken(env) {
  return signJwt({ sub: 'a1', email: 'admin@triumph.com', iat: Date.now(), exp: Date.now() + 3600000 }, env.JWT_SECRET);
}

/* ============ 工单 ============ */

test('工单：未登录创建被拒；登录后创建+自查可见', async () => {
  const env = makeEnv();
  let r = await call(env, '/api/tickets', 'POST', { subject: 'Refund please', body: 'I want my money back.', refund_requested: true });
  assert.equal(r.status, 401);

  const t = await userToken(env);
  r = await call(env, '/api/tickets', 'POST', { subject: 'Refund please', body: 'I want my money back.', refund_requested: true },
    { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 201);
  const { ticket_id } = await r.json();

  r = await call(env, '/api/tickets/mine', 'GET', null, { Authorization: 'Bearer ' + t });
  const d = await r.json();
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].subject, 'Refund please');
  assert.equal(d.items[0].refund_requested, true);
  assert.equal(d.items[0].messages[0].body, 'I want my money back.');
  assert.equal(ticket_id, d.items[0].id);
});

test('工单：校验拒绝太短主题；限流每小时 5 张', async () => {
  const env = makeEnv();
  const t = await userToken(env);

  let r = await call(env, '/api/tickets', 'POST', { subject: 'ab', body: 'hello there' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 400);

  for (let i = 0; i < 5; i++) {
    r = await call(env, '/api/tickets', 'POST', { subject: 'Ticket ' + i, body: 'body text here' }, { Authorization: 'Bearer ' + t });
    assert.equal(r.status, 201);
  }
  // 第 6 张被限流
  r = await call(env, '/api/tickets', 'POST', { subject: 'One too many', body: 'blocked now' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 429);
});

test('工单：admin 回复转 pending，用户再回复重开 open；他人不可见他人工单', async () => {
  const env = makeEnv();
  const ut = await userToken(env, 'ticket-user@test.com');
  const at = await adminToken(env);

  let r = await call(env, '/api/tickets', 'POST', { subject: 'Question about billing', body: 'Charged twice?' }, { Authorization: 'Bearer ' + ut });
  const { ticket_id } = await r.json();

  // admin 回复 → pending
  r = await call(env, '/api/admin/tickets/reply', 'POST', { ticket_id, body: 'Looking into it — one moment.' }, { Authorization: 'Bearer ' + at });
  assert.equal(r.status, 200);
  let detail = await (await call(env, '/api/admin/tickets/detail?id=' + ticket_id, 'GET', null, { Authorization: 'Bearer ' + at })).json();
  assert.equal(detail.ticket.status, 'pending');
  assert.equal(detail.ticket.messages.length, 2);
  assert.equal(detail.ticket.messages[1].author, 'admin');

  // 用户再回复 → 重开 open
  r = await call(env, '/api/tickets/reply', 'POST', { ticket_id, body: 'Thanks for checking.' }, { Authorization: 'Bearer ' + ut });
  assert.equal(r.status, 200);
  detail = await (await call(env, '/api/admin/tickets/detail?id=' + ticket_id, 'GET', null, { Authorization: 'Bearer ' + at })).json();
  assert.equal(detail.ticket.status, 'open');

  // 另一个用户查不到这张工单
  const otherT = await userToken(env, 'someone-else@test.com');
  r = await call(env, '/api/tickets/reply', 'POST', { ticket_id, body: 'hijack attempt' }, { Authorization: 'Bearer ' + otherT });
  assert.equal(r.status, 404);
});

test('工单退款流：approve 写 refunds 表 + 审计日志', async () => {
  const env = makeEnv();
  const at = await adminToken(env);
  const ut = await userToken(env, 'refund-user@test.com');
  let r = await call(env, '/api/tickets', 'POST', { subject: 'Refund request', body: 'Please refund me.', refund_requested: true }, { Authorization: 'Bearer ' + ut });
  const { ticket_id } = await r.json();

  r = await call(env, '/api/admin/tickets/status', 'POST',
    { ticket_id, status: 'resolved', refund_decision: 'approve', order_id: 'ord_123', reason: 'Goodwill' },
    { Authorization: 'Bearer ' + at });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.refund.status, 'approved');

  const refunds = env._d1raw.prepare(`SELECT * FROM refunds`).all();
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].status, 'approved');
  assert.equal(refunds[0].operator, 'admin@triumph.com');

  const audits = env._d1raw.prepare(`SELECT * FROM admin_audit_log WHERE action = 'refund.approve'`).all();
  assert.equal(audits.length, 1);

  // 非法决策被拒
  r = await call(env, '/api/admin/tickets/status', 'POST', { ticket_id, refund_decision: 'maybe' }, { Authorization: 'Bearer ' + at });
  assert.equal(r.status, 400);
});

/* ============ 行为上报 ============ */

test('attempts 上报：UPSERT 同键累加，跨键独立', async () => {
  const env = makeEnv();
  const t = await userToken(env, 'drill@test.com');

  let r = await call(env, '/api/t/attempts', 'POST',
    { items: [{ subtest: '5002', category: 'counting', attempted: 10, correct: 7 }] },
    { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 200);

  // 同一天同键再来一批 → 累加
  r = await call(env, '/api/t/attempts', 'POST',
    { items: [{ subtest: '5002', category: 'counting', attempted: 5, correct: 5 }] },
    { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 200);

  const rows = env._d1raw.prepare(`SELECT * FROM attempts_daily`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attempted, 15);
  assert.equal(rows[0].correct, 12);

  // 不同科目独立行
  await call(env, '/api/t/attempts', 'POST',
    { items: [{ subtest: '5003', category: 'algebra', attempted: 8, correct: 2 }] },
    { Authorization: 'Bearer ' + t });
  const all = env._d1raw.prepare(`SELECT * FROM attempts_daily ORDER BY subtest`).all();
  assert.equal(all.length, 2);

  // correct > attempted 被钳制
  await call(env, '/api/t/attempts', 'POST',
    { items: [{ subtest: '5005', category: 'science', attempted: 3, correct: 99 }] },
    { Authorization: 'Bearer ' + t });
  const clamped = env._d1raw.prepare(`SELECT * FROM attempts_daily WHERE subtest='5005'`).all();
  assert.equal(clamped[0].correct, 3);
});

test('attempts 上报：未登录 401；空 items 400', async () => {
  const env = makeEnv();
  let r = await call(env, '/api/t/attempts', 'POST', { items: [{ subtest: '5002', category: 'x', attempted: 1, correct: 0 }] });
  assert.equal(r.status, 401);

  const t = await userToken(env);
  r = await call(env, '/api/t/attempts', 'POST', { items: [] }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 400);
});

test('后台日报与总览：聚合正确率 + 用户计数', async () => {
  const env = makeEnv();
  const at = await adminToken(env);
  const t1 = await userToken(env, 'u1@test.com');
  const t2 = await userToken(env, 'u2@test.com');

  await call(env, '/api/t/attempts', 'POST', { items: [{ subtest: '5002', category: 'c', attempted: 4, correct: 1 }] }, { Authorization: 'Bearer ' + t1 });
  await call(env, '/api/t/attempts', 'POST', { items: [{ subtest: '5003', category: 'a', attempted: 6, correct: 3 }] }, { Authorization: 'Bearer ' + t2 });

  let r = await call(env, '/api/admin/stats/daily?days=7', 'GET', null, { Authorization: 'Bearer ' + at });
  const daily = (await r.json()).items;
  assert.equal(daily.length, 1);
  assert.equal(daily[0].attempted, 10);
  assert.equal(daily[0].active_users, 2);
  assert.equal(daily[0].accuracy, 40);

  // summary：KV 里放一个 pro 一个 free
  await env.TRIUMPH_KV.put('users:a@x.com', JSON.stringify({ id: '1', plan: 'pro' }));
  await env.TRIUMPH_KV.put('users:b@x.com', JSON.stringify({ id: '2', plan: 'free' }));
  r = await call(env, '/api/admin/stats/summary', 'GET', null, { Authorization: 'Bearer ' + at });
  const s = await r.json();
  assert.equal(s.users_total, 2);
  assert.equal(s.users_pro, 1);
  assert.equal(s.attempts_today, 10);
});
