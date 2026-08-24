// seo-publish.js — 把 Triumph SEO/*.md 文章转成 site/<slug>.html（纯静态 HTML，无 React 依赖）
// 用法: node seo-publish.js
// 输入: E:/Triumph/Triumph SEO/*.md（带 YAML front matter: title/slug/meta_description）
// 输出: E:/Triumph/praxis-5001/site/<slug>.html
// 支持: front matter、GFM 表格（含对齐）、内链(/diagnostic 等)、外链、blockquote、
//       有序/无序列表、checkbox 列表、行内 code、粗斜体、裸 URL 自动链接、Sources 小节
// 州落地页: front matter 含 state_name 时启用 geo meta + contentLocation JSON-LD + 州专属头部
import fs from 'fs';
import path from 'path';

const SRC_DIR = 'E:/Triumph/Triumph SEO';
const OUT_DIR = 'E:/Triumph/praxis-5001/site';
const SITE = 'https://trytriumph.de5.net'; // 正式公开域名（canonical 统一用它）
const DATE = '2026-08-24';

// ---------- YAML front matter ----------
function parseFrontMatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { data: {}, body: md };
  const data = {};
  m[1].split('\n').forEach(line => {
    const kv = line.match(/^(\w[\w_]*):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  });
  return { data, body: m[2] };
}

