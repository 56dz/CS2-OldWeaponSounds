#!/usr/bin/env python3
"""由 verified_map.json + items_game.txt 生成插件 config.json"""
import json
import re
import sys

verified, items_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

t = open(items_path, encoding='utf-8', errors='replace').read()
di2name = {}
name2di = {}
for m in re.finditer(r'"(\d+)"\s*\r?\n\s*\{\s*\r?\n\s*"name"\s*"([^"]+)"', t):
    d, n = int(m.group(1)), m.group(2)
    di2name.setdefault(d, n)
    name2di.setdefault(n, d)

# 事件名 -> items_game 里的武器名（多数直接小写，少数特殊）
SPECIAL = {
    'Weapon_MP5': 'weapon_mp5sd',
    'Weapon_USP': 'weapon_usp_silencer',
    'Weapon_PartyHorn': 'weapon_partyhorn',
    'Weapon_GalilAR': 'weapon_galilar',
    'Weapon_HKP2000': 'weapon_hkp2000',
}

data = json.load(open(verified, encoding='utf-8'))
weapons = {}
skipped = []
for weapon, info in sorted(data.items()):
    short = weapon[len('Weapon_'):]
    wname = SPECIAL.get(weapon, 'weapon_' + short.lower())
    di = info.get('item_def_index') or name2di.get(wname)
    if not di:
        skipped.append(weapon)
        continue
    weapons[str(di)] = {
        'name': short,
        'weapon_name': wname,
        'vsnd': info['vsnd'],
        'soundevent': '%s.Single' % weapon,
        'volume': 1.0,
    }

cfg = {
    'enabled': False,
    'replaceMode': 'none',
    'suppressVanilla': True,
    'debug': True,
    '_说明': {
        'replaceMode': 'none=只诊断 | soundevent=播 soundevent(需挂载 addon，方位正确，推荐) | vsnd=直接播文件(无需 addon，但可能丢 3D 定位)',
        'enabled': '总开关，默认 false（安全）。确认无误后改成 true，或用命令 css_oldws 1',
        'suppressVanilla': '替换成功后是否屏蔽原版开火音，避免双重音',
    },
    'weapons': weapons,
}

json.dump(cfg, open(out_path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
print('已生成 %s' % out_path)
print('武器条目: %d' % len(weapons))
if skipped:
    print('跳过(无 def_index): %s' % ', '.join(skipped))
print()
print('--- 抽样 ---')
for k in list(weapons)[:6]:
    v = weapons[k]
    print('  [%s] %-12s %-22s %s' % (k, v['name'], v['weapon_name'], v['vsnd']))
print()
for k in ['7', '9', '60']:
    if k in weapons:
        print('  [%s] %s' % (k, weapons[k]['name']))
