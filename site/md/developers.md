<!-- Markdown variant of https://learndiag.com/developers — request any page with Accept: text/markdown -->

*Developers · Learndiag API v1*

# The Praxis 5001 question bank, as an API.

969 original practice questions across four subtests, bank statistics, and study-guide metadata — free, documented, and machine-readable. All read endpoints work anonymously; no account or key is needed to start.

## Quickstart: anonymous GET in 60 seconds

One read endpoint with no credentials. Copy this into a terminal:

`curl "https://learndiag.com/api/v1/questions/random?count=3&subtest=5003"`

That returns three random original math questions as JSON. Health check: `GET /api/v1/health`. Full reference: `/openapi.json` (OpenAPI 3.1) or `/api/openapi.yaml`.

## What the response looks like

Here is the shape of the two question endpoints. Field-by-field notes follow.

`{ "ok": true, "count": 3, "total_pool": 172, "items": [ { "id": "5003-099", "subtest_code": "5003", "subtest": "Mathematics", "category": "Algebraic Thinking", "question": "What is the difference between an expression and an equation?", "options": [ "An expression is a combination of terms; an equation states two expressions are equal", "Equations have variables; expressions don't", "They are the same", "Expressions have equals signs" ], "answer_index": 0, "answer_text": "An expression is a combination of terms; an equation states two expressions are equal", "explanation": "Expression: 3x + 2. Equation: 3x + 2 = 11. The equals sign distinguishes them." } ] }`

Field notes:

- `answer_index` is **zero-based**: `0` is the first option, `3` the fourth.
- `answer_text` mirrors `options[answer_index]` — a convenience field so you do not have to index into the array.
- `subtest_code` is the numeric exam code (`5002`…`5005`); `subtest` is the human-readable name.
- `category` matches the official content category (e.g. `Algebraic Thinking`).
- `total_pool` is the number of questions in the filtered pool from which the random draw was taken (after filters, before `count`).
- `explanation` is written for the learner, not for a grader — it is safe to surface directly.

`GET /api/v1/questions` returns the same item shape inside a `{"ok":true,"items":[...],"total":N}` envelope for the full bank (paginated, see below).

## Filtering and pagination

| Endpoint | Filters | Pagination |
| --- | --- | --- |
| `GET /api/v1/questions` | `subtest`, `category`, `search` | `limit` (1–100, default 20), `offset` |
| `GET /api/v1/questions/random` | `count` (1–50, default 3), `subtest`, `category` | none — draw is random |
| `GET /api/v1/stats` | none | none |

Examples:

`# first 20 science questions curl "https://learndiag.com/api/v1/questions?subtest=5005" # 10 reading questions from the "Reading" category curl "https://learndiag.com/api/v1/questions?subtest=5002&category=Reading&limit=10" # 5 random social-studies questions curl "https://learndiag.com/api/v1/questions/random?count=5&subtest=5004"`

`search` matches a plain text substring across question text; it does not do fuzzy or stemming matching.

## Authentication and scoped API keys (optional)

**Anonymous access is allowed on all read endpoints.** There is one catch in the documentation: the OpenAPI spec lists `ApiKeyAuth` as the security for the read operations even though the implementation also accepts anonymous requests. Both work; the spec is stricter than real behavior. We are aligning the spec to express "anonymous or key" explicitly — until that ships, treat the spec's `security` as a description of what a key grants, not as a statement that anonymous is blocked.

If you want attribution and higher limits later, create a free scoped key — self-serve, no signup:

`curl -X POST https://learndiag.com/api/v1/keys \ -H "Content-Type: application/json" \ -d '{"email":"you@example.com","scopes":["questions:read","stats:read"]}'`

The key (`tri_live_…`) is returned once; store it. Send it as the `X-API-Key` header. Scope enforcement is real: a key without `stats:read` gets a structured `forbidden_scope` error from `/api/v1/stats`. Validate a key with `GET /api/v1/keys/verify`.

| Scope | Grants access to |
| --- | --- |
| `meta:read` | `GET /api/v1/meta` — subtest metadata and doc links |
| `questions:read` | `GET /api/v1/questions`, `GET /api/v1/questions/random` |
| `stats:read` | `GET /api/v1/stats` — per-category counts |

**Keys are not a frontend secret.** If you call the API from a browser, the key is visible to anyone who opens dev tools. Use a key only from a server, or rely on anonymous access from the browser. CORS is fully open (`Access-Control-Allow-Origin: *`), so browser calls work anonymously today.

## Rate limits

| Row | Anonymous | With API key |
| --- | --- | --- |
| Key creation (`POST /api/v1/keys`) | — | 10/hour per IP (enforced) |
| Read endpoints | No fixed public number today — documented here once a number exists | Higher than anonymous; exact numbers follow the same policy |
| 429 response | `HTTP 429` with the standard error envelope; message says limits reset hourly |  |
| Retry-After | Not currently set on 429 responses — a gap we are closing |  |

This table is intentionally conservative: the only number we can point to in the code today is the 10/hour/IP key-creation limit. Read-side limits exist at the edge but are not exposed as a number in the implementation, so we are not inventing one for the docs.

## Error format

Application-level API errors use one JSON envelope — never an HTML page:

`{ "error": { "code": "invalid_email", "message": "The email address is not valid.", "hint": "Provide a valid email address such as you@example.com." }, "status": 400 }`

