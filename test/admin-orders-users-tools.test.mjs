// admin-orders-users-tools.test.mjs — 后台补全测试：订单/订阅列表、用户详情+手动权益、工具注册表 CRUD
// D1 用 node:sqlite 内存库做真实 SQL mock（与线上 D1 同为 SQLite 方言）
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

/** 内存 SQLite 包装成 D1 接口（prepare→bind→run/all） */
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
        run: async () => { const info = stmt().run(); return { meta: { changes: Number(info.changes) } }; },
        all: async () => ({ results: stmt().all() }),
      };
    },
  };
}

function makeEnv(kvStore = new Map(), d1 = makeD1()) {
  return {
    JWT_SECRET: 'test-secret',
    SITE_URL: 'https://learndiag.com',
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
    TRIUMPH_D1: d1,
    _d1raw: d1.raw,
  };
}

const call = (env, path, method = 'GET', body, headers = {}) =>
  worker.fetch(new Request('https://learndiag.com' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }), env, {});

async function adminToken(env, email = 'admin@triumph.com') {
  return signJwt({ sub: 'admin-1', email, iat: Date.now(), exp: Date.now() + 3600000 }, env.JWT_SECRET);
}

async function seedKVUser(env, rec) {
  await env.TRIUMPH_KV.put('users:' + rec.email, JSON.stringify(rec));
}