// ---------- inline markdown ----------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  s = esc(s);
  // 行内 code 先保护起来
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\x00${codes.length - 1}\x00`; });
  // 链接 [text](url) —— 支持 http(s) 和 / 开头的内链
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  // 裸 URL
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_, pre, u) => `${pre}<a href="${u}">${u}</a>`);
  // 粗体 → 斜体
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // 还原 code
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => `<code>${codes[+i]}</code>`);
  return s;
}

// ---------- block markdown ----------
function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  let listType = null; // 'ul' | 'ol' | 'check'
  const closeList = () => {
    if (listType) { out.push(listType === 'ol' ? '</ol>' : `</ul>`); listType = null; }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    if (!t) { closeList(); i++; continue; }

    // 表格：当前行含 | 且下一行是分隔行
    if (t.includes('|') && i + 1 < lines.length && /^\|?[\s:|-]+\|[\s:|-]*/.test(lines[i + 1].trim()) && lines[i + 1].includes('-')) {
      closeList();
      const parseRow = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const heads = parseRow(t);
      const aligns = parseRow(lines[i + 1]).map(c => /:$/.test(c) ? 'right' : (/^:-/.test(c) ? 'left' : ''));
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
        rows.push(parseRow(lines[i])); i++;
      }
      const th = heads.map((h, k) => `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(h)}</th>`).join('');
      const trs = rows.map(r => '<tr>' + r.map((c, k) => `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c)}</td>`).join('') + '</tr>').join('\n');
      out.push(`<table><thead><tr>${th}</tr></thead>\n<tbody>\n${trs}\n</tbody></table>`);
      continue;
    }

    // 标题（一级标题跳过，页面 H1 单独渲染）
    if (/^###\s/.test(t)) { closeList(); out.push(`<h3>${inline(t.replace(/^###\s+/, ''))}</h3>`); i++; continue; }
    if (/^##\s/.test(t)) { closeList(); out.push(`<h2>${inline(t.replace(/^##\s+/, ''))}</h2>`); i++; continue; }
    if (/^#\s/.test(t)) { i++; continue; }

    // blockquote
    if (/^>\s?/.test(t)) {
      closeList();
      const qs = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { qs.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote><p>${qs.map(inline).join('<br>')}</p></blockquote>`);
      continue;
    }

    // checkbox 列表
    if (/^-\s+\[[ xX]\]\s+/.test(t)) {
      if (listType !== 'check') { closeList(); out.push('<ul class="checklist">'); listType = 'check'; }
      const checked = /^-\s+\[[xX]\]/.test(t);
      out.push(`<li class="${checked ? 'done' : ''}">${inline(t.replace(/^-\s+\[[ xX]\]\s+/, ''))}</li>`);
      i++; continue;
    }

    // 无序列表
    if (/^[-*]\s+/.test(t)) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(t.replace(/^[-*]\s+/, ''))}</li>`);
      i++; continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(t)) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(t.replace(/^\d+\.\s+/, ''))}</li>`);
      i++; continue;
    }

    // 普通段落
    closeList();
    out.push(`<p>${inline(t)}</p>`);
    i++;
  }
  closeList();

  // Sources 小节的段落缩成小字
  let html = out.join('\n');
  html = html.replace(/(<h2>Sources<\/h2>)([\s\S]*)$/, (_, h, rest) =>
    h + '\n<div class="sources">' + rest.trim() + '</div>');
  return html;
}

// ---------- 页面模板 ----------
function eyebrowFor(title) {
  const m = title.match(/Praxis (\d{4})/);
  if (title.includes('vs')) return 'Exam updates · Praxis';
  if (m) return `Study guide · Praxis ${m[1]}`;
  return 'Resource · Praxis';
}

// 州落地页专用：州代码 → US 地区标签（geo meta 用）
function geoRegionFor(state) {
  const codes = {
    'Virginia': 'US-VA', 'Tennessee': 'US-TN', 'South Carolina': 'US-SC',
    'Pennsylvania': 'US-PA', 'Alabama': 'US-AL', 'Kentucky': 'US-KY',
    'Maryland': 'US-MD', 'Georgia': 'US-GA', 'North Carolina': 'US-NC',
    'Ohio': 'US-OH', 'Indiana': 'US-IN', 'Texas': 'US-TX',
  };
  return codes[state] || 'US';
}

// 检查清单要求的"内容集群内链"：单科指南回链总指南 + Four-Gate；8000 文章链回 vs-7001
function relatedLinks(slug) {
  if (slug.startsWith('praxis-500')) {
    return `<p>Related: <a href="/praxis-5001-study-guide">Praxis 5001 Study Guide (all four subtests)</a> &middot; <a href="/praxis-5001-four-gate-strategy">The Four-Gate Strategy</a></p>`;
  }
  if (slug.includes('8000')) {
    return `<p>Related: <a href="/praxis-5001-vs-7001">Praxis 5001 vs 7001: What&rsquo;s Changing</a></p>`;
  }
  if (slug.includes('passing-scores')) {
    return `<p>Related: <a href="/praxis-5001-study-guide">Praxis 5001 Study Guide</a> &middot; <a href="/praxis-5001-vs-8000-series">Praxis 5001 vs the 8000 Series</a></p>`;
  }
  return '';
}

// guide 系列 rel next/prev 链（与 test/agentic.test.mjs 的 SERIES 保持一致）
const GUIDE_SERIES = [
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

function prevNextLinks(slug) {
  const i = GUIDE_SERIES.indexOf(slug);
  if (i === -1) return '';
  const links = [];
  if (i > 0) links.push(`<link rel="prev" href="${SITE}/${GUIDE_SERIES[i - 1]}">`);
  if (i < GUIDE_SERIES.length - 1) links.push(`<link rel="next" href="${SITE}/${GUIDE_SERIES[i + 1]}">`);
  return links.join('\n  ');
}

// 州落地页 extra head：geo meta + contentLocation JSON-LD
function stateHeadExtra(data) {
  if (!data.state_name) return '';
  const region = geoRegionFor(data.state_name);
  return `
  <meta name="geo.region" content="${region}">
  <meta name="geo.placename" content="${data.state_name}">
`;
}

// 州落地页 JSON-LD 在 Article 基础上加 contentLocation
function articleLd(data) {
  const base = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": data.title,
    "description": data.meta_description,
    "datePublished": data.date || DATE,
    "author": { "@type": "Organization", "name": "Triumph" },
    "publisher": { "@type": "Organization", "name": "Triumph" },
    "mainEntityOfPage": `${SITE}/${data.slug}`
  };
  if (data.state_name) {
    base.contentLocation = { "@type": "State", "name": data.state_name };
  }
  return JSON.stringify(base, null, 2);
}

function page({ title, slug, desc, body, words, data = {} }) {
  const readMin = Math.max(3, Math.round(words / 200));
  const related = relatedLinks(slug);
  const isState = !!data.state_name;
  const eyebrow = isState ? `State guide · Praxis ${data.state_name}` : eyebrowFor(title);
  const pubDate = data.date || DATE;
  const ld = articleLd({ title, slug, meta_description: desc, state_name: data.state_name, date: pubDate });
  const seriesLinks = prevNextLinks(slug);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} | Triumph</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${SITE}/${slug}">
  ${seriesLinks ? `${seriesLinks}\n  ` : ''}<meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${SITE}/${slug}">
${stateHeadExtra(data)}<!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-MSR1Q1G7W9"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-MSR1Q1G7W9');
  </script>

  <script type="application/ld+json">
  ${ld}
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    *, *::before, *::after { min-width: 0; }
    :root {
      --bg: #F2EFE9; --bg-soft: #E8E3D8; --ink: #3C3733; --ink-soft: #6E6760;
      --line: #D8D1C5; --accent: #C09D9B; --accent-deep: #A67D7A;
      --serif: "Instrument Serif", Georgia, serif;
      --sans: "Instrument Sans", system-ui, sans-serif;
      --mono: "JetBrains Mono", ui-monospace, monospace;
    }
    html, body { height: 100%; width: 100%; overflow-x: hidden; }
    body { font-family: var(--sans); background: var(--bg); color: var(--ink); -webkit-font-smoothing: antialiased; line-height: 1.75; }
    h1, h2, h3 { text-wrap: balance; }
    p, li, td { overflow-wrap: break-word; }
    a { color: var(--accent-deep); }
    .wrap { max-width: 760px; margin: 0 auto; padding: 0 40px; }
    @media (max-width: 760px) { .wrap { padding: 0 50px; } }

    .nav { display: flex; align-items: baseline; justify-content: space-between; padding: 28px 0 24px; border-bottom: 1px solid var(--line); flex-wrap: wrap; gap: 10px 18px; }
    .wordmark { font-family: var(--serif); font-style: italic; font-size: 26px; display: inline-flex; align-items: center; min-height: 44px; color: var(--ink); text-decoration: none; }
    .nav-note { font-size: 13px; color: var(--ink-soft); }
    .nav-cta { font-size: 14px; font-weight: 600; color: var(--accent); text-decoration: none; border-bottom: 1px solid currentColor; padding-bottom: 2px; }
    @media (max-width: 760px) { .nav-note { display: none; } }

    article { padding: 56px 0 24px; }
    .eyebrow { font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600; color: var(--ink-soft); display: block; margin-bottom: 20px; }
    article h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(34px, 5vw, 48px); line-height: 1.12; margin-bottom: 8px; }
    .meta-line { font-family: var(--mono); font-size: 13px; color: var(--ink-soft); margin: 14px 0 36px; }
    article h2 { font-family: var(--serif); font-weight: 400; font-size: 27px; line-height: 1.25; margin: 44px 0 14px; }
    article h3 { font-family: var(--serif); font-weight: 400; font-size: 21px; margin: 28px 0 10px; }
    article p { margin-bottom: 16px; }
    article ul, article ol { margin: 0 0 16px 1.4em; }
    article li { margin-bottom: 8px; }
    article code { font-family: var(--mono); color: var(--accent-deep); font-size: 13px; }

    table { width: 100%; border-collapse: collapse; margin: 20px 0 28px; font-size: 14px; }
    th { text-align: left; font-family: var(--mono); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); border-bottom: 1px solid var(--ink); padding: 10px 12px; }
    td { border-bottom: 1px solid var(--line); padding: 12px; vertical-align: top; }
    .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }

    blockquote { border-left: 2px solid var(--accent); background: var(--bg-soft); padding: 18px 22px; margin: 24px 0; }
    blockquote p:last-child { margin-bottom: 0; }

    .checklist { list-style: none; margin-left: 0 !important; }
    .checklist li { padding-left: 1.6em; position: relative; }
    .checklist li::before { content: ""; position: absolute; left: 0; top: 0.45em; width: 0.8em; height: 0.8em; border: 1.5px solid var(--accent); }
    .checklist li.done::before { background: var(--accent); }

    .sources { font-size: 13px; color: var(--ink-soft); }
    .sources p { margin-bottom: 8px; word-break: break-all; }

    .cta-box { border-left: 2px solid var(--accent); background: var(--bg-soft); padding: 18px 22px; margin: 26px 0; font-size: 15px; }
    .related { margin: 8px 0 0; font-size: 14px; color: var(--ink-soft); }
    .related a { font-weight: 600; }

    .footer { padding: 48px 0 64px; }
    .footer p { font-size: 12px; color: var(--ink-soft); line-height: 1.7; max-width: 60em; }
  </style>
</head>
<body>
  <header class="nav wrap">
    <a class="wordmark" href="/" aria-label="Triumph home">Triumph<span style="color:var(--accent)">.</span></a>
    <div style="display:flex; gap:24px; align-items:baseline;">
      <span class="nav-note">Praxis 5001 · unofficial</span>
      <a class="nav-cta" href="/">Home</a>
      <a class="nav-cta" href="/resources">Resources</a>
      <a class="nav-cta" href="/diagnostic">Free diagnostic &rarr;</a>
    </div>
  </header>

  <article class="wrap">
    <span class="eyebrow">${eyebrow}</span>
    <h1>${esc(title)}</h1>
    <div class="meta-line">${pubDate} · Reading time: about ${readMin} min</div>
${body}
    <div class="cta-box">
      <p style="margin:0"><strong>Not sure which gate is weakest?</strong> Take the free Praxis readiness diagnostic &rarr; <a href="/diagnostic">Triumph readiness check</a></p>
    </div>
${related ? `<div class="related">${related}</div>` : ''}
  </article>

  <footer class="footer wrap">
    ${isState && data.agency_name ? `<p><strong>${data.state_name} certification authority:</strong> <a href="${data.agency_url || '#'}">${data.agency_name}</a>. Confirm every requirement — test codes, qualifying scores, deadlines, and reciprocity rules — with the agency and with ETS before registering.</p>` : ''}
    <p>Triumph is an independent study tool. Not affiliated with, endorsed by, or sponsored by ETS. Praxis is a trademark of ETS. Exam facts (question counts, timing, fees) reflect ETS pages as of ${pubDate} and can change — confirm with ETS and your state licensing agency before registering.</p>
  </footer>
</body>
</html>
`;
}

// ---------- 主流程 ----------
const files = fs.readdirSync(SRC_DIR).filter(f => /^\D*\d{4}.*\.md$|^Praxis.*\.md$|^State.*\.md$/.test(f) && !/^\d{2}-/.test(f));
const results = [];
for (const f of files) {
  const md = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  const { data, body } = parseFrontMatter(md);
  if (!data.slug) { console.log(`跳过（无 slug）: ${f}`); continue; }
  const words = body.split(/\s+/).length;
  const html = mdToHtml(body);
  // 表格包一层横向滚动容器（移动端防溢出）
  const safeHtml = html.replace(/<table>/g, '<div class="table-scroll"><table>').replace(/<\/table>/g, '</table></div>');
  const out = page({ title: data.title, slug: data.slug, desc: data.meta_description, body: safeHtml, words, data });
  const outPath = path.join(OUT_DIR, data.slug + '.html');
  fs.writeFileSync(outPath, out, 'utf8');
  results.push({ file: f, slug: data.slug, title: data.title, words, out: outPath, state: data.state_name || null });
  console.log(`✓ ${f} -> ${data.slug}.html (${words} words)${data.state_name ? ` [state: ${data.state_name}]` : ''}`);
}
console.log(`\n共生成 ${results.length} 篇`);
