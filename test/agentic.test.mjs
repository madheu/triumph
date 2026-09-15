// agentic.test.mjs — comprehensive suite for the Triumph agentic-readiness surface.
// Run: npm test   (node --test test/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { runInNewContext } from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = ROOT + 'site/';

const workerModule = await import(pathToFileURL(SITE + '_worker.js').href);
const {
  default: worker,
  openApiSpec,
  specToYaml,
  parseAccept,
  negotiatePageVariant,
  varyWithAccept,
  MD_ROUTES,
} = workerModule;

/* ================= shared mock environment ================= */

const siteRoot = SITE;
function makeEnv(kvStore = new Map()) {
  return {
    JWT_SECRET: 'test-secret',
    TRIUMPH_KV: {
      get: async (k, type) => { const v = kvStore.has(k) ? kvStore.get(k) : null; return v === null ? null : (type === 'json' ? JSON.parse(v) : v); },
      put: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); },
    },
    ASSETS: {
      async fetch(req) {
        const u = new URL(req.url);
        let p = u.pathname === '/' ? '/index.html' : u.pathname;
        // pretty-URL resolution like Pages: /about → /about.html
        if (!p.includes('.') && existsSync(siteRoot + p + '.html')) p += '.html';
        try {
          const body = readFileSync(siteRoot + p);
          const ext = p.endsWith('.json') ? 'application/json'
            : p.endsWith('.md') ? 'text/markdown; charset=utf-8'
            : p.endsWith('.txt') ? 'text/plain; charset=utf-8'
            : p.endsWith('.xml') ? 'application/xml'
            : 'text/html; charset=utf-8';
          return new Response(body, { status: 200, headers: { 'Content-Type': ext } });
        } catch {
          return new Response('not found', { status: 404 });
        }
      },
    },
  };
}

const call = (env, path, method = 'GET', body, headers = {}) =>
  worker.fetch(new Request('https://learndiag.com' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }), env, {});

/* ================= 1. Accept: markdown negotiation (fix #7) ================= */

test('parseAccept ranks q-values then specificity then order', () => {
  let e = parseAccept('text/html;q=0.8, text/markdown');
  assert.equal(e[0].type, 'text/markdown');
  e = parseAccept('*/*');
  assert.equal(e[0].type, '*/*');
  assert.ok(parseAccept(null) === null);
  assert.ok(parseAccept('') === null);
});

test('negotiatePageVariant: markdown explicitly requested → text/markdown', () => {
  assert.equal(negotiatePageVariant('text/markdown').variant, 'text/markdown');
  assert.equal(negotiatePageVariant('text/markdown, text/html;q=0.8').variant, 'text/markdown');
  assert.equal(negotiatePageVariant('text/markdown;q=0.9, */*;q=0.1').variant, 'text/markdown');
});

test('negotiatePageVariant: default and wildcard-only → HTML', () => {
  assert.ok(negotiatePageVariant(null).variant === 'text/html');
  assert.ok(negotiatePageVariant(undefined).variant === 'text/html');
  assert.ok(negotiatePageVariant('*/*').variant === 'text/html');
  const browser = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
  assert.ok(negotiatePageVariant(browser).variant === 'text/html');
});

test('negotiatePageVariant: q=0 exclusion honored', () => {
  assert.equal(negotiatePageVariant('text/markdown;q=0, text/html;q=0.5').variant, 'text/html');
  assert.equal(negotiatePageVariant('text/html;q=0, text/markdown;q=1').variant, 'text/markdown');
});

test('negotiatePageVariant: genuinely unsatisfiable Accept → 406 only then', () => {
  assert.deepEqual(negotiatePageVariant('application/pdf'), { status: 406 });
  assert.deepEqual(negotiatePageVariant('text/plain'), { status: 406 });
  assert.deepEqual(negotiatePageVariant('text/markdown;q=0'), { status: 406 });
});

