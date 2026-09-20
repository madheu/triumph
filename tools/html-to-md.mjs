// html-to-md.mjs — convert Triumph guide pages to markdown variants.
// Usage: node tools/html-to-md.mjs   (writes site/md/<page>.md for every entry in PAGES)
// Also exports convertHtmlToMarkdown for tests.
import fs from 'node:fs';
import path from 'node:path';

const SITE = path.resolve(import.meta.dirname, '..', 'site');

/* ---------------- tokenizer / tree builder ---------------- */

const VOID_TAGS = new Set(['br', 'hr', 'img', 'meta', 'link', 'input']);

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&rarr;/g, '\u2192').replace(/&larr;/g, '\u2190').replace(/&middot;/g, '\u00b7')
    .replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013').replace(/&hellip;/g, '\u2026')
    .replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D')
    .replace(/&lsquo;/g, '\u2018').replace(/&rsquo;/g, '\u2019')
    .replace(/&trade;/g, '\u2122').replace(/&reg;/g, '\u00AE').replace(/&copy;/g, '\u00A9')
    .replace(/&amp;/g, '&');
}

export function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"]|"[^"]*")*?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[3] !== undefined) {
      const parent = stack[stack.length - 1];
      parent.children.push({ tag: '#text', text: m[3], children: [] });
      continue;
    }
    if (m[0].startsWith('<!--')) continue;
    const closing = m[0].startsWith('</');
    const tag = m[1].toLowerCase();
    if (closing) {
      // pop until matching tag (tolerant)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = {};
    const attrRe = /([a-zA-Z-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g;
    let am;
    while ((am = attrRe.exec(m[2] || '')) !== null) {
      if (!am[1]) continue;
      attrs[am[1].toLowerCase()] = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '';
    }
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!VOID_TAGS.has(tag) && !m[0].endsWith('/>')) stack.push(node);
  }
  return root;
}

/* ---------------- JSX preprocessing (for the one babel page) ---------------- */

/** Extract a `const NAME = (` balanced-paren JSX block and normalize it to HTML-ish markup. */
export function extractJsxConst(src, name) {
  const marker = `const ${name} = (`;
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  let depth = 1;
  let out = '';
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) break; }
    out += ch;
    i++;
  }
  return jsxToHtmlish(out);
}

function skipBraces(s, i) {
  // s[i] === '{'; return index just past matching '}'
  let depth = 0;
  let inStr = null;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return i;
}

function jsxToHtmlish(jsx) {
  let out = '';
  let i = 0;
  while (i < jsx.length) {
    const brace = jsx.indexOf('{', i);
    const commentOpen = jsx.indexOf('{/*', i);
    if (brace === -1) { out += jsx.slice(i); break; }
    out += jsx.slice(i, brace);
    if (commentOpen === brace) {
      const end = jsx.indexOf('*/}', brace);
      i = end === -1 ? jsx.length : end + 3;
      continue;
    }
    const expr = jsx.slice(brace, skipBraces(jsx, brace));
    // {' '} → space; style={{...}} already stripped by tag-attr handling below? No—style sits inside tags.
    if (/^\{\s*'\s*'\s*\}$/.test(expr)) out += ' ';
    else if (/^\{\s*'([^']*)'\s*\}$/.test(expr)) out += /^\{\s*'([^']*)'\s*\}$/.exec(expr)[1]; // {'text'}
    else out += ''; // drop other expressions ({A_NAV}, template values, etc.)
    i = skipBraces(jsx, brace);
  }
  return out
    .replace(/\sclassName=/g, ' class=')
    .replace(/\shtmlFor=/g, ' for=')
    .replace(/\sstyle=\{\{[\s\S]*?\}\}/g, '')
    .replace(/\skey=\{[^}]*\}/g, '');
}

/* ---------------- emitters ---------------- */

function classNameOf(node) {
  return node.attrs.class || '';
}

export function inlineNodes(nodes) {
  let out = '';
  for (const n of nodes) {
    if (n.tag === '#text') { out += decodeEntities(n.text).replace(/\s+/g, ' '); continue; }
    switch (n.tag) {
      case 'strong': case 'b': out += '**' + inlineNodes(n.children).trim() + '**'; break;
      case 'em': case 'i': out += '*' + inlineNodes(n.children).trim() + '*'; break;
      case 'code': out += '`' + inlineNodes(n.children).trim() + '`'; break;
      case 'a': {
        const label = inlineNodes(n.children).trim();
        const href = n.attrs.href || '';
        out += href ? `[${label}](${absolute(href)})` : label;
        break;
      }
      case 'br': out += '\n'; break;
      default: out += inlineNodes(n.children);
    }
  }
  return out.replace(/\s+([,.;:!?])/g, '$1');
}

