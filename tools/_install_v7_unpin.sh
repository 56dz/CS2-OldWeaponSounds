#!/bin/bash
# 把 v7 文件装进服务器缓存，并从 acf 的 WorkshopItemsInstalled 里摘掉该 item，
# 让 CS2 内置的 Steam 客户端不再管理/校验它，从而避免「未过审 → 自动回滚到已过审版本」。
#
# 背景（重要）：
#   CS2 DS 启动时 Steam 会遍历 acf 里 WorkshopItemsInstalled 的每个 item，按 manifest
#   做完整性校验。acf 只能指向「已过审」的 manifest（未过审的取不到），而磁盘放的是 v7，
#   哈希必然不符 → Steam 重下已过审版本覆盖。实测两次（23:59、00:04）都被回滚。
#   摘掉 item 后 Steam 不再遍历它，MM 仍可按 ID 挂载 content/730/<WID>/ 下的本地文件。
#
# 风险：acf 写坏会让所有 addon 变 not installed → 必须先备份，且用精确块定位。
set -e

WID=3819498100
APPID=730
SRC=/home/zhz/wpn/push4

W=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
DST=$W/content/$APPID/$WID
ACF=$W/appworkshop_730.acf

echo "=== 安装 v7 文件 ==="
mkdir -p "$DST"
cp -f "$SRC/3819498100_000.vpk" "$DST/"
cp -f "$SRC/3819498100_dir.vpk" "$DST/"
ls -l "$DST"
sha1sum "$DST"/*.vpk

echo "=== 备份 acf 并摘除 item ==="
BAK="$ACF.bak-unpin-$(date +%Y%m%d-%H%M%S)"
cp -a "$ACF" "$BAK"
echo "备份: $BAK"

python3 - "$ACF" "$WID" <<'PY'
import re, sys
path, wid = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8', errors='surrogateescape').read()

def drop_block(text, section, wid):
    """在 section 里删除 "\"wid\"" 对应的整个 {...} 块"""
    si = text.find('\t"%s"' % section)
    if si < 0:
        return text, False
    # 在 section 范围内找 wid 块
    depth = 0
    i = text.find('{', si)
    end = len(text)
    d = 0
    while i < len(text):
        if text[i] == '{':
            d += 1
        elif text[i] == '}':
            d -= 1
            if d == 0:
                end = i
                break
        i += 1
    seg = text[si:end]
    m = re.search(r'\n\t\t"%s"\s*\n\t\t\{' % re.escape(wid), seg)
    if not m:
        return text, False
    bs = si + m.start()
    # 找到该块的闭合
    d = 0
    j = text.find('{', bs)
    k = j
    while k < len(text):
        if text[k] == '{':
            d += 1
        elif text[k] == '}':
            d -= 1
            if d == 0:
                break
        k += 1
    return text[:bs] + text[k + 1:], True

before = text
text, ok1 = drop_block(text, 'WorkshopItemsInstalled', wid)
text, ok2 = drop_block(text, 'WorkshopItemDetails', wid)
print('WorkshopItemsInstalled 摘除:', ok1, ' WorkshopItemDetails 摘除:', ok2)
if not (ok1 or ok2):
    print('未找到目标块，保持原样')
    sys.exit(1)
open(path, 'w', encoding='utf-8', errors='surrogateescape').write(text)
print('写回完成，长度 %d -> %d' % (len(before), len(text)))
PY

echo "=== 校验 acf 里已无该 item ==="
grep -c "\"$WID\"" "$ACF" || echo "0 (已摘除)"
echo "=== 其它 item 仍在（防写坏） ==="
grep -E '^\t\t"[0-9]{6,}"' "$ACF" | head -10
