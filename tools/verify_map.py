#!/usr/bin/env python3
"""逐个校验旧枪声：确认 CS2 中的 vsnd_c 是否与 CS:GO 原始 wav 的 PCM 完全一致。
并生成带 item_def_index 的最终配置。
用法: verify_map.py <legacy_map.json> <items_game.txt> <输出json>
"""
import json
import re
import struct
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vpk import VPK  # noqa: E402

legacy_path, items_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

CSGO_VPK = '/zfs1t/Games/Steam/csgo-ds/csgo/pak01_dir.vpk'
CS2_VPK = '/zfs1t/Games/Steam/cs2-ds/game/csgo/pak01_dir.vpk'

print('加载 VPK ...')
csgo = VPK(CSGO_VPK)
cs2 = VPK(CS2_VPK)
print('  CS:GO 条目 %d, CS2 条目 %d' % (len(csgo.entries), len(cs2.entries)))


def wav_data(blob):
    """返回 (data块, 采样信息)，找不到返回 (None, None)"""
    if blob[:4] != b'RIFF':
        return None, None
    pos = 12
    fmt = None
    data = None
    while pos + 8 <= len(blob):
        cid = blob[pos:pos + 4]
        sz = struct.unpack_from('<I', blob, pos + 4)[0]
        body = blob[pos + 8:pos + 8 + sz]
        if cid == b'fmt ':
            fmt = body
        elif cid == b'data':
            data = body
        pos += 8 + sz + (sz & 1)
    info = None
    if fmt and len(fmt) >= 16:
        af, ch, rate, br, ba, bits = struct.unpack_from('<HHIIHH', fmt, 0)
        info = 'fmt=%d ch=%d rate=%d bits=%d' % (af, ch, rate, bits)
    return data, info


# ---- 解析 items_game.txt 的 武器名 -> def_index ----
items = open(items_path, encoding='utf-8', errors='replace').read()
defmap = {}
for m in re.finditer(r'"(\d+)"\s*\r?\n\s*\{\s*\r?\n\s*"name"\s*"([^"]+)"', items):
    defmap[m.group(2)] = int(m.group(1))
print('items_game 解析到武器定义 %d 个' % len(defmap))

# ---- 逐项校验 ----
legacy = json.load(open(legacy_path, encoding='utf-8'))
final = {}
stats = {'OK': 0, 'CHANGED': 0, 'MISSING': 0}
report = []

for weapon, info in sorted(legacy.items()):
    vsnd = info['vsnd']                       # sounds/weapons/xxx.vsnd
    stem = vsnd[len('sounds/'):-len('.vsnd')]  # weapons/xxx
    wav_key = 'sound/%s.wav' % stem
    v_key = 'sounds/%s.vsnd_c' % stem

    if wav_key not in csgo.entries or v_key not in cs2.entries:
        stats['MISSING'] += 1
        report.append((weapon, 'MISSING', stem, ''))
        continue

    wav_blob = csgo.read(wav_key)
    vsnd_blob = cs2.read(v_key)
    data, sinfo = wav_data(wav_blob)

    if not data:
        stats['MISSING'] += 1
        report.append((weapon, 'NO_WAV_DATA', stem, sinfo or ''))
        continue

    ok = vsnd_blob.find(data) >= 0
    status = 'OK' if ok else 'CHANGED'
    stats[status] += 1
    report.append((weapon, status, stem, '%s  wav=%dB' % (sinfo, len(data))))

    if ok:
        wname = 'weapon_' + weapon[len('Weapon_'):].lower()
        di = defmap.get(wname)
        final[weapon] = {
            'item_def_index': di,
            'vsnd': vsnd,
            'size': len(data),
            'note': '%s 音效，CS2 客户端已含且 PCM 与 CS:GO 一致' % info['source'],
        }

print()
print('%-24s %-9s %-42s %s' % ('武器', '结果', '路径', '信息'))
for weapon, status, stem, extra in report:
    mark = '✔' if status == 'OK' else '✘'
    print('%s %-22s %-9s %-42s %s' % (mark, weapon, status, stem, extra))

print()
print('=== 统计 ===')
print('PCM 一致（可直接用）: %d' % stats['OK'])
print('CS2 已改动（不可用）: %d' % stats['CHANGED'])
print('缺失/无法解析      : %d' % stats['MISSING'])
print()
print('带 def_index 的条目: %d / %d' % (sum(1 for v in final.values() if v['item_def_index']), len(final)))
missing_di = [k for k, v in final.items() if not v['item_def_index']]
if missing_di:
    print('未找到 def_index 的:', ', '.join(missing_di))

json.dump(final, open(out_path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
print()
print('已写入 %s (%d 项)' % (out_path, len(final)))