function absolute(href) {
  if (/^(https?:)?\/\//.test(href)) return href;
  if (href.startsWith('/')) return 'https://learndiag.com' + href;
  return 'https://learndiag.com/' + href.replace(/^\.\//, '');
}

function emitList(node, indent) {
  const ordered = node.tag === 'ol';
  const pad = ' '.repeat(indent);
  const lines = [];
  let idx = parseInt(node.attrs.start || '1', 10) || 1;
  for (const child of node.children) {
    if (child.tag === '#text') {
      if (decodeEntities(child.text).trim()) lines.push(pad + ordered ? `${idx++}. ${decodeEntities(child.text).trim()}` : `- ${decodeEntities(child.text).trim()}`);
      continue;
    }
    if (child.tag !== 'li') continue;
    // separate inline lead from nested lists
    const nested = child.children.filter(c => c.tag === 'ul' || c.tag === 'ol');
    const rest = child.children.filter(c => !(c.tag === 'ul' || c.tag === 'ol') && !(c.tag === '#text' && !decodeEntities(c.text).trim()));
    const inlineRest = [...rest];
    // strip trailing block-level p wrappers for cleaner inline output
    let body = inlineNodes(inlineRest).trim();
    const bullet = ordered ? `${idx++}.` : '-';
    lines.push(`${pad}${bullet} ${body}`);
    for (const nl of nested) {
      const sub = emitList(nl, indent + 2);
      lines.push(sub);
    }
  }
  return lines.join('\n');
}

function emitTable(node) {
  const rows = [];
  const collect = (n) => {
    for (const c of n.children) {
      if (c.tag === 'tr') rows.push(c);
      else if (['thead', 'tbody', 'tfoot'].includes(c.tag)) collect(c);
    }
  };
  collect(node);
  if (!rows.length) return '';
  const cellsOf = tr => tr.children.filter(c => c.tag === 'td' || c.tag === 'th').map(c => inlineNodes(c.children).trim().replace(/\|/g, '\\|'));
  const headerCells = cellsOf(rows[0]);
  const width = Math.max(...rows.map(r => cellsOf(r).length));
  const padRow = arr => { const a = [...arr]; while (a.length < width) a.push(''); return a; };
  const head = padRow(headerCells);
  const lines = [
    '| ' + head.join(' | ') + ' |',
    '| ' + head.map(() => '---').join(' | ') + ' |',
  ];
  for (let i = 1; i < rows.length; i++) {
    lines.push('| ' + padRow(cellsOf(rows[i])).join(' | ') + ' |');
  }
  return lines.join('\n');
}

export function blocksFrom(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.tag === '#text') {
      const t = decodeEntities(n.text).replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      continue;
    }
    switch (n.tag) {
      case 'h1': out.push('# ' + inlineNodes(n.children).trim()); break;
      case 'h2': out.push('## ' + inlineNodes(n.children).trim()); break;
      case 'h3': out.push('### ' + inlineNodes(n.children).trim()); break;
      case 'h4': case 'h5': case 'h6': out.push('#### ' + inlineNodes(n.children).trim()); break;
      case 'p': {
        const t = inlineNodes(n.children).trim();
        if (t) out.push(t);
        break;
      }
      case 'ul': case 'ol': out.push(emitList(n, 0)); break;
      case 'table': { const t = emitTable(n); if (t) out.push(t); break; }
      case 'blockquote': out.push(inlineNodes(n.children).trim()); break;
      case 'article': case 'main': case 'header': case 'footer': case 'section':
        out.push(blocksFrom(n.children));
        break;
      case 'div': case 'span': {
        const cls = classNameOf(n);
        if (/\btable-scroll\b/.test(cls)) { out.push(blocksFrom(n.children)); break; }
        if (/\bcallout\b/.test(cls)) {
          const t = blocksFrom(n.children).trim();
          out.push('> ' + t.split('\n').join('\n> '));
          break;
        }
        if (/\beyebrow\b/.test(cls)) { const t = inlineNodes(n.children).trim(); if (t) out.push('*' + t + '*'); break; }
        if (/\bmeta-line\b/.test(cls)) { const t = inlineNodes(n.children).trim(); if (t) out.push('*' + t + '*'); break; }
        // generic div: try blocks first; if only inline text, push as paragraph
        const hasBlockChild = n.children.some(c => ['p','ul','ol','table','h1','h2','h3','h4','div','article','section'].includes(c.tag));
        out.push(hasBlockChild ? blocksFrom(n.children) : (inlineNodes(n.children).trim()));
        break;
      }
      case 'nav': {
        // A breadcrumb carried by .eyebrow is page path, not chrome — keep it in the
        // markdown variant. Other <nav> (site header, footer links) stays skipped.
        const cls = classNameOf(n);
        if (/\beyebrow\b/.test(cls)) { const t = inlineNodes(n.children).trim(); if (t) out.push('*' + t + '*'); }
        break;
      }
      case 'script': case 'style': case 'button': case 'form': case 'input': case 'select': case 'label':
        break;
      default: {
        const t = inlineNodes(n.children).trim();
        if (t) out.push(t);
      }
    }
  }
  return out.filter(s => String(s).trim()).join('\n\n');
}

