// smoke-worker.mjs — quick local smoke test for site/_worker.js (full suite lives in test/agentic.test.mjs)
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const workerUrl = pathToFileURL('E:/Triumph/praxis-5001/site/_worker.js').href;
const worker = (await import(workerUrl)).default;

// --- mock env with ASSETS backed by the real static files ---
const siteRoot = 'E:/Triumph/praxis-5001/site';
const store = new Map();
const env = {
  JWT_SECRET: 'smoke-secret',
  TRIUMPH_KV: {
    get: async k => (store.has(k) ? store.get(k) : null),
    put: async (k, v, opts) => { store.set(k, v); },
    delete: async k => { store.delete(k); },
  },
  ASSETS: {
    async fetch(req) {
      const u = new URL(req.url);
      const p = u.pathname === '/' ? '/index.html' : u.pathname;
      try {
        const body = readFileSync(siteRoot + p);
        const ext = p.endsWith('.json') ? 'application/json' : p.endsWith('.md') ? 'text/markdown' : 'text/html';
        return new Response(body, { status: 200, headers: { 'Content-Type': ext } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    },
  },
};

const call = (path, method = 'GET', body, headers = {}) =>
  worker.fetch(new Request('https://trytriumph.de5.net' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }), env, {});

const assert = (cond, msg) => { if (!cond) throw new Error('SMOKE FAIL: ' + msg); console.log('ok -', msg); };

// 1. homepage HTML pass-through
let r = await call('/');
assert(r.status === 200 && (r.headers.get('content-type') || '').includes('text/html'), 'homepage serves HTML');

// 2. markdown negotiation
r = await call('/', 'GET', null, { Accept: 'text/markdown' });
assert(r.status === 200, 'markdown variant returns 200');
assert((r.headers.get('content-type') || '').includes('text/markdown'), 'content-type text/markdown');
assert((r.headers.get('vary') || '').toLowerCase().includes('accept'), 'Vary includes Accept');

r = await call('/', 'GET', null, { Accept: 'text/html' });
assert((r.headers.get('content-type') || '').includes('text/html'), 'HTML for Accept: text/html');
assert((r.headers.get('vary') || '').toLowerCase().includes('accept'), 'Vary on HTML variant too');

r = await call('/', 'GET', null, { Accept: '*/*' });
assert((r.headers.get('content-type') || '').includes('text/html'), 'default HTML for */*');

r = await call('/', 'GET', null, { Accept: 'application/pdf' });
assert(r.status === 406, '406 when nothing acceptable');

// q-value: markdown;q=0 → html
r = await call('/', 'GET', null, { Accept: 'text/markdown;q=0, text/html;q=0.5' });
assert((r.headers.get('content-type') || '').includes('text/html'), 'q=0 excludes markdown');

// q-value: markdown outranks html;q=0.8
r = await call('/', 'GET', null, { Accept: 'text/markdown, text/html;q=0.8' });
assert((r.headers.get('content-type') || '').includes('text/markdown'), 'q ranking prefers markdown');

// browser-like header → html
r = await call('/', 'GET', null, { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' });
assert((r.headers.get('content-type') || '').includes('text/html'), 'browser Accept → html');

// 3. structured API errors
r = await call('/api/register', 'POST', { email: 'bad', password: 'password123' });
let d = await r.json();
assert(r.status === 400 && d.error.code === 'invalid_email' && d.error.hint, 'structured error invalid_email');

r = await call('/api/nonexistent', 'GET');
d = await r.json();
assert(r.status === 404 && d.error.code === 'not_found', 'unknown /api path → JSON 404');

r = await call('/api/state', 'PATCH');
d = await r.json();
assert(r.status === 405 && d.error.code === 'method_not_allowed', '405 structured');

// 4. public v1 endpoints
r = await call('/api/v1/health'); d = await r.json();
assert(r.status === 200 && d.ok && d.service === 'triumph-api', 'health ok');

r = await call('/api/v1/meta'); d = await r.json();
assert(r.status === 200 && d.total_questions === 969, `meta has 969 questions (got ${d.total_questions})`);

r = await call('/api/v1/questions?subtest=5003&limit=3'); d = await r.json();
assert(r.status === 200 && d.items.length === 3 && d.items[0].answer_text, 'questions filtered + shaped');

r = await call('/api/v1/questions/random?count=2'); d = await r.json();
assert(r.status === 200 && d.count === 2, 'random works');

// 5. scoped keys
r = await call('/api/v1/keys', 'POST', { email: 'dev@example.com', scopes: ['questions:read'] });
d = await r.json();
assert(r.status === 201 && /^tri_live_[0-9a-f]{40}$/.test(d.key), 'key issued with tri_live_ prefix');

r = await call('/api/v1/keys/verify', 'GET', null, { 'X-API-Key': d.key });
let v = await r.json();
assert(v.valid && v.scopes.includes('questions:read'), 'key verify round-trips');

// bad scope rejected
r = await call('/api/v1/keys', 'POST', { scopes: ['admin:all'] });
assert(r.status === 400, 'unknown scope rejected with 400');

// key without stats scope cannot hit stats
r = await call('/api/v1/keys', 'POST', { scopes: ['meta:read'] });
d = await r.json();
r = await call('/api/v1/stats', 'GET', null, { 'X-API-Key': d.key });
v = await r.json();
assert(r.status === 403 && v.error.code === 'forbidden_scope', 'scope enforcement: meta-only key blocked from stats');

// 6. OpenAPI
r = await call('/openapi.json'.replace('/openapi.json', '/api/openapi.yaml'));
const yamlText = await r.text();
assert(r.status === 200 && yamlText.startsWith('openapi: "3.1.0"'), 'YAML spec served from /api/openapi.yaml');

// 7. MCP
r = await call('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
d = await r.json();
assert(d.result && d.result.protocolVersion === '2025-06-18' && d.result.serverInfo.name === 'triumph', 'MCP initialize');

r = await call('/mcp', 'POST', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
d = await r.json();
assert(Array.isArray(d.result.tools) && d.result.tools.length >= 4, 'MCP tools/list');

r = await call('/mcp', 'POST', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_random_questions', arguments: { count: 2 } } });
d = await r.json();
assert(d.result.content[0].type === 'text' && !d.result.isError, 'MCP tools/call random questions');

r = await call('/mcp', 'POST', { jsonrpc: '2.0', id: 4, method: 'nope' });
d = await r.json();
assert(d.error.code === -32601, 'MCP unknown method → -32601');

r = await call('/mcp', 'GET');
assert(r.status === 405, 'MCP GET → 405');

// notification → 202
r = await call('/mcp', 'POST', { jsonrpc: '2.0', method: 'notifications/initialized' });
assert(r.status === 202, 'MCP notification → 202 empty');

console.log('\nALL SMOKE TESTS PASSED');
