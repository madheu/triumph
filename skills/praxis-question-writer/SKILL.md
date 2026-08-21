---
name: praxis-question-writer
description: >
  Write original, blueprint-aligned practice questions for the Praxis 5001
  (Elementary Education: Multiple Subjects). Use when generating question
  banks, creating practice items for the Triumph study tool, or auditing
  existing questions for alignment, quality, or copyright safety. Produces
  questions in the Triumph questions.json schema (subtest, category,
  difficulty, type, explanation, source) with strict originality rules:
  never reproduce ETS items or third-party content.
---

# Praxis 5001 Question Writer

Write high-quality, ORIGINAL practice questions for the Praxis 5001. This skill
turns test blueprints into a repeatable question-generation process.

**Non-negotiable rule (copyright):** Every question you produce must be
ORIGINAL. Never reproduce, paraphrase, or "recall" ETS official test items or
third-party question banks (240 Tutoring, Mometrix, Quizlet decks, etc.).
Blueprint facts (category names, topic lists, weightings) are public facts and
may be used. Your question text, options, and explanations must be written from
scratch. Source type is always `original`.

---

## 0. Official Blueprint First (MANDATORY — do this before writing anything)

**Always generate questions against the OFFICIAL ETS Study Companion outline,
never from memory or approximation.** The exam outline is a public document;
download and read it before each new subtest batch.

**Step 0.1 — Obtain the official outline.** First check the local reference
folder; use it if present, otherwise download:

- Local (preferred, if present):
  `E:\Triumph\praxis-5001\assets\official-blueprint-5001.md` (extracted outline)
  and/or `E:\Triumph\praxis-5001\assets\StudyCompanion-5001-official.pdf`
- Download sources, in order:
  1. ETS official: `https://www.ets.org/praxis/prepare/materials/` → search
     "Elementary Education: Multiple Subjects" → download the Study Companion
     PDF (look for "5001" and its four subtests 5002/5003/5004/5005).
  2. ETS exam page: `https://parapro.ets.org/test-5001.html`
  3. Mirrors if ETS is blocked: search the web for
     "Praxis 5001 Study Companion PDF" (e.g. university-hosted copies).

  After downloading, save a copy of the PDF to
  `E:\Triumph\praxis-5001\assets\StudyCompanion-5001-official.pdf` and the
  extracted outline to `official-blueprint-5001.md` so future batches reuse them.

**Step 0.2 — Extract the blueprint.** From the Study Companion, capture for
EACH subtest (5002/5003/5004/5005):
- the exact **content category names** (Roman-numeral sections) and what each
  covers;
- the **approximate number of questions per category** (these set the weight —
  your question bank should mirror these proportions);
- the **question formats** used (e.g. selected-response, and any constructed
  response in the subtest);
- the **sample questions**' style (stem length, option structure) — to imitate
  FORMAT only, never content.

**Step 0.3 — Use the extracted blueprint, not this file's approximation.**
The category table in §1 below is a fallback approximation. When you have the
official outline, replace §1's categories with the official ones and note in
your output: `"blueprint": "official Study Companion <version>"`. If you could
not obtain the official outline, state that explicitly in the output and tag
the batch `"blueprint": "approximation"` — a human must verify before these
items ship.

---

## 1. Exam Blueprint (fallback approximation — §0 official outline takes precedence)

Praxis 5001 = four independently-scored subtests. A candidate must pass ALL four.

| Subtest | Code | Focus | Categories (align to these) |
|---|---|---|---|
| Mathematics | 5002 | Number & operations; algebra; geometry & measurement; data & probability — PLUS how to teach them | Number & Operations / Algebra / Geometry & Measurement / Data & Probability / Mathematics Pedagogy |
| Reading & Language Arts | 5003 | Phonics & word recognition; vocabulary; comprehension; writing — PLUS instruction | Phonics & Word Recognition / Vocabulary / Reading Comprehension / Writing Process / Language Pedagogy |
| Social Studies | 5004 | US history; world history; geography; economics; civics & government | US History / World History / Geography / Economics / Civics & Government |
| Science | 5005 | Life; physical; earth & space — PLUS inquiry and pedagogy | Life Science / Physical Science / Earth & Space Science / Science Inquiry & Pedagogy |

**Pedagogy questions are a Praxis signature:** a large share of items ask "how
would you TEACH this," not just "what is the answer." Always mix in pedagogy
items — they are what candidates struggle with most and what generic AI gets
wrong.

> Note: exact per-category question counts come from the official ETS Study
> Companion. If you can access it, verify category lists before a large batch;
> if not, use the categories above (they match the published structure).

