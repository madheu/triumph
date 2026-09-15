/**
 * tools/check-babel-hooks.mjs — 守卫：babel 页里的 React hook 必须已声明
 *
 * 背景（2026-09-13 线上 P0）：site/drill.html 的 <script type="text/babel"> 写的是
 *   const{useState}=React   ... 却在 App() 里调用 useEffect(...)
 * → ReferenceError: useEffect is not defined → 整个 React 树渲染失败 → 整页白屏。
 * 这个 bug 在 HEAD 里就存在，265 项单元测试全绿也没抓到（它们不跑真浏览器）。
 *
 * 本脚本只做静态检查，不需要浏览器：
 *   1) 每个用到的 React hook（useState/useEffect/...）必须已从 React 解构，
 *      或以 React.xxx 形式调用；
 *   2) 顺带断言 <script> 标签配平（丢闭合标签会静默吃掉后续 JS）。
 *
 * 用法：node tools/check-babel-hooks.mjs
 * 自检：SITE_DIR=<目录> node tools/check-babel-hooks.mjs   （用坏页验证它会红）
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.env.SITE_DIR || join(ROOT, 'site');

const HOOKS = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer', 'useLayoutEffect'];

const files = readdirSync(SITE).filter((f) => f.endsWith('.html')).sort();
const problems = [];
let scanned = 0;
let babelPages = 0;

for (const f of files) {
  const html = readFileSync(join(SITE, f), 'utf8');
  const pageProblems = [];

  // <script> 配平（含 type="text/babel"）
  const open = (html.match(/<script\b/g) || []).length;
  const close = (html.match(/<\/script>/g) || []).length;
  if (open !== close) pageProblems.push(`<script> 不配平: ${open} 开 / ${close} 闭`);

  const blocks = [...html.matchAll(/<script[^>]*type="text\/babel"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (blocks.length) {
    babelPages++;
    scanned++;
    const src = blocks.join('\n');

    // 已从 React 解构出来的名字
    const declared = new Set();
    for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*React\b/g)) {
      for (const part of m[1].split(',')) {
        const name = part.split(':').pop().trim();
        if (name) declared.add(name);
      }
    }
    // 也认 `const React = ...` 之类的整体引用与裸箭头解构 `({...}) =>` 无法覆盖，
    // 所以只在「既没解构、也没用 React.xxx」时报错。
    for (const hook of HOOKS) {
      const bareCall = new RegExp(`(?<![\\w.$])${hook}\\s*\\(`);
      const viaReact = new RegExp(`React\\s*\\.\\s*${hook}\\b`);
      if (bareCall.test(src) && !declared.has(hook) && !viaReact.test(src)) {
        pageProblems.push(`调用了 ${hook}(...) 但没有从 React 解构，也没写 React.${hook} → 运行时会 ReferenceError，整页白屏`);
      }
    }
  }

  if (pageProblems.length) problems.push({ file: f, pageProblems });
}

console.log(`babel 页守卫 — 扫描 ${files.length} 个 html，其中 ${babelPages} 个含 text/babel 脚本`);
for (const p of problems) {
  console.log(`\n✗ ${p.file}`);
  for (const msg of p.pageProblems) console.log(`    - ${msg}`);
}
if (problems.length) {
  console.log(`\n失败：${problems.length} 个页面有问题`);
  process.exit(1);
}
console.log(`通过：${babelPages} 个 babel 页 hook 声明齐备、script 配平正常`);
