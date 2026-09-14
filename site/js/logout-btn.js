/**
 * logout-btn.js — 给没有登出入口的页面补一个「Log out」
 *
 * 为什么是注入而不是改每个页面：
 *   全站只有 dashboard.html 有登出入口（它在自己的 React nav 里渲染了一个按钮）。
 *   practice / diagnostic / 8006 这些页面都是独立的内联 React SPA，
 *   逐个改它们的 nav 组件要动 3 处压缩过的代码，风险高且容易改出偏差。
 *   这里统一在 DOM 层往 `header.nav` 末尾追加一个链接，样式复用现成的
 *   `.nav-cta`（dashboard 的 nav 链接就是这个类），视觉上与页面自带链接一致。
 *
 * 行为约定：
 *   - 未登录不注入（避免每个页面都挂个没用的按钮）
 *   - 幂等：靠 data-ld-logout 标记，重复加载脚本不会出现第二个按钮
 *   - 只用 TriumphAuth.logout()，不自己清 localStorage —— 清哪些键是 auth.js 的职责，
 *     这里抄一份列表就会第二次出现「两套标准不一致」
 *   - 登出后 reload：让页面回到干净的未登录渲染
 *   - MutationObserver 是为了等 React 渲染出 nav；注入成功后立刻 disconnect，
 *     另有 20 秒兜底，不会长期占用主线程
 *
 * 依赖：auth.js 必须先加载（读 window.TriumphAuth）。缺了就静默退出。
 */
(function () {
  'use strict';

  var MARK = 'data-ld-logout';
  var injected = false;

  function findNav() {
    return document.querySelector('header.nav') ||
           document.querySelector('.nav.wrap') ||
           document.querySelector('header[class*="nav"]');
  }

  function inject() {
    if (injected) return true;

    var T = window.TriumphAuth;
    if (!T || typeof T.isLoggedIn !== 'function') return false;
    if (!T.isLoggedIn()) return false;      // 还没登录，继续等（注册后可能变）

    var n = findNav();
    if (!n) return false;                    // nav 还没渲染出来

    if (n.querySelector('[' + MARK + ']')) { injected = true; return true; }

    var a = document.createElement('a');
    a.setAttribute(MARK, '1');
    a.className = 'nav-cta';
    a.href = '#';
    a.textContent = 'Log out';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      try { T.logout(); } catch (err) { /* 清存储失败也要继续 reload */ }
      try { window.location.reload(); } catch (err) { /* 兜底 */ }
    });
    n.appendChild(a);
    injected = true;
    return true;
  }

  function start() {
    if (inject()) return;
    if (!window.MutationObserver) return;

    var mo = new MutationObserver(function () {
      if (inject() && mo) { mo.disconnect(); mo = null; }
    });
    mo.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
    // 兜底：20 秒后无论成功与否都停，避免长期挂观察器
    window.setTimeout(function () {
      if (mo) { mo.disconnect(); mo = null; }
    }, 20000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
