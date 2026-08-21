// md-to-article.js — 把 markdown 文章转成 site/<slug>.html（莫兰迪 + React CDN + SEO）
// 用法: node md-to-article.js "<md文件>" "<标题>" "<描述>" "<slug>"
// 依赖: 无（纯 node，简单 markdown 子集解析）
const fs = require('fs');

const [, , mdPath, title, desc, slug] = process.argv;
if (!mdPath || !title || !desc || !slug) { console.error('用法: node md-to-article.js <md> <title> <desc> <slug>'); process.exit(1); }
const md = fs.readFileSync(mdPath, 'utf8');

// 简单 markdown → HTML（# ## ###、列表、粗体、段落）
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>').replace(/`(.+?)`/g, '<code>$1</code>');

const lines = md.split('\n');
let html = [];
let inList = false;
const closeList = () => { if (inList) { html.push('</ul>'); inList = false; } };

lines.forEach(line => {
  const t = line.trim();
  if (!t) { closeList(); return; }
  if (/^###\s/.test(t)) { closeList(); html.push(`<h3>${inline(esc(t.replace(/^###\s/, '')))}</h3>`); }
  else if (/^##\s/.test(t)) { closeList(); html.push(`<h2>${inline(esc(t.replace(/^##\s/, '')))}</h2>`); }
  else if (/^#\s/.test(t)) { closeList(); /* 标题已在 H1 用，跳过 md 一级标题 */ }
  else if (/^[-*]\s/.test(t)) { if (!inList) { html.push('<ul>'); inList = true; } html.push(`<li>${inline(esc(t.replace(/^[-*]\s/, '')))}</li>`); }
  else if (/^\d+\.\s/.test(t)) { if (!inList) { html.push('<ul>'); inList = true; } html.push(`<li>${inline(esc(t.replace(/^\d+\.\s/, '')))}</li>`); }
  else { closeList(); html.push(`<p>${inline(esc(t))}</p>`); }
});
closeList();

const date = new Date().toISOString().slice(0, 10);
const body = html.join('\n');

const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} | Triumph</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://triumph-6eq.pages.dev/${slug}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="article">

  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-MSR1Q1G7W9"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-MSR1Q1G7W9');
  </script>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": ${JSON.stringify(title)},
    "description": ${JSON.stringify(desc)},
    "datePublished": "${date}",
    "author": { "@type": "Organization", "name": "Triumph" },
    "publisher": { "@type": "Organization", "name": "Triumph" }
  }
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

  <!-- React + Babel pinned -->
  <script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>

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
    @media (max-width: 760px) { .wrap { padding: 0 28px; } }

    .nav { display: flex; align-items: baseline; justify-content: space-between; padding: 28px 0 24px; border-bottom: 1px solid var(--line); }
    .wordmark { font-family: var(--serif); font-style: italic; font-size: 26px; color: var(--ink); }
    .nav-cta { font-size: 14px; font-weight: 600; color: var(--accent); text-decoration: none; border-bottom: 1px solid currentColor; padding-bottom: 2px; }
    @media (max-width: 760px) { .nav-note { display: none; } }

    article { padding: 56px 0 24px; }
    .eyebrow { font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600; color: var(--ink-soft); display: block; margin-bottom: 20px; }
    article h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(34px, 5vw, 48px); line-height: 1.12; margin-bottom: 8px; }
    .meta-line { font-family: var(--mono); font-size: 13px; color: var(--ink-soft); margin: 14px 0 36px; }
    article h2 { font-family: var(--serif); font-weight: 400; font-size: 27px; line-height: 1.25; margin: 44px 0 14px; }
    article h3 { font-family: var(--serif); font-weight: 400; font-size: 21px; margin: 28px 0 10px; }
    article p { margin-bottom: 16px; }
    article ul { margin: 0 0 16px 1.4em; }
    article li { margin-bottom: 8px; }
    article code { font-family: var(--mono); color: var(--accent-deep); font-size: 13px; }
    .cta-box { border-left: 2px solid var(--accent); background: var(--bg-soft); padding: 18px 22px; margin: 26px 0; font-size: 15px; }

    .footer { padding: 48px 0 64px; }
    .footer p { font-size: 12px; color: var(--ink-soft); line-height: 1.7; max-width: 60em; }
  </style>
</head>
<body>
  <div id="root"></div>

  <script type="text/babel">
    const ART = ${JSON.stringify({ body })};
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(
      <div>
        <header className="nav wrap">
          <a className="wordmark" href="index.html" style={{textDecoration:'none',color:'inherit'}}>Triumph<span style={{color:'var(--accent)'}}>.</span></a>
          <div style={{display:'flex', gap:20, alignItems:'baseline'}}>
            <a className="nav-cta" href="index.html">Home</a>
            <a className="nav-cta" href="resources">Resources</a>
            <a className="nav-cta" href="diagnostic">Free diagnostic →</a>
          </div>
        </header>
        <article className="wrap">
          <span className="eyebrow">Resource · Praxis 5001</span>
          <h1>${JSON.stringify(title)}</h1>
          <div className="meta-line">${date} · Reading time: about ${Math.max(3, Math.round(md.split(/\\s+/).length / 200))} min</div>
          <div dangerouslySetInnerHTML={{ __html: ART.body }} />
          <div className="cta-box">
            <p style={{margin:0}}><strong>Not sure which gate is weakest?</strong> Take the free 12-question diagnostic → <a href="diagnostic">Triumph readiness check</a></p>
          </div>
        </article>
        <footer className="footer wrap">
          <p>Triumph is an independent study tool. Not affiliated with, endorsed by, or sponsored by ETS. Praxis is a trademark of ETS.</p>
        </footer>
      </div>
    );
  </script>
</body>
</html>
`;

const out = `E:\Triumph\praxis-5001/site/${slug}.html`;
fs.writeFileSync(out, page, 'utf8');
console.log('已生成:', out, '(' + body.split('\n').length + ' 行内容)');
