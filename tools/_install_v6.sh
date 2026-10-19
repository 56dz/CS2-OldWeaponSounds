#!/bin/bash
# 把手工推到 ~/wpn/push3 的 v6 包装进服务器的 workshop 缓存，并把 acf 指向新 manifest。
# 为什么手工装：新版本在 Steam 待审核期间 steamcmd/客户端只能拿到已过审的旧版，
# 而服务器 DS 挂载读的是本地缓存文件本身，所以直接换文件 + 改 acf 即可生效。
set -u

WID=3819498100
APPID=730
REL_MANIFEST=6488302547389947201
REL_TIMEUPD=1792406099

W=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
SRC=/home/zhz/wpn/push3
DST=$W/content/$APPID/$WID
ACF=$W/appworkshop_730.acf

echo "=== 校验源文件 ==="
sha1sum "$SRC"/*.vpk
ls -l "$SRC"

echo "=== 安装到缓存目录 $DST ==="
mkdir -p "$DST"
cp -f "$SRC"/3819498100_000.vpk "$SRC"/3819498100_dir.vpk "$SRC"/publish_data.txt "$DST"/
ls -l "$DST"
sha1sum "$DST"/*.vpk

SIZE=$(du -cb "$DST"/* | tail -1 | cut -f1)
echo "total size = $SIZE"

echo "=== 更新 acf ==="
python3 /home/zhz/wpn/tools/_acf_force.py "$ACF" "$WID" "$SIZE" "$REL_TIMEUPD" "$REL_MANIFEST"
