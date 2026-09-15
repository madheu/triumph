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
  function money(n, dflt) { return typeof n === 'number' && isFinite(n) ? n : dflt; }

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
    var s = r.summary || {};
    var head = el('div', 'score-head');
    head.appendChild(el('span', 'big-score', money(s.score, '—')));
    var cap = el('span', 'score-caption');
    cap.appendChild(document.createTextNode('estimated scaled score \u00B7 '));
    cap.appendChild(el('span', 'mono', money(s.pass_probability, '—') + '%'));
    cap.appendChild(document.createTextNode(' pass probability. Averaged over all four subtests; your state sets the real line.'));
    head.appendChild(cap);
    return head;
  }

  /** 「真实反映做题数量」：题数一律取自服务端实际匹配到的答卷，不是前端声称的。 */
  function countLine(r) {
    var s = r.summary || {};
    var p = el('p', 'score-caption');
    p.style.marginTop = '10px';
    p.appendChild(document.createTextNode('This report was built from '));
    p.appendChild(el('strong', null, s.question_count + ' question' + (s.question_count === 1 ? '' : 's')));
    p.appendChild(document.createTextNode(' you actually answered \u2014 '));
    p.appendChild(el('strong', null, s.correct_count + ' correct'));
    p.appendChild(document.createTextNode(', '));
    p.appendChild(el('strong', null, s.accuracy + '% accuracy'));
    p.appendChild(document.createTextNode(s.previous_score
      ? '. Your previous diagnostic estimated ' + s.previous_score + '.'
      : '. This is your first recorded diagnostic.'));
    return p;
  }

  function radarBlock(r) {
    var box = document.createElement('div');
    box.innerHTML = radarSvg(r.radar || []);
    var rows = el('div', null);
    rows.style.marginTop = '22px';
    (r.radar || []).forEach(function (d) {
      var row = el('div', 'subtest-line');
      row.appendChild(el('span', 'code', (d.measured === false ? '\u2014' : d.value)));
      var name = el('span', 'name', d.label);
      name.style.fontSize = '16px';
      row.appendChild(name);
      var acc = el('span', 'acc', d.measured === false ? 'not measured' : d.value + '/100');
      row.appendChild(acc);
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill');
      fill.style.width = (d.measured === false ? 0 : Math.max(3, d.value)) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.title = d.hint || '';
      rows.appendChild(row);
    });
    return { chart: box, rows: rows };
  }

  function subtestBlock(r) {
    var wrap = el('div', 'subtest-report');
    (r.subtests || []).forEach(function (s) {
      var row = el('div', 'subtest-line');
      row.appendChild(el('span', 'code', s.code));
      var name = el('span', 'name');
      name.appendChild(document.createTextNode(s.name));
      if (r.summary && r.summary.weakest && r.summary.weakest.code === s.code) {
        var em = el('span', 'weak', ' \u2014 weakest gate');
        name.appendChild(em);
      }
      row.appendChild(name);
      row.appendChild(el('span', 'acc', s.accuracy + '%'));
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill');
      fill.style.width = Math.max(6, s.accuracy) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function knowledgeBlock(r) {
    var wrap = el('div', 'subtest-report');
    (r.knowledge_points || []).forEach(function (c) {
      var row = el('div', 'subtest-line');
      row.appendChild(el('span', 'code', c.code));
      var name = el('span', 'name', c.category);
      name.style.fontSize = '15px';
      row.appendChild(name);
      row.appendChild(el('span', 'acc', c.accuracy + '%'));
      var track = el('div', 'bar-track');
      var fill = el('div', 'bar-fill');
      fill.style.width = Math.max(4, c.accuracy) + '%';
      if (c.accuracy < 50) fill.style.background = 'var(--wrong)';
      track.appendChild(fill);
      row.appendChild(track);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function paceBlock(r) {
    if (!r.pace) {
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
      return el('p', 'weak-note', 'No missed questions in this session \u2014 run a longer diagnostic from your dashboard settings to find the real ceiling.');
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
    var n = r.narrative || {};
    var wrap = el('div', null);

    if (n.headline) {
      var h = el('p', 'weak-note');
      h.textContent = n.headline;
      wrap.appendChild(h);
    }
    ['trend', 'pace_read', 'knowledge_read', 'miss_read', 'risk'].forEach(function (k) {
      if (!n[k]) return;
      var label = {
        trend: 'Overall trend',
        pace_read: 'Answering pace',
        knowledge_read: 'Knowledge points',
        miss_read: 'Where the misses sit',
        risk: 'Biggest risk',
      }[k];
      var p = el('p', 'score-caption');
      p.style.marginTop = '14px';
      var st = el('strong', null, label + ': ');
      p.appendChild(st);
      p.appendChild(document.createTextNode(n[k]));
      wrap.appendChild(p);
    });

    if ((n.weak_points || []).length) {
      wrap.appendChild(sectionLabel('Missed question points'));
      n.weak_points.forEach(function (w) {
        var box = el('div', 'plan-item');
        box.style.display = 'block';
        var topic = el('p', null);
        topic.style.fontWeight = '600';
        topic.textContent = w.topic;
        box.appendChild(topic);
        if (w.why) box.appendChild(el('p', 'score-caption', w.why));
        if (w.fix) {
          var fix = el('p', 'score-caption');
          fix.style.marginTop = '6px';
          var b = el('strong', null, 'Do this: ');
          fix.appendChild(b);
          fix.appendChild(document.createTextNode(w.fix));
          box.appendChild(fix);
        }
        wrap.appendChild(box);
      });
    }

    if ((n.next_actions || []).length) {
      wrap.appendChild(sectionLabel('Your next five moves'));
      n.next_actions.forEach(function (a, i) {
        var row = el('div', 'plan-item');
        row.appendChild(el('span', 'day', String(i + 1)));
        row.appendChild(el('span', null, a));
        wrap.appendChild(row);
      });
    }

    if (r.ai_generated === false) {
      var note = el('p', 'demo-note');
      note.textContent = 'Written by our rule engine \u2014 the language model was unavailable when this report was generated. Every number above is unaffected.';
      wrap.appendChild(note);
    }
    return wrap;
  }

  function buildReportNode(r) {
    var s = el('section', 'report wrap');
    s.id = ROOT_ID;
    s.setAttribute('data-ld-report', '1');

    var eyebrow = el('span', 'eyebrow', 'Your full diagnostic report');
    s.appendChild(eyebrow);

    var h2 = el('h2');
    h2.style.marginTop = '12px';
    h2.appendChild(document.createTextNode('What the last ' + ((r.summary || {}).question_count || '') + ' questions '));
    var em = el('em', null, 'actually say');
    h2.appendChild(em);
    h2.appendChild(document.createTextNode('.'));
    s.appendChild(h2);

    s.appendChild(summaryStrip(r));
    s.appendChild(countLine(r));

    s.appendChild(sectionLabel('Nine-dimension readiness'));
    var rb = radarBlock(r);
    s.appendChild(rb.chart);
    s.appendChild(rb.rows);

    s.appendChild(sectionLabel('By subtest'));
    s.appendChild(subtestBlock(r));

    s.appendChild(sectionLabel('By knowledge point'));
    s.appendChild(knowledgeBlock(r));

    s.appendChild(sectionLabel('Pace and timing'));
    s.appendChild(paceBlock(r));

    s.appendChild(sectionLabel('Where the misses sit'));
    s.appendChild(missTopicBlock(r));

    s.appendChild(sectionLabel('Readiness trend analysis'));
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
    s.appendChild(footer);

    var note = el('p', 'demo-note');
    note.textContent = 'Keep this link \u2014 this report stays available for 180 days. ' + REFUND + '.';
    s.appendChild(note);

    return s;
  }

  // ---------------------------------------------------------------- 下载

  function download(r) {
    try {
      var s = r.summary || {};
      var html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Learndiag diagnostic report</title>' +
        '<style>' +
        'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
        'max-width:760px;margin:0 auto;padding:40px 24px;color:#3C3733;background:#F2EFE9;line-height:1.6}' +
        'h1{font-size:26px;margin:0 0 6px}h2{font-size:17px;margin:30px 0 10px;border-bottom:1px solid #D8D1C5;padding-bottom:6px}' +
        '.big{font-size:48px;color:#A67D7A;font-weight:600;margin:10px 0}' +
        '.meta{color:#6E6760;font-size:14px}table{width:100%;border-collapse:collapse;margin:10px 0}' +
        'td,th{text-align:left;padding:7px 8px;border-bottom:1px solid #D8D1C5;font-size:14px}' +
        '.mis{border-top:1px solid #D8D1C5;padding:12px 0}.q{font-weight:600;margin:4px 0}' +
        '.wrong{color:#B46F6A}.right{color:#7D9378}.ex{background:#E8E3D8;padding:10px 12px;font-size:13px;margin-top:8px}' +
        '.rp{background:#E8E3D8;padding:12px 14px;font-size:13px;margin:10px 0}' +
        '</style></head><body>';
      html += '<h1>Learndiag \u2014 Praxis 5001 diagnostic report</h1>';
      html += '<p class="meta">Generated ' + esc(new Date(r.generated_at || Date.now()).toISOString().slice(0, 16).replace('T', ' ')) + ' UTC \u00B7 built from ' +
        esc(s.question_count) + ' answered questions' + (r.ai_generated ? ' \u00B7 AI trend analysis' : '') + '</p>';
      html += '<p class="big">' + esc(s.score) + ' <span style="font-size:18px;color:#6E6760">estimated scaled score</span></p>';
      html += '<p class="meta">' + esc(s.correct_count) + ' correct of ' + esc(s.question_count) + ' (' + esc(s.accuracy) + '% accuracy) \u00B7 ' +
        esc(s.pass_probability) + '% estimated pass probability. Your state sets the real passing line.</p>';

      html += '<h2>Nine-dimension readiness</h2>';
      html += radarSvg(r.radar || [], { size: 380, labelPad: 60 });
      html += '<table><tr><th>Dimension</th><th>Score</th></tr>' + (r.radar || []).map(function (d) {
        return '<tr><td>' + esc(d.label) + '</td><td>' + (d.measured === false ? 'not measured' : esc(d.value) + '/100') + '</td></tr>';
      }).join('') + '</table>';

      html += '<h2>By subtest</h2><table><tr><th>Code</th><th>Subtest</th><th>Correct</th><th>Missed</th><th>Accuracy</th></tr>' +
        (r.subtests || []).map(function (x) {
          return '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.correct) + '/' + esc(x.attempted) +
            '</td><td>' + esc(x.misses) + '</td><td>' + esc(x.accuracy) + '%</td></tr>';
        }).join('') + '</table>';

      html += '<h2>By knowledge point</h2><table><tr><th>Code</th><th>Knowledge point</th><th>Accuracy</th></tr>' +
        (r.knowledge_points || []).map(function (c) {
          return '<tr><td>' + esc(c.code) + '</td><td>' + esc(c.category) + '</td><td>' + esc(c.accuracy) + '%</td></tr>';
        }).join('') + '</table>';

      if (r.pace) {
        html += '<h2>Pace and timing</h2><table>' +
          '<tr><td>Median per question</td><td>' + esc(r.pace.median_s) + 's</td></tr>' +
          '<tr><td>Fastest</td><td>' + esc(r.pace.fastest_s) + 's</td></tr>' +
          '<tr><td>Slowest</td><td>' + esc(r.pace.slowest_s) + 's</td></tr>' +
          '<tr><td>Answered in under 15s</td><td>' + esc(r.pace.under_15s) + '</td></tr></table>';
      }

      var n = r.narrative || {};
      html += '<h2>Readiness trend analysis</h2>';
      if (n.headline) html += '<p><strong>' + esc(n.headline) + '</strong></p>';
      [['trend', 'Overall trend'], ['pace_read', 'Answering pace'], ['knowledge_read', 'Knowledge points'],
       ['miss_read', 'Where the misses sit'], ['risk', 'Biggest risk']].forEach(function (kv) {
        if (n[kv[0]]) html += '<p><strong>' + esc(kv[1]) + ':</strong> ' + esc(n[kv[0]]) + '</p>';
      });
      if ((n.weak_points || []).length) {
        html += '<h2>Missed question points</h2>';
        n.weak_points.forEach(function (w) {
          html += '<p><strong>' + esc(w.topic) + '</strong><br>' + esc(w.why) + '<br><em>Do this: ' + esc(w.fix) + '</em></p>';
        });
      }
      if ((n.next_actions || []).length) {
        html += '<h2>Your next moves</h2><ol>' + n.next_actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ol>';
      }

      if ((r.misses || []).length) {
        html += '<h2>Every question you missed</h2>';
        r.misses.forEach(function (m, i) {
          html += '<div class="mis"><div class="q">' + (i + 1) + '. [' + esc(m.code) + ' \u00B7 ' + esc(m.category) + '] ' + esc(m.question) + '</div>' +
            '<div class="wrong">Your answer: ' + esc(m.selected_text) + '</div>' +
            '<div class="right">Correct: ' + esc(m.answer_text) + '</div>' +
            (m.explanation ? '<div class="ex">' + esc(m.explanation) + '</div>' : '') + '</div>';
        });
      }

      html += '<h2>Sources</h2><div class="rp">Score model: linear estimate from per-subtest accuracy, calibrated to the Praxis 5001 scaled-score range (140\u2013190). ' +
        'Pass probability is a demo model, not a prediction \u2014 your licensing state sets the binding passing line. ' +
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
    h2.appendChild(document.createTextNode('Maybe you are one weak spot away from '));
    h2.appendChild(el('em', null, 'passing'));
    h2.appendChild(document.createTextNode('.'));
    s.appendChild(h2);

    var p = el('p', 'score-caption');
    p.style.marginTop = '14px';
    p.appendChild(document.createTextNode(
      'You have finished the diagnostic \u2014 that part was free. The report that turns your answers into a plan is not open yet: ' +
      'the nine-dimension readiness radar, the timing analysis, the knowledge points behind each miss, and the AI trend write-up ' +
      'are all generated on our server and only sent to unlocked accounts.'));
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

    s.appendChild(ctaRow(status && status.logged_in ? '/upgrade.html' : '/login?next=' + encodeURIComponent(location.pathname),
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
          if (res.status === 402 || !res.j || !res.j.report) {
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
