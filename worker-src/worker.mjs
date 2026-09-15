// worker-src/worker.mjs — Learndiag Cloudflare Pages worker entry point.
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
//   6. /auth.md + Auth.md discovery — /auth.md (Markdown), PRM at
//                          /.well-known/oauth-protected-resource and
//                          authorization server metadata with the agent_auth
//                          block at /.well-known/oauth-authorization-server
//   7. /.well-known/api-catalog — RFC 9727 API catalog document (RFC 9264
//                          Linkset format) + RFC 8288 Link discovery headers
//                          on the homepage response

import { CORS_HEADERS, corsPreflight, withCors, json, apiError, ERROR_CATALOG } from './http.mjs';
import { AUTH_DISCOVERY_ROUTES } from './authmd.mjs';
import { API_CATALOG_PATH, DISCOVERY_LINK_HEADER, hApiCatalog } from './apicatalog.mjs';
import { ACCOUNT_ROUTES } from './accounts.mjs';
import { MAGIC_ROUTES } from './magic.mjs';
import { EVENT_ROUTES } from './events.mjs';
import { ACCOUNT_DELETE_ROUTES } from './account-delete.mjs';
import { ACCOUNT_PASSWORD_ROUTES } from './account-password.mjs';
import { GOOGLE_AUTH_ROUTES } from './google-auth.mjs';
import { PASSWORD_ROUTES } from './password.mjs';
import { BILLING_ROUTES } from './billing.mjs';
import { V1_ROUTES } from './public-api.mjs';
import { ADMIN_ROUTES } from './admin.mjs';
import { CMS_ROUTES } from './cms.mjs';
import { TICKET_ROUTES, ADMIN_TICKET_ROUTES } from './tickets.mjs';
import { ATTEMPT_ROUTES, ADMIN_STATS_ROUTES } from './analytics.mjs';
import { FEEDBACK_ROUTES } from './feedback.mjs';
import { AI_ROUTES } from './ai-analyst.mjs';
import { REPORT_ROUTES } from './diagnostic-report.mjs';
import { MD_ROUTES, PRODUCIBLE_PAGE_TYPES, negotiatePageVariant, varyWithAccept } from './content.mjs';
import { handleMcp } from './mcp.mjs';
import { openApiSpec, specToYaml } from './openapi.mjs';

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '') || '/';
  return pathname;
}

async function serveAssetWithHeaders(request, env, applyVaryAccept, extraHeaders = null) {
  const res = await env.ASSETS.fetch(request);
  const out = applyVaryAccept ? varyWithAccept(res) : res;
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) out.headers.set(k, v);
  return out;
}

function mergeVary(existing, add) {
  const set = new Set(((existing || '').split(',').map(s => s.trim()).filter(Boolean)).map(v => v.toLowerCase()));
  for (const a of add) set.add(a.toLowerCase());
  return [...set].join(', ');
}

// ---------- Microsoft Clarity 全站注入 ----------
// 在响应层把 Clarity 脚本插到 </head> 前：一处配置覆盖全部静态页（含未来新增），
// 免得逐个 HTML 维护。仅改写 text/html；已有 clarity.ms 的页面不重复注入。
const CLARITY_ID = 'yai69wh16v';
const CLARITY_SNIPPET = '<script type="text/javascript">(function(c,l,a,r,i,t,y){' +
  'c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};' +
  't=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/' + CLARITY_ID + '";' +
  'y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);' +
  '})(window,document,"clarity","script");</script>';

// Security headers applied to every response (incl. static assets): HSTS
// (site-audit issue "No HSTS support") and the Content-Signal declaration.
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Signal': 'ai-train=yes, search=yes, ai-input=yes',
};

function withSecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!res.headers.has(k)) res.headers.set(k, v);
  }
  return res;
}

