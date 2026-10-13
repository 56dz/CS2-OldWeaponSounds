#!/usr/bin/env python3
"""比对 CS:GO 的 .wav 与 CS2 的 .vsnd_c，判断是否同一音频数据"""
import binascii
import struct
import sys

wav_path = sys.argv[1] if len(sys.argv) > 1 else '/home/zhz/wpn/work/csgo_ak47-1.wav'
vsnd_path = sys.argv[2] if len(sys.argv) > 2 else '/home/zhz/wpn/work/cs2_ak47-1.vsnd_c'

wav = open(wav_path, 'rb').read()
vsnd = open(vsnd_path, 'rb').read()

print('=== WAV 解析 ===')
print('文件大小:', len(wav), '  头部:', wav[:4])
pos = 12
fmt = None
data = None
while pos + 8 <= len(wav):
    cid = wav[pos:pos + 4]
    sz = struct.unpack_from('<I', wav, pos + 4)[0]
    body = wav[pos + 8:pos + 8 + sz]
    if cid == b'fmt ':
        fmt = body
    elif cid == b'data':
        data = body
    pos += 8 + sz + (sz & 1)

if fmt:
    af, ch, rate, br, ba, bits = struct.unpack_from('<HHIIHH', fmt, 0)
    print('  audio_format=%d channels=%d sample_rate=%d bits=%d' % (af, ch, rate, bits))
    print('  fmt chunk hex:', binascii.hexlify(fmt[:20]).decode())
print('  data 块大小:', len(data) if data else None, ' 总时长约: %.3fs' % (len(data) / (rate * ch * bits / 8)) if data and fmt else '')

print()
print('=== VSND_C 解析 ===')
print('文件大小:', len(vsnd))
print('前 96 字节:')
print(binascii.hexlify(vsnd[:96]).decode())

# 在 vsnd 中查找 wav 的 PCM 数据
if data:
    print()
    print('=== 数据比对 ===')
    for probe, label in ((data, '完整 data 块'), (data[:2048], 'data 前 2048 字节'), (data[1000:3000], 'data 中段 2000 字节')):
        idx = vsnd.find(probe)
        print('  %-18s 在 vsnd 中的偏移: %s' % (label, idx))

    # 逐字节统计：假设 vsnd 中某偏移开始就是 PCM
    idx = vsnd.find(data[:2048])
    if idx > 0:
        print()
        print('  推测 vsnd 头部长度 = %d 字节' % idx)
        print('  vsnd 头部 hex:', binascii.hexlify(vsnd[:idx]).decode())
        tail = vsnd[idx:]
        print('  对齐后长度: vsnd=%d  wav_data=%d  差值=%d' % (len(tail), len(data), len(tail) - len(data)))
        same = sum(1 for a, b in zip(tail, data) if a == b)
        print('  相同字节数 %d / %d' % (same, len(data)))
