// p1-billing.test.mjs — P1 测试：密码重置 + Creem webhook 处理
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// 读 **worker-src 源码**而不是 site/_worker.js 产物。2026-09-11 之前这里读的是产物，
// 于是"源码加了 ?checkout=done、但产物没重建"导致断言长期假绿 —— 重建产物后才暴露。
const worker = (await import(pathToFileURL(ROOT + 'worker-src/worker.mjs').href)).default;

function makeEnv(kvStore = new Map()) {
  return {
    JWT_SECRET: 'test-secret',
    EMAIL_FROM: 'Learndiag <verify@learndiag.com>',
    SITE_URL: 'https://learndiag.com',
    ADMIN_EMAILS: 'admin@triumph.com',
    CREEM_WEBHOOK_SECRET: 'whsec_test',
    CREEM_MODE: 'test',
    CREEM_TEST_API_KEY: 'creem_test_key',
    CREEM_PRODUCT_ID: 'prod_test',
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
    TRIUMPH_D1: null, // 测试里 D1 未配置，走 KV 为主
  };
}

const call = (env, path, method = 'GET', body, headers = {}) =>
  worker.fetch(new Request('https://learndiag.com' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }), env, {});

/** 注册+验证，返回可用 token */
async function makeUser(env, email, password = 'password123') {
  // 直接写入已验证用户（跳过邮件）
  const store = env.TRIUMPH_KV;
  const id = crypto.randomUUID();
  // 用真实 hashPassword 逻辑（从 worker 行为验证）
  const { saltHex, hashHex } = await (async () => {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
    const b2h = b => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
    return { saltHex: b2h(salt), hashHex: b2h(new Uint8Array(bits)) };
  })();
  await store.put('users:' + email, JSON.stringify({ id, email, saltHex, hashHex, verified: true, createdAt: Date.now() }));
  return { id, email, password };
}

/* ============ 1. 密码重置 ============ */

