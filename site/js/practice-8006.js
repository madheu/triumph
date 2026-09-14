// practice-8006.js — Praxis 8006 full practice test engine (200 questions,
// single-select + multiple-select) with a session gate:
//   guest → 5 questions per visit · free account → 30 per visit · pro → full bank.
// "Per visit" = per page load; a fresh page load starts a new session.
//
// Follows quiz-8006.js conventions (vanilla JS, no framework):
//   - NO scaled score, NO pass probability. A percentage is a percentage.
//   - single-select: tap an option → graded immediately.
//   - multiple-select: toggle options → Check → graded as a set.
//   - domain filter on the start screen; misses can be redone at the end.
//   - tracking via LDTrack (test_view / test_start / question_answer /
//     test_complete / retest_start).
(function () {
  'use strict';

  var BANK = window.DM_BANK_8006_FULL;
  var T = window.TriumphAuth;
  var L = window.LDTrack;
  var root = document.getElementById('full-test');
  if (!root || !BANK || !BANK.length) return;

  var DOMAINS = ['Foundational Literacy Skills', 'Fluency and Vocabulary', 'Comprehension and Written Expression'];
  var DOMAIN_SHORT = {
    'Foundational Literacy Skills': 'Foundational Literacy',
    'Fluency and Vocabulary': 'Fluency & Vocabulary',
    'Comprehension and Written Expression': 'Comprehension & Written Expression'
  };
  var answers = {};      // id -> index (single) | array of indices (multi)
  var answered = {};     // id -> true once graded
  var order = [];        // active question objects
  var pos = 0;
  var phase = 'start';   // start | quiz | done
  var attemptId = null;

  // ------------------------------------------------------------ session gate
  var LIMITS = { guest: 5, free: 30, pro: Infinity };
  var tier = T && T.isLoggedIn() ? 'free' : 'guest';
  var seen = {};          // question ids served this session (gate accounting)
  var gateFired = false;  // signup_prompt_view fires at most once per session

  function seenCount() { return Object.keys(seen).length; }
  function quotaLeft() { return Math.max(0, LIMITS[tier] - seenCount()); }
  function usedUp() { return tier !== 'pro' && quotaLeft() <= 0; }

  // refine tier in the background: dead token → guest, pro plan → unlimited
  if (tier === 'free' && T && T.token) {
    fetch('/api/me', { headers: { Authorization: 'Bearer ' + T.token } })
      .then(function (r) { return r.status === 401 ? { dead: true } : (r.ok ? r.json() : null); })
      .then(function (s) {
        if (!s) return;
        if (s.dead) tier = 'guest';
        else if (s.entitlements && s.entitlements.plan === 'pro') tier = 'pro';
        if (phase === 'start') render();
      })
      .catch(function () {});
  }

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
  function letter(i) { return String.fromCharCode(65 + i); }

  function isCorrect(q) {
    var a = answers[q.id];
    if (a === undefined) return false;
    if (q.multi) {
      if (!Array.isArray(a) || !a.length) return false;
      var want = q.answers.slice().sort();
      var got = a.slice().sort();
      if (want.length !== got.length) return false;
      for (var i = 0; i < want.length; i++) if (want[i] !== got[i]) return false;
      return true;
    }
    return a === q.answer;
  }

  function summary() {
    var per = {};
    order.forEach(function (q) {
      per[q.subtest] = per[q.subtest] || { total: 0, correct: 0 };
      per[q.subtest].total += 1;
      if (answered[q.id] && isCorrect(q)) per[q.subtest].correct += 1;
    });
    var total = 0, correct = 0, graded = 0;
    order.forEach(function (q) {
      total += 1;
      if (answered[q.id]) { graded += 1; if (isCorrect(q)) correct += 1; }
    });
    var weakest = null;
    DOMAINS.forEach(function (d) {
      if (!per[d]) return;
      if (per[d].total < 3) return;
      var r = per[d].correct / per[d].total;
      if (weakest === null || r < per[weakest].correct / per[weakest].total) weakest = d;
    });
    return { per: per, total: total, correct: correct, graded: graded, weakest: weakest };
  }

  // ------------------------------------------------------------ render

  function render() {
    root.innerHTML = '';
    if (phase === 'start') renderStart();
    else if (phase === 'quiz') renderQuiz();
    else renderDone();
  }

  function renderStart() {
    var box = el('div', 'pt-start');
    box.appendChild(el('p', 'eyebrow', 'Full practice bank'));
    box.appendChild(el('h2', null, 'Praxis 8006 Teaching Reading — ' + BANK.length + ' original questions'));

    var counts = {};
    BANK.forEach(function (q) { counts[q.subtest] = (counts[q.subtest] || 0) + 1; });

    var meta = el('p', 'meta-line');
    meta.textContent = DOMAINS.map(function (d) { return DOMAIN_SHORT[d] + ': ' + (counts[d] || 0); }).join(' · ');
    box.appendChild(meta);

    box.appendChild(el('p', null, 'Single-answer questions are graded the moment you pick. "Select all that apply" questions wait until you press Check. Nothing is timed — you can leave and restart any time.'));

    if (usedUp()) {
      box.appendChild(gateBox());
      root.appendChild(box);
      return;
    }

    var note = el('p', 'pt-quota');
    if (tier === 'guest') {
      note.innerHTML = 'Guest preview — <strong>' + LIMITS.guest + ' questions per visit</strong>, drawn at random from the category you choose. <a href="/login?next=/praxis-8006-practice">Create a free account</a> for 30 per session.';
    } else if (tier === 'free') {
      note.innerHTML = 'Free plan — <strong>' + LIMITS.free + ' questions per visit</strong>, drawn at random from the category you choose. <a href="/upgrade.html">Go Pro</a> for the full ' + BANK.length + '-question bank.';
    } else {
      note.textContent = 'Pro access — the full ' + BANK.length + '-question bank, no session limit.';
    }
    box.appendChild(note);

    var opts = el('div', 'pt-domain-opts');
    ['ALL'].concat(DOMAINS).forEach(function (d, i) {
      var b = el('button', 'pt-domain-btn' + (i === 0 ? ' active' : ''));
      b.type = 'button';
      b.textContent = d === 'ALL' ? 'All questions (' + BANK.length + ')' : DOMAIN_SHORT[d] + ' (' + (counts[d] || 0) + ')';
      b.onclick = function () {
        opts.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      };
      opts.appendChild(b);
    });
    box.appendChild(opts);

    var go = el('button', 'btn-primary');
    go.type = 'button';
    go.textContent = 'Start practicing →';
    go.onclick = function () {
      var active = opts.querySelector('button.active');
      var pick = !active || active.textContent.indexOf('All questions') === 0 ? 'ALL'
        : DOMAINS.filter(function (d) { return active.textContent.indexOf(DOMAIN_SHORT[d]) === 0; })[0];
      var pool = pick === 'ALL' ? BANK : BANK.filter(function (q) { return q.subtest === pick; });
      var left = quotaLeft();
      if (tier !== 'pro') pool = pool.filter(function (q) { return !seen[q.id]; });
      if (!pool.length) { render(); return; }
      order = shuffle(pool);
      var cappedNow = tier !== 'pro' && order.length > left;
      if (cappedNow) order = order.slice(0, left);
      order.forEach(function (q) { seen[q.id] = true; });
      answers = {}; answered = {}; pos = 0; phase = 'quiz';
      if (L) { attemptId = L.newAttempt(); L.track('test_start', { attempt_id: attemptId, mode: 'full', size: order.length, tier: tier, capped: cappedNow }); }
      render();
      window.scrollTo(0, root.getBoundingClientRect().top + window.scrollY - 20);
    };
    box.appendChild(go);
    root.appendChild(box);
  }

  function renderQuiz() {
    if (pos >= order.length) { finish(); return; }
    var q = order[pos];
    var graded = !!answered[q.id];
    var picked = answers[q.id];

    var box = el('div', 'pt-quiz');

    // progress + domain tag
    var top = el('div', 'pt-top');
    var tag = el('span', 'pt-tag', q.multi ? 'Select all that apply' : DOMAIN_SHORT[q.subtest] || q.subtest);
    if (q.multi) tag.classList.add('pt-tag-multi');
    top.appendChild(tag);
    top.appendChild(el('span', 'pt-count', (pos + 1) + ' / ' + order.length));
    box.appendChild(top);

    var bar = el('div', 'pt-bar');
    var fill = el('div', 'pt-bar-fill');
    fill.style.width = Math.round((pos / order.length) * 100) + '%';
    bar.appendChild(fill);
    box.appendChild(bar);

    // stimulus / stem (stimulus was folded into q by the bank builder)
    box.appendChild(el('p', 'pt-q', q.q));

    // options
    var opts = el('div', 'pt-options');
    q.options.forEach(function (text, i) {
      var b = el('button', 'opt');
      b.type = 'button';
      b.disabled = graded;
      var key = el('span', 'opt-key', letter(i));
      b.appendChild(key);
      b.appendChild(document.createTextNode(text));
      if (graded) {
        var ok = q.multi ? q.answers.indexOf(i) >= 0 : i === q.answer;
        var chosen = q.multi ? (Array.isArray(picked) && picked.indexOf(i) >= 0) : picked === i;
        if (ok) b.classList.add('correct');
        else if (chosen) b.classList.add('wrong');
      } else if (q.multi && Array.isArray(picked) && picked.indexOf(i) >= 0) {
        b.classList.add('selected');
      } else if (!q.multi && picked === i) {
        b.classList.add('selected');
      }
      b.onclick = function () { choose(q, i); };
      opts.appendChild(b);
    });
    box.appendChild(opts);

    // feedback / controls
    var fb = el('div', 'pt-feedback');
    if (graded) {
      var ok = isCorrect(q);
      var p = el('p', 'pt-verdict ' + (ok ? 'pt-ok' : 'pt-no'), ok ? 'Correct.' : 'Not quite.');
      fb.appendChild(p);
      var ex = el('p', 'pt-explain');
      var answerText = q.multi ? q.answers.map(function (i) { return letter(i); }).join(', ') : letter(q.answer);
      ex.innerHTML = '<strong>Answer: ' + answerText + '.</strong> ' + esc(q.explain);
      fb.appendChild(ex);
      if (!ok && q.dex) {
        var firstWrong = q.options.filter(function (t, i) {
          return (q.multi ? q.answers.indexOf(i) < 0 && Array.isArray(picked) && picked.indexOf(i) >= 0 : picked === i);
        })[0];
        if (firstWrong && q.dex[firstWrong]) {
          var dx = el('p', 'pt-explain');
          dx.innerHTML = '<em>Why ' + esc(String.fromCharCode(65 + q.options.indexOf(firstWrong))) + ' is tempting:</em> ' + esc(q.dex[firstWrong]);
          fb.appendChild(dx);
        }
      }
      fb.appendChild(navRow(q));
    } else if (q.multi) {
      var check = el('button', 'btn-primary');
      check.type = 'button';
      check.textContent = 'Check answers';
      check.onclick = function () {
        if (!Array.isArray(answers[q.id]) || !answers[q.id].length) return;
        grade(q);
      };
      fb.appendChild(check);
    }
    box.appendChild(fb);

    root.appendChild(box);
  }

  function navRow(q) {
    var row = el('div', 'pt-nav');
    if (pos > 0) {
      var prev = el('button', 'pt-ghost');
      prev.type = 'button'; prev.textContent = '← Previous';
      prev.onclick = function () { pos--; render(); };
      row.appendChild(prev);
    }
    var spacer = el('span'); spacer.style.flex = '1'; row.appendChild(spacer);
    var next = el('button', 'btn-primary');
    next.type = 'button';
    next.textContent = pos === order.length - 1 ? 'Finish →' : 'Next →';
    next.onclick = function () { pos++; render(); };
    row.appendChild(next);
    return row;
  }

  function choose(q, i) {
    if (answered[q.id]) return;
    if (q.multi) {
      var cur = Array.isArray(answers[q.id]) ? answers[q.id].slice() : [];
      var at = cur.indexOf(i);
      if (at >= 0) cur.splice(at, 1); else cur.push(i);
      answers[q.id] = cur;
      render();
    } else {
      answers[q.id] = i;
      grade(q);
    }
  }

  function grade(q) {
    if (answered[q.id]) return;
    answered[q.id] = true;
    if (L) L.track('question_answer', {
      attempt_id: attemptId,
      question_id: q.id,
      correct: isCorrect(q),
      domain: q.subtest
    });
    render();
  }

  function finish() {
    phase = 'done';
    if (L) {
      var s = summary();
      L.track('test_complete', {
        attempt_id: attemptId,
        score_band: band(s.total ? Math.round(100 * s.correct / s.total) : 0),
        graded: s.graded,
        weakest_domain: s.weakest,
        tier: tier
      });
    }
    render();
  }

  // Gate card shown when the session quota is used up (start screen) or
  // when a capped run finishes (results screen).
  function gateBox() {
    var g = el('div', 'pt-gate');
    var cta = el('a', 'btn-primary');
    cta.style.textDecoration = 'none';
    cta.style.display = 'inline-block';
    if (tier === 'guest') {
      g.appendChild(el('p', 'eyebrow', 'Guest limit reached'));
      g.appendChild(el('h3', null, 'You\u2019ve used your ' + LIMITS.guest + ' guest questions for this visit'));
      g.appendChild(el('p', null, 'A free account unlocks 30 questions per session, with results and weakest categories saved across visits.'));
      cta.href = '/login?next=/praxis-8006-practice';
      cta.textContent = 'Create a free account \u2192';
      if (L && !gateFired) { gateFired = true; L.track('signup_prompt_view', { source: 'practice-8006', tier: tier }); }
    } else {
      g.appendChild(el('p', 'eyebrow', 'Free plan limit'));
      g.appendChild(el('h3', null, 'You\u2019ve used your ' + LIMITS.free + ' questions for this visit'));
      g.appendChild(el('p', null, 'Pro unlocks the full ' + BANK.length + '-question bank with unlimited sessions.'));
      cta.href = '/upgrade.html';
      cta.textContent = 'Unlock the full bank \u2192';
    }
    g.appendChild(cta);
    return g;
  }

  function renderDone() {
    var s = summary();
    var pct = s.total ? Math.round(100 * s.correct / s.total) : 0;
    var box = el('div', 'pt-done');

    box.appendChild(el('p', 'eyebrow', 'Results'));
    box.appendChild(el('h2', null, s.correct + ' / ' + s.total + ' correct (' + pct + '%)'));
    if (s.graded < s.total) {
      box.appendChild(el('p', 'meta-line', s.graded + ' of ' + s.total + ' questions answered.'));
    }

    var list = el('div', 'pt-perdomain');
    DOMAINS.forEach(function (d) {
      if (!s.per[d]) return;
      var row = el('div', 'pt-pd-row');
      row.appendChild(el('span', 'pt-pd-name', DOMAIN_SHORT[d]));
      var barw = s.per[d].total ? Math.round(100 * s.per[d].correct / s.per[d].total) : 0;
      var bar = el('div', 'pt-pd-bar');
      var fill = el('div', 'pt-bar-fill');
      fill.style.width = barw + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('span', 'pt-pd-num', s.per[d].correct + '/' + s.per[d].total));
      list.appendChild(row);
    });
    box.appendChild(list);

    if (s.weakest) {
      box.appendChild(el('p', 'pt-weakest', 'Weakest category: ' + DOMAIN_SHORT[s.weakest] + '. Target it first in your next session.'));
    }

    box.appendChild(el('p', null, 'A percentage is a percentage — ETS publishes no scaled conversion for 8006, so treat this as readiness signal, not a score prediction.'));

    if (usedUp()) box.appendChild(gateBox());

    var row = el('div', 'pt-nav');
    var misses = order.filter(function (q) { return answered[q.id] && !isCorrect(q); });
    if (misses.length) {
      var redo = el('button', 'btn-primary');
      redo.type = 'button'; redo.textContent = 'Redo misses (' + misses.length + ')';
      redo.onclick = function () {
        order = shuffle(misses);
        answers = {}; answered = {}; pos = 0; phase = 'quiz';
        if (L) { attemptId = L.newAttempt(); L.track('retest_start', { attempt_id: attemptId }); }
        render();
      };
      row.appendChild(redo);
    }
    var spacer = el('span'); spacer.style.flex = '1'; row.appendChild(spacer);
    var restart = el('button', 'pt-ghost');
    restart.type = 'button'; restart.textContent = 'Start over';
    restart.onclick = function () { phase = 'start'; render(); };
    row.appendChild(restart);
    box.appendChild(row);

    root.appendChild(box);
  }

  if (L) L.track('test_view');
  render();
})();
