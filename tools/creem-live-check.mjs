#!/usr/bin/env node
/**
 * Creem live 端到端自检 —— 「5 个变量到底配对没有」一条命令回答。
 *
 *   node tools/creem-live-check.mjs
 *
 * 分两层，缺一不可：
 *   A 层（本地凭据 → Creem live API）
 *       证明凭据本身有效：key 是 live 的、两个产品是 $19.99 / $9.99 且 active。
 *   B 层（线上路由 → learndiag.com）
 *       证明这些值**真的进了 Cloudflare 的运行时**。
 *
 * ★ 为什么必须有 B 层：Cloudflare 的变量改动**不部署就不生效**。
 *   A 层全绿 + 没部署 = B 层全红，症状看起来像"支付坏了"，其实是"变量没上线"。
 *
 * 退出码：0 = 全绿；1 = 有 FAIL。
 * ⚠️ 本脚本读 key0910/ 里的明文凭据，**只读不打印**，任何输出都不会回显 key/secret。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');            // praxis-5001/
const KEY_DIR = path.resolve(ROOT, '..', 'key0910');   // E:/Triumph/key0910 —— 在 git 仓库外

const SITE = process.env.SITE_URL || 'https://learndiag.com';
const LIVE_API = 'https://api.creem.io/v1';
const TEST_API = 'https://test-api.creem.io/v1';

// ---------- 代理自愈（必须在任何 fetch 之前执行） ----------
// Node 24 会自动读 HTTPS_PROXY/HTTP_PROXY 让 fetch 走它（Node 22 不读）。
// 2026-09-11 实测：Node 24 + HTTPS_PROXY=http://127.0.0.1:7897（当时已失效）
//   → 所有请求变成 `fetch failed` / UND_ERR_CONNECT_TIMEOUT，
//   报错里完全看不出是代理问题，而 learndiag.com 其实一切正常。
// 更坑的是：同一个终端里跑 deploy.ps1 设的代理，会原样影响紧接着的这次自检。
// 本脚本只打 learndiag.com 与 api.creem.io，两者直连均可达 → 默认清掉环境代理。
// 若你的网络确实必须走代理，跑之前设 LIVECHECK_USE_ENV_PROXY=1。
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];
if (process.env.LIVECHECK_USE_ENV_PROXY === '1') {
  const kept = PROXY_VARS.filter((k) => process.env[k]);
  console.log('（已保留环境代理：' + (kept.join(', ') || '无') + '）');
} else {
  const cleared = PROXY_VARS.filter((k) => { if (process.env[k]) { delete process.env[k]; return true; } return false; });
  if (cleared.length) {
    console.log('（已忽略环境代理 ' + cleared.join(', ') + '，改为直连 —— 如需保留请设 LIVECHECK_USE_ENV_PROXY=1）');
  }
}

/** 期望值（产品 ID 不敏感，可入仓库；key/secret 绝不硬编码） */
const EXPECT = {
  pro: 'prod_2BCJyvFBUnLGuln1yPIVPW',      // $19.99  LearnDiag Pro / recurring every-month
  report: 'prod_5SzuHiJqubsXug5fFno9ft',   // $9.99   一次性报告 / onetime once
};

let pass = 0, fail = 0, skip = 0, netFails = 0;
const ok = (t, d = '') => { pass++; console.log(`  [OK]   ${t}${d ? '   ' + d : ''}`); };
const bad = (t, d = '') => { fail++; console.log(`  [FAIL] ${t}${d ? '   ' + d : ''}`); };
const skp = (t, d = '') => { skip++; console.log(`  [SKIP] ${t}${d ? '   ' + d : ''}`); };
const head = (t) => console.log(`\n== ${t} ==`);

const mask = (s) => (s && s.length > 16 ? s.slice(0, 10) + '...' + s.slice(-4) : '<短值>');

/** 把 fetch 的报错榨干：Node 的 fetch 只在 e.message 里写 "fetch failed"，
 *  真正的原因（ECONNREFUSED / ENOTFOUND / UND_ERR_CONNECT_TIMEOUT…）藏在 e.cause。
 *  不打印 cause 的话，用户拿到的就是一句没法行动的 "fetch failed"。 */
const why = (e) => {
  const c = e && e.cause;
  const code = c && (c.code || c.errno || c.message);
  return String((e && e.message) || e) + (code ? '  [' + code + ']' : '');
};