test('worker: homepage serves markdown with Vary on request', async () => {
  const env = makeEnv();
  const r = await call(env, '/', 'GET', null, { Accept: 'text/markdown' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/markdown/);
  const vary = (r.headers.get('vary') || '').toLowerCase();
  assert.ok(vary.includes('accept'), 'Vary must include Accept');
});

test('worker: HTML variant of negotiated pages also carries Vary: Accept', async () => {
  const env = makeEnv();
  const r = await call(env, '/about', 'GET', null, { Accept: 'text/html' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match((r.headers.get('vary') || '').toLowerCase(), /accept/);
});

test('worker: every MD route serves its markdown asset', async () => {
  const env = makeEnv();
  for (const [pathKey] of MD_ROUTES.entries()) {
    const r = await call(env, pathKey, 'GET', null, { Accept: 'text/markdown' });
    assert.equal(r.status, 200, `md route ${pathKey} should serve markdown`);
    assert.match(r.headers.get('content-type'), /text\/markdown/, pathKey);
  }
});

test('varyWithAccept merges with existing Vary without duplicates', () => {
  const res = varyWithAccept(new Response('x', { headers: { Vary: 'Accept-Encoding' } }));
  const v = res.headers.get('Vary').toLowerCase().split(',').map(s => s.trim());
  assert.ok(v.includes('accept') && v.includes('accept-encoding'));
  assert.equal(v.filter(x => x === 'accept').length, 1);
});

/* ================= 2. Structured JSON errors (fix #6) ================= */

const ERROR_SHAPE = Object.keys;

test('worker: all /api error paths use the structured envelope', async () => {
  const env = makeEnv();
  const cases = [
    ['/api/register', 'POST', { email: 'bad', password: 'x' }, 400],
    ['/api/register', 'POST', { email: 'a@b.co', password: 'short' }, 400],
    ['/api/login', 'POST', { email: 'nobody@x.io', password: 'password123' }, 401],
    ['/api/state', 'GET', undefined, 401],
    ['/api/me', 'GET', undefined, 401],
    ['/api/nonexistent', 'GET', undefined, 404],
    ['/api/state', 'DELETE', undefined, 405],
  ];
  for (const [p, m, b, wantStatus] of cases) {
    const r = await call(env, p, m, b);
    assert.equal(r.status, wantStatus, `${m} ${p}`);
    const d = await r.json();
    assert.ok(d.error && typeof d.error === 'object', `${p}: error is object`);
    assert.ok(typeof d.error.code === 'string' && d.error.code.length > 0, `${p}: has code`);
    assert.ok(typeof d.error.message === 'string' && d.error.message.length > 0, `${p}: has message`);
    assert.ok(typeof d.error.hint === 'string' && d.error.hint.length > 0, `${p}: has resolution hint`);
    assert.equal(ERROR_SHAPE(d).includes('status'), true, `${p}: mirrors status`);
    assert.match(r.headers.get('content-type'), /application\/json/);
  }
});

test('worker: account happy paths keep legacy success shapes', async () => {
  const store = new Map();
  const env = makeEnv(store);
  // mail provider absent → register returns structured mail_failed but stores the account
  let r = await call(env, '/api/register', 'POST', { email: 'Test@Example.com ', password: 'password123' });
  let d = await r.json();
  assert.equal(r.status, 502);
  assert.equal(d.error.code, 'mail_failed');

  // simulate a verified account + login
  const rec = JSON.parse(store.get('users:test@example.com'));
  rec.verified = true;
  store.set('users:test@example.com', JSON.stringify(rec));
  r = await call(env, '/api/login', 'POST', { email: 'test@example.com', password: 'password123' });
  d = await r.json();
  assert.equal(r.status, 200);
  assert.ok(d.token && d.user.email === 'test@example.com' && d.verified === true);

  // state round-trip
  // D14: PUT with the legacy flat shape must still work — the server
  // normalizes it into tests["5001"], because a page that hasn't been updated
  // yet (or a stale tab) still sends { answers, plan, ... } at the top level.
  r = await call(env, '/api/state', 'PUT', { state: { answers: [1, 2], plan: null } }, { Authorization: 'Bearer ' + d.token });
  assert.equal(r.status, 200);
  r = await call(env, '/api/state', 'GET', null, { Authorization: 'Bearer ' + d.token });
  d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.state.v, 2);
  assert.equal(d.state.tests['5001'].answers.length, 2);
  assert.ok(d.state.updatedAt > 0);
});

test('worker: D14 state is partitioned per test and exams do not clobber each other', async () => {
  const store = new Map();
  const env = makeEnv(store);
  let r = await call(env, '/api/register', 'POST', { email: 'two@example.com', password: 'password123' });
  let d = await r.json();
  const rec = JSON.parse(store.get('users:two@example.com'));
  rec.verified = true;
  store.set('users:two@example.com', JSON.stringify(rec));
  r = await call(env, '/api/login', 'POST', { email: 'two@example.com', password: 'password123' });
  const token = (await r.json()).token;
  const auth = { Authorization: 'Bearer ' + token };

  // 5001 writes a lot of answers; 8006 writes few. Pre-D14 the 8006 write would
  // lose the length comparison and be dropped entirely.
  r = await call(env, '/api/state', 'PUT', {
    state: { tests: { '5001': { answers: [1, 2, 3, 4, 5], mastery: { a: 1 } } } },
  }, auth);
  assert.equal(r.status, 200);

  r = await call(env, '/api/state', 'PUT', {
    state: { tests: { '8006': { answers: [9], attempt_8006: { total_pct: 62 } } } },
  }, auth);
  assert.equal(r.status, 200);

  r = await call(env, '/api/state', 'GET', null, auth);
  d = await r.json();
  assert.equal(d.state.tests['5001'].answers.length, 5, '5001 answers must survive an 8006 write');
  assert.equal(d.state.tests['8006'].answers.length, 1, '8006 answers must persist');
  assert.equal(d.state.tests['8006'].attempt_8006.total_pct, 62);

  // prefs are account-level and shared across tests.
  r = await call(env, '/api/state', 'PUT', { state: { prefs: { theme: 'light' } } }, auth);
  assert.equal(r.status, 200);
  r = await call(env, '/api/state', 'GET', null, auth);
  d = await r.json();
  assert.equal(d.state.prefs.theme, 'light');
  assert.equal(d.state.tests['5001'].answers.length, 5, 'prefs write must not disturb a test bucket');
});

/* ================= 3. Public API v1 (fixes #9, #14) ================= */

test('v1 health/meta/questions/random work anonymously', async () => {
  const env = makeEnv();
  let r = await call(env, '/api/v1/health');
  let d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.service, 'triumph-api');

  r = await call(env, '/api/v1/meta'); d = await r.json();
  assert.equal(d.total_questions, 969);
  assert.ok(Object.keys(d.subtests).length === 4);

  r = await call(env, '/api/v1/stats'); d = await r.json();
  assert.equal(d.total, 969);

  r = await call(env, '/api/v1/questions?subtest=5003&limit=5'); d = await r.json();
  assert.equal(d.count, 5);
  assert.ok(d.items.every(q => q.subtest_code === '5003'));
  assert.ok(d.items[0].answer_text.length > 0);

  r = await call(env, '/api/v1/questions/random?count=3'); d = await r.json();
  assert.equal(d.count, 3);

  // invalid subtest → structured 400
  r = await call(env, '/api/v1/questions?subtest=9999');
  assert.equal(r.status, 400);
  d = await r.json();
  assert.equal(d.error.code, 'bad_request');
});

test('scoped API keys: issue, verify, enforce scopes (fix #4)', async () => {
  const env = makeEnv();
  // unknown scope rejected
  let r = await call(env, '/api/v1/keys', 'POST', { scopes: ['root:everything'] });
  assert.equal(r.status, 400);

  // create meta-only key
  r = await call(env, '/api/v1/keys', 'POST', { email: 'dev@example.com', scopes: ['meta:read'] });
  let d = await r.json();
  assert.equal(r.status, 201);
  assert.match(d.key, /^tri_live_[0-9a-f]{40}$/);

  // verify round-trip
  r = await call(env, '/api/v1/keys/verify', 'GET', null, { 'X-API-Key': d.key });
  let v = await r.json();
  assert.equal(v.valid, true);
  assert.deepEqual(v.scopes, ['meta:read']);

  // scope enforcement: stats requires stats:read
  r = await call(env, '/api/v1/stats', 'GET', null, { 'X-API-Key': d.key });
  v = await r.json();
  assert.equal(r.status, 403);
  assert.equal(v.error.code, 'forbidden_scope');

  // garbage key rejected
  r = await call(env, '/api/v1/keys/verify', 'GET', null, { 'X-API-Key': 'tri_live_deadbeef' });
  assert.equal(r.status, 401);
});

/* ================= 4. MCP server (fix #22) ================= */

function rpc(id, method, params) {
  return call(makeEnv(), '/mcp', 'POST', { jsonrpc: '2.0', id, method, params });
}

test('MCP: initialize negotiates protocol version', async () => {
  const r = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  const d = await r.json();
  assert.equal(d.result.protocolVersion, '2025-06-18');
  assert.equal(d.result.serverInfo.name, 'triumph');
  assert.ok(typeof d.result.instructions === 'string' && d.result.instructions.includes('Praxis'));

  // unknown future version falls back to latest supported
  const r2 = await rpc(2, 'initialize', { protocolVersion: '2099-01-01' });
  const d2 = await r2.json();
  assert.notEqual(d2.result.protocolVersion, '2099-01-01');
});

test('MCP: tools/list returns documented read-only tools with schemas', async () => {
  const r = await rpc(1, 'tools/list');
  const d = await r.json();
  const names = d.result.tools.map(t => t.name);
  for (const expected of ['list_subtests', 'get_questions', 'get_random_questions', 'get_bank_stats', 'list_study_guides']) {
    assert.ok(names.includes(expected), `tool ${expected}`);
  }
  for (const t of d.result.tools) {
    assert.ok(t.description && t.description.length > 10, `${t.name} described`);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('MCP: tools/call works for data tools; unknown tool → -32602', async () => {
  let r = await rpc(1, 'tools/call', { name: 'get_random_questions', arguments: { count: 2, subtest: '5004' } });
  let d = await r.json();
  assert.equal(d.result.isError, false);
  const parsed = JSON.parse(d.result.content[0].text);
  assert.equal(parsed.items.length, 2);
  assert.ok(parsed.items.every(q => q.subtest_code === '5004'));

  r = await rpc(2, 'tools/call', { name: 'nope', arguments: {} });
  d = await r.json();
  assert.equal(d.error.code, -32602);
});

test('MCP: protocol errors — -32700/-32601/-32600, notifications → 202, GET → 405', async () => {
  let r = await worker.fetch(new Request('https://learndiag.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  }), makeEnv(), {});
  let d = await r.json();
  assert.equal(d.error.code, -32700);

  r = await rpc(1, 'no/such/method');
  d = await r.json();
  assert.equal(d.error.code, -32601);

  r = await worker.fetch(new Request('https://learndiag.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 1, method: 'ping' }), // missing jsonrpc
  }), makeEnv(), {});
  d = await r.json();
  assert.equal(d.error.code, -32600);

  r = await call(makeEnv(), '/mcp', 'POST', { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(r.status, 202);

  r = await call(makeEnv(), '/mcp', 'GET');
  assert.equal(r.status, 405);
  assert.match(r.headers.get('allow') || '', /POST/);
});

test('MCP: CORS exposed for browser-based clients', async () => {
  const r = await call(makeEnv(), '/mcp', 'OPTIONS');
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const post = await rpc(1, 'tools/list');
  assert.equal(post.headers.get('access-control-allow-origin'), '*');
});

/* ================= 5. OpenAPI spec (fixes #5, #23, #24) ================= */

test('openapi.json static copy matches the worker spec object', () => {
  const diskJson = JSON.parse(readFileSync(SITE + 'openapi.json', 'utf8'));
  assert.deepEqual(diskJson, JSON.parse(JSON.stringify(openApiSpec)));
});

test('specToYaml round-trips through a real YAML parser', () => {
  const yamlText = specToYaml(openApiSpec);
  const back = YAML.parse(yamlText);
  assert.deepEqual(back, JSON.parse(JSON.stringify(openApiSpec)));
});

test('every operation has unique operationId, description, typed responses', () => {
  const ids = new Set();
  let count = 0;
  for (const [path, item] of Object.entries(openApiSpec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!op.operationId) continue;
      count++;
      assert.ok(!ids.has(op.operationId), `duplicate operationId ${op.operationId}`);
      ids.add(op.operationId);
      assert.ok(op.summary, `${method.toUpperCase()} ${path} summary`);
      assert.ok(op.description && op.description.length > 20, `${method.toUpperCase()} ${path} description`);
      assert.ok(op.responses && Object.keys(op.responses).some(code => code.startsWith('2')), `${method.toUpperCase()} ${path} 2xx response`);
      if (op.requestBody) assert.ok(op.requestBody.content['application/json'].schema, `${path} body schema`);
    }
  }
  assert.ok(count >= 14, `expected >= 14 operations, got ${count}`);
});

test('securitySchemes document scoped permissions', () => {
  const schemes = openApiSpec.components.securitySchemes;
  assert.ok(schemes.ApiKeyAuth, 'ApiKeyAuth present');
  assert.equal(schemes.ApiKeyAuth.type, 'apiKey');
  assert.equal(schemes.ApiKeyAuth.in, 'header');
  const scopes = schemes.ApiKeyAuth['x-scopes'];
  assert.deepEqual(Object.keys(scopes).sort(), ['meta:read', 'questions:read', 'stats:read']);
  assert.ok(schemes.BearerAuth.type === 'http' && schemes.BearerAuth.scheme === 'bearer');
  // at least one operation references scoped security
  const statsOp = openApiSpec.paths['/api/v1/stats'].get;
  assert.deepEqual(statsOp.security, [{ ApiKeyAuth: ['stats:read'] }]);
});

/* ================= 6. Machine-readable files (fixes #22, #25, #8) ================= */

for (const manifestPath of ['.well-known/mcp/manifest.json', '.well-known/mcp-manifest.json']) {
  test(`MCP manifest valid JSON with required fields: ${manifestPath}`, () => {
    const m = JSON.parse(readFileSync(SITE + manifestPath, 'utf8'));
    assert.equal(m.server.name, 'triumph');
    assert.ok(m.server.description.length > 20);
    assert.equal(m.transport, 'streamable-http');
    assert.equal(m.url, 'https://learndiag.com/mcp');
    assert.ok(Array.isArray(m.tools) && m.tools.length >= 4);
    assert.equal(m.endpoints.mcp, 'https://learndiag.com/mcp');
  });
}

test('agent-skills index.json matches the DualNova draft-v0.1 field set', () => {
  const idx = JSON.parse(readFileSync(SITE + '.well-known/agent-skills/index.json', 'utf8'));
  assert.equal(idx.version, '1.0');
  assert.ok(idx.provider && idx.provider_url && idx.skills.length >= 2);
  for (const s of idx.skills) {
    assert.ok(/^[a-z0-9-]+$/.test(s.name), 'kebab-case name');
    assert.ok(s.title && s.description);
    assert.ok(s.url.startsWith('https://learndiag.com/.well-known/agent-skills/'));
  }
});

test('every SKILL.md: frontmatter required fields + when-to-use + fallback sections', () => {
  const base = SITE + '.well-known/agent-skills/';
  for (const dir of readdirSync(base)) {
    const skillPath = base + dir;
    let src;
    try { src = readFileSync(skillPath + '/SKILL.md', 'utf8'); } catch { continue; }
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(src);
    assert.ok(fm, `${dir}/SKILL.md frontmatter`);
    assert.match(fm[1], /^name: [a-z0-9-]+$/m);
    assert.match(fm[1], /^description: .+/m);
    assert.match(fm[1], /^version: \d+\.\d+$/m);
    assert.ok(src.includes('## When to invoke this skill'), `${dir}: when-to-use section`);
    assert.ok(src.includes('## Fallback'), `${dir}: fallback section`);
    assert.ok(src.length < 400 * 80, `${dir}: under ~400 lines guidance`);
    const nameMatch = /^name:\s*([a-z0-9-]+)$/m.exec(fm[1]);
    assert.equal(nameMatch[1], dir, 'frontmatter name matches directory');
  }
});

test('llms.txt follows llmstxt.org shape and includes when-to-use guidance (fix #25)', () => {
  const t = readFileSync(SITE + 'llms.txt', 'utf8');
  assert.match(t, /^# Learndiag\n/);
  assert.match(t, /^> /m); // blockquote summary
  assert.ok(t.includes('## When to use Learndiag'), 'explicit when-to-use section');
  for (const link of ['/openapi.json', '/mcp', '/.well-known/agent-skills/index.json', '/developers', '/llms.txt', '/auth.md']) {
    assert.ok(t.includes(link), `references ${link}`);
  }
});

/* ================= 6b. Auth.md agent registration discovery ================= */

test('/auth.md: markdown, H1 names auth.md, self-contained, no credential literals', async () => {
  const r = await call(makeEnv(), '/auth.md');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/markdown/);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const md = await r.text();
  assert.match(md, /^#\s+.*auth\.md/m, 'H1 contains auth.md');
  for (const marker of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server',
    'POST https://learndiag.com/api/v1/keys',
    'X-API-Key',
    'Authorization: Bearer',
    'meta:read', 'questions:read', 'stats:read',
    '/api/register', '/api/verify', '/api/login', '/api/resend',
  ]) {
    assert.ok(md.includes(marker), `mentions ${marker}`);
  }
  assert.ok(md.length > 1500, `substantial doc (${md.length} chars)`);
  // examples must not contain usable-looking credential literals
  assert.doesNotMatch(md, /tri_live_[0-9a-f]{40}/);
});

test('/auth.md: HEAD served, POST → structured 405, mirror host exempt from canonical redirect', async () => {
  const env = makeEnv();
  const head = await call(env, '/auth.md', 'HEAD');
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /text\/markdown/);

  const post = await call(env, '/auth.md', 'POST', { nope: true });
  assert.equal(post.status, 405);
  assert.equal((await post.json()).error.code, 'method_not_allowed');

  // programmatic clients on mirror hosts (e.g. triumph-6eq.pages.dev) must get
  // the discovery document directly, not a 301 to the canonical host
  const mirror = await worker.fetch(new Request('https://triumph-6eq.pages.dev/auth.md'), env, {});
  assert.equal(mirror.status, 200);
  assert.match(await mirror.text(), /auth\.md/);
});

test('Protected Resource Metadata: RFC 9728 required fields, scopes match enforcement', async () => {
  const r = await call(makeEnv(), '/.well-known/oauth-protected-resource');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  const prm = await r.json();
  assert.equal(prm.resource, 'https://learndiag.com');
  assert.ok(Array.isArray(prm.authorization_servers) && prm.authorization_servers.length >= 1);
  assert.deepEqual([...prm.scopes_supported].sort(), ['meta:read', 'questions:read', 'stats:read']);
  assert.ok(prm.bearer_methods_supported.includes('header'));
});

test('Authorization Server Metadata: valid issuer matching PRM; complete agent_auth block', async () => {
  const env = makeEnv();
  const prm = await (await call(env, '/.well-known/oauth-protected-resource')).json();
  const r = await call(env, '/.well-known/oauth-authorization-server');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  const asm = await r.json();

  // valid issuer, identical to the AS advertised in PRM
  assert.equal(asm.issuer, 'https://learndiag.com');
  assert.ok(prm.authorization_servers.includes(asm.issuer));

  const aa = asm.agent_auth;
  assert.ok(typeof aa.skill === 'string' && aa.skill.length > 0, 'agent_auth.skill');
  assert.match(aa.register_uri, /^https:\/\/learndiag\.com\//, 'agent_auth.register_uri');
  assert.ok(Array.isArray(aa.registration_methods) && aa.registration_methods.length >= 1);

  // anonymous method: identity type, credential types, claim_uri
  const anon = aa.registration_methods.find(m => (m.identity_types_supported || []).includes('anonymous'));
  assert.ok(anon, 'anonymous registration method present');
  assert.ok(anon.anonymous.credential_types_supported.includes('api_key'));
  assert.match(anon.claim_uri, /^https:\/\/learndiag\.com\/api\/v1\/keys$/);

  // verified-email method: assertion type, credential types, claim_uri
  const verified = aa.registration_methods.find(m =>
    (m.identity_assertion?.assertion_types_supported || []).includes('verified_email'));
  assert.ok(verified, 'verified_email registration method present');
  assert.ok(verified.identity_assertion.credential_types_supported.length >= 1);
  assert.match(verified.identity_assertion.claim_uri, /^https:\/\/learndiag\.com\/api\/verify$/);

  // unsupported flows must not be advertised
  assert.ok(!JSON.stringify(aa.registration_methods).includes('id-jag'), 'no ID-JAG claims');
  assert.equal(asm.token_endpoint, undefined, 'no OAuth token endpoint advertised');
});

/* ================= 6c. api-catalog discovery (RFC 9727 / RFC 8288) ================= */

test('/.well-known/api-catalog: RFC 9264 linkset with RFC 9727 profile, lists REST API + MCP', async () => {
  const r = await call(makeEnv(), '/.well-known/api-catalog');
  assert.equal(r.status, 200);
  const ct = r.headers.get('content-type');
  assert.match(ct, /application\/linkset\+json/, 'linkset media type');
  assert.match(ct, /profile="https:\/\/www\.rfc-editor\.org\/info\/rfc9727"/, 'RFC 9727 profile parameter');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');

  const doc = await r.json();
  assert.ok(Array.isArray(doc.linkset) && doc.linkset.length >= 2, 'linkset array with one element per API');

  const rest = doc.linkset.find(e => e.anchor === 'https://learndiag.com/api/v1/');
  assert.ok(rest, 'REST API element');
  assert.ok(rest['service-desc'].some(l => l.href === 'https://learndiag.com/openapi.json'), 'REST service-desc → openapi.json');
  assert.ok(rest['service-doc'].some(l => l.href === 'https://learndiag.com/developers'), 'REST service-doc → /developers (pretty URL, no redirect hop)');
  assert.ok(rest.status.some(l => l.href === 'https://learndiag.com/api/v1/health'), 'status → health probe');

  const mcp = doc.linkset.find(e => e.anchor === 'https://learndiag.com/mcp');
  assert.ok(mcp, 'MCP element');
  assert.ok(mcp['service-desc'].some(l => l.href === 'https://learndiag.com/.well-known/mcp/manifest.json'), 'MCP service-desc → manifest');
});

test('/.well-known/api-catalog: HEAD carries Link header (RFC 9727 §2), POST → 405, mirror exempt', async () => {
  const env = makeEnv();
  const head = await call(env, '/.well-known/api-catalog', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '', 'HEAD must not carry a body');
  assert.match(head.headers.get('link') || '', /rel="api-catalog"/);

  const post = await call(env, '/.well-known/api-catalog', 'POST', { nope: true });
  assert.equal(post.status, 405);
  assert.equal((await post.json()).error.code, 'method_not_allowed');

  // programmatic clients on mirror hosts get the catalog directly, no 301
  const mirror = await worker.fetch(new Request('https://triumph-6eq.pages.dev/.well-known/api-catalog'), env, {});
  assert.equal(mirror.status, 200);
  assert.ok((await mirror.json()).linkset.length >= 2);
});

test('homepage Link header: api-catalog/service-desc/service-doc/describedby on both representations; targets resolve', async () => {
  const env = makeEnv();
  const requiredRels = ['api-catalog', 'service-desc', 'service-doc', 'describedby'];
  for (const accept of [undefined, 'text/html', 'text/markdown']) {
    const r = await call(env, '/', 'GET', null, accept ? { Accept: accept } : {});
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), accept === 'text/markdown' ? /text\/markdown/ : /text\/html/);
    const link = r.headers.get('link');
    assert.ok(link, `Link header on homepage (${accept || 'default'} Accept)`);
    for (const rel of requiredRels) {
      assert.match(link, new RegExp(`rel="${rel}"`), `rel=${rel} present (${accept || 'default'} Accept)`);
    }
  }

  // every advertised relation target must actually resolve on the site
  const r = await call(env, '/');
  for (const m of (r.headers.get('link') || '').matchAll(/<([^>]+)>/g)) {
    const path = new URL(m[1], 'https://learndiag.com').pathname;
    const target = await call(env, path);
    assert.equal(target.status, 200, `${path} must exist`);
  }
});

test('other content pages do not carry the discovery Link header (homepage-scoped)', async () => {
  const r = await call(makeEnv(), '/about');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('link'), null);
});

/* ================= 7. robots.txt & sitemap.xml (fixes #2, #3, #16) ================= */

test('robots.txt: no BOM (live directive breakage), AI agents allowed, sitemap linked', () => {
  const buf = readFileSync(SITE + 'robots.txt');
  assert.ok(!(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF), 'must not start with UTF-8 BOM');
  const t = buf.toString('utf8');
  for (const ua of ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Google-Extended',
    'Applebot-Extended', 'PerplexityBot', 'DeepSeekBot', 'ora-agent']) {
    assert.ok(t.includes(`User-agent: ${ua}`), `allows ${ua}`);
  }
  assert.match(t, /^Sitemap: https:\/\/learndiag\.com\/sitemap\.xml$/m);
});

test('robots.txt: Content-Signal declared in every User-agent group (contentsignals.org)', () => {
  const t = readFileSync(SITE + 'robots.txt', 'utf8');
  // canonical all-allow signal matching the site's public/agent-welcome posture
  assert.ok(t.includes('Content-Signal: ai-train=yes, search=yes, ai-input=yes'), 'canonical signal present');
  // split into groups: every group carries a syntactically valid Content-Signal
  // with all three categories (a crawler matching a specific group ignores the
  // wildcard group, so per-group repetition is required)
  const groups = t.split(/^User-agent:/m).slice(1);
  assert.ok(groups.length >= 10, `parsed ${groups.length} user-agent groups`);
  for (const g of groups) {
    const body = g.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).join('\n');
    const sig = /Content-Signal:([^\n]*)/.exec(body);
    assert.ok(sig, `group "${body.split('\n')[0].trim()}" carries a Content-Signal`);
    const pairs = sig[1].split(',').map(s => s.trim()).filter(Boolean);
    const labels = pairs.map(p => p.split('=')[0].trim());
    for (const cat of ['ai-train', 'search', 'ai-input']) {
      assert.ok(labels.includes(cat), `group declares ${cat}`);
    }
    for (const p of pairs) {
      const value = p.split('=')[1];
      assert.ok(['yes', 'no'].includes(value), `signal value must be yes|no: "${p}"`);
    }
  }
});

test('sitemap.xml: parses, every url has lastmod, urls unique + canonical host', () => {
  const xml = readFileSync(SITE + 'sitemap.xml', 'utf8');
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);
  assert.ok(urls.length >= 15, 'covers indexable pages incl. trust + developers');
  const locs = new Set();
  for (const u of urls) {
    const loc = /<loc>(.*?)<\/loc>/.exec(u);
    assert.ok(loc, 'each url has loc');
    assert.ok(loc[1].startsWith('https://learndiag.com'), loc[1]);
    locs.add(loc[1]);
    assert.match(u, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, `lastmod for ${loc[1]}`);
  }
  assert.equal(locs.size, urls.length, 'no duplicate urls');
});

