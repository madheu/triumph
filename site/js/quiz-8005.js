// quiz-8005.js — Praxis 8005 (Science) mini test + practice engine.
//
// Two mount points, one engine:
//   #mini-test  → mini test (main content page). 30 items, immediate feedback, result summary.
//   #full-test  → practice mode (practice page). The same 30 items, but the visitor picks a
//                 content domain first and gets a domain-level breakdown at the end.
//
// Scope decisions:
//   - NO scaled score, NO pass probability anywhere. ETS publishes no raw-to-scaled
//     conversion for 8005. A percentage is a percentage, and the result copy says so.
//   - Per-domain item counts for 8005 are NOT officially published (the official
//     publication is truncated for that section; the widely repeated 24/25/25 split is
//     third-party triangulation only). The engine therefore treats the three domains as
//     equally weighted and never prints an official-looking domain share. Ties are
//     reported as ties instead of being resolved into a fabricated "weakest domain".
//   - Multiple-select items ("Which TWO of the following...") are graded as a set: credit
//     only when the chosen pair matches the correct pair exactly.
//   - Per-question feedback shows the distractor explanation for the option the visitor
//     actually picked, which is where the misconception coaching lives.
//   - Option styling comes entirely from the site's existing .opt classes. No new styles
//     are injected from JS, and no inline colors, so the class states (.correct / .wrong
//     / .selected) can actually win.
//   - Tracking reuses only event names already listed in js/tracking.js EVENTS.
//   - vanilla JS, no framework — the article around it is static HTML.
(function () {
  'use strict';

  var BANK = window.DM_BANK_8005;
  var L = window.LDTrack;

  var miniRoot = document.getElementById('mini-test');
  var practiceRoot = document.getElementById('full-test');
  var root = miniRoot || practiceRoot;
  if (!root || !BANK || !BANK.length) return;

  var MODE = practiceRoot ? 'practice' : 'mini';
  var DOMAINS = ['Earth and Space Science', 'Life Science', 'Physical Science'];
  var LETTERS = ['A', 'B', 'C', 'D', 'E'];
  var STORE_LAST = 'ld_8005_last';
  var STORE_PREV = 'ld_8005_prev';

  var answers = {};      // id -> array of chosen indices
  var order = [];        // question ids in presentation order
  var pos = 0;
  var filter = null;     // practice mode: content domain, or null for all three
  var attemptId = null;

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
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }
  function band(pct) {
    if (pct < 40) return '0-39';
    if (pct < 60) return '40-59';
    if (pct < 75) return '60-74';
    if (pct < 90) return '75-89';
    return '90-100';
  }
  function numWord(n) { return n === 2 ? 'two' : String(n); }
  function correctIdx(q) { return Array.isArray(q.answer) ? q.answer.slice() : [q.answer]; }
  function correctText(q) {
    return correctIdx(q).map(function (i) { return q.options[i]; }).join(' \u00b7 ');
  }
  function chosenText(q) {
    return (answers[q.id] || []).map(function (i) { return q.options[i]; }).join(' \u00b7 ');
  }
  function isRight(q) {
    var picked = (answers[q.id] || []).slice().sort();
    var want = correctIdx(q).sort();
    if (picked.length !== want.length) return false;
    for (var i = 0; i < picked.length; i++) { if (picked[i] !== want[i]) return false; }
    return true;
  }
  function wrongIdx(q) {
    var correct = correctIdx(q);
    return (answers[q.id] || []).filter(function (i) { return correct.indexOf(i) === -1; });
  }
  function byId(id) {
    return BANK.filter(function (q) { return q.id === id; })[0];
  }
  function pool() {
    return filter ? BANK.filter(function (q) { return q.subtest === filter; }) : BANK;
  }
  function track(evt, props) {
    if (L && L.track) { try { L.track(evt, props); } catch (e) { /* tracking never blocks the test */ } }
  }

  // ------------------------------------------------------------ view helpers

  function optionButton(label, text) {
    var b = el('button', 'opt');
    if (label) b.appendChild(el('span', 'opt-key', label));
    if (text) b.appendChild(document.createTextNode(text));
    return b;
  }
  function progressBar(frac) {
    var track = el('div');
    track.style.cssText = 'height:4px;background:var(--bg-soft);margin-bottom:18px';
    var fill = el('div');
    fill.style.cssText = 'height:4px;background:var(--accent);width:' + frac + '%';
    track.appendChild(fill);
    return track;
  }
  function stimulusBlock(text) {
    var box = el('div');
    box.style.cssText = 'font-family:var(--mono);font-size:12.5px;line-height:1.7;white-space:pre;overflow-x:auto;background:var(--bg-soft);border-left:2px solid var(--accent);padding:13px 16px;margin:0 0 16px';
    box.textContent = text;
    return box;
  }
  function para(html, css) {
    var p = el('p');
    if (html) p.innerHTML = html;
    if (css) p.style.cssText = css;
    return p;
  }

  function buildOrder() {
    var g = {};
    pool().forEach(function (q) { (g[q.subtest] = g[q.subtest] || []).push(q); });
    var names = filter ? [filter] : DOMAINS;
    order = [];
    names.forEach(function (d) {
      order = order.concat(shuffle(g[d] || []).map(function (q) { return q.id; }));
    });
  }

  function summary() {
    var per = {};
    pool().forEach(function (q) {
      per[q.subtest] = per[q.subtest] || { total: 0, correct: 0 };
      per[q.subtest].total += 1;
      if (isRight(q)) per[q.subtest].correct += 1;
    });
    var rates = DOMAINS.filter(function (d) { return per[d]; }).map(function (d) {
      return { name: d, total: per[d].total, correct: per[d].correct, rate: per[d].correct / per[d].total };
    });
    var totalCorrect = rates.reduce(function (a, r) { return a + r.correct; }, 0);
    var totalItems = rates.reduce(function (a, r) { return a + r.total; }, 0);
    var totalPct = totalItems ? Math.round((totalCorrect / totalItems) * 100) : 0;

    // Ties are reported as ties. ETS does not publish how 8005 splits its questions
    // across the three domains, so there is no honest weight to break a tie with.
    var min = Math.min.apply(null, rates.map(function (r) { return r.rate; }));
    var tied = rates.filter(function (r) { return r.rate === min; });
    var weakest = null, weakestNote = null;
    if (rates.length === 1) {
      weakest = rates[0].name;
    } else if (tied.length === rates.length) {
      weakestNote = 'Your ' + rates.length + ' content domains came out level on this run, so there is no single weakest domain to point at. At this sample size that is a real result rather than a tie we are dodging.';
    } else if (tied.length > 1) {
      weakest = tied[0].name;
      weakestNote = tied.map(function (r) { return r.name; }).join(' and ') +
        ' scored the same here. ETS does not publish how 8005 divides its questions across the three domains, so we have no honest basis for ranking one over the other \u2014 treat both as your priority.';
    } else {
      weakest = tied[0].name;
    }
    return { rates: rates, totalPct: totalPct, totalItems: totalItems, weakest: weakest, weakestNote: weakestNote };
  }

  function missedIds() {
    return pool().filter(function (q) { return answers[q.id] !== undefined && !isRight(q); })
      .map(function (q) { return q.id; });
  }

  // ------------------------------------------------------------ intro

  function checkSaved() {
    try {
      var raw = localStorage.getItem(STORE_LAST);
      if (!raw) return;
      var last = JSON.parse(raw);
      if (!last || typeof last.total_pct !== 'number') return;
      var note = para('Your last run on this device: <strong>' + last.total_pct + '%</strong> on ' + esc(last.date) +
        '. The result screen compares the two runs.', 'font-size:13.5px;color:var(--ink-soft);line-height:1.6;margin:0 0 16px');
      root.insertBefore(note, root.firstChild);
    } catch (e) { /* storage blocked — nothing to show */ }
  }

  function introMeta() {
    var meta = el('div');
    meta.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--ink-soft);margin:0 0 16px';
    ['30 questions \u00b7 three content domains', '\u2248 30 min', 'Explanation on every item'].forEach(function (t) {
      meta.appendChild(el('span', null, t));
    });
    return meta;
  }

  function renderIntro() {
    root.innerHTML = '';
    var box = el('div', 'ld8-intro');
    box.appendChild(para('<strong>30 questions</strong> across all three official content domains, with an explanation on every item and a domain-level breakdown at the end.',
      'font-size:17px;margin:0 0 10px'));
    box.appendChild(introMeta());
    box.appendChild(para('Original practice items written to the official domain names \u2014 not official ETS questions. Your result is a practice percentage, not a predicted scaled score: ETS publishes no raw-to-scaled conversion for 8005.',
      'font-size:13.5px;color:var(--ink-soft);line-height:1.6;margin:0 0 18px'));
    var btn = el('button', 'btn-primary', 'Start the mini test');
    btn.style.cssText = 'padding:13px 24px;font-size:15px';
    btn.addEventListener('click', start);
    box.appendChild(btn);
    root.appendChild(box);
    checkSaved();
  }

  function renderPracticeIntro() {
    root.innerHTML = '';
    var box = el('div', 'ld8-intro');
    box.appendChild(para('<strong>30 original questions</strong>, ten in each of the three official content domains. Work one domain at a time, or take the whole bank.',
      'font-size:17px;margin:0 0 10px'));
    box.appendChild(para('Answers are graded as you go, and every item carries a full explanation \u2014 including why each tempting wrong option is wrong. A percentage is a percentage: ETS publishes no raw-to-scaled conversion for 8005, so treat the result as a readiness signal.',
      'font-size:13.5px;color:var(--ink-soft);line-height:1.6;margin:0 0 18px'));

    var grid = el('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:0 0 8px';
    var choices = [{ name: 'All three domains', value: null, count: BANK.length }].concat(DOMAINS.map(function (d) {
      return { name: d, value: d, count: BANK.filter(function (q) { return q.subtest === d; }).length };
    }));
    choices.forEach(function (o) {
      var b = optionButton(null, null);
      b.style.fontSize = '13.5px';
      b.appendChild(document.createTextNode(o.name + ' '));
      var c = el('span', null, '(' + o.count + ' questions)');
      c.style.cssText = 'font-family:var(--mono);font-size:12px;color:var(--ink-soft)';
      b.appendChild(c);
      b.addEventListener('click', function () { filter = o.value; start(); });
      grid.appendChild(b);
    });
    box.appendChild(grid);
    root.appendChild(box);
    checkSaved();
  }

  // ------------------------------------------------------------ question view

  function start() {
    answers = {};
    pos = 0;
    buildOrder();
    attemptId = L && L.newAttempt ? L.newAttempt() : null;
    track('test_start', { attempt_id: attemptId });
    renderQuestion();
  }

  function renderQuestion() {
    var q = byId(order[pos]);
    root.innerHTML = '';
    if (!q) {
      // Fail visibly: a resolver miss once left a blank box with no explanation.
      console.error('[quiz-8005] no question resolved for order[' + pos + '] =', order[pos]);
      root.appendChild(para('This question could not be loaded. Please reload the page.',
        'font-size:15px;color:var(--ink-soft);background:var(--bg-soft);border-left:2px solid var(--accent);padding:14px 16px'));
      return;
    }

    var box = el('div', 'ld8-quiz');
    var top = el('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:8px';
    top.appendChild(el('span', null, (pos + 1) + ' / ' + order.length));
    var tag = el('span', null, q.subtest);
    tag.style.cssText = 'font-size:12px;letter-spacing:.06em;color:var(--accent-deep);text-transform:uppercase';
    top.appendChild(tag);
    box.appendChild(top);
    box.appendChild(progressBar(pos / order.length * 100));

    if (q.stimulus) box.appendChild(stimulusBlock(q.stimulus));
    box.appendChild(para(q.q, 'font-size:17px;line-height:1.6;margin:0 0 14px'));

    var wants = correctIdx(q).length;
    var answered = false;
    var picked = [];
    var buttons = [];
    var hint = null;
    var check = null;

    function markAnswered() { answered = true; }

    if (wants > 1) {
      hint = para('Choose ' + numWord(wants) + ' options, then press Check.', 'font-size:13px;color:var(--ink-soft);margin:0 0 10px');
      box.appendChild(hint);
    }

    q.options.forEach(function (opt, idx) {
      var b = optionButton(LETTERS[idx], opt);
      b.addEventListener('click', function () {
        if (answered) return;
        if (wants === 1) {
          picked = [idx];
          grade(q, picked, box, buttons, markAnswered);
          return;
        }
        var at = picked.indexOf(idx);
        if (at === -1) {
          if (picked.length >= wants) {
            hint.textContent = 'You can choose ' + numWord(wants) + ' options. Unselect one first.';
            return;
          }
          picked.push(idx);
          b.classList.add('selected');
        } else {
          picked.splice(at, 1);
          b.classList.remove('selected');
        }
        if (check) check.disabled = picked.length !== wants;
        hint.textContent = picked.length === wants
          ? 'Ready \u2014 press Check.'
          : 'Choose ' + numWord(wants) + ' options, then press Check.';
      });
      buttons.push(b);
      box.appendChild(b);
    });

    if (wants > 1) {
      check = el('button', 'btn-primary', 'Check');
      check.disabled = true;
      check.style.cssText = 'padding:11px 20px;font-size:14px;margin-top:6px';
      check.addEventListener('click', function () {
        if (answered || picked.length !== wants) return;
        grade(q, picked, box, buttons, markAnswered);
      });
      box.appendChild(check);
    }

    root.appendChild(box);
  }

  function grade(q, picked, box, buttons, markAnswered) {
    markAnswered();
    answers[q.id] = picked.slice();
    var correct = correctIdx(q);
    buttons.forEach(function (b, i) {
      b.disabled = true;
      b.classList.remove('selected');
      if (correct.indexOf(i) !== -1) b.classList.add('correct');
      else if (picked.indexOf(i) !== -1) b.classList.add('wrong');
    });

    var right = isRight(q);
    track('question_answer', {
      attempt_id: attemptId,
      correct: right,
      content_domain: q.subtest,
      question_id: q.id
    });

    var ex = el('div');
    ex.style.cssText = 'border-left:2px solid var(--accent);background:var(--bg-soft);padding:13px 16px;margin-top:12px;font-size:13.5px;line-height:1.65';
    ex.appendChild(el('strong', null, right ? 'Correct. ' : 'Not quite. '));

    if (!right) {
      // Misconception coaching: explain the wrong option(s) this visitor actually chose.
      picked.forEach(function (i) {
        if (correct.indexOf(i) !== -1) return;
        var note = q.dex && q.dex[q.options[i]];
        if (note) ex.appendChild(para(note, 'margin:0 0 8px'));
      });
      ex.appendChild(para('Correct answer: ' + esc(correctText(q)), 'margin:0 0 8px'));
    }
    ex.appendChild(para(q.explain, 'margin:0'));
    box.appendChild(ex);

    var next = el('button', 'btn-primary', pos === order.length - 1 ? 'See my results' : 'Next question \u2192');
    next.style.cssText = 'margin-top:14px;padding:11px 20px;font-size:14px';
    next.addEventListener('click', function () {
      if (pos === order.length - 1) finish();
      else { pos += 1; renderQuestion(); }
    });
    box.appendChild(next);
    if (next.scrollIntoView) next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ------------------------------------------------------------ result view

  function finish() {
    var s = summary();
    track('test_complete', { attempt_id: attemptId, score_band: band(s.totalPct), weakest_domain: s.weakest });
    if (L && L.flushNow) L.flushNow();
    try {
      localStorage.setItem(STORE_LAST, JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        total_pct: s.totalPct,
        weakest: s.weakest,
        missed: missedIds()
      }));
    } catch (e) { /* storage blocked — the result still renders */ }
    renderResult(s);
  }

  function renderResult(s) {
    root.innerHTML = '';
    var box = el('div', 'ld8-result');
    box.appendChild(el('span', 'eyebrow', MODE === 'practice' ? 'Your practice result' : 'Your mini test result'));

    try {
      var prevRaw = localStorage.getItem(STORE_PREV);
      if (prevRaw) {
        var prev = JSON.parse(prevRaw);
        if (prev && typeof prev.total_pct === 'number') {
          box.appendChild(para('Last time: ' + prev.total_pct + '% \u2192 now ' + s.totalPct + '%' +
            (s.totalPct > prev.total_pct ? ' \u2014 improving.' : s.totalPct < prev.total_pct ? ' \u2014 a dip; revisit the plan below.' : ' \u2014 steady.'),
            'font-size:14px;color:var(--ink-soft);margin:6px 0 0'));
        }
      }
    } catch (e) { /* ignore */ }

    box.appendChild(para('<span style="font-family:var(--serif);font-size:42px;color:var(--accent-deep)">' + s.totalPct + '%</span>' +
      ' <span style="font-size:14px;color:var(--ink-soft)">of ' + s.totalItems +
      ' practice items correct \u2014 a practice percentage, not a predicted scaled score.</span>', 'margin:10px 0 4px'));

    box.appendChild(para('<span class="eyebrow" style="display:block;margin-top:22px">By content domain</span>'));
    s.rates.forEach(function (r) {
      var row = el('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 70px;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px';
      row.appendChild(para(esc(r.name) + ' <span style="color:var(--ink-soft)">(' + r.correct + '/' + r.total + ')</span>' +
        (s.weakest === r.name ? ' <strong style="color:var(--accent-deep)">\u2014 start here</strong>' : ''), 'margin:0'));
      var bar = el('div');
      bar.style.cssText = 'height:8px;background:var(--bg-soft)';
      var fill = el('div');
      fill.style.cssText = 'height:8px;background:var(--accent);width:' + Math.max(5, Math.round(r.rate * 100)) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      box.appendChild(row);
    });

    var advice = el('div');
    advice.style.cssText = 'margin-top:18px;font-size:14.5px;line-height:1.65';
    if (s.weakestNote) {
      advice.appendChild(para(s.weakestNote));
    } else {
      advice.appendChild(para('Your lowest-scoring domain on this run is <strong>' + esc(s.weakest) + '</strong>. At ' +
        s.totalItems + ' items that is a signal, not a diagnosis \u2014 but it is where the next study session should go.'));
    }
    advice.appendChild(para('Next steps: reread the domain description above, work the misses listed below, and retake this set in 7\u201310 days. Retaking without changing how you study rarely moves the number.'));
    box.appendChild(advice);

    var missedQs = pool().filter(function (q) { return answers[q.id] !== undefined && !isRight(q); });
    if (missedQs.length) {
      box.appendChild(para('<span class="eyebrow" style="display:block">Review your misses (' + missedQs.length + ')</span>', 'margin-top:24px'));
      missedQs.forEach(function (q) {
        var item = el('div');
        item.style.cssText = 'border-top:1px solid var(--line);padding:13px 0;font-size:13.5px;line-height:1.6';
        var html = '<p style="margin:0 0 4px">' + esc(q.q) + '</p>' +
          '<p style="margin:0;color:var(--wrong)">Your answer: ' + esc(chosenText(q)) + '</p>' +
          '<p style="margin:0 0 4px;color:var(--correct)">Correct answer: ' + esc(correctText(q)) + '</p>';
        wrongIdx(q).forEach(function (i) {
          var note = q.dex && q.dex[q.options[i]];
          if (note) html += '<p style="margin:0 0 4px;color:var(--ink-soft)">' + esc(note) + '</p>';
        });
        html += '<p style="margin:0;color:var(--ink-soft)">' + esc(q.explain) + '</p>';
        item.innerHTML = html;
        box.appendChild(item);
      });
    }

    var actions = el('div');
    actions.style.cssText = 'margin-top:24px;display:flex;gap:14px;flex-wrap:wrap';
    var again = el('button', 'btn-primary', MODE === 'practice' ? 'Retake this set' : 'Re-take the mini test');
    again.style.cssText = 'padding:12px 20px;font-size:14px';
    again.addEventListener('click', function () {
      attemptId = L && L.newAttempt ? L.newAttempt() : null;
      track('retest_start', { attempt_id: attemptId });
      start();
    });
    actions.appendChild(again);
    if (MODE === 'practice') {
      var other = el('button', 'opt', 'Choose another domain');
      other.style.cssText = 'width:auto;margin-bottom:0';
      other.addEventListener('click', function () { filter = null; renderPracticeIntro(); });
      actions.appendChild(other);
    }
    box.appendChild(actions);

    root.appendChild(box);
    if (L && L.observeOnce) L.observeOnce(box, 'result_view', { score_band: band(s.totalPct), weakest_domain: s.weakest });
    if (root.scrollIntoView) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------ boot

  if (MODE === 'practice') renderPracticeIntro();
  else renderIntro();
  track('test_view');
})();
