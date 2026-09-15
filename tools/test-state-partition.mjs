// tools/test-state-partition.mjs — D14 state 分区回归测试
//
// 跑法：node tools/test-state-partition.mjs
//
// 为什么要有这个文件：D14 把 state 从「扁平单考试」改成「tests{} 按考试分区」，
// 这是动全站用户数据格式的改动。任何后续调整 mergeStates / normalizeState 的人，
// 都必须先保证这里全绿，尤其是「两门考试互不覆盖」和「旧数据升级不丢」两组。
//
// 覆盖的契约：
//   1. 旧扁平结构升级到 v2 且不丢字段
//   2. normalizeState 幂等
//   3. 垃圾输入不抛异常
//   4. 5001 与 8006 互不覆盖（D14 的核心目标）
//   5. 同一考试内「富者胜」
//   6. 旧 5001 数据 + 新 8006 写入的真实场景
//   7. getTestState 的取值与兜底

import { mergeStates, normalizeState, getTestState, DEFAULT_TEST } from '../worker-src/accounts.mjs';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; failures.push(name); console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

console.log('== 1. 旧扁平结构升级 ==');
const legacy = {
  createdAt: 1000,
  answers: [{ id: 1 }, { id: 2 }],
  mastery: { '5002': 0.5 },
  plan: { week: 1 },
  srs: { a: 1 },
  tasks: {},
  prefs: { theme: 'light' },
};
const n = normalizeState(legacy);
t('有 v:2', n.v === 2);
t('有 tests.5001', !!n.tests['5001']);
t('answers 迁移正确', n.tests['5001'].answers.length === 2);
t('mastery 迁移正确', n.tests['5001'].mastery['5002'] === 0.5);
t('plan 迁移正确', n.tests['5001'].plan && n.tests['5001'].plan.week === 1);
t('srs 迁移正确', n.tests['5001'].srs.a === 1);
t('prefs 提到顶层', n.prefs.theme === 'light');
t('顶层不再残留 answers', n.answers === undefined);
t('顶层不再残留 mastery', n.mastery === undefined);
t('createdAt 保留', n.createdAt === 1000);
t('DEFAULT_TEST 是 5001', DEFAULT_TEST === '5001');

console.log('== 2. 幂等 ==');
const n2 = normalizeState(n);
t('二次 normalize 结构相同', JSON.stringify(n2) === JSON.stringify(n));

console.log('== 3. null/垃圾输入不抛 ==');
t('null 不炸', !!normalizeState(null));
t('undefined 不炸', !!normalizeState(undefined));
t('数组不炸', !!normalizeState([1, 2, 3]));
t('字符串不炸', !!normalizeState('x'));
t('null+null 合并不炸', !!mergeStates(null, null));
t('数组+对象 合并不炸', !!mergeStates([1], { answers: [1] }));

console.log('== 4. 两门考试互不覆盖（D14 核心目标）==');
const s5001 = { tests: { '5001': { answers: [1, 2, 3, 4, 5], mastery: { a: 1 } } } };
const s8006 = { tests: { '8006': { answers: [9], mastery: { b: 2 } } } };
const m = mergeStates(s5001, s8006);
t('5001 保住', m.tests['5001'].answers.length === 5, m.tests['5001']);
t('8006 保住', m.tests['8006'].answers.length === 1, m.tests['8006']);
t('两门都在', !!m.tests['5001'] && !!m.tests['8006']);
// 反例：改造前的行为——8006 的 1 条 answer 会输给 5001 的 5 条，然后被覆盖
t('8006 未被 5001 的数量优势吃掉', m.tests['8006'].answers.length !== 0);

console.log('== 5. 同一考试内富者胜 ==');
const poor = { tests: { '5001': { answers: [1] } } };
const rich = { tests: { '5001': { answers: [1, 2, 3, 4] } } };
t('富者胜', mergeStates(poor, rich).tests['5001'].answers.length === 4);
t('顺序无关', mergeStates(rich, poor).tests['5001'].answers.length === 4);

console.log('== 6. 旧 5001 + 新 8006 混合（真实迁移场景）==');
const oldUser = { createdAt: 500, answers: [{ id: 'q1' }], mastery: {}, plan: null, srs: {}, tasks: {} };
const newWrite = { tests: { '8006': { answers: [{ id: 'x1' }] } } };
const mix = mergeStates(oldUser, newWrite);
t('旧 5001 被正确迁移并保留', mix.tests['5001'].answers.length === 1, mix.tests);
t('新 8006 写入成功', mix.tests['8006'].answers.length === 1);
t('createdAt 取较早（账号首次出现时间）', mix.createdAt === 500, mix.createdAt);

console.log('== 7. getTestState ==');
t('取 8006', getTestState(mix, '8006').answers.length === 1);
t('取不存在的不炸且返回合法桶', Array.isArray(getTestState(mix, '9999').answers));
t('默认取 5001', getTestState(mix).answers.length === 1);
t('空 state 兜底', Array.isArray(getTestState(null, '8006').answers));

console.log('');
console.log('结果: PASS=' + pass + ' FAIL=' + fail);
if (failures.length) console.log('失败项: ' + failures.join(' | '));
process.exit(fail ? 1 : 0);
