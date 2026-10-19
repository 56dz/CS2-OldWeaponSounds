#!/usr/bin/env python3
"""对每个 CS:GO wav，检查 CS2 客户端「同路径 vsnd_c」是否存在且 PCM 一致。

同路径判定规则：sound/<path>.wav  ->  sounds/<path>.vsnd_c

用途：决定某个 wav 是否需要 addon 自带。
  SELF_SAME  同路径 vsnd_c 存在且内嵌同一 PCM -> 直接引用，无需自带
  SELF_DIFF  同路径存在但 PCM 不同            -> 必须自带（覆盖）
  SELF_MISS  同路径不存在                     -> 必须自带
  NO_VSND    连名字都找不到（大小写变体）      -> 必须自带

用法: check_wav_selfpath.py <gsw_wav_list.json> <csgo_dir> <cs2_dir> <out.json>
输入 json: ["sound/weapons/ak47/ak47_draw.wav", ...]
"""
import json
import os
import sys
import glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vpk import VPK
from cmp_csgo_cs2 import compare


def load_vpk(d):
    v = VPK(glob.glob(os.path.join(d, 'pak01_dir.vpk'))[0])
    return {k.lower(): (v, k) for k in v.entries}


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        return 64
    wavs = json.load(open(sys.argv[1], encoding='utf-8'))
    go_dir, cs2_dir, out_path = sys.argv[2], sys.argv[3], sys.argv[4]
    go = load_vpk(go_dir)
    cs2 = load_vpk(cs2_dir)
    rows = []
    stats = {}
    for w in wavs:
        # sound/weapons/ak47/ak47_draw.wav -> sounds/weapons/ak47/ak47_draw.vsnd_c
        assert w.startswith('sound/'), w
        rel = w[len('sound/'):]
        rel = rel[:-4] if rel.lower().endswith('.wav') else rel
        target = 'sounds/' + rel + '.vsnd_c'
        size = 0
        wb = None
        gk = w.lower()
        if gk in go:
            v, real = go[gk]
            wb = v.read(real)
            size = len(wb)
        tb = None
        tk = target.lower()
        if tk in cs2:
            v, real = cs2[tk]
            tb = v.read(real)
        if wb is None:
            verdict = 'MISSING_WAV'
        elif tb is None:
            verdict = 'SELF_MISS'
        else:
            r, _score = compare(wb, tb)
            verdict = 'SELF_SAME' if r == 'IDENTICAL' else 'SELF_DIFF'
        stats[verdict] = stats.get(verdict, 0) + 1
        rows.append({'wav': w, 'vsnd': target, 'verdict': verdict, 'wav_size': size,
                     'vsnd_size': len(tb) if tb else 0})
    json.dump({'stats': stats, 'rows': rows}, open(out_path, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(json.dumps(stats, ensure_ascii=False))
    total = sum(r['wav_size'] for r in rows if r['verdict'] != 'SELF_SAME')
    print('需自带 wav 总字节: %d (%.1f MB)' % (total, total / 1048576.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
