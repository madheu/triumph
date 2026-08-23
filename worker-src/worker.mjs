// worker-src/worker.mjs — Triumph Cloudflare Pages worker entry point.
//
// This is the composition root of the modularized worker. It mounts the main
// router and re-exports the named symbols that the test suite and tooling
// depend on (parseAccept, negotiatePageVariant, varyWithAccept, MD_ROUTES,
// openApiSpec, specToYaml). esbuild bundles worker-src/* into site/_worker.js
// via build-worker.mjs.
//
// Responsibilities (everything not listed here falls through to static assets
// via env.ASSETS.fetch, preserving existing Pages behaviour byte-for-byte):
//   1. /api/*            — account API returning structured JSON errors
//                          { error: { code, message, hint } }
//   2. /api/v1/*         — public, documented read API (questions/meta/stats/
//                          health) + self-serve scoped API keys
//   3. /mcp              — MCP (Model Context Protocol) server over Streamable
//                          HTTP (JSON-RPC 2.0: initialize / tools/list / tools/call)
//   4. Accept: markdown  — RFC 7763 content negotiation on content pages with
//                          q-value parsing, Vary: Accept, Accept-Encoding and
//                          406 only when nothing acceptable can be produced
//   5. /api/openapi.yaml — OpenAPI 3.1 spec serialized from the same object as
//                          the static /openapi.json (single source of truth)

import { CORS_HEADERS, corsPreflight, withCors, json, apiError, ERROR_CATALOG } from './http.mjs';
import { ACCOUNT_ROUTES } from './accounts.mjs';
import { PASSWORD_ROUTES } from './password.mjs';
import { BILLING_ROUTES } from './billing.mjs';
import { V1_ROUTES } from './public-api.mjs';
import { ADMIN_ROUTES } from './admin.mjs';
import { MD_ROUTES, PRODUCIBLE_PAGE_TYPES, negotiatePageVariant, varyWithAccept } from './content.mjs';
import { handleMcp } from './mcp.mjs';
import { openApiSpec, specToYaml } from './openapi.mjs';

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '') || '/';
  return pathname;
}

async function serveAssetWithHeaders(request, env, applyVaryAccept) {
  const res = await env.ASSETS.fetch(request);
  if (!applyVaryAccept) return res;
  return varyWithAccept(res);
}

function mergeVary(existing, add) {
  const set = new Set(((existing || '').split(',').map(s => s.trim()).filter(Boolean)).map(v => v.toLowerCase()));
  for (const a of add) set.add(a.toLowerCase());
  return [...set].join(', ');
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = normalizePath(url.pathname);

      /* ---------- machine routes ---------- */

      if (path === '/mcp') return handleMcp(request, env);

      if (path.startsWith('/api/')) {
        if (request.method === 'OPTIONS') return corsPreflight();
        if (path === '/api/openapi.yaml') {
          return new Response(specToYaml(openApiSpec), {
            status: 200,
            headers: { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...CORS_HEADERS },
          });
        }
        if (path === '/api/openapi.json') {
          return json(openApiSpec, 200, { 'Cache-Control': 'public, max-age=3600', ...CORS_HEADERS });
        }
        const account = ACCOUNT_ROUTES[path];
        if (account) {
          const handler = account[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(account) }));
          return withCors(await handler(request, env));
        }
        const pw = PASSWORD_ROUTES[path];
        if (pw) {
          const handler = pw[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(pw) }));
          return withCors(await handler(request, env));
        }
        const billing = BILLING_ROUTES[path];
        if (billing) {
          const handler = billing[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(billing) }));
          return withCors(await handler(request, env));
        }
        const adminRoute = ADMIN_ROUTES[path];
        if (adminRoute) {
          const handler = adminRoute[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(adminRoute) }));
          return withCors(await handler(request, env));
        }
        const v1 = V1_ROUTES[path];
        if (v1) {
          const handler = v1[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(v1) }));
          return withCors(await handler(request, env));
        }
        return withCors(apiError('not_found', { path }));
      }

      /* ---------- markdown negotiation on content pages ---------- */

      const mdAsset = MD_ROUTES.get(path);
      if (mdAsset) {
        const decision = negotiatePageVariant(request.headers.get('Accept'));
        if (decision.status === 406) {
          return withCors(json({
            error: {
              code: 'not_acceptable',
              message: 'No representation of this page matches the Accept header.',
              hint: `Available representations: ${PRODUCIBLE_PAGE_TYPES.join(', ')}. Retry with one of these types in Accept.`,
              details: { available_types: PRODUCIBLE_PAGE_TYPES, received_accept: request.headers.get('Accept') },
            },
            status: 406,
          }, 406, { Vary: 'Accept, Accept-Encoding' }));
        }
        if (decision.variant === 'text/markdown') {
          const assetRes = await env.ASSETS.fetch(new Request(url.origin + mdAsset, { method: 'GET' }));
          if (!assetRes.ok) {
            // Markdown variant missing (should not happen) — fall back to the HTML page.
            return serveAssetWithHeaders(request, env, true);
          }
          const out = new Response(assetRes.body, {
            status: 200,
            headers: {
              'Content-Type': 'text/markdown; charset=utf-8',
              'Cache-Control': 'public, max-age=300',
              'Vary': 'Accept, Accept-Encoding',
              'Content-Language': 'en',
            },
          });
          return withCors(out);
        }
        return serveAssetWithHeaders(request, env, true);
      }

      /* ---------- direct /md/*.md requests ---------- */

      if (path.startsWith('/md/') && path.endsWith('.md')) {
        const res = await env.ASSETS.fetch(request);
        if (res.status === 404) return res;
        const out = new Response(res.body, res);
        out.headers.set('Content-Type', 'text/markdown; charset=utf-8');
        out.headers.set('Vary', mergeVary(out.headers.get('Vary'), ['Accept']));
        return out;
      }

      /* ---------- everything else: untouched static serving ---------- */

      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: { code: 'internal_error', message: ERROR_CATALOG.internal_error.message, hint: ERROR_CATALOG.internal_error.hint }, status: 500 }, 500);
    }
  },
};

// Named exports preserved for the test suite (test/agentic.test.mjs imports
// these directly from site/_worker.js).
export { MD_ROUTES, PRODUCIBLE_PAGE_TYPES, parseAccept, negotiatePageVariant, varyWithAccept } from './content.mjs';
export { openApiSpec, specToYaml } from './openapi.mjs';