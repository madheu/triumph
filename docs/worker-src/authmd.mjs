// worker-src/authmd.mjs — Auth.md agent registration discovery.
//
// Publishes the three Auth.md discovery documents:
//   1. /auth.md                                 — self-contained Markdown (body
//                                                 lives in site/auth.md; this
//                                                 module forces text/markdown
//                                                 headers + CORS on top of it)
//   2. /.well-known/oauth-protected-resource    — Protected Resource Metadata
//                                                 (RFC 9728)
//   3. /.well-known/oauth-authorization-server  — Authorization Server Metadata
//                                                 with the agent_auth extension
//                                                 block
//
// The JSON documents are built from the same scope constants keys.mjs enforces,
// so discovery can never drift from enforcement. This issuer deliberately does
// NOT advertise OAuth authorization/token endpoints (none exist) — agents are
// routed to the self-serve registration methods in agent_auth instead.

import { json, apiError, corsPreflight, withCors } from './http.mjs';
import { BASE } from './constants.mjs';
import { KNOWN_SCOPES, FREE_SCOPES } from './keys.mjs';

export const PRM_URL = `${BASE}/.well-known/oauth-protected-resource`;
export const ASM_URL = `${BASE}/.well-known/oauth-authorization-server`;

export const protectedResourceMetadata = {
  resource: BASE,
  authorization_servers: [BASE],
  scopes_supported: [...KNOWN_SCOPES],
  bearer_methods_supported: ['header'],
  resource_documentation: `${BASE}/openapi.json`,
  resource_policy_uri: `${BASE}/privacy`,
  resource_tos_uri: `${BASE}/terms`,
};

const API_KEY_CREDENTIAL_USE = { in: 'header', name: 'X-API-Key' };
const BEARER_CREDENTIAL_USE = { in: 'header', name: 'Authorization', scheme: 'Bearer' };

export const authorizationServerMetadata = {
  issuer: BASE,
  description:
    'Learndiag issues free, self-serve credentials for its read-only Praxis 5001 API. ' +
    'This issuer does not operate OAuth 2.0 authorization or token endpoints; agents must ' +
    'use the registration methods in agent_auth.',
  service_documentation: `${BASE}/openapi.json`,
  scopes_supported: [...KNOWN_SCOPES],
  agent_auth: {
    skill: 'practice-praxis-questions',
    skills_index: `${BASE}/.well-known/agent-skills/index.json`,
    register_uri: `${BASE}/api/v1/keys`,
    docs: `${BASE}/openapi.json`,
    registration_methods: [
      {
        id: 'anonymous-self-serve-api-key',
        description: 'Recommended for agents. No identity required; a free API key is returned immediately.',
        identity_types_supported: ['anonymous'],
        anonymous: { credential_types_supported: ['api_key'] },
        credential_types_supported: ['api_key'],
        claim_uri: `${BASE}/api/v1/keys`,
        claim_method: 'POST',
        credential_use: API_KEY_CREDENTIAL_USE,
        scopes_supported: [...FREE_SCOPES],
        verify_uri: `${BASE}/api/v1/keys/verify`,
        rate_limit: '10 key creations per IP per hour',
      },
      {
        id: 'verified-email-account',
        description: 'Email-verified account for user-scoped study-state endpoints. Not required for the public read API or MCP.',
        identity_types_supported: ['identity_assertion'],
        identity_assertion: {
          assertion_types_supported: ['verified_email'],
          credential_types_supported: ['jwt'],
          claim_uri: `${BASE}/api/verify`,
          verification: {
            code_delivery: 'email',
            code_length: 6,
            ttl_minutes: 15,
            register_uri: `${BASE}/api/register`,
            resend_uri: `${BASE}/api/resend`,
          },
        },
        credential_types_supported: ['jwt'],
        claim_uri: `${BASE}/api/verify`,
        claim_method: 'POST',
        register_uri: `${BASE}/api/register`,
        login_uri: `${BASE}/api/login`,
        credential_use: BEARER_CREDENTIAL_USE,
        token_ttl_days: 30,
      },
    ],
  },
};

/* ---------- route handlers ---------- */

function headVariant(res) {
  return new Response(null, { status: res.status, headers: res.headers });
}

// Serves the static site/auth.md body with deterministic discovery headers.
// (env.ASSETS goes straight to the asset server — no re-entry into the worker.)
async function hAuthMd(request, env) {
  const origin = new URL(request.url).origin;
  const asset = await env.ASSETS.fetch(new Request(`${origin}/auth.md`, { method: 'GET' }));
  if (!asset.ok) return apiError('not_found');
  const res = new Response(asset.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
  return request.method === 'HEAD' ? headVariant(withCors(res)) : withCors(res);
}

function hJsonDoc(data) {
  return request => {
    const res = json(data, 200, { 'Cache-Control': 'public, max-age=3600' });
    return request.method === 'HEAD' ? headVariant(res) : res;
  };
}

// Discovery documents are public, cacheable and CORS-readable by browser agents.
export const AUTH_DISCOVERY_ROUTES = {
  '/auth.md': {
    GET: hAuthMd,
    HEAD: hAuthMd,
    OPTIONS: () => corsPreflight(),
  },
  '/.well-known/oauth-protected-resource': {
    GET: hJsonDoc(protectedResourceMetadata),
    HEAD: hJsonDoc(protectedResourceMetadata),
    OPTIONS: () => corsPreflight(),
  },
  '/.well-known/oauth-authorization-server': {
    GET: hJsonDoc(authorizationServerMetadata),
    HEAD: hJsonDoc(authorizationServerMetadata),
    OPTIONS: () => corsPreflight(),
  },
};
