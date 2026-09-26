# -*- coding: utf-8 -*-
"""build_scores_page.py — generate site/when-do-praxis-scores-come-out.html
Data tables are rendered directly from docs/sources/ets-score-date-api-20260920.json
(540 queries against ETS's official ScoreReports-ReportDateForEveryone endpoint, 2026-09-20).
CSS skeleton is lifted verbatim from site/praxis-steps.html to keep the theme identical.
"""
import json, os, re, sys
from collections import defaultdict
from datetime import date
sys.stdout.reconfigure(encoding='utf-8')

ROOT = r'E:\Triumph\praxis-5001'
SRC = os.path.join(ROOT, 'docs', 'sources', 'ets-score-date-api-20260920.json')
TPL = os.path.join(ROOT, 'site', 'praxis-steps.html')
OUT = os.path.join(ROOT, 'site', 'when-do-praxis-scores-come-out.html')
SLUG = 'when-do-praxis-scores-come-out'
DATE = '2026-09-20'
URL = f'https://learndiag.com/{SLUG}'

MONTHS = {m: i + 1 for i, m in enumerate(
    ['January', 'February', 'March', 'April', 'May', 'June', 'July',
     'August', 'September', 'October', 'November', 'December'])}

def pdate(s):
    m = re.match(r'([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})', s.strip())
    return date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2))) if m else None

