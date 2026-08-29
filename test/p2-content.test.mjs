// p2-content.test.mjs — P2 测试：题库管理 + 内容 CRUD + 工具注册表 + 审计日志
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

async function seedQuestion(env, q) {
  await env._d1raw.prepare(
    `INSERT INTO questions (id, subtest, category, difficulty, type, stem_md, options_json, answer_index, explanation_md, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(q.id, q.subtest || '5002', q.category || 'counting', q.difficulty || 'easy', q.type || 'knowledge',
    q.stem_md, JSON.stringify(q.options), q.answer_index ?? 0, q.explanation_md || '', q.status || 'active',
    Date.now(), Date.now());
}

/* ============ 1. 权限门禁 ============ */

test('题库接口：非管理员被拒', async () => {
  const env = makeEnv();
  const t = await adminToken(env, 'not-admin@x.com'); // 不在白名单
  const r = await call(env, '/api/admin/questions', 'GET', null, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 401);
});

test('题库接口：无 token 被拒', async () => {
  const env = makeEnv();
  const r = await call(env, '/api/admin/questions');
  assert.equal(r.status, 401);
});

/* ============ 2. 题库列表/搜索/详情 ============ */

test('题目列表：空表返回 ok 且 total=0', async () => {
  const env = makeEnv();
  const t = await adminToken(env);
  const r = await call(env, '/api/admin/questions', 'GET', null, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.deepEqual(d.items, []);
  assert.equal(d.total, 0);
});

test('题目列表：subtest 筛选 + 关键词搜索 + options 解析为数组', async () => {
  const env = makeEnv();
  await seedQuestion(env, { id: '5002-001', subtest: '5002', stem_md: 'How many apples?', options: ['1', '2', '3', '4'], answer_index: 1 });
  await seedQuestion(env, { id: '5003-001', subtest: '5003', stem_md: 'What is 2+2?', options: ['3', '4'], answer_index: 1 });

  const t = await adminToken(env);
  // 全部
  let r = await call(env, '/api/admin/questions', 'GET', null, { Authorization: 'Bearer ' + t });
  let d = await r.json();
  assert.equal(d.total, 2);
  assert.ok(Array.isArray(d.items[0].options));
  // subtest 筛选
  r = await call(env, '/api/admin/questions?subtest=5003', 'GET', null, { Authorization: 'Bearer ' + t });
  d = await r.json();
  assert.equal(d.total, 1);
  assert.equal(d.items[0].id, '5003-001');
  // 关键词搜索
  r = await call(env, '/api/admin/questions?q=apples', 'GET', null, { Authorization: 'Bearer ' + t });
  d = await r.json();
  assert.equal(d.total, 1);
  assert.equal(d.items[0].id, '5002-001');
});

test('题目详情：按 id 取单题', async () => {
  const env = makeEnv();
  await seedQuestion(env, { id: '5004-009', subtest: '5004', stem_md: 'Who was president in 1850?', options: ['A', 'B'], answer_index: 0 });
  const t = await adminToken(env);
  const r = await call(env, '/api/admin/questions/detail?id=5004-009', 'GET', null, { Authorization: 'Bearer ' + t });
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.question.stem_md, 'Who was president in 1850?');
  assert.deepEqual(d.question.options, ['A', 'B']);
  // 不存在 → not_found
  const r2 = await call(env, '/api/admin/questions/detail?id=nope', 'GET', null, { Authorization: 'Bearer ' + t });
  assert.equal(r2.status, 404);
});

/* ============ 3. 题目编辑 + 审计 ============ */

test('题目编辑：改题干/状态成功并写审计日志', async () => {
  const env = makeEnv();
  await seedQuestion(env, { id: '5002-100', stem_md: 'Old stem', options: ['a', 'b'], status: 'active' });
  const t = await adminToken(env);

  const r = await call(env, '/api/admin/questions/update', 'PATCH',
    { id: '5002-100', stem_md: 'New stem', status: 'retired', difficulty: 'hard' },
    { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.question.stem_md, 'New stem');
  assert.equal(d.question.status, 'retired');
  assert.equal(d.question.difficulty, 'hard');

  // 审计日志有记录
  const auditRows = env._d1raw.prepare(`SELECT * FROM admin_audit_log WHERE action = 'question.update'`).all();
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].target_id, '5002-100');
  assert.equal(auditRows[0].actor, 'admin@triumph.com');
});

test('题目编辑：options 必须是数组且 2-6 个；非法 status 拒绝', async () => {
  const env = makeEnv();
  await seedQuestion(env, { id: '5002-101', stem_md: 'S', options: ['a', 'b'] });
  const t = await adminToken(env);

  let r = await call(env, '/api/admin/questions/update', 'PATCH', { id: '5002-101', options: ['only-one'] }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 400);

  r = await call(env, '/api/admin/questions/update', 'PATCH', { id: '5002-101', status: 'bogus' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 400);

  // 空更新拒绝
  r = await call(env, '/api/admin/questions/update', 'PATCH', { id: '5002-101' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 400);
});

/* ============ 4. 内容 CRUD + 修订快照 + 公开读取 ============ */

test('内容：创建草稿 → 发布 → 公开可见；修订版本递增', async () => {
  const env = makeEnv();
  const t = await adminToken(env);

  // 创建
  let r = await call(env, '/api/admin/content/create', 'POST',
    { type: 'plan', slug: 'morning-plan', title: 'Morning Routine Plan', body_md: '# Morning\n\nDo X.' },
    { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 201);
  const created = (await r.json()).item;
  assert.equal(created.status, 'draft');

  // 草稿对公开 API 不可见
  let pub = await call(env, '/api/content?slug=morning-plan');
  assert.equal(pub.status, 404);

  // 发布
  r = await call(env, '/api/admin/content/update', 'PUT',
    { id: created.id, body_md: '# Morning v2\n\nDo Y.', status: 'published' },
    { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 200);
  const upd = await r.json();
  assert.equal(upd.revision, 2, '第二次保存产生 v2 快照');

  // 公开可见了
  pub = await call(env, '/api/content?slug=morning-plan');
  assert.equal(pub.status, 200);
  const pd = await pub.json();
  assert.equal(pd.item.title, 'Morning Routine Plan');
  assert.equal(pd.item.body_md, '# Morning v2\n\nDo Y.');

  // 列表模式也能看到
  pub = await call(env, '/api/content?type=plan');
  const list = await pub.json();
  assert.equal(list.items.length, 1);

  // 修订历史两条
  r = await call(env, '/api/admin/content/detail?id=' + created.id, 'GET', null, { Authorization: 'Bearer ' + t });
  const det = await r.json();
  assert.equal(det.revisions.length, 2);
  assert.equal(det.revisions[0].version, 2); // DESC
});

test('内容：slug 冲突返回 409；非法 type/slug 拒绝', async () => {
  const env = makeEnv();
  const t = await adminToken(env);
  await call(env, '/api/admin/content/create', 'POST', { type: 'plan', slug: 'dupe', title: 'T1' }, { Authorization: 'Bearer ' + t });

  let r = await call(env, '/api/admin/content/create', 'POST', { type: 'plan', slug: 'dupe', title: 'T2' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 409);

  r = await call(env, '/api/admin/content/create', 'POST', { type: 'nope', slug: 'ok-slug', title: 'T' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 400);

  r = await call(env, '/api/admin/content/create', 'POST', { type: 'plan', slug: 'Bad Slug!', title: 'T' }, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 400);
});

/* ============ 5. 工具注册表公开读取 ============ */

test('/api/tools：只返回 enabled，audience 透传，未启用不可见', async () => {
  const env = makeEnv();
  const now = Date.now();
  await env._d1raw.prepare(
    `INSERT INTO tools (slug, name, description, icon, entry, audience, enabled, sort, config_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('practice', 'Question Bank', 'Drill questions.', '📚', '/practice', 'free', 1, 20, '{"n":969}', now);
  await env._d1raw.prepare(
    `INSERT INTO tools (slug, name, description, icon, entry, audience, enabled, sort, config_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('bootcamp', 'Pro Bootcamp', 'Members only.', '🚀', '/bootcamp.html', 'pro', 0, 30, null, now);

  const r = await call(env, '/api/tools');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.items.length, 1, 'disabled 的工具不出现');
  assert.equal(d.items[0].slug, 'practice');
  assert.equal(d.items[0].audience, 'free');
  assert.deepEqual(d.items[0].config, { n: 969 });
});

/* ============ 6. 审计日志查询 ============ */

test('/api/admin/audit：管理员可查最近操作', async () => {
  const env = makeEnv();
  await seedQuestion(env, { id: '5005-001', stem_md: 'Q', options: ['a', 'b'] });
  const t = await adminToken(env);
  await call(env, '/api/admin/questions/update', 'PATCH', { id: '5005-001', difficulty: 'medium' }, { Authorization: 'Bearer ' + t });

  const r = await call(env, '/api/admin/audit', 'GET', null, { Authorization: 'Bearer ' + t });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(d.items.length >= 1);
  assert.equal(d.items[0].action, 'question.update');
});
