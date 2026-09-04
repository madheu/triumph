"""把主题层注入站点所有 html 页面。

两行代码，位置各有讲究：

  theme.js   —— 必须同步、尽量靠前。它在浏览器绘制第一帧之前就把
                data-theme 打到 <html> 上，晚了就会闪一下白。
                不能加 defer / async，那等于没做。
  theme.css  —— 必须排在页面自己的内联 <style> 之前。
                外链样式表里的 [data-theme="dark"] .foo 特异性 (0,2,0)
                高于内联的 .foo (0,1,0)，靠这个盖住页面的浅色硬编码。
                放反了就会被页面样式盖回去。

脚本可重复执行：已经注入过的页面会跳过。

用法：
  python tools/inject-theme.py            # 预览会改哪些文件
  python tools/inject-theme.py --write    # 真正写入
"""
import io
import os
import re
import glob
import sys

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site')

# 用绝对路径：站点部署在域名根目录，子目录下的页面（如 /admin/events.html）
# 用相对路径会解析错。
JS_TAG = '<script src="/js/theme.js?v=1"></script>'
CSS_TAG = '<link rel="stylesheet" href="/css/theme.css?v=1">'


def inject(html):
    """返回 (新 html, 改动说明)。没变化时返回 (None, 原因)。"""
    if 'theme.js' in html:
        return None, 'already injected'

    m = re.search(r'<head[^>]*>', html, re.I)
    if not m:
        return None, 'no <head>'
    head_end = html.lower().find('</head>')
    if head_end < 0:
        return None, 'no </head>'

    # 1) theme.js 紧跟在 <meta charset> 之后；没有 charset 就紧跟 <head>
    cm = re.search(r'<meta\s+charset=["\']?[^>"\']*["\']?\s*/?>', html, re.I)
    js_at = cm.end() if cm and cm.end() < head_end else m.end()

    # 2) theme.css 放在第一个内联 <style> 之前；没有内联样式就放 </head> 前
    sm = re.search(r'<style', html, re.I)
    css_at = sm.start() if (sm and js_at < sm.start() < head_end) else head_end

    if css_at < js_at:
        return None, 'selector order conflict'

    # 从后往前插入，前面的下标才不会失效
    out = html[:css_at] + CSS_TAG + '\n  ' + html[css_at:]
    out = out[:js_at] + '\n  ' + JS_TAG + out[js_at:]
    return out, 'injected'


def main():
    write = '--write' in sys.argv
    changed, skipped = [], []
    for f in sorted(glob.glob(os.path.join(SITE, '**', '*.html'), recursive=True)):
        html = io.open(f, encoding='utf-8').read()
        new, why = inject(html)
        rel = os.path.relpath(f, SITE).replace('\\', '/')
        if new is None:
            skipped.append((rel, why))
            continue
        changed.append(rel)
        if write:
            io.open(f, 'w', encoding='utf-8', newline='').write(new)

    print('注入 %d 个页面%s' % (len(changed), '' if write else '（预览，未写入）'))
    for r in changed:
        print('   +', r)
    if skipped:
        print('\n跳过 %d 个：' % len(skipped))
        for r, why in skipped:
            print('   - %-46s %s' % (r, why))
    if not write and changed:
        print('\n确认无误后加 --write 写入。')


if __name__ == '__main__':
    main()
