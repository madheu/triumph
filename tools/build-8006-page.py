#!/usr/bin/env python3
# tools/build-8006-page.py — generate site/praxis-8006-teaching-reading.html
# from the D6 content draft (drafts/2026-09-03-praxis-8006-teaching-reading.md).
#
# Why a generator: the FAQPage JSON-LD must match the visible FAQ **verbatim**
# (Google requirement), and dateModified must track "Last verified". Owning both
# in one data structure makes the drift impossible instead of merely unlikely.
#
# Run: python tools/build-8006-page.py   (idempotent, overwrites the HTML only)
import json, re
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / 'site'
TEMPLATE = SITE / 'praxis-5001-vs-8000-series.html'
OUT = SITE / 'praxis-8006-teaching-reading.html'

PAGE_URL = 'https://learndiag.com/praxis-8006-teaching-reading'
HUB_URL = 'https://learndiag.com/praxis-elementary-education-fundamentals'
HERO_IMAGE = 'https://learndiag.com/images/praxis-8006-teaching-reading.png'
TITLE = 'Praxis 8006 Teaching Reading: Format, Content & Practice'
H1 = 'Praxis 8006 Teaching Reading: What the Test Covers and How to Prepare'
LAST_VERIFIED = '2026-09-03'
META_DESC = ('Praxis 8006 explained: 100 min, 80 questions, three content categories, '
             'state adoption notes, and a free 30-question practice test. Not affiliated with ETS.')
assert len(META_DESC) <= 158, f'meta description too long: {len(META_DESC)}'

# FAQ — single source of truth for body text AND FAQPage JSON-LD.
FAQ = [
    ('What is Praxis 8006?',
     'Praxis 8006 is Elementary Education Fundamentals: Teaching Reading, a 100-minute, 80-question '
     'selected-response exam on reading instruction. It replaces Praxis 7002[1][4].'),
    ('Is Praxis 8006 the same as Praxis 7002?',
     'No. 7002 is the previous teaching reading test; 8006 is its replacement in the redesigned '
     'Elementary Education Fundamentals family. Both are 80 selected-response questions[4].'),
    ('Which states require Praxis 8006?',
     'We have confirmed that West Virginia and Arkansas do not use Praxis 8006 — West Virginia uses '
     'Praxis 5205 instead[2][3]. Adoption status in the other 48 states is not verified, and we do not '
     'publish unverified adoption claims. Check https://praxis.ets.org/state-requirements/<yourstate>-tests.html '
     'before registering. Note: test code 8006 is also used by Pennsylvania\u2019s PECT Module 1 (Child '
     'Development), which is a completely different test from a different vendor. If you are testing in '
     'Pennsylvania, confirm you are looking at the Praxis code, not the PECT code.'),
    ('What is the passing score for Praxis 8006?',
     'There is no national passing score. Each state sets its own qualifying score. Verified 8000-series '
     'qualifying scores range from 126 to 152[2][3][6]. Your state\u2019s ETS requirements page is the '
     'authoritative source.'),
    ('Can I take the content categories separately?',
     'Praxis Steps, which allows category-level testing and retaking, becomes available for 8006 in '
     '2027[1]. Until then, Praxis 8006 is taken as a single test.'),
    ('How do I know if I should take 8006 or 5205?',
     'Both are teaching reading exams. Praxis 5205 (Teaching Reading: Elementary) is the test West '
     'Virginia uses[2]. The test you need depends entirely on what your state or program requires. '
     'Confirm the code before registering — do not assume based on the subject name.'),
    ('When are scores released?',
     'Score reporting for the Elementary Education Fundamentals tests began 2026-04-17[5]. Check the '
     'official test page for the current score release schedule for your test date, as reporting dates '
     'are specific to each administration window[1].'),
    ('When should I retake the test?',
     'ETS sets retake waiting periods by test; check the official page for the current policy[1]. '
     'Retaking after a short interval rarely changes the outcome unless your preparation changes. '
     'Identify the weakest content category from your score report and target it.'),
    ('Is this free practice test official?',
     'No. Learndiag is an independent study tool, not affiliated with ETS. Practice questions are '
     'original, written to the official content category definitions published by ETS, and are not '
     'official ETS test items[1].'),
]

faq_jsonld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    'mainEntity': [
        {
            '@type': 'Question',
            'name': q,
            'acceptedAnswer': {'@type': 'Answer', 'text': a},
        } for q, a in FAQ
    ],
}

