/**
 * tools/test-dashboard-multitest.mjs — dashboard 多考试派生逻辑回归测试（D14）
 *
 * 为什么单独测：
 *   site/dashboard.html 是压缩过的单行 React 页，构建期不做语义校验。
 *   D14 之后它的知识地图 / 子科网格 / 题库数都改成按「当前考试」派生，
 *   一旦 LD_derive 的返回结构变了，页面会在运行时抛 null 错误（白屏），
 *   而 node --check 只验语法、发现不了。
 *
 * 做法：
 *   从真实的 dashboard.html 里把 LD_* 这几个函数抠出来（不复制粘贴，
 *   直接读源文件，避免测试与实现漂移），在一个最小的假 window 里求值，
 *   加载真实的 test-registry.js 与两套题库，然后断言派生结果。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** 从 dashboard.html 的 babel 脚本里抠出 LD_ 前缀的顶层函数声明。 */
function extractDashHelpers() {
  const html = readFileSync(join(ROOT, 'site', 'dashboard.html'), 'utf8');
  const m = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
  assert.ok(m, 'dashboard.html 里应能找到 text/babel 脚本');
  const src = m[1];

  // 抠出所有 function LD_xxx(...) { ... } —— 用花括号配平扫描，别用正则贪婪匹配
  const names = ['LD_currentTest', 'LD_subtestCounts', 'LD_bankOf', 'LD_bankTotal', 'LD_domainRows', 'LD_derive'];
  const chunks = [];
  for (const name of names) {
    const start = src.indexOf('function ' + name + '(');
    if (start === -1) throw new Error('未在 dashboard.html 找到 ' + name);
    let i = src.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) throw new Error(name + ' 花括号不配平');
    chunks.push(src.slice(start, end));
  }
  // 常量也要带上
  const constM = src.match(/var BANK_TOTAL_5001\s*=\s*\d+\s*;/);
  if (constM) chunks.unshift(constM[0]);
  return chunks.join('\n');
}

