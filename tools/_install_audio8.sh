#!/usr/bin/env bash
# 把 steamcmd 刚下载的 3819498100 v8（462 事件 / 456 wav）装进 CS2 DS 的 workshop 缓存，
# 并把 acf 指向新 manifest（该版本已过审，可直接写 acf）。
set -e
WID=3819498100
APPID=730
MANIFEST=674768629623852823
TIMEUPD=1792466178
SRC=/home/zhz/Steam/steamapps/workshop/content/730/$WID
W=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
DST=$W/content/$APPID/$WID
ACF=$W/appworkshop_730.acf

echo "=== 源 ==="
ls -l "$SRC"
echo "=== 目的一（装前）==="
ls -l "$DST" 2>/dev/null || true

mkdir -p "$DST"
rm -f "$DST"/*.vpk "$DST"/publish_data.txt
cp -f "$SRC"/* "$DST/"
echo "=== 目的一（装后）==="
ls -l "$DST"
SIZE=$(du -cb "$DST"/* | tail -1 | cut -f1)
echo "total size = $SIZE"

echo "=== 更新 acf ==="
python3 /home/zhz/wpn/tools/_acf_force.py "$ACF" "$WID" "$SIZE" "$TIMEUPD" "$MANIFEST"

echo "=== 包内容核对 ==="
cd /home/zhz/wpn/tools
python3 - "$DST/${WID}_dir.vpk" <<'PY'
import sys
from vpk import VPK
v = VPK(sys.argv[1])
ents = v.entries
print("总条目:", len(ents))
for k in ents:
    if k.startswith("soundevents/"):
        print("  ", k, ents[k][4], "B")
n = sum(1 for k in ents if k.startswith("sounds/weapons_csgo/"))
print("sounds/weapons_csgo 条目数:", n)
PY
