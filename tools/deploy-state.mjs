/**
 * tools/deploy-state.mjs — 部署 / 支付配置状态速查
 *
 * 用途：切 Creem live、改 Pages 变量、部署前后各跑一次，确认「改的东西有没有真的生效」。
 *
 * 背景：Cloudflare 对 secret_text 类型的变量**只写不读** —— API 和控制台都拿不到值。
 * 所以这个脚本能确认的只有「变量名设了没有」，**确认不了值对不对**。
 * 值只能靠覆盖重设。这一点在切 live 时最容易误判成"我设过了"，务必记住。
 *
 * 用法：node tools/deploy-state.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TOML = 'C:/Users/abc27/AppData/Roaming/xdg.config/.wrangler/config/default.toml';
// ⚠️ wrangler 只在**它自己运行时**才用 refresh_token 换新的 oauth_token。
// 直接读 TOML 很可能读到已过期的旧值 → 所有 API 调用 401，
// 表现为「找不到项目 triumph」，极易误判成「项目没了」。
// CF 的 oauth_token 只有 1 小时，所以这里**主动刷新**，不依赖 wrangler 是否跑过。
const CF_CLIENT_ID = '54d11594-84e4-41aa-b438-e81b8fa78ee7';
let tomlRaw = readFileSync(TOML, 'utf8');
const pick = (k) => new RegExp(`${k}\\s*=\\s*"([^"]+)"`).exec(tomlRaw)?.[1];

if (!pick('oauth_token')) { console.error('读不到 wrangler oauth_token，先跑 npx wrangler login'); process.exit(1); }

const expMs = Date.parse(pick('expiration_time') || '');
if (Number.isFinite(expMs) && expMs < Date.now() + 60_000) {
  const rt = pick('refresh_token');
  if (!rt) {
    console.error('oauth_token 已过期且无 refresh_token，请跑 npx wrangler login 重新授权');
    process.exit(1);
  }
  console.log('· oauth_token 已过期，用 refresh_token 换新…');
  const rr = await fetch('https://dash.cloudflare.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: CF_CLIENT_ID }),
  }).then(r => r.json()).catch(() => null);

  if (rr && rr.access_token) {
    const newExp = new Date(Date.now() + (rr.expires_in || 3599) * 1000).toISOString();
    // 三个字段一并写回，其余字段原样保留
    tomlRaw = tomlRaw
      .replace(/(oauth_token\s*=\s*")[^"]*(")/, `$1${rr.access_token}$2`)
      .replace(/(refresh_token\s*=\s*")[^"]*(")/, `$1${rr.refresh_token || rt}$2`)
      .replace(/(expiration_time\s*=\s*")[^"]*(")/, `$1${newExp}$2`);
    writeFileSync(TOML, tomlRaw);
    console.log(`  ✓ 已刷新并写回（新过期时间 ${newExp}）\n`);
  } else {
    console.error(`  ✗ 刷新失败：${JSON.stringify(rr && (rr.error || rr))} —— 先跑 npx wrangler login`);
    process.exit(1);
  }
}

const tok = pick('oauth_token');

const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
const ACCT = 'ea1585383ab36bf04cbe995b49285ffc';
const DB = '5d04a307-4dc9-4236-9492-817f17f3a351';
const PROJECT = 'triumph';

/** 上线后**必须存在**的变量。切 live 时这几项要全部覆盖重设。 */
const REQUIRED = [
  'CREEM_MODE',              // 必须是 live（值读不到，只能靠人确认）
  'CREEM_API_KEY',           // 必须是 live key
  'CREEM_PRODUCT_ID',        // 必须是 live 的 Pro 产品
  'CREEM_REPORT_PRODUCT_ID', // 一次性报告（本轮新增）
  'CREEM_WEBHOOK_SECRET',    // 必须是 live signing secret
];

