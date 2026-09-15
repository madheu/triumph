// worker-src/billing.mjs — Creem 收银台（P1，test mode 开发）
//
// Creem 是 Merchant of Record（MoR）：扣款、税务、拒付都由 Creem 处理。
// 我们只做三件事：
//   1. POST /api/billing/checkout  → 创建/复用 Creem customer，返回托管结账页 URL
//   2. POST /api/billing/webhook   → 接收 Creem 事件（HMAC 验签 + 幂等），更新 D1 订单/订阅
//   3. POST /api/billing/portal    → 返回 Creem 客户门户 URL（换卡/取消/发票）
// 权益判定以 D1 subscriptions 表为准（webhook 是唯一写入源），前端只做展示。
//
// 参考：https://docs.creem.io（REST base https://api.creem.io/v1，测试 https://test-api.creem.io/v1）
// 环境变量：CREEM_API_KEY（生产）、CREEM_TEST_API_KEY（测试，可选）、CREEM_WEBHOOK_SECRET、CREEM_PRODUCT_ID、CREEM_MODE=test|live

import { json, apiError, safeFetch, readJsonBody } from './http.mjs';
import { verifyJwt, bearerToken } from './crypto.mjs';

const CREEM_BASE = env => (env.CREEM_MODE === 'test' ? 'https://test-api.creem.io/v1' : 'https://api.creem.io/v1');
const CREEM_KEY = env => (env.CREEM_MODE === 'test' ? env.CREEM_TEST_API_KEY : env.CREEM_API_KEY);

/** 一次性诊断报告产品（$9.99）。test / live 各一个，Creem 两边数据隔离。 */
const REPORT_PRODUCT = env => (env.CREEM_MODE === 'test'
  ? (env.CREEM_TEST_REPORT_PRODUCT_ID || env.CREEM_REPORT_PRODUCT_ID)
  : env.CREEM_REPORT_PRODUCT_ID);

/** 报告凭证的 KV 键。挂在匿名 visitor_id 上，因为「不登录也能买」。 */
const creditKey = (visitorId) => 'report_credit:' + String(visitorId);

/** 简单 UUID（crypto.randomUUID 已全局可用） */
const uuid = () => crypto.randomUUID();

/** 写 D1（如果绑定存在；P1 前期 D1 可能未就绪，失败不阻断 checkout 流程）
 *  注意：D1 是订单/订阅**镜像**，不是权益来源。权益以 KV 为准（见 grantEntitlement）。
 *  D1 写失败只降级不抛错，但会把 d1_degraded 标记回传给 Creem 便于发现。 */
async function d1Exec(env, sql, params = []) {
  if (!env.TRIUMPH_D1) return null;
  try {
    const stmt = env.TRIUMPH_D1.prepare(sql);
    const res = await (params.length ? stmt.bind(...params) : stmt).run();
    return res;
  } catch (e) {
    console.error('d1 error:', String(e && e.message || e));
    return null;
  }
}

/** 从 KV 用户记录补全 D1 users 镜像（P1 简易同步） */
async function ensureUserMirror(env, userId, email) {
  await d1Exec(env, `INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)`, [userId, email, Date.now()]);
}

/** POST /api/billing/report-checkout — 一次性诊断报告结账（**无需登录**）
 *
 *  产品上「对的可以不登录购买完整报告」，所以这里不解析 JWT。
 *  metadata.kind='report' 是给 webhook 用的分叉标记：checkout.completed 时靠它
 *  决定是发「一次性报告凭证」还是发「Pro 订阅权益」。少了这个标记，
 *  一个 $9.9 的一次性购买会被当成订阅、白送 Pro。
 */
