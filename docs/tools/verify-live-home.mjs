// verify-live-home.mjs — checks the deployed homepage raw HTML for SSR content
import { readFileSync } from 'node:fs';

const html = readFileSync(process.env.TEMP + '/live-home.html', 'utf8');
const rootMatch = /<div id="root">([\s\S]*?)\n  <\/div>\s*<script/.exec(html);
if (!rootMatch) { console.error('FAIL: no static content in #root'); process.exit(1); }
const inner = rootMatch[1];
const visible = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const checks = {
  'H1 in raw HTML': inner.includes('<h1'),
  'visible text >= 500 chars': visible.length >= 500,
  'hero section static': /<section class="hero/.test(inner),
  'subtest table static': inner.includes('5002') && inner.includes('5005'),
  'pricing static': inner.includes('$15'),
  'JSON-LD blocks (3)': (html.match(/application\/ld\+json/g) || []).length === 3,
  'og:image': html.includes('og:image" content="https://learndiag.com/og-image.png'),
  'og:type': html.includes('og:type" content="website"'),
  'canonical': html.includes('rel="canonical" href="https://learndiag.com/"'),
  'lang=en': html.includes('<html lang="en">'),
  'mcp-manifest link': html.includes('rel="mcp-manifest"'),
  'footer trust links': ['/about.html', '/contact.html', '/privacy.html', '/developers.html'].every(p => html.includes(`href="${p}"`)),
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`); if (!v) ok = false; }
console.log(`readable-text ratio: ${(visible.length / Buffer.byteLength(html)).toFixed(3)} (target >= 0.05)`);
process.exit(ok ? 0 : 1);
