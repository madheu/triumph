/**
 * js/test-registry.js — 考试注册表（D14）
 *
 * 为什么要有这个文件：
 *   设施页（study-planner / srs / mistake-log / dashboard）原先各自硬编码 5001 的
 *   四个子科。新增 8006 时，如果每页各改一遍，就会出现 N 份互相漂移的领域定义 ——
 *   这正是「改了价格漏了 md 镜像」那类事故的同一个模式。
 *   这里把「一门考试由哪些领域构成」收敛成唯一数据源，页面只读不写。
 *
 * 使用约定：
 *   - 纯静态数据 + 纯函数，无网络请求，无副作用。可在任何页面同步引入。
 *   - 不依赖 auth.js / tracking.js，引入顺序无关。
 *   - 领域名（domains[].name）必须与题库里 question.subtest 的取值逐字一致，
 *     否则按领域统计会全部落空。改动前先核题库。
 *
 * 与题库的对应关系（核验日期 2026-09-13）：
 *   5001 -> site/questions.js        subtest: Reading and Language Arts 等 4 科
 *   8006 -> site/questions-8006.js   subtest: Foundational Literacy Skills 等 3 领域
 */
(function () {
  'use strict';

  // 每门考试：code / label / 领域列表 / 题库全局变量名 / 是否可算通过率。
  // weight 用于并列时的优先级判定（对应官方占比），不是百分比本身。
  var TESTS = {
    '5001': {
      code: '5001',
      label: 'Praxis 5001 Elementary Education: Multiple Subjects',
      shortLabel: '5001 Multiple Subjects',
      bankGlobal: 'DM_BANK_EXT',
      // 5001 是合并考试，四个子科各自独立计分，领域名与题库 subtest 一致
      domains: [
        { code: '5002', name: 'Reading and Language Arts', weight: 1 },
        { code: '5003', name: 'Mathematics', weight: 1 },
        { code: '5004', name: 'Social Studies', weight: 1 },
        { code: '5005', name: 'Science', weight: 1 },
      ],
      // 有官方 raw->scaled 换算依据，可给通过率预测
      hasScaledScore: true,
      // 该考试是否有可用的练习题库（决定设施页要不要显示"题目准备中"）
      hasBank: true,
    },

    '8006': {
      code: '8006',
      label: 'Praxis 8006 Elementary Education Fundamentals: Teaching Reading',
      shortLabel: '8006 Teaching Reading',
      // 注意：8006 磁盘上有两个题库全局变量 —— DM_BANK_8006（30 题，quiz-8006.js
      // 的 mini test 用）与 DM_BANK_8006_FULL（200 题，practice-8006.js 的练习页用）。
      // 注册表登记的是「练习题库」这个口径，因为它才是用户实际刷的量，
      // 也是设施页/仪表盘该展示的题量。改这里之前先确认两处对齐。
      bankGlobal: 'DM_BANK_8006_FULL',
      bankGlobalAliases: ['DM_BANK_8006'],
      // 8006 是单科考试，按内容领域计分。权重取自官方占比 40/30/30，
      // 用 3/2/2 表示相对大小，供并列破局使用（与 quiz-8006.js 保持一致）。
      domains: [
        { code: 'FLS', name: 'Foundational Literacy Skills', weight: 3 },
        { code: 'FLV', name: 'Fluency and Vocabulary', weight: 2 },
        { code: 'CWE', name: 'Comprehension and Written Expression', weight: 2 },
      ],
      // ETS 未公布 8006 的 raw->scaled 换算表，任何通过率都是编的 -> 不提供
      hasScaledScore: false,
      hasBank: true,
    },
  };

  var DEFAULT_CODE = '5001';

  function get(code) {
    return TESTS[code] || null;
  }

  function codes() {
    return Object.keys(TESTS);
  }

  function exists(code) {
    return Object.prototype.hasOwnProperty.call(TESTS, code);
  }

  // 领域的显示名列表，传 undefined/null 时回退到 5001。
  function domainNames(code) {
    var t = get(code) || get(DEFAULT_CODE);
    return t.domains.map(function (d) { return d.name; });
  }

  // 把领域名映射回 code（study-planner 等需要 code 作表单值的场景）。
  function domainCode(code, name) {
    var t = get(code);
    if (!t) return null;
    for (var i = 0; i < t.domains.length; i++) {
      if (t.domains[i].name === name) return t.domains[i].code;
    }
    return null;
  }

  // 按名称取领域定义（含 weight），找不到返回 null。
  function domain(code, name) {
    var t = get(code);
    if (!t) return null;
    for (var i = 0; i < t.domains.length; i++) {
      if (t.domains[i].name === name) return t.domains[i];
    }
    return null;
  }

  // 从题库对象数组里按领域统计题量。用于页面显示"该领域有多少题"。
  // 返回 { name: count }，题库为空时返回空对象。
  function questionCounts(code, bank) {
    var t = get(code);
    if (!t || !Array.isArray(bank)) return {};
    var out = {};
    t.domains.forEach(function (d) { out[d.name] = 0; });
    bank.forEach(function (q) {
      if (q && Object.prototype.hasOwnProperty.call(out, q.subtest)) out[q.subtest]++;
    });
    return out;
  }

  // 考试切换器要显示的选项，供各设施页统一渲染。
  // 只列出 hasBank 为真的考试 —— 没题库的考试切过去只会看到空页面。
  function switchable() {
    return codes().filter(function (c) { return TESTS[c].hasBank; }).map(function (c) {
      return { code: c, label: TESTS[c].shortLabel };
    });
  }

  window.LDTestRegistry = {
    get: get,
    codes: codes,
    exists: exists,
    domainNames: domainNames,
    domainCode: domainCode,
    domain: domain,
    questionCounts: questionCounts,
    switchable: switchable,
    DEFAULT_CODE: DEFAULT_CODE,
    TESTS: TESTS,
  };
})();
