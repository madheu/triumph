/**
 * tools/test-quiz-8006.mjs — 8006 文章页内嵌 mini test 的端到端回归测试（P0）
 *
 * 为什么单独测：
 *   site/js/quiz-8006.js 是文章页 mini test 的引擎，构建期不校验语义。
 *   2026-09-13 的 P0：buildOrder() 往 order 里塞的是**题目对象**，而
 *   renderQuestion() 用 `x.id === order[pos]` 拿 id 比对象 → 恒 undefined
 *   → q.subtest 抛 TypeError → 点击「Start the mini test」得到空白框。
 *   node --check 只验语法，这类错误它发现不了（当年的测试也没覆盖）。
 *
 * 做法（不复制粘贴实现，直接跑真文件）：
 *   用最小的假 DOM/window 承载真实的 site/js/quiz-8006.js（IIFE），
 *   加载真实题库，模拟真实点击路径：Start → 逐题作答 → 结果页。
 *   这样断言的是**用户实际会走的路径**，而不是某个函数的返回值。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const QUIZ_SRC = readFileSync(join(ROOT, 'site', 'js', 'quiz-8006.js'), 'utf8');
const BANK_SRC = readFileSync(join(ROOT, 'site', 'questions-8006.js'), 'utf8');
const REGISTRY_SRC = readFileSync(join(ROOT, 'site', 'js', 'test-registry.js'), 'utf8');

/** 真实题库（在独立 vm 里加载，拿纯数据回来）。 */
function realBank() {
  const sb = {};
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(BANK_SRC, sb, { filename: 'questions-8006.js' });
  return sb.DM_BANK_8006;
}

// ---------------------------------------------------------------- 假 DOM

