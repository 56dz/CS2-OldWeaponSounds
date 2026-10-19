#!/usr/bin/env python3
"""诊断单个 wav / vsnd_c：尺寸、RIFF 结构、PCM 特征、时长。
用法: diag_pair.py <csgo_dir> <cs2_dir> <wav内部路径> <vsnd内部路径>
"""
import sys, os, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vpk import VPK
import glob

def fmt_of(wav):
    if len(wav) < 12 or wav[:4] != b'RIFF':
        return None
    off = 12
    while off + 8 <= len(wav):
        cid = wav[off:off+4]; sz, = struct.unpack_from('<I', wav, off+4)
        if cid == b'fmt ':
            tag, ch, sr, br, ba, bits = struct.unpack_from('<HHIIHH', wav, off+8)
            return dict(tag=tag, ch=ch, sr=sr, bits=bits, byterate=br, align=ba)
        off += 8 + sz + (sz & 1)
    return None

def main():
    go_dir, cs2_dir, wavp, vsndp = sys.argv[1:5]
    gv = VPK(glob.glob(os.path.join(go_dir, 'pak01_dir.vpk'))[0])
    cv = VPK(glob.glob(os.path.join(cs2_dir, 'pak01_dir.vpk'))[0])
    wav = gv.read(wavp)
    vs = cv.read(vsndp)
    print('WAV  %s  %d B  fmt=%s' % (wavp, len(wav), fmt_of(wav)))
    # data chunk 大小
    off = 12
    dlen = None
    while off + 8 <= len(wav):
        cid = wav[off:off+4]; sz, = struct.unpack_from('<I', wav, off+4)
        if cid == b'data':
            dlen = sz; break
        off += 8 + sz + (sz & 1)
    print('     data chunk = %s B' % dlen)
    print('VSND %s  %d B' % (vsndp, len(vs)))
    f = fmt_of(wav)
    if f and dlen:
        print('     时长 %.3f s' % (dlen / f['byterate']))
    # vsnd 里有多少 wav 头
    print('     vsnd 中 b"RIFF" 次数 = %d' % vs.count(b'RIFF'))
    print('     vsnd 中 b"fmt " 次数 = %d' % vs.count(b'fmt '))
    print('     vsnd 中 b"data" 次数 = %d' % vs.count(b'data'))
    print('     vsnd 唯一字节数 = %d' % len(set(vs)))
    # 直接找 wav data 尾部 32 字节
    if dlen:
        tail = wav[off+8:dlen or 0]
    dw = None
    off2 = 12
    while off2 + 8 <= len(wav):
        cid = wav[off2:off2+4]; sz, = struct.unpack_from('<I', wav, off2+4)
        if cid == b'data':
            dw = wav[off2+8:off2+8+sz]; break
        off2 += 8 + sz + (sz & 1)
    if dw:
        print('     wav data 前48字节:', dw[:48].hex())
        idx = vs.find(dw[:2048])
        print('     vsnd 中 dw[0:2048] 偏移 =', idx)
        idx2 = vs.find(dw[len(dw)//2:len(dw)//2+2048])
        print('     vsnd 中 dw[mid:mid+2048] 偏移 =', idx2)
        # 找 vsnd 中 PCM 起点的近似
        for probe_len in (512, 256, 128, 64):
            i = vs.find(dw[1024:1024+probe_len])
            if i >= 0:
                print('     probe len=%d -> 偏移 %d (减去 1024 = %d)' % (probe_len, i, i-1024))
                break

main()