/* ================= 8. Homepage SSR content (fixes #1, #13, #17, #18, #19) ================= */

test('homepage raw HTML: H1 + substantial readable text inside #root (no JS needed)', () => {
  const html = readFileSync(SITE + 'index.html', 'utf8');
  const rootInner = /<div id="root">([\s\S]*?)\n  <\/div>(?:\s|<!--[\s\S]*?-->)*<script/.exec(html);
  assert.ok(rootInner, '#root contains static content');
  const visible = rootInner[1]
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  assert.ok(rootInner[1].includes('<h1'), 'has H1 in raw HTML');
  assert.ok(visible.length >= 500, `>=500 chars of text, got ${visible.length}`);
  assert.match(rootInner[1], /<section class="hero/, 'hero section rendered statically');
});

test('homepage metadata completeness: canonical, lang, og:image, og:type', () => {
  const html = readFileSync(SITE + 'index.html', 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/learndiag\.com\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/learndiag\.com\/og-image-learndiag-v1\.png">/);
  assert.match(html, /<meta property="og:type" content="website">/);
  assert.ok(existsSync(SITE + 'og-image-learndiag-v1.png'), 'og-image-learndiag-v1.png exists');
});

const SHARED_IMAGE_URL = 'https://learndiag.com/og-image-learndiag-v1.png';
const SHARED_IMAGE_ALT = 'Learndiag — free Praxis prep. Know where to start.';

function headTags(html, tagName) {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] || '';
  return [...head.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)]
      .map(([, key, , value]) => [key.toLowerCase(), value])));
}