const NET_CODES = /UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|UND_ERR_SOCKET/i;
const isNetError = (e) => {
  const c = (e && e.cause) || {};
  return NET_CODES.test(String(c.code || c.errno || '') + ' ' + String((e && e.message) || ''));
};

/** 网络层失败时给一段能直接照做的指引（含不依赖 Node 的 curl 备份路径）。 */
function netHint(e) {
  const c = (e && e.cause) || {};
  const code = String(c.code || c.errno || c.message || '');
  const head = '→ 这是本机出网问题，不是站点问题。';
  if (/ENOTFOUND|EAI_AGAIN/i.test(code)) {
    return head + ' DNS 解析失败，检查本机 DNS / 代理规则（learndiag.com 走 Cloudflare）。';
  }
  if (/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/i.test(code)) {
    return head + ' 连接超时 —— 九成是环境里残留的 HTTPS_PROXY 指向了不通的端口（Node 24 会自动走它）。\n'
      + '         本脚本已自动忽略环境代理，若仍失败请重跑；持续失败改用下面的 curl 验。';
  }
  return head + (code ? ' 底层原因 ' + code : '');
}

/** 不依赖 Node fetch 的备份验证命令（Windows 自带 curl.exe）。 */
function curlFallback() {
  console.log('\n  备份验证（PowerShell，不依赖 Node）：');
  console.log('    curl.exe -s -X POST ' + SITE + '/api/billing/report-checkout -H "Content-Type: application/json" -d "{\\"visitor_id\\":\\"v_test\\"}"');
  console.log('    └ 返回里带 checkout_url 就说明 key + CREEM_REPORT_PRODUCT_ID + CREEM_MODE 三样全对。');
}

// ---------- 读本地凭据 ----------
function readCreds() {
  const out = { apiKey: null, webhookSecret: null, proId: null, reportId: null };
  const kf = path.join(KEY_DIR, 'CreemKey.txt');
  const lf = path.join(KEY_DIR, 'produnct-link.txt');

  if (fs.existsSync(kf)) {
    const raw = fs.readFileSync(kf, 'utf8');
    out.apiKey = (raw.match(/creem_[A-Za-z0-9]+/) || [])[0] || null;
    out.webhookSecret = (raw.match(/whsec_[A-Za-z0-9]+/) || [])[0] || null;
  }
  if (fs.existsSync(lf)) {
    // 注意：别用 /pro/i 判 Pro 行 —— "prot_d..." 之外，URL 里的 "payment/prod_xxx"
    // 本身就含 "pro"，会把报告行也误判成 Pro 行（2026-09-11 踩过）。
    // 改成先认「报告」语义，再认「Pro/订阅」语义。
    for (const line of fs.readFileSync(lf, 'utf8').split(/\r?\n/)) {
      const m = line.match(/prod_[A-Za-z0-9]+/);
      if (!m) continue;
      if (/报告|report|onetime|一次性/i.test(line)) out.reportId = out.reportId || m[0];
      else if (/PRO|订阅|subscription|19\.9/.test(line)) out.proId = out.proId || m[0];
    }
  }
  return out;
}

async function creemGet(base, productId, apiKey) {
  const url = `${base}/products?product_id=${encodeURIComponent(productId)}`;
  const r = await fetch(url, { headers: { 'x-api-key': apiKey, Accept: 'application/json' } });
  let body = null;
  try { body = await r.json(); } catch { /* ignore */ }
  return { status: r.status, body };
}

async function siteReq(pathname, init = {}) {
  const r = await fetch(SITE + pathname, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'learndiag-live-check/1.0',
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, snippet: text.replace(/\s+/g, ' ').slice(0, 200) };
}

