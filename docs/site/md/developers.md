<!-- Markdown variant of https://learndiag.com/developers — request any page with Accept: text/markdown -->

*Developers · Learndiag API v1*

# The Praxis 5001 question bank, as an API.

969 original practice questions across four subtests, bank statistics, and study-guide metadata — free, documented, and machine-readable. No account needed to start.

## Quickstart

Every read endpoint works anonymously. Try it:

`curl "https://learndiag.com/api/v1/questions/random?count=3&subtest=5003"`

That returns three random original math questions with options, correct answers, and explanations as JSON. Health check: `GET /api/v1/health`. Full reference: `/openapi.json` (OpenAPI 3.1) or `/api/openapi.yaml`.

## Sandbox & base URL

**Base URL:** `https://learndiag.com`. The public read API doubles as a sandbox: it is live data with anonymous access, so you can prototype without provisioning anything. There is no separate staging host.

## Authentication & scoped permissions

All reads work anonymously (public tier). For attribution and higher limits, create a **free scoped API key** — self-serve, no signup:

`curl -X POST https://learndiag.com/api/v1/keys \ -H "Content-Type: application/json" \ -d '{"email":"you@example.com","scopes":["questions:read","stats:read"]}'`

The key (`tri_live_…`) is shown once; send it as `X-API-Key`. Scope enforcement is real: a key without `stats:read` receives a structured `forbidden_scope` error from `/api/v1/stats`. Verify any key with `GET /api/v1/keys/verify`.

| Scope | Grants access to |
| --- | --- |
| `meta:read` | `GET /api/v1/meta` — subtest metadata and doc links |
| `questions:read` | `GET /api/v1/questions`, `GET /api/v1/questions/random` |
| `stats:read` | `GET /api/v1/stats` — per-category counts |

## Endpoints

| Method & path | Purpose |
| --- | --- |
| `GET /api/v1/health` | Uptime probe + endpoint index |
| `GET /api/v1/meta` | Subtest names, categories, counts, doc links |
| `GET /api/v1/stats` | Question counts per subtest/category |
| `GET /api/v1/questions` | Paginated bank — filters: `subtest`, `category`, `search`; `limit` ≤ 100, `offset` |
| `GET /api/v1/questions/random` | Random draw — `count` ≤ 50 |
| `POST /api/v1/keys` | Create scoped API key (rate limit: 10/hour/IP) |
| `GET /api/v1/keys/verify` | Validate a key, list its scopes |

Account endpoints used by the web app (`/api/register`, `/api/login`, `/api/verify`, `/api/state`…) are documented in the same OpenAPI file and use JWT bearer tokens.

## Error format

Every non-2xx response is structured JSON — never an HTML page:

`{ "error": { "code": "invalid_email", "message": "The email address is not valid.", "hint": "Provide a valid email address such as you@example.com." }, "status": 400 }`

## MCP server (Model Context Protocol)

Agents can call Learndiag natively over MCP Streamable HTTP:

`POST https://learndiag.com/mcp Content-Type: application/json {"jsonrpc":"2.0","id":1,"method":"tools/list"}`

Tools: `list_subtests`, `get_questions`, `get_random_questions`, `get_bank_stats`, `list_study_guides` — all read-only, no auth. Manifests: `/.well-known/mcp/manifest.json` and `/.well-known/mcp-manifest.json`.

## Agent integration extras

- **Markdown negotiation:** send `Accept: text/markdown` on any content page (e.g. this one or any study guide) and you get clean markdown with `Vary: Accept` handled. Direct links: `/md/<page>.md`.
- **llms.txt:**`/llms.txt` — site map for LLMs including a when-to-use guide.
- **Agent skills:**`/.well-known/agent-skills/index.json` — SKILL.md instruction files for fetching questions, quizzing, and finding guides.
- **CLI (npm):**`triumph-praxis` — `npx triumph-praxis random --subtest 5004 --count 5`. Package source ships in the repository under `cli/`.

## Status & support

Uptime probe: [/api/v1/health](https://learndiag.com/api/v1/health). Questions, bug reports, or rate-limit increases: email **abc15531888397@gmail.com** with subject "API" — see [contact page](https://learndiag.com/contact). Content licensing: all questions are original and free to surface with attribution to learndiag.com.
