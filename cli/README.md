# triumph-praxis

Official CLI for the [Triumph API](https://trytriumph.de5.net/developers) — the free Praxis 5001
(Elementary Education: Multiple Subjects) practice-question bank.

```bash
# no install needed
npx triumph-praxis random --subtest 5003 --count 3

# or install globally
npm install -g triumph-praxis
triumph-praxis subtests
```

## What you get

- **969 original practice questions** across the four Praxis 5001 subtests (5002 reading, 5003 math, 5004 social studies, 5005 science), each with options, the correct answer, and an explanation.
- **Bank statistics** per subtest and content category.
- **Study-guide index** with HTML and markdown URLs.
- **Free scoped API keys** (`meta:read`, `questions:read`, `stats:read`) created self-serve.

## Commands

| Command | Description |
| --- | --- |
| `health` | Service health check |
| `subtests` | Subtests, categories and question counts |
| `stats` | Raw per-category statistics (JSON) |
| `questions [--subtest] [--category] [--search] [--limit] [--offset]` | Browse the bank |
| `random [--count] [--subtest] [--category]` | Draw random questions |
| `guides` | List study guides (HTML + markdown URLs) |
| `key new [--email] [--scope ...]` | Create a free scoped API key (shown once) |
| `key verify --key KEY` | Verify a key and list its scopes |
| `spec` | Print the OpenAPI document URL |

Global flags: `--json` (raw output), `--api URL` (base override), `--key KEY` (`X-API-Key` header).

## For AI agents

The same surface is available without a CLI:

- REST: `GET https://trytriumph.de5.net/api/v1/questions/random?count=5` (anonymous)
- MCP server (Streamable HTTP): `https://trytriumph.de5.net/mcp`
- OpenAPI 3.1: <https://trytriumph.de5.net/openapi.json>
- Agent skills: <https://trytriumph.de5.net/.well-known/agent-skills/index.json>
- Every content page serves `text/markdown` on `Accept: text/markdown`

## Legal

Triumph is an independent study tool, not affiliated with or endorsed by ETS. Praxis is a trademark
of ETS. All questions are original work aligned to the published blueprint; no official test items are
reproduced. License: MIT.
