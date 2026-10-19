#!/bin/bash
# 临时只挂音频包 3819498100，移出 wa 3819972417，用于隔离验证音效
set -u
G=/zfs1t/Games/Steam/cs2-ds/game/csgo
CFG=$G/cfg/multiaddonmanager/multiaddonmanager.cfg
TS=$(date +%Y%m%d-%H%M%S)

cp -a "$CFG" "$CFG.bak-audioonly-$TS"
echo "[backup] $CFG.bak-audioonly-$TS"

# 用 python 精确改两行，避免 sed 破坏注释对齐
python3 -c "
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8', errors='surrogateescape').read()
out = []
for line in s.split(chr(10)):
    st = line.strip()
    if st.startswith('mm_extra_addons') and 'timeout' not in st.split()[0]:
        line = 'mm_extra_addons' + chr(9)*4 + chr(34) + '3819498100' + chr(34) + chr(9)*2 + '// TEMP audio-only test'
    elif st.startswith('mm_client_extra_addons'):
        line = 'mm_client_extra_addons' + chr(9)*3 + chr(34) + '3819498100' + chr(34) + chr(9)*2 + '// TEMP audio-only test'
    out.append(line)
open(p, 'w', encoding='utf-8', errors='surrogateescape').write(chr(10).join(out))
" "$CFG"

echo "=== 改后配置 ==="
grep -E "^mm_extra_addons\s|^mm_client_extra_addons" "$CFG"
