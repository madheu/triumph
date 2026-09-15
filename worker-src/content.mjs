// worker-src/content.mjs — Accept-header parsing & markdown negotiation,
// RFC 7763 (Section 6 of the original site/_worker.js, ported verbatim).

// Paths that have a text/markdown representation under /md/.
export const MD_ROUTES = (() => {
  const pages = [
    '/', '/index', '/about', '/contact', '/privacy', '/terms', '/developers', '/resources',
    '/praxis-5001-study-guide', '/praxis-5001-four-gate-strategy', '/praxis-5001-retake-guide',
    '/praxis-5001-vs-7001', '/praxis-5001-vs-8000-series',
    '/praxis-5002-study-guide', '/praxis-5003-math-study-guide',
    '/praxis-5004-social-studies-study-guide', '/praxis-5005-science-study-guide',
    // 2026-08-20 batch: keyword articles (passing-scores merged into /score-calculator via 301)
    '/praxis-5001-free-practice-test', '/praxis-5001-registration-guide',
    // 2026-08-20 batch: state landing pages
    '/praxis-5001-virginia-requirements', '/praxis-5001-tennessee-requirements',
    '/praxis-5001-new-jersey-requirements', '/praxis-5001-south-carolina-requirements',
    '/praxis-5001-kentucky-requirements',
    // 2026-08-24 batch: non-5001 state research pages
    '/praxis-5001-pennsylvania-requirements', '/praxis-5001-alabama-requirements',
    '/praxis-5001-maryland-requirements',
    // 2026-09-04 batch: 8006 pillar page
    '/praxis-8006-teaching-reading',
    // 2026-09-14 batch: Praxis Steps explainer
    '/praxis-steps',
  ];
  const map = new Map();
  const mdName = p => (p === '/' || p === '/index' ? '/md/index.md' : `/md${p}.md`);
  for (const p of pages) {
    map.set(p, mdName(p));
    if (p !== '/' && p !== '/index') map.set(p + '.html', mdName(p)); // .html variants negotiate too
  }
  return map;
})();

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
