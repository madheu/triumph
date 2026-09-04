// worker-src/feedback.mjs — 站点反馈收集（匿名可提交，管理员可读）
//
// POST /api/feedback        — 任何人可提交；轻量反滥用：蜜罐字段 + 长度上限
// GET  /api/admin/feedback  — ADMIN_EMAILS 白名单可读最近反馈（KV list）
//
// 存储：TRIUMPH_KV，key = feedback:<ts>:<rand>，值为完整反馈 JSON。
// 反馈不强制登录：带了有效 Bearer token 则归因到邮箱，否则匿名。

import { json, apiError, ok, readJsonBody } from './http.mjs';
import { bearerToken, verifyJwt } from './crypto.mjs';
import { requireAdmin } from './admin.mjs';

const SOURCES = new Set(['diagnostic', 'upgrade', 'general']);
const MAX_COMMENT = 1000;

async function hFeedbackPost(request, env) {
  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const body = parsed.body || {};
  // 蜜罐：正常用户看不见也不会填；机器人填了 → 静默丢弃（返回成功避免重试）
  if (typeof body.honey === 'string' && body.honey.trim() !== '') return ok({ stored: true });

  const source = SOURCES.has(body.source) ? body.source : 'general';
  const helpful = typeof body.helpful === 'boolean' ? body.helpful : null;
  let comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (comment.length > MAX_COMMENT) comment = comment.slice(0, MAX_COMMENT);
  if (helpful === null && !comment) {
    return apiError('bad_request', { field: 'helpful|comment', expected: 'thumb vote or non-empty comment' });
  }

  // 可选身份归因（失败不阻塞匿名提交）
  let email = null;
  try {
    const user = await verifyJwt(bearerToken(request), env.JWT_SECRET);
    if (user && user.email) email = user.email;
  } catch (e) {}

  const ts = Date.now();
  const key = `feedback:${ts}:${Math.random().toString(36).slice(2, 8)}`;
  await env.TRIUMPH_KV.put(key, JSON.stringify({
    source,
    helpful,
    comment: comment || null,
    email,
    ts,
    ua: (request.headers.get('user-agent') || '').slice(0, 200),
  }));
  return ok({ stored: true });
}

async function hFeedbackList(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  // KV list 按字典序返回；时间戳前缀同长，反转即最新在前
  const list = await env.TRIUMPH_KV.list({ prefix: 'feedback:', limit: 100 });
  const items = [];
  for (const k of list.keys.slice().reverse()) {
    const raw = await env.TRIUMPH_KV.get(k.name, 'json').catch(() => null);
    if (raw) items.push({ key: k.name, ...raw });
  }
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return json({ items, count: items.length });
}

export const FEEDBACK_ROUTES = {
  '/api/feedback':       { POST: hFeedbackPost },
  '/api/admin/feedback': { GET: hFeedbackList },
};
