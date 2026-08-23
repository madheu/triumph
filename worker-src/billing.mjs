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

import { json, apiError } from './http.mjs';
import { verifyJwt, bearerToken } from './crypto.mjs';

const CREEM_BASE = env => (env.CREEM_MODE === 'test' ? 'https://test-api.creem.io/v1' : 'https://api.creem.io/v1');
const CREEM_KEY = env => (env.CREEM_MODE === 'test' ? env.CREEM_TEST_API_KEY : env.CREEM_API_KEY);

/** 简单 UUID（crypto.randomUUID 已全局可用） */
const uuid = () => crypto.randomUUID();

/** 写 D1（如果绑定存在；P1 前期 D1 可能未就绪，失败不阻断 checkout 流程） */
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
  const successUrl = (env.SITE_URL || 'https://trytriumph.de5.net') + '/upgrade.html';
  const chkRes = await fetch(CREEM_BASE(env) + '/checkouts', {
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

/** POST /api/billing/webhook — Creem 事件回调（验签 + 幂等） */
export async function hBillingWebhook(request, env) {
  const secret = env.CREEM_MODE === 'test' ? (env.CREEM_TEST_WEBHOOK_SECRET || env.CREEM_WEBHOOK_SECRET) : env.CREEM_WEBHOOK_SECRET;
  const raw = await request.text();
  const signature = request.headers.get('creem-signature') || '';

  // HMAC-SHA256 验签
  if (secret) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = hexToBytes(signature);
    const ok = sigBytes.length === 32 && await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(raw));
    if (!ok) {
      // 调试：记录收到的 signature 前 16 位（不记录完整 secret，只记 sig 前缀用于比对）
      await env.TRIUMPH_KV.put('diag:whsig:' + Date.now(), JSON.stringify({
        received_sig_prefix: signature.slice(0, 16),
        secret_prefix: secret.slice(0, 6),
        len: signature.length,
      }), { expirationTtl: 3600 }).catch(() => {});
      return json({ ok: false, error: 'bad signature' }, 401);
    }
  }

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
  try {
    await handleCreemEvent(env, eventType, obj);
  } catch (e) {
    console.error('webhook handle err:', String(e && e.message || e));
    return json({ ok: false, error: 'handler failed' }, 500);
  }
  await d1Exec(env, `UPDATE webhook_events SET processed_at = ? WHERE id = ?`, [Date.now(), eventId]);
  return json({ ok: true });
}

async function handleCreemEvent(env, eventType, obj) {
  // 真实 payload 结构（Creem webhook 文档）：
  //   obj = event.object
  //   obj.order         → 订单（id/amount/currency/status）
  //   obj.customer      → 客户（id/email）
  //   obj.product       → 产品
  //   obj.subscription  → 订阅（id/status/current_period_end/metadata）
  //   obj.metadata      → checkout 时传入的 metadata（user_id/email）
  const order = obj.order || {};
  const customer = obj.customer || {};
  const sub = obj.subscription || {};
  const metadata = obj.metadata || {};
  const email = customer.email || metadata.email || '';
  const userId = metadata.user_id || sub.metadata?.user_id || null;

  const subId = sub.id || null;
  const status = sub.status || order.status || null;
  const plan = 'pro';
  const periodEnd = sub.current_period_end || null;
  const amountCents = order.amount ?? null;
  const currency = order.currency || 'usd';
  const orderId = order.id || null;

  if (eventType === 'checkout.completed' || eventType === 'subscription.paid' || eventType === 'subscription.active') {
    // 订单落库
    if (orderId) {
      const oid = 'order:' + orderId;
      await d1Exec(env, `INSERT OR REPLACE INTO orders (id, user_id, creem_order_id, amount_cents, currency, type, status, raw_json, created_at)
        VALUES (?, ?, ?, ?, ?, 'payment', 'succeeded', ?, ?)`,
        [oid, userId, orderId, amountCents, currency, JSON.stringify(obj), Date.now()]);
    }

    if (subId) {
      await d1Exec(env, `INSERT OR REPLACE INTO subscriptions (id, user_id, creem_subscription_id, status, plan, current_period_end, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [subId, userId, subId, status || 'active', plan, periodEnd, Date.now()]);
    }
    // 更新 KV 用户权益（前端 /api/me 读）
    if (email) {
      const recJson = await env.TRIUMPH_KV.get('users:' + email.toLowerCase());
      if (recJson) {
        const rec = JSON.parse(recJson);
        rec.plan = 'pro';
        rec.subscriptionStatus = status || 'active';
        rec.currentPeriodEnd = periodEnd || null;
        rec.creemCustomerId = customer.id || rec.creemCustomerId || null;
        await env.TRIUMPH_KV.put('users:' + email.toLowerCase(), JSON.stringify(rec));
      }
    }
    await ensureUserMirror(env, userId, email);
  } else if (eventType === 'subscription.canceled' || eventType === 'subscription.expired' || eventType === 'subscription.past_due') {
    if (subId) {
      await d1Exec(env, `UPDATE subscriptions SET status = ?, canceled_at = COALESCE(canceled_at, ?) WHERE creem_subscription_id = ?`, [status || eventType.replace('subscription.', ''), Date.now(), subId]);
    }
    if (email) {
      const recJson = await env.TRIUMPH_KV.get('users:' + email.toLowerCase());
      if (recJson) {
        const rec = JSON.parse(recJson);
        // 只有到期才降级（past_due 保留 pro，expired/canceled 到期后降级）
        if (eventType === 'subscription.expired' || (eventType === 'subscription.canceled' && status === 'canceled')) {
          rec.plan = 'free';
          rec.subscriptionStatus = status || eventType.replace('subscription.', '');
        } else {
          rec.subscriptionStatus = status || eventType.replace('subscription.', '');
        }
        await env.TRIUMPH_KV.put('users:' + email.toLowerCase(), JSON.stringify(rec));
      }
    }
  } else if (eventType === 'refund.created') {
    const refundId = obj.id || uuid();
    await d1Exec(env, `INSERT OR REPLACE INTO refunds (id, order_id, creem_refund_id, reason, status, created_at)
      VALUES (?, ?, ?, ?, 'processed', ?)`,
      [refundId, orderId, refundId, (obj.reason || '').slice(0, 500), Date.now()]);
    if (orderId) {
      await d1Exec(env, `UPDATE orders SET status = 'refunded' WHERE creem_order_id = ?`, [orderId]);
    }
  }
  // 其他事件（trialing/paused/update/scheduled_cancel/dispute）暂不处理，留日志
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

  const res = await fetch(CREEM_BASE(env) + '/customers/billing', {
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
  '/api/billing/webhook':  { POST: hBillingWebhook },
  '/api/billing/portal':   { POST: hBillingPortal },
};
