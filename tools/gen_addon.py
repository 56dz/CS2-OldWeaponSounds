#!/usr/bin/env python3
"""从 verified_map.json 生成 CS2 addon 的 soundevents_addon.vsndevts 覆盖文件。
用法: gen_addon.py <verified_map.json> <输出目录>
"""
import json
import os
import sys

src, outdir = sys.argv[1], sys.argv[2]
data = json.load(open(src, encoding='utf-8'))

# 手工补齐的 def_index
FIX = {
    'Weapon_MP5': 23,
    'Weapon_USP': 61,
    'Weapon_PartyHorn': None,
}

# 事件名 -> (音量, 是否已知完整定义)
# AK47 的原始定义是逐字段抄自 CS2 真实 game_sounds_weapons 的，最可靠
KNOWN = {
    'Weapon_AK47': (1.100000, ['meta', 'rifle']),
    'Weapon_AWP': (1.400000, ['meta', 'sniper_rifle']),
    'Weapon_DEagle': (1.000000, ['meta', 'pistol']),
    'Weapon_M4A1': (1.000000, ['meta', 'rifle']),
}

lines = []
lines.append('// CS2 旧版（CS:GO）枪声覆盖 —— 由自动化脚本生成')
lines.append('// 原理：把原版 soundevent 重新指向 CS2 客户端中已存在的 CS:GO 原版 .vsnd 文件')
lines.append('//      这些文件已随 CS2 分发（PCM 与 CS:GO 逐字节一致），因此本 addon 无需附带任何音频文件')
lines.append('// 放置位置：<addon>/soundevents/soundevents_addon.vsndevts')
lines.append('')
lines.append('soundevents_addon =')
lines.append('{')

count = 0
for weapon in sorted(data):
    info = data[weapon]
    di = info.get('item_def_index') or FIX.get(weapon)
    if weapon in FIX and FIX[weapon] is not None:
        di = FIX[weapon]
    if not di:
        continue

    vol, meta = KNOWN.get(weapon, (1.000000, None))
    event = 'Weapon_%s.Single' % weapon[len('Weapon_'):]
    vsnd = info['vsnd']

    lines.append('')
    lines.append('\t%s =' % event)
    lines.append('\t{')
    lines.append('\t\ttype = "csgo_mega"')
    lines.append('\t\tvolume = %f' % vol)
    lines.append('\t\tmixgroup = "Weapons"')
    lines.append('\t\tvsnd_files_track_01 =')
    lines.append('\t\t[')
    lines.append('\t\t\t"%s",' % vsnd)
    lines.append('\t\t]')
    if meta:
        lines.append('\t\tmetadata = [ %s, ]' % ', '.join('"%s"' % m for m in meta))
    lines.append('\t}')
    count += 1

lines.append('}')
lines.append('')

os.makedirs(outdir, exist_ok=True)
p = os.path.join(outdir, 'soundevents_addon.vsndevts')
with open(p, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print('已生成 %s' % p)
print('覆盖的 soundevent 数量: %d' % count)
print()
print('--- 文件前 30 行 ---')
for l in lines[:30]:
    print(l)
