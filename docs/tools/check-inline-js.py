"""检查 html 里内联 <script> 的语法。

dashboard / practice 这些页面把整个应用压在一行 <script type="text/babel"> 里，
改错了不会有任何构建期报错，只有用户打开页面时才白屏。
所以用 node --check 把内联脚本逐个过一遍。

用法：
  python tools/check-inline-js.py [文件...]      # 默认扫 site/ 下所有 html
"""
import io
import os
import re
import sys
import glob
import subprocess
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
NODE = os.path.join(ROOT, 'node_modules', '.bin', 'node')


def find_node():
    for c in ['node', 'node.exe']:
        from shutil import which
        p = which(c)
        if p:
            return p
    return None


def main():
    args = sys.argv[1:]
    files = args if args else sorted(glob.glob(os.path.join(ROOT, 'site', '**', '*.html'), recursive=True))
    node = find_node()
    if not node:
        print('找不到 node，跳过')
        return 1

    bad = 0
    checked = 0
    for f in files:
        s = io.open(f, encoding='utf-8').read()
        for i, m in enumerate(re.finditer(r'<script(?![^>]*\bsrc=)(?![^>]*application/ld\+json)([^>]*)>(.*?)</script>', s, re.S)):
            attrs, code = m.group(1), m.group(2)
            if 'application/ld+json' in attrs or 'text/template' in attrs:
                continue
            if not code.strip():
                continue
            checked += 1
            tmp = os.path.join(tempfile.gettempdir(), 'inline_check_%d.js' % i)
            io.open(tmp, 'w', encoding='utf-8').write(code)
            r = subprocess.run([node, '--check', tmp], capture_output=True, text=True)
            if r.returncode != 0:
                bad += 1
                rel = os.path.relpath(f, ROOT).replace('\\', '/')
                print('FAIL %s (script #%d)' % (rel, i))
                print('   ' + (r.stderr or '').strip().replace('\n', '\n   ')[:600])
            os.unlink(tmp)

    print('\n检查 %d 段内联脚本，失败 %d 段' % (checked, bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