async function injectClarity(res) {
  const wrapped = new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
  withSecurityHeaders(wrapped);
  const ct = wrapped.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return wrapped;
  let html = await wrapped.text();
  if (html.includes('clarity.ms')) return wrapped;
  const headEnd = html.toLowerCase().indexOf('</head>');
  if (headEnd === -1) return wrapped;
  html = html.slice(0, headEnd) + CLARITY_SNIPPET + html.slice(headEnd);
  const headers = new Headers(wrapped.headers);
  headers.delete('content-length'); // 正文变长，长度头失效
  headers.delete('etag');           // 内容已变，避免旧 etag 命中缓存
  return new Response(html, { status: wrapped.status, statusText: wrapped.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = normalizePath(url.pathname);

      /* ---------- canonical host consolidation (SEO) ---------- */
      // Mirror hosts such as triumph-6eq.pages.dev serve identical content with
      // a 200, which splits indexing signals across hosts in search engines.
      // Redirect GET/HEAD page requests on any non-canonical host to the
      // production domain so every mirror 301s to learndiag.com.
      // Exempt: local dev hosts, API/MCP/well-known endpoints (programmatic
      // clients must keep working), and non-main preview deployments.
      {
        const host = url.hostname.toLowerCase();
        const isLocalDev = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
        const isCanonical = host === 'learndiag.com';
        const isProgrammatic =
          path.startsWith('/api/') || path === '/mcp' || path.startsWith('/.well-known/') || path === '/auth.md';
        const isPreviewBranch =
          typeof env?.CF_PAGES_BRANCH === 'string' && env.CF_PAGES_BRANCH !== 'main';
        const isPageRequest = request.method === 'GET' || request.method === 'HEAD';
        if (isPageRequest && !isLocalDev && !isCanonical && !isProgrammatic && !isPreviewBranch) {
          return Response.redirect(`https://learndiag.com${url.pathname}${url.search}`, 301);
        }
      }

      /* ---------- canonical pretty URLs for static app pages (SEO) ---------- */
      // Cloudflare Pages asset routing 308s /foo.html to /foo, so the pretty
      // forms are canonical — same convention as every other page (/about,
      // /resources, /mistake-log). 301 the .html forms to the pretty URL so
      // each page has one URL and the two redirects can never loop.
      if (path === '/diagnostic.html' || path === '/practice.html') {
        return Response.redirect(`${url.origin}${path.replace(/\.html$/, '')}${url.search}`, 301);
      }

      // 301 merge: passing-scores → score-calculator (content consolidated into the calculator
      // tool page so all passing-score rank weight lands on one URL, no cannibalization).
      if (path === '/praxis-5001-passing-scores' || path === '/praxis-5001-passing-scores.html') {
        return Response.redirect('https://learndiag.com/score-calculator', 301);
      }

      /* ---------- machine routes ---------- */

      if (path === '/mcp') return handleMcp(request, env);

      const authDoc = AUTH_DISCOVERY_ROUTES[path];
      if (authDoc) {
        const handler = authDoc[request.method];
        if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(authDoc) }));
        return handler(request, env);
      }

      // RFC 9727 well-known API catalog (GET/HEAD document, CORS-readable).
      if (path === API_CATALOG_PATH) {
        if (request.method === 'OPTIONS') return corsPreflight();
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return withCors(apiError('method_not_allowed', { allowed: ['GET', 'HEAD'] }));
        }
        return hApiCatalog(request);
      }

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
        const magic = MAGIC_ROUTES[path];
        if (magic) {
          const handler = magic[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(magic) }));
          // redeem is the email-link landing (browser navigation, not XHR) —
          // return the raw 302/HTML like the Google OAuth callback, no CORS wrapper
          return path === '/api/magic/redeem' ? await handler(request, env) : withCors(await handler(request, env));
        }
        const events = EVENT_ROUTES[path];
        if (events) {
          const handler = events[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(events) }));
          return withCors(await handler(request, env));
        }
        const acctDel = ACCOUNT_DELETE_ROUTES[path];
        if (acctDel) {
          const handler = acctDel[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(acctDel) }));
          return withCors(await handler(request, env));
        }
        const acctPw = ACCOUNT_PASSWORD_ROUTES[path];
        if (acctPw) {
          const handler = acctPw[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(acctPw) }));
          return withCors(await handler(request, env));
        }
        const google = GOOGLE_AUTH_ROUTES[path];
        if (google) {
          const handler = google[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(google) }));
          // OAuth callback must NOT get CORS/Access-Control-Allow-Origin:* (the
          // redirect chain is browser-navigated, not XHR); return the raw handler
          // result (a 302 redirect or an error Response).
          return handler(request, env);
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
        const cms = CMS_ROUTES[path];
        if (cms) {
          const handler = cms[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(cms) }));
          return withCors(await handler(request, env));
        }
        const ticket = TICKET_ROUTES[path] || ADMIN_TICKET_ROUTES[path];
        if (ticket) {
          const handler = ticket[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(ticket) }));
          return withCors(await handler(request, env));
        }
        const attempt = ATTEMPT_ROUTES[path] || ADMIN_STATS_ROUTES[path];
        if (attempt) {
          const handler = attempt[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(attempt) }));
          return withCors(await handler(request, env));
        }
        const feedback = FEEDBACK_ROUTES[path];
        if (feedback) {
          const handler = feedback[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(feedback) }));
          return withCors(await handler(request, env));
        }
        const ai = AI_ROUTES[path];
        if (ai) {
          const handler = ai[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(ai) }));
          return withCors(await handler(request, env));
        }
        // 诊断报告：付费内容，未获权益返回 402 且不下发任何报告数据
        const report = REPORT_ROUTES[path];
        if (report) {
          const handler = report[request.method];
          if (!handler) return withCors(apiError('method_not_allowed', { allowed: Object.keys(report) }));
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
        // Homepage responses (both representations) carry the RFC 8288 / RFC
        // 9727 §3 discovery Link header pointing agents at the catalog, the
        // OpenAPI service description, the developer docs and the site's
        // machine-readable description.
        const isHomepage = path === '/' || path === '/index';
        const discoveryLinks = isHomepage ? { Link: DISCOVERY_LINK_HEADER } : null;
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
            return serveAssetWithHeaders(request, env, true, discoveryLinks);
          }
          const out = new Response(assetRes.body, {
            status: 200,
            headers: {
              'Content-Type': 'text/markdown; charset=utf-8',
              'Cache-Control': 'public, max-age=300',
              'Vary': 'Accept, Accept-Encoding',
              'Content-Language': 'en',
              ...discoveryLinks,
            },
          });
          return withCors(withSecurityHeaders(out));
        }
        return serveAssetWithHeaders(request, env, true, discoveryLinks).then(injectClarity);
      }

      /* ---------- direct /md/*.md requests ---------- */

      if (path.startsWith('/md/') && path.endsWith('.md')) {
        const res = await env.ASSETS.fetch(request);
        if (res.status === 404) return res;
        const out = new Response(res.body, res);
        out.headers.set('Content-Type', 'text/markdown; charset=utf-8');
        out.headers.set('Vary', mergeVary(out.headers.get('Vary'), ['Accept']));
        return withSecurityHeaders(out);
      }

      /* ---------- everything else: untouched static serving ---------- */

      return injectClarity(await env.ASSETS.fetch(request));
    } catch (err) {
      return json({ error: { code: 'internal_error', message: ERROR_CATALOG.internal_error.message, hint: ERROR_CATALOG.internal_error.hint }, status: 500 }, 500);
    }
  },
};

// Named exports preserved for the test suite (test/agentic.test.mjs imports
// these directly from site/_worker.js).
export { MD_ROUTES, PRODUCIBLE_PAGE_TYPES, parseAccept, negotiatePageVariant, varyWithAccept } from './content.mjs';
export { openApiSpec, specToYaml } from './openapi.mjs';