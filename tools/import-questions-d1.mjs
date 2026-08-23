// tools/import-questions-d1.mjs — 题库导入脚本（本地离线验证 + 输出线上执行 SQL）
//
// 用法（两种模式）:
//   1) 本地验证（无需 Cloudflare）:
//      node tools/import-questions-d1.mjs --local
//      会在项目根生成 .d1-test/questions.db，套用 db/schema.sql 并导入题库，打印统计
//   2) 导出线上 SQL（配合 wrangler 执行）:
//      node tools/import-questions-d1.mjs --sql out.sql
//      生成 INSERT 语句文件，然后:
//      wrangler d1 execute triumph_db --file=db/schema.sql
//      wrangler d1 execute triumph_db --file=out.sql
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const schemaSql = readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8');
const bank = JSON.parse(readFileSync(join(ROOT, 'assets', 'questions-full.json'), 'utf8'));
const questions = bank.questions || [];
const now = Date.now();

const args = process.argv.slice(2);
const sqlOut = args.indexOf('--sql') !== -1 ? args[args.indexOf('--sql') + 1] : null;
const localMode = args.includes('--local') || !sqlOut;

/** 单条 INSERT 语句（D1 与 SQLite 通用，避免大事务失败） */
function insertSql(q) {
  const esc = s => (s == null ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'");
  return `INSERT INTO questions (id, external_id, subtest, category, difficulty, type, stem_md, options_json, answer_index, explanation_md, status, source_batch, created_at, updated_at)
VALUES (${esc(q.id)}, ${esc(q.id)}, ${esc(q.subtest)}, ${esc(q.category)}, ${esc(q.difficulty || '')}, ${esc(q.type || '')}, ${esc(q.question)}, ${esc(JSON.stringify(q.options || []))}, ${esc(q.answer_index)}, ${esc(q.explanation || '')}, 'active', ${esc(bank.version || '')}, ${now}, ${now});\n`;
}

if (sqlOut) {
  const out = questions.map(insertSql).join('');
  writeFileSync(join(ROOT, sqlOut), out);
  console.log(`导出 ${questions.length} 条 INSERT 到 ${sqlOut}`);
  console.log(`下一步（在项目根目录）:`);
  console.log(`  wrangler d1 execute triumph_db --file=db/schema.sql`);
  console.log(`  wrangler d1 execute triumph_db --file=${sqlOut}`);
} else {
  // ---- 本地验证模式 ----
  const dbDir = join(ROOT, '.d1-test');
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, 'questions.db');
  const db = new DatabaseSync(dbPath);
  db.exec(schemaSql); // 套用 schema（D1 兼容 SQLite 语法）

  const insert = db.prepare(`INSERT INTO questions (id, external_id, subtest, category, difficulty, type, stem_md, options_json, answer_index, explanation_md, status, source_batch, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`);
  let ok = 0;
  for (const q of questions) {
    insert.run(q.id, q.id, q.subtest, q.category, q.difficulty || '', q.type || '',
      q.question, JSON.stringify(q.options || []), q.answer_index, q.explanation || '',
      bank.version || '', now, now);
    ok++;
  }

  const bySub = db.prepare('SELECT subtest, COUNT(*) n FROM questions GROUP BY subtest ORDER BY subtest').all();
  const byStatus = db.prepare('SELECT status, COUNT(*) n FROM questions GROUP BY status').all();
  const idxCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='questions'").all();
  console.log(`本地验证通过 ✅`);
  console.log(`  题库文件: assets/questions-full.json v${bank.version} (${questions.length} 题)`);
  console.log(`  导入成功: ${ok} 题 → ${dbPath}`);
  console.log(`  按科目分布: ${bySub.map(r => `${r.subtest}=${r.n}`).join(', ')}`);
  console.log(`  状态分布: ${byStatus.map(r => `${r.status}=${r.n}`).join(', ')}`);
  console.log(`  索引: ${idxCheck.map(i => i.name).join(', ')}`);
  console.log(`  schema 语法与字段映射 OK，可安全用于线上 D1（先跑 schema.sql 再跑导出 SQL）`);
  db.close();
}
