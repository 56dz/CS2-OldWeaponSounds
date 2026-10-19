#!/usr/bin/env python3
# 把新版 manifest/size/timeupdated 写进 CS2 DS 的 appworkshop_730.acf
import sys, re

acf = '/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop/appworkshop_730.acf'
srcacf = '/home/zhz/Steam/steamapps/workshop/appworkshop_730.acf'
WID = '3819498100'

def blocks(text, wid):
    """返回该 id 所有块 (start, end) —— 用 "\t\t\"<wid>\"\n\t\t{" 精确定位"""
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

s = open(srcacf, encoding='utf-8', errors='surrogateescape').read()
t = open(acf, encoding='utf-8', errors='surrogateescape').read()

sb = blocks(s, WID)
print('源 acf 找到块数:', len(sb))
if not sb:
    sys.exit('源 acf 无该条目')
new = fields(s[sb[0][0]:sb[0][1]])
print('新字段:', new)

tb = blocks(t, WID)
print('目标 acf 找到块数:', len(tb))
if not tb:
    sys.exit('目标 acf 无该条目')

# 从后往前替换，避免偏移失效
for (a, b) in reversed(tb):
    body = t[a:b]
    nb = body
    for k, v in new.items():
        nb = re.sub(r'("%s"\s*)"[^"]*"' % k, r'\g<1>"%s"' % v, nb)
    t = t[:a] + nb + t[b:]

open(acf, 'w', encoding='utf-8', errors='surrogateescape').write(t)
print('已写回', acf)

# 校验
t2 = open(acf, encoding='utf-8', errors='surrogateescape').read()
for (a, b) in blocks(t2, WID):
    print('校验块:', fields(t2[a:b]))
