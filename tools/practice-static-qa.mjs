#!/usr/bin/env node
// practice-static-qa.mjs — 把 practice 页外置题库内联成静态 <details> Q&A 区块。
//
// 背景:praxis-80XX-practice 页面的题目全部在外置 /questions-80XX.js 里,
// HTML 静态壳只有约 500 词 → Google 首波索引看到的是薄页(crawled-not-indexed)。
// 本工具从题库生成「全部题目+答案+解析」的文本版,插入 </article> 前的
// <!-- STATIC-QA:START --> ... <!-- STATIC-QA:END --> 标记区。
// 标记区内内容整体重新生成 → 幂等,题库更新后重跑即可。
//
// 用法:
//   node tools/practice-static-qa.mjs            # 处理全部配置页
//   node tools/practice-static-qa.mjs 8002 8003  # 只处理指定页
//
// 注意:改了 HTML 后必须重建 md 镜像:
//   node tools/md-one.mjs praxis-80XX-practice --write

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "site");

// schemaA: q/options/answer(index)/answers(indices)+multi —— 8002, 8006 系
// schemaB: stem/choices/correct_answer(文本或文本数组)/question_type —— 8003/8004/8005 系
const PAGES = [
  { slug: "praxis-8002-practice", bank: "questions-8002.js", schema: "A", test: "8002" },
  { slug: "praxis-8003-practice", bank: "questions-8003.js", schema: "B", test: "8003" },
  { slug: "praxis-8004-practice", bank: "questions-8004.js", schema: "B", test: "8004" },
  { slug: "praxis-8005-practice", bank: "questions-8005.js", schema: "B", test: "8005" },
];

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function loadBank(file) {
  const src = readFileSync(join(SITE, file), "utf8");
  const sandbox = {};
  new Function("window", src)(sandbox);
  const key = Object.keys(sandbox)[0];
  if (!key || !Array.isArray(sandbox[key])) throw new Error(file + ": 未找到题库数组");
  return sandbox[key];
}

// 统一成 { stem, choices[], correctTexts[], explanation, dex{}, stimulus, numeric }
function normalize(item, schema) {
  if (schema === "A") {
    const choices = item.options || [];
    let correctTexts;
    if (item.multi || Array.isArray(item.answers)) {
      correctTexts = (item.answers || []).map((i) => choices[i]).filter(Boolean);
    } else {
      correctTexts = [choices[item.answer]].filter(Boolean);
    }
    return {
      stem: item.q,
      choices,
      correctTexts,
      explanation: item.explain || "",
      dex: item.dex || {},
      stimulus: item.stimulus || "",
      numeric: choices.length === 0,
    };
  }
  const choices = item.choices || [];
  const ca = item.correct_answer;
  const correctTexts = Array.isArray(ca) ? ca.slice() : ca != null && ca !== "" ? [String(ca)] : [];
  return {
    stem: item.stem,
    choices,
    correctTexts,
    explanation: item.explanation || "",
    dex: item.distractor_explanations || {},
    stimulus: item.stimulus || "",
    numeric: item.question_type === "numeric-entry" || choices.length === 0,
  };
}

const LETTERS = "ABCDEFGH";

