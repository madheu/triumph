// upgrade-tracking.js — 升级/付费页的埋点桥（2026-09-10）
//
// 背景：付费漏斗此前完全没有埋点。原 12 个事件止于 signup_success，
// 「进了升级页 → 点了结账 → 真的付了钱」这三步在数据上不可见 ——
// 转化优化里加的付费点与价格锚点做完，也没法判断有没有用。
//
// 三个事件的分界（互不重叠、各自只代表一件事）：
//   upgrade_view      页面加载 —— 付费意图的曝光
//   checkout_start    点「Upgrade to Pro」且已登录（真的会跳去 Creem）
//   purchase_success  以 ?pro=1 回跳 —— 该标记由升级页自身的轮询脚本在
//                     /api/me 确认 plan=pro 之后才附加，
//                     等价于「后端已确认收款」，而不是用户自称付过款。
(function () {
  'use strict';

  var L = window.LDTrack;
  if (!L) return;

  // 顶层字段进 GA4（purchase / begin_checkout 需要 value + currency 才有语义），
  // extra 里的同一份进自有表的 extra_json（含 interval，GA4 侧不需要）。
  var PRO = {
    plan: 'pro',
    value: 15,
    currency: 'usd',
    extra: { plan: 'pro', price: 15, currency: 'usd', interval: 'month' }
  };

  L.track('upgrade_view', PRO);

  var btn = document.getElementById('upgrade-btn');
  if (btn) {
    btn.addEventListener('click', function () {
      var T = window.TriumphAuth;
      // 未登录时这个按钮会把用户送去登录页，那不算发起结账 ——
      // 与升级页脚本自身的分支判断保持一致。
      if (!T || !T.token) return;
      L.track('checkout_start', PRO);
      L.flushNow();
    }, true);
  }

  var params = new URLSearchParams(window.location.search);
  if (params.get('pro') === '1') {
    L.track('purchase_success', PRO);
    L.flushNow();
  }
})();
