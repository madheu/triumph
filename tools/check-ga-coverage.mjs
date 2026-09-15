#!/usr/bin/env node
/**
 * GA 覆盖守卫（2026-09-13 建立）
 *
 * 背景：`site/js/tracking.js:174` 是 `if (typeof global.gtag !== 'function') return;`
 *   —— 页面自带 gtag 片段才会发 GA4。曾出现 47 页里唯一 `praxis-8006-practice.html`
 *   漏掉 head 里的 GA 片段 → 该页 GA4 零收数（`LDTrack.init` 照常调用、却全部早退）。
 *   静态检查看不出来，构建期零报错。
 *
 * 校验方式：断言「GA 片段的 5 个功能要素」都在，而非逐字节比对模板 ——
 *   全站实测存在 3 种等价写法：标准换行型、首页（注释写 "Google Analytics (GA4)"）、
 *   文章页（`</script>` 与上一行同行闭合）。形态差异无害，缺要素才致命。
 *
 * 断言：
 *   1) gtag.js 异步加载，且 id = CANONICAL_ID
 *   2) 内联片段里有 dataLayer 初始化
 *   3) 内联片段里有 gtag() 函数定义（push arguments）
 *   4) 内联片段里有 gtag("js", new Date)
 *   5) 内联片段里有 gtag("config","<CANONICAL_ID>")
 *   6) 该页不出现非规范流 ID（如误插 G-EJ5Q2X9NBS / G-41BNJXYJFD）
 *   7) gtag.js 不被加载两次（会双发 page_view）
 *   8) script / /script 标签配平（丢闭合标签会静默吃掉后续 JS）
 *
 * 用法：node tools/check-ga-coverage.mjs      （退出码 0 = 通过）
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// SITE_DIR 可覆盖（自检用：把坏页放进临时目录验证守卫真的会红）
const SITE = process.env.SITE_DIR || join(ROOT, "site");
const CANONICAL_ID = "G-MSR1Q1G7W9";

// 宽松正则：允许引号/空白的等价差异，但要素缺一不可
const RE = {
  loader: new RegExp(
    '<script[^>]*\\basync\\b[^>]*src="https://www\\.googletagmanager\\.com/gtag/js\\?id=' +
      CANONICAL_ID +
      '"[^>]*>'
  ),
  dataLayer: /window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\]/,
  gtagFn: /function\s+gtag\s*\(\s*\)\s*\{\s*dataLayer\.push\s*\(\s*arguments\s*\)\s*\}/,
  // 注意：全站写法是 `gtag("js",new Date)` —— `new Date` 不带调用括号（合法 JS），
  // 正则必须允许可选括号，否则 47 页全报错（2026-09-13 踩过）。
  jsEvent: /gtag\s*\(\s*["']js["']\s*,\s*new\s+Date\s*(?:\(\s*\))?\s*\)/,
  config: new RegExp(
    'gtag\\s*\\(\\s*["\']config["\']\\s*,\\s*["\']' + CANONICAL_ID + '["\']\\s*\\)'
  ),
};

const LABELS = {
  loader: "缺 gtag.js 异步加载（id 必须为 " + CANONICAL_ID + "）",
  dataLayer: "缺 dataLayer 初始化（window.dataLayer=window.dataLayer||[]）",
  gtagFn: "缺 gtag() 函数定义（function gtag(){dataLayer.push(arguments)}）",
  jsEvent: '缺 gtag("js",new Date)（gtag.js 要求先初始化 js 事件）',
  config: '缺 gtag("config","' + CANONICAL_ID + '")（没有 config 就不会上报）',
};

const anyIds = (html) => [...new Set(html.match(/G-[A-Z0-9]{8,}/g) || [])];

const pages = readdirSync(SITE).filter((f) => f.endsWith(".html")).sort();
const problems = [];
const okPages = [];

for (const f of pages) {
  const html = readFileSync(join(SITE, f), "utf8");
  const pageProblems = [];

  for (const [key, re] of Object.entries(RE)) {
    if (!re.test(html)) pageProblems.push(LABELS[key]);
  }

  const wrong = anyIds(html).filter((id) => id !== CANONICAL_ID);
  if (wrong.length) pageProblems.push("出现非规范流 ID: " + wrong.join(", "));

  const loads = (html.match(/googletagmanager\.com\/gtag\/js\?id=/g) || []).length;
  if (loads > 1) pageProblems.push("gtag.js 被加载 " + loads + " 次（会重复上报 page_view）");

  const open = (html.match(/<script\b/g) || []).length;
  const close = (html.match(/<\/script>/g) || []).length;
  if (open !== close) pageProblems.push("<script> 不配平: " + open + " 开 / " + close + " 闭");

  if (pageProblems.length) problems.push({ file: f, pageProblems });
  else okPages.push(f);
}

console.log("GA 覆盖守卫 — site/*.html 共 " + pages.length + " 页，规范流 " + CANONICAL_ID + "\n");
console.log("  通过：" + okPages.length + " 页");
console.log("  失败：" + problems.length + " 页");
if (problems.length) {
  console.log("");
  for (const p of problems) {
    console.log("  ✗ " + p.file);
    for (const m of p.pageProblems) console.log("      · " + m);
  }
  process.exit(1);
}
console.log("\n全部页面 GA 片段要素齐备、配平、流 ID 正确。");