function assertSharedImage(html, page) {
  const tags = headTags(html, 'meta');
  for (const [key, value] of Object.entries({
    'og:image': SHARED_IMAGE_URL,
    'twitter:image': SHARED_IMAGE_URL,
    'og:image:width': '1200',
    'og:image:height': '630',
    'og:image:alt': SHARED_IMAGE_ALT,
    'twitter:image:alt': SHARED_IMAGE_ALT,
  })) {
    assert.deepEqual(tags.filter(t => (t.property || t.name) === key).map(t => t.content),
      [value], `${page}: exactly one consistent ${key}`);
  }
}

for (const [page, canonical] of [['index', 'https://learndiag.com/'], ['diagnostic', 'https://learndiag.com/diagnostic']]) {
  test(`${page}.html: index/follow, no conflicting crawler directives, canonical and shared image`, () => {
    const html = readFileSync(SITE + page + '.html', 'utf8');
    const directives = headTags(html, 'meta').filter(t => /^(robots|googlebot)$/i.test(t.name || ''));
    assert.ok(directives.some(t => t.name.toLowerCase() === 'robots'), 'explicit robots directive');
    const robots = directives.filter(t => t.name.toLowerCase() === 'robots')
      .flatMap(t => t.content.toLowerCase().split(/[\s,]+/));
    assert.ok(robots.includes('index') && robots.includes('follow'), 'index and follow are explicit');
    for (const directive of directives) {
      assert.doesNotMatch(directive.content, /\b(noindex|nofollow|none)\b/i, `${page}: ${directive.name}`);
    }
    assert.deepEqual(headTags(html, 'link').filter(t => t.rel === 'canonical').map(t => t.href), [canonical]);
    assertSharedImage(html, page);
  });
}