const q = (sql) => fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB}/query`, {
  method: 'POST', headers: H, body: JSON.stringify({ sql }),
}).then(r => r.json()).catch(() => null);

console.log('==================== 1. Pages 变量（只能看名字） ====================');
const pr = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/pages/projects`, { headers: H }).then(r => r.json()).catch(() => null);
const proj = (pr && pr.success) ? (pr.result || []).find(p => p.name === PROJECT) : null;
if (!pr || !pr.success) {
  console.log(`  ✗ Pages 项目列表调用失败${pr && pr.errors ? '：' + JSON.stringify(pr.errors) : ''}`);
  console.log('    → 多半是 oauth_token 过期。先跑 `wrangler whoami` 刷新后重试。');
} else if (!proj) {
  console.log(`  找不到项目 ${PROJECT}（账号下现有 ${(pr.result || []).length} 个：${(pr.result || []).map(p => p.name).join(', ') || '无'}）`);
} else {
  const c = (proj.deployment_configs || {}).production || {};
  const ev = c.env_vars || {};
  const have = Object.keys(ev).sort();
  console.log(`项目 ${proj.name} · production · ${have.length} 个变量`);
  for (const k of have) {
    const mark = REQUIRED.includes(k) ? ' ★' : '';
    const t = (ev[k] && ev[k].type) || '?';
    console.log(`   ${k.padEnd(30)} ${t}${mark}${t === 'secret_text' ? '  值读不到' : ''}`);
  }
  const missing = REQUIRED.filter(k => !(k in ev));
  console.log(missing.length ? `\n⚠️  缺少必需变量：${missing.join(', ')}` : '\n✓ 必需变量名都在（值对不对读不到，需人工确认）');

  console.log('\n-- bindings --');
  console.log('   KV :', JSON.stringify(c.kv_namespaces || null));
  console.log('   D1 :', JSON.stringify(c.d1_databases || null));
  console.log('   ⚠️  preflight：preview 环境 env_vars=%d 个、bindings=%s',
    Object.keys(((proj.deployment_configs || {}).preview || {}).env_vars || {}).length,
    JSON.stringify(((proj.deployment_configs || {}).preview || {}).kv_namespaces || null));
}

console.log('\n==================== 2. 最近部署 ====================');
const dp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/pages/projects/${PROJECT}/deployments?per_page=5`, { headers: H }).then(r => r.json());
for (const d of (dp.result || []).slice(0, 5)) {
  const t = new Date(d.created_on).toISOString().replace('T', ' ').slice(0, 19);
  console.log(`   ${t}  ${String(d.environment).padEnd(10)} ${(d.latest_stage && d.latest_stage.status) || ''}  ${(d.deployment_trigger && d.deployment_trigger.metadata && d.deployment_trigger.metadata.commit_message || '').slice(0, 55)}`);
}

console.log('\n==================== 3. 支付流水（D1） ====================');
const w = await q(`SELECT json_extract(payload,'$.object.mode') AS m, COUNT(*) AS n, MIN(received_at) AS first, MAX(received_at) AS last FROM webhook_events GROUP BY m`);
const rows = (w && w.success && w.result?.[0]?.results) || [];
if (!rows.length) console.log('   webhook_events 空（或查询失败）');
for (const r of rows) {
  const f = new Date(r.first).toISOString().slice(0, 10);
  const l = new Date(r.last).toISOString().slice(0, 10);
  console.log(`   mode=${r.m}  ${r.n} 条  ${f} → ${l}`);
}
console.log('   ↑ 只有 test = 还没跑过真实付款（不是"现在是 test 模式"的证据）');
for (const [label, sql] of [
  ['orders       ', `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS cents FROM orders`],
  ['subscriptions', `SELECT COUNT(*) AS n, group_concat(DISTINCT status) AS st FROM subscriptions`],
  ['refunds      ', `SELECT COUNT(*) AS n FROM refunds`],
]) {
  const r = await q(sql);
  const v = (r && r.success && r.result?.[0]?.results?.[0]) || null;
  console.log(`   ${label} ${v ? JSON.stringify(v) : '(查询失败)'}`);
}

console.log('\n==================== 4. 生产路由存活 ====================');
for (const [m, p] of [['POST', '/api/billing/webhook'], ['POST', '/api/diagnostic/report'], ['GET', '/api/me']]) {
  const r = await fetch('https://learndiag.com' + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'POST' ? '{}' : undefined })
    .then(x => x.status).catch(() => 'ERR');
  const note = p === '/api/diagnostic/report' ? '  (未部署=404，已部署=400)' : p === '/api/billing/webhook' ? '  (应 401 fail-closed)' : '';
  console.log(`   ${m.padEnd(5)} ${p.padEnd(28)} ${r}${note}`);
}
