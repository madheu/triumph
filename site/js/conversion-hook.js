// conversion-hook.js — 诊断结果页的转化改动（2026-09-10）
//
// 为什么不直接改 diagnostic.html 里的 React 包：
//   diagnostic.html 的 <script type="text/babel"> 是压缩过的单文件 React app。
//   照 signup-hook.js 定下的规矩，结构性改动一律走 DOM 钩子，React 包保持字节不变，
//   以后重新构建不会把这批改动冲掉。
//
// 负责四件事：
//   P0-2  锁定区只留一个主按钮，文案改为「保存报告」语义；登录态隐藏竞争的 $19.99/mo 标签
//   P1-4  在「差 X 分」的位置直接把付费点讲清楚，而不是等到页面底部
//   P1-5  价格旁边放重考价格锚点（$180，取自站点 retake-guide 已核实口径，不是 $130）
//   P0-3  注册/登录解锁后，立刻给出「差 N 分 → K 个短板 → $19.99/mo」的价值摘要
//
// 口径护栏（重要）：
//   全站没有任何州的及格线数据，诊断页用的是 demo 模型里的"典型线 160"。
//   所以这里只说 "typical line"，绝不冒充用户所在州的线；每个摘要都带一句
//   "your state sets the real line" + 指向州线页的链接。
(function () {
  'use strict';

  var LINE = 160;        // demo 模型里的典型线（DM_estimateScore: 140 + acc*40）
  var ACC_UNDER = 50;    // 低于典型线 ⇔ 该科正确率 < 50%（同一模型换算）
  var PRO = '$19.99/mo';
  var RETAKE = '$180';   // ETS 合并 5001 重考价（site/praxis-5001-retake-guide.html 已核实）

  function setText(node, next) {
    if (node && node.textContent !== next) node.textContent = next;
  }

  function num(id, dflt) {
    var v = parseInt(String(id || '').replace(/[^\d]/g, ''), 10);
    return isNaN(v) ? dflt : v;
  }

  // ---------------------------------------------------------------- P0-3 / P1-4
  /**
   * 解锁态的价值摘要。
   *
   * 文案口径改过一版（2026-09-10）：原来写「差 X 分 → K 个短板」，
   * 现在改成「也许你只差这一个短板」。
   *
   * 为什么换：算得出 X 分，但算不出 K 个短板。四科里只有"最弱的一环"是
   * 数据支持的（DM_Report 自己就这么算），"3 个短板"是把一个真实结论
   * 摊成了编出来的三个。宁可只讲一个真的，也不要讲三个假的 ——
   * 而这个叙事反而更窄、更有指向性，更像"就差这一步"。
   */
  function buildSummary() {
    var score = Number(localStorage.getItem('triumph_last_score') || 0);
    if (!score) return null;

    var lines = [].slice.call(document.querySelectorAll('.subtest-line'));
    if (!lines.length) return null;

    var rows = lines.map(function (n) {
      var acc = num((n.querySelector('.acc') || {}).textContent, null);
      var nameNode = n.querySelector('.name');
      var name = nameNode ? String(nameNode.textContent).replace(/—\s*weakest gate/i, '').trim() : '';
      return { acc: acc, name: name };
    }).filter(function (r) { return r.acc !== null && r.name; });
    if (!rows.length) return null;

    var weakest = rows.reduce(function (a, b) { return a.acc <= b.acc ? a : b; }, rows[0]);
    var gap = LINE - score;
    var under = rows.filter(function (r) { return r.acc < ACC_UNDER; }).length;

    var box = document.createElement('div');
    box.className = 'score-caption';
    box.setAttribute('data-conv-summary', '1');
    box.style.cssText = 'background:var(--bg);border-left:2px solid var(--accent);padding:16px 18px;margin-bottom:16px';

    var mono = function (t) {
      var s = document.createElement('span');
      s.className = 'mono';
      s.style.color = 'var(--accent)';
      s.textContent = t;
      return s;
    };

    // 结论先行：一句"只差一个短板"，而不是一串分数差
    var head = document.createElement('p');
    head.style.cssText = 'margin:0 0 8px;font-family:var(--serif);font-size:19px;line-height:1.4';
    head.appendChild(document.createTextNode(under <= 1
      ? 'You may be one weak spot away from passing.'
      : 'You are closer than the total score suggests.'));
    box.appendChild(head);

    var body = document.createElement('p');
    body.style.cssText = 'margin:0 0 10px';
    body.appendChild(document.createTextNode('Your weakest gate is '));
    body.appendChild(mono(weakest.name));
    body.appendChild(document.createTextNode(' at '));
    body.appendChild(mono(weakest.acc + '%'));
    body.appendChild(document.createTextNode(under > 1
      ? ' — and it is the one dragging the rest of your result down.'
      : ' — everything else is already close enough to carry.'));
    if (gap > 0) {
      body.appendChild(document.createTextNode(' The demo model puts you about '));
      body.appendChild(mono(Math.abs(gap) + (Math.abs(gap) === 1 ? ' point' : ' points')));
      body.appendChild(document.createTextNode(' under the typical ' + LINE + ' line.'));
    }
    box.appendChild(body);

    var offer = document.createElement('p');
    offer.style.cssText = 'margin:0 0 10px';
    offer.appendChild(document.createTextNode('Pro is '));
    var strong = document.createElement('strong');
    strong.textContent = PRO;
    offer.appendChild(strong);
    offer.appendChild(document.createTextNode(' \u2014 and one more retake costs ' + RETAKE + ' plus 28 days.'));
    box.appendChild(offer);

    // P2-6：退款保障以前只在 terms 页里，付费点旁边一个字没有，等于藏起来。
    var refund = document.createElement('p');
    refund.style.cssText = 'margin:0 0 10px';
    var rb = document.createElement('strong');
    rb.textContent = '14-day refund';
    refund.appendChild(rb);
    refund.appendChild(document.createTextNode(' on every paid plan \u2014 ask within 14 days of the charge and we return it, no questions.'));
    box.appendChild(refund);

    var guard = document.createElement('p');
    guard.style.cssText = 'margin:0';
    guard.appendChild(document.createTextNode('Your state sets the real line, not ETS \u2014 '));
    var a = document.createElement('a');
    a.href = '/praxis-5001-passing-score-by-state';
    a.textContent = "check your state's line";
    a.style.color = 'var(--accent-deep)';
    guard.appendChild(a);
    guard.appendChild(document.createTextNode('.'));
    box.appendChild(guard);

    return box;
  }

  // ---------------------------------------------------------------- 锁定区
  function decoratePaywall() {
    var pw = document.querySelector('.paywall');
    if (!pw) return;
    // 只有「锁定态」才装饰：解锁态的 .paywall 里渲染的是学习区按钮（.unlocked-box > .cta-row），
    // 不是付费墙的 CTA。locked-content 只在 checking / locked 两种状态下存在。
    if (!pw.querySelector('.locked-content')) return;
    var cta = pw.querySelector('.cta-row');
    var primary = cta && cta.querySelector('.btn-primary');
    if (!cta || !primary) return;

    // React 在登录态渲染 <a href="/login?...">，在 Pro 态渲染 <button>
    var href = primary.getAttribute('href') || '';
    var isLogin = primary.tagName === 'A' && href.indexOf('/login') !== -1;
    var price = cta.querySelector('.price');

    if (isLogin) {
      // P0-2：登录态只留这一个主按钮，把竞争的 $19.99/mo 让位给重考锚点
      setText(primary, 'Log in to save your report');
      if (price) price.style.display = 'none';
    }

    // P1-5：价格旁边放重考锚点（复用 .demo-note 类，不新增视觉）
    var anchor = cta.querySelector('[data-conv-anchor]');
    if (!anchor) {
      anchor = document.createElement('span');
      anchor.className = 'demo-note';
      anchor.setAttribute('data-conv-anchor', '1');
      anchor.style.margin = '0';
      cta.appendChild(anchor);
    }
    setText(anchor, isLogin ? ('A full 5001 retake costs ' + RETAKE + ' + 28 days') : ('vs ' + RETAKE + ' to retake'));

    // P1-4：锁定说明里同步锚点，替换掉旧的 $130 口径
    var note = pw.querySelector('.demo-note:not([data-conv-anchor])');
    if (note) {
      if (isLogin) {
        setText(note, 'Your score, weakest gate and study plan save to your account. Free, no credit card.');
      } else {
        setText(note, 'Pass forecast & full report unlock with Pro \u2014 or buy this one report for $9.99 with no account. '
          + 'A full 5001 retake costs ' + RETAKE + ' and 28 more days. '
          + '14-day refund on every paid plan, no questions asked.');
      }
    }
  }

  // ---------------------------------------------------------------- 解锁区
  function decorateUnlocked() {
    var box = document.querySelector('.unlocked-box');
    if (!box) return;
    if (box.querySelector('[data-conv-summary]')) return;
    var built = buildSummary();
    if (!built) return;
    // 放在 h3 之后、正文之前：先给结论，再给一周安排
    var h3 = box.querySelector('h3');
    if (h3 && h3.nextSibling) box.insertBefore(built, h3.nextSibling);
    else box.insertBefore(built, box.firstChild);
  }

  // ---------------------------------------------------------------- 调度
  var scheduled = false;
  function apply() {
    scheduled = false;
    try {
      decoratePaywall();
      decorateUnlocked();
    } catch (e) { /* 转化层永远不能让结果页挂掉 */ }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(apply, 0);
  }

  function boot() {
    var root = document.getElementById('root');
    if (!root) return;
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
