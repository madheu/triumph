/*!
 * motion.js — Learndiag 动效驱动 v1.1 · 2026-10-18
 *
 * 职责只有两件：
 *   1. 给「首屏之外」的静态内容块打 data-mo，滚动到附近时加 .mo-in（播放进场动画）
 *   2. 长页面挂一条阅读进度条
 *
 * 安全设计（v1.1 重写，这几条比动效本身重要）：
 *   · 内容默认可见。隐藏只发生在动画播放的那 0.55 秒里 ——
 *     所以本文件不执行 / 报错 / IO 不回调，最坏结果都只是"没有动画"，绝不是内容消失
 *   · 首屏内的元素直接跳过：不打标、不动画 —— 保护 LCP，也避免首帧闪烁
 *   · rootMargin 取正值(+140px)：动画在元素进入视口之前就开始，用户看不到"闪现"
 *   · prefers-reduced-motion: reduce 时直接 return，一个字节的动效都不做
 *   · 不监听 mousemove、不做逐帧计算；scroll 用 rAF 合帧 + passive
 */
(function () {
  'use strict';

  if (window.__moInit) return;
  window.__moInit = 1;

  var root = document.documentElement;

  // 用户要求降动效 / 浏览器不支持 → 什么都不做（内容照样可见）
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (e) { /* matchMedia 不可用 → 按"能动"处理 */ }
  if (!('IntersectionObserver' in window)) return;

  var vh = window.innerHeight || 800;

  // ---------- 1. 收集首屏之外的静态块 ----------
  var SELECTOR = [
    'article > p', 'article > ul', 'article > ol', 'article > table',
    'article > blockquote', 'article > figure', 'article > h2',
    'article > .sources', 'article > div',
    'main > .card', '.card', '.tool-card'
  ].join(',');

  var nodes = [];
  try {
    var list = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < list.length && nodes.length < 160; i++) {
      var el = list[i];
      if (el.hasAttribute('data-mo')) continue;
      var r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.top < vh * 0.94) continue;      // 首屏内：跳过，保持立即可见
      nodes.push(el);
    }
  } catch (e) {
    return;                                  // 选择器出错：什么都不做，页面照常
  }

  // ---------- 2. 进场观察 ----------
  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      if (!en.isIntersecting) continue;
      en.target.classList.add('mo-in');
      io.unobserve(en.target);
    }
  }, { rootMargin: '0px 0px 140px 0px', threshold: 0 });   // 正值：提前 140px 起播

  var perParent = new Map();                 // 同父元素内 55ms 递进，最多 330ms
  root.classList.add('mo-on');
  for (var n = 0; n < nodes.length; n++) {
    var node = nodes[n];
    node.setAttribute('data-mo', '');
    if (/^H2$/.test(node.tagName)) node.classList.add('mo-h2');

    var p = node.parentNode;
    var seen = perParent.get(p) || 0;
    perParent.set(p, seen + 1);
    if (seen) node.style.setProperty('--mo-d', Math.min(seen * 55, 330) + 'ms');

    io.observe(node);
  }

  // ---------- 3. 阅读进度条 ----------
  try {
    var doc = document.documentElement;
    if (doc.scrollHeight > vh * 1.35) {
      var bar = document.createElement('div');
      bar.className = 'mo-progress';
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);

      var ticking = false;
      var paint = function () {
        ticking = false;
        var max = doc.scrollHeight - window.innerHeight;
        var y = window.pageYOffset || doc.scrollTop || 0;
        var ratio = max > 0 ? y / max : 0;
        if (ratio < 0) ratio = 0;
        if (ratio > 1) ratio = 1;
        bar.style.setProperty('--mo-p', ratio.toFixed(4));
      };
      window.addEventListener('scroll', function () {
        if (!ticking) { ticking = true; requestAnimationFrame(paint); }
      }, { passive: true });
      paint();
    }
  } catch (e) { /* 进度条失败不影响阅读 */ }
})();
