// Idempotent head patch for every site/*.html:
//   1. <link rel="icon"> (favicon.svg)          — added when missing
//   2. <link rel="apple-touch-icon">            — added when site/apple-touch-icon.png exists
//   3. twitter:card + twitter:title/description/image — mirrored from og:* (falls back to <title>/description/og-image.png)
// Run: node tools/patch-seo-heads.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const hasAppleIcon = existsSync(join(siteDir, 'apple-touch-icon.png'));

const FAVICON = '<link rel="icon" href="/favicon.svg" type="image/svg+xml">';
const APPLE = '<link rel="apple-touch-icon" href="/apple-touch-icon.png">';

function match1(re, s) { const m = s.match(re); return m ? m[1] : null; }

let patched = 0;
const files = readdirSync(siteDir).filter(f => f.endsWith('.html'));
for (const f of files) {
  const p = join(siteDir, f);
  const html = readFileSync(p, 'utf8');
  const headEnd = html.indexOf('</head>');
  if (headEnd === -1) { console.warn('SKIP (no </head>):', f); continue; }
  const head = html.slice(0, headEnd);
  const add = [];

  if (!/rel=["']icon["']/.test(head)) add.push('  ' + FAVICON);
  if (hasAppleIcon && !/rel=["']apple-touch-icon["']/.test(head)) add.push('  ' + APPLE);

  if (!/name=["']twitter:card["']/.test(head)) {
    const titleTag = match1(/<title[^>]*>([\s\S]*?)<\/title>/, head) || 'Learndiag';
    const ogTitle = match1(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/, head);
    const ogDesc = match1(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/, head);
    const metaDesc = match1(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/, head);
    const ogImage = match1(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/, head);
    const twTitle = (ogTitle || titleTag).trim();
    const twDesc = (ogDesc || metaDesc || '').trim();
    const twImage = (ogImage || 'https://learndiag.com/og-image.png').trim();
    add.push('  <meta name="twitter:card" content="summary_large_image">');
    add.push(`  <meta name="twitter:title" content="${twTitle}">`);
    add.push(`  <meta name="twitter:description" content="${twDesc}">`);
    add.push(`  <meta name="twitter:image" content="${twImage}">`);
  }

  if (add.length) {
    const out = html.slice(0, headEnd) + add.join('\n') + '\n' + html.slice(headEnd);
    writeFileSync(p, out);
    patched++;
    console.log('patched:', f, `(+${add.length})`);
  }
}
console.log(`done: ${patched}/${files.length} files patched`);