article_jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': H1,
    'image': [HERO_IMAGE],
    'datePublished': LAST_VERIFIED,
    'dateModified': LAST_VERIFIED,  # must stay in sync with "Last verified" in body
    'author': {'@type': 'Organization', 'name': 'Learndiag', 'url': 'https://learndiag.com'},
    'publisher': {'@id': 'https://learndiag.com/#organization'},
    'mainEntityOfPage': {'@type': 'WebPage', '@id': PAGE_URL},
    'about': {'@type': 'Thing', 'name': 'Praxis Elementary Education Fundamentals: Teaching Reading (8006)'},
}

breadcrumb_jsonld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
        # Every level except the last must carry "item", or Search Console flags
        # "Missing field item". The old "Exam Updates" level had no page behind it
        # (/exam-updates 404) — it was a category label, not a navigable level,
        # so it is gone. The 8000 series hub has been live since 2026-09.
        {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://learndiag.com/'},
        {'@type': 'ListItem', 'position': 2, 'name': 'Praxis 8000 Series', 'item': HUB_URL},
        {'@type': 'ListItem', 'position': 3, 'name': 'Praxis 8006 Teaching Reading', 'item': PAGE_URL},
    ],
}


def faq_html():
    out = []
    for q, a in FAQ:
        a_html = a.replace('<yourstate>', '&lt;yourstate&gt;')
        out.append(f'<h3>{q}</h3>\n<p>{a_html}</p>')
    return '\n'.join(out)


GLANCE_ROWS = [
    ('Test code', '8006'),
    ('Official name', 'Elementary Education Fundamentals: Teaching Reading'),
    ('Test length', '100 minutes'),
    ('Questions', '80 selected-response'),
    ('Content categories', 'Foundational Literacy Skills (32) \u00b7 Fluency and Vocabulary (24) \u00b7 Comprehension and Written Expression (24)[4][5]'),
    ('Teaching scenario items', 'Approximately 10\u201315% (Tasks of Teaching)[5]'),
    ('Calculator', 'Not applicable'),
    ('Test fee', '$79.00[1]'),
    ('Score scale', '100\u2013200[6]'),
    ('Qualifying score', 'Set by your state or program — there is no national passing score[2][3]'),
    ('First administration', '2026-03-09[5]'),
    ('Praxis Steps availability', '2027 for 8006[1]'),
    ('Replaces', 'Praxis 7002 (Teaching Reading, 80 questions)[4]'),
]
glance_html = '\n'.join(f'<tr><td><strong>{k}</strong></td><td>{v}</td></tr>' for k, v in GLANCE_ROWS)

SOURCES_ROWS = [
    ('1', 'ETS official test page, Praxis 8006', 'https://praxis.ets.org/test/8006.html', LAST_VERIFIED),
    ('2', 'ETS state requirements, West Virginia', 'https://praxis.ets.org/state-requirements/westvirginia-tests.html', LAST_VERIFIED),
    ('3', 'ETS state requirements, Arkansas', 'https://praxis.ets.org/state-requirements/arkansas-tests.html', LAST_VERIFIED),
    ('4', 'ETS, <em>The new Praxis Elementary Education Fundamentals tests</em> (V5, \u00a9 2025), pp. 2\u20134 — replacement mapping and content categories',
     'No public URL. Partner-distributed publication. Archived copy: docs/sources/ets-elementary-education-fundamentals-brochure-V5-2025.pdf', LAST_VERIFIED),
    ('5', 'Learndiag official facts library, 8000 series', 'docs/official-facts-8000-series.md (itself sourced to 1, 2, 3, 4)', LAST_VERIFIED),
    ('6', 'ETS score scale for the 8000 series', 'See notes below', LAST_VERIFIED),
    ('7', 'National Reading Panel, <em>Teaching Children to Read</em> (2000) — five components of reading instruction',
     'Public-domain U.S. government report. Referenced by ETS source 4; the five components themselves are general professional knowledge, <strong>not</strong> an ETS specification.', LAST_VERIFIED),
]
sources_html = '\n'.join(
    f'<tr><td>{n}</td><td>{s}</td><td>{"<a href=\"" + l + "\" target=\"_blank\" rel=\"noopener\">link</a>" if l.startswith("http") else l}</td><td>{d}</td></tr>'
    for n, s, l, d in SOURCES_ROWS)

