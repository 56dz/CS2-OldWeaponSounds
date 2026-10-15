#!/usr/bin/env python3
"""
把工坊物品的"安装登记"写进服务器的 appworkshop_730.acf。
MultiAddonManager 判断 addon "是否已安装"读的就是这个文件（实测：写坏它会让所有 addon 都变 not installed）。

支持 upsert：物品已存在时，用最新值**覆盖**（工坊物品 ID 不变但内容更新时，manifest 必须更新，
否则服务器会继续认为旧缓存有效）。

用法:
  # 从 steamcmd 下载后的 acf 读取最新 size/timeupdated/manifest 并写入服务器 acf（推荐）
  python3 acf_upsert.py <服务器acf> --from <steamcmd的acf> [--id 3819972417]

  # 手工指定值
  python3 acf_upsert.py <服务器acf> --id 3819972417 --size ... --timeupdated ... --manifest ...

  # 还原最早的备份
  python3 acf_upsert.py <服务器acf> --revert
"""
import sys, os, shutil, time, re

# ---- 参数 ----
args = sys.argv[1:]
if not args:
    print(__doc__); sys.exit(1)
path = args[0]
opts = {}
i = 1
while i < len(args):
    a = args[i]
    if a.startswith("--"):
        key = a[2:]
        if key == "revert":
            opts[key] = True; i += 1
        else:
            opts[key] = args[i + 1] if i + 1 < len(args) else ""; i += 2
    else:
        i += 1

ITEM = opts.get("id", "3819972417")

# ---- revert ----
if opts.get("revert"):
    d, b = os.path.dirname(path), os.path.basename(path)
    baks = sorted(f for f in os.listdir(d) if f.startswith(b + ".bak-"))
    if not baks:
        print("没有可用备份"); sys.exit(1)
    shutil.copy2(os.path.join(d, baks[0]), path)   # 最早的备份 = 最初状态
    print("已还原:", baks[0]); sys.exit(0)

# ---- 取值：优先从 steamcmd 的 acf 读 ----
size = opts.get("size"); timeup = opts.get("timeupdated"); manifest = opts.get("manifest")
if opts.get("from"):
    src = open(opts["from"], encoding="utf-8", errors="replace").read()
    m = re.search(r'"%s"\s*\{(.*?)\}' % re.escape(ITEM), src, re.S)
    if not m:
        print("在 %s 里找不到物品 %s" % (opts["from"], ITEM)); sys.exit(1)
    body = m.group(1)
    def g(k):
        mm = re.search(r'"%s"\s*"([^"]*)"' % k, body)
        return mm.group(1) if mm else None
    size = g("size") or size
    timeup = g("timeupdated") or g("latest_timeupdated") or timeup
    manifest = g("manifest") or g("latest_manifest") or manifest
    print("从 steamcmd acf 读取: size=%s timeupdated=%s manifest=%s" % (size, timeup, manifest))

if not manifest:
    print("缺少 manifest，无法写入"); sys.exit(1)
size = size or "0"
timeup = timeup or str(int(time.time()))

text = open(path, encoding="utf-8", errors="replace").read()

def find_section(t, name):
    si = t.find('"%s"' % name)
    if si < 0: return None
    j = t.find("{", si); d = 0; k = j
    while k < len(t):
        if t[k] == "{": d += 1
        elif t[k] == "}":
            d -= 1
            if d == 0: return (j, k)
        k += 1
    return None

inst = find_section(text, "WorkshopItemsInstalled")
if not inst:
    print("找不到 WorkshopItemsInstalled"); sys.exit(1)

# 删除旧条目（若存在）—— 用括号配对定位，兼容任意缩进/换行
def remove_item(t, item):
    """删除所有 `"<item>" { ... }` 块，返回 (新文本, 删除个数)"""
    removed = 0
    while True:
        m = re.search(r'^([ \t]*)"%s"\s*$' % re.escape(item), t, re.M)
        if not m:
            break
        start = m.start()
        # 找到该 key 之后的第一个 {
        j = t.find("{", m.end())
        if j < 0:
            break
        d = 0
        k = j
        while k < len(t):
            if t[k] == "{": d += 1
            elif t[k] == "}":
                d -= 1
                if d == 0: break
            k += 1
        # 连同前导换行一起删掉
        s = start
        if s > 0 and t[s - 1] == "\n":
            s -= 1
        t = t[:s] + t[k + 1:]
        removed += 1
    return t, removed

text, n_removed = remove_item(text, ITEM)
existed = n_removed > 0
if existed:
    print("已移除旧条目 %d 个，将用新值覆盖" % n_removed)

block = (
    '\n\t\t"%s"\n'
    '\t\t{\n'
    '\t\t\t"size"\t\t"%s"\n'
    '\t\t\t"timeupdated"\t\t"%s"\n'
    '\t\t\t"timetouched"\t\t"%s"\n'
    '\t\t\t"manifest"\t\t"%s"\n'
    '\t\t\t"latest_timeupdated"\t\t"%s"\n'
    '\t\t\t"latest_manifest"\t\t"%s"\n'
    '\t\t}'
) % (ITEM, size, timeup, timeup, manifest, timeup, manifest)

# 重新定位插入点（删除后位置会变）
inst = find_section(text, "WorkshopItemsInstalled")
new = text[:inst[1]] + block + text[inst[1]:]

# 括号校验
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

print("✅ 已写入（%s）  备份: %s" % ("覆盖" if existed else "新增", os.path.basename(bak)))
print("   括号: depth=%d min=%d   条目数: %d" % (d, mn, len(re.findall(r'"%s"' % ITEM, new))))
