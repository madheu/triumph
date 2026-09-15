/**
 * tools/test-quiz-8000-series.mjs — 8002/8003/8004/8005 mini test 端到端回归测试（P0）
 *
 * 为什么需要它：
 *   tools/test-quiz-8006.mjs 只覆盖了 8006 一科。Week 2 新增的四个引擎
 *   （quiz-8002/8003/8004/8005.js）在 8006 的测试之外，等于**没有端到端覆盖**。
 *   2026-09-15 的实证：site/js/quiz-8005.js 第 282 行读 `q.stem`，而它绑定的
 *   `DM_BANK_8005` 用的是 `q` 字段 —— 点击 Start 后题干渲染成 undefined。
 *   引擎语法正确、单元测试全绿、校验器 exit=0，但没有一条断言走过"用户点击"的路径。
 *
 * 做法（不复制实现，直接跑真文件）：
 *   用最小假 DOM/window 承载真实的 quiz-800X.js（IIFE），加载真实题库，
 *   驱动真实点击链路：Start → 逐题作答 → 结果页。
 *
 * 四科运行时字段并不统一，测试按科各自声明（这是事实，不是设计）：
 *   8002 / 8005 : 运行时视图，字段 q / options / answer / subtest
 *   8003 / 8004 : 直接是 schema v1，字段 stem / choices / correct_answer / content_domain
 *   两套都要被真实路径验证，所以 SUBJECTS 里逐科声明字段名。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** 逐科声明：文件、题库全局名、以及三套字段口径。 */
const SUBJECTS = [
  {
    code: '8002',
    bankGlobal: 'DM_BANK_8002',
    stem: 'q',
    options: 'options',
    answer: 'answer',
    multiAnswer: 'answers',
    domain: 'subtest',
  },
  {
    code: '8003',
    bankGlobal: 'DM_BANK_8003',
    stem: 'stem',
    options: 'choices',
    answer: 'correct_answer',
    multiAnswer: null,
    domain: 'content_domain',
  },
  {
    code: '8004',
    bankGlobal: 'DM_BANK_8004',
    stem: 'stem',
    options: 'choices',
    answer: 'correct_answer',
    multiAnswer: null,
    domain: 'content_domain',
  },
  {
    code: '8005',
    bankGlobal: 'DM_BANK_8005',
    stem: 'q',
    options: 'options',
    answer: 'answer',
    multiAnswer: 'answers',
    domain: 'subtest',
  },
];

const REGISTRY_SRC = readFileSync(join(ROOT, 'site', 'js', 'test-registry.js'), 'utf8');

