#!/usr/bin/env python3
"""从 CS:GO DS 的 pak01 中批量提取 wav。

用法:
  extract_wavs.py <csgo_dir> <wav清单.json> <输出根目录> [--rel]

wav清单.json: ["physics/body/body_impact_self_06.wav", ...]  （相对 sound/ 的路径）
输出: <输出根目录>/<清单路径>（保持原相对结构）

附带产出 manifest.json: [{wav, out, size, sha1}]
"""
import hashlib
import json
import os
import sys
import glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vpk import VPK


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 64
    csgo_dir, list_path, out_root = sys.argv[1], sys.argv[2], sys.argv[3]
    wavs = json.load(open(list_path, encoding='utf-8'))
    v = VPK(glob.glob(os.path.join(csgo_dir, 'pak01_dir.vpk'))[0])
    table = {k.lower(): k for k in v.entries}
    ok = 0
    missing = []
    manifest = []
    total = 0
    for w in wavs:
        w = w.replace('\\', '/')
        inner = 'sound/' + w if not w.startswith('sound/') else w
        key = inner.lower()
        if key not in table:
            missing.append(inner)
            continue
        real = table[key]
        blob = v.read(real)
        out = os.path.join(out_root, w)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'wb') as f:
            f.write(blob)
        ok += 1
        total += len(blob)
        manifest.append({
            'wav': w, 'out': out, 'size': len(blob),
            'sha1': hashlib.sha1(blob).hexdigest(),
        })
    json.dump({'count': ok, 'bytes': total, 'missing': missing, 'files': manifest},
              open(os.path.join(out_root, '_manifest.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('提取 %d/%d, 共 %d 字节 (%.2f MB), 缺失 %d' %
          (ok, len(wavs), total, total / 1048576.0, len(missing)))
    for m in missing[:20]:
        print('  缺:', m)
    return 0


if __name__ == '__main__':
    sys.exit(main())
