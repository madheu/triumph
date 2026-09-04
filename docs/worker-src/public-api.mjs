// worker-src/public-api.mjs — public v1 API (/api/v1/*) (Section 5 of the
// original site/_worker.js, ported verbatim).

import { json, apiError, readJsonBody } from './http.mjs';
import { BASE, API_VERSION } from './constants.mjs';
import { loadBank, loadStats, filterQuestions, paginate, publicQuestion } from './bank.mjs';
import { sha256Hex, generateApiKey, resolveApiKey, KNOWN_SCOPES, FREE_SCOPES } from './keys.mjs';

async function v1Health(env) {
  return json({
    ok: true,
    service: 'triumph-api',
    version: API_VERSION,
    time: new Date().toISOString(),
    endpoints: ['/api/v1/health', '/api/v1/meta', '/api/v1/stats', '/api/v1/questions', '/api/v1/questions/random', '/api/v1/keys', '/api/v1/keys/verify'],
    docs: `${BASE}/openapi.json`,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}

async function v1Meta(env) {
  try {
    const stats = await loadStats(env);
    return json({
      product: 'Learndiag',
      description: 'Free Praxis 5001 (Elementary Education: Multiple Subjects) readiness diagnostic and practice-question bank.',
      base_url: BASE,
      subtests: stats.subtests,
      total_questions: stats.total,
      passing_model: 'Each subtest has its own passing score; all four must pass.',
      docs: { openapi: `${BASE}/openapi.json`, developers: `${BASE}/developers`, mcp: `${BASE}/mcp`, llms: `${BASE}/llms.txt` },
    }, 200, { 'Cache-Control': 'public, max-age=3600' });
  } catch (e) {
    return apiError('internal_error');
  }
}

async function v1Stats(request, env) {
  const authz = await resolveApiKeySafe(request, env, 'stats:read');
  if (authz instanceof Response) return authz;
  try {
    const stats = await loadStats(env);
    return json({ ok: true, ...stats }, 200, { 'Cache-Control': 'public, max-age=3600' });
  } catch (e) {
    return apiError('internal_error');
  }
}

// resolveApiKey throws Response objects; wrap for direct use in v1Stats
function resolveApiKeySafe(request, env, scope) {
  return resolveApiKey(request, env, scope).catch(errResp => errResp);
}

async function v1Questions(request, env) {
  const authz = await resolveApiKeySafe(request, env, 'questions:read');
  if (authz instanceof Response) return authz;
  try {
    const bank = await loadBank(env);
    const url = new URL(request.url);
    const filtered = filterQuestions(bank, url.searchParams);
    if (filtered.err) return filtered.err;
    const page = paginate(filtered.items, url.searchParams);
    return json({ ok: true, ...page }, 200, { 'Cache-Control': 'public, max-age=600' });
  } catch (e) {
    return apiError('internal_error');
  }
}

async function v1Random(request, env) {
  const authz = await resolveApiKeySafe(request, env, 'questions:read');
  if (authz instanceof Response) return authz;
  try {
    const bank = await loadBank(env);
    const url = new URL(request.url);
    const filtered = filterQuestions(bank, url.searchParams);
    if (filtered.err) return filtered.err;
    let count = parseInt(url.searchParams.get('count') || '5', 10);
    if (isNaN(count) || count < 1) count = 5;
    if (count > 50) count = 50;
    // reservoir sample without loading indexes
    const picked = [];
    for (let i = 0; i < filtered.items.length; i++) {
      if (picked.length < count) picked.push(filtered.items[i]);
      else {
        const j = Math.floor(Math.random() * (i + 1));
        if (j < count) picked[j] = filtered.items[i];
      }
    }
    return json({ ok: true, count: picked.length, total_pool: filtered.items.length, items: picked.map(publicQuestion) }, 200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    return apiError('internal_error');
  }
}

async function v1CreateKey(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  // best-effort hourly rate limit: 10 key creations per IP
  const rlKey = `rl:keys:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const cur = parseInt((await env.TRIUMPH_KV.get(rlKey)) || '0', 10);
  if (cur >= 10) return apiError('too_many_requests');
  await env.TRIUMPH_KV.put(rlKey, String(cur + 1), { expirationTtl: 3700 });

  const parsed = await readJsonBody(request);
  if (parsed.err) return parsed.err;
  const email = String(parsed.body.email || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError('invalid_email');

  let scopes = Array.isArray(parsed.body.scopes) ? parsed.body.scopes.map(String) : FREE_SCOPES.slice();
  const unknown = scopes.filter(s => !KNOWN_SCOPES.includes(s));
  if (unknown.length) return apiError('bad_request', { field: 'scopes', unknown, allowed: KNOWN_SCOPES });
  if (!scopes.length) scopes = FREE_SCOPES.slice();

  const key = generateApiKey();
  const record = {
    id: crypto.randomUUID(),
    email_hash: email ? (await sha256Hex(email)).slice(0, 16) : null,
    scopes,
    tier: 'free',
    createdAt: new Date().toISOString(),
  };
  await env.TRIUMPH_KV.put('apikey:' + (await sha256Hex(key)), JSON.stringify(record));
  return json({
    ok: true,
    key,
    scopes,
    tier: 'free',
    note: 'Store this key now — it is shown once. Send it as the X-API-Key header.',
    docs: `${BASE}/openapi.json`,
  }, 201);
}

async function v1VerifyKey(request, env) {
  const presented = request.headers.get('X-API-Key');
  if (!presented) return apiError('unauthorized');
  const recJson = await env.TRIUMPH_KV.get('apikey:' + (await sha256Hex(presented)));
  if (!recJson) return apiError('invalid_api_key');
  const rec = JSON.parse(recJson);
  return json({ ok: true, valid: true, scopes: rec.scopes, tier: rec.tier, created_at: rec.createdAt }, 200, { 'Cache-Control': 'no-store' });
}

export const V1_ROUTES = {
  '/api/v1/health':      { GET: (req, env) => v1Health(env) },
  '/api/v1/meta':        { GET: (req, env) => v1Meta(env) },
  '/api/v1/stats':       { GET: v1Stats },
  '/api/v1/questions':   { GET: v1Questions },
  '/api/v1/questions/random': { GET: v1Random },
  '/api/v1/keys':        { POST: v1CreateKey },
  '/api/v1/keys/verify': { GET: v1VerifyKey },
};
