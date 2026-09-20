// tools/md-one.mjs — 重建单个页面的 markdown 镜像。
//
// 为什么需要单页版：全量 `npm run build:md` 会重写 site/md/ 下所有文件，多会话并行时会
// 覆盖别的会话尚未提交的 md 改动。只改了一页 HTML 就只重建那一页，是安全做法。
//
// 本文件原为 .qa-tmp/md-one.mjs。.qa-tmp/ 在 .gitignore 第 53 行 —— 那个工具从来没进过版本控制，
// 需要它的人找不到它，这也是 md 镜像长期漂移的原因之一。2026-09-20 移入 tools/。
//
// 用法:
//   node tools/md-one.mjs <slug>            → 只预览，写到 .qa-tmp/<slug>.preview.md（不碰 site/）
//   node tools/md-one.mjs <slug> --write    → 写入 site/md/<slug>.md
//
// 一致性由 test/md-sync.test.mjs 守卫：改完请跑 `npm test`（或 npm run test:all）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));   // <repo>/tools
const ROOT = path.resolve(here, '..');
const SITE = path.join(ROOT, 'site');

const mod = await import(pathToFileURL(path.join(here, 'html-to-md.mjs')).href);

const slug = process.argv[2];
if (!slug || slug.startsWith('-')) {
  console.error('usage: node tools/md-one.mjs <slug> [--write]');
  process.exit(2);
}

const src = path.join(SITE, slug + '.html');
if (!fs.existsSync(src)) {
  console.error('no such page:', src);
  console.error('(slug = site/<name>.html 的文件名，不含扩展名)');
  process.exit(2);
}

const { title, md } = mod.convertGuideFile(src);
const out = `<!-- Markdown variant of https://learndiag.com/${slug} — request any page with Accept: text/markdown -->\n\n` + md;

const write = process.argv.includes('--write');
const dir = write ? path.join(SITE, 'md') : path.join(ROOT, '.qa-tmp');
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, slug + (write ? '.md' : '.preview.md'));
fs.writeFileSync(target, out);

console.log(`${write ? 'wrote  ' : 'preview'} ${target}`);
console.log(`  ${md.length} chars · ${title}`);
