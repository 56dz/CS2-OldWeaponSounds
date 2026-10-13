#!/usr/bin/env bash
# 提取构建 addon 所需的原始素材（本仓库不附带任何 Valve 音频/脚本文本，需自行从自己的游戏安装提取）
#
#  1) gsw.txt                      —— CS2 的 soundevents/game_sounds_weapons.vsndevts（全部真实 soundevent 定义）
#  2) wav/famas_01.wav 等 5 个文件 —— CS:GO 里被 CS2 换掉音频的 5 把武器的原始 wav
#
# 用法:
#   CS2="/d/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive" \
#   CSGO_DS="zhz@server:/zfs1t/Games/Steam/csgo-ds" \
#   ./tools/extract_sources.sh
#
# 说明:
#  - CS2 客户端/服务端的 pak01_dir.vpk 里只有**编译后**的 game_sounds_weapons.vsndevts_c，
#    用 resourceinfo.exe 也导不出文本（该文件的 DATA 块是 old-introspected blob，
#    会报 "ConvertOldIntrospectedResourceDataToKV3 - No introspection dictionary!"）。
#    所以 gsw.txt 请从社区转储获取（见下），它是纯文本 kv3。
#  - 5 个 wav 只在 **CS:GO** 客户端/DS 里，CS2 已经没有原始 wav 了。

set -euo pipefail

CS2="${CS2:-}"
CSGO_DS="${CSGO_DS:-}"
VPK_PY="${VPK_PY:-tools/vpk.py}"
OUT="${OUT:-.}"

mkdir -p "$OUT/wav"

echo "== 1) gsw.txt =="
if [ -f "$OUT/gsw.txt" ]; then
  echo "已存在: $OUT/gsw.txt （跳过）"
else
  # 社区维护的 CS2 资源转储（纯文本 kv3）
  curl -sSL -o "$OUT/gsw.txt" \
    https://raw.githubusercontent.com/Vauff/cs2_dumps/main/soundevents/game_sounds_weapons.vsndevts
  echo "已下载: $OUT/gsw.txt"
fi
echo -n "  行数: "; wc -l < "$OUT/gsw.txt"
echo -n "  首行: "; head -1 "$OUT/gsw.txt"

if [ -z "$CSGO_DS" ]; then
  echo "!! 未设置 CSGO_DS，跳过 wav 提取"
  exit 0
fi

echo "== 2) 从 CS:GO DS 提取 5 个原始 wav =="
# 参数: <vpk 内路径> <本地文件名>
extract() {
  echo "-- $1"
  python3 "$VPK_PY" extract "$CSGO_DS/csgo/pak01_dir.vpk" "$1" "$OUT/wav/$2"
}
extract sound/weapons/famas/famas_01.wav       famas_01.wav
extract sound/weapons/galilar/galil_01.wav     galil_01.wav
extract sound/weapons/glock18/glock_01.wav     glock_01.wav
extract sound/weapons/revolver/revolver-1_01.wav revolver-1_01.wav
extract sound/weapons/xm1014/xm1014-1.wav      xm1014-1.wav

ls -la "$OUT/wav"
md5sum "$OUT/wav"/*.wav

cat <<'EOF'

== 3) 放进 addon ==
  content/csgo_addons/oldweaponsounds/sounds/weapons_csgo/famas/famas_01.wav
  content/csgo_addons/oldweaponsounds/sounds/weapons_csgo/galilar/galil_01.wav
  content/csgo_addons/oldweaponsounds/sounds/weapons_csgo/glock18/glock_01.wav
  content/csgo_addons/oldweaponsounds/sounds/weapons_csgo/revolver/revolver-1_01.wav
  content/csgo_addons/oldweaponsounds/sounds/weapons_csgo/xm1014/xm1014-1.wav
再按 README「四、构建」编译。
EOF
