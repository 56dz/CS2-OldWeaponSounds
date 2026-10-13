#!/usr/bin/env python3
"""从 CS:GO 音效脚本生成"旧枪声 → CS2 是否已存在"映射表。
用法: build_map.py <csgo_game_sounds_weapons.txt> <cs2_weapons_list.txt> [输出json]
"""
import json
import re
import sys

script_path = sys.argv[1]
cs2_list_path = sys.argv[2]
out_path = sys.argv[3] if len(sys.argv) > 3 else None

# ---- 读取 CS2 已有的音频（sounds/weapons/xxx.vsnd_c -> 尺寸）----
PAT = re.compile(r'^\s*(\d+)\s+(\S.*?)\s*$')
cs2 = {}
for line in open(cs2_list_path, encoding='utf-8', errors='replace'):
    m = PAT.match(line)
    if not m:
        continue
    p = m.group(2)
    if p.startswith('sounds/') and p.endswith('.vsnd_c'):
        cs2[p[len('sounds/'):-len('.vsnd_c')]] = int(m.group(1))


def clean_wave(v):
    """去掉 CS:GO 脚本里 wave 值前面的怪前缀（如 ") ~) `)），返回 weapons/... 形式"""
    v = v.strip()
    i = v.find('sound/')
    if i >= 0:
        v = v[i + len('sound/'):]
    else:
        i = v.find('weapons/')
        if i >= 0:
            v = v[i:]
    v = v.split(';')[0].strip()
    if v.endswith('.wav'):
        v = v[:-4]
    return v


text = open(script_path, encoding='utf-8', errors='replace').read()
lines = text.splitlines()

# ---- 解析事件块 ----
cur = None
depth = 0
in_rndwave = 0
events = {}   # 事件名 -> [wave, ...]

ev_re = re.compile(r'^\s*"([^"]+)"\s*$')
kv_re = re.compile(r'^\s*"([^"]+)"\s+"([^"]*)"')

for ln in lines:
    m = ev_re.match(ln)
    if m and depth == 0:
        cur = m.group(1)
        events.setdefault(cur, [])
        continue
    if '//' in ln:
        ln = ln.split('//')[0]
    if re.match(r'^\s*"rndwave"\s*$', ln):
        in_rndwave = 1
        continue
    k = kv_re.match(ln)
    if k and cur:
        key, val = k.group(1), k.group(2)
        if key in ('wave', 'rndwave_wave'):
            events[cur].append(clean_wave(val))
        elif key == 'soundlevel':
            pass
    if '{' in ln:
        depth += ln.count('{')
    if '}' in ln:
        depth -= ln.count('}')
        if depth <= 0:
            depth = 0
            cur = None

# ---- 找出 3rd_Weapon_*.Single 与 Weapon_*.Single ----
result = {}
for name, waves in events.items():
    m = re.match(r'^(3rd_)?(Weapon_[A-Za-z0-9_]+)\.(Single)$', name)
    if not m:
        continue
    third, weapon, kind = bool(m.group(1)), m.group(2), m.group(3)
    for w in waves:
        if not w.startswith('weapons/'):
            continue
        result.setdefault(weapon, {'third': [], 'first': []})
        result[weapon]['third' if third else 'first'].append(w)

# ---- 汇总：优先第三人称音效，检查 CS2 是否存在 ----
out = {}
rows = []
for weapon in sorted(result):
    info = result[weapon]
    pick = None
    src = None
    for cand, tag in [(info['third'], '3rd'), (info['first'], '1st')]:
        for w in cand:
            if w in cs2:
                pick, src = w, tag
                break
        if pick:
            break
    if pick:
        out[weapon] = {
            'vsnd': 'sounds/%s.vsnd' % pick,
            'source': src,
            'cs2_size': cs2[pick],
        }
    rows.append((weapon, src or '-', pick or '(CS2 无此文件)'))

print('解析到含 Single 音效的武器数: %d' % len(result))
print('其中在 CS2 客户端中已存在旧枪声的: %d' % len(out))
print()
print('%-26s %-5s %s' % ('武器', '来源', 'CS2 中的路径'))
for weapon, src, pick in rows:
    print('%-26s %-5s %s' % (weapon, src, pick))

if out_path:
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print()
    print('已写入: %s (%d 项)' % (out_path, len(out)))
