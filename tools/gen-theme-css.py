"""生成 site/css/theme.css —— 全站 dark 主题层。

为什么是"生成"而不是手写：
站点 46 个页面各有内联 <style>，里面除了 CSS 变量还有约 90 处硬编码色值。
手工逐页改风险太高，改一处碰坏一片。这里换一条路：

  共享 CSS 里写 [data-theme="dark"] .foo 的特异性是 (0,2,0)，
  页面内联的 .foo 是 (0,1,0)。属性选择器 + 类 > 纯类，
  所以外链样式表能盖住内联 <style>，一个页面的内联 CSS 都不用动。

脚本做的事：
  1. 扫描所有页面的内联 CSS
  2. 找出非 :root 规则里的硬编码色值
  3. 按 (色值, 属性) 查下面这张人工核定过的映射表
  4. 输出 [data-theme="dark"] <选择器> { <属性>: <暗色值> }

映射表是人工定的，不是按亮度自动猜的 —— 自动猜会把品牌粉当成错误红、
把 PRO 徽章的粉底当成报错底色。这张表出过错，改表重跑即可，不要去改页面 CSS。

用法：
  python tools/gen-theme-css.py
"""
import io
import os
import re
import glob
import collections

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site')

# ---------------------------------------------------------------------------
# 暗色映射表：(小写 hex, 属性) -> 暗色值
# 语义分组，改之前先看懂这一组在原页面里是什么东西。
# ---------------------------------------------------------------------------
MAP = {
    # --- 中性表面：近白卡片底 / 页面底 ---
    ('#fff', 'background'): 'var(--surface)',
    # 白字只出现在 .btn-primary / .btn-danger 这类实底按钮上。
    # 这两个底在暗色下都会变亮（accent-deep / wrong），白字就糊了，
    # 所以换成深色字，而不是留白。
    ('#fff', 'color'): 'var(--on-accent)',
    ('#faf9f7', 'background'): 'var(--bg)',
    ('#fdfcfa', 'background'): 'var(--surface)',
    ('#fbfaf7', 'background'): 'var(--surface)',
    ('#f7f3f0', 'background'): 'var(--surface)',
    ('#e8e3d8', 'background'): 'var(--bg-soft)',
    ('#eee', 'background'): 'var(--bg-soft)',

    # --- 分隔线 / 边框 ---
    ('#edeae6', 'border'): 'var(--line)',
    ('#edeae6', 'border-top'): 'var(--line)',
    ('#e5e0db', 'border'): 'var(--line)',
    ('#d8d1c5', 'border-top'): 'var(--line)',
    ('#f5f2ef', 'border-bottom'): 'var(--line)',
    ('#f0ebe7', 'border'): 'var(--line)',

    # --- 文字 ---
    ('#3c3733', 'color'): 'var(--ink)',
    ('#332e2b', 'color'): 'var(--ink)',
    ('#6e6760', 'color'): 'var(--ink-soft)',
    ('#777', 'color'): 'var(--ink-soft)',
    ('#ede7dc', 'color'): 'var(--ink)',        # pre 里配深底的浅字，暗色下并入正文色

    # --- 反色块：浅色下是深底，暗色下反过来要更亮，否则 hover 看不出来 ---
    ('#3c3733', 'background'): 'var(--bg-soft)',   # pre 代码块底
    ('#2b2724', 'background'): 'var(--surface-2)',  # .diag-next:hover

    # --- 正确 / 绿色系 ---
    ('#3e6b3a', 'color'): 'var(--correct)',
    ('#5a7d5a', 'color'): 'var(--correct)',
    ('#6f9d7a', 'border-color'): 'var(--correct-line)',
    ('#eff7ee', 'background'): 'var(--correct-soft)',
    ('#e9f0ea', 'background'): 'var(--correct-soft)',
    ('#eff2ea', 'background'): 'var(--correct-soft)',
    ('#d8ead6', 'border'): 'var(--correct-line)',

    # --- 错误 / 红色系 ---
    ('#b33a3a', 'color'): 'var(--wrong)',
    ('#c9806f', 'border-color'): 'var(--wrong-line)',
    ('#fdebeb', 'background'): 'var(--wrong-soft)',
    ('#f6eae8', 'background'): 'var(--wrong-soft)',
    ('#f5e7e3', 'background'): 'var(--wrong-soft)',

    # --- 品牌粉 / accent 系。注意 #e5d5d2 是 PRO 徽章的粉底，不是报错底 ---
    ('#a67d7a', 'color'): 'var(--accent)',
    ('#956b68', 'background'): 'var(--accent-deep)',   # .btn-primary:hover
    ('#8f6a67', 'background'): 'var(--accent-deep)',   # .btn-easy:hover
    ('#f2ebe8', 'background'): 'var(--accent-soft)',
    ('#e5d5d2', 'background'): 'var(--accent-soft)',   # PRO 徽章底
    ('#e5d5d2', 'border'): 'var(--accent-line)',
    ('#8a5f5c', 'color'): 'var(--accent-deep)',        # PRO 徽章字

    # --- 提示 / 黄色系 ---
    ('#fbf3df', 'background'): 'var(--warn-soft)',
    ('#96742b', 'color'): 'var(--warn)',
}