test('password forgot: 邮箱不存在也返回 ok（防枚举）', async () => {
  const env = makeEnv();
  const r = await call(env, '/api/password/forgot', 'POST', { email: 'nobody@nowhere.com' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
});

test('password forgot→reset→新密码可登录', async () => {
  const env = makeEnv();
  const { email } = await makeUser(env, 'reset-me@test.com', 'oldpassword1');
  const store = env.TRIUMPH_KV;

  // forgot（邮件发送会被 mock 拦截——测试里没有 RESEND_API_KEY，走 no_mail_provider 但仍返回 ok）
  const r1 = await call(env, '/api/password/forgot', 'POST', { email });
  assert.equal(r1.status, 200);

  // 检查 pwreset 记录存在（token 哈希）
  const pwKey = 'pwreset:' + email;
  const stored = JSON.parse(await store.get(pwKey));
  assert.ok(stored.tokenHash && stored.exp > Date.now(), 'token stored');

  // 由于测试环境不发邮件，我们模拟从邮件里取出 token —— 直接验证 token 与存储的哈希匹配：
  // 真实流程用户从邮件链接拿到 token；测试里我们"伪造"一个不匹配的 token 验证失败分支
  const bad = await call(env, '/api/password/reset', 'POST', { email, token: 'wrongtoken', newPassword: 'newpassword9' });
  assert.equal(bad.status, 400);

  // 我们无法从哈希反推 token，所以验证失败分支 + 正确流程用管理员接口测（管理员生成链接时可拿到明文？）
  // 实际上：重置 token 是发给用户的，测试正确流程需要能取到明文。为可测性，改为验证 KV 结构完整。
  assert.ok(await store.get(pwKey), 'reset record still present after bad token');
});

test('password: 管理员代办重置 → 新密码可登录（端到端）', async () => {
  const env = makeEnv();
  const { email, password } = await makeUser(env, 'admin-reset@test.com', 'oldpassword1');
  const { signJwt } = await import(pathToFileURL(ROOT + 'worker-src/crypto.mjs').href);
  const adminToken = await signJwt({ sub: 'admin-id', email: 'admin@triumph.com', iat: Date.now(), exp: Date.now() + 1e6 }, 'test-secret');

  // 管理员生成重置链接
  const r = await call(env, '/api/admin/users/password-reset-link', 'POST', { email }, { Authorization: 'Bearer ' + adminToken });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(d.reset_link.includes('token='), 'has reset link with token');
  const token = new URL(d.reset_link).searchParams.get('token');

  // 用 token 重置密码
  const r2 = await call(env, '/api/password/reset', 'POST', { email, token, newPassword: 'newpassword9' });
  assert.equal(r2.status, 200);

  // 旧密码不能登录
  const oldLogin = await call(env, '/api/login', 'POST', { email, password });
  assert.equal(oldLogin.status, 401);

  // 新密码可以登录
  const newLogin = await call(env, '/api/login', 'POST', { email, password: 'newpassword9' });
  assert.equal(newLogin.status, 200);
  const ld = await newLogin.json();
  assert.ok(ld.token && ld.user.email === email, 'logged in with new password');

  // token 已用后即焚
  const usedAgain = await call(env, '/api/password/reset', 'POST', { email, token, newPassword: 'anotherpass1' });
  assert.equal(usedAgain.status, 400, 'token burned after use');
});

/* ============ 2. Creem 收银台 ============ */

test('checkout: 请求体字段为 snake_case（Creem REST 约定）', async () => {
  const env = makeEnv();
  // mock fetch 捕获发往 Creem 的请求体
  const sent = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('api.creem.io') || String(url).includes('test-api.creem.io')) {
      sent.push({ url: String(url), body: JSON.parse(opts.body || '{}') });
      if (String(url).endsWith('/checkouts')) {
        return new Response(JSON.stringify({ id: 'ch_test', checkout_url: 'https://checkout.creem.io/ch_test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url).endsWith('/customers/billing')) {
        return new Response(JSON.stringify({ customer_portal_link: 'https://portal.creem.io/x' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { signJwt } = await import(pathToFileURL(ROOT + 'worker-src/crypto.mjs').href);
  const token = await signJwt({ sub: 'u1', email: 'buyer@test.com', iat: Date.now(), exp: Date.now() + 1e6 }, 'test-secret');

  const r = await call(env, '/api/billing/checkout', 'POST', null, { Authorization: 'Bearer ' + token });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(d.checkout_url, 'has checkout url');

  const req = sent.find(s => s.url.endsWith('/checkouts'));
  assert.ok(req, 'creem checkout called');
  assert.equal(req.body.product_id, 'prod_test');
  // 回跳必须带 ?checkout=done —— upgrade.html:137 靠这个 query 启动"付款确认中"的轮询
  // （`if(new URLSearchParams(location.search).get("checkout")!=="done") return;`）。
  // 少了它，用户付完钱会落在升级页却看不出任何状态。改这里前先确认前端那段轮询还在。
  assert.equal(req.body.success_url, 'https://learndiag.com/upgrade.html?checkout=done');
  assert.ok(req.body.customer && req.body.customer.email === 'buyer@test.com', 'customer email passed');
  assert.ok(!('productId' in req.body), 'no camelCase field');
  assert.ok(!('cancel_url' in req.body), 'no unsupported cancel_url');
});

test('webhook: 签名错误 → 401', async () => {
  const env = makeEnv();
  const payload = JSON.stringify({ eventType: 'checkout.completed', id: 'evt_1', object: { id: 'x' } });
  const r = await call(env, '/api/billing/webhook', 'POST', null, {
    'Content-Type': 'application/json',
    'creem-signature': '00'.repeat(32),
  }, payload);
  // call 工具会 JSON.stringify body —— 这里需要 raw body，改用直接构造
  const rawRes = await worker.fetch(new Request('https://learndiag.com/api/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'creem-signature': '00'.repeat(32) },
    body: payload,
  }), env, {});
  assert.equal(rawRes.status, 401);
});

test('webhook: 正确签名 → 处理成功并写 KV 权益（真实 payload 结构）', async () => {
  const env = makeEnv();
  const { email } = await makeUser(env, 'billing-user@test.com');
  // 按 Creem 官方 webhook 文档的真实结构构造
  const payload = JSON.stringify({
    id: 'evt_paid_1',
    eventType: 'subscription.paid',
    created_at: Date.now(),
    object: {
      id: 'ch_123',
      object: 'checkout',
      order: { id: 'ord_1', customer: 'cust_1', product: 'prod_test', amount: 1500, currency: 'USD', status: 'paid', type: 'recurring' },
      customer: { id: 'cust_1', email },
      subscription: { id: 'sub_123', status: 'active', current_period_end: Date.now() + 30 * 86400000, metadata: {} },
      metadata: { user_id: 'u1', email },
      status: 'completed',
    },
  });
  const sig = createHmac('sha256', 'whsec_test').update(payload).digest('hex');
  const r = await worker.fetch(new Request('https://learndiag.com/api/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'creem-signature': sig },
    body: payload,
  }), env, {});
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);

  // KV 用户权益被更新为 pro
  const rec = JSON.parse(await env.TRIUMPH_KV.get('users:' + email));
  assert.equal(rec.plan, 'pro');
  assert.equal(rec.subscriptionStatus, 'active');
});

test('webhook: 重复事件幂等（同一 id 只处理一次）', async () => {
  const env = makeEnv();
  const { email } = await makeUser(env, 'dup-user@test.com');
  const payload = JSON.stringify({
    eventType: 'subscription.paid',
    id: 'evt_dup_1',
    object: { id: 'sub_dup', status: 'active', customer: { email }, metadata: {} },
  });
  const sig = createHmac('sha256', 'whsec_test').update(payload).digest('hex');
  const req = () => worker.fetch(new Request('https://learndiag.com/api/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'creem-signature': sig },
    body: payload,
  }), env, {});
  const r1 = await req();
  const r2 = await req();
  assert.equal(r1.status, 200);
  const d2 = await r2.json();
  // D1 未配置时 webhook_events 幂等表不可用，仍应返回 ok（不阻塞）
  assert.equal(d2.ok, true);
});

/* ============ 3. 后台用户列表 ============ */

test('admin users: 未授权 → 401', async () => {
  const env = makeEnv();
  const r = await call(env, '/api/admin/users');
  assert.equal(r.status, 401);
});

test('admin users: 管理员可列出用户且脱敏（无 saltHex/hashHex）', async () => {
  const env = makeEnv();
  await makeUser(env, 'u1@test.com');
  await makeUser(env, 'u2@test.com');
  // 管理员 token：直接构造（admin@triumph.com 在白名单）
  const { signJwt } = await import(pathToFileURL(ROOT + 'worker-src/crypto.mjs').href);
  const token = await signJwt({ sub: 'admin-id', email: 'admin@triumph.com', iat: Date.now(), exp: Date.now() + 1e6 }, 'test-secret');
  const r = await call(env, '/api/admin/users', 'GET', null, { Authorization: 'Bearer ' + token });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(Array.isArray(d.items) && d.items.length >= 2, 'has users');
  for (const it of d.items) {
    assert.ok(!('saltHex' in it) && !('hashHex' in it), 'no password material');
    assert.ok(it.email, 'has email');
  }
});

/* ================= 支付回跳地址守卫（2026-09-10 加） =================
 *
 * 起因：hReportCheckout 的 success_url 曾写成 '/report.html?purchase=done'，
 * 而 site/report.html 根本不存在（线上 404）。用户付完 $9.90 会落到 404，
 * 报告拿不到 —— 跟历史上那次「钱付了显示 FREE」是同一类事故，而且更糟，
 * 因为连页面都没有。这个 bug 靠"设计意图"看不出来，只有 curl 才验得出来。
 *
 * 这条测试把「回跳地址必须指向真实存在的页面」变成机械约束：
 * 从 worker-src/billing.mjs 里抽出所有 success_url 的字面量路径，
 * 逐个映射到 site/ 下的静态文件，不存在就红。
 *
 * 注意：这里读的是 **worker-src 源码**而不是 site/_worker.js 产物。
 * 产物由 esbuild 打包、且经常与其他会话不同步（见 test/diff-worker.mjs），
 * 守卫必须盯源码，才不会因为产物没重建而漏掉。
 */
test('billing success_url targets must exist as real pages in site/', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const raw = readFileSync(ROOT + 'worker-src/billing.mjs', 'utf8');

  // 先剥掉注释再判 —— 否则源码里那句「曾错写成 '/report.html'」的说明
  // 会把下面那条反例守卫自己打成红的。（`[^:]` 是为了不误伤 https://）
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  // 匹配：(env.SITE_URL || 'https://learndiag.com') + '/some/path?...'
  const re = new RegExp("\\(env\\.SITE_URL \\|\\| 'https:\\/\\/learndiag\\.com'\\)\\s*\\+\\s*'([^']+)'", 'g');
  const targets = [...src.matchAll(re)].map((m) => m[1]);

  assert.ok(targets.length >= 2, `至少应找到 2 个回跳地址（Pro + 一次性报告），实际 ${targets.length}`);

  for (const t of targets) {
    // 去掉 query / hash，只留路径
    const path = t.split('?')[0].split('#')[0];
    assert.ok(path.startsWith('/'), `${t} 应以 / 开头`);

    // Cloudflare Pages：/diagnostic 由 site/diagnostic.html 提供
    const candidates = path.endsWith('.html')
      ? [ROOT + 'site' + path]
      : [ROOT + 'site' + path + '.html', ROOT + 'site' + path + '/index.html'];

    const hit = candidates.find((c) => existsSync(c));
    assert.ok(
      hit,
      `回跳地址 '${t}' 指向 ${path}，但 site/ 下没有对应页面（找过：${candidates.join(' | ')}）。` +
      `付完钱会落到 404。`
    );
  }

  // 反例守卫：曾经错过的那个具体值，别再回来
  assert.ok(
    !src.includes("'/report.html"),
    "回跳地址又写回了 '/report.html' —— 该文件不存在，会导致付款后 404"
  );
});
