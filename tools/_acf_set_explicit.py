#!/usr/bin/env python3
"""把显式给定的 size/timeupdated/manifest 写进 CS2 DS 的 appworkshop_730.acf

用法:
  python3 _acf_set_explicit.py <acf路径> <workshop_id> <size> <timeupdated> <manifest>
"""
import sys
import re

if len(sys.argv) != 6:
    sys.exit(__doc__)

acf, WID, SIZE, TIMEUPD, MANIFEST = sys.argv[1:6]


def blocks(text, wid):
    out = []
    pat = re.compile(r'^\t\t"' + re.escape(wid) + r'"\s*$', re.M)
    for m in pat.finditer(text):
        i = text.find('{', m.end())
        if i < 0:
            continue
        depth = 0
        j = i
        while j < len(text):
            if text[j] == '{':
                depth += 1
            elif text[j] == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out.append((m.start(), j + 1))
    return out


def fields(b):
    return dict(re.findall(r'"(size|timeupdated|manifest)"\s*"([^"]+)"', b))


new = {'size': SIZE, 'timeupdated': TIMEUPD, 'manifest': MANIFEST}

t = open(acf, encoding='utf-8', errors='surrogateescape').read()
tb = blocks(t, WID)
print('目标 acf 找到块数:', len(tb))
if not tb:
    sys.exit('目标 acf 无该条目')

for (a, b) in reversed(tb):
    body = t[a:b]
    nb = body
    for k, v in new.items():
        nb = re.sub(r'("%s"\s*)"[^"]*"' % k, r'\g<1>"%s"' % v, nb)
    t = t[:a] + nb + t[b:]

open(acf, 'w', encoding='utf-8', errors='surrogateescape').write(t)
print('已写回', acf)

t2 = open(acf, encoding='utf-8', errors='surrogateescape').read()
for (a, b) in blocks(t2, WID):
    print('校验块:', fields(t2[a:b]))
