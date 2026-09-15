// login-tracking.js — 注册/登录页的埋点桥（2026-09-10）
//
// 为什么需要这个文件：
//   login.html 是注册的唯一落地页，也是漏斗第 5 段（signup_success）唯一可靠的
//   产生地，但它此前完全没有埋点 —— 生产库里 signup_success 恒为 0，不是因为
//   没人注册，而是因为这条路径上没有任何事件。
//
// 设计约束（与 signup-hook.js 一致）：
//   - login.html 的流程脚本是压缩过的 IIFE，私有状态外部读不到。
//     本文件不碰它，只用两种手段：监听可观察的 DOM 事件 + 包装
//     window.TriumphAuth 上的公开方法（register / verify）。
//   - triumph_* localStorage key 与 TriumphAuth 是既有体系，只读/包装，不重定义。
//
// signup_method 取值与字典 §3.1 对齐：
//   email_code  —— 邮箱验证码（本页的 密码+验证码 注册，以及诊断页的魔术码卡片）
//   magic_link  —— 从邮件点链接
//   google      —— Google 登录回跳
(function () {
  'use strict';

  var L = window.LDTrack;
  var T = window.TriumphAuth;
  if (!L || !T) return;

  var startFired = false;
  var successFired = false;

  // ---------------------------------------------------------------- 工具

  function userIdFromToken(token) {
    try {
      var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var payload = JSON.parse(atob(part));
      return payload.sub || null;
    } catch (e) { return null; }
  }

  function markSuccess(method, email) {
    if (successFired) return;
    successFired = true;
    L.identify(userIdFromToken(T.token || '') || email || null, method);
    L.flushNow();
  }

  // 当前处于哪一步。内联脚本把它存在私有变量里，外部只能从 DOM 反推：
  // verify 态的判据是验证码输入框可见（内联脚本切换模式时会改它的 display）。
  function currentMode() {
    var cf = document.getElementById('code-field');
    if (cf && cf.style.display !== 'none') return 'verify';
    var submit = document.getElementById('submit');
    var label = submit ? (submit.textContent || '') : '';
    return /create account/i.test(label) ? 'register' : 'login';
  }

  // ------------------------------------------------------------ signup_start

  var form = document.getElementById('auth-form');
  if (form) {
    form.addEventListener('submit', function () {
      var mode = currentMode();
      if (mode === 'login') return;          // 老用户登录不是注册的开始
      if (startFired) return;
      startFired = true;
      L.track('signup_start', { signup_method: 'email_code' });
    }, true);
  }

  // 主动点 “Sign up” 切换过去，也算开始注册（比提交更早的意图信号）
  var sw = document.getElementById('switch-btn');
  if (sw) {
    sw.addEventListener('click', function () {
      if (startFired) return;
      var label = (document.getElementById('switch-label') || {}).textContent || '';
      if (!/no account yet/i.test(label)) return;   // 只有「将要进入注册」才算
      startFired = true;
      L.track('signup_start', { signup_method: 'email_code' });
    }, true);
  }

  // ---------------------------------------------------------- signup_success
  //
  // 包装而非改写：这两个方法是 TriumphAuth 的公开 API，包装后行为不变。

  if (typeof T.register === 'function') {
    var origRegister = T.register;
    T.register = function (email, password) {
      var self = this;
      return origRegister.call(self, email, password).then(function (user) {
        // 走到这里说明不需要邮箱验证，注册当场完成
        markSuccess('email_code', email);
        return user;
      });
      // verification_required / mail_failed 会被原样抛出，
      // 真正的成功时刻推迟到 verify() —— 那里会再判定一次。
    };
  }

  if (typeof T.verify === 'function') {
    var origVerify = T.verify;
    T.verify = function (email, code) {
      var self = this;
      return origVerify.call(self, email, code).then(function (user) {
        markSuccess('email_code', email);
        return user;
      });
    };
  }

  // Google 登录回跳：auth.js 的 googleLogin 会把 token 放在 URL hash 里，
  // 落地即视为完成。本文件放在内联脚本之前加载，此时 hash 还没被清掉。
  (function () {
    var hash = window.location.hash || '';
    if (!/triumph_token=/.test(hash)) return;
    // 回跳后 token 由内联脚本写入会话，此处只需标记来源
    var m = hash.match(/triumph_token=([^&]+)/);
    if (!m) return;
    markSuccess('google', null);
  })();
})();
