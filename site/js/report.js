// report.js — 诊断报告的前端渲染层（2026-09-10）
//
// 三条边界，决定了这个文件为什么长这样：
//
//   1. **报告内容只能来自服务端。** 这里没有、也不会有任何"本地拼一份报告"的
//      代码路径。服务端返回 402 时，页面上除了"解锁方式"之外不会出现任何
//      成绩、雷达图或 AI 分析 —— 「付费墙未解锁时报告绝对不能渲染」是结构
//      性保证：前端根本拿不到数据。
//
//   2. **不新增 CSS 类。** 全部复用 diagnostic.html 里已有的类
//      （.report/.section-label/.subtest-line/.bar-*/.mono/.eyebrow/.weak-note/
//      .plan-item/.btn-*/.score-caption）。布局胶水用 inline style，和页面里
//      React 部分的做法保持一致，免得再造一套视觉语言。
//
//   3. **失败不打扰用户。** 任何异常都只是不渲染，绝不让结果页白屏。
//
// 对外暴露 window.LDReport：
//   render()  重新拉取并渲染（付费回来、或登录后调用）
//   buy()     发起 $9.99 一次性结账（免登录）
//   radar()   纯函数，给定维度数组返回 SVG 字符串（下载版报告复用）

(function () {
  'use strict';

  var API = '/api/diagnostic/report';
  var STATUS_API = '/api/diagnostic/report/status';
  var CHECKOUT_API = '/api/billing/report-checkout';
  var ATTEMPT_KEY = 'triumph_last_attempt';
  var ROOT_ID = 'ld-report-root';
  var PRICE = '$9.99';
  // 站点既有政策（terms.html §5 是 14 天）。这里只是把它摆到付费点旁边，
  // 不是新增承诺 —— 写成 7 天就是自己砍一半。
  var REFUND = '14-day refund on every paid plan, no questions asked';

  /** 雷达图的轴标签：九个全称在雷达上会糊成一团，用短名。 */
  var SHORT = {
    accuracy: 'Accuracy',
    pace: 'Pace',
    knowledge: 'Knowledge',
    miss_load: 'Error load',
    concentration: 'Focus',
    consistency: 'Steady',
    guessing: 'No guessing',
    uplift: 'Headroom',
    momentum: 'Momentum',
  };

  // ---------------------------------------------------------------- 基础工具

  function auth() { return window.TriumphAuth || null; }
  function jwt() { var a = auth(); return a && a.token ? a.token : ''; }
  function visitorId() {
    try { if (window.LDTrack && window.LDTrack.visitor) return window.LDTrack.visitor(); } catch (e) {}
    try { return localStorage.getItem('ld_visitor') || null; } catch (e) { return null; }
  }
  function loggedIn() {
    var a = auth();
    try { return !!(a && a.isLoggedIn && a.isLoggedIn()); } catch (e) { return false; }
  }
  function readAttempt() {
    try {
      var raw = localStorage.getItem(ATTEMPT_KEY);
      if (!raw) return null;
      var a = JSON.parse(raw);
      if (!a || !Array.isArray(a.answers) || !a.answers.length) return null;
      return a;
    } catch (e) { return null; }
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // 只用服务端的真实计数；缺失、零分母和不合法计数不能显示为 0% 或成功。
  function counts(correct, total) {
    if (typeof correct !== 'number' || typeof total !== 'number' ||
        !Number.isInteger(correct) || !Number.isInteger(total) ||
        total <= 0 || correct < 0 || correct > total) return null;
    return { correct: correct, total: total, accuracy: Math.round(correct / total * 100) };
  }
  function summaryCounts(r) {
    var s = r.summary || {};
    return counts(s.correct_count, s.question_count);
  }
  function countText(c) {
    return c ? c.correct + '/' + c.total + ' correct (' + c.accuracy + '%)' : 'Insufficient answer-count data';
  }
  function reviewRows(r) {
    return (r.subtests || []).filter(function (s) { return counts(s.correct, s.attempted); });
  }
  function reviewPriorities(r) {
    var rows = reviewRows(r);
    var lowest = Math.min.apply(null, rows.map(function (s) { return s.correct / s.attempted; }));
    return lowest < 1 ? rows.filter(function (s) { return s.correct / s.attempted === lowest; }) : [];
  }

  // ---------------------------------------------------------------- 雷达图

  /**
   * 九维雷达图（纯 SVG，无依赖）。
   *
   * 为什么不用图表库：站点跑在 Cloudflare Pages 上，没有 Node runtime，
   * 而且为一个图引一个 CDN 库不划算。九条轴的手绘 SVG 只有几十行。
   *
   * `measured:false` 的维度画成虚线轴 + 空心点，并在下方标注 —— 缺数据时
   * 宁可显示"没测到"，也不要伪造一个分数误导用户。
   */
  function radarSvg(dims, opts) {
    opts = opts || {};
    var size = opts.size || 340;
    var n = dims.length;
    if (!n) return '';
    var cx = size / 2, cy = size / 2;
    var R = size / 2 - (opts.labelPad || 52);
    var pt = function (i, r) {
      var a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    var poly = function (r, vals) {
      return vals.map(function (v, i) {
        var p = pt(i, r * (v / 100));
        return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      }).join(' ') + ' Z';
    };

    var parts = [];
    parts.push('<svg viewBox="0 0 ' + size + ' ' + size + '" width="100%" height="auto" role="img" ' +
      'aria-label="Nine-dimension readiness radar chart" style="max-width:' + size + 'px;display:block;margin:0 auto">');

    // 底圈 25/50/75/100
    [25, 50, 75, 100].forEach(function (ring) {
      var pts = [];
      for (var i = 0; i < n; i++) { var p = pt(i, (R * ring) / 100); pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
      parts.push('<polygon points="' + pts.join(' ') + '" fill="none" stroke="var(--line)" stroke-width="1"' +
        (ring === 100 ? '' : ' stroke-dasharray="2 3"') + '/>');
    });

    // 轴 + 标签
    dims.forEach(function (d, i) {
      var end = pt(i, R);
      parts.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + end[0].toFixed(1) + '" y2="' + end[1].toFixed(1) +
        '" stroke="var(--line)" stroke-width="1"' + (d.measured === false ? ' stroke-dasharray="3 3"' : '') + '/>');
      var lp = pt(i, R + 16);
      var anchor = Math.abs(lp[0] - cx) < 6 ? 'middle' : (lp[0] > cx ? 'start' : 'end');
      var label = SHORT[d.id] || d.label;
      parts.push('<text x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '" text-anchor="' + anchor +
        '" dominant-baseline="middle" font-family="var(--mono)" font-size="10" fill="var(--ink-soft)">' + esc(label) + '</text>');
      var vp = pt(i, R + 30);
      parts.push('<text x="' + vp[0].toFixed(1) + '" y="' + vp[1].toFixed(1) + '" text-anchor="' + anchor +
        '" dominant-baseline="middle" font-family="var(--mono)" font-size="10" font-weight="600" fill="var(--accent-deep)">' +
        (d.measured === false ? 'n/a' : d.value) + '</text>');
    });

    // 数据面
    var vals = dims.map(function (d) { return d.measured === false ? 0 : d.value; });
    parts.push('<path d="' + poly(R, vals) + '" fill="color-mix(in srgb, var(--accent) 26%, transparent)" stroke="var(--accent)" stroke-width="2"/>');
    dims.forEach(function (d, i) {
      var p = pt(i, (R * (d.measured === false ? 0 : d.value)) / 100);
      parts.push('<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="var(--accent)"' +
        (d.measured === false ? ' opacity="0.35"' : '') + '/>');
    });

    parts.push('</svg>');
    return parts.join('');
  }

  // ---------------------------------------------------------------- 报告渲染

  function sectionLabel(text) {
    var wrap = el('div', 'section-label');
    var eyebrow = el('span', 'eyebrow', text);
    wrap.appendChild(eyebrow);
    return wrap;
  }

  function summaryStrip(r) {
    var c = summaryCounts(r);
    var head = el('div', 'score-head');
    head.appendChild(el('span', 'big-score', c ? c.accuracy + '%' : '—'));
    head.appendChild(el('span', 'score-caption', c
      ? 'practice accuracy · ' + c.correct + '/' + c.total + ' correct'
      : 'Insufficient answer-count data for practice accuracy.'));
    return head;
  }

  /** 「真实反映做题数量」：题数一律取自服务端实际匹配到的答卷，不是前端声称的。 */
  function countLine(r) {
    var c = summaryCounts(r);
    var p = el('p', 'score-caption');
    p.style.marginTop = '10px';
    p.textContent = (c ? 'This report uses ' + c.total + ' answered questions matched by the server. ' : 'There is not enough answer-count data to summarize this session. ') +
      'This small practice sample does not estimate an official Praxis score or predict whether you will pass. Different random sets can differ in difficulty.';
    return p;
  }

  function subtestBlock(r) {
    var wrap = el('div', 'subtest-report');
    var priorities = reviewPriorities(r);
    if (!(r.subtests || []).length) wrap.appendChild(el('p', 'score-caption', 'Insufficient subtest data.'));
    (r.subtests || []).forEach(function (s) {
      var c = counts(s.correct, s.attempted);
      var row = el('div', 'subtest-line');
      row.appendChild(el('span', 'code', s.code));
      var name = el('span', 'name');
      name.appendChild(document.createTextNode(s.name));
      if (priorities.indexOf(s) !== -1) {
        var em = el('span', 'weak', ' \u2014 review next');
        name.appendChild(em);
      }
      row.appendChild(name);
      row.appendChild(el('span', 'acc', countText(c)));
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill');
      fill.style.width = (c ? c.accuracy : 0) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function knowledgeBlock(r) {
    var wrap = el('div', 'subtest-report');
    if (!(r.knowledge_points || []).length) wrap.appendChild(el('p', 'score-caption', 'Insufficient knowledge-point data.'));
    (r.knowledge_points || []).forEach(function (c) {
      var measured = counts(c.correct, c.attempted);
      var row = el('div', 'subtest-line');
      row.appendChild(el('span', 'code', c.code));
      var name = el('span', 'name', c.category);
      name.style.fontSize = '15px';
      row.appendChild(name);
      row.appendChild(el('span', 'acc', countText(measured)));
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill');
      fill.style.width = (measured ? measured.accuracy : 0) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function paceBlock(r) {
    if (!r.pace || !['median_s', 'fastest_s', 'slowest_s', 'under_15s'].every(function (key) {
      return typeof r.pace[key] === 'number' && isFinite(r.pace[key]) && r.pace[key] >= 0;
    })) {
      return el('p', 'score-caption', 'Timing was incomplete for this session, so pace is not scored. Keep the tab open from the first question next time.');
    }
    var ul = el('div', null);
    var items = [
      ['Median per question', r.pace.median_s + 's'],
      ['Fastest', r.pace.fastest_s + 's'],
      ['Slowest', r.pace.slowest_s + 's'],
      ['Answered in under 15s', String(r.pace.under_15s)],
    ];
    items.forEach(function (it) {
      var row = el('div', 'plan-item');
      row.appendChild(el('span', 'day', it[0]));
      row.appendChild(el('span', null, it[1]));
      ul.appendChild(row);
    });
    return ul;
  }

  function missTopicBlock(r) {
    if (!(r.miss_topics || []).length) {
      var c = summaryCounts(r);
      return el('p', 'weak-note', c && c.correct === c.total
        ? 'No missed questions in this sample. Try more topics across all subtests.'
        : 'Missed-topic details are unavailable for this session. Review the available question explanations below.');
    }
    var wrap = el('div', null);
    r.miss_topics.forEach(function (t) {
      var row = el('div', 'plan-item');
      row.appendChild(el('span', 'day', String(t.misses) + '\u00D7'));
      row.appendChild(el('span', null, t.topic));
      wrap.appendChild(row);
    });
    return wrap;
  }

  function narrativeBlock(r) {
    // 旧版服务端叙述可能混有模型分数和通过预测，展示层只从已授权的答题事实生成建议。
    var wrap = el('div', null);
    var priorities = reviewPriorities(r);
    var c = summaryCounts(r);
    var focus = priorities.map(function (s) { return s.name + ' (' + countText(counts(s.correct, s.attempted)) + ')'; }).join('; ');
    wrap.appendChild(el('p', 'weak-note', focus
      ? 'Review next: ' + focus + '. These subtests had the lowest accuracy in this sample, not a measured exam weakness.'
      : c && c.correct === c.total
        ? 'You answered every question in this sample correctly. Broaden your practice to topics not sampled here.'
        : 'There is not enough subtest data to identify a review priority. Use the available missed-question explanations to guide your review.'));
    var actions = [
      focus ? 'Start with the missed concepts in ' + priorities.map(function (s) { return s.name; }).join(', ') + '. Read each explanation and write why your chosen answer did not fit.'
        : 'Review any available missed-question explanations. If none are available, start a fresh set across all four subtests.',
      'Practice fresh questions on the reviewed concepts and record correct answers alongside the number attempted.',
      'Then cover other subtests and topics. Compare missed concepts between sessions; different random sets are not a reliable readiness trend.'
    ];
    actions.forEach(function (action, i) {
      var row = el('div', 'plan-item');
      row.appendChild(el('span', 'day', 'Step ' + (i + 1)));
      row.appendChild(el('span', null, action));
      wrap.appendChild(row);
    });
    wrap.appendChild(el('p', 'demo-note', 'This study plan is based on the recorded practice counts. It does not measure pass probability, guessing, concentration or exam readiness.'));
    return wrap;
  }

  function buildReportNode(r, forDownload) {
    var s = el('section', 'report wrap');
    s.id = ROOT_ID;
    s.setAttribute('data-ld-report', '1');

    var eyebrow = el('span', 'eyebrow', 'Your full diagnostic report');
    s.appendChild(eyebrow);

    var h2 = el('h2');
    h2.style.marginTop = '12px';
    var c = summaryCounts(r);
    h2.appendChild(document.createTextNode(c ? 'What these ' + c.total + ' answered questions ' : 'What the available practice records '));
    var em = el('em', null, 'actually say');
    h2.appendChild(em);
    h2.appendChild(document.createTextNode('.'));
    s.appendChild(h2);

    s.appendChild(summaryStrip(r));
    s.appendChild(countLine(r));

    s.appendChild(sectionLabel('By subtest'));
    s.appendChild(subtestBlock(r));

    s.appendChild(sectionLabel('By knowledge point'));
    s.appendChild(knowledgeBlock(r));

    s.appendChild(sectionLabel('Pace and timing'));
    s.appendChild(paceBlock(r));

    s.appendChild(sectionLabel('Where the misses sit'));
    s.appendChild(missTopicBlock(r));

    s.appendChild(sectionLabel('Review priorities & study plan'));
    s.appendChild(narrativeBlock(r));

    // 逐题回顾（付费层才有完整 12 题）
    if ((r.misses || []).length) {
      s.appendChild(sectionLabel('Every question you missed'));
      r.misses.forEach(function (m) {
        var box = el('div');
        box.style.cssText = 'border-top:1px solid var(--line);padding:16px 0';
        var meta = el('p', 'score-caption');
        meta.style.marginBottom = '6px';
        meta.appendChild(el('strong', null, m.code + ' \u00B7 ' + m.category));
        box.appendChild(meta);
        var q = el('p', null);
        q.style.cssText = 'font-size:15px;line-height:1.5;margin-bottom:8px';
        q.textContent = m.question;
        box.appendChild(q);
        var yours = el('p', 'score-caption');
        yours.style.color = 'var(--wrong-deep)';
        yours.appendChild(document.createTextNode('Your answer: '));
        yours.appendChild(el('strong', null, m.selected_text));
        box.appendChild(yours);
        var right = el('p', 'score-caption');
        right.style.color = 'var(--correct-deep)';
        right.appendChild(document.createTextNode('Correct: '));
        right.appendChild(el('strong', null, m.answer_text));
        box.appendChild(right);
        if (m.explanation) box.appendChild(el('p', 'explain', m.explanation));
        s.appendChild(box);
      });
    }

    // 底部动作
    var footer = el('div');
    footer.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;margin-top:34px';
    var dl = el('button', 'btn-primary', 'Download this report');
    dl.type = 'button';
    dl.addEventListener('click', function () { download(r); });
    footer.appendChild(dl);
    var pr = el('button', 'btn-ghost', 'Print / save as PDF');
    pr.type = 'button';
    pr.addEventListener('click', function () { window.print(); });
    footer.appendChild(pr);
    if (!forDownload) s.appendChild(footer);

    var note = el('p', 'demo-note');
    note.textContent = 'Keep this link \u2014 this report stays available for 180 days. ' + REFUND + '.';
    s.appendChild(note);

    return s;
  }

  // ---------------------------------------------------------------- 下载

  function download(r) {
    try {
      var html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Learndiag diagnostic report</title>' +
        '<style>' +
        'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
        'max-width:760px;margin:0 auto;padding:40px 24px;color:#3C3733;background:#F2EFE9;line-height:1.6}' +
        ':root{--line:#D8D1C5;--ink-soft:#6E6760;--wrong-deep:#934E49;--correct-deep:#52694D}' +
        '.big-score{display:block;font-size:48px;color:#A67D7A}.score-caption,.demo-note{color:#6E6760;font-size:14px}' +
        '.section-label{font-size:17px;font-weight:600;margin:28px 0 12px;border-bottom:1px solid #D8D1C5}' +
        '.subtest-line,.plan-item{display:flex;gap:12px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid #D8D1C5}' +
        '.subtest-line .name{flex:1}.plan-item .day{font-weight:600}.bar-track{display:none}.weak{font-size:12px}' +
        'h1{font-size:26px;margin:0 0 6px}h2{font-size:17px;margin:30px 0 10px;border-bottom:1px solid #D8D1C5;padding-bottom:6px}' +
        '.big{font-size:48px;color:#A67D7A;font-weight:600;margin:10px 0}' +
        '.meta{color:#6E6760;font-size:14px}table{width:100%;border-collapse:collapse;margin:10px 0}' +
        'td,th{text-align:left;padding:7px 8px;border-bottom:1px solid #D8D1C5;font-size:14px}' +
        '.mis{border-top:1px solid #D8D1C5;padding:12px 0}.q{font-weight:600;margin:4px 0}' +
        '.wrong{color:#B46F6A}.right{color:#7D9378}.ex{background:#E8E3D8;padding:10px 12px;font-size:13px;margin-top:8px}' +
        '.rp{background:#E8E3D8;padding:12px 14px;font-size:13px;margin:10px 0}' +
        '</style></head><body>';
      html += '<h1>Learndiag \u2014 Praxis 5001 diagnostic report</h1>';
      html += '<p class="meta">Practice counts, missed-question explanations and a study plan based on this session.</p>';
      // 下载与页面复用同一事实渲染，避免旧模型分数通过第二套模板重新出现。
      html += buildReportNode(r, true).outerHTML;
      html += '<h2>About this report</h2><div class="rp">Accuracy is correct answers divided by answered questions matched by the server. ' +
        'A small practice sample cannot establish exam readiness. ' +
        'Practice questions are original Learndiag items written to the ETS 5001 blueprint; ETS does not endorse this site. ' +
        'Billing and refund terms: learndiag.com/terms.html</div>';
      html += '</body></html>';

      var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'learndiag-report-' + new Date().toISOString().slice(0, 10) + '.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      track('report_download');
    } catch (e) { /* 下载失败不该影响页面 */ }
  }

  // ---------------------------------------------------------------- 锁定态 / 付费

  function buy() {
    var vid = visitorId();
    if (!vid) { window.location.href = '/login?next=' + encodeURIComponent(location.pathname); return; }
    var btns = document.querySelectorAll('[data-ld-buy]');
    for (var i = 0; i < btns.length; i++) { btns[i].disabled = true; btns[i].textContent = 'Opening checkout\u2026'; }
    fetch(CHECKOUT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt() },
      body: JSON.stringify({ visitor_id: vid }),
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (j && j.checkout_url) { window.location.href = j.checkout_url; return; }
        throw new Error((j && j.error && j.error.message) || 'checkout_unavailable');
      })
      .catch(function () {
        for (var k = 0; k < btns.length; k++) {
          btns[k].disabled = false;
          btns[k].textContent = 'Buy the full report \u2014 ' + PRICE;
        }
        var msg = document.getElementById('ld-buy-error');
        if (msg) { msg.textContent = 'Checkout is not available right now. Please try again in a moment, or contact us from the contact page.'; msg.style.display = 'block'; }
      });
  }

  function track(evt) {
    try { if (window.LDTrack && window.LDTrack.track) window.LDTrack.track('share_click', { extra: { share_target: 'report_' + evt } }); } catch (e) {}
  }

  /** 双重 CTA：免费登录为主（注册是第一杠杆），$9.99 一次性为次，免登录。 */
  function ctaRow(primaryHref, primaryText) {
    var row = el('div');
    row.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:18px';

    if (primaryHref) {
      var a = el('a', 'btn-primary', primaryText);
      a.href = primaryHref;
      a.style.cssText = 'text-decoration:none;display:inline-block;padding:13px 20px';
      row.appendChild(a);
    }
    var b = el('button', 'btn-ghost', 'Buy the full report \u2014 ' + PRICE);
    b.type = 'button';
    b.setAttribute('data-ld-buy', '1');
    b.style.cssText = 'padding:13px 20px;font-size:14px';
    b.addEventListener('click', buy);
    row.appendChild(b);
    return row;
  }

  /** 锁定块：**只有解锁方式，没有任何成绩内容**。 */
  function buildLockNode(ent, status) {
    // class 由 place() 按落位决定（在 .report 内还是外），这里先留空
    var s = el('section', '', null);
    s.id = ROOT_ID;
    s.setAttribute('data-ld-report', 'locked');

    var eyebrow = el('span', 'eyebrow', 'Full diagnostic report');
    s.appendChild(eyebrow);

    var h2 = el('h2');
    h2.style.marginTop = '12px';
    h2.appendChild(document.createTextNode('Turn your practice answers into a '));
    h2.appendChild(el('em', null, 'study plan'));
    h2.appendChild(document.createTextNode('.'));
    s.appendChild(h2);

    var p = el('p', 'score-caption');
    p.style.marginTop = '14px';
    p.appendChild(document.createTextNode(
      'You have finished the diagnostic \u2014 that part was free. The report that turns your answers into a plan is not open yet: ' +
      'your answer counts, subtest and topic accuracy, available timing data, missed-question explanations and review priorities ' +
      'use server-verified answers and are only displayed after report access is confirmed.'));
    s.appendChild(p);

    var p2 = el('p', 'score-caption');
    p2.style.marginTop = '12px';
    p2.appendChild(document.createTextNode('Two ways in:'));
    s.appendChild(p2);

    var ul = el('div', null);
    var items = loggedIn()
      ? [['Pro \u2014 $19.99/mo', 'Unlimited diagnostics and unlimited reports, forever.'],
         ['One report \u2014 ' + PRICE, 'This single report, downloaded, no account needed.']]
      : [['Free account', 'Unlocks every explanation in your review. No credit card.'],
         ['One report \u2014 ' + PRICE, 'The full report, downloaded, no account needed.']];
    items.forEach(function (it) {
      var row = el('div', 'plan-item');
      row.appendChild(el('span', 'day', it[0]));
      row.appendChild(el('span', null, it[1]));
      ul.appendChild(row);
    });
    s.appendChild(ul);

    s.appendChild(ctaRow(status && status.logged_in ? '/upgrade' : '/login?next=' + encodeURIComponent(location.pathname),
      status && status.logged_in ? 'Unlock with Pro' : 'Create a free account'));

    var err = el('p', 'demo-note');
    err.id = 'ld-buy-error';
    err.style.display = 'none';
    s.appendChild(err);

    var fine = el('p', 'demo-note');
    fine.textContent = REFUND + '. Cancel Pro any time from the billing portal.';
    s.appendChild(fine);

    return s;
  }

  // ---------------------------------------------------------------- 调度

  /**
   * 渲染去重键。
   *
   * 为什么需要它：React 每次状态变化都会触发 MutationObserver，而 render()
   * 要吃两次网络请求（查权益 + 取报告）。不设闸门的话，光滚一下页面就能
   * 打出几十个 /api/diagnostic/report，既烧 KV 也烧 AI 配额。
   * 键里带 attempt_id（换了答卷要重出）和登录态（登录后权益会变）。
   */
  var renderedKey = null;
  var busy = false;

  function stateKey() {
    var a = readAttempt();
    if (!a) return null;
    return a.attempt_id + '|' + (loggedIn() ? 'in' : 'out') + '|' + (visitorId() || '-');
  }

  function render() {
    var key = stateKey();
    if (!key || key === renderedKey || busy) return;
    var attempt = readAttempt();
    busy = true;

    fetch(STATUS_API + '?visitor_id=' + encodeURIComponent(visitorId() || ''), {
      headers: jwt() ? { Authorization: 'Bearer ' + jwt() } : {},
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .catch(function () { return {}; })
      .then(function (status) {
        if (!(status && status.can_view_report)) {
          place(buildLockNode(null, status), attempt.attempt_id);
          return null;
        }
        // 只有确认有权益才把答卷发上去；服务端在无权时也只会回 402。
        return fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt() },
          body: JSON.stringify({
            attempt_id: attempt.attempt_id,
            visitor_id: visitorId(),
            answers: attempt.answers,
          }),
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; });
        }).then(function (res) {
          if (res.status === 401 || res.status === 402 || !res.j || !res.j.report) {
            place(buildLockNode(null, { logged_in: loggedIn() }), attempt.attempt_id);
            return;
          }
          place(buildReportNode(res.j.report), attempt.attempt_id);
        });
      })
      .catch(function () { /* 网络失败：保持页面原样，下个 tick 会重试 */ })
      .then(function () { busy = false; });
  }

  function place(node, attemptId) {
    var old = document.getElementById(ROOT_ID);
    if (old) old.parentNode.removeChild(old);

    var isReport = node.getAttribute('data-ld-report') === '1';
    var main = document.querySelector('#root main');
    var report = document.querySelector('#root .report');
    var scoreHead = document.querySelector('#root .report .score-head');
    var mounted = false;

    if (isReport && report && report.parentNode) {
      // 已解锁：报告领衔，插在 React 的成绩概览之前（报告自带成绩摘要）
      report.parentNode.insertBefore(node, report);
      mounted = true;
    } else if (scoreHead && scoreHead.parentNode) {
      // 未解锁且已出结果：入口放在**成绩大字正下方**，不是页面最底部。
      // 2026-09-10 实测：老位置在错题回顾之后 2000px+ 处，7 个做完诊断的人
      // 没有一个滚到，signup_prompt_view 恒为 0。这一处落位就是那次的修复。
      scoreHead.parentNode.insertBefore(node, scoreHead.nextSibling);
      mounted = true;
    } else if (main && main.parentNode) {
      // 付费回跳后 React 状态已丢、落在 intro 上 —— 报告依然要能看见
      main.parentNode.insertBefore(node, main);
      var intro = main.querySelector('.intro');
      if (intro && /(^|[?&])purchase=done/.test(location.search)) intro.style.display = 'none';
      mounted = true;
    }
    if (!mounted) return; // 还没挂载完成，下个 tick 再来

    // 锁定块插在 .report 内部时不要自带 .wrap —— 否则 max-width 与 28px 内边距
    // 会叠加两层；插在 <main> 直属位置时则必须有 .wrap，否则会顶到屏幕边缘。
    // 完整报告块自带 .report.wrap，两种情况都成立，不动它。
    if (node.getAttribute('data-ld-report') === 'locked') node.className = scoreHead ? '' : 'wrap';

    node.setAttribute('data-ld-attempt', attemptId || '');
    // 完整报告已渲染 → React 的付费墙就是多余的，收起来（避免两个 CTA 打架）。
    // 锁定态**不收起** .paywall：内联注册卡片在里面，那是最快的注册路径，
    // 而且 signup_prompt_view 埋点挂在它上面。
    if (isReport) {
      var paywall = document.querySelector('#root .paywall');
      if (paywall) paywall.style.display = 'none';
    }

    renderedKey = stateKey();
    if (/(^|[?&])purchase=done/.test(location.search)) {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }
  }

  function boot() {
    if (!document.getElementById('root')) return;
    // 600ms 轮询而不是 MutationObserver：React 的渲染频率不可控，
    // 而这个模块只需要在「结果页出现」和「付费回跳」两个时刻各跑一次。
    // 60 次（约 36 秒）后停 —— 用户没走到结果页就没必要一直问。
    var ticks = 0;
    var timer = setInterval(function () {
      ticks++;
      var mounted = document.querySelector('#root main');
      if (mounted) { try { render(); } catch (e) {} }
      if (ticks > 60) clearInterval(timer);
    }, 600);
    try { render(); } catch (e) {}
    // 登录/登出会改权益，重新评估一次
    window.addEventListener('storage', function () { renderedKey = null; try { render(); } catch (e) {} });
  }

  window.LDReport = { render: render, buy: buy, radar: radarSvg };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
