// test/p1-billing-webhook-drop.test.mjs
//
// 回归测试：Creem webhook「隐形掉单」防线。
//
// 背景（2026-09-10）：老的上线路径里，webhook 不管写入成败都返回 200。Creem 只在
// 收到非 2xx 时才重投（30s / 5m / 30m / 6h，共 5 次），所以一旦 D1/KV 抖一下，
// 用户钱扣了、KV 里没写 plan=pro，前端永远显示 FREE —— 而且日志里看不出来。
// 另有两个更隐蔽的：没配 webhook secret 时**跳过验签**（任何人 POST 一个伪造事件
// 就能白拿 Pro），以及 subscription.canceled 立刻降级（违反 Terms §4 的"当期结束
// 才生效"，等于让付过钱的用户提前掉权）。
//
// 本测试直接打 worker-src/billing.mjs 的源码（不依赖 site/_worker.js 构建产物），
// 用官方文档逐字 payload 覆盖 9 个场景。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { hBillingWebhook } = await import(pathToFileURL(ROOT + 'worker-src/billing.mjs').href);

const SECRET = 'whsec_test';

/** 最小假 D1：只需正确实现 webhook_events 的去重语义（重投时 changes=0） */
function makeD1() {
  const seen = new Set();
  return {
    prepare(sql) {
      return {
        bind(...params) { this._p = params; return this; },
        async run() {
          const p = this._p || [];
          if (sql.includes('webhook_events') && sql.includes('INSERT OR IGNORE')) {
            const id = String(p[0]);
            if (seen.has(id)) return { meta: { changes: 0 } };
            seen.add(id);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

function makeCtx() {
  const state = { kv: new Map(), failKV: false };
  const env = {
    CREEM_MODE: 'test',
    CREEM_WEBHOOK_SECRET: SECRET,
    TRIUMPH_D1: makeD1(),
    TRIUMPH_KV: {
      async get(k) { if (state.failKV) throw new Error('KV down'); return state.kv.has(k) ? state.kv.get(k) : null; },
      async put(k, v) { if (state.failKV) throw new Error('KV down'); state.kv.set(k, v); },
    },
  };
  const sign = body => createHmac('sha256', SECRET).update(body).digest('hex');
  async function post(payload, opts = {}) {
    const body = JSON.stringify(payload);
    const useEnv = opts.env || env;
    const sig = opts.sig !== undefined ? opts.sig : sign(body);
    const req = new Request('https://learndiag.com/api/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'creem-signature': sig },
      body,
    });
    const res = await hBillingWebhook(req, useEnv);
    return { status: res.status, json: await res.json() };
  }
  return { state, env, post };
}

// —— 官方文档逐字 payload 形状 ——
const CHECKOUT_COMPLETED = (email, userId, orderId = 'ord_4aDwWXjMLpes4Kj4XqNnUA') => ({
  id: 'evt_5WHHcZPv7VS0YUsberIuOz',
  eventType: 'checkout.completed',
  object: {
    id: 'ch_4l0N34kxo16AhRKUHFUuXr', object: 'checkout',
    order: { id: orderId, customer: 'cust_1OcIK1GEuVvXZwD19tjq2z', product: 'prod_x', amount: 1500, currency: 'USD', status: 'paid', type: 'recurring' },
    customer: { id: 'cust_1OcIK1GEuVvXZwD19tjq2z', object: 'customer', email, name: 'Tester Test', country: 'US' },
    subscription: { id: 'sub_6pC2lNB6joCRQIZ1aMrTpi', object: 'subscription', status: 'active', canceled_at: null, metadata: { user_id: userId, email } },
    status: 'completed',
    metadata: { user_id: userId, email },
  },
});

// subscription.active 的关键特征：customer 是对象、但**没有** metadata
const SUB_ACTIVE = email => ({
  id: 'evt_active_1', eventType: 'subscription.active',
  object: {
    id: 'sub_21lfZb67szyvMiXnm6SVi0', object: 'subscription', status: 'active',
    customer: { id: 'cust_3biFPNt4Cz5YRDSdIqs7kc', object: 'customer', email, name: 'T', country: 'US' },
  },
});

const SUB_CANCELED = (email, periodEnd) => ({
  id: 'evt_cancel_' + periodEnd, eventType: 'subscription.canceled',
  object: {
    id: 'sub_6pC2lNB6joCRQIZ1aMrTpi', object: 'subscription', status: 'canceled',
    current_period_end_date: periodEnd, canceled_at: '2026-09-10T00:00:00.000Z',
    customer: { id: 'cust_1', object: 'customer', email },
    metadata: { user_id: 'u1', email },
  },
});

const EMAIL = 'teacher@example.com';

test('creem webhook: checkout.completed 按 object.customer.email 授予 pro', async () => {
  const { state, env, post } = makeCtx();
  state.kv.set('users:' + EMAIL, JSON.stringify({ email: EMAIL, plan: 'free', hash: 'x' }));
  const r = await post(CHECKOUT_COMPLETED(EMAIL, 'u1'), { env });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(JSON.parse(state.kv.get('users:' + EMAIL)).plan, 'pro');
  assert.equal(r.json.d1_degraded, undefined, 'D1 正常时不应出现降级标记');
});

test('creem webhook: D1 绑定缺失时权益照发，且以 d1_degraded 暴露（不静默）', async () => {
  const { state, env, post } = makeCtx();
  delete env.TRIUMPH_D1;
  state.kv.set('users:' + EMAIL, JSON.stringify({ email: EMAIL, plan: 'free', hash: 'x' }));
  const r = await post(CHECKOUT_COMPLETED(EMAIL, 'u1', 'ord_nod1'), { env });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(JSON.parse(state.kv.get('users:' + EMAIL)).plan, 'pro');
  assert.equal(r.json.d1_degraded, true);
});

test('creem webhook: 同一事件 id 重投保持幂等', async () => {
  const { state, env, post } = makeCtx();
  state.kv.set('users:' + EMAIL, JSON.stringify({ email: EMAIL, plan: 'free', hash: 'x' }));
  await post(CHECKOUT_COMPLETED(EMAIL, 'u1'), { env });
  const r = await post(CHECKOUT_COMPLETED(EMAIL, 'u1'), { env });
  assert.equal(r.json.duplicate, true, JSON.stringify(r.json));
});

test('creem webhook: subscription.active（无 metadata）仍能按邮箱授予 pro', async () => {
  const { state, env, post } = makeCtx();
  state.kv.set('users:' + EMAIL, JSON.stringify({ email: EMAIL, plan: 'free', hash: 'x' }));
  const r = await post(SUB_ACTIVE(EMAIL), { env });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(JSON.parse(state.kv.get('users:' + EMAIL)).plan, 'pro');
});

test('creem webhook: 取消但计费周期未走完 → 保留 pro（对齐 Terms §4）', async () => {
  const { state, env, post } = makeCtx();
  state.kv.set('users:' + EMAIL, JSON.stringify({ email: EMAIL, plan: 'pro', hash: 'x' }));
  await post(SUB_CANCELED(EMAIL, '2099-10-10T00:00:00.000Z'), { env });
  const rec = JSON.parse(state.kv.get('users:' + EMAIL));
  assert.equal(rec.plan, 'pro', '周期未到期不应降级');
  assert.equal(rec.currentPeriodEnd, '2099-10-10T00:00:00.000Z');
});

test('creem webhook: 计费周期已走完的取消 → 降级 free', async () => {
  const { state, env, post } = makeCtx();
  state.kv.set('users:' + EMAIL, JSON.stringify({ email: EMAIL, plan: 'pro', hash: 'x' }));
  await post(SUB_CANCELED(EMAIL, '2020-01-01T00:00:00.000Z'), { env });
  assert.equal(JSON.parse(state.kv.get('users:' + EMAIL)).plan, 'free');
});

test('creem webhook: 未配置 webhook secret → 503 且不授予权益（拒绝伪造事件）', async () => {
  const { state, env, post } = makeCtx();
  env.CREEM_WEBHOOK_SECRET = '';
  state.kv.set('users:attacker@evil.com', JSON.stringify({ email: 'attacker@evil.com', plan: 'free' }));
  const r = await post(CHECKOUT_COMPLETED('attacker@evil.com', 'u9'), { env });
  assert.equal(r.status, 503, JSON.stringify(r));
  assert.equal(JSON.parse(state.kv.get('users:attacker@evil.com')).plan, 'free');
});

test('creem webhook: 签名不符 → 401', async () => {
  const { env, post } = makeCtx();
  const r = await post(CHECKOUT_COMPLETED(EMAIL, 'u1'), { env, sig: '00'.repeat(32) });
  assert.equal(r.status, 401, JSON.stringify(r));
});

test('creem webhook: KV 写失败 → 5xx 触发 Creem 重投（不再假装成功）', async () => {
  const { state, env, post } = makeCtx();
  state.kv.set('users:' + EMAIL, JSON.stringify({ email: EMAIL, plan: 'free', hash: 'x' }));
  state.failKV = true;
  const r = await post(CHECKOUT_COMPLETED(EMAIL, 'u1', 'ord_kvdown'), { env });
  state.failKV = false;
  assert.equal(r.status, 500, JSON.stringify(r));
});

test('creem webhook: 付款邮箱没有对应账号 → 以 skipped_no_user 暴露（不静默）', async () => {
  const { env, post } = makeCtx();
  const r = await post(CHECKOUT_COMPLETED('never-registered@example.com', 'u7', 'ord_nouser'), { env });
  assert.equal(r.json.entitlement, 'skipped_no_user', JSON.stringify(r.json));
});