def esc(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;'))

def fmt_d(d):
    return d.strftime('%B %-d, %Y') if os.name != 'nt' else d.strftime('%B ') + str(d.day) + d.strftime(', %Y')

# ---------------- data ----------------
raw = json.load(open(SRC, encoding='utf-8'))

def dated(r):
    resp = r.get('resp') or {}
    return resp.get('success') and resp.get('scoreReportDate')

sweep = [r for r in raw if r['testDate'] == '2026-09-19' and dated(r)]
center = {r['id']: r for r in sweep if r['place'] == 'center'}
home = {r['id']: r for r in sweep if r['place'] == 'home'}
both = set(center) & set(home)
identical = {k for k in both if center[k]['resp']['scoreReportDate'] == home[k]['resp']['scoreReportDate']}

buckets = defaultdict(list)
for r in sweep:
    if r['place'] != 'center':
        continue
    buckets[pdate(r['resp']['scoreReportDate'])].append(r)
for v in buckets.values():
    v.sort(key=lambda x: x['id'])

TEST_DAY = date(2026, 9, 19)
b7 = buckets[TEST_DAY + __import__('datetime').timedelta(days=7)]      # Sep 26
b20 = buckets[date(2026, 10, 9)]
b21 = buckets[date(2026, 10, 10)]
b27 = buckets[date(2026, 10, 16)]

errs = [r for r in raw if r['testDate'] == '2026-09-19' and r['place'] == 'center' and not dated(r)]
errs.sort(key=lambda x: str(x['id']))

# multi-date matrix (center)
matrix = defaultdict(dict)
for r in raw:
    if r['place'] == 'center' and dated(r) and r['testDate'] != '2026-09-19':
        matrix[r['id']][r['testDate']] = r['resp']['scoreReportDate']

def clean_name(name, tid):
    n = re.sub(r'\s*\([^)]*\)\s*$', '', name).strip()   # drop trailing (code; subtests ...)
    n = re.sub(r'\s*\(\d{4}\)$', '', n).strip()          # drop trailing (5001)
    return n

# ---------------- template css ----------------
tpl = open(TPL, encoding='utf-8').read()
m = re.search(r'(<style>\*\{box-sizing[\s\S]*?</style>)', tpl)
assert m, 'main style block not found in template'
MAIN_STYLE = m.group(1)

# ---------------- FAQ (single source for visible + JSON-LD) ----------------
FAQ = [
 ("When do Praxis scores come out?",
  "It depends on the test. In ETS&rsquo;s official score-reporting calendar tool, as we verified on "
  "2026-09-20: 45 tests &mdash; including Praxis 5001, the 8002&ndash;8005 Fundamentals tests, and Core "
  "Reading (5713) and Core Math (5733) &mdash; report 7 calendar days after your test date; 62 tests report "
  "on a fixed date about three weeks out; Core Writing (5723) reports 21 calendar days out; and 16 "
  "constructed-response&ndash;heavy tests, including the four PLT exams, report about four weeks out. ETS "
  "reports scores on Tuesdays and Fridays, moving to the next Tuesday or Friday when a holiday falls on "
  "one.[1][4]"),
 ("What time do Praxis scores come out?",
  "ETS publishes score-reporting dates but not a posting time. The only explicit clock time in the official "
  "materials &mdash; 5 p.m. ET &mdash; applied to one specific September 2026 batch for the 8002&ndash;8005 "
  "tests. Practically: check the Score Reports page in your Praxis account on your report date and watch for "
  "the ETS notification email.[1]"),
 ("How long does it take to get Praxis scores back?",
  "Anywhere from 7 calendar days (most selected-response content tests, including 5001 and the 8000-series "
  "Fundamentals tests) to about four weeks (constructed-response&ndash;heavy tests such as PLT "
  "5621&ndash;5624 and Teaching Reading 5205/5206). Core Writing (5723) shows 21 calendar days in ETS&rsquo;s "
  "tool; the 2026&ndash;27 Bulletin lists 20 business days as its outer limit. Sixteen tests &mdash; including "
  "the World Languages series, SLLA, SSA, PASL, and 8006 &mdash; returned no date in the tool; ETS says to "
  "contact customer service about those.[1][2][4]"),
 ("Do you get Praxis scores immediately after the test?",
  "If your test contains only selected-response questions, you&rsquo;ll see an unofficial score at the end of "
  "the testing session &mdash; right before you choose to report or cancel it, which cannot be undone. Tests "
  "with constructed-response questions show no unofficial score, because human raters need time. On the "
  "8002&ndash;8005 Fundamentals tests the unofficial screen shows category raw points with the Total Score "
  "displayed as &ldquo;NS&rdquo; (No Score). The official report still arrives on the published report "
  "date.[1][5]"),
 ("Why is my Praxis score report not showing up?",
  "Work the checklist in order: confirm your exact report date in the ETS tool for your test, test date, and "
  "delivery method (scores are only reported on Tuesdays and Fridays); make sure you&rsquo;re signed in to the "
  "account you registered with; check the email address ETS has on file, including spam; look at the Pending "
  "Scores card &mdash; cancelled or held tests don&rsquo;t appear there; and remember that if you took several "
  "tests the same day, the rest arrive in a second report. If your report date has passed, contact ETS "
  "customer service at 1-800-772-9476 (Mon&ndash;Fri 8 a.m.&ndash;7:45 p.m. ET, Sat 8 a.m.&ndash;4:30 p.m. "
  "ET).[1][2][3]"),
 ("Why do some Praxis tests take longer to score?",
  "Constructed-response answers are rated by people, not machines. Two trained raters score each response "
  "independently, and if their ratings disagree by more than a specified amount, a third rater steps in; on "
  "some tests ETS&rsquo;s automated c-rater engine acts as one of the two raters. That is why essay- and "
  "constructed-response&ndash;heavy tests such as Core Writing and the PLT series take weeks, while "
  "selected-response&ndash;only tests take days.[3]"),
 ("I took two Praxis tests the same day and only one score came. Is that normal?",
  "Yes. ETS states that some tests take longer to score than others, and that if not all of your scores are "
  "reported at once, you will receive the rest in a second report. Our queries of the ETS tool show same-day "
  "tests can carry different report dates &mdash; for example, 5001 and 5723 tested on the same September day "
  "report about two weeks apart.[3][4]"),
 ("Do Praxis scores expire?",
  "On ETS&rsquo;s side: scores reported on or after July 21, 2017 stay downloadable from your account for ten "
  "years from the report date, and ETS&rsquo;s score-sending services cover tests taken within the past ten "
  "years. But whether a state licensing agency or preparation program accepts an older score is up to that "
  "state or program &mdash; many set their own validity windows. Confirm with the agency before relying on an "
  "old score, and save a PDF copy of every report.[1][2]"),
 ("Where do I find my official Praxis score report?",
  "In your Praxis account, on the Score Reports page &mdash; ETS emails you when the report posts. Your scores "
  "are also sent to the up-to-four recipients you selected at registration (you can add or change recipients "
  "up to 3 days before test day; extra reports after that cost $50 each), and if you tested in an automatic "
  "score-reporting state, your scores go to that state automatically.[1][2]"),
 ("Can Praxis scores be released early?",
  "There is no official early-release channel. The unofficial score shown at the test center for "
  "selected-response&ndash;only tests is the earliest signal, and it is not the official report. ETS posts the "
  "official report on the published report date, so plan around the date rather than a clock time.[1]"),
]

def strip_refs(s):
    s = re.sub(r'\[\d+\]', '', s)
    s = s.replace('&rsquo;', '\u2019').replace('&ldquo;', '\u201c').replace('&rdquo;', '\u201d')
    s = s.replace('&mdash;', '\u2014').replace('&ndash;', '\u2013').replace('&amp;', '&')
    return s

faq_json = {"@context": "https://schema.org", "@type": "FAQPage",
            "mainEntity": [{"@type": "Question", "name": strip_refs(q),
                            "acceptedAnswer": {"@type": "Answer", "text": strip_refs(a)}}
                           for q, a in FAQ]}
article_json = {"@context": "https://schema.org", "@type": "Article",
                "headline": "When Do Praxis Scores Come Out? Every Score Release Date, Verified Against ETS's Own Tool",
                "image": [f"https://learndiag.com/images/{SLUG}.png"],
                "datePublished": DATE, "dateModified": DATE,
                "author": {"@type": "Organization", "name": "Learndiag", "url": "https://learndiag.com"},
                "publisher": {"@id": "https://learndiag.com/#organization"},
                "mainEntityOfPage": {"@type": "WebPage", "@id": URL},
                "about": {"@type": "Thing", "name": "Praxis score release dates and reporting timelines"}}
crumb_json = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://learndiag.com/"},
    {"@type": "ListItem", "position": 2, "name": "Resources", "item": "https://learndiag.com/resources"},
    {"@type": "ListItem", "position": 3, "name": "When Do Praxis Scores Come Out?", "item": URL}]}

