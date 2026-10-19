#!/bin/bash
# 把 v7 文件装进服务器缓存，同时让 acf 指向「已过审」的 v6 manifest。
#
# 为什么要这么做：
#   acf 里的 manifest 若指向「未过审的新版本」，Steam 会认为「安装的 != 服务端最新可获取的」，
#   于是自动下载已过审的版本，把磁盘上的新文件覆盖掉（本次 23:59 就这样被回滚）。
#   反过来，让 acf 指向已过审版本 → installed == latest → Steam 判定无需更新 → 不动磁盘文件。
#   于是「文件是新版、acf 记旧版」这个组合能让新版在审核期间生效。
#
# 审核通过后要恢复正确状态：跑 tools/_sync_workshop_final.sh <manifest> <timeupdated>
set -e

WID=3819498100
APPID=730
SRC=/home/zhz/wpn/push4
# 已过审的 v6（当前 Steam 上可获取的版本）
OK_MANIFEST=6488302547389947201
OK_TIMEUPD=1792406220

W=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
DST=$W/content/$APPID/$WID
ACF=$W/appworkshop_730.acf

echo "=== 安装 v7 文件 ==="
mkdir -p "$DST"
cp -f "$SRC/3819498100_000.vpk" "$DST/"
cp -f "$SRC/3819498100_dir.vpk" "$DST/"
ls -l "$DST"
sha1sum "$DST"/*.vpk

SIZE=$(du -cb "$DST"/* | tail -1 | cut -f1)
echo "实际 total size = $SIZE"

echo "=== acf 指向已过审的 v6 manifest（阻止 Steam 回滚） ==="
python3 /home/zhz/wpn/tools/_acf_force.py "$ACF" "$WID" "$SIZE" "$OK_TIMEUPD" "$OK_MANIFEST"

echo "=== 校验 ==="
grep -A5 "\"$WID\"" "$ACF" | head -22
