#!/usr/bin/env python3
"""从本机 CS2 安装提取「权威原版」scripts/weapons.vdata_c 并用 resourceinfo 转成文本。

为什么需要这一步：
    data/model-pack-analysis/vdata_dump.txt 是**模型包自带的** weapons.vdata_c 转储，
    它来自一个更早的 CS2 版本 —— 与当前 CS2 原版逐条比对，103/103 个共有条目内容都不同
    （缺少新字段 m_flCycleTimeWhenInBurstMode / m_flTimeBetweenBurstShots、
      缺少 m_bReserveAmmoAsClips、多了已被删除的 m_nCrosshairMinDistance 等）。
    把那些冻结数值写进新 addon 会重新引入「过期参数」，所以模板一律取自当前 CS2 原版。

用法（在 CSSHARP 工作区根目录执行）：
    python CS2_Old_Weapon_Sounds/tools/dump_vanilla_weapons_vdata.py \
        [<CS2 安装目录>] [<输出 dump 路径>]
默认：
    CS2    = D:\\Program Files\\Steam\\steamapps\\common\\Counter-Strike Global Offensive
    输出   = CS2_Old_Weapon_Sounds/data/model-pack-analysis/vanilla_weapons_vdata_dump.txt

依赖：同目录的 vpk.py（Source 2 VPK 解析）
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vpk import VPK  # noqa: E402

DEFAULT_CS2 = r"D:\Program Files\Steam\steamapps\common\Counter-Strike Global Offensive"
DEFAULT_OUT = os.path.join(os.path.dirname(HERE),
                           r"data\model-pack-analysis\vanilla_weapons_vdata_dump.txt")


def main():
    cs2 = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CS2
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT

    pak = os.path.join(cs2, r"game\csgo\pak01_dir.vpk")
    ri = os.path.join(cs2, r"game\bin\win64\resourceinfo.exe")
    gamedir = os.path.join(cs2, r"game\csgo")
    for p in (pak, ri):
        if not os.path.exists(p):
            print("找不到: %s" % p, file=sys.stderr)
            return 1

    vpk = VPK(pak)
    name = "scripts/weapons.vdata_c"
    if name not in vpk.entries:
        print("pak01 里没有 %s" % name, file=sys.stderr)
        return 1
    blob = vpk.read(name)
    tmp = os.path.join(os.path.dirname(out), "_vanilla_weapons.vdata_c")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(tmp, "wb") as f:
        f.write(blob)
    print("已从 pak01 提取 %s（%d B）" % (name, len(blob)))

    with open(out, "w", encoding="utf-8", newline="\n") as f:
        r = subprocess.run([ri, "-i", tmp, "-all", "-baremode", "-game", gamedir],
                           stdout=f, stderr=subprocess.PIPE)
    if r.returncode != 0:
        print("resourceinfo 失败: %s" % r.stderr.decode("utf-8", "replace"), file=sys.stderr)
        return 1
    os.remove(tmp)
    n = sum(1 for _ in open(out, encoding="utf-8"))
    print("已写出 %s（%d 行）" % (out, n))
    return 0


if __name__ == "__main__":
    sys.exit(main())