// 运行时引擎会洗牌选项;题库原始顺序把正确答案固定在 index 0。
// 静态版必须同样乱序,否则所有题答案都是 A。用题目 id 做种子 → 重跑结果稳定。
function seededShuffle(arr, seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderItem(n, it, domain, seed) {
  const rows = [];
  rows.push('<details class="sqa-item">');
  rows.push(
    '<summary><span class="sqa-num">Q' +
      n +
      "</span>" +
      (domain ? '<span class="sqa-dom">' + esc(domain) + "</span>" : "") +
      "<span class=\"sqa-stem\">" +
      esc(it.stem).replace(/\n/g, "<br>") +
      "</span></summary>"
  );
  rows.push('<div class="sqa-body">');
  if (it.stimulus) rows.push('<pre class="sqa-stim">' + esc(it.stimulus) + "</pre>");

  const correctIdx = [];
  let displayChoices = it.choices;
  if (it.choices.length) {
    displayChoices = seededShuffle(it.choices, seed);
    rows.push('<ol class="sqa-opts" type="A">');
    displayChoices.forEach((c, i) => {
      const hit = it.correctTexts.includes(c);
      if (hit) correctIdx.push(i);
      rows.push(
        "<li" + (hit ? ' class="sqa-correct"' : "") + ">" + esc(c).replace(/\n/g, "<br>") + (hit ? " ✓" : "") + "</li>"
      );
    });
    rows.push("</ol>");
    correctIdx.sort((x, y) => x - y);
  }

  let ansLine;
  if (it.numeric) {
    ansLine = "<strong>Answer: " + esc(it.correctTexts.join(" or ")) + ".</strong> ";
  } else if (correctIdx.length > 1) {
    ansLine =
      "<strong>Answers: " +
      correctIdx.map((i) => LETTERS[i]).join(" and ") +
      ".</strong> ";
  } else if (correctIdx.length === 1) {
    ansLine = "<strong>Answer: " + LETTERS[correctIdx[0]] + ".</strong> ";
  } else {
    ansLine = "<strong>Answer: " + esc(it.correctTexts.join(", ")) + ".</strong> ";
  }
  rows.push('<p class="sqa-ans">' + ansLine + esc(it.explanation).replace(/\n/g, "<br>") + "</p>");

  const dexEntries = Object.entries(it.dex).filter(([k]) => !it.correctTexts.includes(k));
  if (dexEntries.length) {
    rows.push('<ul class="sqa-dex">');
    for (const [choice, why] of dexEntries) {
      rows.push(
        "<li><strong>" + esc(choice) + ":</strong> " + esc(why).replace(/\n/g, "<br>") + "</li>"
      );
    }
    rows.push("</ul>");
  }
  rows.push("</div></details>");
  return rows.join("\n");
}

const STYLE = `<style>
.sqa-item{border:1px solid var(--line);background:var(--surface);margin-bottom:10px}
.sqa-item>summary{cursor:pointer;padding:14px 16px;font-size:14.5px;line-height:1.6;list-style:none}
.sqa-item>summary::-webkit-details-marker{display:none}
.sqa-item>summary:before{content:"+";font-family:var(--mono);color:var(--accent-deep);margin-right:10px}
.sqa-item[open]>summary:before{content:"–"}
.sqa-item[open]>summary{border-bottom:1px solid var(--line);font-weight:600}
.sqa-num{font-family:var(--mono);font-size:12.5px;color:var(--accent-deep);margin-right:10px}
.sqa-dom{font-family:var(--mono);font-size:11px;color:var(--ink-soft);border:1px solid var(--line);padding:1px 7px;margin-right:10px;vertical-align:1px}
.sqa-body{padding:14px 16px}
.sqa-opts{margin:0 0 12px 22px;font-size:14px}
.sqa-opts li{margin-bottom:5px;overflow-wrap:break-word}
.sqa-correct{color:var(--correct);font-weight:600}
.sqa-ans{font-size:14px;margin-bottom:10px}
.sqa-dex{margin:0 0 4px 22px;font-size:13.5px;color:var(--ink-soft)}
.sqa-dex li{margin-bottom:5px}
.sqa-stim{font-family:var(--mono);font-size:12.5px;background:var(--bg-soft);border:1px solid var(--line);padding:12px 14px;margin-bottom:12px;white-space:pre-wrap;overflow-wrap:break-word}
</style>`;

function buildSection(bank, schema, test) {
  const items = bank.map((x) => normalize(x, schema));
  const parts = [];
  parts.push("<!-- STATIC-QA:START (generated by tools/practice-static-qa.mjs — 勿手改,题库更新后重跑) -->");
  parts.push(STYLE);
  parts.push('<h2 id="question-index">All ' + items.length + " questions with answers (text version)</h2>");
  parts.push(
    "<p>This is the same " +
      items.length +
      '-question set as the interactive test above, in plain text — no JavaScript needed, so it can be read, printed, or copied into your notes. Answers and per-option explanations are inside each question. If you want the graded version with the category breakdown, use the interactive set instead.</p>'
  );
  items.forEach((it, i) => {
    const domain = schema === "A" ? bank[i].subtest : bank[i].content_domain;
    parts.push(renderItem(i + 1, it, domain, String(bank[i].id || i)));
  });
  parts.push("<!-- STATIC-QA:END -->");
  return parts.join("\n");
}

function processPage(cfg) {
  const path = join(SITE, cfg.slug + ".html");
  let html = readFileSync(path, "utf8");
  const bank = loadBank(cfg.bank);
  const section = buildSection(bank, cfg.schema, cfg.test);

  const start = html.indexOf("<!-- STATIC-QA:START");
  const end = html.indexOf("<!-- STATIC-QA:END -->");
  if (start !== -1 && end !== -1) {
    html = html.slice(0, start) + section + html.slice(end + "<!-- STATIC-QA:END -->".length);
  } else {
    const anchor = html.indexOf("</article>");
    if (anchor === -1) throw new Error(cfg.slug + ": 找不到 </article> 锚点");
    html = html.slice(0, anchor) + "\n" + section + "\n\n" + html.slice(anchor);
  }
  writeFileSync(path, html, "utf8");
  console.log(cfg.slug + ": 内联 " + bank.length + " 题,页面 " + html.length + "B");
}

const only = process.argv.slice(2);
const targets = only.length ? PAGES.filter((p) => only.some((o) => p.slug.includes(o))) : PAGES;
if (!targets.length) {
  console.error("没有匹配的页面配置。可选:" + PAGES.map((p) => p.slug).join(", "));
  process.exit(1);
}
for (const cfg of targets) processPage(cfg);
console.log("完成。记得重建 md 镜像: node tools/md-one.mjs <slug> --write");
