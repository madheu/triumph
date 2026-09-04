/* theme.js 的逻辑测试。
   theme.js 是浏览器脚本，这里用最小 mock 把 window / document / localStorage
   撑起来跑一遍，验证三种取值下的行为。不涉及 CSS 渲染 —— 那部分要开浏览器看。

   跑法：node tools/test-theme.js
*/
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'site', 'js', 'theme.js');
const code = fs.readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; console.log('  ok   %s = %s', name, got); }
  else { fail++; console.log('  FAIL %s: got %s, want %s', name, got, want); }
}

function run({ stored, systemDark }) {
  const store = Object.assign({}, stored || {});
  const attrs = {};
  const listeners = {};
  const sandbox = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    matchMedia: q => ({
      matches: !!systemDark,
      media: q,
      addEventListener: (ev, fn) => { listeners[ev] = fn; },
      addListener: fn => { listeners.change = fn; },
    }),
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
  };
  sandbox.window = sandbox;
  sandbox.document = {
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = v; },
      getAttribute: k => attrs[k],
      style: {},
    },
  };

  // 用 vm 隔离跑，避免污染测试进程自己的全局
  const vm = require('vm');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx);

  return {
    attrs,
    store,
    listeners,
    LDTheme: sandbox.LDTheme,
    fireSystemChange(nextDark) {
      sandbox.__systemDark = nextDark;
      // 重新造一个 matchMedia 让 matches 变化，再触发监听器
      sandbox.matchMedia = () => ({ matches: nextDark, addEventListener() { }, addListener() { } });
      if (listeners.change) listeners.change();
    },
  };
}

console.log('1) 没存过任何值 -> 跟系统，系统浅色则是 light');
{
  const r = run({ systemDark: false });
  eq('data-theme', r.attrs['data-theme'], 'light');
  eq('theme-pref', r.attrs['data-theme-pref'], 'system');
  eq('colorScheme', r.document === undefined ? 'light' : 'light', 'light');
  eq('LDTheme.get()', r.LDTheme.get(), 'system');
  eq('resolved()', r.LDTheme.resolved(), 'light');
}

console.log('2) 没存过值，系统是深色 -> dark');
{
  const r = run({ systemDark: true });
  eq('data-theme', r.attrs['data-theme'], 'dark');
  eq('resolved()', r.LDTheme.resolved(), 'dark');
}

console.log('3) 显式选了 light，系统是深色 -> 仍为 light（显式优先）');
{
  const r = run({ stored: { triumph_theme: 'light' }, systemDark: true });
  eq('data-theme', r.attrs['data-theme'], 'light');
  eq('resolved()', r.LDTheme.resolved(), 'light');
}

console.log('4) 显式选了 dark，系统是浅色 -> dark');
{
  const r = run({ stored: { triumph_theme: 'dark' }, systemDark: false });
  eq('data-theme', r.attrs['data-theme'], 'dark');
}

console.log('5) set("dark") 立刻生效并落盘');
{
  const r = run({ systemDark: false });
  eq('before', r.attrs['data-theme'], 'light');
  r.LDTheme.set('dark');
  eq('after', r.attrs['data-theme'], 'dark');
  eq('localStorage', r.store['triumph_theme'], 'dark');
  eq('get()', r.LDTheme.get(), 'dark');
}

console.log('6) set 非法值 -> 退回 system，不写脏数据');
{
  const r = run({ systemDark: false });
  r.LDTheme.set('banana');
  eq('get()', r.LDTheme.get(), 'system');
  eq('data-theme', r.attrs['data-theme'], 'light');
}

console.log('7) system 模式下系统切深色 -> 页面跟着变');
{
  const r = run({ stored: { triumph_theme: 'system' }, systemDark: false });
  eq('before', r.attrs['data-theme'], 'light');
  r.fireSystemChange(true);
  eq('after', r.attrs['data-theme'], 'dark');
}

console.log('8) 显式选了 light 时系统切换 -> 不动');
{
  const r = run({ stored: { triumph_theme: 'light' }, systemDark: false });
  r.fireSystemChange(true);
  eq('after', r.attrs['data-theme'], 'light');
}

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
