// worker-src/apicatalog.mjs — RFC 9727 "api-catalog" discovery.
//
// Publishes the API catalog document at /.well-known/api-catalog in the
// Linkset format (RFC 9264), served as application/linkset+json with the
// RFC 9727 profile parameter, and builds the RFC 8288 Link header that the
// homepage response advertises so agents can discover machine-readable
// resources from one request:
//   api-catalog  → this catalog (RFC 9727 §3)
//   service-desc → /openapi.json     machine-readable OpenAPI 3.1 (RFC 8631)
//   service-doc  → /developers       human-readable developer portal (RFC 8631)
//   describedby  → /llms.txt         site description for agents (RFC 6839)
//
// Every relation target in DISCOVERY_LINK_HEADER also appears inside
// apiCatalogDocument, so the header and the catalog cannot drift apart.

import { BASE } from './constants.mjs';
import { withCors } from './http.mjs';

export const API_CATALOG_PATH = '/.well-known/api-catalog';

export const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

// RFC 9264 Linkset document in the RFC 9727 Appendix A.1 shape: one element
// per API, each carrying its service-desc / service-doc / status links.
export const apiCatalogDocument = {
  linkset: [
    {
      anchor: `${BASE}/api/v1/`,
      'service-desc': [
        { href: `${BASE}/openapi.json`, type: 'application/json' },
        { href: `${BASE}/api/openapi.yaml`, type: 'application/yaml' },
      ],
      'service-doc': [{ href: `${BASE}/developers`, type: 'text/html' }],
      status: [{ href: `${BASE}/api/v1/health`, type: 'application/json' }],
      describedby: [{ href: `${BASE}/auth.md`, type: 'text/markdown' }],
    },
    {
      anchor: `${BASE}/mcp`,
      'service-desc': [{ href: `${BASE}/.well-known/mcp/manifest.json`, type: 'application/json' }],
      'service-doc': [{ href: `${BASE}/developers`, type: 'text/html' }],
    },
  ],
};

// RFC 8288 Link header for the homepage. Targets are relative so they resolve
// against whatever host serves the page (canonical domain or pages.dev
// mirror), and use the pretty URL for the developer portal — the Pages asset
// layer 308s /developers.html to /developers, so the pretty form is the one
// that resolves without a redirect hop. One comma-joined value; RFC 9727 §3
// also allows separate Link headers per relation.
export const DISCOVERY_LINK_HEADER = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</openapi.json>; rel="service-desc"; type="application/json"',
  '</developers>; rel="service-doc"; type="text/html"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
].join(', ');

function headVariant(res) {
  return new Response(null, { status: res.status, headers: res.headers });
}

// Serves the catalog document. RFC 9727 §2: HEAD requests to
// /.well-known/api-catalog SHALL include a Link header carrying the
// api-catalog relation — it is set on GET too so a single request suffices.
export function hApiCatalog(request) {
  const body = JSON.stringify(apiCatalogDocument, null, 2) + '\n';
  const res = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': API_CATALOG_CONTENT_TYPE,
      'Cache-Control': 'public, max-age=3600',
      Link: DISCOVERY_LINK_HEADER,
    },
  });
  return request.method === 'HEAD' ? headVariant(withCors(res)) : withCors(res);
}
