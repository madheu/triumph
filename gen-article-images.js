// gen-article-images.js — 为每篇 SEO 文章生成 1200x630 专属配图（SVG → PNG）
// 风格：Learndiag 莫兰迪品牌（灰调粉 #C09D9B 主色、深暖灰、衬线标题）
// 用法: node gen-article-images.js
// 输出: site/images/<slug>.png（1200x630）
// 之后需把每篇文章 og:image 指到 images/<slug>.png

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const OUT_DIR = 'E:/Triumph/praxis-5001/site/images';
const W = 1200, H = 630;

// 品牌色（来自 brand-spec.md）
const C = {
  bg: '#F2EFE9',        // 暖灰白
  bgSoft: '#E8E3D8',    // 浅暖灰
  ink: '#3C3733',       // 深暖灰褐
  inkSoft: '#6E6760',   // 中暖灰
  line: '#D8D1C5',      // 分隔线
  accent: '#C09D9B',    // 莫兰迪粉（主色）
  accentDeep: '#A67D7A',// 深粉
};

// 文章 -> 图内标题 + 副题 + 主题 emoji（Emoji 由 sharp 文本渲染成 PNG 可能缺字体，改用文字标签）
const ARTICLES = [
  { slug: 'praxis-5001-study-guide', title: 'Praxis 5001 Study Guide', tag: 'FULL GUIDE' },
  { slug: 'praxis-5001-passing-score-by-state', title: 'Passing Scores by State', tag: 'STATE MAP' },
  { slug: 'praxis-5001-passing-scores', title: 'Praxis 5001 Passing Scores', tag: 'SCORES' },
  { slug: 'praxis-5001-subtests-explained', title: 'Four Subtests Explained', tag: 'SUBTESTS' },
  { slug: 'praxis-5001-free-practice-test', title: 'Free Practice Test', tag: 'PRACTICE' },
  { slug: 'praxis-5001-four-gate-strategy', title: 'The Four-Gate Strategy', tag: 'STRATEGY' },
  { slug: 'praxis-5001-registration-guide', title: 'Registration Guide', tag: 'HOW TO REGISTER' },
  { slug: 'praxis-5001-retake-guide', title: 'Retake Guide', tag: 'RETAKES' },
  { slug: 'praxis-5001-vs-7001', title: '5001 vs 7001', tag: 'COMPARISON' },
  { slug: 'praxis-5001-vs-8000-series', title: '5001 vs the 8000 Series', tag: 'COMPARISON' },
  { slug: 'praxis-5002-study-guide', title: '5002 Reading: Study Guide', tag: 'SUBTEST 5002' },
  { slug: 'praxis-5003-math-study-guide', title: '5003 Math: Study Guide', tag: 'SUBTEST 5003' },
  { slug: 'praxis-5004-social-studies-study-guide', title: '5004 Social Studies: Guide', tag: 'SUBTEST 5004' },
  { slug: 'praxis-5005-science-study-guide', title: '5005 Science: Study Guide', tag: 'SUBTEST 5005' },
  { slug: 'praxis-5001-alabama-requirements', title: 'Alabama Requirements', tag: 'STATE: AL' },
  { slug: 'praxis-5001-kentucky-requirements', title: 'Kentucky Requirements', tag: 'STATE: KY' },
  { slug: 'praxis-5001-maryland-requirements', title: 'Maryland Requirements', tag: 'STATE: MD' },
  { slug: 'praxis-5001-new-jersey-requirements', title: 'New Jersey Requirements', tag: 'STATE: NJ' },
  { slug: 'praxis-5001-pennsylvania-requirements', title: 'Pennsylvania Requirements', tag: 'STATE: PA' },
  { slug: 'praxis-5001-south-carolina-requirements', title: 'South Carolina Requirements', tag: 'STATE: SC' },
  { slug: 'praxis-5001-tennessee-requirements', title: 'Tennessee Requirements', tag: 'STATE: TN' },
  { slug: 'praxis-5001-virginia-requirements', title: 'Virginia Requirements', tag: 'STATE: VA' },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svgFor({ title, tag }) {
  const titleLines = [];
  const words = title.split(' ');
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 26) { titleLines.push(cur.trim()); cur = w; }
    else { cur = (cur + ' ' + w).trim(); }
  }
  if (cur) titleLines.push(cur.trim());

  const titleHtml = titleLines.map((l, i) =>
    `<text x="80" y="${300 + i * 88}" font-family="Georgia, 'Times New Roman', serif" font-size="72" font-style="italic" fill="${C.ink}">${esc(l)}</text>`
  ).join('\n');

  const dotY = 300 + titleLines.length * 88 - 40;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bg}"/>
      <stop offset="1" stop-color="${C.bgSoft}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <!-- 左侧装饰竖条（品牌粉） -->
  <rect x="0" y="0" width="14" height="${H}" fill="${C.accent}"/>
  <!-- 顶部细线 -->
  <rect x="80" y="72" width="1040" height="2" fill="${C.line}"/>
  <!-- 品牌 -->
  <text x="80" y="118" font-family="Georgia, serif" font-size="30" font-style="italic" fill="${C.inkSoft}">Learndiag<span fill="${C.accent}">.</span></text>
  <!-- 标签（tag） -->
  <text x="80" y="208" font-family="'Courier New', monospace" font-size="26" letter-spacing="4" fill="${C.accentDeep}">${esc(tag)}</text>
  <!-- 标题（多行） -->
  ${titleHtml}
  <!-- 副题：Praxis 5001 · 免费备考 -->
  <text x="80" y="${dotY + 118}" font-family="'Courier New', monospace" font-size="22" fill="${C.inkSoft}">PRAXIS 5001 · ELEMENTARY EDUCATION · FREE PREP</text>
  <!-- 底部 4 个方块（四个 subtest 隐喻） -->
  <g>
    <rect x="80" y="${H-120}" width="44" height="44" fill="${C.accent}" opacity="0.9"/>
    <rect x="134" y="${H-120}" width="44" height="44" fill="${C.accent}" opacity="0.7"/>
    <rect x="188" y="${H-120}" width="44" height="44" fill="${C.accent}" opacity="0.5"/>
    <rect x="242" y="${H-120}" width="44" height="44" fill="${C.accent}" opacity="0.3"/>
  </g>
</svg>`;
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// 支持单 slug 参数: node gen-article-images.js <slug>
const only = process.argv[2];
const targets = only ? ARTICLES.filter(a => a.slug === only) : ARTICLES;

let count = 0;
for (const a of targets) {
  const svg = svgFor(a);
  const outPath = path.join(OUT_DIR, a.slug + '.png');
  await sharp(Buffer.from(svg)).resize(W, H).png().toFile(outPath);
  count++;
  console.log('✓', a.slug + '.png');
}
console.log(`\n生成 ${count} 张，输出到 ${OUT_DIR}`);
