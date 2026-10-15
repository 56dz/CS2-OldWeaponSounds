#!/usr/bin/env python3
"""
把工坊物品 3819972417 的安装登记条目，以正确的缩进/嵌套插入服务器的 appworkshop_730.acf。
MM（MultiAddonManager）判断"是否已安装"读的就是这个文件，插入正确即可被识别。

用法: python3 add_acf_item.py <acf路径> [--revert]
"""
import sys, os, shutil, time, re

ITEM    = "3819972417"
SIZE    = "486250909"
TIMEUP  = "1792025511"
MANIFEST= "3170819672793989286"

path = sys.argv[1]
revert = "--revert" in sys.argv

if revert:
    baks = sorted([f for f in os.listdir(os.path.dirname(path)) if f.startswith(os.path.basename(path) + ".bak-")])
    if not baks:
        print("没有可用备份"); sys.exit(1)
    src = os.path.join(os.path.dirname(path), baks[-1])
    shutil.copy2(src, path)
    print("已还原:", baks[-1]); sys.exit(0)

text = open(path, encoding="utf-8", errors="replace").read()

# 幂等
if re.search(r'^\s*"%s"\s*$' % ITEM, text, re.M):
    print("已存在，无需插入"); sys.exit(0)

# 定位 WorkshopItemsInstalled 节，找它的闭合花括号
si = text.find('"WorkshopItemsInstalled"')
if si < 0:
    print("找不到 WorkshopItemsInstalled"); sys.exit(1)
j = text.find("{", si)
depth = 0
k = j
while k < len(text):
    if text[k] == "{": depth += 1
    elif text[k] == "}":
        depth -= 1
        if depth == 0: break
    k += 1
close = k  # WorkshopItemsInstalled 的闭合花括号位置

block = (
    '\t\t"%s"\n'
    '\t\t{\n'
    '\t\t\t"size"\t\t"%s"\n'
    '\t\t\t"timeupdated"\t\t"%s"\n'
    '\t\t\t"timetouched"\t\t"%s"\n'
    '\t\t\t"manifest"\t\t"%s"\n'
    '\t\t\t"latest_timeupdated"\t\t"%s"\n'
    '\t\t\t"latest_manifest"\t\t"%s"\n'
    '\t\t}\n'
) % (ITEM, SIZE, TIMEUP, TIMEUP, MANIFEST, TIMEUP, MANIFEST)

new = text[:close] + block + text[close:]

# 花括号配对校验
d = 0; mn = 0
for c in new:
    if c == "{": d += 1
    elif c == "}":
        d -= 1
        if d < mn: mn = d
if d != 0 or mn < 0:
    print("❌ 括号校验失败，未写入 (depth=%d min=%d)" % (d, mn)); sys.exit(1)

bak = "%s.bak-%s" % (path, time.strftime("%H%M%S"))
shutil.copy2(path, bak)
open(path, "w", encoding="utf-8").write(new)

ok = len(re.findall(r'"%s"' % ITEM, new))
print("✅ 已插入，备份:", os.path.basename(bak))
print("   括号: depth=%d min=%d" % (d, mn))
print("   条目出现次数:", ok)
