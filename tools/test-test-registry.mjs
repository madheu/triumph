// tools/test-test-registry.mjs — D14 考试注册表与切换器回归测试
//
// 跑法：node tools/test-test-registry.mjs
//
// 为什么要有这个文件：测试领域定义与题库是否对得上。设施页（study-planner /
// srs / mistake-log）的按领域统计完全依赖「注册表里的领域名 == 题库 subtest」。
// 这两边一旦漂移，页面不会报错，只会静默显示全 0 —— 正是最难发现的那类故障。
//
// 覆盖：
//   1. 注册表结构完整（两门考试都有 code/label/domains/bankGlobal）
//   2. 领域名与题库 subtest 取值逐字一致（关键契约）
//   3. 8006 没有「可算通过率」的资格（hasScaledScore 必须为 false）
//   4. questionCounts 统计正确
//   5. 切换器只列出有题库的考试

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; failures.push(name); console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// 加载注册表（它是纯 IIFE，给个 window 即可）
const registrySrc = readFileSync(join(ROOT, 'site', 'js', 'test-registry.js'), 'utf8');
global.window = {};
(0, eval)(registrySrc);
const R = global.window.LDTestRegistry;

// 加载题库：questions.js / questions-8006.js 是 JS 对象字面量，用 eval 取
function loadBank(file) {
  const src = readFileSync(join(ROOT, 'site', file), 'utf8');
  const m = src.match(/\[\s*\{[\s\S]*\}\s*\]\s*;?\s*$/m) || src.match(/\[\s*\{[\s\S]*\}\s*\]/);
  return eval(m[0]);
}
const BANK_5001 = loadBank('questions.js');
const BANK_8006 = loadBank('questions-8006.js');
// 8006 磁盘上另有一个 FULL 练习题库（200 题）。注册表的 bankGlobal 指向它，
// 它的子集关系与领域覆盖也必须成立，否则设施页按 bankGlobal 取题会与 mini test 不一致。
const BANK_8006_FULL = loadBank('questions-8006-full.js');

console.log('== 1. 注册表结构 ==');
t('注册表已导出', !!R);
t('有两门考试', R.codes().length === 2, R.codes());
t('DEFAULT_CODE 是 5001', R.DEFAULT_CODE === '5001');
R.codes().forEach(code => {
  const x = R.get(code);
  t(code + ' 有 label', typeof x.label === 'string' && x.label.length > 0);
  t(code + ' 有 shortLabel', typeof x.shortLabel === 'string' && x.shortLabel.length > 0);
  t(code + ' 有 bankGlobal', typeof x.bankGlobal === 'string' && x.bankGlobal.length > 0);
  t(code + ' domains 非空', Array.isArray(x.domains) && x.domains.length > 0);
});

console.log('== 2. 领域名与题库 subtest 逐字一致（关键契约）==');
{
  const s5001 = new Set(BANK_5001.map(q => q.subtest));
  const s8006 = new Set(BANK_8006.map(q => q.subtest));

  R.domainNames('5001').forEach(n => {
    t('5001 领域「' + n + '」在题库中存在', s5001.has(n), [...s5001]);
  });
  R.domainNames('8006').forEach(n => {
    t('8006 领域「' + n + '」在题库中存在', s8006.has(n), [...s8006]);
  });
  // 反向：题库里的领域必须都在注册表中，否则统计会漏题
  s5001.forEach(n => t('题库 5001 的「' + n + '」已登记', R.domainNames('5001').includes(n)));
  s8006.forEach(n => t('题库 8006 的「' + n + '」已登记', R.domainNames('8006').includes(n)));
}

console.log('== 3. 通过率资格（红线）==');
t('5001 可算通过率（有官方换算依据）', R.get('5001').hasScaledScore === true);
t('8006 不可算通过率（ETS 无换算表）', R.get('8006').hasScaledScore === false);

console.log('== 3b. bankGlobal 指向真实存在的题库（防漂移）==');
{
  // 8006 有两个题库全局变量。注册表必须指向练习页实际用的那个（FULL），
  // 否则仪表盘的「题库题量」会显示 mini test 的 30 而不是用户能刷到的 200。
  t('8006 bankGlobal 指向 FULL 练习题库', R.get('8006').bankGlobal === 'DM_BANK_8006_FULL', R.get('8006').bankGlobal);
  t('8006 提供别名兜底', Array.isArray(R.get('8006').bankGlobalAliases) && R.get('8006').bankGlobalAliases.includes('DM_BANK_8006'));
  // 别名必须真的对应磁盘上的另一个题库，不能是编的名字
  t('别名 DM_BANK_8006 在磁盘上存在', BANK_8006.length > 0, BANK_8006.length);
  t('FULL 题库非空', BANK_8006_FULL.length > 0, BANK_8006_FULL.length);
  // 两个 8006 题库的领域覆盖必须一致，否则切换题库会静默丢题
  const dMini = new Set(BANK_8006.map(q => q.subtest));
  const dFull = new Set(BANK_8006_FULL.map(q => q.subtest));
  const miniOnly = [...dMini].filter(n => !dFull.has(n));
  t('mini test 的领域在 FULL 里全覆盖', miniOnly.length === 0, miniOnly);
}

console.log('== 4. questionCounts 统计 ==');
{
  const c5001 = R.questionCounts('5001', BANK_5001);
  const total5001 = Object.values(c5001).reduce((a, b) => a + b, 0);
  t('5001 统计总数等于题库题数', total5001 === BANK_5001.length, { total5001, bank: BANK_5001.length });
  t('5001 四领域各自非零', Object.values(c5001).every(v => v > 0), c5001);

  const c8006 = R.questionCounts('8006', BANK_8006);
  const total8006 = Object.values(c8006).reduce((a, b) => a + b, 0);
  t('8006 统计总数等于题库题数', total8006 === BANK_8006.length, { total8006, bank: BANK_8006.length });
  t('8006 三领域各自非零', Object.values(c8006).every(v => v > 0), c8006);
  t('空题库不炸', Object.values(R.questionCounts('8006', null)).every(v => v === 0));
  t('未知考试返回空', JSON.stringify(R.questionCounts('9999', BANK_5001)) === '{}');
}

console.log('== 5. 切换器数据源 ==');
{
  const sw = R.switchable();
  t('列出考试的 code', sw.every(x => R.exists(x.code)));
  t('都带 label', sw.every(x => typeof x.label === 'string' && x.label.length > 0));
  t('只列有题库的', sw.length === R.codes().filter(c => R.get(c).hasBank).length);
}

console.log('== 6. 工具函数 ==');
{
  t('domainCode 反查正确', R.domainCode('8006', 'Fluency and Vocabulary') === 'FLV');
  t('domainCode 未知返回 null', R.domainCode('8006', 'Nope') === null);
  t('domain 取到 weight', R.domain('8006', 'Foundational Literacy Skills').weight === 3);
  t('domain 未知返回 null', R.domain('8006', 'Nope') === null);
  t('未知考试 domainNames 回退 5001', JSON.stringify(R.domainNames('9999')) === JSON.stringify(R.domainNames('5001')));
}

console.log('');
console.log('结果: PASS=' + pass + ' FAIL=' + fail);
if (failures.length) console.log('失败项: ' + failures.join(' | '));
process.exit(fail ? 1 : 0);