test('shared preview PNG: valid signature and 1200 x 630 IHDR dimensions', () => {
  const png = readFileSync(SITE + 'og-image-learndiag-v1.png');
  assert.ok(png.length >= 33, 'PNG includes complete IHDR');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(8), 13, 'IHDR length');
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test('site META images: no old shared URL, consistent generic images, article images retained', () => {
  let genericPages = 0;
  let articlePages = 0;
  for (const file of readdirSync(SITE).filter(f => f.endsWith('.html'))) {
    const html = readFileSync(SITE + file, 'utf8');
    // Deliberately exclude JSON-LD logos, which are not part of this migration.
    for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
      assert.ok(!tag.includes('https://learndiag.com/og-image.png'), `${file}: no legacy META image`);
    }
    const tags = headTags(html, 'meta');
    if (tags.some(t => t.content === SHARED_IMAGE_URL)) {
      assertSharedImage(html, file);
      genericPages++;
    }
    const articleImage = `https://learndiag.com/images/${file.replace(/\.html$/, '.png')}`;
    if (existsSync(SITE + 'images/' + file.replace(/\.html$/, '.png'))) {
      for (const key of ['og:image', 'twitter:image']) {
        assert.deepEqual(tags.filter(t => (t.property || t.name) === key).map(t => t.content), [articleImage], `${file}: retain ${key}`);
      }
      articlePages++;
    }
  }
  assert.ok(genericPages >= 22, `generic preview coverage: ${genericPages}`);
  assert.ok(articlePages >= 21, `article preview coverage: ${articlePages}`);
});

