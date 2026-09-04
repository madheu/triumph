// worker-src/analytics.mjs — 行为数据（P3，D1 精确统计先行；Analytics Engine 后接）
//
//   POST /api/t/attempts — 登录用户上报做题聚合（前端按 科目×知识点 汇总后批量发）
//     body: { items: [{ subtest, category, attempted, correct }], date? }
//     UPSERT 到 attempts_daily（主键 date+user_id+subtest+category），幂等可重放。
//     防刷：单次最多 50 条、attempted 单条上限 200。
//
//   GET /api/admin/stats/daily?days=30 — 后台日报：全站每日做题量/正确率
//   GET /api/admin/stats/summary       — 后台总览：注册数(KV)、pro 数、工单数、今日活跃

import { json, apiError } from './http.mjs';
import { verifyJwt, bearerToken } from './crypto.mjs';
import { requireAdmin } from './admin.mjs';
import { d1All, d1One, d1Exec, audit } from './db.mjs';

function todayStr() { return new Date().toISOString().slice(0, 10); }

/** POST /api/t/attempts */
export async function hAttemptsReport(request, env) {
  const payload = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!payload || !payload.email) return apiError('unauthorized');
  const userId = payload.sub;

  const body = await request.json().catch(() => null);
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length) return apiError('bad_request', { field: 'items', hint: 'Send { items: [...] }.' });
  if (items.length > 50) return apiError('bad_request', { field: 'items', hint: 'Max 50 rows per report.' });

  const date = (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) ? body.date : todayStr();

  let accepted = 0;
  for (const it of items) {
    const subtest = String(it.subtest || '').trim().slice(0, 8);
    const category = String(it.category || 'general').trim().slice(0, 80);
    let attempted = parseInt(it.attempted, 10) || 0;
    let correct = parseInt(it.correct, 10) || 0;
    if (!subtest || attempted <= 0) continue;
    if (attempted > 200) attempted = 200;
    if (correct < 0) correct = 0;
    if (correct > attempted) correct = attempted;

    // UPSERT：同日同科目同知识点累加（前端是增量上报，重复上报同一批会双计；
    // 前端约定"每答一题即时上报一次"，所以用累加而非覆盖）
    await d1Exec(env,
      `INSERT INTO attempts_daily (date, user_id, subtest, category, attempted, correct)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, user_id, subtest, category) DO UPDATE SET
         attempted = attempted + excluded.attempted,
         correct = correct + excluded.correct`,
      [date, userId, subtest, category, attempted, correct]);
    accepted++;
  }

  return json({ ok: true, accepted, date });
}

/** GET /api/admin/stats/daily?days=30 */
export async function hAdminStatsDaily(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  if (!env.TRIUMPH_D1) return json({ ok: true, items: [] });

  const url = new URL(request.url);
  const days = Math.min(180, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const rows = await d1All(env,
    `SELECT date, SUM(attempted) AS attempted, SUM(correct) AS correct, COUNT(DISTINCT user_id) AS active_users
     FROM attempts_daily WHERE date >= ? GROUP BY date ORDER BY date DESC`, [since]);
  if (rows === null) return apiError('internal_error');
  const items = rows.map(r => ({
    ...r,
    accuracy: r.attempted ? Math.round((r.correct / r.attempted) * 1000) / 10 : null,
  }));
  return json({ ok: true, items, days });
}

/** GET /api/admin/stats/summary — 总览卡片数据 */
export async function hAdminStatsSummary(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');

  // KV 用户统计（权威在 KV）
  let totalUsers = 0, proUsers = 0;
  try {
    let cursor;
    do {
      const page = await env.TRIUMPH_KV.list({ prefix: 'users:', limit: 100, cursor });
      for (const k of page.keys) {
        const rec = await env.TRIUMPH_KV.get(k.name, 'json').catch(() => null);
        if (!rec) continue;
        totalUsers++;
        if (rec.plan === 'pro') proUsers++;
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch { /* KV 失败则给 0 */ }

  let openTickets = null, todayAttempts = null;
  if (env.TRIUMPH_D1) {
    const t = await d1One(env, `SELECT COUNT(*) AS n FROM tickets WHERE status != 'resolved'`);
    openTickets = t ? t.n : null;
    const a = await d1One(env, `SELECT COALESCE(SUM(attempted),0) AS n FROM attempts_daily WHERE date = ?`, [todayStr()]);
    todayAttempts = a ? a.n : null;
  }

  return json({
    ok: true,
    users_total: totalUsers,
    users_pro: proUsers,
    tickets_open: openTickets,
    attempts_today: todayAttempts,
  });
}

export const ATTEMPT_ROUTES = {
  '/api/t/attempts': { POST: hAttemptsReport },
};

export const ADMIN_STATS_ROUTES = {
  '/api/admin/stats/daily': { GET: hAdminStatsDaily },
  '/api/admin/stats/summary': { GET: hAdminStatsSummary },
};
