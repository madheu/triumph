// Learndiag 站点状态速查
// 用法: node status.js
// 自动从 wrangler 配置读取 token，输出近 7 天流量、近 24h 曲线、注册用户、答题数据
import fs from 'fs';

const CFG = 'C:/Users/abc27/AppData/Roaming/xdg.config/.wrangler/config/default.toml';
const ZONE = 'e4ad15e985fd2d72ba6b415ad88812e2';
const ACC = 'ea1585383ab36bf04cbe995b49285ffc';
const DB = '5d04a307-4dc9-4236-9492-817f17f3a351';
const KV = '07ad9fc5b16b4bccb31cc92080a29e88';

// Cloudflare 的 access token 只有 1 小时寿命，refresh token 每次用完会轮换，
// 所以每次都重新换一个并写回配置，脚本就能长期免维护地跑。
async function getToken() {
  const s = fs.readFileSync(CFG, 'utf8');
  const rt = s.match(/refresh_token\s*=\s*"([^"]+)"/)?.[1];
  if (!rt) throw new Error('配置里没有 refresh_token，先运行 wrangler login');
  const res = await fetch('https://dash.cloudflare.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rt,
      client_id: '54d11594-84e4-41aa-b438-e81b8fa78ee7',
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('刷新失败: ' + JSON.stringify(j).slice(0, 200));
  const exp = new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString();
  fs.writeFileSync(
    CFG,
    s
      .replace(/oauth_token\s*=\s*"[^"]*"/, `oauth_token = "${j.access_token}"`)
      .replace(/expiration_time\s*=\s*"[^"]*"/, `expiration_time = "${exp}"`)
      .replace(/refresh_token\s*=\s*"[^"]*"/, `refresh_token = "${j.refresh_token}"`)
  );
  return j.access_token;
}

async function gql(token, query, variables) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const d = await res.json();
  if (d.errors) throw new Error(JSON.stringify(d.errors).slice(0, 300));
  return d.data;
}

async function cf(token, path, body) {
  const res = await fetch('https://api.cloudflare.com/client/v4' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

(async () => {
  const token = await getToken();

  // 1. 近 7 天按天
  const daily = await gql(token, `query($zone: String!, $since: String!) {
    viewer { zones(filter: {zoneTag: $zone}) {
      httpRequests1dGroups(limit: 10, filter: {date_geq: $since}, orderBy: [date_ASC]) {
        dimensions { date }
        sum { requests pageViews }
        uniq { uniques }
      }
    } }
  }`, { zone: ZONE, since: iso(7) });

  const rows = daily.viewer.zones[0]?.httpRequests1dGroups || [];
  console.log('=== 近 7 天（Cloudflare，UTC 日期）===');
  console.log('日期        请求   访问   页面浏览');
  rows.forEach((r) => {
    console.log(
      `${r.dimensions.date}  ${String(r.sum.requests).padStart(5)}  ${String(r.uniq.uniques).padStart(5)}  ${String(r.sum.pageViews ?? '-').padStart(6)}`
    );
  });

  // 2. 近 24h 小时级
  const hourly = await gql(token, `query($zone: String!, $since: String!) {
    viewer { zones(filter: {zoneTag: $zone}) {
      httpRequests1hGroups(limit: 30, filter: {date_geq: $since}, orderBy: [datetime_ASC]) {
        dimensions { datetime }
        sum { requests }
        uniq { uniques }
      }
    } }
  }`, { zone: ZONE, since: iso(2) });

  console.log('\n=== 近 48 小时曲线（UTC）===');
  const hs = hourly.viewer.zones[0]?.httpRequests1hGroups || [];
  const recent = hs.slice(-30);
  recent.forEach((g) => {
    const t = g.dimensions.datetime.slice(5, 16).replace('T', ' ');
    const bar = '#'.repeat(Math.min(g.sum.requests, 40));
    console.log(`${t}  ${String(g.sum.requests).padStart(3)} req  ${String(g.uniq.uniques).padStart(3)} uq  ${bar}`);
  });

  // 3. 来源 referer（可能受权限限制）
  try {
    const ref = await gql(token, `query($zone: String!, $since: String!) {
      viewer { zones(filter: {zoneTag: $zone}) {
        httpRequests1dGroups(limit: 7, filter: {date_geq: $since}, orderBy: [date_DESC]) {
          dimensions { date clientRequestHTTPRefererHost }
          sum { requests }
        }
      } }
    }`, { zone: ZONE, since: iso(7) });
    const rr = ref.viewer.zones[0]?.httpRequests1dGroups || [];
    const agg = {};
    rr.forEach((r) => {
      const h = r.dimensions.clientRequestHTTPRefererHost || '(直接访问)';
      agg[h] = (agg[h] || 0) + r.sum.requests;
    });
    console.log('\n=== 近 7 天来源 ===');
    Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .forEach(([h, n]) => console.log(`${String(n).padStart(5)}  ${h}`));
  } catch (e) {
    console.log('\n=== 来源 === 权限不足（需给 API token 加 Analytics 读权限）');
  }

  // 4. 注册用户（KV）
  const keys = await cf(token, `/accounts/${ACC}/storage/kv/namespaces/${KV}/keys?prefix=users:&limit=1000`);
  const users = keys.result || [];
  console.log(`\n=== 注册用户：${users.length} 个 ===`);
  for (const k of users.slice(0, 20)) {
    const v = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${KV}/values/${encodeURIComponent(k.name)}`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const txt = await v.text();
    let email = '?';
    try { email = JSON.parse(txt).email || '?'; } catch (e) {}
    console.log(`  ${email}`);
  }

  // 4b. KV 全键分布 + 最近访客状态
  try {
    const all = await cf(token, `/accounts/${ACC}/storage/kv/namespaces/${KV}/keys?limit=1000`);
    const list = all.result || [];
    const pref = {};
    list.forEach((k) => {
      const p = k.name.split(':')[0] + ':';
      pref[p] = (pref[p] || 0) + 1;
    });
    console.log('\n=== KV 键分布 ===');
    Object.entries(pref).sort((a, b) => b[1] - a[1]).forEach(([p, n]) => console.log(`  ${String(n).padStart(4)}  ${p}`));

    const states = list.filter((k) => k.name.startsWith('state:'));
    console.log(`\n=== 访客诊断状态：${states.length} 条 ===`);
    for (const k of states.slice(-8)) {
      const v = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${KV}/values/${encodeURIComponent(k.name)}`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      const txt = await v.text();
      let updated = '?', score = '?';
      try {
        const j = JSON.parse(txt);
        updated = j.updatedAt || j.lastActive || j.ts || '?';
        score = j.estimatedScore ?? j.score ?? '?';
      } catch (e) {}
      console.log(`  ${k.name.slice(6, 14)}…  ${updated}  score=${score}`);
    }
  } catch (e) {
    console.log('\n=== KV 分布 === 失败: ' + e.message.slice(0, 120));
  }

  // 5. 答题数据（D1）
  try {
    const a = await cf(token, `/accounts/${ACC}/d1/database/${DB}/query`, {
      sql: "SELECT * FROM attempts_daily ORDER BY date DESC LIMIT 14",
    });
    const ar = a.result?.[0]?.results || [];
    console.log('\n=== 每日答题量（D1）===');
    if (!ar.length) console.log('  无数据');
    ar.forEach((r) => console.log('  ' + JSON.stringify(r)));
  } catch (e) {
    console.log('\n=== D1 === 查询失败: ' + e.message.slice(0, 120));
  }
})().catch((e) => { console.error('出错:', e.message); process.exit(1); });
