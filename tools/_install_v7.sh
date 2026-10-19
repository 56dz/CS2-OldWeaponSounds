#!/bin/bash
# 把本地已发布的新 VPK 手动装进服务器 workshop 缓存，并把 acf 指向新 manifest。
#
# 为什么需要：创意工坊新版本要过 Steam 审核，审核期间 steamcmd 拉到的是「上次批准的版本」，
# 所以只能手动覆盖缓存 + 改 acf（不改 latest_manifest 的话 Steam 会重新下载旧审核版）。
#
# 注意：物品内容目录必须带 730 这一层 ——  $W/content/730/<WID>/
set -e

WID=3819498100
APPID=730
REL_MANIFEST=2235090939465237083
REL_TIMEUPD=1792425239
SRC=/home/zhz/wpn/push4

W=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
DST=$W/content/$APPID/$WID
ACF=$W/appworkshop_730.acf

echo "=== 源文件 ==="
ls -l "$SRC"

echo "=== 装前状态 ==="
ls -l "$DST" 2>/dev/null || echo "(目录不存在)"

mkdir -p "$DST"
cp -f "$SRC/3819498100_000.vpk" "$DST/"
cp -f "$SRC/3819498100_dir.vpk" "$DST/"

echo "=== 装后状态 ==="
ls -l "$DST"
sha1sum "$DST"/*.vpk

SIZE=$(du -cb "$DST"/* | tail -1 | cut -f1)
echo "total size = $SIZE"

echo "=== 更新 acf ==="
python3 /home/zhz/wpn/tools/_acf_force.py "$ACF" "$WID" "$SIZE" "$REL_TIMEUPD" "$REL_MANIFEST"

echo "=== 校验 acf 中的目标条目 ==="
grep -A4 "\"$WID\"" "$ACF" | head -20
