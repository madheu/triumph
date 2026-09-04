// add-rel-links.mjs — insert rel="prev"/"next" series links into guide page heads (idempotent)
import fs from 'node:fs';

const SITE = new URL('../site/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const order = [
  'praxis-5001-study-guide',
  'praxis-5001-four-gate-strategy',
  'praxis-5001-retake-guide',
  'praxis-5001-vs-7001',
  'praxis-5001-vs-8000-series',
  'praxis-5002-study-guide',
  'praxis-5003-math-study-guide',
  'praxis-5004-social-studies-study-guide',
  'praxis-5005-science-study-guide',
];

for (let i = 0; i < order.length; i++) {
  const p = SITE + order[i] + '.html';
  let src = fs.readFileSync(p, 'utf8');
  src = src.replace(/\s*<link rel="(next|prev)"[^>]*>/g, '');
  const prev = i > 0 ? order[i - 1] : null;
  const next = i < order.length - 1 ? order[i + 1] : null;
  let tags = '';
  if (prev) tags += `\n  <link rel="prev" href="https://learndiag.com/${prev}">`;
  if (next) tags += `\n  <link rel="next" href="https://learndiag.com/${next}">`;
  const canonRe = /(<link rel="canonical" href="[^"]*">)/;
  if (!canonRe.test(src)) { console.log(order[i], ': NO CANONICAL — skipped'); continue; }
  src = src.replace(canonRe, '$1' + tags);
  fs.writeFileSync(p, src);
  console.log(order[i].padEnd(45), 'prev:', String(prev).padEnd(40), 'next:', next);
}