# 只处理这些属性，其余（box-shadow 里的 rgba、渐变等）保持原样
HANDLED_PROPS = set(p for _, p in MAP)


def qualify(sel):
    """给选择器组的每一项都加上 [data-theme="dark"] 前缀。

    不能只在整串前面加一次：`.a p,.a li` 会被拼成
    `[data-theme="dark"] .a p,.a li`，后半段丢了前缀，
    结果 li 在浅色模式下也被强行上色。逗号分组必须逐项处理。
    """
    parts = [p.strip() for p in sel.split(',') if p.strip()]
    return ','.join('[data-theme="dark"] ' + p for p in parts)


def split_decls(body):
    """把声明块切成 (属性, 值) 列表。分号在 url() 或引号里时不能切。"""
    out = []
    depth = 0
    q = None
    cur = []
    for ch in body:
        if q:
            cur.append(ch)
            if ch == q:
                q = None
            continue
        if ch in ('"', "'"):
            q = ch
            cur.append(ch)
            continue
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth = max(0, depth - 1)
        if ch == ';' and depth == 0:
            out.append(''.join(cur))
            cur = []
            continue
        cur.append(ch)
    if cur:
        out.append(''.join(cur))
    decls = []
    for d in out:
        if ':' not in d:
            continue
        p, _, v = d.partition(':')
        decls.append((p.strip(), v.strip()))
    return decls


def collect():
    """返回 {选择器: {属性: 暗色值}}，已按选择器聚合。"""
    rules = collections.OrderedDict()
    unmapped = collections.Counter()

    for f in sorted(glob.glob(os.path.join(SITE, '*.html'))):
        s = io.open(f, encoding='utf-8').read()
        css = ''.join(re.findall(r'<style[^>]*>(.*?)</style>', s, re.S))
        # 去掉注释，避免注释里的样例色值被当成真规则
        css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
        for mm in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
            sel = ' '.join(mm.group(1).split())
            if not sel or ':root' in sel:
                continue
            for prop, val in split_decls(mm.group(2)):
                if prop not in HANDLED_PROPS:
                    continue
                for h in re.findall(r'#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b', val):
                    key = ('#' + h.lower(), prop)
                    dark = MAP.get(key)
                    if not dark:
                        unmapped[key] += 1
                        continue
                    # 反色块的处理要看同一条声明里有没有别的意图，
                    # 这里按属性聚合，同选择器同属性以先到为准
                    rules.setdefault(sel, collections.OrderedDict())
                    if prop not in rules[sel]:
                        rules[sel][prop] = dark

    return rules, unmapped


