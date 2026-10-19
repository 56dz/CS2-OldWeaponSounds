#!/bin/bash
# 服务器端：彻底验证 3819498100 的当前状态（用 resourceinfo 无法在 Linux 跑，改用 VPK 结构校验）
set -u
D=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop/content/730/3819498100
echo "===== VPK 大小与时间 ====="
ls -la "$D/3819498100_000.vpk" "$D/publish_data.txt"
echo "===== publish_data ====="
cat "$D/publish_data.txt"
echo
echo "===== VPK 条目统计 ====="
python3 /home/zhz/wpn/tools/vpk.py list "$D/3819498100_dir.vpk" 2>/dev/null | tail -1
echo "===== 关键音频条目 ====="
python3 /home/zhz/wpn/tools/vpk.py list "$D/3819498100_dir.vpk" 2>/dev/null | grep -E "weapons_csgo/(ak47|usp)/" | head -25
echo
echo "===== ACF 记录 ====="
grep -A4 '"3819498100"' /zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop/appworkshop_730.acf | head -12
