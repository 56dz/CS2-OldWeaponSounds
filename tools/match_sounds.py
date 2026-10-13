#!/usr/bin/env python3
"""比对 CS:GO 的 .wav 与 CS2 的 .vsnd_c，找出 CS2 客户端里仍存在的 CS:GO 旧音效。
用法: match_sounds.py <csgo_list.txt> <cs2_list.txt>
两个列表文件由 vpk.py list 生成（格式: "<size>  <path>"）
"""
import re
import sys

PAT = re.compile(r'^\s*(\d+)\s+(\S.*?)\s*$')


def load(path):
    out = {}
    for line in open(path, encoding='utf-8', errors='replace'):
        m = PAT.match(line)
        if not m:
            continue
        size, p = int(m.group(1)), m.group(2)
        out[p] = size
    return out


def norm_csgo(p):
    # sound/weapons/ak47/ak47-1.wav -> weapons/ak47/ak47-1
    if not p.startswith('sound/') or not p.endswith('.wav'):
        return None
    return p[len('sound/'):-len('.wav')]


def norm_cs2(p):
    # sounds/weapons/ak47/ak47-1.vsnd_c -> weapons/ak47/ak47-1
    if not p.startswith('sounds/') or not p.endswith('.vsnd_c'):
        return None
    return p[len('sounds/'):-len('.vsnd_c')]


csgo = load(sys.argv[1])
cs2 = load(sys.argv[2])

csgo_map = {}
for p, s in csgo.items():
    k = norm_csgo(p)
    if k:
        csgo_map[k] = (p, s)

cs2_map = {}
for p, s in cs2.items():
    k = norm_cs2(p)
    if k:
        cs2_map[k] = (p, s)

matched = sorted(set(csgo_map) & set(cs2_map))
print('CS:GO 武器音频总数      : %d' % len(csgo_map))
print('CS2  武器音频总数      : %d' % len(cs2_map))
print('两者同名（=CS2 仍保留）  : %d' % len(matched))
print()

# 只关心开火相关（排除 inspect/UI 等噪音）
fire_keys = [k for k in matched if re.search(r'(single|-1$|_0[1-9]$|distant)', k)]
print('=== 疑似"开火类"旧音效（CS2 客户端已存在）: %d 个 ===' % len(fire_keys))
for k in fire_keys:
    print('  %-52s CS:GO %8d B   CS2 %8d B' % (k, csgo_map[k][1], cs2_map[k][1]))
print()

print('=== 前 40 个匹配项（全部类型）===')
for k in matched[:40]:
    print('  %-52s CS:GO %8d B   CS2 %8d B' % (k, csgo_map[k][1], cs2_map[k][1]))