HEADER = """/* theme.css — 全站主题层。自动生成，请勿手改；改映射表后重跑
 *   python tools/gen-theme-css.py
 *
 * 加载位置很关键：必须是 <head> 里页面内联 <style> 之前的外链样式表。
 *   · 这里的 :root 兜底值会被页面自己的 :root 定义盖住（同特异性，后者赢）
 *   · 这里的 [data-theme="dark"] 规则特异性更高，反过来盖住页面的浅色值
 * 两头都占住，所以 46 个页面的内联 CSS 一行都不用改。
 */

/* 兜底变量：account / reset / support / upgrade / tools 这 5 个页面
   没定义 --bg 一类的色板变量，body 背景是硬编码的。这里补上，
   它们的 dark 覆盖才能生效。有定义的页面会用它们自己的值。 */
:root{
  --bg:#F2EFE9;--bg-soft:#E8E3D8;--surface:#FFFCF8;--surface-2:#EDE9E3;
  --ink:#3C3733;--ink-soft:#6E6760;--line:#D8D1C5;
  --accent:#C09D9B;--accent-deep:#A67D7A;--accent-soft:#F2EBE8;--accent-line:#E5D5D2;
  --correct:#3E6B3A;--correct-soft:#EFF7EE;--correct-line:#C3DCC0;
  --wrong:#B33A3A;--wrong-soft:#FDEBEB;--wrong-line:#E8B4B4;
  --warn:#96742B;--warn-soft:#FBF3DF;
  --on-accent:#FFFFFF;
  --shadow:0 1px 2px rgba(60,55,51,.06),0 8px 24px rgba(60,55,51,.06);
}

/* 暗色色板。整体保持暖调，不跟到纯黑 —— 站点是米纸质感的品牌，
   冷黑会把这个调性打散。表面分层靠明度差，不靠边框。 */
[data-theme="dark"]{
  --bg:#1B1917;--bg-soft:#242120;--surface:#282422;--surface-2:#332E2B;
  --ink:#EDE7E0;--ink-soft:#A69D94;--line:#3B3531;
  --accent:#CBA9A6;--accent-deep:#E2C6C2;--accent-soft:#3A2C2A;--accent-line:#5A403D;
  --correct:#8FB489;--correct-soft:#233020;--correct-line:#3F5A3D;
  --wrong:#E58B84;--wrong-soft:#3B2422;--wrong-line:#6B3A37;
  --warn:#DDBB67;--warn-soft:#36301C;
  --on-accent:#221F1D;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);
}

/* 图片和插画在暗色下压一点亮度，否则会像贴上去的亮片 */
[data-theme="dark"] img:not([src*=".svg"]){filter:brightness(.88)}

/* 原生控件跟随：日期选择器、下拉、滚动条 */
[data-theme="dark"] input,[data-theme="dark"] select,[data-theme="dark"] textarea{
  background:var(--surface);color:var(--ink);border-color:var(--line);
}
[data-theme="dark"] ::placeholder{color:var(--ink-soft)}

/* ---- 以下为扫描 46 个页面内联 CSS 生成的硬编码覆盖 ---- */
"""

FOOTER = """
/* 兜底：任何页面只要 body 没吃到变量，这里强制落地 */
[data-theme="dark"] body{background:var(--bg);color:var(--ink)}
"""


def main():
    rules, unmapped = collect()
    out = [HEADER]
    for sel, decls in rules.items():
        body = ';'.join('%s:%s' % (p, v) for p, v in decls.items())
        out.append('%s{%s}\n' % (qualify(sel), body))
    out.append(FOOTER)

    path = os.path.join(SITE, 'css', 'theme.css')
    io.open(path, 'w', encoding='utf-8').write(''.join(out))

    print('wrote %s' % path)
    print('rules: %d' % len(rules))
    if unmapped:
        print('\n!! 未映射（需要补进 MAP 表）：')
        for (h, p), n in unmapped.most_common():
            print('   %-9s %-14s x%d' % (h, p, n))
    else:
        print('所有硬编码色值都已映射。')


if __name__ == '__main__':
    main()
