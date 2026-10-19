#!/bin/bash
# 把 wa 新包中与服务器不同的分卷推到服务器（000-009 与已发布版逐字节相同，无需重传）
set -u
cd "D:/Users/Daniel/code/DSH/cssharp/env" || exit 1
V="D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo_addons/vpks/3819972417"

echo "=== mkdir ~/wpn/push5 ==="
node ssh/rsh.js 'mkdir -p ~/wpn/push5 && ls -d ~/wpn/push5'

for f in 3819972417_010.vpk 3819972417_011.vpk 3819972417_012.vpk 3819972417_013.vpk 3819972417_014.vpk 3819972417_015.vpk 3819972417_dir.vpk; do
  echo "=== put $f ==="
  node ssh/rsync.js put "$V/$f" "wpn/push5/$f" || { echo "FAILED $f"; exit 2; }
done

echo "=== 全部推送完成 ==="
node ssh/rsh.js 'ls -l ~/wpn/push5/'
