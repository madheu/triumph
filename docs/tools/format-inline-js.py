"""把 dashboard.html 里压成一行的内联 React 代码美化成可读的多行 JS。

只用于人读，不参与构建。用法：
  python tools/format-inline-js.py site/dashboard.html [line_no] [out.js]

原理：手写扫描器跟踪 引号 / 模板串 / 注释 / 括号深度，
在顶层分号、以及花括号边界处插入换行与缩进。
不追求 prettier 级别的正确性，只要能读懂结构。
"""
import io
import os
import sys


def beautify(src: str) -> str:
    out = []
    depth = 0
    q = None
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''

        # 行注释
        if q is None and c == '/' and nxt == '/':
            while i < n and src[i] != '\n':
                out.append(src[i])
                i += 1
            continue
        # 块注释
        if q is None and c == '/' and nxt == '*':
            while i < n and not (src[i] == '*' and i + 1 < n and src[i + 1] == '/'):
                out.append(src[i])
                i += 1
            out.append('*/')
            i += 2
            continue

        if q:
            out.append(c)
            if c == '\\':
                if i + 1 < n:
                    out.append(src[i + 1])
                    i += 2
                    continue
            elif c == q:
                q = None
            i += 1
            continue

        if c in ('"', "'", '`'):
            q = c
            out.append(c)
            i += 1
            continue

        if c in '([{':
            depth += 1
            out.append(c)
            i += 1
            continue

        if c in ')]}':
            depth -= 1
            out.append(c)
            i += 1
            continue

        if c == ';' and depth <= 0:
            out.append(';\n')
            i += 1
            continue

        out.append(c)
        i += 1

    txt = ''.join(out)

    # 第二遍：按花括号深度加缩进换行
    res = []
    d = 0
    q = None
    i = 0
    n = len(txt)
    while i < n:
        c = txt[i]
        if q:
            res.append(c)
            if c == '\\':
                if i + 1 < n:
                    res.append(txt[i + 1])
                    i += 2
                    continue
            elif c == q:
                q = None
            i += 1
            continue
        if c in ('"', "'", '`'):
            q = c
            res.append(c)
            i += 1
            continue
        if c == '{':
            d += 1
            res.append('{\n' + '  ' * d)
            i += 1
            continue
        if c == '}':
            d = max(0, d - 1)
            res.append('\n' + '  ' * d + '}')
            i += 1
            continue
        if c == ';':
            res.append(';\n' + '  ' * d)
            i += 1
            continue
        res.append(c)
        i += 1

    return ''.join(res)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else 'site/dashboard.html'
    line_no = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    out_path = sys.argv[3] if len(sys.argv) > 3 else None

    lines = io.open(path, encoding='utf-8').read().split('\n')
    if line_no:
        src = lines[line_no - 1]
    else:
        src = max(lines, key=len)
    # 去掉包裹的 script 标签
    a = src.find('>')
    b = src.rfind('</script>')
    if a >= 0 and b > a:
        src = src[a + 1:b]

    pretty = beautify(src)
    if out_path:
        io.open(out_path, 'w', encoding='utf-8').write(pretty)
        print('wrote', out_path, len(pretty), 'chars')
    else:
        sys.stdout.write(pretty)


if __name__ == '__main__':
    main()
