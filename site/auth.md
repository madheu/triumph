# Learndiag auth.md

> How software agents authenticate with **Learndiag** — the free Praxis 5001 (Elementary Education: Multiple Subjects) readiness tool at `https://learndiag.com`. This document is self-contained; the two JSON discovery files below repeat the same facts in machine-readable form.

- Protected Resource Metadata (RFC 9728): `https://learndiag.com/.well-known/oauth-protected-resource`
- Authorization Server Metadata: `https://learndiag.com/.well-known/oauth-authorization-server`

## Agent audience

Learndiag serves **read-only, non-sensitive public content**: a 969-question Praxis 5001 practice bank, bank statistics, and study guides. No private user data is exposed to agents, so authentication exists for **attribution and abuse accounting** — not for access control.

Two agent audiences are supported:

1. **Anonymous agents** — call the public API or MCP server with no credential at all. Read access is granted implicitly.
2. **Attributed agents** — create a free self-serve API key so usage is attributable and the client presents as a first-class caller.

The MCP server (`https://learndiag.com/mcp`, Streamable HTTP, JSON-RPC 2.0) is read-only and requires **no authentication**.

## Registration methods

### Method 1 — anonymous self-serve API key (recommended for agents)

- **Identity required:** none (anonymous registration)
- **Registration endpoint:** `POST https://learndiag.com/api/v1/keys`
- **Credential issued:** `api_key` — shown once in the response; store it immediately
- **Rate limit:** 10 key creations per IP per hour

Request:

```json
{
  "scopes": ["meta:read", "questions:read", "stats:read"],
  "email": "owner@your-domain.example"
}
```

`email` is optional; when present it is stored only as a truncated SHA-256 hash for abuse accounting. Omitting the body or `scopes` defaults to all three free scopes.

Response (`201`):

```json
{
  "ok": true,
  "key": "tri_live_<40 hex characters>",
  "scopes": ["meta:read", "questions:read", "stats:read"],
  "tier": "free",
  "note": "Store this key now — it is shown once. Send it as the X-API-Key header."
}
```

Verify a key later with `GET https://learndiag.com/api/v1/keys/verify` (send the key as `X-API-Key`).

### Method 2 — verified email account (user-scoped endpoints only)

Only needed for user-scoped endpoints that store study state (`GET/PUT /api/state`, `GET /api/me`). Not needed for the public read API or MCP.

- **Identity assertion:** `verified_email` — a 6-digit code is emailed to the address and must be claimed within 15 minutes
- **Register:** `POST https://learndiag.com/api/register` with `{ "email": "...", "password": "at-least-8-characters" }`
- **Claim:** `POST https://learndiag.com/api/verify` with `{ "email": "...", "code": "123456" }`
- **Sign in again later:** `POST https://learndiag.com/api/login` with the same credentials
- **Resend code:** `POST https://learndiag.com/api/resend` with `{ "email": "..." }`
- **Credential issued:** `jwt` — returned as `token` in the verify/login response; expires after 30 days (sign in again to renew)

## Credential use

| Credential | Where to send it | Grants access to |
| --- | --- | --- |
| `api_key` (`tri_live_…`) | `X-API-Key: <your-key>` request header | `/api/v1/stats`, `/api/v1/questions`, `/api/v1/questions/random` (scope-checked) |
| `jwt` | `Authorization: Bearer <token>` request header | `/api/me`, `GET/PUT /api/state` (user-scoped study state) |

Anonymous requests without any credential still receive read access to the `/api/v1` data endpoints — an API key raises the client to an attributable, first-class tier.

## Scopes

Free-tier keys are granted all three supported scopes; request them explicitly or accept the default:

- `meta:read` — product and subtest metadata (`GET /api/v1/meta`, `GET /api/v1/health`)
- `questions:read` — question bank reads (`GET /api/v1/questions`, `GET /api/v1/questions/random`)
- `stats:read` — bank statistics (`GET /api/v1/stats`)

## What does not apply to agents

- **No OAuth 2.0 dance.** The service publishes Protected Resource and Authorization Server metadata for discovery, but does not operate OAuth 2.0 authorization or token endpoints. The `agent_auth` block in the authorization server metadata is the operative registration instruction — use the self-serve methods above, not client-credentials or authorization-code flows.
- **No `POST /agent/auth` endpoint.** Registration happens only at the documented endpoints above.
- **Google sign-in is for humans.** The browser Google OAuth flow is part of the web app UI and cannot be completed by an agent.
- **No paid tier for agents.** The API key tier is free; the same read access applies to everyone.

## Reference

- OpenAPI 3.1 spec: `https://learndiag.com/openapi.json` (YAML at `/api/openapi.yaml`)
- Developer portal: `https://learndiag.com/developers`
- Agent skills index: `https://learndiag.com/.well-known/agent-skills/index.json`
- MCP manifest: `https://learndiag.com/.well-known/mcp/manifest.json`
- Questions: `https://learndiag.com/contact`
