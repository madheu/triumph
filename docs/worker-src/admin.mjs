// worker-src/admin.mjs — 后台管理 API
//
// 门禁模型：
//   ADMIN_EMAILS 环境变量 = 逗号分隔的管理员邮箱白名单。
//   任何有效账号都能登录主站，但只有白名单内的邮箱能通过 /api/admin/*。
//
// P2 新增：题库管理（列表/详情/编辑）、内容条目 CRUD（含修订快照）、审计日志查询。
// 所有 /api/admin/* 写操作都写 admin_audit_log（D1）。
//
// 路由风格：精确路径 + query 参数（router 不支持动态段），如 /api/admin/questions/detail?id=x

import { json, apiError } from './http.mjs';
import { bearerToken, verifyJwt } from './crypto.mjs';
import { storeResetToken, RESET_KEY } from './password.mjs';
import { d1All, d1One, d1Exec, audit } from './db.mjs';
/** 管理员白名单：ADMIN_EMAILS="a@x.com,b@y.com" */
export function adminEmails(env) {
  return (env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 解析 Bearer JWT → { ok:true, user } 或 { ok:false, error:Response } */
async function resolveUser(request, env) {
  const payload = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!payload || !payload.email) return { ok: false, error: apiError('unauthorized') };
  return { ok: true, user: { id: payload.sub, email: payload.email.toLowerCase() } };
}

/** 中间件：确认 JWT 有效且 email 在管理员白名单 */
export async function requireAdmin(request, env) {
  const r = await resolveUser(request, env);
  if (!r.ok) return r.error;
  if (!adminEmails(env).includes(r.user.email)) return apiError('unauthorized');
  return r.user;
}

/** GET /api/admin/me — 当前登录者是否是管理员 */
export async function hAdminMe(request, env) {
  const user = await requireAdmin(request, env);
  if (user instanceof Response) {
    // 统一返回 { ok:false, admin:false }，避免暴露"管理员端点存在"
    return json({ ok: false, admin: false, reason: 'unauthorized' }, 200);
  }
  return json({ ok: true, admin: true, user: { id: user.id, email: user.email } });
}

/** KV 用户记录 → 后台输出（脱敏：绝不返回 saltHex/hashHex/googleSub）
 *  登录方式：authProvider='google'|'email'；googleLinked=是否绑定过 Google
 *  （邮箱注册后又绑 Google 的用户 authProvider 仍是 'email'） */
function userOut(raw, fallbackEmail) {
  return {
    id: raw.id,
    email: raw.email || fallbackEmail,
    verified: !!raw.verified,
    authProvider: raw.authProvider === 'google' ? 'google' : 'email',
    googleLinked: !!raw.googleSub,
    googleName: (raw.googleProfile && raw.googleProfile.name) || null,
    plan: raw.plan || 'free',
    subscriptionStatus: raw.subscriptionStatus || null,
    currentPeriodEnd: raw.currentPeriodEnd || null,
    creemCustomerId: raw.creemCustomerId || null,
    createdAt: raw.createdAt || null,
  };
}

/** GET /api/admin/users — 用户列表（KV users: 前缀）
 *  支持 ?email=xxx 精确查询单个用户详情 */
export async function hAdminUsers(request, env) {
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return apiError('unauthorized');

  const url = new URL(request.url);
  const emailFilter = url.searchParams.get('email');
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const cursor = url.searchParams.get('cursor') || undefined;

  // 单用户精确查询
  if (emailFilter) {
    const raw = await env.TRIUMPH_KV.get('users:' + emailFilter.toLowerCase().trim(), 'json').catch(() => null);
    if (!raw) return apiError('not_found', { field: 'email' });
    return json({ ok: true, user: userOut(raw, emailFilter) });
  }

  let page;
  try {
    page = await env.TRIUMPH_KV.list({ prefix: 'users:', limit, cursor });
  } catch (e) {
    return apiError('internal_error', { hint: 'KV list failed.' });
  }

  const items = [];
  for (const key of page.keys) {
    const email = key.name.replace(/^users:/, '');
    const raw = await env.TRIUMPH_KV.get(key.name, 'json').catch(() => null);
    if (!raw) continue;
    items.push(userOut(raw, email));
  }

  return json({ ok: true, items, count: items.length, cursor: page.cursor || null, has_more: !!page.list_complete === false });
}

/** POST /api/admin/users/password-reset-link — 管理员代办重置（返回一次性链接，30 分钟有效） */
export async function hAdminPasswordResetLink(request, env) {
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return apiError('unauthorized');
  const parsed = await request.json().catch(() => null);
  const email = String((parsed && parsed.email) || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError('invalid_email');

  const recJson = await env.TRIUMPH_KV.get('users:' + email);
  if (!recJson) return apiError('not_registered');

  const token = await storeResetToken(env, email);
  const base = env.SITE_URL || 'https://learndiag.com';
  return json({
    ok: true,
    reset_link: `${base}/reset.html?token=${token}&email=${encodeURIComponent(email)}`,
    expires_in_minutes: 30,
  });
}

/* ==================== P2 题库管理 ==================== */

/** 把 questions 行转成前端友好格式（options_json → 数组） */
function questionOut(row) {
  if (!row) return null;
  let options = row.options_json;
  try { options = typeof row.options_json === 'string' ? JSON.parse(row.options_json) : (row.options_json || []); }
  catch { options = []; }
  return { ...row, options_json: undefined, options };
}

const Q_STATUSES = ['draft', 'active', 'retired'];
const Q_DIFFICULTIES = ['easy', 'medium', 'hard'];

/** GET /api/admin/questions?subtest=&status=&q=&limit=&offset= — 题目列表（搜索+分页） */
export async function hAdminQuestions(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');

  if (!env.TRIUMPH_D1) return json({ ok: true, items: [], total: 0, note: 'D1 not bound' });

  const url = new URL(request.url);
  const subtest = (url.searchParams.get('subtest') || '').trim();
  const status = (url.searchParams.get('status') || '').trim();
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const where = []; const params = [];
  if (subtest) { where.push('subtest = ?'); params.push(subtest); }
  if (status && Q_STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (q) { where.push('(stem_md LIKE ? OR id LIKE ? OR category LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = await d1One(env, `SELECT COUNT(*) AS n FROM questions ${whereSql}`, params);
  const rows = await d1All(env,
    `SELECT * FROM questions ${whereSql} ORDER BY id LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
  if (rows === null || total === null) return apiError('internal_error', { hint: 'D1 query failed.' });

  return json({ ok: true, items: rows.map(questionOut), total: total.n, limit, offset });
}

/** GET /api/admin/questions/detail?id=5002-001 — 单题详情（含全部字段） */
export async function hAdminQuestionDetail(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return apiError('bad_request', { field: 'id' });
  const row = await d1One(env, `SELECT * FROM questions WHERE id = ?`, [id]);
  if (!row) return apiError('not_found', { field: 'id' });
  return json({ ok: true, question: questionOut(row) });
}

/** PATCH /api/admin/questions/update — 编辑题目（题干/选项/答案/解析/难度/状态），写审计 */
export async function hAdminQuestionUpdate(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');

  const body = await request.json().catch(() => null);
  if (!body || !body.id) return apiError('bad_request', { field: 'id' });
  const id = String(body.id).trim();

  const existing = await d1One(env, `SELECT * FROM questions WHERE id = ?`, [id]);
  if (!existing) return apiError('not_found', { field: 'id' });

  // 白名单字段逐一收集；未传的字段保持原值
  const sets = []; const params = [];
  if (typeof body.stem_md === 'string' && body.stem_md.trim()) { sets.push('stem_md = ?'); params.push(body.stem_md); }
  if (Array.isArray(body.options)) {
    if (body.options.length < 2 || body.options.length > 6) return apiError('bad_request', { field: 'options', hint: '2-6 options.' });
    sets.push('options_json = ?'); params.push(JSON.stringify(body.options));
  }
  if (body.answer_index !== undefined) {
    const ai = parseInt(body.answer_index, 10);
    if (isNaN(ai) || ai < 0) return apiError('bad_request', { field: 'answer_index' });
    sets.push('answer_index = ?'); params.push(ai);
  }
  if (typeof body.explanation_md === 'string') { sets.push('explanation_md = ?'); params.push(body.explanation_md); }
  if (typeof body.difficulty === 'string') {
    if (!Q_DIFFICULTIES.includes(body.difficulty)) return apiError('bad_request', { field: 'difficulty', allowed: Q_DIFFICULTIES });
    sets.push('difficulty = ?'); params.push(body.difficulty);
  }
  if (typeof body.status === 'string') {
    if (!Q_STATUSES.includes(body.status)) return apiError('bad_request', { field: 'status', allowed: Q_STATUSES });
    sets.push('status = ?'); params.push(body.status);
  }

  if (!sets.length) return apiError('bad_request', { hint: 'Nothing to update. Send at least one editable field.' });
  sets.push('updated_at = ?'); params.push(Date.now());
  params.push(id);

  const res = await d1Exec(env, `UPDATE questions SET ${sets.join(', ')} WHERE id = ?`, params);
  if (res === null) return apiError('internal_error', { hint: 'D1 update failed.' });

  await audit(env, admin.email, 'question.update', 'question', id,
    { fields: sets.filter(s => s !== 'updated_at = ?'), status: body.status || undefined });

  const updated = await d1One(env, `SELECT * FROM questions WHERE id = ?`, [id]);
  return json({ ok: true, question: questionOut(updated) });
}

/* ==================== P2 内容条目 CRUD ==================== */

const CONTENT_TYPES = ['plan', 'map', 'email', 'page', 'faq'];

/** GET /api/admin/content?type=&status= — 内容列表 */
export async function hAdminContentList(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  if (!env.TRIUMPH_D1) return json({ ok: true, items: [], note: 'D1 not bound' });

  const url = new URL(request.url);
  const type = (url.searchParams.get('type') || '').trim();
  const rows = type
    ? await d1All(env, `SELECT id, type, slug, title, status, updated_by, updated_at FROM content_items WHERE type = ? ORDER BY updated_at DESC`, [type])
    : await d1All(env, `SELECT id, type, slug, title, status, updated_by, updated_at FROM content_items ORDER BY updated_at DESC`);
  if (rows === null) return apiError('internal_error', { hint: 'D1 query failed.' });
  return json({ ok: true, items: rows });
}

/** POST /api/admin/content/create — 新建内容条目（draft 起步，存 v1 快照） */
export async function hAdminContentCreate(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');

  const body = await request.json().catch(() => null);
  if (!body) return apiError('bad_request', { hint: 'Send a JSON object.' });
  const type = String(body.type || '').trim();
  const slug = String(body.slug || '').trim().toLowerCase().replace(/\s+/g, '-');
  const title = String(body.title || '').trim();
  if (!CONTENT_TYPES.includes(type)) return apiError('bad_request', { field: 'type', allowed: CONTENT_TYPES });
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return apiError('bad_request', { field: 'slug', hint: 'lowercase letters/digits/hyphens' });
  if (!title) return apiError('bad_request', { field: 'title' });

  const dupe = await d1One(env, `SELECT id FROM content_items WHERE slug = ?`, [slug]);
  if (dupe) return apiError('conflict', { field: 'slug', hint: 'Slug already exists.' });

  const metaJson = body.meta_json ? JSON.stringify(body.meta_json) : null;
  const res = await d1Exec(env,
    `INSERT INTO content_items (id, type, slug, title, status, body_md, meta_json, updated_by, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [crypto.randomUUID(), type, slug, title, String(body.body_md || ''), metaJson, admin.email, Date.now()]);
  if (res === null) return apiError('internal_error', { hint: 'D1 insert failed.' });

  const created = await d1One(env, `SELECT * FROM content_items WHERE slug = ?`, [slug]);
  // v1 快照
  await d1Exec(env,
    `INSERT INTO content_revisions (id, item_id, version, snapshot_json, edited_by, created_at) VALUES (?, ?, 1, ?, ?, ?)`,
    [crypto.randomUUID(), created.id, JSON.stringify(created), admin.email, Date.now()]);
  await audit(env, admin.email, 'content.create', 'content_item', created.id, { type, slug });

  return json({ ok: true, item: created }, 201);
}

/** GET /api/admin/content/detail?id= — 单条详情（含 body_md 与修订历史摘要） */
export async function hAdminContentDetail(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return apiError('bad_request', { field: 'id' });
  const item = await d1One(env, `SELECT * FROM content_items WHERE id = ?`, [id]);
  if (!item) return apiError('not_found', { field: 'id' });
  const revs = await d1All(env, `SELECT version, edited_by, created_at FROM content_revisions WHERE item_id = ? ORDER BY version DESC LIMIT 20`, [id]);
  let meta = item.meta_json;
  try { meta = typeof item.meta_json === 'string' ? JSON.parse(item.meta_json) : (item.meta_json || null); } catch { /* keep raw */ }
  return json({ ok: true, item: { ...item, meta_json: undefined, meta }, revisions: revs || [] });
}

/** PUT /api/admin/content/update — 更新内容（每次保存自动存修订快照，可回滚） */
export async function hAdminContentUpdate(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');

  const body = await request.json().catch(() => null);
  if (!body || !body.id) return apiError('bad_request', { field: 'id' });
  const existing = await d1One(env, `SELECT * FROM content_items WHERE id = ?`, [String(body.id).trim()]);
  if (!existing) return apiError('not_found', { field: 'id' });

  const sets = []; const params = [];
  if (typeof body.title === 'string' && body.title.trim()) { sets.push('title = ?'); params.push(body.title.trim()); }
  if (typeof body.body_md === 'string') { sets.push('body_md = ?'); params.push(body.body_md); }
  if (body.meta_json !== undefined) { sets.push('meta_json = ?'); params.push(JSON.stringify(body.meta_json)); }
  if (typeof body.status === 'string') {
    if (!['draft', 'published'].includes(body.status)) return apiError('bad_request', { field: 'status', allowed: ['draft', 'published'] });
    sets.push('status = ?'); params.push(body.status);
  }
  if (!sets.length) return apiError('bad_request', { hint: 'Nothing to update.' });
  sets.push('updated_by = ?'); sets.push('updated_at = ?'); params.push(admin.email, Date.now());
  params.push(existing.id);

  const res = await d1Exec(env, `UPDATE content_items SET ${sets.join(', ')} WHERE id = ?`, params);
  if (res === null) return apiError('internal_error', { hint: 'D1 update failed.' });

  // 存新版本快照（version = max+1）
  const maxRev = await d1One(env, `SELECT MAX(version) AS v FROM content_revisions WHERE item_id = ?`, [existing.id]);
  const nextV = ((maxRev && maxRev.v) || 0) + 1;
  const fresh = await d1One(env, `SELECT * FROM content_items WHERE id = ?`, [existing.id]);
  await d1Exec(env,
    `INSERT INTO content_revisions (id, item_id, version, snapshot_json, edited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), existing.id, nextV, JSON.stringify(fresh), admin.email, Date.now()]);
  await audit(env, admin.email, 'content.update', 'content_item', existing.id,
    { fields: sets.filter(s => !s.startsWith('updated')), status: body.status || undefined, revision: nextV });

  return json({ ok: true, item: fresh, revision: nextV });
}

/* ==================== P1 补课：订单与订阅 ==================== */

/** GET /api/admin/orders?type=&status=&limit=&offset= — 订单列表（payment/refund，含用户邮箱 join） */
export async function hAdminOrders(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  if (!env.TRIUMPH_D1) return json({ ok: true, items: [], total: 0, note: 'D1 not bound' });

  const url = new URL(request.url);
  const type = (url.searchParams.get('type') || '').trim();
  const status = (url.searchParams.get('status') || '').trim();
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const where = []; const params = [];
  if (type && ['payment', 'refund'].includes(type)) { where.push('o.type = ?'); params.push(type); }
  if (status) { where.push('o.status = ?'); params.push(status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = await d1One(env, `SELECT COUNT(*) AS n FROM orders o ${whereSql}`, params);
  const rows = await d1All(env,
    `SELECT o.id, o.user_id, o.creem_order_id, o.amount_cents, o.currency, o.type, o.status, o.created_at, u.email AS user_email
     FROM orders o LEFT JOIN users u ON u.id = o.user_id ${whereSql}
     ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
  if (rows === null || total === null) return apiError('internal_error', { hint: 'D1 query failed.' });

  return json({ ok: true, items: rows, total: total.n, limit, offset });
}

/** GET /api/admin/subscriptions?status=&limit=&offset= — 订阅列表（Creem 生命周期） */
export async function hAdminSubscriptions(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  if (!env.TRIUMPH_D1) return json({ ok: true, items: [], total: 0, note: 'D1 not bound' });

  const url = new URL(request.url);
  const status = (url.searchParams.get('status') || '').trim();
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  const where = []; const params = [];
  if (status) { where.push('s.status = ?'); params.push(status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = await d1One(env, `SELECT COUNT(*) AS n FROM subscriptions s ${whereSql}`, params);
  const rows = await d1All(env,
    `SELECT s.id, s.user_id, s.creem_subscription_id, s.status, s.plan, s.current_period_end, s.created_at, s.canceled_at, u.email AS user_email
     FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id ${whereSql}
     ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
  if (rows === null || total === null) return apiError('internal_error', { hint: 'D1 query failed.' });

  return json({ ok: true, items: rows, total: total.n, limit, offset });
}

/* ==================== 用户详情 + 手动权益 ==================== */

/** GET /api/admin/users/detail?email= — 用户详情（资料 + 订阅 + 订单 + 做题汇总） */
export async function hAdminUserDetail(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');

  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return apiError('bad_request', { field: 'email' });

  const raw = await env.TRIUMPH_KV.get('users:' + email, 'json').catch(() => null);
  if (!raw) return apiError('not_found', { field: 'email' });

  let subscriptions = [], orders = [], attempts = null;
  if (env.TRIUMPH_D1) {
    subscriptions = (await d1All(env,
      `SELECT id, creem_subscription_id, status, plan, current_period_end, created_at, canceled_at
       FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`, [raw.id])) || [];
    orders = (await d1All(env,
      `SELECT id, creem_order_id, amount_cents, currency, type, status, created_at
       FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`, [raw.id])) || [];
    attempts = await d1One(env,
      `SELECT SUM(attempted) AS attempted, SUM(correct) AS correct, COUNT(DISTINCT date) AS active_days,
              MIN(date) AS first_date, MAX(date) AS last_date
       FROM attempts_daily WHERE user_id = ?`, [raw.id]);
  }

  return json({ ok: true, user: userOut(raw, email), subscriptions, orders, attempts });
}

/** POST /api/admin/users/set-plan { email, plan: 'free'|'pro', note? } — 手动授予/取消 Pro（写审计）
 *  授予的 Pro 无到期时间（subscriptionStatus='admin_granted'），Creem webhook 付费/到期会覆盖此状态。 */
export async function hAdminUserSetPlan(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');

  const body = await request.json().catch(() => null);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const plan = String((body && body.plan) || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError('invalid_email');
  if (!['free', 'pro'].includes(plan)) return apiError('bad_request', { field: 'plan', allowed: ['free', 'pro'] });

  const recKey = 'users:' + email;
  const recJson = await env.TRIUMPH_KV.get(recKey);
  if (!recJson) return apiError('not_registered');

  const rec = JSON.parse(recJson);
  rec.plan = plan;
  rec.subscriptionStatus = plan === 'pro' ? 'admin_granted' : null;
  rec.currentPeriodEnd = null; // 手动授予不带到期；订阅周期一律以 Creem webhook 为准
  await env.TRIUMPH_KV.put(recKey, JSON.stringify(rec));

  // D1 镜像尽力同步（行不存在先补）
  if (env.TRIUMPH_D1) {
    await d1Exec(env, `INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)`, [rec.id, email, rec.createdAt || Date.now()]);
    await d1Exec(env, `UPDATE users SET plan = ?, subscription_status = ?, current_period_end = NULL WHERE id = ?`,
      [plan, rec.subscriptionStatus, rec.id]);
  }

  await audit(env, admin.email, 'user.set_plan', 'user', email, { plan, note: (body && body.note) || undefined });

  return json({ ok: true, user: userOut(rec, email) });
}

/* ==================== 工具注册表管理 ==================== */

const TOOL_AUDIENCES = ['free', 'pro'];

/** tools 行 → 前端格式（config_json 解析为对象，enabled 转布尔） */
function toolOut(row) {
  let config = null;
  try { config = row.config_json ? JSON.parse(row.config_json) : null; }
  catch { config = row.config_json || null; }
  return { ...row, config_json: undefined, config, enabled: !!row.enabled };
}

/** GET /api/admin/tools — 全量工具（含未启用） */
export async function hAdminTools(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  if (!env.TRIUMPH_D1) return json({ ok: true, items: [], note: 'D1 not bound' });
  const rows = await d1All(env, `SELECT * FROM tools ORDER BY sort ASC, slug ASC`);
  if (rows === null) return apiError('internal_error', { hint: 'D1 query failed.' });
  return json({ ok: true, items: rows.map(toolOut) });
}

/** POST /api/admin/tools/create — 新增工具（slug 唯一，写审计） */
export async function hAdminToolCreate(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  if (!env.TRIUMPH_D1) return apiError('internal_error', { hint: 'D1 not bound' });

  const body = await request.json().catch(() => null);
  if (!body) return apiError('bad_request', { hint: 'Send a JSON object.' });
  const slug = String(body.slug || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const entry = String(body.entry || '').trim();
  const audience = body.audience === undefined || body.audience === null || body.audience === ''
    ? 'free' : String(body.audience);
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) return apiError('bad_request', { field: 'slug', hint: 'lowercase letters/digits/hyphens, 2-64 chars' });
  if (!name) return apiError('bad_request', { field: 'name' });
  if (!entry) return apiError('bad_request', { field: 'entry', hint: '前端模块路径，如 /tools/fraction-drill/index.js' });
  if (!TOOL_AUDIENCES.includes(audience)) return apiError('bad_request', { field: 'audience', allowed: TOOL_AUDIENCES });

  const dupe = await d1One(env, `SELECT slug FROM tools WHERE slug = ?`, [slug]);
  if (dupe) return apiError('conflict', { field: 'slug', hint: 'Slug already exists.' });

  const res = await d1Exec(env,
    `INSERT INTO tools (slug, name, description, icon, entry, audience, enabled, sort, config_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [slug, name, String(body.description || ''), String(body.icon || ''), entry, audience,
     body.enabled ? 1 : 0, Number.isFinite(+body.sort) ? Math.trunc(+body.sort) : 0,
     body.config === undefined || body.config === null ? null : JSON.stringify(body.config),
     Date.now()]);
  if (res === null) return apiError('internal_error', { hint: 'D1 insert failed.' });

  await audit(env, admin.email, 'tool.create', 'tool', slug, { audience, enabled: !!body.enabled });
  const created = await d1One(env, `SELECT * FROM tools WHERE slug = ?`, [slug]);
  return json({ ok: true, tool: toolOut(created) }, 201);
}

/** PUT /api/admin/tools/update — 编辑工具（开关/人群/排序/配置），写审计 */
export async function hAdminToolUpdate(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  if (!env.TRIUMPH_D1) return apiError('internal_error', { hint: 'D1 not bound' });

  const body = await request.json().catch(() => null);
  if (!body || !body.slug) return apiError('bad_request', { field: 'slug' });
  const slug = String(body.slug).trim();
  const existing = await d1One(env, `SELECT * FROM tools WHERE slug = ?`, [slug]);
  if (!existing) return apiError('not_found', { field: 'slug' });

  const sets = []; const params = [];
  if (typeof body.name === 'string' && body.name.trim()) { sets.push('name = ?'); params.push(body.name.trim()); }
  if (typeof body.description === 'string') { sets.push('description = ?'); params.push(body.description); }
  if (typeof body.icon === 'string') { sets.push('icon = ?'); params.push(body.icon); }
  if (typeof body.entry === 'string' && body.entry.trim()) { sets.push('entry = ?'); params.push(body.entry.trim()); }
  if (body.audience !== undefined) {
    if (!TOOL_AUDIENCES.includes(body.audience)) return apiError('bad_request', { field: 'audience', allowed: TOOL_AUDIENCES });
    sets.push('audience = ?'); params.push(body.audience);
  }
  if (body.enabled !== undefined) { sets.push('enabled = ?'); params.push(body.enabled ? 1 : 0); }
  if (body.sort !== undefined) {
    const n = +body.sort;
    if (!Number.isFinite(n)) return apiError('bad_request', { field: 'sort' });
    sets.push('sort = ?'); params.push(Math.trunc(n));
  }
  if (body.config !== undefined) { sets.push('config_json = ?'); params.push(body.config === null ? null : JSON.stringify(body.config)); }

  if (!sets.length) return apiError('bad_request', { hint: 'Nothing to update.' });
  sets.push('updated_at = ?'); params.push(Date.now());
  params.push(slug);

  const res = await d1Exec(env, `UPDATE tools SET ${sets.join(', ')} WHERE slug = ?`, params);
  if (res === null) return apiError('internal_error', { hint: 'D1 update failed.' });

  await audit(env, admin.email, 'tool.update', 'tool', slug,
    { fields: sets.filter(s => s !== 'updated_at = ?'), enabled: body.enabled });
  const updated = await d1One(env, `SELECT * FROM tools WHERE slug = ?`, [slug]);
  return json({ ok: true, tool: toolOut(updated) });
}

/* ==================== P2 审计日志查询 ==================== */

/** GET /api/admin/audit?limit=&action= — 最近后台操作 */
export async function hAdminAudit(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  if (!env.TRIUMPH_D1) return json({ ok: true, items: [], note: 'D1 not bound' });

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const action = (url.searchParams.get('action') || '').trim();
  const items = action
    ? await d1All(env, `SELECT * FROM admin_audit_log WHERE action = ? ORDER BY ts DESC LIMIT ?`, [action, limit])
    : await d1All(env, `SELECT * FROM admin_audit_log ORDER BY ts DESC LIMIT ?`, [limit]);
  if (items === null) return apiError('internal_error', { hint: 'D1 query failed.' });
  return json({ ok: true, items });
}

export const ADMIN_ROUTES = {
  '/api/admin/me': { GET: hAdminMe },
  '/api/admin/users': { GET: hAdminUsers },
  '/api/admin/users/detail': { GET: hAdminUserDetail },
  '/api/admin/users/set-plan': { POST: hAdminUserSetPlan },
  '/api/admin/users/password-reset-link': { POST: hAdminPasswordResetLink },
  // P1 补课：订单与订阅
  '/api/admin/orders': { GET: hAdminOrders },
  '/api/admin/subscriptions': { GET: hAdminSubscriptions },
  // 工具注册表管理
  '/api/admin/tools': { GET: hAdminTools },
  '/api/admin/tools/create': { POST: hAdminToolCreate },
  '/api/admin/tools/update': { PUT: hAdminToolUpdate },
  // P2 题库管理
  '/api/admin/questions': { GET: hAdminQuestions },
  '/api/admin/questions/detail': { GET: hAdminQuestionDetail },
  '/api/admin/questions/update': { PATCH: hAdminQuestionUpdate },
  // P2 内容管理
  '/api/admin/content': { GET: hAdminContentList },
  '/api/admin/content/create': { POST: hAdminContentCreate },
  '/api/admin/content/detail': { GET: hAdminContentDetail },
  '/api/admin/content/update': { PUT: hAdminContentUpdate },
  // P2 审计
  '/api/admin/audit': { GET: hAdminAudit },
  // D4 产品漏斗（五段可拆）
  '/api/admin/funnel': { GET: hAdminFunnel },
};

// ---------------------------------------------------------------------------
// GET /api/admin/funnel?days=7&test_code=8006&traffic_source=organic
//
// D4 验收末条：GSC 之外要有独立的产品事件看板。
//
// 计数口径：每段用 COUNT(DISTINCT visitor_id)。
//   · 不用事件条数 —— question_answer 一题一条，会把漏斗撑爆。
//   · 不用 user_id —— 漏斗前四段全是匿名用户，user_id 为 NULL。
//
// 五段定义（见 docs/analytics-events-v1.md）：
//   1 页面访问 → 开始测试      test_view        → test_start
//   2 开始测试 → 完成测试      test_start       → test_complete
//   3 完成测试 → 看见注册提示  test_complete    → signup_prompt_view
//   4 看见提示 → 开始注册      signup_prompt_view → signup_start
//   5 开始注册 → 注册成功      signup_start     → signup_success
//
// 注意：各段独立计数，不做「同一 visitor 必须逐段串联」的严格漏斗。
// 严格漏斗在样本量 < 30/月 时抖动极大，一个访客漏埋一个事件就让整条链断掉。
// 独立计数牺牲一点精确度，换来「哪一段掉得最狠」这个真正要回答的问题。
// ---------------------------------------------------------------------------

const FUNNEL_STAGES = [
  ['test_view', 'test_start', 'Visit \u2192 Started'],
  ['test_start', 'test_complete', 'Started \u2192 Completed'],
  ['test_complete', 'signup_prompt_view', 'Completed \u2192 Saw signup'],
  ['signup_prompt_view', 'signup_start', 'Saw signup \u2192 Started signup'],
  ['signup_start', 'signup_success', 'Started signup \u2192 Registered'],
];

export async function hAdminFunnel(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  if (!env.TRIUMPH_D1) return apiError('not_configured', { hint: 'D1 binding missing' });

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10) || 7, 1), 365);
  const testCode = url.searchParams.get('test_code');
  const source = url.searchParams.get('traffic_source');
  const since = Date.now() - days * 86400000;

  // 维度过滤统一拼装，避免两个查询条件漂移
  const where = ['ts >= ?'];
  const args = [since];
  if (testCode) { where.push('test_code = ?'); args.push(testCode.slice(0, 16)); }
  if (source) { where.push('traffic_source = ?'); args.push(source.slice(0, 32)); }
  const cond = where.join(' AND ');

  const rows = await env.TRIUMPH_D1
    .prepare(`SELECT event, COUNT(DISTINCT visitor_id) AS visitors
                FROM product_events
               WHERE ${cond}
               GROUP BY event`)
    .bind(...args)
    .all()
    .catch(() => ({ results: [] }));

  const counts = {};
  for (const r of rows.results || []) counts[r.event] = Number(r.visitors) || 0;

  const build = map => FUNNEL_STAGES.map(([from, to, label]) => {
    const a = map[from] || 0;
    const b = map[to] || 0;
    return {
      stage: label,
      from,
      to,
      from_visitors: a,
      to_visitors: b,
      rate: a > 0 ? Math.round((b / a) * 1000) / 1000 : null,
    };
  });

  // 按来源拆分 —— 验收要求「按 traffic_source 分别拆开看」
  const srcRows = await env.TRIUMPH_D1
    .prepare(`SELECT traffic_source, event, COUNT(DISTINCT visitor_id) AS visitors
                FROM product_events
               WHERE ts >= ?${testCode ? ' AND test_code = ?' : ''}
               GROUP BY traffic_source, event`)
    .bind(...(testCode ? [since, testCode.slice(0, 16)] : [since]))
    .all()
    .catch(() => ({ results: [] }));

  const bySource = {};
  for (const r of srcRows.results || []) {
    const k = r.traffic_source || 'unknown';
    if (!bySource[k]) bySource[k] = {};
    bySource[k][r.event] = Number(r.visitors) || 0;
  }
  const sources = {};
  for (const k of Object.keys(bySource)) {
    sources[k] = {
      top: bySource[k].test_view || 0,
      registered: bySource[k].signup_success || 0,
      funnel: build(bySource[k]),
    };
  }

  // 领域表现：哪个领域最常成为 weakest domain（10 月扩科决策用）
  const weakRows = await env.TRIUMPH_D1
    .prepare(`SELECT weakest_domain, COUNT(*) AS n
                FROM product_events
               WHERE ${cond} AND event = 'test_complete' AND weakest_domain IS NOT NULL
               GROUP BY weakest_domain
               ORDER BY n DESC
               LIMIT 10`)
    .bind(...args)
    .all()
    .catch(() => ({ results: [] }));

  return json({
    ok: true,
    window_days: days,
    filter: { test_code: testCode || null, traffic_source: source || null },
    counts,
    funnel: build(counts),
    by_traffic_source: sources,
    weakest_domains: (weakRows.results || []).map(r => ({
      domain: r.weakest_domain,
      count: Number(r.n) || 0,
    })),
  });
}
