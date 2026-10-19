#!/bin/bash
set -e
DST=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
SRC=/home/zhz/Steam/steamapps/workshop
TS=$(date +%Y%m%d-%H%M%S)
ID=3819498100

echo "=== 1. 备份 acf ==="
cp -a "$DST/appworkshop_730.acf" "$DST/appworkshop_730.acf.bak-$TS"
echo "备份: appworkshop_730.acf.bak-$TS"

echo "=== 2. 覆盖 addon 内容 ==="
rm -rf "$DST/content/730/$ID"
mkdir -p "$DST/content/730/$ID"
cp -a "$SRC/content/730/$ID/." "$DST/content/730/$ID/"
du -sh "$DST/content/730/$ID"
ls -la "$DST/content/730/$ID"

echo "=== 3. 更新 acf ==="
cd /home/zhz/wpn
python3 acf_upsert.py "$DST/appworkshop_730.acf" --from "$SRC/appworkshop_730.acf" --id $ID

echo "=== 4. 校验 VPK 内容 ==="
python3 tools/vpk.py list "$DST/content/730/$ID/${ID}_dir.vpk" 2>&1 | grep -i "vsndevts\|共" | tail -3

echo "=== 5. acf 里该条目的记录 ==="
grep -A8 "\"$ID\"" "$DST/appworkshop_730.acf" | head -12
