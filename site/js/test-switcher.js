/**
 * js/test-switcher.js — 考试切换器（D14）
 *
 * 为什么要有这个文件：
 *   mistake-log / srs / study-planner / dashboard 都需要「当前在看哪门考试」这个
 *   状态。如果每页各写一遍，切换逻辑和存储键会各说各话，用户切了页面又跳回 5001。
 *   这里统一：渲染一个 tab 条 + 读写同一个存储键（triumph_test_code，与 tracking.js
 *   和 auth.js 共用）。
 *
 * 视觉约定（重要）：
 *   复用站点已有的 .km-tabs / .km-tab / .km-tab.active 三个类 —— 它们本来就是
 *   dashboard 的知识地图 tab 用的，外观一致，不引入新样式。样式来源是各页面
 *   自己内联的 <style>；本脚本只负责结构与行为，不注入 CSS。
 *
 * 用法：
 *   <div id="test-switcher"></div>           // 或任意容器
 *   LDTestSwitcher.mount('#test-switcher', { onChange: function (code) { ... } });
 *
 *   onChange 会被立刻调用一次（用当前值），这样页面不需要在初始化时另取一次。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'triumph_test_code';

  function readCurrent() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v && window.LDTestRegistry && window.LDTestRegistry.exists(v)) return v;
    } catch (e) { /* storage unavailable */ }
    return (window.LDTestRegistry && window.LDTestRegistry.DEFAULT_CODE) || '5001';
  }

  function writeCurrent(code) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* storage unavailable */ }
  }

  /**
   * 渲染切换器。
   * @param {string|Element} target 容器选择器或元素
   * @param {{onChange?: function(string), codes?: string[]}} opts
   * @returns {?Element} 根节点
   */
  function mount(target, opts) {
    opts = opts || {};
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el || !window.LDTestRegistry) return null;

    var codes = opts.codes || window.LDTestRegistry.switchable().map(function (t) { return t.code; });
    // 只有一门考试时不必显示切换器 —— 多一个无意义的按钮只会让人以为哪里没加载
    if (codes.length < 2) { el.innerHTML = ''; return el; }

    var current = readCurrent();
    if (codes.indexOf(current) === -1) current = codes[0];

    var bar = document.createElement('div');
    bar.className = 'km-tabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Select test');

    var buttons = [];
    codes.forEach(function (code) {
      var t = window.LDTestRegistry.get(code);
      if (!t) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'km-tab' + (code === current ? ' active' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', code === current ? 'true' : 'false');
      b.textContent = t.shortLabel;
      b.addEventListener('click', function () {
        if (b.classList.contains('active')) return;
        buttons.forEach(function (x) {
          x.classList.remove('active');
          x.setAttribute('aria-selected', 'false');
        });
        b.classList.add('active');
        b.setAttribute('aria-selected', 'true');
        current = code;
        writeCurrent(code);
        if (typeof opts.onChange === 'function') opts.onChange(code);
      });
      buttons.push(b);
      bar.appendChild(b);
    });

    el.innerHTML = '';
    el.appendChild(bar);

    writeCurrent(current);
    if (typeof opts.onChange === 'function') opts.onChange(current);
    return el;
  }

  window.LDTestSwitcher = {
    mount: mount,
    current: readCurrent,
    set: writeCurrent,
    STORAGE_KEY: STORAGE_KEY,
  };
})();
