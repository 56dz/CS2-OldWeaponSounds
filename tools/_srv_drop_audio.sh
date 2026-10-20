#!/usr/bin/env bash
# 从本服移除纯音频包 3819498100（它留给另一台纯游戏服）：
#   1) 停服（避免 CS2 内置 Steam 在运行中把 acf 写回）
#   2) 从 acf 两段摘除 3819498100 条目（Steam 才不会重新下载）
#   3) 删除 content/730/3819498100 缓存（约 72 MB）
#   保留 3819972417（wa 模型包）不动。
set -e
DROP=3819498100
W=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
ACF=$W/appworkshop_730.acf
DST=$W/content/730/$DROP

echo "=== 装前 ==="
du -sb "$DST" 2>/dev/null || echo "(不存在)"
grep -c "\"$DROP\"" "$ACF" || true

python3 /home/zhz/wpn/tools/_acf_unpin.py "$ACF" "$DROP"

rm -rf "$DST"
echo "=== 删后 ==="
ls -d "$DST" 2>/dev/null || echo "(已删除)"
echo "acf 里 $DROP 出现次数: $(grep -c "\"$DROP\"" "$ACF" || true)"
echo "acf 里 3819972417 出现次数: $(grep -c '"3819972417"' "$ACF" || true)"
echo "=== 剩余缓存 ==="
du -sb "$W/content/730/"* 2>/dev/null | sort -k2