export async function hReportCheckout(request, env) {
  const key = CREEM_KEY(env);
  if (!key) return apiError('internal_error', { hint: 'Creem not configured yet.' });
  const productId = REPORT_PRODUCT(env);
  if (!productId) return apiError('internal_error', { hint: 'CREEM_REPORT_PRODUCT_ID not configured.' });

  const body = await readJsonBody(request);
  if (body.err) return body.err;
  const visitorId = String((body.body && body.body.visitor_id) || '').slice(0, 64);
  if (!visitorId) return apiError('bad_request', { field: 'visitor_id' });

  // 已登录用户带上邮箱，凭证同时挂到账号上（换了浏览器也能拿回报告）
  const user = await resolveUser(request, env).catch(() => null);

  // 回跳必须落在**诊断页**：site/js/report.js 只在诊断页被引入，它靠
  // localStorage 里的 triumph_last_attempt + visitor_id 去换报告。
  // 2026-09-10 曾错写成 '/report.html'（该文件不存在，线上 404）——
  // 症状是「钱付了、落到 404、报告拿不到」。改这里前先 curl 确认路由 200。
  const successUrl = (env.SITE_URL || 'https://learndiag.com') + '/diagnostic?purchase=done';
  const chkRes = await safeFetch(CREEM_BASE(env) + '/checkouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      product_id: productId,
      ...(user ? { customer: { email: user.email } } : {}),
      success_url: successUrl,
      metadata: { kind: 'report', visitor_id: visitorId, ...(user ? { user_id: user.id, email: user.email } : {}) },
    }),
  });
  if (!chkRes.ok) {
    const t = await chkRes.text().catch(() => '');
    console.error('creem report checkout err:', chkRes.status, t.slice(0, 300));
    return apiError('internal_error', { hint: 'Could not create checkout.' });
  }
  const chk = await chkRes.json();
  return json({ ok: true, checkout_url: chk.checkout_url || chk.checkoutUrl, checkout_id: chk.id });
}

/** 发放一次性报告凭证（幂等：同一订单重复投递只发一次） */
async function grantReportCredit(env, visitorId, obj, orderId) {
  if (!visitorId) {
    console.error('report credit skipped — checkout.completed has no visitor_id in metadata');
    return { report_credit: 'skipped_no_visitor_id' };
  }
  const k = creditKey(visitorId);
  let cur = null;
  try { cur = await env.TRIUMPH_KV.get(k, 'json'); } catch (e) { cur = null; }
  if (cur && cur.order_id === orderId) return { report_credit: 'already_granted' };
  const next = {
    report_product: true,
    order_id: orderId || null,
    issued_at: Date.now(),
    used_attempts: (cur && Array.isArray(cur.used_attempts)) ? cur.used_attempts : [],
  };
  await env.TRIUMPH_KV.put(k, JSON.stringify(next), { expirationTtl: 60 * 60 * 24 * 180 });
  return { report_credit: 'granted', visitor_id: visitorId };
}

/** POST /api/billing/checkout — 创建结账会话（需登录） */
export async function hBillingCheckout(request, env) {
  const user = await resolveUser(request, env);
  if (!user) return apiError('unauthorized');

  const key = CREEM_KEY(env);
  if (!key) return apiError('internal_error', { hint: 'Creem not configured yet.' });
  // test/live 环境各自有独立的产品（Creem 测试与生产数据隔离）
  const productId = env.CREEM_MODE === 'test' ? (env.CREEM_TEST_PRODUCT_ID || env.CREEM_PRODUCT_ID) : env.CREEM_PRODUCT_ID;
  if (!productId) return apiError('internal_error', { hint: 'CREEM_PRODUCT_ID not configured.' });

  // 创建 checkout（Creem REST 用 snake_case 字段；customer.email 直接传无需预建）
  // 回跳带 checkout=done：前端据此轮询 /api/me，等 webhook 落权后再显示状态，
  // 避免"钱付了但页面还显示 FREE"这个最容易被当成掉单的瞬间。
  const successUrl = (env.SITE_URL || 'https://learndiag.com') + '/upgrade.html?checkout=done';
  const chkRes = await safeFetch(CREEM_BASE(env) + '/checkouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      product_id: productId,
      customer: { email: user.email },
      success_url: successUrl,
      metadata: { user_id: user.id, email: user.email },
    }),
  });
  if (!chkRes.ok) {
    const t = await chkRes.text().catch(() => '');
    console.error('creem checkout err:', chkRes.status, t.slice(0, 300));
    return apiError('internal_error', { hint: 'Could not create checkout.' });
  }
  const chk = await chkRes.json();
  return json({ ok: true, checkout_url: chk.checkout_url || chk.checkoutUrl, checkout_id: chk.id });
}

/** POST /api/billing/webhook — Creem 事件回调（验签 + 幂等）
 *
 *  ★ 静默掉单防线（2026-09-10 加）：
 *    1. 没配 webhook secret 时**拒绝**而不是放行 —— 否则任何人 POST 一个
 *       {"eventType":"checkout.completed","object":{"customer":{"email":"..."}}}
 *       就能白拿 Pro。
 *    2. 发权益（grantEntitlement）失败必须 5xx，让 Creem 按 30s/5m/30m/6h 重试。
 *       以前这里不管成败都返回 200，等于告诉 Creem "收到了"，就再也不会重投 —— 
 *       用户扣了钱、KV 里却没写 plan=pro，前端一直显示 FREE。这就是隐形掉单。
 */
