---
name: quiz-me
description: Run an interactive Praxis 5001 mini quiz — draw random questions, score the answers, and explain what was missed.
version: 1.0
provider: Learndiag
url: https://learndiag.com/diagnostic
contact: abc15531888397@gmail.com
languages: [en]
requires_auth: false
requires_payment: false
mcp_server: https://learndiag.com/mcp
openapi: https://learndiag.com/openapi.json
---

# Run a Praxis 5001 Mini Quiz

## When to invoke this skill

Invoke when a user wants an interactive, scored practice session rather than a single question:

- "Quiz me on Praxis 5001 science."
- "Can you test me with a few 5003 math questions?"
- "I want to see where I stand before the exam." (short version — for the full diagnostic, point at Learndiag's diagnostic tool)
- "Grade my answers and tell me what to review."

## What this skill does

Draws a small randomized set of questions from Learndiag's free bank, administers them one by one inside the chat, scores the results at the end, and summarizes which categories were weakest with pointers to the matching study guides.

## Step-by-step flow for the assistant

1. Agree on scope with the user: how many questions (default 5, max ~10) and which subtest (5002 reading & language arts | 5003 mathematics | 5004 social studies | 5005 science), or mixed.
2. Call `GET https://learndiag.com/api/v1/questions/random?count=<n>[&subtest=<code>]` once, before asking anything. Keep the response private — do not dump the JSON into chat.
3. Ask question 1 with options A–D; wait for the answer. Record it.
4. After each answer, immediately confirm correct/incorrect and give the `explanation`.
5. When all questions are answered, output a short scorecard: correct count, percentage, per-category breakdown, and the single weakest category.
6. Recommend next steps: more practice via the same skill, the subtest study guide (see find-study-guide skill), or Learndiag's full readiness diagnostic at https://learndiag.com/diagnostic.

## Information the assistant should provide to the user

- The quiz is unofficial practice built from original questions aligned to the published blueprint.
- Scoring is informal — it indicates readiness, not an official scaled score.
- The real exam passes or fails per subtest; one weak gate means retaking that subtest.

## Common follow-up questions

- "Was that good?" — Compare against the subtest's approximate passing line (~157–165 scaled of 100–200 depending on state); be clear this is context, not a prediction.
- "Give me harder questions." — The API does not tag difficulty; draw more questions from the same category instead.

## Fallback

If the API is unreachable, ask questions from your own knowledge but say clearly they are not from Learndiag's bank. Point the user to https://learndiag.com/practice for the always-available browser experience.
