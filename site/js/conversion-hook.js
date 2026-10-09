// conversion-hook.js — 诊断结果页的事实摘要与保存入口。
// 只读取当前练习的分科答题数，不把练习正确率换算为考试分数或通过预测。
(function () {
  'use strict';

  function setText(node, next) {
    if (node && node.textContent !== next) node.textContent = next;
  }

  function buildSummary(box) {
    var report = box.closest('.report');
    if (!report) return null;
    var rows = [].slice.call(report.querySelectorAll('.subtest-report .subtest-line')).map(function (node) {
      var counts = /^\s*(\d+)\s*\/\s*(\d+)\s+correct\s*$/i.exec((node.querySelector('.acc') || {}).textContent || '');
      var name = String((node.querySelector('.name') || {}).textContent || '').replace(/\s*—\s*(?:review next|weakest gate)\s*$/i, '').trim();
      if (!counts || !name) return null;
      var correct = Number(counts[1]), total = Number(counts[2]);
      if (!total || correct > total) return null;
      return { name: name, correct: correct, total: total, accuracy: correct / total };
    }).filter(function (row) { return row !== null; });

    var summary = document.createElement('div');
    summary.className = 'score-caption';
    summary.setAttribute('data-conv-summary', '1');
    summary.style.cssText = 'background:var(--bg);border-left:2px solid var(--accent);padding:16px 18px;margin-bottom:16px';
    var text;
    if (!rows.length) {
      text = 'There is not enough answer-count data to identify a review priority. Complete a practice set and review its explanations.';
    } else {
      var lowest = Math.min.apply(null, rows.map(function (row) { return row.accuracy; }));
      var priorities = rows.filter(function (row) { return row.accuracy === lowest; });
      text = lowest === 1
        ? 'No missed questions in these subtests. Practice more topics across all four subtests to broaden this sample.'
        : 'Review next: ' + priorities.map(function (row) {
          return row.name + ' (' + row.correct + '/' + row.total + ' correct, ' + Math.round(row.accuracy * 100) + '%)';
        }).join('; ') + '. These areas had the lowest accuracy in this set. Review the missed concepts, then try fresh questions.';
    }
    var body = document.createElement('p');
    body.style.margin = '0 0 8px';
    body.textContent = text;
    summary.appendChild(body);
    var note = document.createElement('p');
    note.style.margin = '0';
    note.textContent = 'A small practice sample cannot estimate an official Praxis score or predict a passing result. Use this plan to guide your next review.';
    summary.appendChild(note);
    return summary;
  }

  function decoratePaywall() {
    var pw = document.querySelector('.paywall');
    if (!pw || !pw.querySelector('.locked-content')) return;
    var cta = pw.querySelector('.cta-row');
    var primary = cta && cta.querySelector('.btn-primary');
    if (!cta || !primary) return;
    var isLogin = primary.tagName === 'A' && (primary.getAttribute('href') || '').indexOf('/login') !== -1;
    if (isLogin) {
      setText(primary, 'Log in to save your report');
      var price = cta.querySelector('.price');
      if (price) price.style.display = 'none';
    }
    var note = pw.querySelector('.demo-note');
    setText(note, isLogin
      ? 'Save your practice results and unlock answer explanations with a free account. The full report is available through Pro or a one-time purchase.'
      : 'Unlock your full practice review and study plan with Pro, or buy this report for $9.99 without an account. 14-day refund on every paid plan, no questions asked.');
  }

  function decorateUnlocked() {
    var box = document.querySelector('.unlocked-box');
    if (!box || box.querySelector('[data-conv-summary]')) return;
    var built = buildSummary(box);
    if (!built) return;
    var h3 = box.querySelector('h3');
    if (h3 && h3.nextSibling) box.insertBefore(built, h3.nextSibling);
    else box.insertBefore(built, box.firstChild);
  }

  var scheduled = false;
  function apply() {
    scheduled = false;
    try {
      decoratePaywall();
      decorateUnlocked();
    } catch (e) { /* 展示层异常不影响答题。 */ }
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