async function seedOrder(env, o) {
  await env._d1raw.prepare(
    `INSERT INTO orders (id, user_id, creem_order_id, amount_cents, currency, type, status, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(o.id, o.user_id, o.creem_order_id, o.amount_cents ?? 1500, o.currency || 'usd',
    o.type || 'payment', o.status || 'succeeded', '{}', o.created_at ?? Date.now());
}

async function seedSub(env, s) {
  await env._d1raw.prepare(
    `INSERT INTO subscriptions (id, user_id, creem_subscription_id, status, plan, current_period_end, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(s.id, s.user_id, s.creem_subscription_id, s.status || 'active', s.plan || 'pro',
    s.current_period_end ?? Date.now() + 86400000, s.created_at ?? Date.now());
}

/* ============ 1. 门禁 ============ */

test('订单/订阅/用户详情/工具接口：无 token 一律 401', async () => {
  const env = makeEnv();
  for (const p of ['/api/admin/orders', '/api/admin/subscriptions', '/api/admin/users/detail?email=a@x.com', '/api/admin/tools']) {
    const r = await call(env, p);
    assert.equal(r.status, 401, p);
  }
});

/* ============ 2. 订单与订阅列表 ============ */

test('订单列表：join 出用户邮箱，type 筛选生效', async () => {
  const env = makeEnv();
  await env._d1raw.prepare(`INSERT INTO users (id, email, created_at) VALUES ('u-1', 'a@x.com', ?)`).run(Date.now());
  await seedOrder(env, { id: 'o1', user_id: 'u-1', creem_order_id: 'ord_1', type: 'payment' });
  await seedOrder(env, { id: 'o2', user_id: 'u-1', creem_order_id: 'ord_2', type: 'refund', status: 'refunded' });
  await seedOrder(env, { id: 'o3', user_id: 'no-mirror', creem_order_id: 'ord_3', type: 'payment' });

  const t = await adminToken(env);
  let r = await call(env, '/api/admin/orders', 'GET', null, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 200);
  let d = await r.json();
  assert.equal(d.total, 3);
  const withEmail = d.items.find(x => x.id === 'o1');
  assert.equal(withEmail.user_email, 'a@x.com');
  const noMirror = d.items.find(x => x.id === 'o3');
  assert.equal(noMirror.user_email, null, '无镜像行时邮箱为 null');
  assert.equal(noMirror.user_id, 'no-mirror');

  r = await call(env, '/api/admin/orders?type=refund', 'GET', null, { Authorization: 'Bearer ' + t });
  d = await r.json();
  assert.equal(d.total, 1);
  assert.equal(d.items[0].id, 'o2');
});

test('订阅列表：status 筛选 + 邮箱 join', async () => {
  const env = makeEnv();
  await env._d1raw.prepare(`INSERT INTO users (id, email, created_at) VALUES ('u-1', 'a@x.com', ?)`).run(Date.now());
  await seedSub(env, { id: 's1', user_id: 'u-1', creem_subscription_id: 'sub_1', status: 'active' });
  await seedSub(env, { id: 's2', user_id: 'u-1', creem_subscription_id: 'sub_2', status: 'canceled' });

  const t = await adminToken(env);
  let r = await call(env, '/api/admin/subscriptions?status=canceled', 'GET', null, { Authorization: 'Bearer ' + t });
  let d = await r.json();
  assert.equal(d.total, 1);
  assert.equal(d.items[0].user_email, 'a@x.com');

  r = await call(env, '/api/admin/subscriptions', 'GET', null, { Authorization: 'Bearer ' + t });
  d = await r.json();
  assert.equal(d.total, 2);
});

/* ============ 3. 用户详情 + 手动权益 ============ */

test('用户详情：资料含登录方式，聚合订阅/订单/做题汇总', async () => {
  const env = makeEnv();
  await seedKVUser(env, {
    id: 'u-1', email: 'a@x.com', verified: true, createdAt: 1700000000000,
    authProvider: 'google', googleSub: 'sub-google-1',
    googleProfile: { name: 'Alice', picture: 'https://example.com/a.png' },
  });
  await seedSub(env, { id: 's1', user_id: 'u-1', creem_subscription_id: 'sub_1' });
  await seedOrder(env, { id: 'o1', user_id: 'u-1', creem_order_id: 'ord_1' });
  await env._d1raw.prepare(
    `INSERT INTO attempts_daily (date, user_id, subtest, category, attempted, correct) VALUES ('2026-08-28', 'u-1', '5002', 'counting', 10, 8)`
  ).run();
  await env._d1raw.prepare(
    `INSERT INTO attempts_daily (date, user_id, subtest, category, attempted, correct) VALUES ('2026-08-29', 'u-1', '5002', 'counting', 20, 15)`
  ).run();

  const t = await adminToken(env);
  const r = await call(env, '/api/admin/users/detail?email=a@x.com', 'GET', null, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.user.authProvider, 'google');
  assert.equal(d.user.googleName, 'Alice');
  assert.equal(d.user.googleLinked, true);
  assert.equal(d.subscriptions.length, 1);
  assert.equal(d.orders.length, 1);
  assert.equal(d.attempts.attempted, 30);
  assert.equal(d.attempts.correct, 23);
  assert.equal(d.attempts.active_days, 2);
  // 不泄露 googleSub
  assert.equal(JSON.stringify(d).includes('sub-google-1'), false);
  // 不存在的邮箱 → 404
  const r2 = await call(env, '/api/admin/users/detail?email=nope@x.com', 'GET', null, { Authorization: 'Bearer ' + t });
  assert.equal(r2.status, 404);
});

test('手动授予 Pro：KV 权益更新 + D1 镜像同步 + 写审计；非法 plan 拒绝', async () => {
  const env = makeEnv();
  await seedKVUser(env, { id: 'u-1', email: 'a@x.com', verified: true, createdAt: 1700000000000, plan: 'free' });

  const t = await adminToken(env);
  let r = await call(env, '/api/admin/users/set-plan', 'POST', { email: 'a@x.com', plan: 'pro', note: 'early bird' },
    { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 200);
  let d = await r.json();
  assert.equal(d.user.plan, 'pro');
  assert.equal(d.user.subscriptionStatus, 'admin_granted');

  // KV 权威已更新
  const rec = JSON.parse(await env.TRIUMPH_KV.get('users:a@x.com'));
  assert.equal(rec.plan, 'pro');
  assert.equal(rec.subscriptionStatus, 'admin_granted');
  assert.equal(rec.currentPeriodEnd, null);

  // D1 镜像同步（不存在则先补行）
  const mirror = env._d1raw.prepare(`SELECT plan, subscription_status FROM users WHERE id = 'u-1'`).all();
  assert.equal(mirror.length, 1);
  assert.equal(mirror[0].plan, 'pro');
  assert.equal(mirror[0].subscription_status, 'admin_granted');

  // 审计
  const audits = env._d1raw.prepare(`SELECT * FROM admin_audit_log WHERE action = 'user.set_plan'`).all();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].target_id, 'a@x.com');

  // 降回 free
  r = await call(env, '/api/admin/users/set-plan', 'POST', { email: 'a@x.com', plan: 'free' }, { Authorization: 'Bearer ' + t });
  d = await r.json();
  assert.equal(d.user.plan, 'free');
  assert.equal(d.user.subscriptionStatus, null);

  // 非法 plan → 400；未注册邮箱 → 404
  r = await call(env, '/api/admin/users/set-plan', 'POST', { email: 'a@x.com', plan: 'vip' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 400);
  r = await call(env, '/api/admin/users/set-plan', 'POST', { email: 'ghost@x.com', plan: 'pro' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 404);
});

/* ============ 4. 工具注册表 CRUD ============ */

test('工具：创建 → 公开可见；slug 冲突 409；非法 audience 400', async () => {
  const env = makeEnv();
  const t = await adminToken(env);

  let r = await call(env, '/api/admin/tools/create', 'POST',
    { slug: 'fraction-drill', name: 'Fraction Drill', entry: '/tools/fraction-drill/index.js', audience: 'pro', enabled: true, sort: 10, config: { dailyLimit: 20 } },
    { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 201);
  const tool = (await r.json()).tool;
  assert.equal(tool.slug, 'fraction-drill');
  assert.equal(tool.enabled, true);
  assert.deepEqual(tool.config, { dailyLimit: 20 });

  // slug 冲突
  r = await call(env, '/api/admin/tools/create', 'POST',
    { slug: 'fraction-drill', name: 'Dup', entry: '/x.js' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 409);

  // 非法 audience
  r = await call(env, '/api/admin/tools/create', 'POST',
    { slug: 'bad-aud', name: 'Bad', entry: '/x.js', audience: 'vip' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 400);

  // 公开 API 能看到（enabled=1）
  const pub = await call(env, '/api/tools');
  const pd = await pub.json();
  assert.equal(pd.items.length, 1);
  assert.equal(pd.items[0].slug, 'fraction-drill');
});

test('工具：update 切 enabled/audience 生效并写审计；空 slug 404', async () => {
  const env = makeEnv();
  const t = await adminToken(env);
  await call(env, '/api/admin/tools/create', 'POST',
    { slug: 'srs-plus', name: 'SRS Plus', entry: '/tools/srs-plus/index.js', audience: 'free', enabled: true },
    { Authorization: 'Bearer ' + t });

  // 关掉 → 公开不可见
  let r = await call(env, '/api/admin/tools/update', 'PUT', { slug: 'srs-plus', enabled: false, audience: 'pro' },
    { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 200);
  let pub = await call(env, '/api/tools');
  assert.equal((await pub.json()).items.length, 0);

  // 后台列表含未启用的
  r = await call(env, '/api/admin/tools', 'GET', null, { Authorization: 'Bearer ' + t });
  const d = await r.json();
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].enabled, false);
  assert.equal(d.items[0].audience, 'pro');

  // 审计两条（create + update）
  const audits = env._d1raw.prepare(`SELECT action FROM admin_audit_log WHERE target_type = 'tool' ORDER BY ts`).all();
  assert.deepEqual(audits.map(a => a.action), ['tool.create', 'tool.update']);

  // 不存在的工具 → 404
  r = await call(env, '/api/admin/tools/update', 'PUT', { slug: 'nope', enabled: true }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 404);
});
