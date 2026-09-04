/**
 * magic-landing.js — 接管从邮箱点开的 magic 链接（跨设备场景）
 *
 * 为什么需要它：
 *   /api/magic/redeem 完成后会 302 回来源页，并在 URL fragment 上带一次性 JWT
 *   （#magic=<jwt>）。这台设备此前从未访问过站点，localStorage 里没有会话，
 *   不接管的话用户落地即未登录 —— 刚保存的成绩在新设备上就拿不回来了。
 *
 *   同设备跨标签页不走这里：那条路径靠 /api/magic/status 轮询，由
 *   signup-hook.js / quiz-8006.js 自己处理。
 *
 * 为什么用 fragment 而不是 query 传 token：
 *   fragment 不进 Referer、不进服务器访问日志、不进 GA4 的 page_location。
 *   服务端仍校验一次性 token，fragment 本身不构成新攻击面。
 *
 * 依赖：auth.js 必须先加载（用 window.TriumphAuth._setSession）。
 */
(function () {
  'use strict';

  var T = window.TriumphAuth;
  if (!T) return;

  // 只认 fragment 上的 magic=；query 上的同名参数不处理，
  // 避免把 token 写进 Referer 的那条路径被当成正常入口。
  var m = /(?:^|#|&)magic=([^&]+)/.exec(window.location.hash || '');
  if (!m) return;

  var token = decodeURIComponent(m[1] || '');
  if (!token) return;

  // 立刻把 token 从地址栏抹掉 —— 别让它留在浏览器历史里，
  // 也别让用户在地址栏里看见一长串 JWT。
  try {
    var clean = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', clean);
  } catch (e) { /* replaceState 失败不影响后续接管 */ }

  var email = '';
  try {
    var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    var payload = JSON.parse(window.atob(part));
    email = payload.email || '';
  } catch (e) { /* 解不出邮箱也能登录，只是 triumph_user 留空 */ }

  try { T._setSession(token, email); } catch (e) { /* storage 不可用时至少内存里有会话 */ }

  // 服务端此刻已持有合并后的状态（注册时快照 + 本设备可能已有的进度）。
  // 拉下来再刷新，落地即是已解锁的登录态，成绩原样显示。
  var done = function () { window.location.reload(); };
  try {
    var p = T.syncPull();
    if (p && typeof p.then === 'function') {
      p.then(done, done);
      window.setTimeout(done, 4000); // 网络卡住也不能一直停在空白页
    } else {
      done();
    }
  } catch (e) {
    done();
  }
})();
