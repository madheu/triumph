#!/usr/bin/env node
// triumph-praxis — official CLI for the Triumph Praxis 5001 API.
// Docs: https://trytriumph.de5.net/developers · Spec: https://trytriumph.de5.net/openapi.json

import { pathToFileURL } from 'node:url';

const VERSION = '1.0.0';
const DEFAULT_API = 'https://trytriumph.de5.net';

/* ---------------- pure helpers (exported for tests) ---------------- */

export function parseArgs(argv) {
  const command = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { command.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        opts[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        opts[a.slice(2)] = argv[++i];
      } else {
        opts[a.slice(2)] = true;
      }
    } else {
      command.push(a);
    }
  }
  return { command, opts };
}

export function buildQuestionsQuery(opts) {
  const q = new URLSearchParams();
  const map = { subtest: 'subtest', category: 'category', search: 'search', limit: 'limit', offset: 'offset' };
  for (const [flag, param] of Object.entries(map)) {
    if (opts[flag] !== undefined && opts[flag] !== true) q.set(param, String(opts[flag]));
  }
  const s = q.toString();
  return s ? '?' + s : '';
}

export async function apiFetch(path, { api = DEFAULT_API, key, method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (key) headers['X-API-Key'] = key;
  const res = await fetch(api.replace(/\/$/, '') + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  let parseOk = true;
  try {
    data = await res.json();
  } catch {
    parseOk = false;
  }
  if (!parseOk || data === null || typeof data !== 'object') {
    // Non-JSON payload (e.g. an HTML page from a proxy or captive portal)
    return {
      status: res.status,
      ok: false,
      data: { error: { code: 'invalid_response', message: 'The server returned a non-JSON response.', hint: `Check the --api base URL (expected the Triumph API at ${DEFAULT_API}).` } },
    };
  }
  return { status: res.status, ok: res.ok && parseOk, data };
}

/** Flatten the structured error envelope into one readable line. */
export function formatError(data) {
  const e = data && data.error;
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  let line = `${e.code}: ${e.message}`;
  if (e.hint) line += `\nhint: ${e.hint}`;
  return line;
}

/* ---------------- output helpers ---------------- */

function printQuestion(q, idx) {
  const letters = ['A', 'B', 'C', 'D'];
  console.log(`\n${idx}. [${q.id}] ${q.subtest_code} ${q.subtest} — ${q.category}`);
  console.log(`   ${q.question}`);
  q.options.forEach((o, i) => console.log(`   ${letters[i]}) ${o}`));
  console.log(`   ✓ answer: ${letters[q.answer_index]}) ${q.answer_text}`);
  console.log(`   ${q.explanation}`);
}

function usage(code = 0) {
  console.log(`triumph-praxis v${VERSION} — CLI for the Triumph Praxis 5001 API (free)

Usage:
  triumph-praxis health                       Service health check
  triumph-praxis subtests                     List the four subtests with counts
  triumph-praxis stats                        Question counts per category
  triumph-praxis questions [options]          Browse the bank
  triumph-praxis random [options]             Draw random questions
  triumph-praxis guides                       List study guides (HTML + markdown URLs)
  triumph-praxis key new [options]            Create a free scoped API key
  triumph-praxis key verify --key KEY         Verify a key / list scopes
  triumph-praxis spec                         Print the OpenAPI document URL

Options:
  --subtest CODE     5002 | 5003 | 5004 | 5005
  --category NAME    Content-category filter (exact, case-insensitive)
  --search TEXT      Substring filter on question text
  --limit N          Page size, 1-100 (default 20)
  --count N          Random draw size, 1-50 (default 5)
  --email EMAIL      Attributed email when creating keys
  --scope SCOPE      Key scope, repeatable (meta:read questions:read stats:read)
  --key KEY          Existing API key to send as X-API-Key
  --api URL          Override API base (default ${DEFAULT_API})
  --json             Raw JSON output

Docs: https://trytriumph.de5.net/developers`);
  process.exit(code);
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  const ctx = { api: opts.api || DEFAULT_API, key: typeof opts.key === 'string' ? opts.key : undefined };
  const cmd = command[0] || '';

  if (!cmd || cmd === 'help' || opts.help) usage(0);

  switch (cmd) {
    case 'health': {
      const r = await apiFetch('/api/v1/health', ctx);
      if (!r.ok) { console.error(formatError(r.data)); process.exit(1); }
      console.log(opts.json ? JSON.stringify(r.data, null, 2) : `ok — ${r.data.service} v${r.data.version} (${r.data.time})`);
      break;
    }
    case 'subtests': {
      const r = await apiFetch('/api/v1/meta', ctx);
      if (!r.ok) { console.error(formatError(r.data)); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(r.data, null, 2)); break; }
      console.log(`Triumph — ${r.data.total_questions} original Praxis 5001 questions\n`);
      for (const [code, s] of Object.entries(r.data.subtests)) {
        console.log(`${code}  ${s.name.padEnd(28)} ${String(s.questionCount).padStart(3)} questions`);
        for (const c of s.categories) console.log(`      · ${c.name} (${c.questionCount})`);
      }
      break;
    }
    case 'stats': {
      const r = await apiFetch('/api/v1/stats', ctx);
      if (!r.ok) { console.error(formatError(r.data)); process.exit(1); }
      console.log(opts.json ? JSON.stringify(r.data, null, 2) : JSON.stringify(r.data.subtests, null, 2));
      break;
    }
    case 'questions': {
      const r = await apiFetch('/api/v1/questions' + buildQuestionsQuery(opts), ctx);
      if (!r.ok) { console.error(formatError(r.data)); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(r.data, null, 2)); break; }
      console.log(`${r.data.count} of ${r.data.total} matching questions (limit ${r.data.limit}, offset ${r.data.offset})`);
      r.data.items.forEach((q, i) => printQuestion(q, i + 1));
      break;
    }
    case 'random': {
      const q = new URLSearchParams();
      if (opts.count) q.set('count', String(opts.count));
      if (opts.subtest) q.set('subtest', String(opts.subtest));
      if (opts.category) q.set('category', String(opts.category));
      const qs = q.toString() ? '?' + q.toString() : '';
      const r = await apiFetch('/api/v1/questions/random' + qs, ctx);
      if (!r.ok) { console.error(formatError(r.data)); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(r.data, null, 2)); break; }
      console.log(`${r.data.count} random question(s) from a pool of ${r.data.total_pool}`);
      r.data.items.forEach((item, i) => printQuestion(item, i + 1));
      break;
    }
    case 'guides': {
      // via MCP tools/call so the CLI exercises one code path
      const r = await apiFetch('/mcp', { ...ctx, method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_study_guides', arguments: {} } } });
      if (!r.ok || r.data.error) { console.error(formatError(r.data)); process.exit(1); }
      const payload = r.data.result.structuredContent;
      if (opts.json) { console.log(JSON.stringify(payload, null, 2)); break; }
      for (const g of payload.guides) console.log(`${g.title}\n  ${g.html_url}\n  ${g.markdown_url}`);
      break;
    }
    case 'key': {
      if (command[1] === 'new') {
        const body = {};
        if (typeof opts.email === 'string') body.email = opts.email;
        const scopes = [];
        for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--scope') scopes.push(process.argv[i + 1]);
        if (scopes.length) body.scopes = scopes;
        const r = await apiFetch('/api/v1/keys', { ...ctx, method: 'POST', body });
        if (!r.ok) { console.error(formatError(r.data)); process.exit(1); }
        if (opts.json) { console.log(JSON.stringify(r.data, null, 2)); break; }
        console.log(`API key created (tier: ${r.data.tier})`);
        console.log(`  key:     ${r.data.key}`);
        console.log(`  scopes:  ${r.data.scopes.join(', ')}`);
        console.log(`  note:    ${r.data.note}`);
      } else if (command[1] === 'verify') {
        if (typeof opts.key !== 'string') { console.error('--key KEY required'); process.exit(2); }
        const r = await apiFetch('/api/v1/keys/verify', ctx);
        if (!r.ok) { console.error(formatError(r.data)); process.exit(1); }
        console.log(opts.json ? JSON.stringify(r.data, null, 2) : `valid — tier ${r.data.tier}, scopes: ${r.data.scopes.join(', ')}`);
      } else {
        console.error('usage: triumph-praxis key new | key verify');
        process.exit(2);
      }
      break;
    }
    case 'spec': {
      console.log(`${ctx.api}/openapi.json   (OpenAPI 3.1, also at ${ctx.api}/api/openapi.yaml)`);
      break;
    }
    default:
      console.error(`unknown command: ${cmd}`);
      usage(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // executed directly (not imported by tests)
  main().catch(e => { console.error(e.message); process.exit(1); });
}
