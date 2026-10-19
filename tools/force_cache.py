#!/usr/bin/env python3
"""Force-place a locally published workshop VPK into a Steam workshop cache,
and rewrite the acf manifest so Steam considers it up to date.

Usage:
  python3 force_cache.py <src_dir_with_vpks> <dst_cache_dir> <acf_path> <manifest> <timeupdated>

Steam keeps serving the *approved* build until a new submission passes review.
To test immediately we drop the freshly published files straight into the cache
and patch appworkshop_730.acf's manifest/timeupdated/size for that item.
"""
import os
import re
import shutil
import sys


def human(n):
    return f"{n:,}"


def main():
    if len(sys.argv) != 6:
        print(__doc__)
        return 2
    src, dst, acf, manifest, timeupdated = sys.argv[1:6]
    wid = os.path.basename(dst.rstrip("/"))

    names = sorted(
        f for f in os.listdir(src)
        if f.endswith(".vpk") or f == "publish_data.txt"
    )
    if not names:
        print(f"[ERR] no vpk/publish_data in {src}")
        return 3

    os.makedirs(dst, exist_ok=True)
    total = 0
    for n in names:
        s = os.path.join(src, n)
        d = os.path.join(dst, n)
        shutil.copy2(s, d)
        sz = os.path.getsize(d)
        total += sz
        print(f"[copy] {n} -> {d} ({human(sz)} B)")

    # patch acf
    if not os.path.exists(acf):
        print(f"[WARN] acf not found: {acf}")
        return 0
    with open(acf, "r", encoding="utf-8", errors="surrogateescape") as f:
        text = f.read()

    if f'"{wid}"' not in text:
        print(f"[WARN] item {wid} not present in acf, skip patch")
        return 0

    # Replace every manifest line that belongs to this item's blocks.
    lines = text.split("\n")
    idx = [i for i, l in enumerate(lines) if l.strip() == f'"{wid}"']
    changed = 0
    for i in idx:
        # walk forward until block closes (a line that is exactly "\t\t}")
        j = i + 1
        if j >= len(lines) or lines[j].strip() != "{":
            continue
        j += 1
        while j < len(lines) and lines[j].strip() != "}":
            m = re.match(r'^(\s*)"(manifest|latest_manifest|size|timeupdated|latest_timeupdated)"(\s+)"(.*)"\s*$', lines[j])
            if m:
                key = m.group(2)
                if key in ("manifest", "latest_manifest"):
                    newval = manifest
                elif key in ("timeupdated", "latest_timeupdated"):
                    newval = timeupdated
                elif key == "size":
                    newval = str(total)
                else:
                    j += 1
                    continue
                nm = f'{m.group(1)}"{key}"{m.group(3)}"{newval}"'
                if nm != lines[j]:
                    lines[j] = nm
                    changed += 1
                    print(f"[acf] line {j+1}: {key} -> {newval}")
            j += 1

    out = "\n".join(lines)
    if out == text:
        print("[acf] no change needed")
        return 0
    bak = acf + ".bak-force-" + str(int(os.path.getmtime(acf)))
    shutil.copy2(acf, bak)
    with open(acf, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(out)
    print(f"[acf] backup {bak}")
    print(f"[acf] wrote {changed} field(s), size={total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
