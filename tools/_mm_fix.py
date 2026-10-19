#!/bin/bash
set -u
F=/zfs1t/Games/Steam/cs2-ds/game/csgo/cfg/multiaddonmanager/multiaddonmanager.cfg
python3 -c "
import sys
p=sys.argv[1]
T=chr(9); Q=chr(34); N=chr(10)
lines=open(p,encoding='utf-8',errors='surrogateescape').read().split(N)
out=[]
for ln in lines:
    head=ln.strip().split(' ')[0].split(T)[0]
    if head=='mm_extra_addons':
        ln='mm_extra_addons'+T*4+Q+'3819498100'+Q+T*2+'// TEMP audio-only test'
    elif head=='mm_client_extra_addons':
        ln='mm_client_extra_addons'+T*3+Q+'3819498100'+Q+T*2+'// TEMP audio-only test'
    out.append(ln)
open(p,'w',encoding='utf-8',errors='surrogateescape').write(N.join(out))
" "$F"
echo '=== 结果 ==='
grep -E '^mm_extra_addons|^mm_client_extra_addons' "$F"
