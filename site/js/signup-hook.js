// signup-hook.js — D3 inline registration card + D4 event wiring for /diagnostic.
//
// Design constraints:
//   - diagnostic.html is a minified React app. This script deliberately does NOT
//     touch it: everything hooks in via DOM delegation and MutationObserver, so
//     the React bundle stays byte-identical and future rebuilds can't break us.
//   - triumph_* localStorage keys and window.TriumphAuth are the existing auth
//     system — read/reused, never redefined (brand-spec rule).
//   - Card is injected in-place under the paywall: the user never leaves the
//     result page (the whole point of D3). Unlock = session saved + reload;
//     the report re-renders unlocked because /api/me now returns a session.
//
// Magic flow (worker-src/magic.mjs):
//   step1 email -> POST /api/magic/request {email, pending_state}
//   step2 either type the 6-digit code -> POST /api/magic/verify
//         or click the email link -> /api/magic/redeem (other tab) ->
//         this tab polls GET /api/magic/status?request_id= and picks up the
//         same session token. Both paths converge; the page reloads unlocked.
(function () {
  'use strict';

  var T = window.TriumphAuth;
  var L = window.LDTrack;
  if (!T) return;

  var API = window.TRIUMPH_API || '';
  var attemptId = null;
  var pending = { email: '', requestId: null, method: 'email_code' };
  var pollTimer = null;
  var pollTries = 0;
  var injected = false;

  // ------------------------------------------------------------ helpers

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function post(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.error && data.error.message) || 'request failed');
          err.code = (data && data.error && data.error.code) || 'error';
          throw err;
        }
        return data;
      });
    });
  }

  function get(path) {
    return fetch(API + path).then(function (res) { return res.json(); });
  }

  function scoreBand() {
    var pass = Number(localStorage.getItem('triumph_last_pass') || 0);
    if (!pass) return null;
    if (pass < 40) return '0-39';
    if (pass < 60) return '40-59';
    if (pass < 75) return '60-74';
    if (pass < 90) return '75-89';
    return '90-100';
  }

  // ------------------------------------------------------ D4 event wiring
  //
  // 分工（2026-09-10 修正）：
  //   diagnostic.html 的内联脚本负责 test_start / test_complete —— 它拿得到
  //   score_pct，数据比这里完整。本文件不再重复发这两个事件。
  //   生产库里出现过同一访客同一秒两条 test_start、两个不同 attempt_id，
  //   导致 question_answer 与 test_complete 分属不同 attempt，漏斗串联直接断掉。
  //   attempt_id 统一从 L._state() 取，与内联脚本 newAttempt() 生成的是同一个。

  function wireEvents() {
    if (!L) return;
    L.track('test_view');

    // 本题耗时基准：点 Start 时归零，每次提交答案后重新归零。
    // 这样 elapsed_ms 反映的是「读完这一题到给出答案」的真实时间，
    // 而不是从页面加载起的累计值。
    var questionStart = Date.now();

    function resetTimer() { questionStart = Date.now(); }

    // 从题库按题干反查，拿 question_id 与真实领域名。
    //
    // 为什么不用 .quiz-code：那个 DOM 节点渲染的是 subtest code（5002-5005），
    // 不是字典 §3.2 要求的 content_domain（领域名，如 "Earth Science"）。
    // 生产库里 106 条 question_answer 的 content_domain 全是 "5004" 这类值，
    // 月底「哪个领域最常成为最弱项」的分析会因此得出错误结论。
    // 题干在题库中 969/969 唯一，反查可靠。
    function lookupQuestion(quiz) {
      var h2 = quiz.querySelector('h2');
      var text = h2 ? (h2.textContent || '').trim() : '';
      if (!text) return null;
      var bank = questionBank();
      for (var i = 0; i < bank.length; i++) {
        if (bank[i] && bank[i].q === text) return bank[i];
      }
      return null;
    }

    function questionBank() {
      return (window.DM_BANK_EXT || window.DM_BANK || []);
    }

    // 点 Start：重置计时（事件本身由 diagnostic.html 内联脚本发出）
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.intro .btn-primary') : null;
      if (btn) resetTimer();
    }, true);

    // 作答提交 —— 挂在「Next question / See my results」上，不挂在选项上。
    //
    // 为什么换位置：选项按钮的 .opt.correct 只有 answered=true 时才由 React 渲染，
    // 原实现在点选项后 80ms 去查，查到时 React 还没 reveal，于是 correct 恒为 null
    // （生产库 106/106 全空）。而这个按钮 disabled={!answered}，能点到就说明已经
    // reveal 完，DOM 里必然带 .correct —— 判定时机从根上变可靠。
    // 用捕获阶段读，React 尚未处理本次点击，DOM 仍是当前这道题。
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest
        ? ev.target.closest('.quiz .quiz-actions .btn-primary') : null;
      if (!btn || btn.disabled) return;
      var quiz = btn.closest('.quiz');
      if (!quiz) return;

      var correctBtn = quiz.querySelector('button.opt.correct');
      if (!correctBtn) return;            // 尚未 reveal 的点击不算一次作答
      var wrongBtn = quiz.querySelector('button.opt.wrong');
      var chosen = wrongBtn || correctBtn; // 选错有 .wrong；选对时 .correct 即所选项

      var q = lookupQuestion(quiz);
      var st = L._state ? L._state() : {};
      L.track('question_answer', {
        attempt_id: st.attemptId || null,
        question_id: q ? q.id : null,
        content_domain: q ? q.category : null,
        correct: chosen === correctBtn,
        elapsed_ms: Date.now() - questionStart,
      });
      resetTimer();
    }, true);

    // 分享按钮（排除同区的 "Back to report"，它也是 .btn-ghost 但不是分享）
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.report .btn-ghost') : null;
      if (!btn) return;
      var label = (btn.textContent || '').trim();
      if (/back to report/i.test(label)) return;
      var target = 'other';
      if (/facebook/i.test(label)) target = 'facebook';
      else if (/^post on x|twitter/i.test(label)) target = 'x';
      else if (/copy/i.test(label)) target = 'copy';
      else if (/share/i.test(label)) target = 'native';
      L.track('share_click', { extra: { share_target: target } });
    }, true);

    // 重做诊断。原实现匹配 /re-run/，但按钮实际文案是 "New diagnostic"，
    // 于是这个事件基本发不出来（生产库 12 天只有 3 条，且多来自其它页面）。
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.report .btn-primary') : null;
      if (!btn || !/new diagnostic|re-?run|retake/i.test(btn.textContent || '')) return;
      L.track('retest_start', { attempt_id: L.newAttempt() });
      resetTimer();
    }, true);
  }

  function watchReport() {
    if (!L) return;
    var seen = false;
    var mo = new MutationObserver(function () {
      if (seen) return;
      var report = document.querySelector('.report');
      if (report) {
        seen = true;
        L.observeOnce(report, 'result_view', {
          score_band: scoreBand(),
          weakest_domain: localStorage.getItem('triumph_weakest') || null,
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ------------------------------------------------- D3 inline signup card

  function buildCard() {
    var card = el('div', 'ld-signup-card');
    card.style.cssText = 'border:1px solid var(--line);background:var(--bg);padding:18px;margin-top:16px';

    var step1 = el('div', 'ld-su-step1');
    var h = el('p', null, null);
    h.style.cssText = 'font-size:16px;margin:0 0 6px';
    h.innerHTML = '<strong>Unlock your pass forecast &amp; study plan</strong> — free, no password.';
    var sub = el('p', null, 'We email you a 6-digit code. Your results above are saved with it — nothing to re-enter.');
    sub.style.cssText = 'font-size:13px;color:var(--ink-soft);margin:0 0 12px;line-height:1.5';

    var row = el('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    var email = el('input');
    email.type = 'email';
    email.placeholder = 'you@school.edu';
    email.setAttribute('aria-label', 'Email address');
    email.style.cssText = 'flex:1;min-width:200px;padding:11px 14px;font-size:14px;color:var(--ink);background:var(--bg);border:1px solid var(--line);outline:none';
    var go = el('button', 'btn-primary', 'Email me the code');
    go.style.cssText = 'padding:11px 18px;font-size:14px';
    row.appendChild(email);
    row.appendChild(go);

    var msg = el('p');
    msg.style.cssText = 'font-size:12.5px;color:var(--accent-deep);margin:8px 0 0;min-height:1em';

    step1.appendChild(h);
    step1.appendChild(sub);
    step1.appendChild(row);
    step1.appendChild(msg);

    var step2 = el('div', 'ld-su-step2');
    step2.style.display = 'none';
    var h2 = el('p', null, 'Check your inbox.');
    h2.style.cssText = 'font-size:16px;margin:0 0 6px';
    var hint = el('p', null, 'Tip: open the link straight from your email app — or just type the 6-digit code here. Both unlock this page.');
    hint.style.cssText = 'font-size:13px;color:var(--ink-soft);margin:0 0 12px;line-height:1.5';

    var row2 = el('div');
    row2.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    var code = el('input');
    code.type = 'text';
    code.inputMode = 'numeric';
    code.maxLength = 6;
    code.placeholder = '6-digit code';
    code.setAttribute('aria-label', '6-digit code');
    code.style.cssText = 'flex:1;min-width:160px;padding:11px 14px;font-size:16px;letter-spacing:4px;color:var(--ink);background:var(--bg);border:1px solid var(--line);outline:none';
    var verify = el('button', 'btn-primary', 'Unlock');
    verify.style.cssText = 'padding:11px 18px;font-size:14px';
    row2.appendChild(code);
    row2.appendChild(verify);

    var msg2 = el('p');
    msg2.style.cssText = 'font-size:12.5px;color:var(--accent-deep);margin:8px 0 0;min-height:1em';

    step2.appendChild(h2);
    step2.appendChild(hint);
    step2.appendChild(row2);
    step2.appendChild(msg2);

    card.appendChild(step1);
    card.appendChild(step2);

    function showStep2() {
      step1.style.display = 'none';
      step2.style.display = 'block';
      code.focus();
    }

    function errMsg(code, fallback) {
      var map = {
        invalid_email: 'That email doesn\u2019t look right — check it and try again.',
        mail_failed: 'Couldn\u2019t send the email right now — try again in a minute.',
        wrong_code: 'That code doesn\u2019t match — use the latest email.',
        code_expired: 'The code expired (15 min). Enter your email again for a new one.',
      };
      return map[code] || fallback || 'Something went wrong — try again.';
    }

    go.addEventListener('click', function () {
      var v = (email.value || '').trim();
      if (!v) { msg.textContent = 'Enter your email first.'; return; }
      go.disabled = true;
      go.textContent = 'Sending\u2026';
      msg.textContent = '';
      if (L) L.track('signup_start', { signup_method: 'email_code' });
      post('/api/magic/request', {
        email: v,
        pending_state: T.buildLocalState ? T.buildLocalState() : null,
        // 从邮箱点链接时回哪页。不带的话服务端默认 /diagnostic，
        // 在这页注册的人会被送到别处去。
        next: window.location.pathname,
      }).then(function (data) {
        pending.email = v;
        pending.requestId = data.request_id || null;
        showStep2();
        startPolling();
      }).catch(function (e) {
        msg.textContent = errMsg(e.code);
      }).then(function () {
        go.disabled = false;
        go.textContent = 'Email me the code';
      });
    });
    email.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go.click(); });

    function finish(token) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      try {
        T._setSession(token, pending.email);
      } catch (e) {
        T.token = token;
        T.user = pending.email;
      }
      if (L) {
        var uid = null;
        try {
          var payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          uid = payload.sub || null;
        } catch (e) { /* token decode is best-effort */ }
        L.identify(uid || pending.email, pending.method);
        // 注册即解锁完整学习计划 —— 解锁动作就发生在这一刻，埋在这里不会漏。
        // 不放在 reload 后按「计划区可见」触发：那会变成每次访问都报一次，
        // study_plan_unlock 就退化成第二个 result_view 了。
        L.track('study_plan_unlock', { signup_method: pending.method || 'email_code' });
        L.flushNow();
      }
      // Server already holds the merged state (this session's results were
      // captured at request time). Pull it down, then reload — the report
      // re-renders unlocked because /api/me now returns a session.
      var done = function () { window.location.reload(); };
      try {
        T.syncPull().then(done, done);
        setTimeout(done, 4000); // never hang on the sync
      } catch (e) { done(); }
    }

    function startPolling() {
      if (!pending.requestId || pollTimer) return;
      pollTries = 0;
      pollTimer = setInterval(function () {
        pollTries++;
        if (pollTries > 100) { clearInterval(pollTimer); pollTimer = null; return; }
        get('/api/magic/status?request_id=' + encodeURIComponent(pending.requestId))
          .then(function (data) {
            if (data && data.status === 'done' && data.token) {
              pending.method = 'magic_link';
              finish(data.token);
            }
          })
          .catch(function () { /* transient — keep polling */ });
      }, 3000);
    }

    verify.addEventListener('click', function () {
      var v = (code.value || '').trim();
      if (!/^\d{6}$/.test(v)) { msg2.textContent = 'Enter the 6 digits from the email.'; return; }
      verify.disabled = true;
      verify.textContent = 'Checking\u2026';
      msg2.textContent = '';
      post('/api/magic/verify', {
        email: pending.email,
        code: v,
        request_id: pending.requestId,
      }).then(function (data) {
        // 本标签页输码完成 = email_code；从邮箱点链接完成 = magic_link（在 startPolling 里设）。
        // 不设的话 signup_success 会落到默认值，与 signup_start 的 email_code 对不上，
        // 漏斗第 4→5 段按 signup_method 拆分就废了。
        pending.method = 'email_code';
        finish(data.token);
      }).catch(function (e) {
        msg2.textContent = errMsg(e.code);
        verify.disabled = false;
        verify.textContent = 'Unlock';
      });
    });
    code.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') verify.click(); });

    return card;
  }

  function maybeInject() {
    if (injected) return;
    if (!T.isLoggedIn() && T.token === null) {
      var pw = document.querySelector('.paywall');
      if (!pw) return;
      // Only the "log in to unlock" state gets the card — "upgrade" (already
      // logged in, free plan past the gate) is a different decision.
      var cta = pw.querySelector('.cta-row');
      var loginBtn = cta && cta.querySelector('a[href*="/login"]');
      if (!cta || !loginBtn) return;
      if (pw.querySelector('.ld-signup-card')) { injected = true; return; }
      var card = buildCard();
      pw.insertBefore(card, cta);
      injected = true;
      if (L) L.observeOnce(card, 'signup_prompt_view', {});
    }
  }

  function boot() {
    wireEvents();
    watchReport();
    setInterval(maybeInject, 1200);
    maybeInject();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