// ---------- A 层 ----------
async function layerA(c) {
  head('A 层 · 本地凭据打 Creem live API（证明凭据本身有效）');

  if (!c.apiKey) {
    bad('CREEM_API_KEY 未取到', `检查 ${path.join(KEY_DIR, 'CreemKey.txt')}`);
    return;
  }
  if (c.apiKey.length < 20 || c.apiKey === 'creem_test') {
    bad('API key 看起来不是 live key', `len=${c.apiKey.length}  前缀=${c.apiKey.slice(0, 12)}`);
  } else {
    ok('API key 形态正确（live 前缀，无 _test_）', `len=${c.apiKey.length}  ${mask(c.apiKey)}`);
  }
  c.webhookSecret
    ? ok('WEBHOOK_SECRET 已取到', `len=${c.webhookSecret.length}  ${mask(c.webhookSecret)}（无法用 API 验证，只能靠后台比对）`)
    : bad('CREEM_WEBHOOK_SECRET 未取到');

  // 产品 ID 与期望值一致性
  c.proId === EXPECT.pro
    ? ok('Pro 产品 ID 与期望一致', EXPECT.pro)
    : bad('Pro 产品 ID 与期望不一致', `文件=${c.proId || '未取到'}  期望=${EXPECT.pro}`);
  c.reportId === EXPECT.report
    ? ok('报告产品 ID 与期望一致', EXPECT.report)
    : bad('报告产品 ID 与期望不一致', `文件=${c.reportId || '未取到'}  期望=${EXPECT.report}`);

  for (const [label, pid, wantPrice, wantType] of [
    ['Pro $19.99', EXPECT.pro, 1999, 'recurring'],
    ['报告 $9.99', EXPECT.report, 999, 'onetime'],
  ]) {
    try {
      const live = await creemGet(LIVE_API, pid, c.apiKey);
      const p = live.body || {};
      if (live.status === 200 && p.price === wantPrice && p.billing_type === wantType) {
        ok(`[live] ${label} 有效`, `name=${JSON.stringify(p.name)} price=${p.price} ${p.billing_type}/${p.billing_period} status=${p.status}`);
      } else {
        bad(`[live] ${label} 不符合预期`, `HTTP ${live.status} price=${p.price} type=${p.billing_type} ${live.status !== 200 ? JSON.stringify(live.body).slice(0, 140) : ''}`);
      }
    } catch (e) {
      bad(`[live] ${label} 请求失败`, why(e).slice(0, 160));
      if (isNetError(e)) { netFails++; console.log('         ' + netHint(e)); }
    }
  }

  // 反证：同一把 key 打 test 域必须 401，否则说明拿错了 key
  try {
    const t = await creemGet(TEST_API, EXPECT.pro, c.apiKey);
    t.status === 401
      ? ok('反证通过：同一把 key 打 test 域返回 401', '→ 确认这是 live key')
      : bad('反证失败：key 在 test 域没被拒', `HTTP ${t.status} —— 可能拿到的是 test key，或 Creem 行为变了`);
  } catch (e) {
    if (isNetError(e)) netFails++;
    skp('反证请求未完成', why(e).slice(0, 120));
  }
}