def ld(o):
    return '  <script type="application/ld+json">' + json.dumps(o, ensure_ascii=False) + '</script>'

# ---------------- tables ----------------
def bucket_table(rows):
    out = ['<div class="table-scroll"><table class="bucket-table">',
           '<tr><th>Code</th><th>Test</th></tr>']
    for r in rows:
        out.append(f'<tr><td>{esc(r["id"])}</td><td>{esc(clean_name(r["name"], r["id"]))}</td></tr>')
    out.append('</table></div>')
    return '\n    '.join(out)

def example_rows(tid):
    rows = []
    seq = [('2026-09-19', center[tid]['resp']['scoreReportDate'] if tid in center else None)]
    for t in ['2026-09-22', '2026-09-24', '2026-09-25', '2026-10-02', '2026-10-16']:
        if t in matrix.get(tid, {}):
            seq.append((t, matrix[tid][t]))
    for t, s in seq:
        if not s:
            continue
        td = date.fromisoformat(t); sd = pdate(s)
        rows.append(f'<tr><td>{fmt_d(td)} ({td.strftime("%a")})</td><td>{fmt_d(sd)} ({sd.strftime("%a")})</td>'
                    f'<td>{(sd - td).days} days</td></tr>')
    return rows

no_date_notes = {
    '0633': 'Performance-based Braille proficiency assessment',
    '5174': 'World Languages tests include a speaking component that is scored separately',
    '5183': 'World Languages tests include a speaking component that is scored separately',
    '5195': 'World Languages tests include a speaking component that is scored separately',
    '5661': 'World Languages tests include a speaking component that is scored separately',
    '5665': 'World Languages tests include a speaking component that is scored separately',
    '5671': 'World Languages tests include a speaking component that is scored separately',
    '5641': 'Tool inconsistency: &ldquo;At Home&rdquo; returned September 26, 2026 for the same test date; &ldquo;At Center&rdquo; returned an error',
    '6412': 'State-specific administrator test (Connecticut)',
    '6990': 'Leadership assessment with constructed-response tasks',
    '6991': 'Leadership assessment with constructed-response tasks',
    'PASL': 'Performance assessment &mdash; portfolio tasks rated by trained reviewers',
    '8006': 'ETS states score reporting for the Fundamentals series began April 17, 2026; the tool had no schedule entry for 8006 as of our check',
    '56': 'Legacy listing entry (no current 4-digit code shown)',
    '60': 'Legacy listing entry (no current 4-digit code shown)',
    '70': 'Legacy listing entry (no current 4-digit code shown)',
}

err_rows = []
for r in errs:
    note = no_date_notes.get(r['id'], 'No date returned by the tool as of 2026-09-20')
    err_rows.append(f'<tr><td>{esc(r["id"])}</td><td>{esc(clean_name(r["name"], r["id"]))}</td><td>{note}</td></tr>')

# ---------------- head ----------------
TITLE = 'When Do Praxis Scores Come Out? Release Dates &amp; Timelines | Learndiag'
DESC = ("Praxis score release dates explained: the 7-day rule, Tuesday/Friday reporting, per-test "
        "timelines from ETS's own tool, and what to do if your report is late.")
assert len(DESC) <= 160, len(DESC)
OGT = 'When Do Praxis Scores Come Out? Release Dates &amp; Timelines'

HEAD = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script src="/js/theme.js?v=2"></script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{TITLE}</title>
  <meta name="description" content="{DESC}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{URL}">
  <meta property="og:title" content="{OGT}">
  <meta property="og:description" content="{DESC}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="{URL}">
  <meta property="og:image" content="https://learndiag.com/images/{SLUG}.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{OGT}">
  <meta name="twitter:description" content="{DESC}">
  <meta name="twitter:image" content="https://learndiag.com/images/{SLUG}.png">
  <meta name="content-signal" content="ai-train=yes, search=yes, ai-input=yes">
<!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-MSR1Q1G7W9"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments)}}gtag("js",new Date),gtag("config","G-MSR1Q1G7W9");</script>

{ld(article_json)}
{ld(faq_json)}
{ld(crumb_json)}

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/css/theme.css?v=2">
  {MAIN_STYLE}
<style>
.ld8-disclaimer{{background:var(--bg-soft);border-left:3px solid var(--accent);padding:14px 18px;margin:14px 0 22px;font-size:14px;line-height:1.6}}
article table{{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}}
article th,article td{{border:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top;line-height:1.5}}
article th{{background:var(--bg-soft)}}
article code{{font-family:var(--mono);font-size:13px;background:var(--bg-soft);padding:2px 5px}}
.bucket-table td:first-child{{white-space:nowrap;font-family:var(--mono);font-size:13px}}
.bucket-table{{margin-bottom:26px}}
.example-table td{{white-space:nowrap;font-family:var(--mono);font-size:13px}}
.checklist li{{margin-bottom:12px}}
</style>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
</head>
<body>
  <header class="nav wrap">
    <a class="wordmark" href="/" aria-label="Learndiag home">Learndiag<span style="color:var(--accent)">.</span></a>
    <div style="display:flex; gap:24px; align-items:baseline;">
      <span class="nav-note">Score release dates · unofficial</span>
      <a class="nav-cta" href="/">Home</a>
      <a class="nav-cta" href="/resources">Resources</a>
      <a class="nav-cta" href="/diagnostic">Free diagnostic &rarr;</a>
    </div>
  </header>
