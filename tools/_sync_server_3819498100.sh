#!/bin/bash
# 服务器端：拉取工坊新版本并写入 MM 缓存
set -u
ID=3819498100
DST=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop

echo "===== 1. steamcmd 下载 ====="
cd /zfs1t/Games/Steam || exit 1
./steamcmd.sh +login Daniel_Photography +workshop_download_item 730 $ID +quit 2>&1 | grep -E "Success|ERROR|Downloaded|Failed" | tail -5

SRC=/home/zhz/Steam/steamapps/workshop/content/730/$ID
echo "===== 2. 下载结果 ====="
if [ -d "$SRC" ]; then
  ls -la "$SRC"
else
  echo "!! 下载目录不存在: $SRC"
  exit 2
fi

echo "===== 3. 备份并复制 ====="
TS=$(date +%Y%m%d-%H%M%S)
cp -a "$DST/appworkshop_730.acf" "$DST/appworkshop_730.acf.bak-$TS" && echo "已备份 appworkshop_730.acf.bak-$TS"
rm -rf "$DST/content/730/$ID"
mkdir -p "$DST/content/730/$ID"
cp -a "$SRC"/. "$DST/content/730/$ID"/ && echo "已复制到 $DST/content/730/$ID"
ls -la "$DST/content/730/$ID"

echo "===== 4. acf_upsert ====="
cd /home/zhz/wpn || exit 1
python3 acf_upsert.py "$DST/appworkshop_730.acf" --from /home/zhz/Steam/steamapps/workshop/appworkshop_730.acf --id $ID

echo "===== 5. VPK 校验 ====="
python3 tools/vpk.py list "$DST/content/730/$ID/${ID}_dir.vpk" 2>/dev/null | grep -E "soundevents_addon|ak47_clipin|ak47_clipout|共 " | head -10
echo "---- 条目总数 ----"
python3 tools/vpk.py list "$DST/content/730/$ID/${ID}_dir.vpk" 2>/dev/null | tail -1
