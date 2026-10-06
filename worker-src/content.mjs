// worker-src/content.mjs — Accept-header parsing & markdown negotiation,
// RFC 7763 (Section 6 of the original site/_worker.js, ported verbatim).

// Path → md asset mapping. Historically this was a hand-written whitelist
// (`const pages = [...]`) that had to be edited every time a guide shipped.
// It silently rotted: on 2026-10-06, 19 pages had a working md mirror under
// site/md/ but were absent from the list, so `Accept: text/markdown` on them
// fell through to HTML (verified live: Content-Type came back text/html).
//
// A static list cannot stay correct — the failure mode is silent (no error, no
// failed test, HTML just quietly serves instead of markdown). So we no longer
// ask "is this path in the list?"; we ask "does /md/<slug>.md actually exist?"
// and fall back to HTML when it doesn't (worker.mjs does that probe fetch).
// Adding a guide now needs nothing but `node tools/md-one.mjs <slug> --write`.
//
// Request path → md asset filename under site/md/. Homepage and /index are the
// only two paths whose mirror isn't `/md/<slug>.md`.
const mdName = p => (p === '/' || p === '/index' ? '/md/index.md' : `/md${p}.md`);

// Only the homepage is pinned here; every other content page is resolved by
// mdAssetFor() below (probe-and-fallback) rather than by membership in a list.
export const MD_ROUTES = new Map([
  ['/', mdName('/')],
  ['/index', mdName('/index')],
]);

/**
 * Given a request path, return the md asset path to probe — or null when the
 * request cannot possibly be a content page (so we don't waste a fetch).
 *
 * Rules:
 *  · explicit Map entries win (homepage/index);
 *  · anything under /md/, /api/, /mcp, /.well-known/ is not a content page;
 *  · a path with a non-HTML extension (/js/theme.js, /images/x.webp) isn't one
 *    either — probing it would 404 anyway, but we'd pay a fetch per asset.
 */
export function mdAssetFor(path) {
  const known = MD_ROUTES.get(path);
  if (known) return known;
  if (!path.startsWith('/') || path.includes('..')) return null;
  // Exact-segment reserved prefixes, with or without a trailing slash
  // (/mcp and /api must be excluded as bare paths too).
  const first = path.split('/')[1] || '';
  if (['md', 'api', 'mcp', 'assets', 'data', 'js', 'css', 'images', 'fonts', 'icons', 'files', '.well-known'].includes(first)) return null;
  const slug = path.endsWith('.html') ? path.slice(0, -5) : path;
  if (slug === '/' || slug === '') return null;
  // Only .html or extension-less paths are candidate content pages.
  if (!path.endsWith('.html') && /\.[a-z0-9]{2,5}$/i.test(path)) return null;
  return mdName(slug);
}

export const PRODUCIBLE_PAGE_TYPES = ['text/markdown', 'text/html'];

/**
 * Parse an Accept header into entries sorted by preference:
 * descending q, then more-specific types before wildcards, then original order.
 */
export function parseAccept(header) {
  if (header === undefined || header === null || header === '') return null; // no constraint
  const parts = String(header).split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const entries = [];
  parts.forEach((part, index) => {
    const segments = part.split(';').map(s => s.trim());
    const type = (segments[0] || '').toLowerCase();
    if (!type) return;
    let q = 1;
    for (const param of segments.slice(1)) {
      const eq = param.indexOf('=');
      if (eq === -1) continue;
      const k = param.slice(0, eq).trim().toLowerCase();
      if (k !== 'q') continue;
      const n = parseFloat(param.slice(eq + 1).trim());
      if (!isNaN(n)) q = Math.max(0, Math.min(1, n));
    }
    const specificity = type === '*/*' ? 0 : type.endsWith('/*') ? 1 : 2;
    entries.push({ type, q, specificity, index });
  });
  entries.sort((a, b) => b.q - a.q || b.specificity - a.specificity || a.index - b.index);
  return entries;
}

function mediaTypeMatches(entryType, producible) {
  if (entryType === '*/*') return true;
  if (entryType === producible) return true;
  const slash = entryType.indexOf('/*');
  if (slash !== -1) return producible.startsWith(entryType.slice(0, slash) + '/');
  return false;
}

/**
 * Choose the representation to serve. Returns:
 *   { variant: 'text/markdown' | 'text/html' } | { status: 406 }
 * Algorithm (see acceptmarkdown.com/guides/accept-parsing): score every
 * producible type by the highest q among matching Accept entries; skip types
 * whose only matches are q=0 (explicitly rejected). Higher q wins; ties are
 * broken by explicit mention, then by the HTML default. A missing header
 * means "no constraint" → default HTML. 406 only when nothing acceptable
 * can be produced.
 */
export function negotiatePageVariant(acceptHeader) {
  const entries = parseAccept(acceptHeader);
  if (!entries) return { variant: 'text/html' }; // no constraint → default
  const candidates = [];
  for (const prod of PRODUCIBLE_PAGE_TYPES) {
    let effQ = -1;
    let explicit = false;
    for (const e of entries) {
      if (e.q === 0) continue; // explicitly rejected
      if (!mediaTypeMatches(e.type, prod)) continue;
      if (e.q > effQ) effQ = e.q;
      if (e.type === prod) explicit = true;
    }
    if (effQ >= 0) candidates.push({ prod, effQ, explicit });
  }
  if (!candidates.length) return { status: 406 };
  candidates.sort((a, b) =>
    b.effQ - a.effQ ||
    (b.explicit ? 1 : 0) - (a.explicit ? 1 : 0) ||
    (b.prod === 'text/html' ? 1 : 0) - (a.prod === 'text/html' ? 1 : 0)
  );
  return { variant: candidates[0].prod };
}

/** Merge `Accept` into a response's Vary header (keeping Accept-Encoding). */
export function varyWithAccept(res) {
  const existing = (res.headers.get('Vary') || '').split(',').map(s => s.trim()).filter(Boolean);
  const set = new Set(existing.map(v => v.toLowerCase()));
  set.add('accept'); // canonical lowercase; Vary values are case-insensitive header names
  const ordered = ['accept', ...[...set].filter(v => v !== 'accept')];
  const out = new Response(res.body, res);
  out.headers.set('Vary', ordered.join(', '));
  return out;
}
