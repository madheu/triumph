// worker-src/admin.mjs — 后台管理 API（P0 骨架：只有管理员身份确认）
//
// 门禁模型（P0）：
//   ADMIN_EMAILS 环境变量 = 逗号分隔的管理员邮箱白名单。
//   任何有效账号都能登录主站，但只有白名单内的邮箱能通过 /api/admin/*。
//   P1 引入 users.role 字段（KV/D1）后，改为服务端角色校验，白名单作为兜底。
//
// 所有 /api/admin/* 写操作都应写审计日志（admin_audit_log，D1 表已建，
//   P1 接 D1 后启用；P0 先记录到 KV 便于查证）。

import { json, apiError } from './http.mjs';
import { bearerToken, verifyJwt } from './crypto.mjs';
import { storeResetToken, RESET_KEY } from './password.mjs';
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

export const ADMIN_ROUTES = {
  '/api/admin/me': { GET: hAdminMe },
  '/api/admin/users': { GET: hAdminUsers },
  '/api/admin/users/password-reset-link': { POST: hAdminPasswordResetLink },
};