// ---------------------------------------------------------------- 假 DOM

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
    this.value = '';
    this.type = '';
    this.id = '';
  }
  focus() {}
  blur() {}
  remove() {
    if (this.parentNode && this.parentNode.children) {
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
    }
  }
  get classList() {
    const self = this;
    const list = () => String(self.className || '').split(/\s+/).filter(Boolean);
    const write = (arr) => {
      self.className = arr.join(' ');
    };
    return {
      add(...cs) {
        const a = list();
        for (const c of cs) if (!a.includes(c)) a.push(c);
        write(a);
      },
      remove(...cs) {
        write(list().filter((c) => !cs.includes(c)));
      },
      contains(c) {
        return list().includes(c);
      },
      toggle(c) {
        const a = list();
        const i = a.indexOf(c);
        if (i >= 0) a.splice(i, 1);
        else a.push(c);
        write(a);
        return i < 0;
      },
    };
  }
  get textContent() {
    if (this._text) return this._text;
    // 真实 DOM：设过 innerHTML 之后，textContent 返回的是剥掉标签的纯文本。
    // quiz-8005.js 的 para() 正是走 innerHTML 渲染题干的，不实现这条语义会让
    // 题干看起来"是空的"，从而把一次真实的渲染故障和测试脚手架缺陷混在一起。
    if (this._html) {
      return String(this._html)
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
    }
    return this.children.map((c) => (c && c.textContent) || '').join('');
  }
  set textContent(v) {
    this._text = v === null || v === undefined ? '' : String(v);
    this.children = [];
  }
  get innerHTML() {
    if (this._html) return this._html;
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
  removeChild(n) {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    return n;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener() {}
  setAttribute(k, v) {
    this._attrs = this._attrs || {};
    this._attrs[k] = String(v);
  }
  getAttribute(k) {
    return this._attrs && this._attrs[k] !== undefined ? this._attrs[k] : null;
  }
  hasAttribute(k) {
    return !!(this._attrs && this._attrs[k] !== undefined);
  }
  click() {
    const ls = this.listeners.click || [];
    for (const fn of ls) fn({ preventDefault() {}, target: this });
  }
  scrollIntoView() {}
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

/** 在假环境里跑真实的 quiz-800X.js。 */
function boot(sub) {
  const errors = [];
  const root = new FakeEl('div');
  root.id = 'mini-test';

  const store = {};
  const noop = () => {};
  const trackStub = {
    track: noop,
    identify: noop,
    newAttempt: () => ({ id: 'test-attempt' }),
    observeOnce: noop,
    flushNow: noop,
    init: noop,
    page: noop,
  };

  const sandbox = {
    console: {
      log: noop,
      warn: noop,
      error: (...a) => errors.push(a.map(String).join(' ')),
    },
    document: {
      getElementById: (id) => (id === 'mini-test' ? root : null),
      createElement: (tag) => new FakeEl(tag),
      createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
      addEventListener: noop,
      querySelectorAll: () => [],
      querySelector: () => null,
      body: new FakeEl('body'),
      documentElement: new FakeEl('html'),
    },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    location: { href: 'https://learndiag.com/', origin: 'https://learndiag.com', pathname: '/', search: '', hash: '' },
    navigator: { userAgent: 'node-test' },
    fetch: () => Promise.reject(new Error('network disabled in test')),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    addEventListener: noop,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(readFileSync(join(ROOT, 'site', 'questions-' + sub.code + '.js'), 'utf8'), sandbox, {
    filename: 'questions-' + sub.code + '.js',
  });
  sandbox.LDTrack = trackStub;
  vm.runInContext(readFileSync(join(ROOT, 'site', 'js', 'quiz-' + sub.code + '.js'), 'utf8'), sandbox, {
    filename: 'quiz-' + sub.code + '.js',
  });

  return { root, errors, sandbox };
}

/** 真实题库（独立 vm，拿纯数据）。 */
function realBank(sub) {
  const sb = {};
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(readFileSync(join(ROOT, 'site', 'questions-' + sub.code + '.js'), 'utf8'), sb, {
    filename: 'questions-' + sub.code + '.js',
  });
  return sb[sub.bankGlobal];
}

function findButton(root, cls, textIncludes) {
  return (
    root
      .querySelectorAll('button')
      .find(
        (b) =>
          (!cls || String(b.className || '').includes(cls)) &&
          (!textIncludes || String(b.textContent || '').includes(textIncludes)),
      ) || null
  );
}

/**
 * 当前题干：root 里那个文本**命中题库**的 <p>。
 *
 * 为什么必须命中题库，而不是"第一个非空 <p>"：
 *   引擎会在题干之前渲染自己的标签（如 "Multiple-select · choose TWO options"），
 *   按位置取第一个 <p> 会抓到标签，于是 need 算错、重复检测失真。
 *   锚定题库之后，若引擎渲染了题库里没有的题干，这里返回 null，断言直接失败 ——
 *   检测力不降反升。
 */
function currentStem(root, bankTexts) {
  const ps = root.all().filter((e) => e.tagName === 'P' && e.textContent.trim());
  return ps.find((p) => bankTexts.has(p.textContent)) || null;
}

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

/** 走完一场 mini test，返回沿途观测。 */
function playThrough(root, sub, bank) {
  const guardMax = 200;
  const start = findButton(root, 'btn-primary', 'Start the mini test');
  assert.ok(start, 'intro 应有 "Start the mini test" 按钮');
  start.click();

  const seen = [];
  const trace = [];
  const bankTexts = new Set(bank.map((q) => String(q[sub.stem])));
  let guard = 0;
  let reachedResult = false;

  /** 当前题需要选几个选项：直接问题库，别猜题面措辞。 */
  function needFor(stemText) {
    const q = bank.find((x) => String(x[sub.stem]) === stemText);
    if (!q) return 1;
    if (Array.isArray(q[sub.answer])) return q[sub.answer].length;
    if (sub.multiAnswer && Array.isArray(q[sub.multiAnswer])) return q[sub.multiAnswer].length;
    return 1;
  }

  // 循环条件是「题库还有没答的题」，不是「页面还有没有 .opt 按钮」——
  // 结果页本身也含 .opt 样式的元素（题目回顾），按按钮数判断会把结果页当题目重刷。
  while (guard++ < guardMax && seen.length < bank.length) {
    const optBtns = root.querySelectorAll('button.opt');
    const inputs = root.all().filter((e) => e.tagName === 'INPUT');

    const stem = currentStem(root, bankTexts);
    assert.ok(
      stem,
      '第 ' + (seen.length + 1) + ' 题必须渲染出命中题库的题干。' +
        '当前按钮=' +
        JSON.stringify(root.querySelectorAll('button').map((b) => String(b.textContent).slice(0, 18))) +
        ' 当前文本=' +
        JSON.stringify(String(root.textContent).slice(0, 160)),
    );
    seen.push(stem.textContent);

    if (optBtns.length > 0) {
      const need = Math.min(needFor(stem.textContent), optBtns.length);
      for (let i = 0; i < need; i++) optBtns[i].click();
      trace.push({ pos: seen.length, kind: 'choice', n: optBtns.length, need });
    } else {
      assert.ok(inputs.length > 0, '第 ' + seen.length + ' 题既无选项也无输入框');
      // numeric-entry：填一个合法数字并提交，只为验证链路能走通。
      inputs[0].value = '1';
      trace.push({ pos: seen.length, kind: 'numeric' });
    }

    // 第一段：判分按钮（Check）或直接前进（单选点完即判分）
    const step1 =
      findButton(root, '', 'See my results') ||
      findButton(root, '', 'Next question') ||
      findButton(root, '', 'Check');
    assert.ok(step1, '作答后应出现判分/前进按钮（第 ' + seen.length + ' 题）');
    step1.click();

    // 第二段：只有走到 "Check" 这一步（多选 / numeric-entry）才需要再点一次前进。
    // 单选场景 step1 本身就是 "Next question →"，这里不会再点到东西 ——
    // 而最后一题若是 numeric，第二段就是通往结果页的唯一路径，不能省。
    if (/Check/.test(String(step1.textContent))) {
      const step2 =
        findButton(root, '', 'See my results') || findButton(root, '', 'Next question');
      assert.ok(step2, '判分后应出现前进/结果按钮（第 ' + seen.length + ' 题）');
      step2.click();
    }
  }

  if (/\d+%/.test(visibleText(root))) reachedResult = true;

  return { seen, reachedResult, trace };
}

// ---------------------------------------------------------------- 用例

for (const sub of SUBJECTS) {
  const C = sub.code;

  test(`[${C}] boot：intro 渲染出开始按钮，启动无 console.error`, () => {
    const { root, errors } = boot(sub);
    assert.equal(errors.length, 0, '启动阶段不应有 console.error：' + errors.join(' | '));
    assert.ok(findButton(root, 'btn-primary', 'Start the mini test'), 'intro 应有开始按钮');
  });

  test(`[${C}] P0 回归：点击 Start 后必须渲染真实题干，不能是空白框`, () => {
    const { root, errors } = boot(sub);
    const start = findButton(root, 'btn-primary', 'Start the mini test');
    start.click();

    assert.equal(errors.length, 0, '点击后不应有 console.error：' + errors.join(' | '));
    const after = root.textContent;
    assert.ok(after.length > 0, '点击后不能是空白框');
    assert.ok(/1\s*\/\s*\d+/.test(after), '应显示进度 "1 / N"：' + JSON.stringify(after.slice(0, 80)));

    const bank = realBank(sub);
    const texts = bank.map((q) => q[sub.stem]);
    const bankTexts = new Set(texts.map(String));

    const stem = currentStem(root, bankTexts);
    assert.ok(
      stem,
      '应渲染出题干 <p>，且其文本必须命中题库 —— 命不中说明引擎读的字段与题库不符（' +
        C +
        ' 的题库用 ' +
        sub.stem +
        '）。当前 root 里的 <p>：' +
        JSON.stringify(
          root
            .all()
            .filter((e) => e.tagName === 'P' && e.textContent.trim())
            .map((e) => String(e.textContent).slice(0, 50)),
        ),
    );
    const text = stem.textContent;
    assert.ok(
      text && !/^undefined$/.test(text.trim()),
      '题干不能是 undefined',
    );

    assert.ok(
      texts.includes(text),
      '题干必须来自真实题库，实际：' + JSON.stringify(text.slice(0, 80)),
    );

    const opts = root.querySelectorAll('button.opt');
    assert.ok(opts.length >= 2, '应渲染出至少 2 个选项按钮，实际 ' + opts.length);
    const bankOpts = bank.map((q) => q[sub.options]);
    // 部分引擎把选项字母（A/B/C…）和选项文本拼在同一个按钮里，断言两种形态都接受，
    // 但必须**有一项**能与题库逐字对上 —— 否则就退化成"按钮里随便有字"了。
    const raw = opts[0].textContent;
    const stripped = String(raw).replace(/^[A-E][\s.)]*/, '');
    assert.ok(
      bankOpts.some(
        (list) => list && list.some((o) => String(o) === raw || String(o) === stripped),
      ),
      '选项文本必须来自真实题库，实际：' + JSON.stringify(String(raw).slice(0, 60)),
    );
  });

  test(`[${C}] 完整作答：走完全部题目、题干无重复、到达结果页`, () => {
    const { root, errors } = boot(sub);
    const bank = realBank(sub);
    const bankTexts = bank.map((q) => q[sub.stem]);
    assert.equal(bankTexts.length, 30, C + ' 题库应为 30 题');

    const { seen, reachedResult, trace } = playThrough(root, sub, bank);
    if (seen.length !== 30) {
      console.log('DBG ' + C + ' trace=' + JSON.stringify(trace.slice(0, 6)));
      console.log('DBG ' + C + ' seen(前6)=' + JSON.stringify(seen.slice(0, 6).map((s) => String(s).slice(0, 30))));
    }

    assert.equal(errors.length, 0, '全程不应有 console.error：' + errors.join(' | '));
    assert.equal(seen.length, 30, '应恰好走完 30 题，实际 ' + seen.length);
    assert.equal(
      new Set(seen).size,
      30,
      '题干不应重复出现，实际唯一 ' + new Set(seen).size + ' 个。seen=' +
        JSON.stringify(seen.map((t) => String(t).slice(0, 45))),
    );
    for (const t of bankTexts) {
      assert.ok(seen.includes(t), '题库中这道题的题干未被渲染：' + JSON.stringify(String(t).slice(0, 60)));
    }
    assert.ok(reachedResult, '应到达结果页并显示百分比');
  });

  test(`[${C}] 结果页：给出百分比与分领域，且绝不出现通过率预测`, () => {
    const { root, errors } = boot(sub);
    playThrough(root, sub, realBank(sub));

    const txt = visibleText(root);
    assert.equal(errors.length, 0, '结果页不应有 console.error：' + errors.join(' | '));
    assert.match(txt, /\d+%/, '结果页应显示百分比');
    assert.ok(
      /categor|domain/i.test(txt),
      '结果页应按内容领域分列，实际片段：' + JSON.stringify(txt.slice(0, 120)),
    );
    assert.ok(
      !/pass probability|probability of passing|chance of passing|odds of passing|likely to pass/i.test(
        txt,
      ),
      C + ' 结果页不得出现任何通过率预测',
    );
    const ssHits = [...txt.matchAll(/.{0,90}scaled score.{0,60}/gi)].map((m) => m[0]);
    for (const ctx of ssHits) {
      assert.ok(
        /\b(not|no|never|without|isn't|is not|publishes no)\b/i.test(ctx),
        C + ' 出现 "scaled score" 必须是否定式免责语境，实际：' + JSON.stringify(ctx),
      );
    }
    assert.ok(
      !/scaled score[^A-Za-z0-9]{0,8}\d{2,3}/i.test(txt),
      C + ' 结果页不得给出 scaled score 的具体数值',
    );
  });

  test(`[${C}] 契约：注册表 domains 与题库 ${sub.domain} 逐字一致`, () => {
    const bank = realBank(sub);
    const bankDomains = [...new Set(bank.map((q) => q[sub.domain]))].sort();
    assert.ok(
      bankDomains.every((d) => typeof d === 'string' && d.length > 0),
      C + ' 题库的 ' + sub.domain + ' 字段必须每个题目都存在（否则领域统计会全部落空）',
    );

    const sb = {};
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(REGISTRY_SRC, sb, { filename: 'test-registry.js' });
    const entry = sb.LDTestRegistry.get(C);
    assert.ok(entry, C + ' 必须已在 test-registry.js 注册');
    const regDomains = entry.domains.map((d) => d.name).sort();

    assert.equal(
      bankDomains.join(' | '),
      regDomains.join(' | '),
      C + ' 题库 ' + sub.domain + ' 与注册表 domains 必须逐字一致',
    );
  });
}

test('跨科一致性：五科引擎的题干引用字段必须与其题库字段匹配', () => {
  // 源码级断言，让「引擎读错字段」这类改动在 diff 阶段就能被拦下。
  const mismatches = [];
  for (const sub of SUBJECTS) {
    const src = readFileSync(join(ROOT, 'site', 'js', 'quiz-' + sub.code + '.js'), 'utf8');
    const bank = realBank(sub);
    const hasStem = Object.prototype.hasOwnProperty.call(bank[0], 'stem');
    const hasQ = Object.prototype.hasOwnProperty.call(bank[0], 'q');
    // 引擎里读 q.stem 但题库没有 stem 字段 → 题干会渲染成 undefined
    const readsStem = /\.stem\b/.test(src);
    const readsQ = /\bq\.q\b|\bq\.q\s*\+/.test(src);
    if (readsStem && !hasStem) mismatches.push(sub.code + ' 读 .stem 但题库无 stem 字段');
    if (readsQ && !hasQ) mismatches.push(sub.code + ' 读 q.q 但题库无 q 字段');
  }
  assert.deepEqual(mismatches, [], '存在引擎/题库字段错配：' + mismatches.join('; '));
});
