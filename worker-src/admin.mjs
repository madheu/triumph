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

/** GET /api/admin/users — 用户列表（KV users: 前缀，脱敏：绝不返回 saltHex/hashHex）
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
    return json({
      ok: true, user: {
        id: raw.id, email: raw.email || emailFilter, verified: !!raw.verified,
        plan: raw.plan || 'free', subscriptionStatus: raw.subscriptionStatus || null,
        currentPeriodEnd: raw.currentPeriodEnd || null, creemCustomerId: raw.creemCustomerId || null,
        createdAt: raw.createdAt || null,
      },
    });
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
    items.push({
      id: raw.id,
      email: raw.email || email,
      verified: !!raw.verified,
      plan: raw.plan || 'free',
      subscriptionStatus: raw.subscriptionStatus || null,
      currentPeriodEnd: raw.currentPeriodEnd || null,
      creemCustomerId: raw.creemCustomerId || null,
      createdAt: raw.createdAt || null,
    });
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
  const base = env.SITE_URL || 'https://trytriumph.de5.net';
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
  '/api/admin/users/password-reset-link': { POST: hAdminPasswordResetLink },
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
};