---

## 2. Question Type (every question is one of these)

- `knowledge` — recall/apply a fact or procedure. *"Which of the following is a prime number?"*
- `concept` — deeper understanding, often a scenario. *"Which explanation shows genuine understanding of division of fractions?"*
- `pedagogy` — teaching decisions. *"A student confuses /b/ and /d/. Which activity is most appropriate?"*

Guideline mix per batch: ~30% knowledge, ~40% concept, ~30% pedagogy.

---

## 3. Difficulty (tag every question)

- `easy` — most prepared candidates answer correctly; single obvious step
- `medium` — requires solid knowledge or careful reading; one or two steps
- `hard` — distractor traps, integrated concepts, or subtle pedagogy judgment

Guideline distribution per batch: ~20% easy, ~50% medium, ~30% hard.

---

## 4. Writing Rules (quality bar — every item)

**Stem:**
- One clear, complete question. No trick wording, no "NOT" without emphasis.
- Classroom context is welcome for concept/pedagogy items (Praxis candidates
  are teachers; scenarios feel authentic).
- Never use "all of the above" / "none of the above".

**Options (exactly 4, A–D):**
- Exactly ONE correct answer. If an expert could argue for two, rewrite.
- Distractors are plausible and **same-family**: same topic, common student
  misconception, or a procedure gone slightly wrong — NOT absurd fillers.
- Parallel structure: similar length and grammar across options (prevents
  length-cueing the answer).
- No "always/never/every" absolute words in correct answers.

**Explanation (2–4 sentences):**
- State why the correct answer is right (the underlying principle).
- State why the top distractor is wrong (the misconception it targets).
- Written at teacher-candidate level.

**Self-check before output (every item):**
1. Is this 100% original (not from ETS/third-party)? If unsure — rewrite.
2. Does an expert agree there is exactly one correct answer?
3. Is the category from the blueprint table?
4. Could a well-prepared candidate pass it and a weak one fail it (discrimination)?

---

## 5. Output Format (exactly this JSON — matches Triumph template)

```json
{
  "version": "1.0",
  "exam": "Praxis 5001",
  "blueprint": "official Study Companion 2026 | approximation (state which)",
  "questions": [
    {
      "id": "5003-012",
      "subtest": "5003",
      "category": "Phonics & Word Recognition",
      "difficulty": "medium",
      "type": "pedagogy",
      "question": "…",
      "options": ["…", "…", "…", "…"],
      "answer_index": 0,
      "explanation": "…",
      "source": { "type": "original", "note": "generated by praxis-question-writer" }
    }
  ]
}
```

ID scheme: `<subtest>-<3-digit sequence>` (e.g. 5002-001, 5002-002…).
Sequence restarts per subtest. Validate JSON before output.

---

## 6. Batch Protocol (use for cost-effective generation)

1. **Run §0 first**: obtain the official Study Companion outline for the
   target subtest and extract categories + per-category weights before writing
   any item. Never skip this.
2. **Plan the batch**: pick one subtest + one category (or one subtest across
   categories), state the intended difficulty mix and how many items. Mirror
   the official per-category question proportions.
3. **Generate in small batches (5–10 items)** — keeps quality high and cost low.
4. **Self-audit every batch**: run each item through the section-4 self-check;
   fix any that fail before output.
5. **Flag for human review**: mark any item you are less than fully confident
   about with `"review": true` so a human can check it.
6. **Append, don't overwrite**: when extending an existing bank, keep the
   existing id sequence and only add new ids.
7. **Diversity rule**: within a category, do not reuse the same misconception
   as the distractor in more than one item per 20 generated.

---

## 7. Calibration & Continuous Improvement

- When real answer data exists (users' correct/wrong rates), adjust
  difficulty tags: items answered correctly by >85% → consider re-tagging
  `easy`; <40% → reconsider as too hard or flawed (check for ambiguity).
- Track which categories produce the most "review" flags and tighten the
  blueprint knowledge for those.

---

## 8. References

- Official outline (local, when present): `E:\Triumph\praxis-5001\assets\official-blueprint-5001.md`
- Official Study Companion PDF (local, when present): `E:\Triumph\praxis-5001\assets\StudyCompanion-5001-official.pdf`
- Triumph question template: `E:\Triumph\praxis-5001\题库数据格式模板.json`
- Exam & market research: `E:\Triumph\5001备考行为地图.md`
- Official exam page (verify blueprint when reachable): https://parapro.ets.org/test-5001.html
