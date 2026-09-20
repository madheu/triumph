// test/md-sync.test.mjs — 守卫：site/md/*.md 必须等于 site/<slug>.html 的当前派生内容。
//
// 为什么需要它（2026-09-20）：
//   md 镜像是 AI 爬虫走 `Accept: text/markdown` 时读到的正文，由 tools/html-to-md.mjs 生成 ——
//   但在此之前**没有任何环节会校验它**：
//     · `npm run build:md` 是手动脚本，不在 test:all 里，也不在部署流程里；
//     · 部署只跑 build-worker.mjs，从不重建 md；
//     · 没有 .github/workflows、没有 .husky、没有启用的 git hook；
//     · test/build-sync.test.mjs 只守卫 site/_worker.js ↔ worker-src/，没有 md 的对应物。
//   结果：改了 HTML 忘重建 md，给人类看的是新页面、给 AI 爬虫看的是旧内容，而全流程零报错。
//   2026-09-20 实测 31 个 md 里 8 个落后源页面（passing-score-by-state 差约 9k 字，
//   alabama 还留着页面早已删除的价格 $150 与 Manual B 链接）。
//
// 枚举口径是 **site/md/ 目录本身**，不是工具里那份手写 PAGES 清单 ——
//   实测 PAGES 只有 22 项，而 site/md 有 31 个文件：多出的 9 个（index、4 个州/专题页、
//   8006、resources、terms）**全量 build:md 根本不会碰**，只能一直烂下去。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = path.join(ROOT, 'site');
const MD_DIR = path.join(SITE, 'md');
const mod = await import(pathToFileURL(path.join(ROOT, 'tools', 'html-to-md.mjs')).href);

const front = slug =>
  `<!-- Markdown variant of https://learndiag.com/${slug} — request any page with Accept: text/markdown -->\n\n`;
// 行尾差异不是内容差异 —— CRLF 会让逐字比对假报「全文重写」。
const lf = s => s.replace(/\r\n/g, '\n');

// 生成器不适用的页面：md 只能人工维护，不能用派生内容校验。
// 加条目必须写明「生成器在这页为什么失效」，并在生成器修好后删掉 —— 严禁为了变绿而豁免。
const UNSUITABLE = new Map([
  ['index',
    '首页没有 <article> 结构，生成器回退到整页转换，会把 <head> 里的 GTM/GA 脚本当正文转出' +
    '（实测产出约 26k 字、含 dataLayer 的垃圾）。site/md/index.md 是人工维护版，予以保留。'],
]);

test('site/md/*.md 与源 HTML 派生内容一致（改了 HTML 必须重建 md）', () => {
  const slugs = fs.readdirSync(MD_DIR)
    .filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
  assert.ok(slugs.length, 'site/md 下没有任何 md —— 目录被清空了？');

  const drift = [], orphan = [];
  for (const slug of slugs) {
    const htmlPath = path.join(SITE, slug + '.html');
    if (!fs.existsSync(htmlPath)) { orphan.push(slug); continue; }
    if (UNSUITABLE.has(slug)) continue;
    const fresh = lf(front(slug) + mod.convertGuideFile(htmlPath).md);
    const disk = lf(fs.readFileSync(path.join(MD_DIR, slug + '.md'), 'utf8'));
    if (fresh !== disk) drift.push({ slug, f: fresh.length, d: disk.length });
  }

  const problems = [];
  if (orphan.length) {
    problems.push(`源 HTML 已不存在的孤儿 md（页面删了，md 应一并删除）：\n    ${orphan.join(', ')}`);
  }
  if (drift.length) {
    problems.push(
      `${drift.length} 个 md 落后于源 HTML —— AI 爬虫读到的还是旧内容。逐个重建：\n` +
      drift.map(d =>
        `    node tools/md-one.mjs ${d.slug} --write` +
        `     # 派生 ${d.f} 字 vs 磁盘 ${d.d} 字`
      ).join('\n')
    );
  }
  assert.equal(problems.length, 0, '\n\n' + problems.join('\n\n') + '\n');
});

test('豁免页的 md 没有被清空（豁免的是「不能校验」，不是「不管了」）', () => {
  for (const [slug, why] of UNSUITABLE) {
    const p = path.join(MD_DIR, slug + '.md');
    assert.ok(fs.existsSync(p), `${slug}.md 不在了，但它在豁免名单里（原因：${why}）`);
    const size = fs.statSync(p).size;
    assert.ok(size > 500, `${slug}.md 只剩 ${size} 字节，疑似被清空或被垃圾输出覆盖`);
  }
});