const VOID_STYLE = { cssText: '' };

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.style = { cssText: '' };
    this.disabled = false;
    this._text = '';
    this._html = '';
  }
  // textContent 聚合子树；设值时清空子树（与真实 DOM 语义一致）
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => (c && c.textContent) || '').join('');
  }
  set textContent(v) {
    this._text = v === null || v === undefined ? '' : String(v);
    this.children = [];
  }
  get innerHTML() {
    if (this._html) return this._html;
    // 真实 DOM：设了 textContent 再读 innerHTML 得到 HTML 转义后的文本。
    // esc() 正是靠这个语义工作的，不实现会让结果页断言失真。
    if (this._text) {
      return String(this._text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    return '';
  }
  set innerHTML(v) {
    this._html = v === null || v === undefined ? '' : String(v);
    this.children = [];
    this._text = '';
  }
  get firstChild() {
    return this.children[0] || null;
  }
  appendChild(n) {
    if (n === null || n === undefined) return n;
    n.parentNode = this;
    this.children.push(n);
    return n;
  }
  insertBefore(n, ref) {
    n.parentNode = this;
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.unshift(n);
    else this.children.splice(i, 0, n);
    return n;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  setAttribute(k, v) {
    this._attrs = this._attrs || {};
    this._attrs[k] = String(v);
  }
  getAttribute(k) {
    return (this._attrs && this._attrs[k] !== undefined) ? this._attrs[k] : null;
  }
  click() {
    const ls = this.listeners.click || [];
    for (const fn of ls) fn({ preventDefault() {}, target: this });
  }
  scrollIntoView() {}
  /** 自写遍历：本项目只用到 'tag' 与 'tag.class' 两种选择器。 */
  querySelectorAll(sel) {
    const parts = String(sel).split('.');
    const tag = parts[0];
    const cls = parts[1];
    const out = [];
    const walk = (n) => {
      for (const c of n.children || []) {
        if (!c || !c.tagName) continue;
        const tagOk = tag === '*' || c.tagName === tag.toUpperCase();
        const clsOk = !cls || String(c.className || '').split(/\s+/).includes(cls);
        if (tagOk && clsOk) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  /** 所有后代元素（含各层），供测试定位无 class 的节点。 */
  all() {
    const out = [];
    const walk = (n) => {
      for (const c of n.children || []) {
        if (!c || !c.tagName) continue;
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

/**
 * 在假环境里跑真实的 quiz-8006.js。
 * 返回 { root, errors, walk() } —— walk() 会驱动完整作答流程。
 */
function boot() {
  const errors = [];
  const root = new FakeEl('div');
  root.id = 'mini-test';

  const store = {};
  const sandbox = {
    console: {
      log: () => {},
      warn: () => {},
      // 真实实现里 renderQuestion 的兜底分支会走这里；测试要能发现它
      error: (...a) => errors.push(a.map(String).join(' ')),
    },
    document: {
      getElementById: (id) => (id === 'mini-test' ? root : null),
      createElement: (tag) => new FakeEl(tag),
      createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
      addEventListener: () => {},
    },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    fetch: () => Promise.reject(new Error('network disabled in test')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    __store: store,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(BANK_SRC, sandbox, { filename: 'questions-8006.js' });
  vm.runInContext(QUIZ_SRC, sandbox, { filename: 'quiz-8006.js' });

  return { root, errors, sandbox };
}

/** 找 root 下某个 class 的按钮（可选再按文本过滤）。 */
function findButton(root, cls, textIncludes) {
  return (
    root.querySelectorAll('button').find(
      (b) =>
        (!cls || String(b.className || '').includes(cls)) &&
        (!textIncludes || String(b.textContent || '').includes(textIncludes)),
    ) || null
  );
}

/** 当前渲染出的题干（renderQuestion 里那个无 class 的 <p>）。 */
function currentStem(root) {
  return root.all().find((e) => e.tagName === 'P' && e.textContent.trim()) || null;
}

/**
 * 页面上「看得见」的文字。
 * 真实 DOM 里 textContent 与 innerHTML 最终都变成可见文本；假 DOM 把两者分开
 * 存，所以断言文案时必须都收进来（结果页的百分比是写在 innerHTML 里的）。
 */
function visibleText(root) {
  const parts = [];
  const walk = (n) => {
    if (!n) return;
    if (n._text) parts.push(String(n._text));
    if (n._html) parts.push(String(n._html).replace(/<[^>]*>/g, ' '));
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return parts.join(' ');
}

// ---------------------------------------------------------------- 用例

test('boot: intro 渲染出开始按钮（引擎能跑起来）', () => {
  const { root, errors } = boot();
  assert.equal(errors.length, 0, '启动阶段不应有 console.error');
  const btn = findButton(root, 'btn-primary', 'Start the mini test');
  assert.ok(btn, 'intro 应渲染 "Start the mini test" 按钮');
});

test('P0 回归：点击 Start 后必须渲染出题目，不能是空白框', () => {
  const { root, errors } = boot();
  const before = root.textContent.length;
  assert.ok(before > 0, '点击前 intro 应有内容');

  const start = findButton(root, 'btn-primary', 'Start the mini test');
  start.click(); // 修复前这里抛 TypeError: Cannot read properties of undefined (reading 'subtest')

  assert.equal(errors.length, 0, '点击后不应有 console.error（兜底分支未被触发）');
  const after = root.textContent;
  assert.ok(after.length > 0, '点击后必须是空白框以外的东西');
  assert.ok(/1\s*\/\s*\d+/.test(after), '应显示进度 "1 / N"，实际：' + JSON.stringify(after.slice(0, 80)));

  const stem = currentStem(root);
  assert.ok(stem, '应渲染出题干 <p>');
  const bank = realBank();
  const texts = bank.map((q) => q.q);
  assert.ok(texts.includes(stem.textContent), '题干必须来自真实题库，实际：' + JSON.stringify(stem.textContent.slice(0, 80)));

  // 选项按钮必须存在且数量合理
  const opts = root.querySelectorAll('button.opt');
  assert.ok(opts.length >= 2, '应渲染出至少 2 个选项按钮，实际 ' + opts.length);
});

test('完整作答 30 题：无重复、无遗漏、走完到结果页', () => {
  const { root, errors } = boot();
  const bank = realBank();
  const bankTexts = bank.map((q) => q.q);
  assert.equal(bankTexts.length, 30, '题库应为 30 题');

  findButton(root, 'btn-primary', 'Start the mini test').click();

  const seen = new Set();
  let guard = 0;
  let reachedResult = false;

  while (guard++ < 200) {
    // 结果页：出现百分比大数字，且没有 opt 按钮
    const opts = root.querySelectorAll('button.opt');
    if (opts.length === 0) {
      if (/\d+%/.test(visibleText(root))) { reachedResult = true; }
      break;
    }

    const stem = currentStem(root);
    assert.ok(stem, '每一题都应渲染题干');
    assert.ok(!seen.has(stem.textContent), '题干不应重复出现：' + JSON.stringify(stem.textContent.slice(0, 60)));
    seen.add(stem.textContent);

    opts[0].click(); // 选第一个选项 → 触发判分与解释

    const next = findButton(root, '', 'See my results') || findButton(root, '', 'Next question');
    assert.ok(next, '作答后应出现前进按钮');
    next.click();
  }

  assert.equal(errors.length, 0, '全程不应有 console.error');
  assert.equal(seen.size, 30, '应恰好走完 30 题，实际 ' + seen.size);
  for (const t of bankTexts) {
    assert.ok(seen.has(t), '题库中这道题的题干未被渲染：' + JSON.stringify(t.slice(0, 60)));
  }
  assert.ok(reachedResult, '应到达结果页并显示百分比');
});

test('结果页：给出百分比与分领域，且绝不出现 scaled score / pass probability', () => {
  const { root, errors } = boot();
  findButton(root, 'btn-primary', 'Start the mini test').click();

  let guard = 0;
  while (guard++ < 200) {
    const opts = root.querySelectorAll('button.opt');
    if (opts.length === 0) break;
    opts[0].click();
    const next = findButton(root, '', 'See my results') || findButton(root, '', 'Next question');
    next.click();
  }

  const txt = visibleText(root);
  assert.equal(errors.length, 0, '结果页不应有 console.error');
  assert.match(txt, /\d+%/, '结果页应显示百分比');
  assert.match(txt, /By content category/i, '结果页应按内容领域分列');
  assert.ok(
    /weakest category|close across categories|Review your misses/i.test(txt),
    '结果页应给出最弱领域或并列说明，实际片段：' + JSON.stringify(txt.slice(0, 120)),
  );
  // 红线：8006 无 ETS 官方换算表，不得输出 scaled score / 通过率预测。
  // 注意否定式免责（"…not a predicted scaled score"）是合规的，别误伤 —— 见下方语境检查。
  assert.ok(
    !/pass probability|probability of passing|chance of passing|odds of passing|likely to pass/i.test(txt),
    '结果页不得出现任何通过率预测',
  );
  const ssHits = [...txt.matchAll(/.{0,90}scaled score.{0,60}/gi)].map((m) => m[0]);
  for (const ctx of ssHits) {
    assert.ok(
      /\b(not|no|never|without|isn't|is not)\b/i.test(ctx),
      '出现 "scaled score" 必须是否定式免责语境，实际：' + JSON.stringify(ctx),
    );
  }
  assert.ok(
    !/scaled score[^A-Za-z0-9]{0,8}\d{2,3}/i.test(txt),
    '结果页不得给出 scaled score 的具体数值',
  );
});

test('契约：DOMAINS 与注册表、题库 subtest 三方逐字一致', () => {
  const bank = realBank();
  const bankDomains = [...new Set(bank.map((q) => q.subtest))].sort();

  const sb = {};
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(REGISTRY_SRC, sb, { filename: 'test-registry.js' });
  // 注册表里的领域顺序就是 intro 文案里 12/9/9 的顺序，别排序后再拿去比
  const regOrdered = sb.LDTestRegistry.get('8006').domains.map((d) => d.name);
  const regDomains = regOrdered.slice().sort();

  assert.equal(
    bankDomains.join(' | '),
    regDomains.join(' | '),
    '题库 subtest 与注册表 domains 必须逐字一致',
  );

  // intro 里硬编码的题量口径也必须与题库实数相符，否则对外文案会说谎
  const counts = {};
  bank.forEach((q) => { counts[q.subtest] = (counts[q.subtest] || 0) + 1; });
  const introSrc = QUIZ_SRC;
  assert.ok(
    introSrc.includes(bank.length + ' questions'),
    'intro 应写 "30 questions"，与题库实数 ' + bank.length + ' 一致',
  );
  const ratio = regOrdered.map((d) => counts[d]).join('/');
  assert.ok(
    introSrc.includes(ratio + ' by category'),
    'intro 的分类题量应为 "' + ratio + ' by category"',
  );
});

test('防回归：order 必须是 id 列表（源码级断言）', () => {
  // 行为测试已覆盖真实路径；这条纯粹为了让「把对象塞进 order」这类
  // 改动在 diff 阶段就能被拦下，而不必等到浏览器里白屏。
  const m = QUIZ_SRC.match(/function buildOrder\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(m, '应能定位 buildOrder()');
  const body = m[1];
  assert.ok(/\.id\b/.test(body), 'buildOrder() 必须把题目映射为 id（order 声明的语义是 ids）');
  assert.ok(/return q\.id|=>\s*q\.id/.test(body), 'buildOrder() 应显式取 q.id');
});
