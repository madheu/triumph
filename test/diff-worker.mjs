// diff-worker.mjs — behavior parity check: old single-file worker vs new modular build.
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // project root (this file lives in test/)
const siteRoot = ROOT + 'site';

const oldMod = await import(pathToFileURL(ROOT + 'backups/pre-modular-worker/_worker.js').href);
const newMod = await import(pathToFileURL(ROOT + 'site/_worker.js').href);

const store = new Map();
const env = {
  JWT_SECRET: 'diff-secret',
  TRIUMPH_KV: {
    get: async (k, t) => { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    put: async (k, v) => { store.set(k, v); },
    delete: async k => { store.delete(k); },
  },
  ASSETS: {
    async fetch(req) {
      const u = new URL(req.url);
      let p = u.pathname === '/' ? '/index.html' : u.pathname;
      try {
        const body = readFileSync(siteRoot + p);
        const ext = p.endsWith('.json') ? 'application/json' : p.endsWith('.md') ? 'text/markdown' : 'text/html';
        return new Response(body, { status: 200, headers: { 'Content-Type': ext } });
      } catch { return new Response('nf', { status: 404 }); }
    },
  },
};

const cases = [
  ['GET', '/'],
  ['GET', '/', null, { Accept: 'text/markdown' }],
  ['GET', '/api/v1/health'],
  ['GET', '/api/v1/meta'],
  ['POST', '/api/register', { email: 'x@y.com', password: 'password123' }],
  ['GET', '/api/nonexistent'],
  ['GET', '/api/v1/questions?subtest=5003&limit=2'],
  ['GET', '/api/openapi.yaml'],
  ['POST', '/mcp', null, { 'Content-Type': 'application/json' }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })],
];

async function snap(w, c) {
  const [m, p, b, h, raw] = c;
  const req = new Request('https://trytriumph.de5.net' + p, {
    method: m,
    headers: { ...(b ? { 'Content-Type': 'application/json' } : {}), ...(h || {}) },
    body: raw || (b ? JSON.stringify(b) : undefined),
  });
  const r = await w.fetch(req, env, {});
  const txt = await r.text();
  // Normalize volatile fields so the diff only flags real behavior changes.
  const norm = txt.replace(/"time":"[^"]*"/, '"time":"<ts>"').replace(/\"createdAt\":\d+/g, '"createdAt":<ts>');
  return r.status + '|' + (r.headers.get('content-type') || '') + '|' + norm;
}

let diffs = 0;
for (const c of cases) {
  const a = await snap(oldMod.default, c);
  const z = await snap(newMod.default, c);
  if (a !== z) {
    diffs++;
    console.log('DIFF on', c[0], c[1], '\n OLD:', a.slice(0, 300), '\n NEW:', z.slice(0, 300));
  } else {
    console.log('SAME:', c[0], c[1]);
  }
}
console.log(diffs === 0 ? `\n=== BEHAVIOR PARITY: all ${cases.length} cases identical ===` : `\n=== ${diffs} DIFFS FOUND ===`);
