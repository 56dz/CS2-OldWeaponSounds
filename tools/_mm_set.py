#!/usr/bin/env python3
# 把 multiaddonmanager.cfg 的 mm_extra_addons / mm_client_extra_addons 设为给定列表
import re, sys, shutil, time, os

cfg = sys.argv[1]
value = sys.argv[2] if len(sys.argv) > 2 else '3819498100'
comment = sys.argv[3] if len(sys.argv) > 3 else 'audio-only test'

ts = time.strftime('%Y%m%d-%H%M%S')
bak = cfg + '.bak-mm-' + ts
shutil.copy2(cfg, bak)
print('备份:', bak)

with open(cfg, 'r', encoding='utf-8') as f:
    lines = f.readlines()

keys = {'mm_extra_addons', 'mm_client_extra_addons'}
hit = 0
out = []
for ln in lines:
    m = re.match(r'^(\s*)(\S+)(\s+)(.*)$', ln)
    if m and m.group(2) in keys:
        out.append('%-32s"%s"\t\t// %s\n' % (m.group(2), value, comment))
        hit += 1
    else:
        out.append(ln)

if hit != 2:
    print('命中行数异常:', hit, '-> 不写回')
    sys.exit(1)

with open(cfg, 'w', encoding='utf-8') as f:
    f.writelines(out)
print('已写回', cfg, '长度', sum(len(x) for x in lines), '->', sum(len(x) for x in out))
for ln in out:
    if ln.split() and ln.split()[0] in keys:
        print(' ', ln.rstrip())
