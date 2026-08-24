// worker-src/tickets.mjs — 工单系统（P3）
//
// 拍板决策：退款走工单制。用户开票申请退款 → 后台审核 → 批准后标记 refunds 表并
// （人工或后续自动化）在 Creem 控制台执行实际退款；webhook refund.created 会回写订单状态。
//
// 用户端（需登录）：
//   POST /api/tickets          { subject, body, refund_requested? }  开新工单
//   GET  /api/tickets/mine                                            我的工单+消息
//   POST /api/tickets/reply    { ticket_id, body }                    追加消息
//
// 管理端（requireAdmin）：
//   GET  /api/admin/tickets                 列表（?status= 过滤）
//   GET  /api/admin/tickets/detail?id=      详情含消息
//   POST /api/admin/tickets/reply           回复
//   POST /api/admin/tickets/status          改状态 resolved/pending/open；refund approve/reject 写 refunds 表
//
// 限流：每用户每小时最多 5 张新工单（KV 计数），防灌水。

import { json, apiError } from './http.mjs';
import { verifyJwt, bearerToken } from './crypto.mjs';
import { requireAdmin } from './admin.mjs';
import { d1All, d1One, d1Exec, audit } from './db.mjs';

const TICKET_STATUSES = ['open', 'pending', 'resolved'];

async function resolveUser(request, env) {
  const payload = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!payload || !payload.email) return null;
  return { id: payload.sub, email: payload.email.toLowerCase() };
}

/* ==================== 用户端 ==================== */

/** POST /api/tickets */
export async function hTicketCreate(request, env) {
  const user = await resolveUser(request, env);
  if (!user) return apiError('unauthorized');

  // 先校验参数（被拒的非法请求不消耗限流配额）
  const body = await request.json().catch(() => null);
  if (!body) return apiError('bad_request');
  const subject = String(body.subject || '').trim().slice(0, 200);
  const text = String(body.body || '').trim().slice(0, 4000);
  if (subject.length < 3) return apiError('bad_request', { field: 'subject', hint: 'Subject must be at least 3 characters.' });
  if (text.length < 3) return apiError('bad_request', { field: 'body', hint: 'Describe your issue in the message.' });
  const refundRequested = body.refund_requested ? 1 : 0;

  // 限流：5 张/小时/用户（只对合法请求计数）
  const rlKey = `rl:tickets:${user.email}:${Math.floor(Date.now() / 3600000)}`;
  const cur = parseInt((await env.TRIUMPH_KV.get(rlKey)) || '0', 10);
  if (cur >= 5) return apiError('too_many_requests', { hint: 'Too many tickets opened. Try again later.' });
  await env.TRIUMPH_KV.put(rlKey, String(cur + 1), { expirationTtl: 3700 });

  const id = crypto.randomUUID();
  const res = await d1Exec(env,
    `INSERT INTO tickets (id, user_id, subject, status, refund_requested, created_at) VALUES (?, ?, ?, 'open', ?, ?)`,
    [id, user.id, subject, refundRequested, Date.now()]);
  if (res === null && !env.TRIUMPH_D1) return apiError('internal_error', { hint: 'Ticket storage unavailable.' });

  await d1Exec(env,
    `INSERT INTO ticket_messages (id, ticket_id, author, body, created_at) VALUES (?, ?, 'user', ?, ?)`,
    [crypto.randomUUID(), id, text, Date.now()]);
  await audit(env, user.email, 'ticket.create', 'ticket', id, { subject, refund_requested: !!refundRequested });

  return json({ ok: true, ticket_id: id }, 201);
}