export async function hBillingWebhook(request, env) {
  const secret = env.CREEM_MODE === 'test' ? (env.CREEM_TEST_WEBHOOK_SECRET || env.CREEM_WEBHOOK_SECRET) : env.CREEM_WEBHOOK_SECRET;
  const raw = await request.text();
  const signature = request.headers.get('creem-signature') || '';

  // 没有 secret 就无法验证来源：fail closed（Creem 会重试，配好 secret 后自动补投）
  if (!secret) {
    console.error('creem webhook: no webhook secret configured for mode=' + (env.CREEM_MODE || 'live') + ' — rejected');
    return json({ ok: false, error: 'webhook_secret_not_configured' }, 503);
  }

  // HMAC-SHA256 验签
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = hexToBytes(signature);
  const ok = sigBytes.length === 32 && await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(raw));
  if (!ok) return json({ ok: false, error: 'bad signature' }, 401);

  let evt;
  try { evt = JSON.parse(raw); } catch { return json({ ok: false, error: 'bad json' }, 400); }

  const eventType = evt.eventType || evt.type;
  const eventId = evt.id || (evt.data && evt.data.id) || uuid();
  const obj = evt.object || evt.data || evt;

  // 幂等：已处理过则跳过
  const processed = await d1Exec(env, `INSERT OR IGNORE INTO webhook_events (id, type, payload, received_at) VALUES (?, ?, ?, ?)`, [eventId, eventType, raw, Date.now()]);
  if (processed && processed.meta && processed.meta.changes === 0) {
    return json({ ok: true, duplicate: true });
  }

  // 根据事件类型更新订阅/订单（D1）
  let result;
  try {
    result = await handleCreemEvent(env, eventType, obj);
  } catch (e) {
    console.error('webhook handle err:', eventType, String(e && e.message || e));
    // 非 2xx → Creem 重投（5 次 / 24 小时内）
    return json({ ok: false, error: 'handler failed' }, 500);
  }
  await d1Exec(env, `UPDATE webhook_events SET processed_at = ? WHERE id = ?`, [Date.now(), eventId]);
  return json({ ok: true, ...(result || {}) });
}

/** 授予/更新 Pro 权益（KV 是唯一权益来源，前端 /api/me 读它）
 *  失败时**抛错**，由 hBillingWebhook 转成 5xx 让 Creem 重投。
 *  返回 { entitlement } 供 webhook 响应体回传，方便在 Creem 后台直接看出问题。 */
async function grantEntitlement(env, email, patch) {
  if (!email) throw new Error('cannot grant entitlement: payload has no customer.email');
  const k = 'users:' + String(email).toLowerCase();
  const recJson = await env.TRIUMPH_KV.get(k);
  if (!recJson) {
    // 付了钱但本地没有这个邮箱的账号：不能静默放过，否则永远查不出来
    console.error('entitlement skipped — no local user record for', email);
    return { entitlement: 'skipped_no_user', email };
  }
  const rec = JSON.parse(recJson);
  Object.assign(rec, patch);
  await env.TRIUMPH_KV.put(k, JSON.stringify(rec));
  return { entitlement: 'granted', email };
}

/** 降级/改状态：同样写 KV，同样不允许静默失败 */
async function patchEntitlement(env, email, patch) {
  if (!email) return { entitlement: 'skipped_no_email' };
  const k = 'users:' + String(email).toLowerCase();
  const recJson = await env.TRIUMPH_KV.get(k);
  if (!recJson) {
    console.error('entitlement patch skipped — no local user record for', email);
    return { entitlement: 'skipped_no_user', email };
  }
  const rec = JSON.parse(recJson);
  Object.assign(rec, patch);
  await env.TRIUMPH_KV.put(k, JSON.stringify(rec));
  return { entitlement: 'patched', email };
}