test('worker: diagnostic.html redirect preserves query; /diagnostic serves once without noindex', async () => {
  const query = '?utm_source=x&utm_campaign=brand&next=%2Fpractice%3Fsubtest%3D5003';
  const env = makeEnv();
  const assetCalls = [];
  // The asset stub must contain an uninjected head for Clarity injection.
  env.ASSETS.fetch = async request => {
    assetCalls.push(request.url);
    return new Response('<!doctype html><html><head><title>Diagnostic stub</title></head><body>Diagnostic asset</body></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  };
  for (const method of ['GET', 'HEAD']) {
    const redirect = await call(env, '/diagnostic.html' + query, method);
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), 'https://learndiag.com/diagnostic' + query);
    assert.doesNotMatch(redirect.headers.get('x-robots-tag') || '', /\b(noindex|none)\b/i);
  }
  assert.deepEqual(assetCalls, [], '.html redirects without fetching an asset');
  const response = await call(env, '/diagnostic' + query, 'GET', null, { Accept: 'text/html' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null, 'pretty URL does not redirect back');
  assert.doesNotMatch(response.headers.get('x-robots-tag') || '', /\b(noindex|none)\b/i);
  assert.deepEqual(assetCalls, ['https://learndiag.com/diagnostic' + query], 'one unchanged asset request');
  const body = await response.text();
  assert.match(body, /Diagnostic asset/);
  assert.match(body, /clarity\.ms/, 'existing Worker injection still runs');
});

test('SEO image enrichment: shared fallback, existing Twitter card, article preservation and idempotence', () => {
  // Evaluate only the pure image helper, never the full site-writing patch loop.
  const source = readFileSync(ROOT + 'tools/patch-seo-heads.mjs', 'utf8');
  const helper = source.slice(source.indexOf('const SHARED_IMAGE ='), source.indexOf('let patched ='));
  const enrich = runInNewContext(helper + '\nenrichSharedImage');
  const head = '<head><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://learndiag.com/og-image.png">\n';
  const enriched = enrich(head);
  assertSharedImage(enriched + '</head>', 'future shared head');
  assert.equal(enrich(enriched), enriched, 'image enrichment is idempotent');
  const logo = '<script type="application/ld+json">{"logo":"https://learndiag.com/og-image.png"}</script>';
  const ogOnly = '<head><meta property="og:image" content="https://learndiag.com/og-image.png"><meta property="og:image:width" content="600"><meta property="og:image:alt" content="Old brand">' + logo + '\n';
  const ogEnriched = enrich(ogOnly);
  assertSharedImage(ogEnriched + '</head>', 'future OG-only head');
  assert.ok(ogEnriched.includes(logo), 'JSON-LD logo is unchanged');
  const article = '<head><meta property="og:image" content="https://learndiag.com/images/article.png"><meta name="twitter:image" content="https://learndiag.com/images/article.png">\n';
  assert.equal(enrich(article), article, 'article metadata remains untouched');
});

test('homepage JSON-LD: parses; Organization has contactPoint; SoftwareApplication has offers', () => {
  const html = readFileSync(SITE + 'index.html', 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)]
    .map(m => JSON.parse(m[1]));
  const types = blocks.map(b => b['@type']);
  for (const t of ['WebSite', 'Organization', 'SoftwareApplication']) {
    assert.ok(types.includes(t), `JSON-LD ${t}`);
  }
  const org = blocks.find(b => b['@type'] === 'Organization');
  assert.ok(org.contactPoint?.length >= 1);
  assert.ok(org.contactPoint[0].email);
  assert.ok(org.contactPoint[0].contactType);
  assert.ok(!org.address || org.address['@type'] === 'PostalAddress', 'address optional; if present must be PostalAddress');
  const app = blocks.find(b => b['@type'] === 'SoftwareApplication');
  assert.equal(app.offers.price, '0');
  assert.equal(app.operatingSystem, 'Web');
  // content efficiency proxy: readable share of total bytes
  const totalBytes = Buffer.byteLength(html);
  const rootInner = /<div id="root">([\s\S]*?)\n  <\/div>(?:\s|<!--[\s\S]*?-->)*<script/.exec(html)[1];
  const textChars = rootInner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  assert.ok(textChars / totalBytes >= 0.05, `readable ratio ${(textChars / totalBytes).toFixed(3)} >= 0.05`);
});

