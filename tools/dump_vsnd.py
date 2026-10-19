#!/usr/bin/env python3
"""打印 vsnd_c / wav 的头部 hexdump 与结构分析。
用法: dump_vsnd.py <cs2_dir> <内部路径> [字节数]
"""
import sys, os, struct, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vpk import VPK


def find_data(buf):
    """在 vsnd 里定位疑似 PCM 区段：找 8k~64k 个连续非零且分布均匀的区段"""
    return None


def main():
    cs2_dir, inner = sys.argv[1], sys.argv[2]
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 256
    try:
        v = VPK(glob.glob(os.path.join(cs2_dir, 'pak01_dir.vpk'))[0])
        buf = v.read(inner)
    except Exception:
        with open(inner, 'rb') as f:
            buf = f.read()
    print('%s  %d B' % (inner, len(buf)))
    print('--- 前 %d 字节 ---' % n)
    for i in range(0, min(n, len(buf)), 16):
        chunk = buf[i:i + 16]
        hx = ' '.join('%02x' % b for b in chunk)
        asc = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
        print('%08x  %-47s  %s' % (i, hx, asc))
    # 找 ascii 串
    print('--- 可打印串 (>=4) ---')
    cur = b''
    cnt = 0
    for b in buf:
        if 32 <= b < 127:
            cur += bytes([b])
        else:
            if len(cur) >= 4:
                print('  @%d %s' % (cnt - len(cur), cur.decode()))
                cur = b''
            cur = b''
        cnt += 1
    if len(cur) >= 4:
        print('  @%d %s' % (cnt - len(cur), cur.decode()))


main()