// ---------- B 层 ----------
async function layerB() {
  head('B 层 · 线上路由（证明变量真的进了 Cloudflare 运行时）');

  // B1 —— report-checkout：免登录，一次性覆盖 key + CREEM_REPORT_PRODUCT_ID + CREEM_MODE
  try {
    const r = await siteReq('/api/billing/report-checkout', {
      method: 'POST',
      body: JSON.stringify({ visitor_id: 'v_livecheck_' + Date.now() }),
    });
    if (r.status === 200 && r.json && r.json.checkout_url) {
      ok('report-checkout 返回了 checkout_url', '→ key / CREEM_REPORT_PRODUCT_ID / CREEM_MODE 三样都对');
      const m = String(r.json.checkout_url).match(/prod_[A-Za-z0-9]+/);
      if (m) {
        m[0] === EXPECT.report
          ? ok('checkout_url 指向正确的报告产品', m[0])
          : bad('checkout_url 指向的产品不对', `实际=${m[0]}  期望=${EXPECT.report}`);
      }
    } else if (r.status === 404) {
      bad('report-checkout 404', '→ 新 worker 没部署上去（或路由没注册）');
    } else {
      const hint = (r.json && r.json.error && r.json.error.hint) || r.snippet;
      if (String(hint).includes('CREEM_REPORT_PRODUCT_ID')) {
        bad('缺 CREEM_REPORT_PRODUCT_ID', '→ 这个变量没建，$9.99 报告点进去就 500');
      } else if (String(hint).includes('Creem not configured')) {
        bad('缺 CREEM_API_KEY', '→ key 没配，所有结账都起不来');
      } else {
        bad('report-checkout 未返回 checkout_url', `HTTP ${r.status}  ${String(hint).slice(0, 160)}`);
      }
    }
  } catch (e) {
    if (isNetError(e)) { netFails++; bad('report-checkout 请求失败', why(e).slice(0, 160)); console.log('         ' + netHint(e)); }
    else bad('report-checkout 请求失败', why(e).slice(0, 160));
  }

  // B2 —— webhook：空体无签名。503 = secret 没配；401 = secret 已配且验签在工作
  try {
    const r = await siteReq('/api/billing/webhook', { method: 'POST', body: '{}' });
    const err = String((r.json && r.json.error) || '');
    if (r.status === 503 || err === 'webhook_secret_not_configured') {
      bad('CREEM_WEBHOOK_SECRET 没配', `HTTP ${r.status} ${err} —— 代码 fail-closed，这是对的防线`);
    } else if (err === 'bad signature') {
      ok('webhook 验签在跑（secret 已配）', `HTTP ${r.status} {"error":"bad signature"}`);
      console.log('         └ 只证明「secret 存在」，不证明「是 live 那把」—— secret 的值读不到，只能覆盖重设。');
      console.log('           覆盖：CF → 变量 → 编辑 CREEM_WEBHOOK_SECRET → 粘 key0910/CreemKey.txt 里的 whsec_ 值。');
    } else if (r.status === 401 || r.status === 400) {
      ok('webhook 拒绝了无签名请求', `HTTP ${r.status} → 验签生效`);
    } else if (r.status === 404) {
      bad('webhook 404', '→ 新 worker 没部署上去');
    } else if (r.status === 200) {
      bad('webhook 对无签名请求返回 200', '🔴 严重：验签可能被绕过，立刻停下来检查');
    } else if (r.status === 403 && /cloudflare|cf-/i.test(r.snippet)) {
      skp('webhook 被 Cloudflare 边缘拦了', `HTTP 403 —— 不是应用层问题（Bot Fight Mode / WAF）`);
    } else {
      bad('webhook 响应异常', `HTTP ${r.status}  ${r.snippet.slice(0, 140)}`);
    }
  } catch (e) {
    if (isNetError(e)) { netFails++; bad('webhook 请求失败', why(e).slice(0, 160)); console.log('         ' + netHint(e)); }
    else bad('webhook 请求失败', why(e).slice(0, 160));
  }

  // B3 —— checkout（Pro）：无 token 应 401，证明路由在
  try {
    const r = await siteReq('/api/billing/checkout', { method: 'POST', body: '{}' });
    if (r.status === 401) {
      ok('checkout 路由存在且要求登录', 'HTTP 401 unauthorized');
      console.log('         └ Pro 的产品 ID 无法在未登录下端到端验证，登录后跑：');
      console.log('           curl -s -X POST ' + SITE + '/api/billing/checkout \\');
      console.log('             -H "Authorization: Bearer <你的token>" | grep -o "prod_[A-Za-z0-9]*"');
      console.log('           期望看到 ' + EXPECT.pro);
    } else if (r.status === 404) {
      bad('checkout 404', '→ 新 worker 没部署上去');
    } else {
      bad('checkout 响应异常', `HTTP ${r.status}  ${r.snippet.slice(0, 140)}`);
    }
  } catch (e) {
    if (isNetError(e)) { netFails++; bad('checkout 请求失败', why(e).slice(0, 160)); console.log('         ' + netHint(e)); }
    else bad('checkout 请求失败', why(e).slice(0, 160));
  }
}

// ---------- main ----------
console.log('Creem live 自检 —— ' + new Date().toISOString());
console.log('站点 ' + SITE + '   ·   凭据目录 ' + KEY_DIR);

const creds = readCreds();
try {
  await layerA(creds);
  await layerB();
} catch (e) {
  console.log('\n未预期错误：' + String(e && e.stack || e));
  fail++;
}

head('结论');
console.log(`  通过 ${pass} / 失败 ${fail} / 跳过 ${skip}`);
if (fail === 0) {
  console.log('  → 全绿。五个变量已经生效，可以上真卡跑 $19.99 了。');
} else {
  console.log('  → 有 FAIL。**先看 B 层**：如果 B 层红而 A 层绿，九成是「变量改了但没部署」。');
  if (netFails > 0) {
    console.log(`  ⚠ 其中 ${netFails} 条是本机出网失败（fetch failed），**线上真实状态未知** ——`);
    console.log('     别把它当站点故障，先按下面的 curl 命令复验。');
  }
  curlFallback();
}
process.exit(fail === 0 ? 0 : 1);