/** GET /api/tickets/mine — 我的工单（含各自消息） */
export async function hTicketMine(request, env) {
  const user = await resolveUser(request, env);
  if (!user) return apiError('unauthorized');
  if (!env.TRIUMPH_D1) return json({ ok: true, items: [] });

  const tickets = await d1All(env,
    `SELECT id, subject, status, refund_requested, created_at, resolved_at FROM tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [user.id]);
  if (tickets === null) return apiError('internal_error');
  for (const t of tickets) {
    t.messages = (await d1All(env,
      `SELECT author, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC`, [t.id])) || [];
    t.refund_requested = !!t.refund_requested;
  }
  return json({ ok: true, items: tickets });
}

/** POST /api/tickets/reply — 用户追加消息（已 resolved 的工单重开为 open） */
export async function hTicketReply(request, env) {
  const user = await resolveUser(request, env);
  if (!user) return apiError('unauthorized');

  const body = await request.json().catch(() => null);
  const ticketId = String((body && body.ticket_id) || '').trim();
  const text = String((body && body.body) || '').trim().slice(0, 4000);
  if (!ticketId || text.length < 1) return apiError('bad_request', { field: !ticketId ? 'ticket_id' : 'body' });

  const t = await d1One(env, `SELECT id, status, user_id FROM tickets WHERE id = ?`, [ticketId]);
  if (!t || t.user_id !== user.id) return apiError('not_found', { field: 'ticket_id' }); // 不暴露他人工单存在性

  await d1Exec(env, `INSERT INTO ticket_messages (id, ticket_id, author, body, created_at) VALUES (?, ?, 'user', ?, ?)`,
    [crypto.randomUUID(), ticketId, text, Date.now()]);
  // 用户追加消息后：pending/resolved 都重开为 open（表示等待管理员再次响应）
  if (t.status === 'resolved' || t.status === 'pending') {
    await d1Exec(env, `UPDATE tickets SET status = 'open', resolved_at = NULL WHERE id = ?`, [ticketId]);
  }
  return json({ ok: true });
}

/* ==================== 管理端 ==================== */

/** GET /api/admin/tickets?status= */
export async function hAdminTickets(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  if (!env.TRIUMPH_D1) return json({ ok: true, items: [] });

  const url = new URL(request.url);
  const status = (url.searchParams.get('status') || '').trim();
  const rows = status
    ? await d1All(env, `SELECT * FROM tickets WHERE status = ? ORDER BY created_at DESC LIMIT 100`, [status])
    : await d1All(env, `SELECT * FROM tickets ORDER BY created_at DESC LIMIT 100`);
  if (rows === null) return apiError('internal_error');
  const items = [];
  for (const t of rows) {
    t.refund_requested = !!t.refund_requested;
    // 附用户邮箱（D1 users 镜像可能缺，fallback 显示 user_id）
    const u = await d1One(env, `SELECT email FROM users WHERE id = ?`, [t.user_id]);
    items.push({ ...t, user_email: u ? u.email : t.user_id });
  }
  return json({ ok: true, items });
}

/** GET /api/admin/tickets/detail?id= */
export async function hAdminTicketDetail(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return apiError('bad_request', { field: 'id' });
  const t = await d1One(env, `SELECT * FROM tickets WHERE id = ?`, [id]);
  if (!t) return apiError('not_found', { field: 'id' });
  t.messages = (await d1All(env, `SELECT author, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC`, [id])) || [];
  t.refund_requested = !!t.refund_requested;
  return json({ ok: true, ticket: t });
}

/** POST /api/admin/tickets/reply */
export async function hAdminTicketReply(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  const body = await request.json().catch(() => null);
  const ticketId = String((body && body.ticket_id) || '').trim();
  const text = String((body && body.body) || '').trim().slice(0, 4000);
  if (!ticketId || !text) return apiError('bad_request', { field: !ticketId ? 'ticket_id' : 'body' });
  const t = await d1One(env, `SELECT id FROM tickets WHERE id = ?`, [ticketId]);
  if (!t) return apiError('not_found', { field: 'ticket_id' });

  await d1Exec(env, `INSERT INTO ticket_messages (id, ticket_id, author, body, created_at) VALUES (?, ?, 'admin', ?, ?)`,
    [crypto.randomUUID(), ticketId, text, Date.now()]);
  // admin 回复后转 pending（等用户确认）
  await d1Exec(env, `UPDATE tickets SET status = 'pending' WHERE id = ? AND status = 'open'`, [ticketId]);
  await audit(env, admin.email, 'ticket.reply', 'ticket', ticketId, {});
  return json({ ok: true });
}

/**
 * POST /api/admin/tickets/status — 改状态 / 处理退款请求
 * body: { ticket_id, status?, refund_decision?: 'approve'|'reject', order_id?, reason? }
 * refund_decision=approve → refunds 表插 approved 行（实际打款在 Creem 控制台人工执行；
 * webhook refund.created 收到后自动把订单标 refunded 并插入 processed 行）
 */
export async function hAdminTicketStatus(request, env) {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return apiError('unauthorized');
  const body = await request.json().catch(() => null);
  const ticketId = String((body && body.ticket_id) || '').trim();
  if (!ticketId) return apiError('bad_request', { field: 'ticket_id' });
  const t = await d1One(env, `SELECT * FROM tickets WHERE id = ?`, [ticketId]);
  if (!t) return apiError('not_found', { field: 'ticket_id' });

  const status = body.status;
  if (status !== undefined) {
    if (!TICKET_STATUSES.includes(status)) return apiError('bad_request', { field: 'status', allowed: TICKET_STATUSES });
    await d1Exec(env, `UPDATE tickets SET status = ?, resolved_at = ? WHERE id = ?`,
      [status, status === 'resolved' ? Date.now() : null, ticketId]);
  }

  let refundResult = null;
  const decision = body.refund_decision;
  if (decision) {
    if (!['approve', 'reject'].includes(decision)) return apiError('bad_request', { field: 'refund_decision', allowed: ['approve', 'reject'] });
    const rid = crypto.randomUUID();
    await d1Exec(env,
      `INSERT OR REPLACE INTO refunds (id, order_id, creem_refund_id, reason, status, operator, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      [rid, body.order_id || null, String(body.reason || ('ticket:' + ticketId)).slice(0, 500),
       decision === 'approve' ? 'approved' : 'rejected', admin.email, Date.now()]);
    // 关联工单标记
    await audit(env, admin.email, decision === 'approve' ? 'refund.approve' : 'refund.reject', 'ticket', ticketId,
      { order_id: body.order_id || null, refund_row: rid });
    refundResult = { refund_row: rid, status: decision === 'approve' ? 'approved' : 'rejected',
      note: 'Execute the actual refund in the Creem dashboard; the refund.created webhook will mark the order refunded.' };
  }

  await audit(env, admin.email, 'ticket.status', 'ticket', ticketId, { status: status || undefined });
  return json({ ok: true, refund: refundResult });
}

export const TICKET_ROUTES = {
  '/api/tickets': { POST: hTicketCreate },
  '/api/tickets/mine': { GET: hTicketMine },
  '/api/tickets/reply': { POST: hTicketReply },
};

export const ADMIN_TICKET_ROUTES = {
  '/api/admin/tickets': { GET: hAdminTickets },
  '/api/admin/tickets/detail': { GET: hAdminTicketDetail },
  '/api/admin/tickets/reply': { POST: hAdminTicketReply },
  '/api/admin/tickets/status': { POST: hAdminTicketStatus },
};
