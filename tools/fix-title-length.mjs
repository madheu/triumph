// 一次性脚本：把超长 <title> 压到 ≤60 字符。
// 原则：只截 title，不动 description / og / twitter（og、twitter 长度不参与 SERP 展示限制）。
// 用法：node tools/fix-title-length.mjs            只报告
//       node tools/fix-title-length.mjs --write    直接改文件
import { readFileSync, writeFileSync } from "fs";

const WRITE = process.argv.includes("--write");
const LIMIT = 60;
const BRAND = "| Learndiag";

function esc(s) {
  // title 里& 必须实体化，– 保留为实体
  return s.replace(/&(?![a-zA-Z#]+;)/g, "&amp;").replace(/–/g, "&ndash;");
}

// 人工指定：slug -> 新 title。留空表示走自动截断。品牌后缀全站统一为 | Learndiag
const MANUAL = {
  "praxis-5001-new-jersey-requirements": "New Jersey Praxis 5001 Requirements | Learndiag",
  "praxis-5001-free-practice-test": "Free Praxis 5001 Practice Test: 12 Questions | Learndiag",
  "praxis-elementary-education-fundamentals": "Praxis 8000 Series Fundamentals (8002-8006) | Learndiag",
  "praxis-8002-reading-and-language-arts": "Praxis 8002 Reading and Language Arts | Learndiag",
  "praxis-5004-social-studies-study-guide": "Praxis 5004 Social Studies Study Guide | Learndiag",
  "praxis-5001-vs-8000-series": "Praxis 5001 vs the 8000 Series: What Changed | Learndiag",
  "when-do-praxis-scores-come-out": "When Do Praxis Scores Come Out? | Learndiag",
  "praxis-8004-social-studies": "Praxis 8004 Social Studies: Format & Practice | Learndiag",
  "praxis-5003-math-study-guide": "Praxis 5003 Math Study Guide | Learndiag",
  "praxis-8004-practice": "Free Praxis 8004 Practice Test: 30 Questions | Learndiag",
  "praxis-8006-teaching-reading": "Praxis 8006 Teaching Reading | Learndiag",
  "praxis-8003-practice": "Free Praxis 8003 Practice Test: 30 Questions | Learndiag",
  "praxis-8003-mathematics": "Praxis 8003 Mathematics: Format & Practice | Learndiag",
  "praxis-8002-practice": "Free Praxis 8002 Practice Test: 30 Questions | Learndiag",
  // 该页 canonical 指向 /score-calculator，是附属页，与 by-state 页区分开
  "praxis-5001-passing-scores": "Praxis 5001 Passing Scores Explained | Learndiag",
  developers: "Learndiag API Docs: Praxis 5001 Question Bank | Learndiag",
  about: "About Learndiag | Learndiag",
  "praxis-8005-science": "Praxis 8005 Science: Format & Practice | Learndiag",
  "praxis-5001-passing-score-by-state": "Praxis 5001 Passing Scores by State | Learndiag",
  "praxis-5001-four-gate-strategy": "How to Pass Praxis 5001: Four-Gate Strategy | Learndiag",
  "praxis-5001-alabama-requirements": "Praxis 5001 Requirements in Alabama | Learndiag",
  "praxis-steps": "Praxis Steps: Modular Testing & Retakes | Learndiag",
  "praxis-8005-practice": "Free Praxis 8005 Practice Test: 30 Questions | Learndiag",
  "praxis-8002-vs-8006": "Praxis 8002 vs 8006: What's the Difference? | Learndiag",
};

function autoShorten(title) {
  let t = title;
  // 去尾部品牌后缀 → 截主体 → 再补回
  const hasBrand = t.endsWith(BRAND);
  let core = hasBrand ? t.slice(0, -BRAND.length).trim() : t;
  const room = LIMIT - (hasBrand ? BRAND.length + 1 : 0);
  if (core.length > room) {
    // 优先在最后一个逗号/冒号处断
    const cut = Math.max(core.lastIndexOf(", ", room), core.lastIndexOf(": ", room));
    if (cut > 20) core = core.slice(0, cut).trim();
    else core = core.slice(0, room).trim().replace(/[\s—–:-]+$/, "");
  }
  return hasBrand ? `${core} ${BRAND}` : core;
}

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const list = files.length
  ? files
  : (await import("fs")).readdirSync("site").filter((f) => f.endsWith(".html")).map((f) => `site/${f}`);

let fixed = 0;
const rows = [];
for (const f of list) {
  const h = readFileSync(f, "utf8");
  const m = h.match(/<title>([^<]*)<\/title>/);
  if (!m) continue;
  const old = m[1];
  if (old.length <= LIMIT) continue;
  const slug = f.replace(/^site\//, "").replace(/\.html$/, "");
  const raw = MANUAL[slug] || autoShorten(old);
  const neu = esc(raw);
  if (neu.length > LIMIT) {
    console.log(`❌ 人工映射仍超长 (${neu.length}) ${slug}: ${neu}`);
    continue;
  }
  rows.push({ f, old, neu, oldLen: old.length, newLen: neu.length });
  if (WRITE) {
    writeFileSync(f, h.replace(m[0], `<title>${neu}</title>`), "utf8");
  }
  fixed++;
}

console.log(`\n超长 title ${fixed} 个${WRITE ? "已修" : "（预览，加 --write 生效）"}：\n`);
for (const r of rows) {
  console.log(`  ${r.oldLen} → ${r.newLen}  ${r.f.replace("site/", "")}`);
  console.log(`     旧: ${r.old.replace(/&amp;/g, "&").replace(/&ndash;/g, "-")}`);
  console.log(`     新: ${r.neu}`);
}
console.log(`\n合计 ${fixed} 个。`);