'''

# ---------------- body ----------------
def faq_html():
    out = []
    for q, a in FAQ:
        out.append(f'  <h3>{q}</h3>\n  <p>{a}</p>')
    return '\n\n'.join(out)

n7, n20, n21, n27 = len(b7), len(b20), len(b21), len(b27)
n_err = len(errs)

BODY = f'''
<article class="wrap">
  <nav class="eyebrow" aria-label="Breadcrumb">
    <a href="/" style="color:inherit">Home</a><span aria-hidden="true"> · </span><a href="/resources" style="color:inherit">Resources</a><span aria-hidden="true"> · </span><span aria-current="page">When Do Praxis Scores Come Out?</span>
  </nav>
  <h1>When Do Praxis Scores Come Out? Every Score Release Date, Verified Against ETS&rsquo;s Own Tool</h1>
  <div class="meta-line">{DATE} · Last verified {DATE} · Reading time: about 14 min</div>

  <div class="ld8-disclaimer">
    <strong>Score-reporting dates vary by test, test date, and delivery method, and ETS updates its schedule.
    Always confirm your own date with the official ETS score-reporting calendar tool and your Praxis account.
    Every timeline on this page reflects our direct queries of ETS&rsquo;s tool on 2026-09-20.</strong>
  </div>

  <p>You finished the test. Now the waiting starts &mdash; and almost nobody can tell you how long it will
  actually take, because the answer is different for almost every Praxis exam. &ldquo;Two to three weeks&rdquo;
  advice from forums is wrong for about half the test catalog.</p>

  <p>So we did what nobody else has: we queried <strong>ETS&rsquo;s own official score-reporting calendar
  tool</strong> &mdash; the same API that powers the lookup widget on ETS&rsquo;s <em>Getting Your Praxis
  Scores</em> page &mdash; for <strong>every Praxis test it lists</strong>, for both delivery methods (At Home
  and At Center), plus five extra test dates for 26 high-demand exams. That is 540 queries in total, all
  archived[4]. This page shows exactly what came back: which tests report in 7 days, which wait three or four
  weeks, which ones ETS&rsquo;s tool cannot date at all &mdash; and what to do when your report is late.</p>

  <p><strong>Learndiag is an independent study tool. It is not affiliated with, endorsed by, or sponsored by
  ETS. Praxis is a registered trademark of ETS.</strong></p>

  <h2>Praxis Score Release Dates at a Glance</h2>
  <div class="table-scroll"><table>
    <tr><th>Timeline</th><th>How it works</th><th>Who&rsquo;s in this group</th><th>Report date for a test taken Sep 19, 2026</th></tr>
    <tr><td><strong>7 calendar days</strong></td><td>Test date + 7, whatever day that is</td>
      <td>{n7} tests &mdash; Praxis 5001 and its subtests, the 8002&ndash;8005 Fundamentals tests, Core Reading (5713), Core Math (5733), most Content Knowledge exams, the PA Grades 4&ndash;8 series, ESOL (5362), Fundamental Subjects (5511)</td>
      <td>Sep 26, 2026</td></tr>
    <tr><td><strong>Fixed report date (~3 weeks)</strong></td><td>Every test date in a window lands on one shared report date</td>
      <td>{n20} tests &mdash; 5006/5026 assessment bundles, 5017/5018, math tests 5162&ndash;5165, science tests 5236/5246/5266/5436, SLP (5331), School Psychologist (5403), Educational Leadership (5412), Computer Science (5652), the old 7001 series, CKT 7811&ndash;7815</td>
      <td>Oct 9, 2026</td></tr>
    <tr><td><strong>21 calendar days</strong></td><td>Test date + 21 (the 2026&ndash;27 Bulletin&rsquo;s outer limit is &ldquo;20 business days&rdquo;)</td>
      <td>{n21} tests &mdash; Core Writing (5723), Communication &amp; Literacy: Writing (5724), Core Combined (5752)</td>
      <td>Oct 10, 2026</td></tr>
    <tr><td><strong>~4 weeks</strong></td><td>Fixed report date, longest wait in the catalog</td>
      <td>{n27} tests &mdash; all four PLT exams (5621&ndash;5624), Teaching Reading 5205/5206, Reading Specialist (5302), the Content &amp; Analysis exams (5039, 5086, 5135), Education of Young Children (5024), World Languages Pedagogy (5841)</td>
      <td>Oct 16, 2026</td></tr>
    <tr><td><strong>No date in the tool</strong></td><td>ETS says: contact customer service</td>
      <td>{n_err} listings &mdash; the six World Languages tests, SLLA (6990), SSA (6991), PASL, Braille Proficiency (0633), CT Administrator (6412), Theatre (5641, center-side only), and 8006</td>
      <td>&mdash;</td></tr>
  </table></div>
  <p>Two official rules sit on top of every date above[1]:</p>
  <ul>
    <li><strong>Praxis reports scores on Tuesdays and Fridays.</strong> If a holiday falls on a Tuesday or
      Friday, scores are reported on the following Tuesday or Friday.</li>
    <li><strong>The 7-day rule for 8002&ndash;8005 is new.</strong> Fundamentals tests or Steps taken between
      September 1&ndash;5, 2026 were reported after 5 p.m. ET on September 11, 2026; anything taken after
      September 6, 2026 reports within 7 calendar days of your test date. (Background:
      <a href="/praxis-steps">Praxis Steps and the new 7-day rule</a>.)</li>
  </ul>
  <p class="related">Sources are listed at the bottom of this page.</p>

  <h2>How ETS Decides Your Score-Reporting Date</h2>
  <p>ETS&rsquo;s official wording: &ldquo;The date you receive your score depends on which test you
  take&hellip; This date varies based on test type and delivery method (At home vs Test Center)&rdquo;[1].
  In practice, the date is set by <strong>how your test is scored</strong>:</p>
  <ol>
    <li><strong>Selected-response&ndash;only tests</strong> are machine-scored, so they report fastest &mdash;
      7 calendar days for most of them.</li>
    <li><strong>Tests with constructed-response questions</strong> wait on human raters: two scorers rate each
      response independently, and a third scorer steps in when the two ratings disagree by more than a
      specified amount. On some tests, ETS&rsquo;s automated c-rater engine serves as one of the two
      raters[3].</li>
    <li><strong>Batched reporting:</strong> most constructed-response tests do not report &ldquo;test date +
      N.&rdquo; Instead ETS collects a testing window and releases everyone&rsquo;s scores on one fixed date
      &mdash; which is why 62 tests in our sweep all land on the same Friday.</li>
  </ol>
  <p><strong>Delivery method (At Home vs At Center):</strong> ETS says the date can vary by delivery method,
  so always check the tool for your own combination. In our 2026-09-20 sweep, however, the tool returned
  <strong>identical dates for all {len(identical)} tests</strong> that it could date on both sides[4] &mdash;
  the only delivery-side difference we found was Theatre (5641), which errored on the center side but
  returned September 26, 2026 on the home side.</p>

  <h2>The Verified Timelines, Test by Test</h2>
  <p>Method, so you can judge the data yourself[4]: on 2026-09-20 we queried ETS&rsquo;s
  <code>ScoreReports-ReportDateForEveryone</code> endpoint &mdash; the API behind the official lookup tool on
  ETS&rsquo;s <em>Getting Your Praxis Scores</em> page &mdash; for every product in its
  <code>GetProductsByTestCenter</code> list (142 at-center, 138 at-home), for test date
  <strong>September 19, 2026</strong>, on both delivery sides; plus five more test dates
  (Sep 22, Sep 24, Sep 25, Oct 2, Oct 16) for 26 high-demand exams. 494 of 540 queries returned a date.
  The raw JSON is archived in our repository (<code>docs/sources/ets-score-date-api-20260920.json</code>).</p>

  <h3>Group 1 &mdash; 7 calendar days ({n7} tests)</h3>
  <p>Report date = test date + 7 days, whatever weekday that is. This group includes the tests most of our
  readers take: <strong>Praxis 5001</strong> and all four subtests (5002&ndash;5005), the new
  <strong>8002&ndash;8005 Fundamentals</strong> tests, <strong>Core Reading (5713)</strong> and
  <strong>Core Math (5733)</strong>, and the 5901 three-subject bundle. Taking 5001 on Saturday,
  September 19, 2026? The tool reports <strong>Saturday, September 26</strong> &mdash; and with ETS&rsquo;s
  Tuesday/Friday reporting note, the practical expectation is the last reporting day on or before that
  date.</p>
    {bucket_table(b7)}

  <h3>Group 2 &mdash; fixed report date, about 3 weeks ({n20} tests)</h3>
  <p>These tests report on shared dates. Every September test date we queried for Educational Leadership
  (5412), Gifted Education (5358), Computer Science (5652), Family &amp; Consumer Sciences (5123), and the
  Elementary CKT bundle (7811) lands on <strong>the same Friday, October 9, 2026</strong> &mdash; while an
  October 16 test date rolls to November 13. If you test early in the window you may wait longer than
  20 days; test late and you may wait barely two weeks.</p>
    {bucket_table(b20)}

  <h3>Group 3 &mdash; 21 calendar days: the Core Writing family ({n21} tests)</h3>
  <p>Core Writing (5723), Communication &amp; Literacy: Writing (5724), and Core Combined (5752) all report
  exactly 21 calendar days after any test date we queried. The 2026&ndash;27 Praxis Bulletin states the
  policy ceiling as &ldquo;20 business days&rdquo; for 5723[2] &mdash; the tool&rsquo;s scheduled date is
  earlier than that ceiling, so both statements hold. Essays are why: every writing sample goes through the
  two-rater (plus tie-break third rater) process[3].</p>
    {bucket_table(b21)}

  <h3>Group 4 &mdash; about 4 weeks ({n27} tests)</h3>
  <p>The longest waits in the catalog belong to the constructed-response&ndash;heaviest exams: all four
  <strong>Principles of Learning and Teaching</strong> tests (5621&ndash;5624), <strong>Teaching Reading:
  Elementary (5205)</strong> and <strong>K&ndash;12 (5206)</strong>, <strong>Reading Specialist
  (5302)</strong>, and the Content &amp; Analysis / Content &amp; Interpretation exams. A September 19 test
  date reports October 16, 2026; for English Language Arts: Content &amp; Analysis (5039), an October 16
  test date rolls all the way to November 20.</p>
    {bucket_table(b27)}

  <h3>Worked examples from the multi-date queries</h3>
  <p>Praxis 5001 (fixed gap &mdash; always test date + 7):</p>
  <div class="table-scroll"><table class="example-table">
    <tr><th>Test date</th><th>Report date (ETS tool)</th><th>Gap</th></tr>
    {''.join(example_rows('5001'))}
  </table></div>
  <p>Educational Leadership 5412 (fixed date &mdash; the window matters, not your test day):</p>
  <div class="table-scroll"><table class="example-table">
    <tr><th>Test date</th><th>Report date (ETS tool)</th><th>Gap</th></tr>
    {''.join(example_rows('5412'))}
  </table></div>

  <h3>Tests ETS&rsquo;s tool could not date ({n_err} listings)</h3>
  <p>These queries returned an error instead of a date. ETS&rsquo;s own instruction for a test that is
  missing from the tool: &ldquo;If you don&rsquo;t see your test, contact customer service&rdquo;[1].
  General inquiries: 1-800-772-9476 (U.S., U.S. Virgin Islands, Puerto Rico, Canada) or 1-609-771-7395
  (elsewhere), Mon&ndash;Fri 8 a.m.&ndash;7:45 p.m. ET, Sat 8 a.m.&ndash;4:30 p.m. ET[2].</p>
  <div class="table-scroll"><table>
    <tr><th>Code</th><th>Test</th><th>What we know</th></tr>
    {''.join(err_rows)}
  </table></div>

  <h2>Unofficial Scores: What You See on Test Day</h2>
  <p>If your test contains <strong>only selected-response questions</strong>, the testing session ends with an
  unofficial score on screen[1]. Three official caveats matter:</p>
  <ul>
    <li><strong>Report-or-cancel is irreversible.</strong> Before seeing the unofficial score you choose to
      report or cancel it. A reported score cannot be cancelled; a cancelled score cannot be reinstated, and
      you get no refund[1].</li>
    <li><strong>No unofficial score &ne; something went wrong.</strong> ETS is explicit: when a
      selected-response test doesn&rsquo;t show an unofficial score, further analysis must be conducted
      before scoring can be completed &mdash; it does NOT indicate a problem with your administration and
      will NOT delay your official score[1].</li>
    <li><strong>Constructed-response tests never show one</strong> &mdash; there is nothing machine-scored to
      show yet[1]. On the 8002&ndash;8005 Fundamentals tests, the unofficial screen shows raw points per
      category while the Total Score displays as &ldquo;NS&rdquo; (No Score)[5]. Test centers cannot print or
      email unofficial scores[1].</li>
  </ul>

  <h2>Where to Check Your Official Scores (and Your Estimated Date)</h2>
  <ul>
    <li><strong>Your Praxis account &rarr; Score Reports page.</strong> The official report posts there on the
      report date, and ETS emails you when it&rsquo;s available[1].</li>
    <li><strong>Pending Scores card.</strong> Before your report arrives, the Score Reports page shows a
      pending card with your estimated reporting date. Cancelled or held tests do not appear there[1].</li>
    <li><strong>During registration.</strong> The scheduling screen shows the estimated score-reporting date
      after you pick a test date[1] &mdash; write it down before you even sit the exam.</li>
    <li><strong>Score recipients.</strong> Up to four recipients are free at registration; you can add or
      change them until 3 days before your test date. Additional Score Reports ordered later cost $50 each
      and are processed within 5 calendar days[2]. If you tested in an automatic score-reporting state, your
      scores go to that state without any action from you[1].</li>
  </ul>

  <h2>Praxis Score Report Not Showing Up? A Step-by-Step Checklist</h2>
  <ol class="checklist">
    <li><strong>Confirm the actual report date &mdash; not a forum estimate.</strong> Use the official tool on
      ETS&rsquo;s <em>Getting Your Praxis Scores</em> page with your exact test, test date, and delivery
      method[1]. Remember: scores are only reported on <strong>Tuesdays and Fridays</strong>, pushed to the
      next Tue/Fri when a holiday intervenes[1].</li>
    <li><strong>Check you&rsquo;re in the right account.</strong> The report posts to the Praxis account you
      registered with. If you have multiple ETS accounts (common for people who also took TOEFL or GRE),
      sign in to the right one.</li>
    <li><strong>Check the email ETS has on file</strong> &mdash; including spam/promotions folders. The
      &ldquo;your scores are available&rdquo; notification is the trigger to look[1].</li>
    <li><strong>Look at the Pending Scores card.</strong> If your test isn&rsquo;t listed as pending, ETS
      notes that cancelled or held tests won&rsquo;t show up there[1] &mdash; a held score needs customer
      service.</li>
    <li><strong>Took multiple tests the same day?</strong> Scores are staggered: the rest arrive in a second
      report[3]. Different tests genuinely have different dates &mdash; 5001 and 5723 taken on the same day
      report about two weeks apart[4].</li>
    <li><strong>Didn&rsquo;t get an unofficial score at the test center?</strong> That alone is not a delay
      signal &mdash; ETS says it does not indicate a problem and does not delay the official score[1].</li>
    <li><strong>Report date passed and still nothing? Contact ETS.</strong> 1-800-772-9476 (U.S./Canada) or
      1-609-771-7395 (elsewhere), Mon&ndash;Fri 8 a.m.&ndash;7:45 p.m. ET, Sat 8 a.m.&ndash;4:30 p.m.
      ET[2]. Have your candidate ID, test date, and date of birth ready.</li>
  </ol>

  <h2>Why Some Praxis Tests Take Weeks to Score</h2>
  <p>ETS&rsquo;s own scorer guidance explains the spread[3]: constructed-response questions are rated by
  education professionals in the content area, carefully trained and supervised. <strong>Two scorers rate
  each response independently</strong> &mdash; neither sees the other&rsquo;s rating &mdash; and if the two
  ratings disagree by more than a specified amount, <strong>a third scorer</strong> rates the response. Under
  no circumstances does a total score depend entirely on one individual scorer. For some tests, the automated
  <strong>c-rater</strong> engine (trained on thousands of previously scored essays) acts as one of the two
  raters. Additional statistical checks account for difficulty differences across test editions. All of that
  takes calendar time &mdash; which is exactly why Group 1 (machine-scored) reports in a week and Group 4
  (rater-heavy) reports in four.</p>

  <h2>Do Praxis Scores Expire?</h2>
  <p>Two different clocks are running, and candidates constantly mix them up:</p>
  <ul>
    <li><strong>ETS&rsquo;s clock &mdash; 10 years.</strong> Scores reported on or after July 21, 2017 stay
      downloadable from your account for <strong>ten years from the report date</strong>; ETS recommends
      saving a copy for your files[1]. ETS&rsquo;s score-sending and scoring services are available only for
      tests taken within the past 10 years[2]. (Scores reported before July 21, 2017 require ordering an
      Additional Score Report[1].)</li>
    <li><strong>Your state&rsquo;s or program&rsquo;s clock &mdash; whatever they set.</strong> Licensing
      agencies and preparation programs decide how old a score they accept for certification, and many impose
      their own validity windows. ETS keeping your score for a decade says nothing about whether your state
      will honor a five-year-old report. Check with the agency before you rely on an old score &mdash; and if
      it has expired where it matters, our <a href="/praxis-5001-retake-guide">retake guide</a> covers the
      28-day waiting rule and how to make the second attempt count.</li>
  </ul>

  <h2>Frequently Asked Questions</h2>
{faq_html()}

  <h2>Official Sources</h2>
  <div class="sources">
    <p>Every factual claim above traces to one of these. Verification dates are shown because ETS updates its
    pages and schedules.</p>
    <div class="table-scroll"><table>
      <tr><th>#</th><th>Source</th><th>Link</th><th>Last verified</th></tr>
      <tr><td>1</td><td>ETS official page: <em>Getting Your Praxis Scores</em> &mdash; report-date rules, the score-reporting calendar tool, Tuesday/Friday reporting note, unofficial-score policy, report-or-cancel rules, pending-scores card, 10-year download window</td><td><a href="https://praxis.ets.org/test-taker/getting-scores.html" target="_blank" rel="noopener">getting-scores.html</a> (local archive: <code>docs/sources/ets-getting-scores-20260920.html</code>)</td><td>2026-09-20</td></tr>
      <tr><td>2</td><td>ETS, <em>The Praxis Bulletin 2026&ndash;27</em> (PDF) &mdash; Core 5713/5733 &ldquo;7 calendar days&rdquo; and 5723 &ldquo;20 business days&rdquo; limits, recipient rules and 3-day change deadline, ASR $50 / 5-calendar-day processing, 10-year service window, customer-service numbers and hours</td><td><a href="https://praxis.ets.org/on/demandware.static/-/Library-Sites-ets-praxisLibrary/default/dwd1ed07a0/pdfs/praxis-information-bulletin.pdf" target="_blank" rel="noopener">praxis-information-bulletin.pdf</a> (local archive: <code>docs/sources/ets-praxis-information-bulletin-2627.pdf</code>)</td><td>2026-09-20</td></tr>
      <tr><td>3</td><td>ETS, <em>Understanding Your Praxis Scores 2025&ndash;26</em> (PDF) &mdash; two independent raters plus third-rater tie-break, c-rater, staggered second reports, statistical checks across editions</td><td><a href="https://praxis.ets.org/on/demandware.static/-/Library-Sites-ets-praxisLibrary/default/dwf807334a/pdfs/understanding-your-scores-25-26.pdf" target="_blank" rel="noopener">understanding-your-scores-25-26.pdf</a> (local archive: <code>docs/sources/ets-understanding-your-scores-2526-full.txt</code>)</td><td>2026-09-20</td></tr>
      <tr><td>4</td><td><strong>Our own queries of the ETS score-reporting calendar API</strong> (<code>ScoreReports-ReportDateForEveryone</code> + <code>ScoreReports-GetProductsByTestCenter</code>, the endpoints behind the tool on source [1]) &mdash; 540 queries on 2026-09-20: every listed product for test date 2026-09-19 on both delivery sides, plus 5 additional test dates for 26 high-demand exams</td><td>Raw JSON archived at <code>docs/sources/ets-score-date-api-20260920.json</code></td><td>2026-09-20</td></tr>
      <tr><td>5</td><td>ETS official FAQ for Teacher Candidates: <em>Praxis Steps FAQ</em> &mdash; &ldquo;NS&rdquo; total score on the 8002&ndash;8005 unofficial screen</td><td><a href="https://praxis.ets.org/on/demandware.static/-/Library-Sites-ets-praxisLibrary/default/pdfs/praxis-steps-test-taker-faq.pdf" target="_blank" rel="noopener">praxis-steps-test-taker-faq.pdf</a></td><td>2026-09-14</td></tr>
    </table></div>

    <p><strong>Notes on source limitations &mdash; read these before relying on the page:</strong></p>
    <ul>
      <li><strong>The tool returns ETS&rsquo;s current schedule, and schedules move.</strong> Every date here
        was true at 2026-09-20 for the test dates we queried. Always re-run the official tool for your own
        test, date, and delivery method.</li>
      <li><strong>Fixed-date behavior was verified on multiple dates for six tests</strong> (5039, 5123,
        5358, 5412, 5652, 7811) plus the +7 and +21 groups; the other Group 2/4 members were verified for
        one test date (Sep 19, 2026) and may follow a different window schedule for other test dates.</li>
      <li><strong>Tool dates vs the Tuesday/Friday note.</strong> Some tool dates fall on Saturdays
        (Sep 26, Oct 10). We read the tool date as the outer boundary and Tue/Fri as the actual posting days;
        ETS publishes no posting time of day.</li>
      <li><strong>The 16 no-date listings are the tool&rsquo;s behavior at check time</strong> &mdash; not an
        ETS statement that those tests lack reporting schedules. 8006 in particular may be added later;
        ETS&rsquo;s 8006 page says Fundamentals reporting began April 17, 2026
        (see our <a href="/praxis-8006-teaching-reading">8006 guide</a>).</li>
      <li><strong>The Bulletin&rsquo;s &ldquo;20 business days&rdquo; for 5723 and the tool&rsquo;s 21
        calendar days are both correct</strong> &mdash; the Bulletin states a ceiling; the tool states the
        scheduled date, which sits inside that ceiling.</li>
    </ul>
  </div>

  <div class="related"><p>Related: <a href="/praxis-steps">Praxis Steps and the new 7-day score rule</a> &middot; <a href="/score-calculator">Raw-to-scaled score calculator</a> &middot; <a href="/praxis-5001-passing-score-by-state">Passing scores by state</a> &middot; <a href="/praxis-5001-retake-guide">Retake guide</a> &middot; <a href="/praxis-8006-teaching-reading">Praxis 8006 Teaching Reading</a></p></div>

  <p class="meta-line">Last verified 2026-09-20. If you find a factual error on this page, please
  <a href="/contact">contact us</a> &mdash; we correct errors and note the correction.</p>
</article>

  <footer class="footer wrap">
    <p style="margin:0 0 18px"><strong>Learndiag.</strong> <em>Know where you stand.</em></p>
    <p>Learndiag is an independent study tool. Not affiliated with, endorsed by, or sponsored by ETS. Praxis is a
    trademark of ETS. Exam facts (report dates, fees, policies) reflect ETS pages and ETS&rsquo;s own
    reporting-calendar tool as of 2026-09-20 and can change &mdash; confirm with ETS and your state licensing
    agency before relying on them.</p>
    <p><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a></p>
  </footer>
  <script src="/js/auth.js?v=3"></script>
  <script src="/js/logout-btn.js?v=1"></script>
  <script src="/js/tracking.js?v=1"></script>
  <script>window.LDTrack&&LDTrack.init({{page:"{SLUG}"}});</script>
</body>
</html>
'''

html = HEAD + BODY
open(OUT, 'w', encoding='utf-8', newline='\n').write(html)
print(f"wrote {OUT}  ({len(html):,} bytes)")
print(f"buckets: 7d={n7}  ~3wk={n20}  21d={n21}  ~4wk={n27}  nodate={n_err}")
print(f"both-side dated={len(both)} identical={len(identical)}")