ARTICLE = f'''
<article class="wrap">
  <nav class="eyebrow" aria-label="Breadcrumb">
    <a href="/" style="color:inherit">Home</a><span aria-hidden="true"> \u00b7 </span><a href="/praxis-elementary-education-fundamentals" style="color:inherit">Praxis 8000 Series</a><span aria-hidden="true"> \u00b7 </span><span aria-current="page">Praxis 8006 Teaching Reading</span>
  </nav>
  <h1>{H1}</h1>
  <div class="meta-line">{LAST_VERIFIED} \u00b7 Last verified {LAST_VERIFIED} \u00b7 Reading time: about 9 min</div>

  <div class="ld8-disclaimer">
    <strong>Test requirements vary by state, preparation program, and effective date. Confirm your required
    test code with your state licensing agency or educator preparation program before registering.</strong>
  </div>

  <figure>
    <img src="/images/praxis-8006-teaching-reading.webp" alt="An open book reduced to two flat pages meeting at a straight spine, with concentric arcs spreading outward across both pages." width="1200" height="630" loading="eager" fetchpriority="high" decoding="async">
    <figcaption>Praxis 8006 measures whether you can teach reading, not whether you can read.</figcaption>
  </figure>

  <p><strong>Praxis 8006</strong> — officially <em>Elementary Education Fundamentals: Teaching Reading</em> — is the
  reading instruction exam in ETS\u2019s redesigned Elementary Education Fundamentals family. It is a 100-minute,
  80-question selected-response test that replaces Praxis 7002 (Teaching Reading)[4]. Unlike the four core subject
  tests in the 8000 series, Praxis 8006 is a specialized reading pedagogy exam: it measures whether you can
  <em>teach</em> reading, not whether you can read.</p>

  <p>This page explains what the test covers, who it is for, how it is structured, and how to confirm whether it is
  the test you should register for. It also includes a free 30-question practice mini test with explanations.</p>

  <p><strong>Learndiag is an independent study tool. It is not affiliated with, endorsed by, or sponsored by ETS.
  Praxis is a registered trademark of ETS.</strong></p>

  <h2>Praxis 8006 at a Glance</h2>
  <div class="table-scroll"><table>{glance_html}</table></div>
  <p class="meta-line">Sources are listed at the bottom of this page.</p>

  <h2>Is Praxis 8006 the Right Test for You?</h2>
  <p>This is the most important question on this page, and it is not one we can answer for you.</p>
  <p>Praxis 8006 is a reading specialization test. Candidates who need it are typically in one of these situations:</p>
  <ul>
    <li>Their state requires a separate teaching reading exam for elementary licensure, and has adopted 8006 for that purpose.</li>
    <li>Their educator preparation program requires a reading instruction exam as a program completion or exit requirement.</li>
    <li>They are pursuing a reading specialist or reading endorsement pathway that names a teaching reading test.</li>
  </ul>
  <p><strong>What we can verify, and what we cannot.</strong></p>
  <p>We have verified the adoption status of Praxis 8006 in two states. In both, the answer is that 8006 is <strong>not</strong> the test used:</p>
  <div class="table-scroll"><table>
    <tr><th>State</th><th>Status of Praxis 8006</th><th>What is used instead</th></tr>
    <tr><td>West Virginia</td><td>Not adopted</td><td>Praxis 5205, Teaching Reading: Elementary ($156, qualifying score 159)[2]</td></tr>
    <tr><td>Arkansas</td><td>Not adopted</td><td>Not listed on the state\u2019s ETS requirements page[3]</td></tr>
  </table></div>

  <figure>
    <img src="/images/praxis-8006-state-adoption.webp" alt="A wide grid of small identical squares. Two squares are pulled out of the grid, one at the top left and one at the bottom right, and a single line joins them. The rest of the grid is left empty." width="1360" height="765" loading="lazy" decoding="async">
    <figcaption>Two states verified, and neither uses Praxis 8006. The rest of the field is empty because we have not confirmed it.</figcaption>
  </figure>

  <p>For the remaining 48 states, adoption status is <strong>not verified</strong>. We do not publish adoption claims
  we have not confirmed against a state agency or ETS state requirements page, because a wrong answer here costs you
  a test fee and a testing window.</p>
  <p><strong>How to confirm your test code in about five minutes:</strong></p>
  <ol>
    <li>Open your state\u2019s ETS requirements page:
      <code>https://praxis.ets.org/state-requirements/&lt;state&gt;-tests.html</code>. (State names are written as one
      word, no hyphen — <code>westvirginia</code>, not <code>west-virginia</code>.)</li>
    <li>Search the page for <strong>Teaching Reading</strong>. Note the code and the qualifying score.</li>
    <li>If the page is ambiguous or lists both an old and a new code, contact your educator preparation program or
      state licensing agency directly and ask which code applies to your certification pathway.</li>
  </ol>
  <p>If you are unsure after both steps, do not register yet. The fee is $79.00 and retake windows are limited[1].</p>

  <h2>What Praxis 8006 Actually Tests</h2>
  <p>Praxis 8006 is built on Science of Reading principles and covers the five components of reading instruction
  identified by the National Reading Panel[5][7]. In practical terms, the test asks you to make instructional
  decisions: given a student who is struggling in a specific way, what do you teach next, and why.</p>

  <figure>
    <img src="/images/praxis-8006-five-components.webp" alt="Five flat concentric bands spreading outward from a single small green square at the lower left. Each band is larger than the one inside it, and the outermost spans most of the width." width="1360" height="765" loading="lazy" decoding="async">
    <figcaption>The five components of reading instruction identified by the National Reading Panel, expanding from foundational skills outward to comprehension.</figcaption>
  </figure>

  <p>The 80 questions are distributed across three content categories.</p>

  <h3>Foundational Literacy Skills — 32 questions (40%)</h3>
  <p>The largest category. Expect items on phonological and phonemic awareness, phonics and word study, decoding and
  encoding, and how these develop in beginning readers. This is where structured literacy approaches are most directly tested.</p>
  <p>Typical question shapes:</p>
  <ul>
    <li>Identify the phonemic awareness task a student is failing, given a description of their errors.</li>
    <li>Choose the appropriate word study sequence for a student who can decode CVC words but not blends.</li>
    <li>Distinguish between a phonological deficit and a comprehension deficit from assessment data.</li>
  </ul>

  <h3>Fluency and Vocabulary — 24 questions (30%)</h3>
  <p>Oral reading fluency, its relationship to comprehension, and vocabulary development — including morphology,
  context-based word learning, and academic language.</p>
  <p>Typical question shapes:</p>
  <ul>
    <li>Interpret a fluency assessment result and decide whether the intervention target is rate, accuracy, or prosody.</li>
    <li>Select the vocabulary instructional routine best suited to a tier-2 word.</li>
    <li>Identify which morphological element a student is failing to use.</li>
  </ul>

  <h3>Comprehension and Written Expression — 24 questions (30%)</h3>
  <p>Reading comprehension instruction, text structure, questioning strategies, and the connection between reading
  and writing.</p>
  <p>Typical question shapes:</p>
  <ul>
    <li>Choose the comprehension strategy that addresses a specific student difficulty described in a scenario.</li>
    <li>Select the text structure a passage exemplifies.</li>
    <li>Identify the writing instruction that best reinforces a reading objective.</li>
  </ul>

  <h3>Teaching scenario items (approximately 10\u201315%)</h3>
  <p>ETS notes that the Elementary Education Fundamentals tests include 10\u201315% Tasks of Teaching items[5]. These
  embed content in a classroom situation — a student sample, a brief exchange, a lesson fragment — and ask what you
  would do as the teacher. They are distributed across the three categories above, not a separate section.</p>

  <figure>
    <img src="/images/praxis-8006-instructional-decision.webp" alt="A single thin line entering from the left, meeting a small square, and splitting from that point into five parallel bands of equal width." width="1360" height="765" loading="lazy" decoding="async">
    <figcaption>A scenario item gives you one classroom situation, then asks you to choose among several defensible teaching moves.</figcaption>
  </figure>

  <p><strong>A note on what we are not telling you.</strong> ETS publishes the category names and item counts above.
  It does not publish a full public blueprint with sub-skill-level weightings for Praxis 8006. The \u201ctypical question
  shapes\u201d above are our professional reading of the category definitions, not an ETS item list. Treat them as
  orientation, not as a specification.</p>

  <h2>How Praxis 8006 Differs from Praxis 7002</h2>
  <p>Candidates who prepared for the old teaching reading test will find the content familiar. The structural change is modest:</p>
  <div class="table-scroll"><table>
    <tr><th></th><th>Praxis 7002</th><th>Praxis 8006</th></tr>
    <tr><td><strong>Questions</strong></td><td>80</td><td>80</td></tr>
    <tr><td><strong>Format</strong></td><td>Selected-response</td><td>Selected-response</td></tr>
    <tr><td><strong>Content basis</strong></td><td>Reading instruction</td><td>Science of Reading principles, National Reading Panel components[5][7]</td></tr>
    <tr><td><strong>Test family</strong></td><td>Standalone</td><td>Part of the Elementary Education Fundamentals family</td></tr>
    <tr><td><strong>Modular retakes</strong></td><td>Not available</td><td>Praxis Steps available 2027[1]</td></tr>
  </table></div>
  <p>Question count is unchanged. What changed is the test family it belongs to and the explicit grounding in Science
  of Reading — which shifts emphasis toward foundational skills and structured literacy[4][5].</p>

  <h2>Practice: Free Praxis 8006 Mini Test</h2>
  <div id="mini-test">
    <p>A <strong>30-question mini test</strong> covering all three official content categories, with a per-question
    explanation and a category-level result breakdown. It loads below \u2014 enable JavaScript to take it.</p>
    <p>Every question is original, written to the official category definitions above, and accompanied by an
    explanation. They are not official ETS items. Until the test loads, you can:</p>
    <ul>
      <li>Read the official test page for Praxis 8006 and confirm the current fee, format, and any testing window
        restrictions[1].</li>
      <li>Check whether your state has adopted 8006 using the link pattern under \u201cIs Praxis 8006 the Right Test
        for You?\u201d above.</li>
      <li>Work through the diagnostic for the 5001 series if that is the series your state currently requires:
        <a href="/diagnostic">Free Praxis 5001 diagnostic</a>.</li>
    </ul>
  </div>

  <h2>Scoring: What You Can and Cannot Predict</h2>
  <p>Praxis 8006 is scored on a 100\u2013200 scale[6]. Your qualifying score is set by your state licensing agency or
  preparation program, not by ETS and not nationally[2][3].</p>
  <p>Two claims circulate online that are wrong, and that we do not repeat:</p>
  <ul>
    <li><strong>That the 8000 series uses a 100\u2013300 scale with a 240 passing score.</strong> It does not. Verified
      qualifying scores in the 8000 series fall in the 126\u2013152 range on a 100\u2013200 scale[2][3][6].</li>
    <li><strong>That there is a single national cut score for 8006.</strong> There is not. Any page that gives you one
      number without naming a state is guessing[2][3].</li>
  </ul>
  <p>Because there is no public official conversion table from raw items to scaled score for Praxis 8006,
  <strong>we do not offer a scaled score calculator for this test.</strong> A practice percentage is a practice
  percentage. Presenting it as a predicted scaled score would be a fabrication, and it is the kind of number people
  make registration decisions on.</p>

  <figure>
    <img src="/images/praxis-8006-scoring.webp" alt="A long horizontal scale with tick marks rising steadily from left to right, stopping two thirds of the way along. One small square floats above the empty final third." width="1360" height="765" loading="lazy" decoding="async">
    <figcaption>The 100\u2013200 scale is real. The conversion from a practice percentage to a scaled score is not published, so we do not offer one.</figcaption>
  </figure>

  <h2>Frequently Asked Questions</h2>
  {faq_html()}

  <h2>Official Sources</h2>
  <p>Every factual claim above traces to one of these. Verification dates are shown because ETS updates test pages.</p>
  <div class="table-scroll"><table>
    <tr><th>#</th><th>Source</th><th>Link</th><th>Last verified</th></tr>
    {sources_html}
  </table></div>
  <p><strong>Notes on source limitations — read these before relying on the page:</strong></p>
  <ul>
    <li><strong>ETS publishes three different launch windows for the 8000 series.</strong> The V5 brochure says
      \u201cSpring 2026\u201d; another ETS PDF says \u201cSummer 2026\u201d; the official test pages say \u201cSeptember 2026\u201d
      for 8002\u20138005 and 2027 for 8006 Steps. This page uses the test-page figures, which are the most specific.
      The inconsistency is ETS\u2019s, not a transcription error.</li>
    <li><strong>Source 4 has no public URL.</strong> It is distributed to ETS educational partners. We archive our
      copy rather than cite a URL that does not exist.</li>
    <li><strong>Source 7 is not an ETS document.</strong> The National Reading Panel\u2019s five components are
      foundational reading research that ETS references; attributing them to ETS as a blueprint would be inaccurate.</li>
    <li><strong>48 states remain unverified.</strong> This is a deliberate gap, not an oversight.</li>
  </ul>

  <p class="meta-line">Last verified {LAST_VERIFIED}. If you find a factual error on this page, please
  <a href="/contact">contact us</a> — we correct errors and note the correction.</p>
</article>
'''