/** Convert a full HTML document (or fragment) to markdown body text. */
export function convertHtmlToMarkdown(html) {
  const tree = parseHtml(html);
  // Prefer <article>; fall back to whole tree
  const findArticle = (node) => {
    for (const c of node.children) {
      if (c.tag === 'article') return c;
      const deep = findArticle(c);
      if (deep) return deep;
    }
    return null;
  };
  const article = findArticle(tree) || tree;
  return blocksFrom(article.children).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Convert one of Triumph's guide files (plain HTML, babel-JSX const, or ART={body:"..."} JSON). */
export function convertGuideFile(htmlPath) {
  const src = fs.readFileSync(htmlPath, 'utf8');
  const titleMatch = src.match(/<title>(.*?)<\/title>/s);
  const title = titleMatch ? decodeEntities(titleMatch[1]).split('|')[0].trim() : '';
  let md;
  if (src.includes('const A_BODY')) {
    const jsx = extractJsxConst(src, 'A_BODY');
    md = jsx ? convertHtmlToMarkdown(jsx) : convertHtmlToMarkdown(src);
  } else {
    // Pattern: const ART = { ... "body": "<p>...</p>" ... } — content embedded as an HTML string
    const artMatch = src.match(/const\s+ART\s*=\s*(\{[\s\S]*?\});\s*\n/);
    let handled = false;
    if (artMatch) {
      try {
        const art = JSON.parse(artMatch[1]);
        if (art && typeof art.body === 'string') {
          md = convertHtmlToMarkdown('<article>' + art.body + '</article>');
          handled = true;
        }
      } catch (e) { /* fall through to whole-document conversion */ }
    }
    if (!handled) md = convertHtmlToMarkdown(src);
  }
  // Guarantee an H1: pages whose body starts below the title get the document title prepended.
  if (!/^#\s/m.test(md) && title) {
    md = '# ' + title + '\n\n' + md;
  }
  return { title, md };
}

/* ---------------- CLI ---------------- */

const PAGES = [
  'praxis-5001-study-guide',
  'praxis-5001-four-gate-strategy',
  'praxis-5001-retake-guide',
  'praxis-5001-vs-7001',
  'praxis-5001-vs-8000-series',
  'praxis-5002-study-guide',
  'praxis-5003-math-study-guide',
  'praxis-5004-social-studies-study-guide',
  'praxis-5005-science-study-guide',
  // 2026-08-20 batch: keyword articles
  'praxis-5001-passing-scores',
  'praxis-5001-free-practice-test',
  'praxis-5001-registration-guide',
  // 2026-08-20 batch: state landing pages
  'praxis-5001-virginia-requirements',
  'praxis-5001-tennessee-requirements',
  'praxis-5001-new-jersey-requirements',
  'praxis-5001-south-carolina-requirements',
  'praxis-5001-kentucky-requirements',
  // 2026-09-14 batch: Praxis Steps explainer
  'praxis-steps',
  // static trust/developer pages — markdown generated from their <article> so it never drifts
  'about',
  'contact',
  'privacy',
  'developers',
];

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const mdDir = path.join(SITE, 'md');
  fs.mkdirSync(mdDir, { recursive: true });
  for (const page of PAGES) {
    const { title, md } = convertGuideFile(path.join(SITE, page + '.html'));
    const front = `<!-- Markdown variant of https://learndiag.com/${page} — request any page with Accept: text/markdown -->\n\n`;
    fs.writeFileSync(path.join(mdDir, page + '.md'), front + md);
    console.log(page.padEnd(45), `${md.length} chars`, '|', title.slice(0, 60));
  }
}
