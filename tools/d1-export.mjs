// tools/d1-export.mjs — 导出生产 D1 的 product_events 全量数据
//
// 用法：node tools/d1-export.mjs
// 产出：db/backup-product_events-YYYYMMDD.{json,sql}
//
// 为什么要留这个工具：埋点表没有自动清理也没有自动备份（D1 无快照），
// 而 schema 变更是要重建表的（SQLite 不支持 DROP CONSTRAINT）。
// 每次改结构前先跑一次，出事能从 .sql 回灌。
// 凭据取自 wrangler 的 OAuth 配置，过期会自动提示。
import fs from 'node:fs';

const F = 'C:/Users/abc27/AppData/Roaming/xdg.config/.wrangler/config/default.toml';
const tok = fs.readFileSync(F, 'utf8').match(/^oauth_token\s*=\s*"([^"]*)"/m)[1];
const ACCT = 'ea1585383ab36bf04cbe995b49285ffc';
const DB = '5d04a307-4dc9-4236-9492-817f17f3a351';

const COLS = ['id', 'event_uuid', 'event', 'ts', 'server_ts', 'visitor_id', 'session_id',
  'user_id', 'attempt_id', 'page', 'test_code', 'traffic_source', 'device', 'score_band',
  'weakest_domain', 'signup_method', 'content_domain', 'question_id', 'correct', 'elapsed_ms',
  'extra_json'];

const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB}/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ sql: `SELECT ${COLS.join(', ')} FROM product_events ORDER BY id` }),
});
const j = await r.json();
if (!j.success) { console.error('导出失败:', JSON.stringify(j.errors).slice(0, 400)); process.exit(1); }
const rows = j.result[0].results;

const stamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
const jsonPath = `db/backup-product_events-${stamp}.json`;
fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 1));

// 同时生成可直接回灌的 INSERT 脚本
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}
const lines = rows.map((row) =>
  `INSERT INTO product_events (${COLS.join(', ')}) VALUES (${COLS.map((c) => lit(row[c])).join(', ')});`);
const sqlPath = `db/backup-product_events-${stamp}.sql`;
fs.writeFileSync(sqlPath, `-- product_events 迁移前备份 · ${rows.length} 行 · ${new Date().toISOString()}\n` + lines.join('\n') + '\n');

console.log(`✓ 已备份 ${rows.length} 行`);
console.log(`  ${jsonPath}`);
console.log(`  ${sqlPath}`);
console.log('最早:', new Date(rows[0].ts).toISOString(), '最新:', new Date(rows[rows.length - 1].ts).toISOString());
