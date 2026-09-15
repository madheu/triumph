/**
 * tracking.js — Learndiag 产品事件埋点层（D4 草案）
 *
 * 状态：草案。落 drafts/，未部署、未接入任何页面。
 * 事件字典见 docs/analytics-events-v1.md，表结构见 drafts/2026-09-03-product-events-schema.sql
 *
 * 目标：12 个转化事件双写 GA4 + 自有 D1 表，五段漏斗可拆。
 *
 * 设计要点：
 *   1. 匿名优先。未登录也要能埋 —— 漏斗前四段全是匿名用户，
 *      这是现有 /api/t/attempts（需登录）最大的盲区。
 *   2. traffic_source 首次访问即固化。不固化的话，注册时 referrer 已变成站内地址，
 *      所有注册都会归为 direct，漏斗按来源拆永远失效。
 *   3. 失败入队重试。用 sendBeacon 优先、fetch 兜底，失败写 localStorage 队列，
 *      下次加载时重放。埋点丢数据比晚到数据严重得多。
 *   4. 不向 GA4 发 PII。user_id 用内部 UUID，邮箱一律不出网。
 *   5. localStorage key 用 ld_ 前缀。既有的 triumph_* key 是另一个体系
 *      （见 brand-spec.md），本模块不读、不写、不改。
 *
 * 接入方式（待批准后）：
 *   <script src="/js/tracking.js"></script>
 *   <script>LDTrack.init({ testCode: '5001', page: 'diagnostic' });</script>
 */