test('homepage links trust + developer pages from footer', () => {
  const html = readFileSync(SITE + 'index.html', 'utf8');
  // pretty canonical URLs (SEO migration, e9f4fed); worker resolves them to the
  // .html assets — verified live 200 for all four on 2026-09-03
  for (const p of ['/about', '/contact', '/privacy', '/developers']) {
    assert.ok(html.includes(`href="${p}"`), `footer links ${p}`);
  }
});

/* ================= 9. Markdown variants exist for every route (fix #7) ================= */

test('every MD route maps to an existing non-trivial markdown file starting with H1 or comment', () => {
  for (const [, mdAsset] of MD_ROUTES.entries()) {
    const file = SITE + mdAsset.replace(/^\//, '');
    assert.ok(existsSync(file), `${mdAsset} exists`);
    const md = readFileSync(file, 'utf8');
    assert.ok(md.length > 800, `${mdAsset} non-trivial (${md.length})`);
    assert.ok(/^#\s/m.test(md), `${mdAsset} has an H1`);
    assert.ok(!/Suggested/.test(md), `${mdAsset} free of draft scaffolding`);
  }
});

/* ================= 10. Guide pages: rel next/prev chain + scaffolding removed (fix #21) ================= */

const SERIES = [
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

test('guide series forms a consistent rel next/prev chain', () => {
  // 注意：ardot 标注流程会给每个标签注入 data-page-node-id="..."，
  // 所以不能断言标签字符串完全相等，必须允许标签内出现额外属性。
  const relLink = (rel, href) =>
    new RegExp(`<link\\s[^>]*rel="${rel}"[^>]*href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
  SERIES.forEach((page, i) => {
    const html = readFileSync(SITE + page + '.html', 'utf8');
    const prev = i > 0 ? SERIES[i - 1] : null;
    const next = i < SERIES.length - 1 ? SERIES[i + 1] : null;
    if (prev) assert.match(html, relLink('prev', `https://learndiag.com/${prev}`), `${page} prev→${prev}`);
    else assert.ok(!/<link rel="prev"/.test(html), `${page} no prev`);
    if (next) assert.match(html, relLink('next', `https://learndiag.com/${next}`), `${page} next→${next}`);
    else assert.ok(!/<link rel="next"/.test(html), `${page} no next`);
    assert.match(html, /<link rel="canonical"/, `${page} canonical`);
  });
});

test('leaked AI-draft scaffolding removed from live article pages', () => {
  for (const page of ['praxis-5001-retake-guide', 'praxis-5001-vs-7001']) {
    const html = readFileSync(SITE + page + '.html', 'utf8');
    assert.ok(!/Suggested <code>/.test(html), `${page} clean`);
  }
});

/* ================= 11. Trust pages (fix #20) ================= */

for (const page of ['about', 'contact', 'privacy', 'developers']) {
  test(`${page}.html: canonical, og tags, >=500 chars of article text`, () => {
    const html = readFileSync(SITE + page + '.html', 'utf8');
    assert.match(html, /<link rel="canonical" href="https:\/\/learndiag\.com\//);
    assert.match(html, /<meta property="og:image"/);
    assert.match(html, /<article[\s\S]*<\/article>/);
    const article = /<article[\s\S]*?<\/article>/.exec(html)[0];
    const text = article.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.ok(text.length >= 500, `${page} article text ${text.length}`);
    // 允许 ardot 标注注入的额外属性（data-page-node-id）
    assert.match(html, /<html lang="en"[\s>]/);
  });
}

test('404.html exists with noindex (kills SPA soft-404 fallback)', () => {
  const html = readFileSync(SITE + '404.html', 'utf8');
  assert.match(html, /<meta name="robots" content="noindex">/);
});

/* ================= 12. Data integrity ================= */

test('questions-api.json: 969 well-formed questions; stats.json agrees', () => {
  const bank = JSON.parse(readFileSync(SITE + 'data/questions-api.json', 'utf8'));
  assert.equal(bank.length, 969);
  for (const q of bank.slice(0, 50)) {
    assert.ok(q.id && q.code && q.q && Array.isArray(q.options) && typeof q.answer === 'number');
  }
  const stats = JSON.parse(readFileSync(SITE + 'data/stats.json', 'utf8'));
  let sum = 0;
  for (const s of Object.values(stats.subtests)) sum += s.questionCount;
  assert.equal(sum, stats.total);
  assert.equal(stats.total, bank.length);
});

/* ================= 13. auth.js understands structured errors (backward compatible) ================= */

test('auth.js surfaces code/message/email from the structured envelope', async () => {
  const sandbox = { window: {}, fetch: async () => new Response(
    JSON.stringify({ error: { code: 'not_verified', message: 'This account exists but has not been verified yet.', hint: 'Submit the emailed code.', details: { email: 'me@example.com' } }, status: 403 }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }) };
  const src = readFileSync(SITE + 'js/auth.js', 'utf8');
  new Function('window', 'fetch', src)(sandbox.window, sandbox.fetch);
  const T = sandbox.window.TriumphAuth;
  assert.ok(T, 'TriumphAuth installed');
  let threw = null;
  try { await T._req('/api/login', 'POST', {}); } catch (e) { threw = e; }
  assert.ok(threw);
  assert.equal(threw.code, 'not_verified');
  assert.equal(threw.email, 'me@example.com');
  assert.equal(threw.hint.includes('code'), true);
});

/* ================= 14. CLI ================= */

test('CLI: parseArgs and query builder behave', async () => {
  const cli = await import(pathToFileURL(ROOT + 'cli/triumph-praxis.js').href);
  const { command, opts } = cli.parseArgs(['random', '--count', '3', '--subtest=5002', '--json']);
  assert.deepEqual(command, ['random']);
  assert.equal(opts.count, '3');
  assert.equal(opts.subtest, '5002');
  assert.equal(opts.json, true);
  assert.equal(cli.buildQuestionsQuery({ subtest: '5002', limit: '10' }), '?subtest=5002&limit=10');
  assert.equal(cli.buildQuestionsQuery({}), '');
  assert.match(cli.formatError({ error: { code: 'x', message: 'm', hint: 'h' } }), /^x: m\nhint: h$/);
});

test('CLI: --help exits 0 and prints usage', async () => {
  const { execFile } = await import('node:child_process');
  await new Promise((resolve, reject) => {
    execFile(process.execPath, [ROOT + 'cli/triumph-praxis.js', '--help'], (err, stdout) => {
      try {
        assert.ifError(err);
        assert.match(stdout, /Usage:/);
        resolve();
      } catch (e) { reject(e); }
    });
  });
});

/* ================= <script> 标签配平守卫（2026-09-10 加） =================
 *
 * 起因：往 site/index.html 尾部注入埋点脚本时，改动里删掉了一个 </script>
 * 却没补回来（git diff 里是孤零零一行 `-</script>`，后面跟的是 HTML 注释
 * 加两个新的 script 标签）。结果是首页最后一个内联脚本**没有闭合**。
 *
 * 为什么这种错特别危险：浏览器在 <script> 内部把内容当**原始文本**处理，
 * 直到遇到第一个 </script> 才结束。所以丢一个闭合标签不会产生任何 HTML
 * 层面的报错，而是让后续的 HTML 注释和 `<script src=...>` 标签被**当成 JS
 * 代码吃进去**，整段脚本抛 SyntaxError 后静默失效 —— 页面看着正常，交互
 * 全死，控制台之外没有任何提示。这正是「构建期不报错、上线才发现」那一类。
 *
 * tools/check-inline-js.py 能抓到它，但那个脚本不在 npm test 的执行列表里，
 * 不会随 CI 自动跑。这条守卫把「开闭标签必须配平」变成每次跑测试都会过的
 * 机械检查，成本近乎为零。
 */
test('every site HTML page has balanced <script> / </script> tags', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(dir + e.name + '/');
      else if (e.name.endsWith('.html')) files.push(dir + e.name);
    }
  };
  walk(SITE);

  // 下限只用来兜「路径写错导致一个文件都没扫到」这种情况。
  // site/ 下当前是 49 个 html（47 顶层 + 2 在子目录里），留一点余量。
  assert.ok(files.length > 40, `扫描到的页面太少（${files.length}），路径可能写错了`);

  const bad = [];
  for (const f of files) {
    const html = readFileSync(f, 'utf8');
    const open = (html.match(/<script\b/g) || []).length;
    const close = (html.match(/<\/script>/g) || []).length;
    if (open !== close) bad.push(`${f.slice(SITE.length)}: 开 ${open} / 闭 ${close}`);
  }

  assert.deepEqual(bad, [], '<script> 标签不配平 —— 丢闭合标签会让整段内联 JS 静默失效');
});
