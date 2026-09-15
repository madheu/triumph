<!-- Markdown variant of https://learndiag.com/about — request any page with Accept: text/markdown -->

*About · Learndiag*

# An independent study tool for the four-gate exam.

**Learndiag is a free, independent study tool for the Praxis 5001 — Elementary Education: Multiple Subjects.** It exists for one reason: the 5001 is really four separately scored exams (reading, math, social studies, science), and most candidates study it like one exam. They discover which gate was weakest only after the score report arrives — at retake prices of $180 for the full 5001 (or $64 per subtest) and 28-day waits per attempt.

## What Learndiag does

Learndiag turns practice into diagnosis. Every question is tagged to an official blueprint category across the four subtests, so answers map to a per-gate readiness estimate instead of one misleading percentage. A short diagnostic produces an estimated scaled score per subtest, highlights your weakest gate, and suggests where study hours should go. The full question bank — currently **969 original questions** — is free to practice with, and progress tracking plus a pass forecast are included when you create a free account.

## How the content is made

- All practice questions are **original work**, written against the publicly published ETS Study Companion blueprints for subtests 5002–5005.
- No official, released, or "recalled" test items are reproduced anywhere on the site or in the API.
- Scoring context (passing lines, question counts, timing) reflects official ETS publications as of August 2026 — always confirm current rules with your state licensing agency.
- Every item carries a plain-language explanation, not just a correct letter.

## Independence statement

Learndiag is built and funded by a single independent developer. It is **not affiliated with, endorsed by, or sponsored by ETS**, and no licensing agency is involved in its operation. Praxis is a trademark of ETS. There are no investors shaping recommendations and no data sales funding the product; the planned subscription ($19.99/mo) covers forecasting and planning features while the question bank stays free.

## For developers and AI agents

The entire question bank and site content are available programmatically: a documented REST API ([developer portal](https://learndiag.com/developers)), an OpenAPI specification (`/openapi.json`), an MCP server at `/mcp`, markdown versions of every page via `Accept: text/markdown`, and an agent-skills registry under `/.well-known/agent-skills/index.json`.

Questions, corrections, or partnership ideas? Reach us through the [contact page](https://learndiag.com/contact).