(function (global) {
  'use strict';

  var QUEUE_KEY = 'ld_event_queue';
  var VISITOR_KEY = 'ld_visitor';
  var SOURCE_KEY = 'ld_source';
  var SESSION_KEY = 'ld_session';

  var SESSION_TTL_MS = 30 * 60 * 1000;      // 30 分钟无活动则轮换 session
  var LAST_VISIT_KEY = 'ld_last_visit';      // 上次访问时间戳，return_visit 判定用
  var RETURN_WINDOW_MS = 24 * 60 * 60 * 1000; // 字典 §2：> 24h 才算一次回访
  var MAX_BATCH = 20;                        // 单次批量上报上限
  var MAX_QUEUE = 200;                       // 本地队列上限，防止 localStorage 撑爆
  var FLUSH_INTERVAL_MS = 5000;

  var EVENTS = [
    'test_view', 'test_start', 'question_answer', 'test_complete',
    'result_view', 'signup_prompt_view', 'signup_start', 'signup_success',
    'study_plan_unlock', 'return_visit', 'retest_start', 'share_click',
    // ↓ v1.1 新增：付费漏斗。原 12 个事件止于 signup_success，
    //   注册之后的整段（看到升级页 → 发起结账 → 真的付了钱）零埋点，
    //   转化优化里的付费点、价格锚点做完也没法判断有没有用。
    'upgrade_view', 'checkout_start', 'purchase_success'
  ];

  // GA4 事件名映射。绝大多数同名，只有这几个例外：
  //   自有表用自描述名，GA4 侧用推荐事件名（生态价值更高：可被 Ads 识别、
  //   进默认报表）。两者一一对应，在查询侧做映射，不重复计数。
  var GA4_NAME_MAP = {
    signup_success: 'sign_up',
    upgrade_view: 'view_promotion',
    checkout_start: 'begin_checkout',
    purchase_success: 'purchase'
  };

  var state = {
    inited: false,
    testCode: null,
    page: null,
    visitorId: null,
    sessionId: null,
    userId: null,
    attemptId: null,
    trafficSource: null,
    device: null,
    buffer: [],
    timer: null
  };

  // -------------------------------------------------------------- 工具

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    var b = new Uint8Array(16);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var j = 0; j < 16; j++) h.push(('0' + b[j].toString(16)).slice(-2));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' +
           h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  }

  function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function detectDevice() {
    var w = global.innerWidth || 0;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  /**
   * traffic_source 判定 —— 只在首次访问时执行一次，结果固化。
   *
   * 为什么必须固化：漏斗第 3–5 步发生在同一域内，document.referrer 此时已变成
   * 站内地址。若在注册时才判定，所有注册都会被归为 direct，
   * 「按 traffic_source 拆漏斗」这条验收标准直接失效。
   */
  function detectTrafficSource() {
    try {
      var u = new URL(global.location.href);
      var utmMedium = (u.searchParams.get('utm_medium') || '').toLowerCase();
      var utmSource = (u.searchParams.get('utm_source') || '').toLowerCase();

      if (u.searchParams.get('gclid') || u.searchParams.get('fbclid')) return 'paid';
      if (utmMedium === 'cpc' || utmMedium === 'ppc' || utmMedium === 'paid') return 'paid';
      if (utmMedium === 'email') return 'email';
      if (utmMedium === 'social' || utmSource.indexOf('facebook') >= 0) return 'social';

      var ref = (global.document.referrer || '').toLowerCase();
      if (!ref) return 'direct';
      if (/google\.|bing\.|duckduckgo\.|yahoo\.|baidu\./.test(ref)) return 'organic';
      if (/facebook\.|instagram\.|pinterest\.|reddit\.|x\.com|twitter\./.test(ref)) return 'social';
      if (ref.indexOf(global.location.hostname) >= 0) return 'direct';   // 站内跳转
      return 'referral';
    } catch (e) {
      return 'direct';
    }
  }

  function getOrCreateVisitor() {
    var v = lsGet(VISITOR_KEY);
    if (!v) {
      v = uuid();
      lsSet(VISITOR_KEY, v);
      // 首次访问 —— 此时固化来源，之后不再重算
      var src = detectTrafficSource();
      lsSet(SOURCE_KEY, src);
      return { id: v, source: src, isNew: true };
    }
    return { id: v, source: lsGet(SOURCE_KEY) || 'direct', isNew: false };
  }

  /**
   * 返回 { id, isNew }。
   *
   * isNew 是 return_visit 的判定依据：同一 session 内刷新页面不算回访
   * （那是同一次访问），只有 session 轮换过才是一次真正的回访。
   */
  function getOrCreateSession() {
    var raw = lsGet(SESSION_KEY);
    var now = Date.now();
    if (raw) {
      var parts = raw.split('|');
      if (parts.length === 2 && (now - parseInt(parts[1], 10)) < SESSION_TTL_MS) {
        lsSet(SESSION_KEY, parts[0] + '|' + now);
        return { id: parts[0], isNew: false };
      }
    }
    var s = uuid();
    lsSet(SESSION_KEY, s + '|' + now);
    return { id: s, isNew: true };
  }

  // -------------------------------------------------------------- 上报

  function loadQueue() {
    try { return JSON.parse(lsGet(QUEUE_KEY) || '[]'); } catch (e) { return []; }
  }

  function saveQueue(q) {
    var trimmed = q.length > MAX_QUEUE ? q.slice(q.length - MAX_QUEUE) : q;
    lsSet(QUEUE_KEY, JSON.stringify(trimmed));
  }

  function toGA4(evt, props) {
    if (typeof global.gtag !== 'function') return;
    var name = GA4_NAME_MAP[evt] || evt;

    // ⚠️ 绝不发 PII。这里只透传非身份类属性。
    // value / currency / plan 是 GA4 电商语义所需 —— 没有 value 的 purchase
    // 在 Ads 和默认报表里基本读不出东西。
    var GA4_PROPS = [
      'page', 'test_code', 'traffic_source', 'device',
      'score_band', 'weakest_domain', 'signup_method',
      'content_domain', 'attempt_id', 'question_id', 'correct', 'elapsed_ms',
      'plan', 'value', 'currency'
    ];
    var payload = {};
    for (var i = 0; i < GA4_PROPS.length; i++) {
      var k = GA4_PROPS[i];
      if (props[k] !== undefined && props[k] !== null) payload[k] = props[k];
    }
    // visitor_id 仅用于自有表缝合，不进 GA4（属于用户标识，且会吃自定义维度配额）
    try { global.gtag('event', name, payload); } catch (e) { /* 埋点不得阻断业务 */ }
  }

  function flush() {
    if (state.timer) { global.clearTimeout(state.timer); state.timer = null; }

    var pending = loadQueue().concat(state.buffer);
    state.buffer = [];
    if (!pending.length) return;

    var batch = pending.slice(0, MAX_BATCH);
    var rest = pending.slice(MAX_BATCH);

    var body = JSON.stringify({ events: batch });
    var apiBase = (global.TRIUMPH_API || '');   // 空 = 同域相对路径 /api/*，与 auth.js 等模块口径一致
                                                // （2026-09-06 修复：原先在 apiBase 为空时直接放弃发送，
                                                //  而线上从不设置 window.TRIUMPH_API，导致埋点全哑、
                                                //  product_events 表永远 0 行）

    var ok = false;
    try {
      // sendBeacon 优先：页面卸载时也能发出去（用户做完测试直接关页面的场景很常见）
      if (global.navigator && typeof global.navigator.sendBeacon === 'function') {
        ok = global.navigator.sendBeacon(apiBase + '/api/t/events', new Blob([body], { type: 'application/json' }));
      }
    } catch (e) { ok = false; }

    if (!ok) {
      try {
        global.fetch(apiBase + '/api/t/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true
        }).then(function (res) {
          if (!res.ok) saveQueue(rest.concat(batch));
          else saveQueue(rest);
        }).catch(function () { saveQueue(rest.concat(batch)); });
        return;
      } catch (e) {
        saveQueue(rest.concat(batch));
        return;
      }
    }
    saveQueue(rest);
  }

  function schedule() {
    if (state.timer) return;
    state.timer = global.setTimeout(flush, FLUSH_INTERVAL_MS);
  }

  // -------------------------------------------------------------- 公开 API

  var LDTrack = {
    /** 页面级初始化。每页调一次。 */
    init: function (opts) {
      opts = opts || {};
      state.testCode = opts.testCode || null;
      state.page = opts.page || normalisePage(global.location.pathname);
      state.device = detectDevice();

      // D14: 把页面声明的 testCode 记成「当前考试」，供 TriumphAuth 的 state
      // 同步层选择本地 key 前缀（8006 -> triumph_8006_*）。没有 testCode 的
      // 页面保持不动，同步层会一律按 5001 处理 —— 存量页面因此无需改动。
      // 写失败不影响埋点，所以整段吞掉异常。
      try {
        if (state.testCode && global.localStorage) {
          global.localStorage.setItem('triumph_test_code', state.testCode);
        }
      } catch (e) { /* storage unavailable */ }

      var v = getOrCreateVisitor();
      state.visitorId = v.id;
      state.trafficSource = v.source;
      var sess = getOrCreateSession();
      state.sessionId = sess.id;
      state.inited = true;

      // return_visit：字典 §2 的定义是「距上次访问 > 24h 且本地存在历史结果」。
      // 原实现按 session 轮换（30 分钟）判定，同一访客 1 小时内能报两次回访 ——
      // 生产数据已证实（span_hours 出现 0 和 1），口径与字典不符、数值虚高。
      // 改为显式比较上次访问时间戳。首次访问（v.isNew）仍不作数。
      var lastVisit = parseInt(lsGet(LAST_VISIT_KEY) || '', 10);
      var nowMs = Date.now();
      if (!v.isNew && lastVisit && (nowMs - lastVisit) > RETURN_WINDOW_MS) {
        var hasResult = false;
        try {
          // 只读既有 auth 体系的结果标记，用于 has_saved_result 属性（字典 §3.1）
          hasResult = !!lsGet('triumph_last_score');
        } catch (e) { /* 读不到即视为无历史结果 */ }
        LDTrack.track('return_visit', {
          extra: {
            days_since_last: Math.floor((nowMs - lastVisit) / 86400000),
            has_saved_result: hasResult
          }
        });
      }
      lsSet(LAST_VISIT_KEY, String(nowMs));

      // 从既有 auth 体系读登录态（只读，不改）
      try {
        if (global.TriumphAuth && global.TriumphAuth.token) {
          state.userId = global.TriumphAuth.user || null;
        }
      } catch (e) { /* auth 未加载不算错误 */ }

      // 页面卸载前尽力发一次
      global.addEventListener('beforeunload', flush);
      global.addEventListener('pagehide', flush);

      // 重放上次失败的事件
      if (loadQueue().length) schedule();

      return state.visitorId;
    },

    /** 开始一次测试，返回 attempt_id。串联 start→answer×N→complete 用。 */
    newAttempt: function () {
      state.attemptId = uuid();
      return state.attemptId;
    },

    /** 当前 attempt_id（未开始为 null）。诊断报告按 attempt 归档，重复打开不重复计数。 */
    currentAttempt: function () { return state.attemptId || null; },

    /**
     * 匿名 visitor_id。免登录购买诊断报告时要拿它当凭证归属键
     * —— 报告凭证挂在 visitor 上而不是邮箱上，因为产品允许不注册就买。
     */
    visitor: function () { return state.visitorId || null; },

    /**
     * 注册成功后调用，回填该匿名访客的全部历史事件。不做这步，注册转化率恒为 0。
     *
     * signup_method 必须与 signup_start 一致，否则漏斗第 4→5 段按 method 拆不开。
     * 站点现有三种取值（字典 §3.1）：
     *   'email_code'  邮箱验证码 —— login.html 的 密码+验证码 注册，以及诊断页的卡片
     *   'magic_link'  从邮件点链接直接落地
     *   'google'      Google 登录回跳
     * 默认取 'email_code'：它是当前注册量最大的路径。
     */
    identify: function (userId) {
      state.userId = userId;
      this.track('signup_success', { signup_method: arguments[1] || 'email_code', user_id: userId });
    },

    track: function (event, props) {
      if (!state.inited) return;                       // 未 init 不埋，避免半状态脏数据
      if (EVENTS.indexOf(event) < 0) return;           // 非字典内事件直接丢弃

      props = props || {};
      var rec = {
        event_uuid: uuid(),
        event: event,
        ts: Date.now(),
        visitor_id: state.visitorId,
        session_id: state.sessionId,
        user_id: props.user_id || state.userId || null,
        attempt_id: props.attempt_id || state.attemptId || null,
        page: props.page || state.page || null,
        test_code: props.test_code || state.testCode || null,
        traffic_source: state.trafficSource,
        device: state.device,
        score_band: props.score_band || null,
        weakest_domain: props.weakest_domain || null,
        signup_method: props.signup_method || null,
        content_domain: props.content_domain || null,
        question_id: props.question_id || null,
        correct: props.correct === true ? 1 : (props.correct === false ? 0 : null),
        elapsed_ms: props.elapsed_ms || null,
        extra_json: props.extra ? JSON.stringify(props.extra) : null
      };

      toGA4(event, props);                 // GA4 侧（含名称映射与 PII 过滤）
      state.buffer.push(rec);              // 自有表侧

      if (state.buffer.length >= MAX_BATCH) flush();
      else schedule();
    },

    /** 立即上报，不等定时。做完测试/注册成功这类关键节点用。 */
    flushNow: flush,

    _state: function () {
      return {
        visitorId: state.visitorId, sessionId: state.sessionId,
        userId: state.userId, attemptId: state.attemptId,
        trafficSource: state.trafficSource, device: state.device
      };
    }
  };

  function normalisePage(pathname) {
    var p = (pathname || '/').replace(/^\/+|\/+$/g, '');
    return p || 'home';
  }

  // 视口可见性触发（signup_prompt_view / result_view 用）
  // 为什么不用「渲染即触发」：注册提示若在折叠下方，用户没滚到就是没看见，
  // 而这正是漏斗第三段要测的东西。渲染即触发会让这段恒为 100%，失去意义。
  //
  // threshold 必须按元素实际高度自适应：
  // IntersectionObserver 的 ratio 是「可见面积 / 元素总面积」，元素一旦高于视口，
  // ratio 上限就只有「视口高 / 元素高」。结果页 .report 轻松超过 2000px，
  // 在写死的 0.5 阈值下永远达不到，事件等于没埋 ——
  // 生产数据证实：test_complete 16 条，result_view 只有 2 条。
  LDTrack.observeOnce = function (el, event, props) {
    if (!el) return;
    if (!global.IntersectionObserver) { LDTrack.track(event, props); return; }
    var vh = global.innerHeight || (global.document && global.document.documentElement.clientHeight) || 800;
    var elH = el.getBoundingClientRect ? el.getBoundingClientRect().height : 0;
    var threshold = 0.5;
    if (elH > 0) threshold = Math.max(0.05, Math.min(0.5, vh / elH));
    var io = new global.IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          LDTrack.track(event, props);
          io.disconnect();
          break;
        }
      }
    }, { threshold: threshold });
    io.observe(el);
  };

  global.LDTrack = LDTrack;
})(window);
