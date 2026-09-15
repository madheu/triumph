// quiz-8003.js — Praxis 8003 mini test engine (30 items, 3 official domains,
// three question types: single-select, multiple-select, numeric-entry).
//
// Scope decisions:
//   - NO scaled score, NO pass probability anywhere. ETS publishes no
//     raw-to-scaled conversion for the 8000 series; a percentage is a percentage.
//     The result card links out to /score-calculator instead of guessing.
//   - numeric-entry is graded numerically (tolerance 1e-9), not as a string
//     match, so "12", "12.0" and " 12 " all score. Non-numeric input is
//     rejected with a prompt rather than silently marked wrong.
//   - multiple-select is graded as a set: exactly the correct two, no more.
//   - Weakest domain: lowest rate wins; ties broken by official weight
//     (Numbers and Operations 28 items > Algebraic 20 = Geometry 20);
//     a three-way tie outputs "close across domains" instead of a fake winner.
//   - Reads schema v1 items directly (window.DM_BANK_8003), so the bank file
//     is the single source of truth and no build step can drift from it.
//   - vanilla JS, no framework — the article content around it is static HTML.
(function () {
  'use strict';

  var BANK = window.DM_BANK_8003;
  var T = window.TriumphAuth;
  var L = window.LDTrack;
  var root = document.getElementById('mini-test');
  if (!root || !BANK || !BANK.length) return;

  var DOMAINS = ['Numbers and Operations', 'Algebraic Thinking', 'Geometry, Measurement and Data'];
  // 相对权重（官方题量 28 / 20 / 20），只用于并列时的优先级，不是百分比本身。
  var DOMAIN_WEIGHT = { 'Numbers and Operations': 3, 'Algebraic Thinking': 2, 'Geometry, Measurement and Data': 2 };
  var API = window.TRIUMPH_API || '';
  var CFG = {
    testCode: '8003',
    bankId: '8003',
    storeKey: 'ld_8003_last',
    prevKey: 'ld_8003_prev',
    apiTestKey: '8003',
    attemptField: 'attempt_8003',
  };
  var attemptId = null;
  var answers = {};      // id -> selected option text | array of texts | numeric string
  var order = [];        // question ids in presentation order
  var pos = 0;
  var finished = false;
  var registered = false;
  var pending = { email: '', requestId: null, method: 'magic_code' };
  var pollTimer = null;

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

  function byDomain() {
    var g = {};
    BANK.forEach(function (q) { (g[q.content_domain] = g[q.content_domain] || []).push(q); });
    return g;
  }

  // ------------------------------------------------------------ grading

  // "12", "12.0", " 12 ", "1,250", "-3.5" are all numbers; "12%" or "3/4" are not.
  function numericValue(s) {
    var t = String(s === null || s === undefined ? '' : s).trim().replace(/,/g, '');
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
    var v = parseFloat(t);
    return isFinite(v) ? v : null;
  }
  function sameNumber(a, b) {
    var va = numericValue(a);
    var vb = numericValue(b);
    if (va === null || vb === null) return false;
    return Math.abs(va - vb) <= 1e-9;
  }
  function sameSet(picked, want) {
    if (!Array.isArray(picked) || !Array.isArray(want)) return false;
    if (picked.length !== want.length) return false;
    for (var i = 0; i < want.length; i++) {
      if (picked.indexOf(want[i]) === -1) return false;
    }
    return true;
  }
  /** 判分总入口：题型分流。返回 'correct' | 'wrong' | 'invalid'。 */
  function grade(q, given) {
    if (q.question_type === 'numeric-entry') {
      if (numericValue(given) === null) return 'invalid';
      return sameNumber(given, q.correct_answer) ? 'correct' : 'wrong';
    }
    if (q.question_type === 'multiple-select') {
      return sameSet(given, q.correct_answer) ? 'correct' : 'wrong';
    }
    return given === q.correct_answer ? 'correct' : 'wrong';
  }
  function isCorrect(q) {
    return grade(q, answers[q.id]) === 'correct';
  }
  /** 考生作答的可读文本（结果页与 miss 列表用）。 */
  function answerText(q, given) {
    if (given === undefined || given === null) return '(left blank)';
    if (Array.isArray(given)) return given.length ? given.join(' + ') : '(nothing selected)';
    return String(given);
  }
  function correctText(q) {
    return Array.isArray(q.correct_answer) ? q.correct_answer.join(' + ') : String(q.correct_answer);
  }

  function buildOrder() {
    var g = byDomain();
    order = [];
    // order 存的是 id 列表 —— renderQuestion 用 x.id === order[pos] 反查题目。
    DOMAINS.forEach(function (d) {
      order = order.concat(shuffle(g[d] || []).map(function (q) { return q.id; }));
    });
  }
  function qById(id) {
    return BANK.filter(function (x) { return x.id === id; })[0] || null;
  }

  function summary() {
    var per = {};
    BANK.forEach(function (q) {
      per[q.content_domain] = per[q.content_domain] || { total: 0, correct: 0 };
      per[q.content_domain].total += 1;
      if (isCorrect(q)) per[q.content_domain].correct += 1;
    });
    var totalCorrect = 0;
    DOMAINS.forEach(function (d) { totalCorrect += per[d].correct; });
    var totalPct = Math.round((totalCorrect / BANK.length) * 100);
    var rates = DOMAINS.map(function (d) {
      return { name: d, total: per[d].total, correct: per[d].correct, rate: per[d].correct / per[d].total };
    });
    var min = Math.min.apply(null, rates.map(function (r) { return r.rate; }));
    var tied = rates.filter(function (r) { return r.rate === min; });
    var weakest = null;
    var weakestNote = null;
    if (tied.length === rates.length) {
      weakestNote = 'Your three domains are close — balanced review across all three is the right call at this sample size.';
    } else if (tied.length > 1) {
      tied.sort(function (a, b) { return DOMAIN_WEIGHT[b.name] - DOMAIN_WEIGHT[a.name]; });
      weakest = tied[0].name;
      weakestNote = tied.map(function (r) { return r.name; }).join(' and ') +
        ' are tied — we point you at ' + weakest + ' first because it carries the largest share of the test.';
    } else {
      weakest = tied[0].name;
    }
    return { per: per, totalPct: totalPct, rates: rates, weakest: weakest, weakestNote: weakestNote };
  }

  function missed() {
    return BANK.filter(function (q) { return answers[q.id] !== undefined && !isCorrect(q); })
      .map(function (q) { return q.id; });
  }

  // ------------------------------------------------------------ views

  function renderIntro() {
    root.innerHTML = '';
    var box = el('div', 'ld8-intro');
    var h = el('p', null, null);
    h.style.cssText = 'font-size:17px;margin:0 0 10px';
    h.innerHTML = '<strong>30 questions</strong> drawn from all three official content domains, with a per-question ' +
      'explanation. Four of them are numeric-entry — you type the answer instead of picking one. Free, no account needed to see your results.';
    var meta = el('div', 'meta');
    meta.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--ink-soft);margin:0 0 16px';
    ['30 questions · 12/9/9 by domain', '4 numeric-entry · 3 multiple-select', '≈ 35–40 min', 'Explanations on every item'].forEach(function (t) {
      meta.appendChild(el('span', null, t));
    });
    var note = el('p', null, 'Original practice items written to the official content category definitions — not official ETS questions. Your result is a domain-level percentage, not a predicted scaled score (ETS publishes no raw-to-scaled conversion for the 8000 series).');
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

  function header(box, q) {
    var top = el('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:8px';
    top.appendChild(el('span', null, (pos + 1) + ' / ' + order.length));
    var cat = el('span', null, q.content_domain);
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
    qEl.style.cssText = 'font-size:17px;line-height:1.6;margin:0 0 8px';
    qEl.textContent = q.stem;
    box.appendChild(qEl);
  }

  /** 题型提示行：告诉考生这题是哪种作答方式（numeric-entry 必须写清输入格式）。 */
  function typeHint(box, q) {
    var map = {
      'single-select': 'Select one answer.',
      'multiple-select': 'Select exactly two answers, then press Check.',
      'numeric-entry': 'Type your answer in the box, then press Check. Enter digits only, no units or percent signs.',
    };
    var p = el('p', null, map[q.question_type] || '');
    p.style.cssText = 'font-size:12.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-soft);margin:0 0 14px';
    box.appendChild(p);
  }

  function feedback(box, q, given, status) {
    var ex = el('div', null, null);
    ex.style.cssText = 'border-left:2px solid var(--accent);background:var(--bg-soft);padding:13px 16px;margin-top:12px;font-size:13.5px;line-height:1.65';
    var verdict = status === 'correct' ? 'Correct. ' : (status === 'invalid' ? 'Not a number we can grade. ' : 'Not quite. ');
    ex.appendChild(el('strong', null, verdict));

    var body = '';
    // 选择题：答错时先讲清所选的那个坑点，再讲正确答案
    if (status === 'wrong' && q.distractor_explanations) {
      var picks = Array.isArray(given) ? given : [given];
      var parts = [];
      picks.forEach(function (p) {
        if (q.distractor_explanations[p]) parts.push(q.distractor_explanations[p]);
      });
      if (parts.length) body += parts.join(' ') + ' ';
    }
    if (status !== 'correct') {
      body += 'Correct answer: ' + correctText(q) + '. ';
    }
    body += q.explanation;
    ex.appendChild(document.createTextNode(body));
    box.appendChild(ex);

    var next = el('button', 'btn-primary', pos === order.length - 1 ? 'See my results' : 'Next question \u2192');
    next.style.cssText = 'margin-top:14px;padding:11px 20px;font-size:14px';
    next.addEventListener('click', function () {
      if (pos === order.length - 1) { finish(); } else { pos += 1; renderQuestion(); }
    });
    box.appendChild(next);
    next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function trackAnswer(q, correct) {
    if (L) L.track('question_answer', {
      attempt_id: attemptId,
      correct: correct,
      content_domain: q.content_domain,
      question_id: q.id,
      question_type: q.question_type,
    });
  }

  /** numeric-entry：数字输入框 + 数值判分（不是字符串比对）。 */
  function renderNumeric(box, q) {
    var row = el('div');
    row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:4px 0 6px';
    var input = el('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Your numeric answer');
    input.placeholder = 'Type a number';
    input.style.cssText = 'flex:1;min-width:180px;padding:12px 14px;font-size:15px;font-family:var(--mono);color:var(--ink);background:var(--bg);border:1px solid var(--line);outline:none';
    var check = el('button', 'btn-primary', 'Check');
    check.style.cssText = 'padding:12px 22px;font-size:14px';
    row.appendChild(input);
    row.appendChild(check);
    box.appendChild(row);

    var hint = el('p');
    hint.style.cssText = 'font-size:12.5px;color:var(--accent-deep);margin:0;min-height:1em';
    box.appendChild(hint);

    function submit() {
      var raw = (input.value || '').trim();
      if (!raw) { hint.textContent = 'Enter your answer first.'; return; }
      var status = grade(q, raw);
      if (status === 'invalid') {
        hint.textContent = 'We can only grade a number here — digits, a decimal point, and a minus sign if needed. No units or percent signs.';
        input.focus();
        return;
      }
      answers[q.id] = raw;
      input.disabled = true;
      check.disabled = true;
      input.style.borderColor = status === 'correct' ? '#7D9378' : '#B46F6A';
      input.style.background = status === 'correct' ? '#EFF2EA' : '#F6EAE8';
      hint.textContent = '';
      trackAnswer(q, status === 'correct');
      feedback(box, q, raw, status);
    }

    check.addEventListener('click', submit);
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
    input.focus();
  }

  /** single-select：点一下即判分。 */
  function renderSingle(box, q) {
    var answered = false;
    q.choices.forEach(function (opt) {
      var b = el('button', 'opt', opt);
      b.style.cssText = 'display:block;width:100%;text-align:left;padding:11px 14px;margin:8px 0;font-size:14.5px;line-height:1.5;color:var(--ink);background:var(--bg);border:1px solid var(--line);cursor:pointer;font-family:var(--sans)';
      b.addEventListener('click', function () {
        if (answered) return;
        answered = true;
        answers[q.id] = opt;
        var buttons = box.querySelectorAll('button.opt');
        for (var i = 0; i < buttons.length; i++) {
          buttons[i].disabled = true;
          if (q.choices[i] === q.correct_answer) { buttons[i].style.borderColor = '#7D9378'; buttons[i].style.background = '#EFF2EA'; }
          else if (q.choices[i] === opt) { buttons[i].style.borderColor = '#B46F6A'; buttons[i].style.background = '#F6EAE8'; }
        }
        trackAnswer(q, opt === q.correct_answer);
        feedback(box, q, opt, opt === q.correct_answer ? 'correct' : 'wrong');
      });
      box.appendChild(b);
    });
  }

  /** multiple-select：可多选，按 Check 后按集合判分（必须恰好两项）。 */
  function renderMulti(box, q) {
    var picked = [];
    var answered = false;
    var buttons = [];

    q.choices.forEach(function (opt) {
      var b = el('button', 'opt', opt);
      b.style.cssText = 'display:block;width:100%;text-align:left;padding:11px 14px;margin:8px 0;font-size:14.5px;line-height:1.5;color:var(--ink);background:var(--bg);border:1px solid var(--line);cursor:pointer;font-family:var(--sans)';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        if (answered) return;
        var i = picked.indexOf(opt);
        if (i === -1) {
          if (picked.length >= 2) { hint.textContent = 'Choose exactly two — deselect one first.'; return; }
          picked.push(opt);
        } else {
          picked.splice(i, 1);
        }
        b.setAttribute('aria-pressed', picked.indexOf(opt) === -1 ? 'false' : 'true');
        b.style.borderColor = picked.indexOf(opt) === -1 ? 'var(--line)' : 'var(--accent)';
        b.style.background = picked.indexOf(opt) === -1 ? 'var(--bg)' : 'var(--accent-soft)';
        hint.textContent = picked.length === 2 ? 'Two selected — press Check.' : 'Selected ' + picked.length + ' of 2.';
      });
      buttons.push(b);
      box.appendChild(b);
    });

    var row = el('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    var check = el('button', 'btn-primary', 'Check');
    check.style.cssText = 'padding:11px 22px;font-size:14px';
    var hint = el('p');
    hint.style.cssText = 'font-size:12.5px;color:var(--accent-deep);margin:0;min-height:1em';
    row.appendChild(check);
    row.appendChild(hint);
    box.appendChild(row);

    check.addEventListener('click', function () {
      if (answered) return;
      if (picked.length !== 2) { hint.textContent = 'Select exactly two answers before checking.'; return; }
      answered = true;
      answers[q.id] = picked.slice();
      check.disabled = true;
      hint.textContent = '';
      buttons.forEach(function (b) {
        var isWant = q.correct_answer.indexOf(b.textContent) !== -1;
        var isPicked = picked.indexOf(b.textContent) !== -1;
        b.disabled = true;
        if (isWant) { b.style.borderColor = '#7D9378'; b.style.background = '#EFF2EA'; }
        else if (isPicked) { b.style.borderColor = '#B46F6A'; b.style.background = '#F6EAE8'; }
      });
      var status = grade(q, answers[q.id]);
      trackAnswer(q, status === 'correct');
      feedback(box, q, answers[q.id], status);
    });
  }

  function renderQuestion() {
    var q = qById(order[pos]);
    root.innerHTML = '';
    // Defensive: a resolver miss must fail loudly-but-visibly instead of
    // leaving an empty box with no explanation.
    if (!q) {
      console.error('[quiz-8003] no question resolved for order[' + pos + '] =', order[pos]);
      var err = el('p', null, 'This question could not be loaded. Please reload the page.');
      err.style.cssText = 'font-size:15px;color:var(--ink-soft);background:var(--bg-soft);border-left:2px solid #B46F6A;padding:14px 16px';
      root.appendChild(err);
      return;
    }
    var box = el('div', 'ld8-quiz');
    header(box, q);
    typeHint(box, q);
    if (q.question_type === 'numeric-entry') renderNumeric(box, q);
    else if (q.question_type === 'multiple-select') renderMulti(box, q);
    else renderSingle(box, q);
    root.appendChild(box);
  }

  function finish() {
    finished = true;
    var s = summary();
    if (L) {
      L.track('test_complete', { attempt_id: attemptId, score_band: band(s.totalPct), weakest_domain: s.weakest });
      L.flushNow();
    }
    try {
      localStorage.setItem(CFG.storeKey, JSON.stringify({
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

    try {
      var prevRaw = localStorage.getItem(CFG.prevKey);
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
      ' <span style="font-size:14px;color:var(--ink-soft)">of ' + BANK.length + ' practice items correct \u2014 a practice percentage, not a predicted scaled score.</span>';
    box.appendChild(big);

    box.appendChild(el('p', null, null)).innerHTML = '<span class="eyebrow" style="display:block;margin-top:22px">By content domain</span>';
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
        'Your likely weakest domain is <strong>' + esc(s.weakest) + '</strong>. At 30 questions this is a signal, not a diagnosis \u2014 but it is where your first study week should go.';
    }
    advice.appendChild(el('p', null, 'Next steps: re-read the domain description in the guide, work the misses below, and re-take this mini test in 7\u201310 days. Retesting without changing how you study rarely moves the number.'));
    box.appendChild(advice);

    // 工具结果区 -> 学习页/工具页的内链
    var next = el('p', null, null);
    next.style.cssText = 'font-size:14px;line-height:1.65;margin-top:14px';
    next.innerHTML = 'How this connects to a real score: ETS publishes no raw-to-scaled conversion for the 8000 series, so we do not ' +
      'convert this percentage into a projected score. For how raw scores relate to the 100\u2013200 scale on the older series, see the ' +
      '<a href="/score-calculator">Praxis raw score calculator</a>, and for the full test outline go back to ' +
      '<a href="/praxis-8003-mathematics">the Praxis 8003 guide</a>.';
    box.appendChild(next);

    var missedQs = BANK.filter(function (q) { return answers[q.id] !== undefined && !isCorrect(q); });
    if (missedQs.length) {
      var mh = el('p', null, null);
      mh.style.cssText = 'margin-top:24px';
      mh.innerHTML = '<span class="eyebrow" style="display:block">Review your misses (' + missedQs.length + ')</span>';
      box.appendChild(mh);
      missedQs.forEach(function (q) {
        var item = el('div');
        item.style.cssText = 'border-top:1px solid var(--line);padding:13px 0;font-size:13.5px;line-height:1.6';
        item.innerHTML = '<p style="margin:0 0 4px">' + esc(q.stem) + '</p>' +
          '<p style="margin:0;color:#8A4B49">Your answer: ' + esc(answerText(q, answers[q.id])) + '</p>' +
          '<p style="margin:0 0 4px;color:#3E6B3A">Correct: ' + esc(correctText(q)) + '</p>' +
          '<p style="margin:0;color:var(--ink-soft)">' + esc(q.explanation) + '</p>';
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

  // ------------------------------------------------- registration card (shared D3 flow)

  function buildSignupCard(s) {
    var card = el('div', 'ld8-card');
    card.style.cssText = 'border:1px solid var(--line);background:var(--bg-soft);padding:20px;margin-top:26px';

    if (registered) {
      card.innerHTML = '<p style="margin:0;font-size:14.5px"><strong>Saved to your account.</strong> Your domain results are stored \u2014 re-take any time and this page compares the two runs.</p>';
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

    function finishSignup(token) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
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

      // GET account state -> attach THIS attempt under the 8003 bucket -> PUT back.
      // The server partitions by whatever key sits under state.tests, so a 5003
      // guide read on the same account is untouched.
      var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
      fetch(API + '/api/state', { headers: { Authorization: 'Bearer ' + token } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var st = (d && d.state) || {};
          if (!st.tests || typeof st.tests !== 'object') st = { v: 2, tests: { '5001': st } };
          st.tests[CFG.apiTestKey] = st.tests[CFG.apiTestKey] || {};
          st.tests[CFG.apiTestKey][CFG.attemptField] = attemptPayload;
          return fetch(API + '/api/state', { method: 'PUT', headers: headers, body: JSON.stringify({ state: st }) });
        })
        .catch(function () { /* reconcile is best-effort; local result unaffected */ })
        .then(function () {
          registered = true;
          try { localStorage.setItem(CFG.prevKey, JSON.stringify({ total_pct: s.totalPct })); } catch (e) { }
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
        // v2 shape: the server files this under tests["8003"]. A bare
        // { attempt_8003 } would be normalized into the 5001 bucket.
        pending_state: (function () {
          var t = {};
          t[CFG.apiTestKey] = {};
          t[CFG.apiTestKey][CFG.attemptField] = attemptPayload;
          return { v: 2, tests: t };
        })(),
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
            if (d && d.status === 'done' && d.token) { pending.method = 'magic_link'; finishSignup(d.token); }
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
          finishSignup(data.token);
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
        var bucket = (st.tests && st.tests[CFG.apiTestKey]) || {};
        var a = bucket[CFG.attemptField];
        if (a && a.total_pct && !finished) {
          var note = el('p', null, 'Saved result from ' + a.completed_at + ': ' + a.total_pct + '% of the mini test' +
            (a.weakest_domain ? ' \u2014 weakest domain: ' + a.weakest_domain : '') + '. Re-take below to compare.');
          note.style.cssText = 'font-size:14px;color:var(--ink-soft);background:var(--bg-soft);border-left:2px solid var(--accent);padding:10px 14px;margin:0 0 16px';
          root.insertBefore(note, root.firstChild);
        }
      })
      .catch(function () { /* logged-out or transient — silent */ });
  }

  // ------------------------------------------------- boot

  // 暴露给测试脚本的纯函数（判分逻辑不依赖 DOM，可在 Node 里直接断言）
  window.LD8003 = {
    numericValue: numericValue,
    sameNumber: sameNumber,
    sameSet: sameSet,
    grade: grade,
    bankLength: BANK.length,
    domains: DOMAINS.slice(),
  };

  renderIntro();
  if (L) L.track('test_view');
  checkSaved();
})();
