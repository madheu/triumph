// fetch-traffic.js — 拉取 Cloudflare Analytics 流量数据（GraphQL）
// 用法: node fetch-traffic.js <CF_TOKEN> [天数]
const token = process.argv[2];
const days = Number(process.argv[3] || 14);
if (!token) { console.error('用法: node fetch-traffic.js <CF_TOKEN> [天数]'); process.exit(1); }

const ZONE = 'e4ad15e985fd2d72ba6b415ad88812e2'; // trytriumph.de5.net
const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); // YYYY-MM-DD

async function gql(query, variables) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

(async () => {
  // 1) 按天请求量（httpRequests1dGroups）
  const q1 = `query($zone: String!, $since: String!) {
    viewer { zones(filter: {zoneTag: $zone}) {
      httpRequests1dGroups(limit: ${days}, filter: {date_geq: $since}, orderBy: [date_ASC]) {
        dimensions { date }
        sum { requests, pageViews, bytes, cachedRequests, cachedBytes }
        uniq { uniques }
      }
    } }
  }`;
  const d1 = await gql(q1, { zone: ZONE, since });
  const daysData = (d1.viewer.zones[0]?.httpRequests1dGroups || []);
  console.log('=== 按天请求量 ===');
  console.log('日期 | 请求 | 页面浏览 | 唯一访客 | 带宽 | 缓存命中');
  daysData.forEach(d => {
    const s = d.sum;
    console.log(`${d.dimensions.date} | ${s.requests} | ${s.pageViews} | ${d.uniq.uniques} | ${(s.bytes/1024/1024).toFixed(2)}MB | ${s.cachedRequests}`);
  });
  const totalReq = daysData.reduce((a, d) => a + d.sum.requests, 0);
  const totalUniq = daysData.reduce((a, d) => a + (d.uniq.uniques || 0), 0);
  console.log(`\n合计: ${totalReq} 请求, ${totalUniq} 唯一访客(按天累加)`);

  // 2) 按国家（httpRequests1hGroups 聚合近 7 天）
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const q2 = `query($zone: String!, $since: String!) {
    viewer { zones(filter: {zoneTag: $zone}) {
      httpRequests1hGroups(limit: 5000, filter: {date_geq: $since}) {
        dimensions { clientCountryName }
        sum { requests }
      }
    } }
  }`;
  const d2 = await gql(q2, { zone: ZONE, since: since7 });
  const countryMap = {};
  (d2.viewer.zones[0]?.httpRequests1hGroups || []).forEach(d => {
    const c = d.dimensions.clientCountryName || 'Unknown';
    countryMap[c] = (countryMap[c] || 0) + d.sum.requests;
  });
  const sorted = Object.entries(countryMap).sort((a, b) => b[1] - a[1]);
  console.log('\n=== 按国家（近 7 天）===');
  sorted.forEach(([c, n]) => console.log(`${c}: ${n}`));

  // 3) 按路径（近 7 天）
  const q3 = `query($zone: String!, $since: String!) {
    viewer { zones(filter: {zoneTag: $zone}) {
      httpRequests1hGroups(limit: 5000, filter: {date_geq: $since}) {
        dimensions { clientRequestPath }
        sum { requests }
      }
    } }
  }`;
  const d3 = await gql(q3, { zone: ZONE, since: since7 });
  const pathMap = {};
  (d3.viewer.zones[0]?.httpRequests1hGroups || []).forEach(d => {
    const p = d.dimensions.clientRequestPath || '/';
    pathMap[p] = (pathMap[p] || 0) + d.sum.requests;
  });
  const sortedPath = Object.entries(pathMap).sort((a, b) => b[1] - a[1]);
  console.log('\n=== 按路径（近 7 天）===');
  sortedPath.slice(0, 30).forEach(([p, n]) => console.log(`${n}\t${p}`));

  // 4) 状态码分布（近 7 天）
  const q4 = `query($zone: String!, $since: String!) {
    viewer { zones(filter: {zoneTag: $zone}) {
      httpRequests1hGroups(limit: 5000, filter: {date_geq: $since}) {
        dimensions { edgeResponseStatus }
        sum { requests }
      }
    } }
  }`;
  const d4 = await gql(q4, { zone: ZONE, since: since7 });
  const statusMap = {};
  (d4.viewer.zones[0]?.httpRequests1hGroups || []).forEach(d => {
    const s = String(d.dimensions.edgeResponseStatus);
    statusMap[s] = (statusMap[s] || 0) + d.sum.requests;
  });
  console.log('\n=== 状态码分布（近 7 天）===');
  Object.entries(statusMap).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`${s}: ${n}`));

  // 5) 来源 referer（近 7 天）
  const q5 = `query($zone: String!, $since: String!) {
    viewer { zones(filter: {zoneTag: $zone}) {
      httpRequests1hGroups(limit: 5000, filter: {date_geq: $since}) {
        dimensions { clientRequestHTTPHost clientRequestPath }
        sum { requests }
      }
    } }
  }`;
  // host 分布
  const d5 = await gql(q5, { zone: ZONE, since: since7 });
  const hostMap = {};
  (d5.viewer.zones[0]?.httpRequests1hGroups || []).forEach(d => {
    const h = d.dimensions.clientRequestHTTPHost || 'unknown';
    hostMap[h] = (hostMap[h] || 0) + d.sum.requests;
  });
  console.log('\n=== 按 Host（近 7 天）===');
  Object.entries(hostMap).sort((a, b) => b[1] - a[1]).forEach(([h, n]) => console.log(`${n}\t${h}`));

})().catch(e => { console.error('错误:', e.message); process.exit(1); });
