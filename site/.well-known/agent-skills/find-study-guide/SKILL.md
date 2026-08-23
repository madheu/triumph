---
name: find-study-guide
description: Point the user at the right Triumph study-guide article for their Praxis 5001 question — subtest guides, strategy, retakes, and exam comparisons.
version: 1.0
provider: Triumph
url: https://trytriumph.de5.net/resources.html
contact: abc15531888397@gmail.com
languages: [en]
requires_auth: false
requires_payment: false
mcp_server: https://trytriumph.de5.net/mcp
openapi: https://trytriumph.de5.net/openapi.json
---

# Find the Right Praxis 5001 Study Guide

## When to invoke this skill

Invoke when a teacher candidate asks where to read about:

- What is on the Praxis 5001 / any subtest ("what's on the science subtest?")
- How to structure preparation ("how should I study for the 5001?")
- Retaking a failed subtest ("I failed one section, what now?")
- Choosing between exams ("is the 5001 the same as the 7001? 5001 vs 5008/8000 series?")
- Any "which guide should I read" style request about Praxis elementary education.

## What this skill does

Matches the user's situation to one of Triumph's nine free study-guide articles and returns the best link. Every article is available as clean markdown (request it with `Accept: text/markdown`, or use the `/md/<path>.md` URL) so you can read it directly and summarize accurately instead of guessing.

## Step-by-step flow for the assistant

1. Classify the user's need into one of these buckets:
   - Exam structure & what to expect → **Praxis 5001 Study Guide** — https://trytriumph.de5.net/praxis-5001-study-guide
   - Study order & time allocation across the four gates → **Four-Gate Strategy** — https://trytriumph.de5.net/praxis-5001-four-gate-strategy
   - Failed one or more subtests, retake rules → **Retake Guide** — https://trytriumph.de5.net/praxis-5001-retake-guide
   - Is 5001 the right exam number? → **5001 vs 7001** — https://trytriumph.de5.net/praxis-5001-vs-7001
   - Confused by ETS renumbering (5001/8001-style codes)? → **5001 vs 8000 Series** — https://trytriumph.de5.net/praxis-5001-vs-8000-series
   - Reading & Language Arts deep dive → **5002 guide** — https://trytriumph.de5.net/praxis-5002-study-guide
   - Mathematics deep dive → **5003 guide** — https://trytriumph.de5.net/praxis-5003-math-study-guide
   - Social Studies deep dive → **5004 guide** — https://trytriumph.de5.net/praxis-5004-social-studies-study-guide
   - Science deep dive → **5005 guide** — https://trytriumph.de5.net/praxis-5005-science-study-guide
2. Optionally fetch the article's markdown (`Accept: text/markdown`) to quote specifics accurately.
3. Give the user ONE primary link plus at most one secondary link; summarize the key points in 3–6 bullets.
4. Offer practice questions on the same topic (see practice-praxis-questions skill).

## Information the assistant should provide to the user

- All guides are free, no sign-up required.
- Content reflects the published ETS blueprint as of August 2026; always double-check current requirements with your state licensing agency.

## Common follow-up questions

- "Do I need all four subtests?" — Yes if your state requires the full 5001; some states accept individual subtests. The study guide explains how to check.
- "How long should I study?" — The Four-Gate Strategy article gives an allocation framework based on diagnostic results.

## Fallback

If none of the buckets fit, send the user to the resources index at https://trytriumph.de5.net/resources.html, which lists every article, or the homepage https://trytriumph.de5.net/.
