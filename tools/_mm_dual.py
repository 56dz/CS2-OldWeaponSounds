#!/usr/bin/env python3
"""把 multiaddonmanager.cfg 的两个挂载列表改成指定 addon 列表（默认双包）。

用法: python3 _mm_dual.py [addon列表] [cfg路径]
默认: addon列表 "3819498100,3819972417"，cfg 走 CS2 DS 标准路径。
写之前自动备份成 <cfg>.bak-dual-<时间戳>。
"""
import os
import shutil
import sys
import time

ADDONS = sys.argv[1] if len(sys.argv) > 1 else '3819498100,3819972417'
CFG = sys.argv[2] if len(sys.argv) > 2 else \
    '/zfs1t/Games/Steam/cs2-ds/game/csgo/cfg/multiaddonmanager/multiaddonmanager.cfg'

T = '\t'
Q = '"'
N = '\n'

if not os.path.exists(CFG):
    sys.exit('cfg 不存在: %s' % CFG)

src = open(CFG, encoding='utf-8', errors='surrogateescape').read()
lines = src.split(N)
out = []
hit = {'mm_extra_addons': 0, 'mm_client_extra_addons': 0}

for ln in lines:
    head = ln.strip().split(' ')[0].split(T)[0]
    if head == 'mm_extra_addons':
        ln = 'mm_extra_addons' + T * 4 + Q + ADDONS + Q + T * 2 + '// audio pack first, then model pack'
        hit['mm_extra_addons'] += 1
    elif head == 'mm_client_extra_addons':
        ln = 'mm_client_extra_addons' + T * 3 + Q + ADDONS + Q + T * 2 + '// audio pack first, then model pack'
        hit['mm_client_extra_addons'] += 1
    out.append(ln)

if not hit['mm_extra_addons'] or not hit['mm_client_extra_addons']:
    sys.exit('未找到目标行: %s' % hit)

bak = CFG + '.bak-dual-' + time.strftime('%Y%m%d-%H%M%S')
shutil.copy2(CFG, bak)
print('备份: %s' % bak)

new = N.join(out)
open(CFG, 'w', encoding='utf-8', errors='surrogateescape').write(new)
print('写回完成，长度 %d -> %d' % (len(src), len(new)))
print('命中行数: %s' % hit)
print('=== 结果 ===')
for ln in new.split(N):
    h = ln.strip().split(' ')[0].split(T)[0]
    if h in ('mm_extra_addons', 'mm_client_extra_addons', 'mm_addon_mount_download',
             'mm_addon_debug', 'mm_extra_addons_timeout', 'mm_addon_connection_timeout'):
        print(ln)