async function handleCreemEvent(env, eventType, obj) {
  // 真实 payload 结构（已对照 docs.creem.io/code/webhooks 逐字段核实 2026-09-10）：
  //   checkout.completed → obj = checkout：obj.order / obj.customer(对象,含 email) /
  //                        obj.product / obj.subscription(含 metadata) / obj.metadata
  //   subscription.*     → obj = subscription：obj.customer(对象,含 email) /
  //                        obj.metadata(注意 subscription.active 与 .expired **没有** metadata)
  //   ⚠️ obj.order.customer 只是 "cust_xxx" 字符串，不是对象 —— 取邮箱一律用 obj.customer.email
  const order = obj.order || {};
  const customer = obj.customer || {};
  const checkout = obj.checkout || {};
  const sub = (obj.object === 'subscription' ? obj : obj.subscription) || {};
  const metadata = obj.metadata || {};
  // refund.created 的 payload 把 checkout/customer 嵌在 obj.checkout 下面
  const email = customer.email
    || (checkout.customer && checkout.customer.email)
    || metadata.email
    || (checkout.metadata && checkout.metadata.email)
    || '';
  const userId = metadata.user_id || (sub.metadata && sub.metadata.user_id) || null;

  const subId = sub.id || null;
  const status = sub.status || order.status || null;
  const plan = 'pro';
  // Creem 字段是 current_period_end_date（不是 current_period_end）
  const periodEnd = sub.current_period_end_date || sub.current_period_end || null;
  const amountCents = order.amount ?? null;
  const currency = order.currency || 'usd';
  const orderId = order.id || null;
  const out = {};

  // checkout metadata 决定这次购买到底是什么。缺了这个分叉，一笔 $9.9 的
  // 一次性报告结账会掉进下面的 GRANT 分支变成白送 Pro。
  const kind = metadata.kind || (checkout.metadata && checkout.metadata.kind) || null;
  const visitorId = metadata.visitor_id || (checkout.metadata && checkout.metadata.visitor_id) || null;

  if (kind === 'report') {
    if (eventType === 'checkout.completed' || eventType === 'subscription.paid') {
      Object.assign(out, await grantReportCredit(env, visitorId, obj, orderId));
      if (orderId) {
        const r = await d1Exec(env, `INSERT OR REPLACE INTO orders (id, user_id, creem_order_id, amount_cents, currency, type, status, raw_json, created_at)
          VALUES (?, ?, ?, ?, ?, 'report', 'succeeded', ?, ?)`,
          ['order:' + orderId, userId, orderId, amountCents, currency, JSON.stringify(obj), Date.now()]);
        if (!r) out.d1_degraded = true;
      }
    }
    return out;
  }

  const GRANT = ['checkout.completed', 'subscription.paid', 'subscription.active'];

  if (GRANT.includes(eventType)) {
    // 订单/订阅落库（D1 是镜像；失败降级但不阻断权益）
    if (orderId) {
      const oid = 'order:' + orderId;
      const r = await d1Exec(env, `INSERT OR REPLACE INTO orders (id, user_id, creem_order_id, amount_cents, currency, type, status, raw_json, created_at)
        VALUES (?, ?, ?, ?, ?, 'payment', 'succeeded', ?, ?)`,
        [oid, userId, orderId, amountCents, currency, JSON.stringify(obj), Date.now()]);
      if (!r) out.d1_degraded = true;
    } else if (order && order.status) {
      // 有 order 但无 id 说明 payload 形状可能又变了 —— 留痕
      console.warn('creem webhook: order present but no id', eventType);
    }

    if (subId) {
      const r = await d1Exec(env, `INSERT OR REPLACE INTO subscriptions (id, user_id, creem_subscription_id, status, plan, current_period_end, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [subId, userId, subId, status || 'active', plan, periodEnd, Date.now()]);
      if (!r) out.d1_degraded = true;
    }

    // ★ 权益（会抛错 → 5xx → Creem 重投）
    Object.assign(out, await grantEntitlement(env, email, {
      plan: 'pro',
      subscriptionStatus: status || 'active',
      currentPeriodEnd: periodEnd || null,
      creemCustomerId: customer.id || null,
    }));
    await ensureUserMirror(env, userId, email);
    if (!userId) out.mirror_skipped = 'no userId in payload metadata';
  } else if (eventType === 'subscription.scheduled_cancel') {
    // 用户在计费期末取消（Creem 会先发这个，非到期降级）→ 保留 Pro 到期
    Object.assign(out, await patchEntitlement(env, email, { subscriptionStatus: 'scheduled_cancel' }));
  } else if (eventType === 'subscription.canceled' || eventType === 'subscription.expired'
          || eventType === 'subscription.past_due' || eventType === 'subscription.unpaid') {
    if (subId) {
      const r = await d1Exec(env, `UPDATE subscriptions SET status = ?, canceled_at = COALESCE(canceled_at, ?) WHERE creem_subscription_id = ?`,
        [status || eventType.replace('subscription.', ''), Date.now(), subId]);
      if (!r) out.d1_degraded = true;
    }
    // Terms §4 承诺：取消在当期结束时生效，期间保留 Pro 访问。
    // 只有订阅周期真的走完（或拿不到周期结束时间）才降级 —— 否则就是让付过钱的用户提前掉权。
    const periodEndMs = periodEnd ? Date.parse(periodEnd) : NaN;
    const periodOver = !Number.isFinite(periodEndMs) || periodEndMs <= Date.now();
    const shouldDowngrade = eventType === 'subscription.expired' || periodOver;
    Object.assign(out, await patchEntitlement(env, email, shouldDowngrade
      ? { plan: 'free', subscriptionStatus: status || eventType.replace('subscription.', '') }
      : { subscriptionStatus: status || eventType.replace('subscription.', ''), currentPeriodEnd: periodEnd || null }));
  } else if (eventType === 'refund.created') {
    const refundId = obj.id || uuid();
    const r = await d1Exec(env, `INSERT OR REPLACE INTO refunds (id, order_id, creem_refund_id, reason, status, created_at)
      VALUES (?, ?, ?, ?, 'processed', ?)`,
      [refundId, orderId, refundId, (obj.reason || '').slice(0, 500), Date.now()]);
    if (!r) out.d1_degraded = true;
    if (orderId) {
      await d1Exec(env, `UPDATE orders SET status = 'refunded' WHERE creem_order_id = ?`, [orderId]);
    }
    // 退款后立即收回 Pro（退款通常是撤销订阅的前兆；即使后续还有事件也不会漏权）
    Object.assign(out, await patchEntitlement(env, email, { plan: 'free', subscriptionStatus: 'refunded' }));
  } else if (eventType === 'dispute.created') {
    // 拒付以前完全没处理：钱会被 Creem 追回，必须留痕并收回权益
    const disputeId = obj.id || uuid();
    const r = await d1Exec(env, `INSERT OR REPLACE INTO orders (id, user_id, creem_order_id, amount_cents, currency, type, status, raw_json, created_at)
      VALUES (?, ?, ?, ?, ?, 'dispute', 'disputed', ?, ?)`,
      ['dispute:' + disputeId, userId, orderId, amountCents, currency, JSON.stringify(obj), Date.now()]);
    if (!r) out.d1_degraded = true;
    Object.assign(out, await patchEntitlement(env, email, { plan: 'free', subscriptionStatus: 'disputed' }));
    console.error('creem dispute.created —', email, disputeId);
  } else {
    // trialing / paused / update 等：不动权益，留日志
    console.log('creem webhook: unhandled event', eventType);
  }
  return out;
}

/** POST /api/billing/portal — 返回客户门户链接（需登录） */
export async function hBillingPortal(request, env) {
  const user = await resolveUser(request, env);
  if (!user) return apiError('unauthorized');
  const key = CREEM_KEY(env);
  if (!key) return apiError('internal_error', { hint: 'Creem not configured yet.' });

  const recJson = await env.TRIUMPH_KV.get('users:' + user.email.toLowerCase());
  let customerId = null;
  if (recJson) {
    const rec = JSON.parse(recJson);
    customerId = rec.creemCustomerId || null;
  }
  if (!customerId) return apiError('not_found', { hint: 'No billing profile yet.' });

  const res = await safeFetch(CREEM_BASE(env) + '/customers/billing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ customer_id: customerId }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('portal err:', res.status, t.slice(0, 300));
    return apiError('internal_error', { hint: 'Could not open billing portal.' });
  }
  const d = await res.json();
  return json({ ok: true, portal_url: d.customer_portal_link || d.customerPortalLink || d.url || d.portal_url });
}

/* ---------- 内部工具 ---------- */

function hexToBytes(h) {
  const a = [];
  for (let i = 0; i < h.length; i += 2) a.push(parseInt(h.slice(i, i + 2), 16));
  return new Uint8Array(a);
}

async function resolveUser(request, env) {
  const payload = await verifyJwt(bearerToken(request), env.JWT_SECRET);
  if (!payload || !payload.email) return null;
  return { id: payload.sub, email: payload.email.toLowerCase() };
}

export const BILLING_ROUTES = {
  '/api/billing/checkout': { POST: hBillingCheckout },
  '/api/billing/report-checkout': { POST: hReportCheckout },
  '/api/billing/webhook':  { POST: hBillingWebhook },
  '/api/billing/portal':   { POST: hBillingPortal },
};