EXTRA_CSS = '''
.ld8-disclaimer{background:var(--bg-soft);border-left:3px solid var(--accent);padding:14px 18px;margin:14px 0 22px;font-size:14px;line-height:1.6}
article table{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}
article th,article td{border:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top;line-height:1.5}
article th{background:var(--bg-soft)}
article code{font-family:var(--mono);font-size:13px;background:var(--bg-soft);padding:2px 5px}
article figure{margin:26px 0 30px}
article figure img{display:block;width:100%;height:auto}
article figcaption{font-size:13px;color:var(--ink-soft);line-height:1.6;margin-top:9px}
#mini-test{border:1px solid var(--line);background:var(--bg);padding:22px;margin:16px 0 8px}
#mini-test .opt:hover:not(:disabled){border-color:var(--ink)}
'''

template = TEMPLATE.read_text(encoding='utf-8')
style = re.search(r'<style>.*?</style>', template, re.S).group(0)
head_pre = re.search(r'^(.*?)(?=<style>)', template, re.S).group(1)
nav = re.search(r'<header class="nav wrap">.*?</header>', template, re.S).group(0)
nav = nav.replace('Praxis 5001 \u00b7 unofficial', 'Praxis 8006 \u00b7 unofficial')

# The "8000 series hub" link was added to the live page by hand and never made it
# into the shared template. Without this, running the generator silently drops an
# internal link to the hub that the breadcrumb now points at.
if '8000 series hub' not in nav:
    note = '<span class="nav-note">Praxis 8006 \u00b7 unofficial</span>'
    hub_link = ('<a class="nav-cta" href="/praxis-elementary-education-fundamentals">'
                '8000 series hub</a>')
    nav = nav.replace(note, f'{note}\n      {hub_link}')

page = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script src="/js/theme.js?v=2"></script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{TITLE} | Learndiag</title>
  <meta name="description" content="{META_DESC}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{PAGE_URL}">
  <meta property="og:title" content="{TITLE}">
  <meta property="og:description" content="{META_DESC}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="{PAGE_URL}">
  <meta property="og:image" content="{HERO_IMAGE}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{TITLE}">
  <meta name="twitter:description" content="{META_DESC}">
  <meta name="twitter:image" content="{HERO_IMAGE}">
  <meta name="content-signal" content="ai-train=yes, search=yes, ai-input=yes">
<!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-MSR1Q1G7W9"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments)}}gtag("js",new Date),gtag("config","G-MSR1Q1G7W9");</script>

  <script type="application/ld+json">{json.dumps(article_jsonld, ensure_ascii=False)}</script>
  <script type="application/ld+json">{json.dumps(faq_jsonld, ensure_ascii=False)}</script>
  <script type="application/ld+json">{json.dumps(breadcrumb_jsonld, ensure_ascii=False)}</script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/css/theme.css?v=2">
  {style}
<style>{EXTRA_CSS}</style>
</head>
<body>
  {nav}
  {ARTICLE}
  <footer class="footer wrap">
    <p style="margin:0 0 18px"><strong>Learndiag.</strong> <em>Know where you stand.</em></p>
    <p>Learndiag is an independent study tool. Not affiliated with, endorsed by, or sponsored by ETS. Praxis is a
    trademark of ETS. Exam facts (question counts, timing, fees) reflect ETS pages as of {LAST_VERIFIED} and can
    change \u2014 confirm with ETS and your state licensing agency before registering.</p>
    <p><a href="/privacy">Privacy</a> \u00b7 <a href="/terms">Terms</a></p>
  </footer>
  <script src="/js/auth.js?v=3"></script>
  <script src="/js/logout-btn.js?v=1"></script>
  <script src="/js/tracking.js?v=1"></script>
  <script>window.LDTrack&&LDTrack.init({{testCode:"8006",page:"praxis-8006-teaching-reading"}});</script>
  <script src="/questions-8006.js"></script>
  <script src="/js/quiz-8006.js?v=1"></script>
  <script src="/js/magic-landing.js?v=1"></script>
</body>
</html>
'''

# newline='\n' is deliberate: every page in site/ is LF-only. Without it, running this
# script on Windows rewrites the whole file as CRLF and buries the real diff.
OUT.write_text(page, encoding='utf-8', newline='\n')
print(f'wrote {OUT} ({len(page)} bytes)')
print('FAQ groups:', len(FAQ))
