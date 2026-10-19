#!/bin/bash
# 把 steamcmd 下载的新版 3819498100 同步到 CS2 DS 实际挂载的 workshop 缓存
set -e
A=/zfs1t/Games/Steam/cs2-ds/game/bin/linuxsteamrt64/steamapps/workshop
SRC=/home/zhz/Steam/steamapps/workshop/content/730/3819498100
DST=$A/content/730/3819498100
ACF=$A/appworkshop_730.acf
SRCACF=/home/zhz/Steam/steamapps/workshop/appworkshop_730.acf

TS=$(date +%Y%m%d-%H%M%S)
echo "=== 备份 acf ==="
cp -a "$ACF" "$ACF.bak-$TS"
echo "backup: $ACF.bak-$TS"

echo "=== 替换 vpk 文件 ==="
ls -l "$DST"
rm -f "$DST"/3819498100_000.vpk "$DST"/3819498100_dir.vpk "$DST"/publish_data.txt
cp -a "$SRC"/* "$DST"/
chown zhz:zhz "$DST"/*
ls -l "$DST"

echo "=== 更新 acf 条目 ==="
python3 - "$ACF" "$SRCACF" <<'PY'
import sys, re
acf, srcacf = sys.argv[1], sys.argv[2]
def block(text, wid):
    # 找到 "<wid>" { ... } 的第一个块，返回 (start,end) 和内容
    m = re.search(r'^\t\t"%s"\s*$' % re.escape(wid), text, re.M)
    if not m: return None
    i = text.find('{', m.end())
    depth = 0
    j = i
    while j < len(text):
        if text[j] == '{': depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0: break
        j += 1
    return (m.start(), j + 1, text[m.start():j+1])

def fields(b):
    return dict(re.findall(r'"(size|timeupdated|manifest)"\s*"([^"]+)"', b))

s = open(srcacf, encoding='utf-8', errors='surrogateescape').read()
t = open(acf, encoding='utf-8', errors='surrogateescape').read()
sb = block(s, '3819498100')
new = fields(sb[2])
print('目标字段:', new)

# 替换所有出现的该 id 块（ContentFile 与 ContentFileForWhitelist 两处）
count = 0
while True:
    b = block(t, '3819498100')
    if not b: break
    old = fields(b[2])
    nb = b[2]
    for k, v in new.items():
        nb = re.sub(r'("%s"\s*)"[^"]*"' % k, r'\1"%s"' % v, nb)
    t = t[:b[0]] + nb + t[b[1]:]
    count += 1
open(acf, 'w', encoding='utf-8', errors='surrogateescape').write(t)
print('已更新块数:', count)
PY

echo "=== 校验 ==="
grep -A5 '"3819498100"' "$ACF" | head -14
