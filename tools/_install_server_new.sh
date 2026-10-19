#!/bin/bash
# Install the freshly published 3819498100 build into the CS2 DS workshop cache
# and point the acf at it. Steam only serves *approved* builds, so during the
# review window we drop the files in by hand.
set -e

WID=3819498100
APPID=730
REL_MANIFEST=8662630581793852997
REL_TIMEUPD=1792383706

W=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
SRC=/home/zhz/wpn/push2
DST=$W/content/$APPID/$WID
ACF=$W/appworkshop_730.acf

echo "=== 清理误建目录 ==="
rm -rf "$W/content/$WID"

echo "=== 安装前 ==="
ls -l "$DST" || true

mkdir -p "$DST"
cp -a "$SRC/3819498100_000.vpk" "$DST/3819498100_000.vpk"
cp -a "$SRC/3819498100_dir.vpk" "$DST/3819498100_dir.vpk"
cp -a "$SRC/publish_data.txt" "$DST/publish_data.txt"

echo "=== 安装后 ==="
ls -l "$DST"
sha1sum "$DST"/*.vpk

SIZE=$(du -cb "$DST"/* | tail -1 | cut -f1)
echo "total size = $SIZE"

echo "=== 更新 acf ==="
python3 /home/zhz/wpn/tools/_acf_force.py "$ACF" "$WID" "$SIZE" "$REL_TIMEUPD" "$REL_MANIFEST"

echo "=== acf 复核 ==="
grep -n "3819498100" -A9 "$ACF" | head -30