Errors you are likely to hit: `invalid_api_key` (401), `forbidden_scope` (403, with `details` listing the required and present scopes), `invalid_email` (400), and `too_many_requests` (429). One caveat: this envelope covers application-layer errors. A CDN, proxy, or upstream failure can return a different body — treat "every error is this JSON" as true for the API code, not for the whole edge stack.

## MCP server (Model Context Protocol)

Agents can call Learndiag over MCP Streamable HTTP at `https://learndiag.com/mcp`. The server negotiates protocol versions `2025-06-18` (latest) and `2025-03-26`, and supports session IDs via the `Mcp-Session-Id` header.

Minimal client handshake (HTTP):

`POST https://learndiag.com/mcp Content-Type: application/json Mcp-Protocol-Version: 2025-06-18 {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1.0"}}} # then {"jsonrpc":"2.0","id":2,"method":"tools/list"}`

Tools: `list_subtests`, `get_questions`, `get_random_questions`, `get_bank_stats`, `list_study_guides` — all read-only, anonymous. Client config examples: Claude Desktop uses `{"mcpServers":{"learndiag":{"url":"https://learndiag.com/mcp"}}}`; curl-based tools typically send `Accept: application/json, text/event-stream` and handle SSE if the server streams. Manifests for agent discovery: `/.well-known/mcp/manifest.json` and `/.well-known/mcp-manifest.json`.

## Agent integration extras

- **Markdown negotiation:** send `Accept: text/markdown` on a page in the MD route list and you get clean markdown with `Vary: Accept`. The route list is explicit — it covers the main content and state pages but not every URL ending in `.html` (some paths return HTML-only). Direct links: `/md/<page>.md`.
- **llms.txt:**`/llms.txt` — site map for LLMs including a when-to-use guide.
- **Agent skills:**`/.well-known/agent-skills/index.json` — SKILL.md instruction files for fetching questions, quizzing, and finding guides.
- **CLI (npm):**`triumph-praxis` — `npx triumph-praxis random --subtest 5004 --count 5`. Package source ships in the repository under `cli/`.

## Endpoints

| Method & path | Purpose | Auth |
| --- | --- | --- |
| `GET /api/v1/health` | Uptime probe + endpoint index | Anonymous |
| `GET /api/v1/meta` | Subtest names, categories, counts, doc links | Anonymous or `meta:read` |
| `GET /api/v1/stats` | Question counts per subtest/category | Anonymous or `stats:read` |
| `GET /api/v1/questions` | Paginated bank — filters: `subtest`, `category`, `search`; `limit` ≤ 100, `offset` | Anonymous or `questions:read` |
| `GET /api/v1/questions/random` | Random draw — `count` ≤ 50 | Anonymous or `questions:read` |
| `POST /api/v1/keys` | Create scoped API key (rate limit: 10/hour/IP) | Anonymous |
| `GET /api/v1/keys/verify` | Validate a key, list its scopes | Key |

Account endpoints used by the web app (`/api/register`, `/api/login`, `/api/verify`, `/api/state`…) are documented in the same OpenAPI file and use JWT bearer tokens.

## Documentation links

- **OpenAPI JSON:**[/openapi.json](https://learndiag.com/openapi.json) (3.1, served from the same object as the YAML)
- **OpenAPI YAML:**[/api/openapi.yaml](https://learndiag.com/api/openapi.yaml)
- **MCP manifest:**[/.well-known/mcp/manifest.json](https://learndiag.com/.well-known/mcp/manifest.json) and [/.well-known/mcp-manifest.json](https://learndiag.com/.well-known/mcp-manifest.json)
- **Site map for LLMs:**[/llms.txt](https://learndiag.com/llms.txt)
- **Agent skills:**[/.well-known/agent-skills/index.json](https://learndiag.com/.well-known/agent-skills/index.json)
- **CLI package:**`triumph-praxis` on npm; source in `cli/`

Version and change tracking are separate from the docs above: the API version is emitted by `/api/v1/health`, the OpenAPI file carries its own `info.version`, and substantive changes should be reflected in the changelog note on this page rather than a rolling date.

## Licensing and attribution

All questions and explanations are original to Learndiag (not recycled official ETS items) and are provided through this API for programmatic use. What that covers, concretely:

- **Allowed:** fetching questions and explanations for study apps, practice tools, and internal use; displaying them with attribution.
- **Condition:** include a credit line such as "Questions from Learndiag (learndiag.com)" where the content is displayed or redistributed.
- **Not allowed:** republishing or reselling the question bank, or using it to build a competing test-prep product. Terms section 6 restricts redistribution that competes with the service; section 7 permits the API exception under its own terms; section 8 points back here for the specifics.
- **Removal and corrections:** if you find a wrong question or explanation, email **abc15531888397@gmail.com** with subject "API" and the question ID — content corrections are handled directly, and a removal request is honored through the normal privacy process (see [privacy policy](https://learndiag.com/privacy)).

"Free to surface" is not the whole license. The bullet list above is the readable version of the contractual language in the [terms of service](https://learndiag.com/terms); if the two ever seem to conflict, the Terms govern.

## Status & support

Uptime probe: [/api/v1/health](https://learndiag.com/api/v1/health). Questions, bug reports, or rate-limit increases: email **abc15531888397@gmail.com** with subject "API" — see [contact page](https://learndiag.com/contact). For integration questions that are not API-specific, the [contact page](https://learndiag.com/contact) also routes to the right channel.
