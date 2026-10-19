#!/bin/bash
# 把 ~/wpn/push5 里的 wa 新分卷装进 CS2 服务器的 workshop 缓存，
# 并把 3819972417 从 acf 摘除（避免内置 Steam 把未过审的新包回滚）。
set -u

WID=3819972417
APPID=730
W=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
SRC=/home/zhz/wpn/push5
DST=$W/content/$APPID/$WID
ACF=$W/appworkshop_730.acf

echo "=== 安装前 ==="
ls -l "$DST" | tail -4

echo "=== 拷贝新分卷 ==="
mkdir -p "$DST"
for f in "$SRC"/*.vpk; do
  b=$(basename "$f")
  cp -f "$f" "$DST/$b" || { echo "COPY FAIL $b"; exit 2; }
  echo "  装上 $b ($(stat -c%s "$DST/$b") B)"
done

echo "=== 安装后 ==="
ls -l "$DST" | tail -4

echo "=== 摘除 acf 条目 ==="
python3 /home/zhz/wpn/tools/_acf_unpin.py "$ACF" "$WID"

echo "=== 复查包内容 ==="
python3 - "$DST/3819972417_dir.vpk" <<'PY'
import sys, os
sys.path.insert(0, '/home/zhz/wpn/tools')
try:
    from vpk import VPK
except Exception as e:
    print('import vpk 失败:', e); raise SystemExit(0)
v = VPK(sys.argv[1])
se = [k for k in v.entries if k.startswith('soundevents/')]
snd = [k for k in v.entries if k.startswith('sounds/weapons_csgo/')]
print('总条目:', len(v.entries))
for k in se:
    print('  ', k, v.entries[k][4], 'B')
print('sounds/weapons_csgo 条目数:', len(snd))
PY

echo "=== 完成 ==="
