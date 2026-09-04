/* theme.js — 全站主题控制。
 *
 * 为什么必须同步加载（不能 defer / async）：
 * 这个脚本要在浏览器绘制第一帧之前就把 data-theme 打到 <html> 上。
 * 如果等 DOMContentLoaded 再切，用户会先看到一帧浅色再跳成深色 —— 就是那个
 * 很廉价的"白闪"。所以页面里它是 <head> 里的阻塞脚本，且必须排在 CSS 之前。
 *
 * 三种取值：light / dark / system。默认是 system，跟操作系统走。
 * 存 localStorage 的 triumph_theme，未登录也有意义 —— 主题是设备偏好，不是账号数据，
 * 不该要求登录才能选。登录后会随 state 一起同步，换设备跟着走。
 */
(function () {
  var KEY = 'triumph_theme';
  var VALID = { light: 1, dark: 1, system: 1 };

  function mq() {
    return window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  }

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return VALID[v] ? v : null;
    } catch (e) {
      return null;
    }
  }

  function resolve(pref) {
    if (pref === 'dark' || pref === 'light') return pref;
    var m = mq();
    return m && m.matches ? 'dark' : 'light';
  }

  function apply() {
    var pref = stored() || 'system';
    var theme = resolve(pref);
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-pref', pref);
    // 让原生控件（滚动条、日期选择器、表单）跟着变，否则深色页上会冒出一块白
    root.style.colorScheme = theme;
    if (window.LDTheme && window.LDTheme._listeners) {
      for (var i = 0; i < window.LDTheme._listeners.length; i++) {
        try { window.LDTheme._listeners[i](theme, pref); } catch (e) { }
      }
    }
  }

  apply();

  // 选了 system 的人，系统主题一变页面要立刻跟上
  var m = mq();
  if (m) {
    if (m.addEventListener) {
      m.addEventListener('change', function () {
        if ((stored() || 'system') === 'system') apply();
      });
    } else if (m.addListener) {
      m.addListener(function () {
        if ((stored() || 'system') === 'system') apply();
      });
    }
  }

  // 同一浏览器开了两个标签页，一边改主题另一边跟着变
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) apply();
  });

  window.LDTheme = {
    KEY: KEY,
    _listeners: [],
    get: function () { return stored() || 'system'; },
    /** 当前实际生效的主题：dark 或 light */
    resolved: function () {
      return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    },
    set: function (v) {
      if (!VALID[v]) v = 'system';
      try { localStorage.setItem(KEY, v); } catch (e) { }
      apply();
    },
    onChange: function (fn) {
      if (typeof fn === 'function' && this._listeners.indexOf(fn) < 0) this._listeners.push(fn);
    },
    apply: apply,
  };
})();
