// quiz-8002.js — Praxis 8002 mini test engine (30 questions, 2 categories).
//
// Modelled on /js/quiz-8006.js (same views, same D3 magic-code registration,
// same tracking calls). Differences, all deliberate:
//   - Two official categories, not three: Reading (42 of 80 items) and
//     Writing, Speaking and Listening (38 of 80).
//   - This bank contains 3 multiple-select items ("Which TWO of the following",
//     A-E, exactly two correct). The engine grades them as a set when Check is
//     pressed; single-select items still grade on the click.
//   - State is written to tests["8002"], so it can never disturb the 5001 or
//     8006 buckets (see worker-src/accounts.mjs).
//
// Scope decisions (unchanged from 8006):
//   - NO scaled score, NO pass probability anywhere. ETS publishes no
//     raw-to-scaled conversion for the 8000 series; a percentage is a percentage.
//   - Weakest category: lowest rate wins; ties broken by official weight
//     (Reading 42 > Writing, Speaking and Listening 38); a tie across both
//     categories outputs "close across categories" instead of a fake winner.
//   - vanilla JS, no framework — the article content around it is static HTML.
(function () {
  'use strict';

  var BANK = window.DM_BANK_8002;
  var T = window.TriumphAuth;
  var L = window.LDTrack;
  var root = document.getElementById('mini-test');
  if (!root || !BANK || !BANK.length) return;

  var DOMAINS = ['Reading', 'Writing, Speaking and Listening'];
  var DOMAIN_WEIGHT = { 'Reading': 42, 'Writing, Speaking and Listening': 38 };
  var API = window.TRIUMPH_API || '';
  var attemptId = null;
  var answers = {};      // id -> chosen index (single) or array of indices (multi)
  var order = [];        // question ids in presentation order
  var pos = 0;
  var finished = false;
  var registered = false;
  var pending = { email: '', requestId: null, method: 'magic_code' };
  var pollTimer = null;

  var TOTAL = BANK.length;
  var COUNT = {};        // category -> item count in this bank
  BANK.forEach(function (q) { COUNT[q.subtest] = (COUNT[q.subtest] || 0) + 1; });
  var COUNT_LINE = DOMAINS.map(function (d) { return d + ' ' + (COUNT[d] || 0); }).join(' · ');

  // ------------------------------------------------------------ utils

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function shuffle(a) {
    var r = a.slice();
    for (var i = r.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = r[i]; r[i] = r[j]; r[j] = t;
    }
    return r;
  }
  function band(pct) {
    if (pct < 40) return '0-39';
    if (pct < 60) return '40-59';
    if (pct < 75) return '60-74';
    if (pct < 90) return '75-89';
    return '90-100';
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }
  function isMulti(q) { return Array.isArray(q.answers); }
  function correctSet(q) {
    return isMulti(q) ? q.answers.slice().sort().join(',') : String(q.answer);
  }
  function pickedSet(q, a) {
    if (a === undefined || a === null) return null;
    return Array.isArray(a) ? a.slice().sort().join(',') : String(a);
  }
  function isCorrect(q, a) {
    var p = pickedSet(q, a);
    return p !== null && p === correctSet(q);
  }
  function answerText(q, a) {
    if (a === undefined || a === null) return '(no answer)';
    var idx = Array.isArray(a) ? a.slice().sort(function (x, y) { return x - y; }) : [a];
    return idx.map(function (i) { return q.options[i]; }).join(' + ');
  }
  function correctText(q) {
    var idx = isMulti(q) ? q.answers.slice().sort(function (x, y) { return x - y; }) : [q.answer];
    return idx.map(function (i) { return q.options[i]; }).join(' + ');
  }

  function byDomain() {
    var g = {};
    BANK.forEach(function (q) { (g[q.subtest] = g[q.subtest] || []).push(q); });
    return g;
  }

  function buildOrder() {
    var g = byDomain();
    order = [];
    // order holds question IDS — renderQuestion looks them up with
    // `x.id === order[pos]`. Pushing the objects themselves makes that
    // comparison always false and the box renders blank.
    DOMAINS.forEach(function (d) {
      order = order.concat(shuffle(g[d] || []).map(function (q) { return q.id; }));
    });
  }

  function summary() {
    var per = {};
    BANK.forEach(function (q) {
      per[q.subtest] = per[q.subtest] || { total: 0, correct: 0 };
      per[q.subtest].total += 1;
      if (isCorrect(q, answers[q.id])) per[q.subtest].correct += 1;
    });
    var totalCorrect = 0;
    DOMAINS.forEach(function (d) { totalCorrect += per[d].correct; });
    var totalPct = Math.round((totalCorrect / TOTAL) * 100);
    var rates = DOMAINS.map(function (d) {
      return { name: d, total: per[d].total, correct: per[d].correct, rate: per[d].correct / per[d].total };
    });
    var min = Math.min.apply(null, rates.map(function (r) { return r.rate; }));
    var tied = rates.filter(function (r) { return r.rate === min; });
    var weakest = null;
    var weakestNote = null;
    if (tied.length === rates.length) {
      weakestNote = 'Your two categories are close — balanced review across both is the right call at this sample size.';
    } else if (tied.length > 1) {
      tied.sort(function (a, b) { return DOMAIN_WEIGHT[b.name] - DOMAIN_WEIGHT[a.name]; });
      weakest = tied[0].name;
      weakestNote = tied.map(function (r) { return r.name; }).join(' and ') +
        ' are tied — we point you at ' + weakest + ' first because it carries the larger share of the test.';
    } else {
      weakest = tied[0].name;
    }
    return { per: per, totalPct: totalPct, rates: rates, weakest: weakest, weakestNote: weakestNote };
  }

  function missed() {
    return BANK.filter(function (q) {
      return answers[q.id] !== undefined && !isCorrect(q, answers[q.id]);
    }).map(function (q) { return q.id; });
  }

  // ------------------------------------------------------------ views

  function renderIntro() {
    root.innerHTML = '';
    var box = el('div', 'ld8-intro');
    var h = el('p', null, null);
    h.style.cssText = 'font-size:17px;margin:0 0 10px';
    h.innerHTML = '<strong>' + TOTAL + ' questions</strong> drawn from both official content categories, with a per-question explanation. Free, no account needed to see your results.';
    var meta = el('div', 'meta');
    meta.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--ink-soft);margin:0 0 16px';
    var multiCount = BANK.filter(isMulti).length;
    [TOTAL + ' questions · ' + COUNT_LINE,
      '≈ 25–30 min',
      'Explanations on every item',
      multiCount + ' “Which TWO” items'].forEach(function (t) {
      meta.appendChild(el('span', null, t));
    });
    var note = el('p', null, 'Original practice items written to the official category definitions — not official ETS questions. Your result is a category-level percentage, not a predicted scaled score (ETS publishes no conversion table for the 8000 series).');
    note.style.cssText = 'font-size:13.5px;color:var(--ink-soft);line-height:1.6;margin:0 0 18px';
    var btn = el('button', 'btn-primary', 'Start the mini test');
    btn.style.cssText = 'padding:13px 24px;font-size:15px';
    btn.addEventListener('click', start);
    box.appendChild(h);
    box.appendChild(meta);
    box.appendChild(note);
    box.appendChild(btn);
    root.appendChild(box);
  }

  function start() {
    answers = {};
    finished = false;
    registered = false;
    pos = 0;
    buildOrder();
    attemptId = L ? L.newAttempt() : null;
    if (L) L.track('test_start', { attempt_id: attemptId });
    renderQuestion();
  }

  function renderQuestion() {
    var q = BANK.filter(function (x) { return x.id === order[pos]; })[0];
    root.innerHTML = '';
    // Defensive: a resolver miss used to throw on q.subtest below and leave an
    // empty box with no explanation. Fail loudly-but-visibly instead.
    if (!q) {
      console.error('[quiz-8002] no question resolved for order[' + pos + '] =', order[pos]);
      var err = el('p', null, 'This question could not be loaded. Please reload the page.');
      err.style.cssText = 'font-size:15px;color:var(--ink-soft);background:var(--bg-soft);border-left:2px solid #B46F6A;padding:14px 16px';
      root.appendChild(err);
      return;
    }
    var box = el('div', 'ld8-quiz');

    var top = el('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:8px';
    top.appendChild(el('span', null, (pos + 1) + ' / ' + order.length));
    var cat = el('span', null, q.subtest);
    cat.style.cssText = 'font-size:12px;letter-spacing:.06em;color:var(--accent-deep);text-transform:uppercase';
    top.appendChild(cat);
    box.appendChild(top);

    var track = el('div');
    track.style.cssText = 'height:4px;background:var(--bg-soft);margin-bottom:18px';
    var fill = el('div');
    fill.style.cssText = 'height:4px;background:var(--accent);width:' + (pos / order.length * 100) + '%';
    track.appendChild(fill);
    box.appendChild(track);

    var qEl = el('p', null, null);
    qEl.style.cssText = 'font-size:17px;line-height:1.6;margin:0 0 14px';
    qEl.textContent = q.q;
    box.appendChild(qEl);

    if (isMulti(q)) {
      renderMulti(q, box);
    } else {
      renderSingle(q, box);
    }

    root.appendChild(box);
  }

  function optButton(text) {
    var b = el('button', 'opt', text);
    b.style.cssText = 'display:block;width:100%;text-align:left;padding:11px 14px;margin:8px 0;font-size:14.5px;line-height:1.5;color:var(--ink);background:var(--bg);border:1px solid var(--line);cursor:pointer;font-family:var(--sans)';
    return b;
  }

  function paint(b, state) {
    if (state === 'correct') { b.style.borderColor = '#7D9378'; b.style.background = '#EFF2EA'; }
    else if (state === 'wrong') { b.style.borderColor = '#B46F6A'; b.style.background = '#F6EAE8'; }
    else if (state === 'picked') { b.style.borderColor = 'var(--accent)'; b.style.background = 'var(--bg-soft)'; }
  }

  function showExplanation(box, q, ok, pickedIdx) {
    var ex = el('div', null, null);
    ex.style.cssText = 'border-left:2px solid var(--accent);background:var(--bg-soft);padding:13px 16px;margin-top:12px;font-size:13.5px;line-height:1.65';
    ex.appendChild(el('strong', null, ok ? 'Correct. ' : 'Not quite. '));
    var dexText = '';
    if (!ok && !isMulti(q) && q.dex && q.dex[q.options[pickedIdx]]) {
      dexText = q.dex[q.options[pickedIdx]] + ' ';
    }
    if (!ok && isMulti(q)) {
      var wrongPicks = (pickedIdx || []).filter(function (i) { return q.answers.indexOf(i) === -1; });
      dexText = wrongPicks.map(function (i) { return q.dex ? (q.dex[q.options[i]] || '') : ''; })
        .filter(Boolean).join(' ') + (wrongPicks.length ? ' ' : '');
    }
    ex.appendChild(document.createTextNode(dexText + q.explain));
    box.appendChild(ex);

    var next = el('button', 'btn-primary', pos === order.length - 1 ? 'See my results' : 'Next question \u2192');
    next.style.cssText = 'margin-top:14px;padding:11px 20px;font-size:14px';
    next.addEventListener('click', function () {
      if (pos === order.length - 1) { finish(); } else { pos += 1; renderQuestion(); }
    });
    box.appendChild(next);
    next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderSingle(q, box) {
    var answered = false;
    q.options.forEach(function (opt, idx) {
      var b = optButton(opt);
      b.addEventListener('click', function () {
        if (answered) return;
        answered = true;
        answers[q.id] = idx;
        var buttons = box.querySelectorAll('button.opt');
        for (var i = 0; i < buttons.length; i++) {
          buttons[i].disabled = true;
          if (i === q.answer) paint(buttons[i], 'correct');
          else if (i === idx) paint(buttons[i], 'wrong');
        }
        if (L) L.track('question_answer', {
          attempt_id: attemptId,
          correct: idx === q.answer,
          content_domain: q.subtest,
          question_id: q.id,
        });
        showExplanation(box, q, idx === q.answer, idx);
      });
      box.appendChild(b);
    });
  }

  function renderMulti(q, box) {
    var picked = [];
    var graded = false;
    var hint = el('p', null, 'Select two options, then press Check.');
    hint.style.cssText = 'font-size:12.5px;color:var(--ink-soft);margin:0 0 6px';
    box.appendChild(hint);

    var check = el('button', 'btn-primary', 'Check answer');
    check.style.cssText = 'margin-top:6px;padding:11px 20px;font-size:14px';
    check.disabled = true;
    check.style.opacity = '0.5';

    q.options.forEach(function (opt, idx) {
      var b = optButton(opt);
      b.addEventListener('click', function () {
        if (graded) return;
        var at = picked.indexOf(idx);
        if (at === -1) {
          if (picked.length >= 2) return;   // exactly two, as the stem states
          picked.push(idx);
          paint(b, 'picked');
        } else {
          picked.splice(at, 1);
          b.style.borderColor = 'var(--line)';
          b.style.background = 'var(--bg)';
        }
        check.disabled = picked.length !== 2;
        check.style.opacity = picked.length === 2 ? '1' : '0.5';
      });
      box.appendChild(b);
    });

    check.addEventListener('click', function () {
      if (graded || picked.length !== 2) return;
      graded = true;
      answers[q.id] = picked.slice();
      var ok = isCorrect(q, answers[q.id]);
      var buttons = box.querySelectorAll('button.opt');
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].disabled = true;
        var isKey = q.answers.indexOf(i) !== -1;
        var wasPicked = picked.indexOf(i) !== -1;
        if (isKey) paint(buttons[i], 'correct');
        else if (wasPicked) paint(buttons[i], 'wrong');
      }
      if (L) L.track('question_answer', {
        attempt_id: attemptId,
        correct: ok,
        content_domain: q.subtest,
        question_id: q.id,
      });
      check.style.display = 'none';
      hint.style.display = 'none';
      showExplanation(box, q, ok, picked);
    });
    box.appendChild(check);
  }

  function finish() {
    finished = true;
    var s = summary();
    if (L) {
      L.track('test_complete', { attempt_id: attemptId, score_band: band(s.totalPct), weakest_domain: s.weakest });
      L.flushNow();
    }
    try {
      localStorage.setItem('ld_8002_last', JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        total_pct: s.totalPct,
        weakest: s.weakest,
        missed: missed(),
      }));
    } catch (e) { /* storage full/blocked — result still shows live */ }
    renderResult(s);
  }

  function renderResult(s) {
    root.innerHTML = '';
    var box = el('div', 'ld8-result');

    box.appendChild(el('span', 'eyebrow', 'Your mini test result'));

    // returning-visit comparison
    try {
      var prevRaw = localStorage.getItem('ld_8002_prev');
      if (prevRaw) {
        var prev = JSON.parse(prevRaw);
        if (prev && typeof prev.total_pct === 'number') {
          var line = el('p', null, 'Last time: ' + prev.total_pct + '% \u2192 now ' + s.totalPct + '%' +
            (s.totalPct > prev.total_pct ? ' \u2014 improving.' : s.totalPct < prev.total_pct ? ' \u2014 a dip; revisit the plan below.' : ' \u2014 steady.'));
          line.style.cssText = 'font-size:14px;color:var(--ink-soft);margin:6px 0 0';
          box.appendChild(line);
        }
      }
    } catch (e) { /* ignore */ }

    var big = el('p', null, null);
    big.style.cssText = 'margin:10px 0 4px';
    big.innerHTML = '<span style="font-family:var(--serif);font-size:42px;color:var(--accent-deep)">' + s.totalPct + '%</span>' +
      ' <span style="font-size:14px;color:var(--ink-soft)">of ' + TOTAL + ' practice items correct \u2014 a practice percentage, not a predicted scaled score.</span>';
    box.appendChild(big);

    box.appendChild(el('p', null, null)).innerHTML = '<span class="eyebrow" style="display:block;margin-top:22px">By content category</span>';
    s.rates.forEach(function (r) {
      var row = el('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 70px;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px';
      var nameCell = el('div', null, null);
      nameCell.innerHTML = esc(r.name) + ' <span style="color:var(--ink-soft)">(' + r.correct + '/' + r.total + ')</span>' +
        (s.weakest === r.name ? ' <strong style="color:var(--accent-deep)">\u2014 start here</strong>' : '');
      var bar = el('div');
      bar.style.cssText = 'height:8px;background:var(--bg-soft)';
      var fill = el('div');
      fill.style.cssText = 'height:8px;background:var(--accent);width:' + Math.max(5, Math.round(r.rate * 100)) + '%';
      bar.appendChild(fill);
      row.appendChild(nameCell);
      row.appendChild(bar);
      box.appendChild(row);
    });

    var advice = el('div');
    advice.style.cssText = 'margin-top:18px;font-size:14.5px;line-height:1.65';
    if (s.weakestNote) {
      advice.appendChild(el('p', null, s.weakestNote));
    } else {
      advice.appendChild(el('p', null, null)).innerHTML =
        'Your likely weakest category is <strong>' + esc(s.weakest) + '</strong>. At ' + TOTAL + ' questions this is a signal, not a diagnosis \u2014 but it is where your first study week should go.';
    }
    advice.appendChild(el('p', null, 'Next steps: re-read the category description above, work the misses below, and re-take this mini test in 7\u201310 days. Retesting without changing how you study rarely moves the number.'));
    box.appendChild(advice);

    var missedQs = BANK.filter(function (q) {
      return answers[q.id] !== undefined && !isCorrect(q, answers[q.id]);
    });
    if (missedQs.length) {
      var mh = el('p', null, null);
      mh.style.cssText = 'margin-top:24px';
      mh.innerHTML = '<span class="eyebrow" style="display:block">Review your misses (' + missedQs.length + ')</span>';
      box.appendChild(mh);
      missedQs.forEach(function (q) {
        var item = el('div');
        item.style.cssText = 'border-top:1px solid var(--line);padding:13px 0;font-size:13.5px;line-height:1.6';
        item.innerHTML = '<p style="margin:0 0 4px">' + esc(q.q) + '</p>' +
          '<p style="margin:0;color:#B33A3A">Your answer: ' + esc(answerText(q, answers[q.id])) + '</p>' +
          '<p style="margin:0 0 4px;color:#3E6B3A">Correct: ' + esc(correctText(q)) + '</p>' +
          '<p style="margin:0;color:var(--ink-soft)">' + esc(q.explain) + '</p>';
        box.appendChild(item);
      });
    }

    box.appendChild(buildSignupCard(s));

    var actions = el('div');
    actions.style.cssText = 'margin-top:24px;display:flex;gap:14px;flex-wrap:wrap';
    var again = el('button', 'btn-primary', 'Re-take the mini test');
    again.style.cssText = 'padding:12px 20px;font-size:14px';
    again.addEventListener('click', function () {
      if (L) { attemptId = L.newAttempt(); L.track('retest_start', { attempt_id: attemptId }); }
      start();
    });
    actions.appendChild(again);
    box.appendChild(actions);

    root.appendChild(box);
    if (L) L.observeOnce(box, 'result_view', { score_band: band(s.totalPct), weakest_domain: s.weakest });
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------- D3 registration card

  function buildSignupCard(s) {
    var card = el('div', 'ld8-card');
    card.style.cssText = 'border:1px solid var(--line);background:var(--bg-soft);padding:20px;margin-top:26px';

    if (registered) {
      card.innerHTML = '<p style="margin:0;font-size:14.5px"><strong>Saved to your account.</strong> Your category results are stored \u2014 re-take any time and this page compares the two runs.</p>';
      return card;
    }

    var head = el('p', null, null);
    head.style.cssText = 'margin:0 0 6px;font-size:16px';
    head.innerHTML = '<strong>Save this result</strong> \u2014 free, no password.';
    var sub = el('p', null, 'We email a 6-digit code. Your result, including the misses list, gets attached to your account so you can compare runs across devices. Already have an account? This same flow signs you in.');
    sub.style.cssText = 'font-size:13.5px;color:var(--ink-soft);line-height:1.55;margin:0 0 12px';
    card.appendChild(head);
    card.appendChild(sub);

    var row1 = el('div');
    row1.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    var email = el('input');
    email.type = 'email';
    email.placeholder = 'you@school.edu';
    email.setAttribute('aria-label', 'Email address');
    email.style.cssText = 'flex:1;min-width:200px;padding:11px 14px;font-size:14px;color:var(--ink);background:var(--bg);border:1px solid var(--line);outline:none';
    var go = el('button', 'btn-primary', 'Email me the code');
    go.style.cssText = 'padding:11px 18px;font-size:14px';
    row1.appendChild(email);
    row1.appendChild(go);
    card.appendChild(row1);

    var row2 = el('div');
    row2.style.display = 'none';
    var hint = el('p', null, 'Tip: open the link straight from your email app \u2014 or type the 6-digit code here. Both unlock saving on this page.');
    hint.style.cssText = 'font-size:13px;color:var(--ink-soft);line-height:1.55;margin:0 0 10px';
    var code = el('input');
    code.type = 'text';
    code.inputMode = 'numeric';
    code.maxLength = 6;
    code.placeholder = '6-digit code';
    code.setAttribute('aria-label', '6-digit code');
    code.style.cssText = 'flex:1;min-width:160px;padding:11px 14px;font-size:16px;letter-spacing:4px;color:var(--ink);background:var(--bg);border:1px solid var(--line);outline:none';
    var verify = el('button', 'btn-primary', 'Save my result');
    verify.style.cssText = 'padding:11px 18px;font-size:14px';
    row2.appendChild(hint);
    row2.appendChild(code);
    row2.appendChild(verify);
    row2.style.cssText = 'display:none;flex-direction:column;gap:10px';
    card.appendChild(row2);

    var later = el('p', null, null);
    later.style.cssText = 'margin:10px 0 0';
    var laterLink = el('a', null, 'Maybe later \u2014 my result stays on screen either way.');
    laterLink.href = '#';
    laterLink.style.cssText = 'font-size:12.5px;color:var(--ink-soft)';
    laterLink.addEventListener('click', function (ev) {
      ev.preventDefault();
      card.style.display = 'none';
    });
    later.appendChild(laterLink);
    card.appendChild(later);

    var msg = el('p');
    msg.style.cssText = 'font-size:12.5px;color:var(--accent-deep);margin:8px 0 0;min-height:1em';

    var attemptPayload = {
      completed_at: new Date().toISOString().slice(0, 10),
      total_pct: s.totalPct,
      domain_scores: s.rates.reduce(function (acc, r) { acc[r.name] = r.correct + '/' + r.total; return acc; }, {}),
      weakest_domain: s.weakest,
      weakest_note: s.weakestNote || null,
      missed: missed(),
    };

    function errMsg(c) {
      var map = {
        invalid_email: 'That email doesn\u2019t look right \u2014 check it and try again.',
        mail_failed: 'Couldn\u2019t send the email right now \u2014 try again in a minute.',
        wrong_code: 'That code doesn\u2019t match \u2014 use the latest email.',
        code_expired: 'The code expired (15 min). Enter your email again for a new one.',
      };
      return map[c] || 'Something went wrong \u2014 try again.';
    }

    function api(path, body, method) {
      return fetch(API + path, {
        method: method || 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var e = new Error((data && data.error && data.error.message) || 'failed');
            e.code = (data && data.error && data.error.code) || 'error';
            throw e;
          }
          return data;
        });
      });
    }

    function finish(token) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      // 别让 auth 缺失把整个 finish 打断 —— 后面还有成绩保存和 reload 要跑。
      if (T && typeof T._setSession === 'function') {
        try { T._setSession(token, pending.email); } catch (e) { /* 内存态已够用 */ }
      } else {
        try {
          localStorage.setItem('triumph_token', token);
          localStorage.setItem('triumph_user', pending.email);
        } catch (e) { /* storage 不可用时不阻断流程 */ }
      }
      var uid = null;
      try {
        var payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        uid = payload.sub || null;
      } catch (e) { /* best effort */ }
      if (L) { L.identify(uid || pending.email, pending.method); L.flushNow(); }

      // Authoritative reconcile: GET account state, attach THIS attempt under
      // the 8002 test bucket (newer wins over any stored attempt), PUT back.
      var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
      fetch(API + '/api/state', { headers: { Authorization: 'Bearer ' + token } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var st = (d && d.state) || {};
          if (!st.tests || typeof st.tests !== 'object') st = { v: 2, tests: { '5001': st } };
          st.tests['8002'] = st.tests['8002'] || {};
          st.tests['8002'].attempt_8002 = attemptPayload;
          return fetch(API + '/api/state', { method: 'PUT', headers: headers, body: JSON.stringify({ state: st }) });
        })
        .catch(function () { /* reconcile is best-effort; local result unaffected */ })
        .then(function () {
          registered = true;
          try { localStorage.setItem('ld_8002_prev', JSON.stringify({ total_pct: s.totalPct })); } catch (e) { }
          card.innerHTML = '<p style="margin:0;font-size:14.5px"><strong>Saved to your account.</strong> Re-take any time \u2014 this page will compare your runs.</p>';
        });
    }

    go.addEventListener('click', function () {
      var v = (email.value || '').trim();
      if (!v) { msg.textContent = 'Enter your email first.'; return; }
      go.disabled = true; go.textContent = 'Sending\u2026'; msg.textContent = '';
      if (L) L.track('signup_start', { signup_method: 'magic_code' });
      api('/api/magic/request', {
        email: v,
        // Send the v2 shape so the server files this under tests["8002"].
        pending_state: { v: 2, tests: { '8002': { attempt_8002: attemptPayload } } },
        next: window.location.pathname,
      })
        .then(function (data) {
          pending.email = v;
          pending.requestId = data.request_id || null;
          row1.style.display = 'none';
          row2.style.display = 'flex';
          code.focus();
          startPolling();
        })
        .catch(function (e) { msg.textContent = errMsg(e.code); })
        .then(function () { go.disabled = false; go.textContent = 'Email me the code'; });
    });
    email.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go.click(); });

    function startPolling() {
      if (!pending.requestId || pollTimer) return;
      var tries = 0;
      pollTimer = setInterval(function () {
        if (++tries > 100) { clearInterval(pollTimer); pollTimer = null; return; }
        fetch(API + '/api/magic/status?request_id=' + encodeURIComponent(pending.requestId))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.status === 'done' && d.token) { pending.method = 'magic_link'; finish(d.token); }
          })
          .catch(function () { /* keep polling */ });
      }, 3000);
    }

    verify.addEventListener('click', function () {
      var v = (code.value || '').trim();
      if (!/^\d{6}$/.test(v)) { msg.textContent = 'Enter the 6 digits from the email.'; return; }
      verify.disabled = true; verify.textContent = 'Checking\u2026'; msg.textContent = '';
      api('/api/magic/verify', { email: pending.email, code: v, request_id: pending.requestId })
        .then(function (data) {
          pending.method = 'magic_code';
          finish(data.token);
        })
        .catch(function (e) { msg.textContent = errMsg(e.code); verify.disabled = false; verify.textContent = 'Save my result'; });
    });
    code.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') verify.click(); });

    if (L) L.observeOnce(card, 'signup_prompt_view', {});

    return card;
  }

  // ------------------------------------------------- returning visit (logged in)

  function checkSaved() {
    if (!T || !T.isLoggedIn()) return;
    fetch(API + '/api/state', { headers: { Authorization: 'Bearer ' + T.token } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var st = (d && d.state) || {};
        var bucket = (st.tests && st.tests['8002']) || {};
        var a = bucket.attempt_8002 || st.attempt_8002;
        if (a && a.total_pct && !finished) {
          var note = el('p', null, 'Saved result from ' + a.completed_at + ': ' + a.total_pct + '% of the mini test' +
            (a.weakest_domain ? ' \u2014 weakest category: ' + a.weakest_domain : '') + '. Re-take below to compare.');
          note.style.cssText = 'font-size:14px;color:var(--ink-soft);background:var(--bg-soft);border-left:2px solid var(--accent);padding:10px 14px;margin:0 0 16px';
          root.insertBefore(note, root.firstChild);
        }
      })
      .catch(function () { /* logged-out or transient — silent */ });
  }

  // ------------------------------------------------- boot

  renderIntro();
  if (L) L.track('test_view');
  checkSaved();
})();
