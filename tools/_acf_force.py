#!/usr/bin/env python3
"""Force a specific workshop build into CS2 DS's appworkshop_730.acf.

Usage:
  python3 _acf_force.py <acf路径> <workshop_id> <size> <timeupdated> <manifest>

Unlike _acf_set_explicit.py this also rewrites latest_manifest /
latest_timeupdated, otherwise Steam notices latest != installed and
re-downloads the old approved build on next launch.
"""
import sys
import re

if len(sys.argv) != 6:
    sys.exit(__doc__)

acf, WID, SIZE, TIMEUPD, MANIFEST = sys.argv[1:6]

NEW = {
    'size': SIZE,
    'timeupdated': TIMEUPD,
    'manifest': MANIFEST,
    'latest_timeupdated': TIMEUPD,
    'latest_manifest': MANIFEST,
}


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
    return dict(re.findall(r'"(size|timeupdated|manifest|latest_timeupdated|latest_manifest|timetouched)"\s*"([^"]+)"', b))


text = open(acf, encoding='utf-8', errors='surrogateescape').read()
bs = blocks(text, WID)
print('目标 acf 找到块数:', len(bs))
if not bs:
    sys.exit('目标 acf 无该条目')

changed = 0
for (a, b) in reversed(bs):
    body = text[a:b]
    nb = body
    for k, v in NEW.items():
        pat = r'("%s"\s*)"[^"]*"' % k
        if re.search(pat, nb):
            nb2 = re.sub(pat, r'\g<1>"%s"' % v, nb)
            if nb2 != nb:
                changed += 1
            nb = nb2
    text = text[:a] + nb + text[b:]

bak = acf + '.bak-force'
open(bak, 'w', encoding='utf-8', errors='surrogateescape').write(open(acf, encoding='utf-8', errors='surrogateescape').read())
open(acf, 'w', encoding='utf-8', errors='surrogateescape').write(text)
print('备份:', bak)
print('已写回', acf, '字段变更数:', changed)

t2 = open(acf, encoding='utf-8', errors='surrogateescape').read()
for (a, b) in blocks(t2, WID):
    print('校验块:', fields(t2[a:b]))
