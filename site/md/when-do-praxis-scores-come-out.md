<!-- Markdown variant of https://learndiag.com/when-do-praxis-scores-come-out — request any page with Accept: text/markdown -->

*[Home](https://learndiag.com/) · [Resources](https://learndiag.com/resources) · When Do Praxis Scores Come Out?*

# When Do Praxis Scores Come Out? Every Score Release Date, Verified Against ETS’s Own Tool

*2026-09-20 · Last verified 2026-09-20 · Reading time: about 14 min*

**Score-reporting dates vary by test, test date, and delivery method, and ETS updates its schedule. Always confirm your own date with the official ETS score-reporting calendar tool and your Praxis account. Every timeline on this page reflects our direct queries of ETS’s tool on 2026-09-20.**

You finished the test. Now the waiting starts — and almost nobody can tell you how long it will actually take, because the answer is different for almost every Praxis exam. “Two to three weeks” advice from forums is wrong for about half the test catalog.

So we did what nobody else has: we queried **ETS’s own official score-reporting calendar tool** — the same API that powers the lookup widget on ETS’s *Getting Your Praxis Scores* page — for **every Praxis test it lists**, for both delivery methods (At Home and At Center), plus five extra test dates for 26 high-demand exams. That is 540 queries in total, all archived[4]. This page shows exactly what came back: which tests report in 7 days, which wait three or four weeks, which ones ETS’s tool cannot date at all — and what to do when your report is late.

**Learndiag is an independent study tool. It is not affiliated with, endorsed by, or sponsored by ETS. Praxis is a registered trademark of ETS.**

## Praxis Score Release Dates at a Glance

| Timeline | How it works | Who’s in this group | Report date for a test taken Sep 19, 2026 |
| --- | --- | --- | --- |
| **7 calendar days** | Test date + 7, whatever day that is | 45 tests — Praxis 5001 and its subtests, the 8002–8005 Fundamentals tests, Core Reading (5713), Core Math (5733), most Content Knowledge exams, the PA Grades 4–8 series, ESOL (5362), Fundamental Subjects (5511) | Sep 26, 2026 |
| **Fixed report date (~3 weeks)** | Every test date in a window lands on one shared report date | 62 tests — 5006/5026 assessment bundles, 5017/5018, math tests 5162–5165, science tests 5236/5246/5266/5436, SLP (5331), School Psychologist (5403), Educational Leadership (5412), Computer Science (5652), the old 7001 series, CKT 7811–7815 | Oct 9, 2026 |
| **21 calendar days** | Test date + 21 (the 2026–27 Bulletin’s outer limit is “20 business days”) | 3 tests — Core Writing (5723), Communication & Literacy: Writing (5724), Core Combined (5752) | Oct 10, 2026 |
| **~4 weeks** | Fixed report date, longest wait in the catalog | 16 tests — all four PLT exams (5621–5624), Teaching Reading 5205/5206, Reading Specialist (5302), the Content & Analysis exams (5039, 5086, 5135), Education of Young Children (5024), World Languages Pedagogy (5841) | Oct 16, 2026 |
| **No date in the tool** | ETS says: contact customer service | 16 listings — the six World Languages tests, SLLA (6990), SSA (6991), PASL, Braille Proficiency (0633), CT Administrator (6412), Theatre (5641, center-side only), and 8006 | — |

Two official rules sit on top of every date above[1]:

- **Praxis reports scores on Tuesdays and Fridays.** If a holiday falls on a Tuesday or Friday, scores are reported on the following Tuesday or Friday.
- **The 7-day rule for 8002–8005 is new.** Fundamentals tests or Steps taken between September 1–5, 2026 were reported after 5 p.m. ET on September 11, 2026; anything taken after September 6, 2026 reports within 7 calendar days of your test date. (Background: [Praxis Steps and the new 7-day rule](https://learndiag.com/praxis-steps).)

Sources are listed at the bottom of this page.

## How ETS Decides Your Score-Reporting Date

ETS’s official wording: “The date you receive your score depends on which test you take… This date varies based on test type and delivery method (At home vs Test Center)”[1]. In practice, the date is set by **how your test is scored**:

1. **Selected-response–only tests** are machine-scored, so they report fastest — 7 calendar days for most of them.
2. **Tests with constructed-response questions** wait on human raters: two scorers rate each response independently, and a third scorer steps in when the two ratings disagree by more than a specified amount. On some tests, ETS’s automated c-rater engine serves as one of the two raters[3].
3. **Batched reporting:** most constructed-response tests do not report “test date + N.” Instead ETS collects a testing window and releases everyone’s scores on one fixed date — which is why 62 tests in our sweep all land on the same Friday.

**Delivery method (At Home vs At Center):** ETS says the date can vary by delivery method, so always check the tool for your own combination. In our 2026-09-20 sweep, however, the tool returned **identical dates for all 126 tests** that it could date on both sides[4] — the only delivery-side difference we found was Theatre (5641), which errored on the center side but returned September 26, 2026 on the home side.

## The Verified Timelines, Test by Test

Method, so you can judge the data yourself[4]: on 2026-09-20 we queried ETS’s `ScoreReports-ReportDateForEveryone` endpoint — the API behind the official lookup tool on ETS’s *Getting Your Praxis Scores* page — for every product in its `GetProductsByTestCenter` list (142 at-center, 138 at-home), for test date **September 19, 2026**, on both delivery sides; plus five more test dates (Sep 22, Sep 24, Sep 25, Oct 2, Oct 16) for 26 high-demand exams. 494 of 540 queries returned a date. The raw JSON is archived in our repository (`docs/sources/ets-score-date-api-20260920.json`).

### Group 1 — 7 calendar days (45 tests)

Report date = test date + 7 days, whatever weekday that is. This group includes the tests most of our readers take: **Praxis 5001** and all four subtests (5002–5005), the new **8002–8005 Fundamentals** tests, **Core Reading (5713)** and **Core Math (5733)**, and the 5901 three-subject bundle. Taking 5001 on Saturday, September 19, 2026? The tool reports **Saturday, September 26** — and with ETS’s Tuesday/Friday reporting note, the practical expectation is the last reporting day on or before that date.

| Code | Test |
| --- | --- |
| 5001 | Elementary Education: Multiple Subjects |
| 5002 | Elementary Education: Reading and Language Arts Subtest |
| 5003 | Elementary Education: Mathematics Subtest |
| 5004 | Elementary Education: Social Studies Subtest |
| 5005 | Elementary Education: Science Subtest |
| 5025 | Early Childhood Education |
| 5038 | English Language Arts: Content Knowledge |
| 5087 | Citizenship Education: Content Knowledge |
| 5091 | Physical Education: Content Knowledge |
| 5101 | Business Education: Content Knowledge |
| 5113 | Music: Content Knowledge |
| 5134 | Art: Content Knowledge |
| 5152 | Pennsylvania Grades 4-8 Core Assessment: Pedagogy, English Language Arts and Social Studies, Mathematics and Science |
| 5153 | Pennsylvania Grades 4-8 Core Assessment: Pedagogy |
| 5154 | Pennsylvania Grades 4-8 Core Assessment: English Language Arts and Social Studies |
| 5155 | Pennsylvania Grades 4-8 Core Assessment: Mathematics and Science |
| 5156 | Pennsylvania Grades 4-8 Subject Concentration: English Language Arts |
| 5157 | Pennsylvania Grades 4-8 Subject Concentration: Social Studies |
| 5158 | Pennsylvania Grades 4-8 Subject Concentration: Mathematics |
| 5159 | Pennsylvania Grades 4-8 Subject Concentration: Science |
| 5221 | Speech Communication: Content Knowledge |
| 5272 | Special Education: Education of Deaf and Hard of Hearing Students |
| 5282 | Special Education: Teaching Students with Visual Impairments |
| 5322 | Special Education: Teaching Students with Intellectual Disabilities |
| 5362 | English to Speakers of Other Languages |
| 5383 | Special Education: Teaching Students with Learning Disabilities |
| 5391 | Psychology |
| 5511 | Fundamental Subjects: Content Knowledge |
| 5601 | Latin |
| 5713 | Core Academic Skills For Educators: Reading |
| 5714 | Communication and Literacy: Reading |
| 5733 | Core Academic Skills For Educators: Mathematics |
| 5753 | Communication and Literacy Combined |
| 5857 | Health and Physical Education: Content Knowledge |
| 5881 | Special Education: Teaching Speech to Students with Language Impairments |
| 5901 | Elementary Education: Three Subject Bundle—Mathematics, Social Studies and Science |
| 5903 | Elementary Education: Three Subject Bundle—Mathematics |
| 5904 | Elementary Education: Three Subject Bundle—Social Studies |
| 5905 | Elementary Education: Three Subject Bundle—Science |
| 5941 | World and U.S. History: Content Knowledge |
| 5952 | Sociology |
| 8002 | Elementary Education Fundamentals: Reading and Language Arts |
| 8003 | Elementary Education Fundamentals: Mathematics |
| 8004 | Elementary Education Fundamentals: Social Studies |
| 8005 | Elementary Education Fundamentals: Science |

### Group 2 — fixed report date, about 3 weeks (62 tests)

These tests report on shared dates. Every September test date we queried for Educational Leadership (5412), Gifted Education (5358), Computer Science (5652), Family & Consumer Sciences (5123), and the Elementary CKT bundle (7811) lands on **the same Friday, October 9, 2026** — while an October 16 test date rolls to November 13. If you test early in the window you may wait longer than 20 days; test late and you may wait barely two weeks.

| Code | Test |
| --- | --- |
| 5006 | Elementary Education Assessment |
| 5007 | Elementary Education Assessment: Reading and Language Arts & Social Studies |
| 5008 | Elementary Education Assessment: Mathematics and Science |
| 5017 | Elementary Education: Curriculum, Instruction, and Assessment |
| 5018 | Elementary Education: Content Knowledge |
| 5023 | Interdisciplinary Early Childhood Education |
| 5026 | Early Childhood Assessment |
| 5027 | Early Childhood: Reading and Language Arts & Social Studies |
| 5028 | Early Childhood: Mathematics and Science |
| 5036 | STEM for the Elementary Grades |
| 5037 | Elementary Education: Math Specialist |
| 5052 | Health Occupations |
| 5053 | Technology and Engineering Education |
| 5115 | Music: Instrumental and General Knowledge |
| 5116 | Music: Vocal and General Knowledge |
| 5123 | Family and Consumer Sciences |
| 5162 | Algebra I |
| 5163 | Geometry |
| 5164 | Middle School Mathematics |
| 5165 | Mathematics |
| 5222 | Speech and Theatre |
| 5224 | Journalism |
| 5236 | Biology |
| 5246 | Chemistry |
| 5266 | Physics |
| 5312 | School Librarian |
| 5331 | Speech-Language Pathology |
| 5343 | Audiology |
| 5355 | Special Education: Foundational Knowledge |
| 5358 | Gifted Education |
| 5372 | Special Education: Teaching Students with Behavioral Disorders and Emotional Disturbances |
| 5403 | School Psychologist |
| 5412 | Educational Leadership: Administration and Supervision |
| 5422 | School Counselor |
| 5436 | General Science |
| 5442 | Middle School Science |
| 5485 | Physical Science |
| 5533 | Early Childhood Education: Foundational Knowledge |
| 5534 | Early Childhood Education: Foundational Knowledge and Content |
| 5547 | Special Education: Severe to Profound |
| 5551 | Health Education |
| 5561 | Marketing Education |
| 5572 | Earth and Space Sciences |
| 5581 | Social Studies |
| 5589 | Middle School Social Studies |
| 5625 | Principles of Learning and Teaching (PLT): PreK–12 |
| 5652 | Computer Science |
| 5692 | Special Education: Early Childhood/Early Intervention |
| 5701 | Agriculture |
| 5911 | Economics |
| 5921 | Geography |
| 5931 | Government/Political Science |
| 7001 | Elementary Education: Multiple Subjects |
| 7002 | Elementary Education: Teaching Reading |
| 7003 | Elementary Education: Mathematics |
| 7004 | Elementary Education: Social Studies |
| 7005 | Elementary Education: Science |
| 7811 | Elementary Education: Content Knowledge for Teaching |
| 7812 | Elementary Education: Reading and Language Arts CKT |
| 7813 | Elementary Education: Mathematics CKT |
| 7814 | Elementary Education: Science—CKT |
| 7815 | Elementary Education: Social Studies—CKT |

### Group 3 — 21 calendar days: the Core Writing family (3 tests)

Core Writing (5723), Communication & Literacy: Writing (5724), and Core Combined (5752) all report exactly 21 calendar days after any test date we queried. The 2026–27 Praxis Bulletin states the policy ceiling as “20 business days” for 5723[2] — the tool’s scheduled date is earlier than that ceiling, so both statements hold. Essays are why: every writing sample goes through the two-rater (plus tie-break third rater) process[3].

| Code | Test |
| --- | --- |
| 5723 | Core Academic Skills For Educators: Writing |
| 5724 | Communication and Literacy: Writing |
| 5752 | Core Combined |

### Group 4 — about 4 weeks (16 tests)

The longest waits in the catalog belong to the constructed-response–heaviest exams: all four **Principles of Learning and Teaching** tests (5621–5624), **Teaching Reading: Elementary (5205)** and **K–12 (5206)**, **Reading Specialist (5302)**, and the Content & Analysis / Content & Interpretation exams. A September 19 test date reports October 16, 2026; for English Language Arts: Content & Analysis (5039), an October 16 test date rolls all the way to November 20.

| Code | Test |
| --- | --- |
| 5024 | Education of Young Children |
| 5039 | English Language Arts: Content and Analysis |
| 5047 | Middle School English Language Arts |
| 5086 | Social Studies: Content and Interpretation |
| 5089 | Middle School Social Studies |
| 5095 | Physical Education: Content and Design |
| 5114 | Music: Content and Instruction |
| 5135 | Art: Content and Analysis |
| 5205 | Teaching Reading: Elementary |
| 5206 | Teaching Reading: K-12 |
| 5302 | Reading Specialist |
| 5621 | Principles of Learning and Teaching (PLT): Early Childhood |
| 5622 | Principles of Learning and Teaching (PLT): Grades K-6 |
| 5623 | Principles of Learning and Teaching (PLT): Grades 5-9 |
| 5624 | Principles of Learning and Teaching (PLT): Grades 7-12 |
| 5841 | World Languages Pedagogy |

### Worked examples from the multi-date queries

Praxis 5001 (fixed gap — always test date + 7):

| Test date | Report date (ETS tool) | Gap |
| --- | --- | --- |
| September 19, 2026 (Sat) | September 26, 2026 (Sat) | 7 days |
| September 22, 2026 (Tue) | September 29, 2026 (Tue) | 7 days |
| September 24, 2026 (Thu) | October 1, 2026 (Thu) | 7 days |
| September 25, 2026 (Fri) | October 2, 2026 (Fri) | 7 days |
| October 2, 2026 (Fri) | October 9, 2026 (Fri) | 7 days |
| October 16, 2026 (Fri) | October 23, 2026 (Fri) | 7 days |

Educational Leadership 5412 (fixed date — the window matters, not your test day):

| Test date | Report date (ETS tool) | Gap |
| --- | --- | --- |
| September 19, 2026 (Sat) | October 9, 2026 (Fri) | 20 days |
| September 22, 2026 (Tue) | October 9, 2026 (Fri) | 17 days |
| September 24, 2026 (Thu) | October 9, 2026 (Fri) | 15 days |
| September 25, 2026 (Fri) | October 9, 2026 (Fri) | 14 days |
| October 16, 2026 (Fri) | November 13, 2026 (Fri) | 28 days |

### Tests ETS’s tool could not date (16 listings)

These queries returned an error instead of a date. ETS’s own instruction for a test that is missing from the tool: “If you don’t see your test, contact customer service”[1]. General inquiries: 1-800-772-9476 (U.S., U.S. Virgin Islands, Puerto Rico, Canada) or 1-609-771-7395 (elsewhere), Mon–Fri 8 a.m.–7:45 p.m. ET, Sat 8 a.m.–4:30 p.m. ET[2].

| Code | Test | What we know |
| --- | --- | --- |
| 0633 | Braille Proficiency | Performance-based Braille proficiency assessment |
| 5174 | French: World Language | World Languages tests include a speaking component that is scored separately |
| 5183 | German: World Language | World Languages tests include a speaking component that is scored separately |
| 5195 | Spanish: World Language | World Languages tests include a speaking component that is scored separately |
| 56 | Middle School: Social Studies | Legacy listing entry (no current 4-digit code shown) |
| 5641 | Theatre | Tool inconsistency: “At Home” returned September 26, 2026 for the same test date; “At Center” returned an error |
| 5661 | Japanese: World Language | World Languages tests include a speaking component that is scored separately |
| 5665 | Chinese (Mandarin): World Language | World Languages tests include a speaking component that is scored separately |
| 5671 | Russian: World Language | World Languages tests include a speaking component that is scored separately |
| 60 | Soc Studies: Content Knowledge | Legacy listing entry (no current 4-digit code shown) |
| 6412 | Connecticut Administrator Test | State-specific administrator test (Connecticut) |
| 6990 | School Leaders Licensure Assessment (SLLA) | Leadership assessment with constructed-response tasks |
| 6991 | School Superintendent Assessment (SSA) | Leadership assessment with constructed-response tasks |
| 70 | General Science: Content Knowledge | Legacy listing entry (no current 4-digit code shown) |
| 8006 | Elementary Education Fundamentals: Teaching Reading | ETS states score reporting for the Fundamentals series began April 17, 2026; the tool had no schedule entry for 8006 as of our check |
| PASL | Performance Assessment for School Leaders | Performance assessment — portfolio tasks rated by trained reviewers |

## Unofficial Scores: What You See on Test Day

If your test contains **only selected-response questions**, the testing session ends with an unofficial score on screen[1]. Three official caveats matter:

- **Report-or-cancel is irreversible.** Before seeing the unofficial score you choose to report or cancel it. A reported score cannot be cancelled; a cancelled score cannot be reinstated, and you get no refund[1].
- **No unofficial score &ne; something went wrong.** ETS is explicit: when a selected-response test doesn’t show an unofficial score, further analysis must be conducted before scoring can be completed — it does NOT indicate a problem with your administration and will NOT delay your official score[1].
- **Constructed-response tests never show one** — there is nothing machine-scored to show yet[1]. On the 8002–8005 Fundamentals tests, the unofficial screen shows raw points per category while the Total Score displays as “NS” (No Score)[5]. Test centers cannot print or email unofficial scores[1].

## Where to Check Your Official Scores (and Your Estimated Date)

- **Your Praxis account → Score Reports page.** The official report posts there on the report date, and ETS emails you when it’s available[1].
- **Pending Scores card.** Before your report arrives, the Score Reports page shows a pending card with your estimated reporting date. Cancelled or held tests do not appear there[1].
- **During registration.** The scheduling screen shows the estimated score-reporting date after you pick a test date[1] — write it down before you even sit the exam.
- **Score recipients.** Up to four recipients are free at registration; you can add or change them until 3 days before your test date. Additional Score Reports ordered later cost $50 each and are processed within 5 calendar days[2]. If you tested in an automatic score-reporting state, your scores go to that state without any action from you[1].

## Praxis Score Report Not Showing Up? A Step-by-Step Checklist

1. **Confirm the actual report date — not a forum estimate.** Use the official tool on ETS’s *Getting Your Praxis Scores* page with your exact test, test date, and delivery method[1]. Remember: scores are only reported on **Tuesdays and Fridays**, pushed to the next Tue/Fri when a holiday intervenes[1].
2. **Check you’re in the right account.** The report posts to the Praxis account you registered with. If you have multiple ETS accounts (common for people who also took TOEFL or GRE), sign in to the right one.
3. **Check the email ETS has on file** — including spam/promotions folders. The “your scores are available” notification is the trigger to look[1].
4. **Look at the Pending Scores card.** If your test isn’t listed as pending, ETS notes that cancelled or held tests won’t show up there[1] — a held score needs customer service.
5. **Took multiple tests the same day?** Scores are staggered: the rest arrive in a second report[3]. Different tests genuinely have different dates — 5001 and 5723 taken on the same day report about two weeks apart[4].
6. **Didn’t get an unofficial score at the test center?** That alone is not a delay signal — ETS says it does not indicate a problem and does not delay the official score[1].
7. **Report date passed and still nothing? Contact ETS.** 1-800-772-9476 (U.S./Canada) or 1-609-771-7395 (elsewhere), Mon–Fri 8 a.m.–7:45 p.m. ET, Sat 8 a.m.–4:30 p.m. ET[2]. Have your candidate ID, test date, and date of birth ready.

## Why Some Praxis Tests Take Weeks to Score

ETS’s own scorer guidance explains the spread[3]: constructed-response questions are rated by education professionals in the content area, carefully trained and supervised. **Two scorers rate each response independently** — neither sees the other’s rating — and if the two ratings disagree by more than a specified amount, **a third scorer** rates the response. Under no circumstances does a total score depend entirely on one individual scorer. For some tests, the automated **c-rater** engine (trained on thousands of previously scored essays) acts as one of the two raters. Additional statistical checks account for difficulty differences across test editions. All of that takes calendar time — which is exactly why Group 1 (machine-scored) reports in a week and Group 4 (rater-heavy) reports in four.

## Do Praxis Scores Expire?

Two different clocks are running, and candidates constantly mix them up:

- **ETS’s clock — 10 years.** Scores reported on or after July 21, 2017 stay downloadable from your account for **ten years from the report date**; ETS recommends saving a copy for your files[1]. ETS’s score-sending and scoring services are available only for tests taken within the past 10 years[2]. (Scores reported before July 21, 2017 require ordering an Additional Score Report[1].)
- **Your state’s or program’s clock — whatever they set.** Licensing agencies and preparation programs decide how old a score they accept for certification, and many impose their own validity windows. ETS keeping your score for a decade says nothing about whether your state will honor a five-year-old report. Check with the agency before you rely on an old score — and if it has expired where it matters, our [retake guide](https://learndiag.com/praxis-5001-retake-guide) covers the 28-day waiting rule and how to make the second attempt count.

## Frequently Asked Questions

### When do Praxis scores come out?

It depends on the test. In ETS’s official score-reporting calendar tool, as we verified on 2026-09-20: 45 tests — including Praxis 5001, the 8002–8005 Fundamentals tests, and Core Reading (5713) and Core Math (5733) — report 7 calendar days after your test date; 62 tests report on a fixed date about three weeks out; Core Writing (5723) reports 21 calendar days out; and 16 constructed-response–heavy tests, including the four PLT exams, report about four weeks out. ETS reports scores on Tuesdays and Fridays, moving to the next Tuesday or Friday when a holiday falls on one.[1][4]

### What time do Praxis scores come out?

ETS publishes score-reporting dates but not a posting time. The only explicit clock time in the official materials — 5 p.m. ET — applied to one specific September 2026 batch for the 8002–8005 tests. Practically: check the Score Reports page in your Praxis account on your report date and watch for the ETS notification email.[1]

### How long does it take to get Praxis scores back?

Anywhere from 7 calendar days (most selected-response content tests, including 5001 and the 8000-series Fundamentals tests) to about four weeks (constructed-response–heavy tests such as PLT 5621–5624 and Teaching Reading 5205/5206). Core Writing (5723) shows 21 calendar days in ETS’s tool; the 2026–27 Bulletin lists 20 business days as its outer limit. Sixteen tests — including the World Languages series, SLLA, SSA, PASL, and 8006 — returned no date in the tool; ETS says to contact customer service about those.[1][2][4]

### Do you get Praxis scores immediately after the test?

If your test contains only selected-response questions, you’ll see an unofficial score at the end of the testing session — right before you choose to report or cancel it, which cannot be undone. Tests with constructed-response questions show no unofficial score, because human raters need time. On the 8002–8005 Fundamentals tests the unofficial screen shows category raw points with the Total Score displayed as “NS” (No Score). The official report still arrives on the published report date.[1][5]

### Why is my Praxis score report not showing up?

Work the checklist in order: confirm your exact report date in the ETS tool for your test, test date, and delivery method (scores are only reported on Tuesdays and Fridays); make sure you’re signed in to the account you registered with; check the email address ETS has on file, including spam; look at the Pending Scores card — cancelled or held tests don’t appear there; and remember that if you took several tests the same day, the rest arrive in a second report. If your report date has passed, contact ETS customer service at 1-800-772-9476 (Mon–Fri 8 a.m.–7:45 p.m. ET, Sat 8 a.m.–4:30 p.m. ET).[1][2][3]

### Why do some Praxis tests take longer to score?

Constructed-response answers are rated by people, not machines. Two trained raters score each response independently, and if their ratings disagree by more than a specified amount, a third rater steps in; on some tests ETS’s automated c-rater engine acts as one of the two raters. That is why essay- and constructed-response–heavy tests such as Core Writing and the PLT series take weeks, while selected-response–only tests take days.[3]

### I took two Praxis tests the same day and only one score came. Is that normal?

Yes. ETS states that some tests take longer to score than others, and that if not all of your scores are reported at once, you will receive the rest in a second report. Our queries of the ETS tool show same-day tests can carry different report dates — for example, 5001 and 5723 tested on the same September day report about two weeks apart.[3][4]

### Do Praxis scores expire?

On ETS’s side: scores reported on or after July 21, 2017 stay downloadable from your account for ten years from the report date, and ETS’s score-sending services cover tests taken within the past ten years. But whether a state licensing agency or preparation program accepts an older score is up to that state or program — many set their own validity windows. Confirm with the agency before relying on an old score, and save a PDF copy of every report.[1][2]

### Where do I find my official Praxis score report?

In your Praxis account, on the Score Reports page — ETS emails you when the report posts. Your scores are also sent to the up-to-four recipients you selected at registration (you can add or change recipients up to 3 days before test day; extra reports after that cost $50 each), and if you tested in an automatic score-reporting state, your scores go to that state automatically.[1][2]

### Can Praxis scores be released early?

There is no official early-release channel. The unofficial score shown at the test center for selected-response–only tests is the earliest signal, and it is not the official report. ETS posts the official report on the published report date, so plan around the date rather than a clock time.[1]

## Official Sources

Every factual claim above traces to one of these. Verification dates are shown because ETS updates its pages and schedules.

| # | Source | Link | Last verified |
| --- | --- | --- | --- |
| 1 | ETS official page: *Getting Your Praxis Scores* — report-date rules, the score-reporting calendar tool, Tuesday/Friday reporting note, unofficial-score policy, report-or-cancel rules, pending-scores card, 10-year download window | [getting-scores.html](https://praxis.ets.org/test-taker/getting-scores.html) (local archive: `docs/sources/ets-getting-scores-20260920.html`) | 2026-09-20 |
| 2 | ETS, *The Praxis Bulletin 2026–27* (PDF) — Core 5713/5733 “7 calendar days” and 5723 “20 business days” limits, recipient rules and 3-day change deadline, ASR $50 / 5-calendar-day processing, 10-year service window, customer-service numbers and hours | [praxis-information-bulletin.pdf](https://praxis.ets.org/on/demandware.static/-/Library-Sites-ets-praxisLibrary/default/dwd1ed07a0/pdfs/praxis-information-bulletin.pdf) (local archive: `docs/sources/ets-praxis-information-bulletin-2627.pdf`) | 2026-09-20 |
| 3 | ETS, *Understanding Your Praxis Scores 2025–26* (PDF) — two independent raters plus third-rater tie-break, c-rater, staggered second reports, statistical checks across editions | [understanding-your-scores-25-26.pdf](https://praxis.ets.org/on/demandware.static/-/Library-Sites-ets-praxisLibrary/default/dwf807334a/pdfs/understanding-your-scores-25-26.pdf) (local archive: `docs/sources/ets-understanding-your-scores-2526-full.txt`) | 2026-09-20 |
| 4 | **Our own queries of the ETS score-reporting calendar API** (`ScoreReports-ReportDateForEveryone` + `ScoreReports-GetProductsByTestCenter`, the endpoints behind the tool on source [1]) — 540 queries on 2026-09-20: every listed product for test date 2026-09-19 on both delivery sides, plus 5 additional test dates for 26 high-demand exams | Raw JSON archived at `docs/sources/ets-score-date-api-20260920.json` | 2026-09-20 |
| 5 | ETS official FAQ for Teacher Candidates: *Praxis Steps FAQ* — “NS” total score on the 8002–8005 unofficial screen | [praxis-steps-test-taker-faq.pdf](https://praxis.ets.org/on/demandware.static/-/Library-Sites-ets-praxisLibrary/default/pdfs/praxis-steps-test-taker-faq.pdf) | 2026-09-14 |

**Notes on source limitations — read these before relying on the page:**

- **The tool returns ETS’s current schedule, and schedules move.** Every date here was true at 2026-09-20 for the test dates we queried. Always re-run the official tool for your own test, date, and delivery method.
- **Fixed-date behavior was verified on multiple dates for six tests** (5039, 5123, 5358, 5412, 5652, 7811) plus the +7 and +21 groups; the other Group 2/4 members were verified for one test date (Sep 19, 2026) and may follow a different window schedule for other test dates.
- **Tool dates vs the Tuesday/Friday note.** Some tool dates fall on Saturdays (Sep 26, Oct 10). We read the tool date as the outer boundary and Tue/Fri as the actual posting days; ETS publishes no posting time of day.
- **The 16 no-date listings are the tool’s behavior at check time** — not an ETS statement that those tests lack reporting schedules. 8006 in particular may be added later; ETS’s 8006 page says Fundamentals reporting began April 17, 2026 (see our [8006 guide](https://learndiag.com/praxis-8006-teaching-reading)).
- **The Bulletin’s “20 business days” for 5723 and the tool’s 21 calendar days are both correct** — the Bulletin states a ceiling; the tool states the scheduled date, which sits inside that ceiling.

Related: [Praxis Steps and the new 7-day score rule](https://learndiag.com/praxis-steps) · [Practice accuracy calculator](https://learndiag.com/score-calculator) · [Passing scores by state](https://learndiag.com/praxis-5001-passing-score-by-state) · [Retake guide](https://learndiag.com/praxis-5001-retake-guide) · [Praxis 8006 Teaching Reading](https://learndiag.com/praxis-8006-teaching-reading) · [Praxis 8002 vs 8006](https://learndiag.com/praxis-8002-vs-8006)

Last verified 2026-09-20. If you find a factual error on this page, please [contact us](https://learndiag.com/contact) — we correct errors and note the correction.
