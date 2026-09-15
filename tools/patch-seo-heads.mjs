// Idempotent head patch for every site/*.html:
//   1. <link rel="icon"> (favicon.svg)          — added when missing
//   2. <link rel="apple-touch-icon">            — added when site/apple-touch-icon.png exists
//   3. twitter:card + twitter:title/description/image — mirrored from og:* (falls back to <title>/description/shared image)
//   4. Shared Learndiag image — matching OG/Twitter URLs, dimensions and descriptive alt text
// Run: node tools/patch-seo-heads.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const hasAppleIcon = existsSync(join(siteDir, 'apple-touch-icon.png'));

const FAVICON = '<link rel="icon" href="/favicon.svg" type="image/svg+xml">';
const APPLE = '<link rel="apple-touch-icon" href="/apple-touch-icon.png">';
const SHARED_IMAGE = 'https://learndiag.com/og-image-learndiag-v1.png';
const SHARED_IMAGE_ALT = 'Learndiag — free Praxis prep. Know where to start.';

function imageMeta(head, key) {
  return [...head.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]).find(tag =>
    new RegExp(`(?:property|name)=["']${key}["']`, 'i').test(tag));
}

function enrichSharedImage(head) {
  // Only META image URLs change; JSON-LD logos and article-specific images stay intact.
  head = head.replace(/<meta\b[^>]*>/gi, tag => tag.replace(
    /https:\/\/learndiag\.com\/og-image\.png(?=["'])/g, SHARED_IMAGE));
  const content = key => match1(/content=["']([^"']*)["']/i, imageMeta(head, key) || '');
  let ogImage = content('og:image');
  let twImage = content('twitter:image');
  const setMeta = (key, value) => {
    const tag = imageMeta(head, key);
    const replacement = `<meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${value}">`;
    head = tag ? head.replace(tag, replacement) : head + '  ' + replacement + '\n';
  };
  if (!ogImage && twImage === SHARED_IMAGE) {
    setMeta('og:image', SHARED_IMAGE);
    ogImage = SHARED_IMAGE;
  }
  if (!twImage && ogImage === SHARED_IMAGE) {
    setMeta('twitter:image', SHARED_IMAGE);
    twImage = SHARED_IMAGE;
  }
  if (ogImage === SHARED_IMAGE) {
    setMeta('og:image:width', '1200');
    setMeta('og:image:height', '630');
    setMeta('og:image:alt', SHARED_IMAGE_ALT);
  }
  if (twImage === SHARED_IMAGE) setMeta('twitter:image:alt', SHARED_IMAGE_ALT);
  return head;
}

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
    const twImage = (ogImage || SHARED_IMAGE).trim();
    add.push('  <meta name="twitter:card" content="summary_large_image">');
    add.push(`  <meta name="twitter:title" content="${twTitle}">`);
    add.push(`  <meta name="twitter:description" content="${twDesc}">`);
    if (!imageMeta(head, 'twitter:image')) add.push(`  <meta name="twitter:image" content="${twImage}">`);
  }

  const enrichedHead = enrichSharedImage(head + (add.length ? add.join('\n') + '\n' : ''));
  const out = enrichedHead + html.slice(headEnd);
  if (out !== html) {
    writeFileSync(p, out);
    patched++;
    console.log('patched:', f, `(+${add.length})`);
  }
}
console.log(`done: ${patched}/${files.length} files patched`);
