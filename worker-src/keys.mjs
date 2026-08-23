// worker-src/keys.mjs — scoped API keys, self-serve, KV-backed (Section 3 of
// the original site/_worker.js, ported verbatim).

import { apiError } from './http.mjs';

// Free-tier scopes. Anonymous callers get read access implicitly; keys raise
// limits and make usage attributable. Scope names follow `resource:action`.
export const KNOWN_SCOPES = ['meta:read', 'questions:read', 'stats:read'];
export const FREE_SCOPES = ['meta:read', 'questions:read', 'stats:read'];

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function generateApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const hex = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  return 'tri_live_' + hex;
}

/** Resolve the caller identity for /api/v1 data endpoints. Returns {key} | {anon:true} | throws Response(error). */
export async function resolveApiKey(request, env, requiredScope) {
  const presented = request.headers.get('X-API-Key');
  if (!presented) return { anon: true }; // public tier: anonymous read access is allowed
  const recJson = await env.TRIUMPH_KV.get('apikey:' + (await sha256Hex(presented)));
  if (!recJson) throw apiError('invalid_api_key');
  const rec = JSON.parse(recJson);
  if (!rec.scopes || !rec.scopes.includes(requiredScope)) {
    throw apiError('forbidden_scope', { required_scope: requiredScope, key_scopes: rec.scopes });
  }
  return { key: rec };
}
