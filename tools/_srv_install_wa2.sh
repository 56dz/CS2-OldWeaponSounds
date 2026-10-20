#!/usr/bin/env bash
# 把 steamcmd 下载的 3819972417 新版本装进 CS2 DS workshop 缓存并改 acf（已过审，可直接写）
set -e
WID=3819972417
APPID=730
MANIFEST=7869863144949603500
TIMEUPD=1792470424
SRC=/home/zhz/Steam/steamapps/workshop/content/730/$WID
W=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
DST=$W/content/$APPID/$WID
ACF=$W/appworkshop_730.acf

mkdir -p "$DST"
rm -f "$DST"/*.vpk "$DST"/publish_data.txt
cp -f "$SRC"/* "$DST/"
echo "=== 装后 ==="
ls -l "$DST"
SIZE=$(du -cb "$DST"/* | tail -1 | cut -f1)
echo "total size = $SIZE"

python3 /home/zhz/wpn/tools/_acf_force.py "$ACF" "$WID" "$SIZE" "$TIMEUPD" "$MANIFEST"

echo "=== 包内容核对 ==="
cd /home/zhz/wpn/tools
python3 - "$DST/${WID}_dir.vpk" <<'PY'
import sys
from vpk import VPK
v = VPK(sys.argv[1])
e = v.entries
print("总条目:", len(e))
for k in e:
    if k.startswith("soundevents/"):
        print("  ", k, e[k][4], "B")
print("sounds/weapons_csgo 条目数:", sum(1 for k in e if k.startswith("sounds/weapons_csgo/")))
print("scripts/:", [k for k in e if k.startswith("scripts/")])
PY