/** 在最小的假 window 里加载注册表 + 题库 + dashboard 派生函数。 */
function buildSandbox({ bank5001 = [], bank8006 = [], bank8006Full = null, activeTest = null } = {}) {
  const store = {};
  if (activeTest !== null) store['triumph_test_code'] = activeTest;

  const sandbox = {
    console,
    document: { getElementById: () => null, querySelector: () => null },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    __store: store,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  // 真实注册表
  vm.runInContext(readFileSync(join(ROOT, 'site', 'js', 'test-registry.js'), 'utf8'), sandbox, { filename: 'test-registry.js' });
  // 假题库（结构只需 subtest 字段，questionCounts 按它聚合）
  sandbox.DM_BANK_EXT = bank5001;
  sandbox.DM_BANK_8006 = bank8006;
  if (bank8006Full !== null) sandbox.DM_BANK_8006_FULL = bank8006Full;
  // dashboard 的派生函数（5001 的四子科 fallback 常量是页面顶层定义，这里补上）
  const helpers = extractDashHelpers();
  const fallback = `
const SUBTESTS_FALLBACK=[{code:"5002",name:"Reading & Language Arts",q:214},{code:"5003",name:"Mathematics",q:172},{code:"5004",name:"Social Studies",q:240},{code:"5005",name:"Science",q:343}],
GATE_NAMES_FALLBACK={5002:"Reading & Language Arts",5003:"Mathematics",5004:"Social Studies",5005:"Science"},
KNOWLEDGE={5002:[{k:"Reading"}],5003:[{k:"Numbers and Operations"}],5004:[{k:"United States History, Government, and Citizenship"}],5005:[{k:"Earth Science"}]},
LD_REG=window.LDTestRegistry;
`;
  vm.runInContext(fallback + helpers + '\nthis.__LD=LD_derive;this.__LDcurrent=LD_currentTest;', sandbox, { filename: 'dashboard-helpers.js' });
  return sandbox;
}

function countSubtest(bank, name) {
  return bank.filter((q) => q && q.subtest === name).length;
}

/**
 * 跨 vm realm 取数组时，Array.prototype 不同源 -> assert.deepEqual 会报
 * "same structure but are not reference-equal"。统一转成原生字符串再比。
 */
function codes(list) {
  return Array.prototype.join.call(list.map((x) => (typeof x === 'string' ? x : x.code)), ',');
}

test('dashboard: 5001 派生沿用四子科定义与历史题量口径', () => {
  const sb = buildSandbox({ activeTest: '5001', bank5001: [] });
  const d = sb.__LD('5001');
  assert.equal(d.IS_5001, true);
  assert.equal(d.SUBTESTS.length, 4);
  assert.equal(codes(d.SUBTESTS), '5002,5003,5004,5005');
  // 5001 题量按历史值展示，不因题库实算而漂移（对外文案已引用这些数）
  assert.equal(d.SUBTESTS.map((s) => s.q).join(','), '214,172,240,343');
  assert.equal(d.TOTAL, 969);
  assert.equal(d.ROWS, null);
  assert.ok(d.KNOWLEDGE, '5001 必须有 category 级知识地图数据');
  assert.equal(d.KNOWLEDGE['5002'][0].k, 'Reading');
});

test('dashboard: 8006 派生三个内容领域，题量从题库实算', () => {
  const bank = [
    { subtest: 'Foundational Literacy Skills' },
    { subtest: 'Foundational Literacy Skills' },
    { subtest: 'Fluency and Vocabulary' },
  ];
  const sb = buildSandbox({ activeTest: '8006', bank8006: bank });
  const d = sb.__LD('8006');
  assert.equal(d.IS_5001, false);
  assert.equal(d.SUBTESTS.length, 3);
  assert.equal(codes(d.SUBTESTS), 'FLS,FLV,CWE');
  assert.equal(d.SUBTESTS[0].q, 2, 'FLS 应实算为 2');
  assert.equal(d.SUBTESTS[1].q, 1, 'FLV 应实算为 1');
  assert.equal(d.SUBTESTS[2].q, 0, 'CWE 题库为空应为 0');
  assert.equal(d.TOTAL, 3);
  assert.equal(d.KNOWLEDGE, null, '8006 无 category，知识地图数据必须为 null');
  assert.ok(d.ROWS, '8006 应提供按领域聚合的 ROWS 兜底');
  assert.equal(d.ROWS.length, 3);
  assert.equal(codes(d.ROWS), 'FLS,FLV,CWE');
  assert.equal(d.ROWS.map((r) => r.k).join(' | '), [
    'Foundational Literacy Skills', 'Fluency and Vocabulary', 'Comprehension and Written Expression',
  ].join(' | '));
});

test('dashboard: 8006 题量优先取 FULL 练习题库，缺省时退回 mini test 题库', () => {
  // 8006 有两个题库全局变量：FULL（练习页，200 题）与 mini（mini test，30 题）。
  // 注册表登记 FULL 为准，dashboard 展示的应是用户实际刷得到的量。
  const full = [];
  for (let i = 0; i < 40; i++) full.push({ subtest: 'Foundational Literacy Skills' });
  for (let i = 0; i < 30; i++) full.push({ subtest: 'Fluency and Vocabulary' });
  for (let i = 0; i < 30; i++) full.push({ subtest: 'Comprehension and Written Expression' });
  const mini = [];
  for (let i = 0; i < 12; i++) mini.push({ subtest: 'Foundational Literacy Skills' });

  const sbFull = buildSandbox({ activeTest: '8006', bank8006: mini, bank8006Full: full });
  const dFull = sbFull.__LD('8006');
  assert.equal(dFull.TOTAL, 100, 'FULL 存在时应以 FULL 计（40+30+30）');
  assert.equal(dFull.SUBTESTS.map((s) => s.q).join(','), '40,30,30');

  // 只加载 mini 时（别名兜底）也不能显示 0
  const sbMini = buildSandbox({ activeTest: '8006', bank8006: mini });
  const dMini = sbMini.__LD('8006');
  assert.equal(dMini.TOTAL, 12, '缺 FULL 时应退回 mini 题库而不是归零');
});

test('dashboard: 切到 8006 时不会因为 KNOWLEDGE 为 null 而抛错（渲染层做了兜底）', () => {
  const sb = buildSandbox({ activeTest: '8006', bank8006: [{ subtest: 'Fluency and Vocabulary' }] });
  const d = sb.__LD('8006');
  const activeTab = d.SUBTESTS[0].code;
  // 复刻 dashboard 渲染层那一行：LD_KNOW_ROWS = LD_ROWS || ((KNOWLEDGE&&KNOWLEDGE[r])||[])
  const rows = d.ROWS || ((d.KNOWLEDGE && d.KNOWLEDGE[activeTab]) || []);
  assert.doesNotThrow(() => rows.map((r) => r.k));
  assert.equal(rows.length, 3);
});

test('dashboard: 非法/未知考试码回退到 5001 而不是崩溃', () => {
  const sb = buildSandbox({ activeTest: 'bogus' });
  assert.equal(sb.__LDcurrent(), '5001', 'localStorage 里的非法码应回退默认考试');
  const d = sb.__LD('bogus');
  assert.equal(d.IS_5001, true);
  assert.equal(d.SUBTESTS.length, 4);
});

test('dashboard: 题库实算与注册表领域名逐字对齐（防止改名后题量归零）', () => {
  const bank5001 = [];
  for (const name of ['Reading and Language Arts', 'Mathematics', 'Social Studies', 'Science']) {
    for (let i = 0; i < 5; i++) bank5001.push({ subtest: name });
  }
  const sb = buildSandbox({ activeTest: '5001', bank5001 });
  const reg = sb.window.LDTestRegistry;
  const counts = reg.questionCounts('5001', bank5001);
  // 注册表领域名必须在题库里全部命中，否则 counts 会漏
  for (const name of reg.domainNames('5001')) {
    assert.equal(counts[name], 5, '领域名与题库 subtest 不一致：' + name);
  }
});

test('dashboard: 未引入注册表时优雅降级为 5001 视图', () => {
  const store = {};
  const sandbox = {
    console,
    document: { getElementById: () => null, querySelector: () => null },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: () => {}, removeItem: () => {} },
    __store: store,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  sandbox.DM_BANK_EXT = [];
  sandbox.DM_BANK_8006 = [];
  const helpers = extractDashHelpers();
  const fallback = `
const SUBTESTS_FALLBACK=[{code:"5002",name:"Reading & Language Arts",q:214},{code:"5003",name:"Mathematics",q:172},{code:"5004",name:"Social Studies",q:240},{code:"5005",name:"Science",q:343}],
GATE_NAMES_FALLBACK={5002:"Reading & Language Arts",5003:"Mathematics",5004:"Social Studies",5005:"Science"},
KNOWLEDGE={5002:[{k:"Reading"}]},
LD_REG=window.LDTestRegistry;
`;
  vm.runInContext(fallback + helpers + '\nthis.__LD=LD_derive;this.__LDcurrent=LD_currentTest;', sandbox, { filename: 'dashboard-helpers-noauth.js' });
  assert.equal(sandbox.LD_REG, undefined, '本用例故意不加载注册表');
  const d = sandbox.__LD('8006');
  assert.equal(d.IS_5001, true, '无注册表时一律按 5001 视图兜底');
  assert.equal(d.SUBTESTS.length, 4);
  assert.equal(sandbox.__LDcurrent(), '5001');
});
