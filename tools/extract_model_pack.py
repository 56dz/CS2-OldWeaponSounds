#!/usr/bin/env python3
"""从模型包（工坊 3781467527）VPK 中只提取武器模型与材质。

用法:
  extract_model_pack.py <dir.vpk> <out_content_dir> [<out_game_dir>]

提取前缀白名单:
  weapons/models/   (436.8 MB, 2660 files)
  materials/        ( 23.2 MB,   74 files)
排除（僵尸模式内容 / 冲突源）:
  characters/ agents/ models/ sounds/ particles/ maps/ postprocess/ soundevents/ scripts/
同时写入 content 与 game 两处（内容侧供编译器识别，game 侧供发布）。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vpk import VPK  # noqa: E402

INCLUDE = ('weapons/models/', 'materials/')
EXCLUDE_EXTRA = ()


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 64
    vpk_path = sys.argv[1]
    outs = sys.argv[2:]
    for o in outs:
        os.makedirs(o, exist_ok=True)

    t0 = time.time()
    vpk = VPK(vpk_path)
    targets = sorted(k for k in vpk.entries if k.startswith(INCLUDE))
    print('dir.vpk 总条目 %d，命中白名单 %d 项' % (len(vpk.entries), len(targets)))

    total = 0
    per_top = {}
    for i, k in enumerate(targets):
        blob = vpk.read(k)
        total += len(blob)
        top = k.split('/')[0]
        s = per_top.setdefault(top, [0, 0])
        s[0] += 1
        s[1] += len(blob)
        for o in outs:
            dst = os.path.join(o, k.replace('/', os.sep))
            d = os.path.dirname(dst)
            if d:
                os.makedirs(d, exist_ok=True)
            with open(dst, 'wb') as f:
                f.write(blob)
        if (i + 1) % 500 == 0:
            print('  ... %d/%d  %.1f MB  %.1fs' % (i + 1, len(targets), total / 1048576, time.time() - t0))

    for t, (n, b) in sorted(per_top.items()):
        print('  %-12s %5d files  %8.2f MB' % (t + '/', n, b / 1048576))
    print('完成: %d 个文件, %.2f MB, 用时 %.1fs, 输出到 %s' %
          (len(targets), total / 1048576, time.time() - t0, ', '.join(outs)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
