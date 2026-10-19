#!/usr/bin/env python3
"""比对 CS:GO wav 与 CS2 vsnd_c 的 PCM 内容，判定 CS2 是否已内嵌 CS:GO 原音。

用法:
  cmp_csgo_cs2.py <request.json> <csgo VPK 目录> <cs2 VPK 目录> <out.json>

request.json: { events:[{event,cls,csgo_wavs,cs2_vsnd}], csgo_wavs:[...], cs2_vsnd:[...] }
  - csgo_wavs 里是 'sound/xxx/yyy.wav'
  - cs2_vsnd 里是 'sounds/xxx/yyy.vsnd_c'

判定:
  IDENTICAL  wav 的 PCM data 完整出现在 vsnd_c 中
  PARTIAL    vsnd_c 中能找到大部分 PCM（编码/截断差异）
  DIFFERENT  找不到 -> CS2 用了新音源
  MISSING_WAV / MISSING_VSND / BAD_WAV
"""
import json
import struct
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from vpk import VPK


def read_wav(buf):
    if len(buf) < 12 or buf[:4] != b'RIFF' or buf[8:12] != b'WAVE':
        return None
    off = 12
    fmt = None
    data = None
    while off + 8 <= len(buf):
        cid = buf[off:off + 4]
        sz, = struct.unpack_from('<I', buf, off + 4)
        body = buf[off + 8:off + 8 + sz]
        if cid == b'fmt ' and len(body) >= 16:
            fmt = struct.unpack_from('<HHIIHH', body, 0)
        elif cid == b'data':
            data = body
            break
        off += 8 + sz + (sz & 1)
    if data is None:
        return None
    return {'fmt': fmt, 'data': data}


def probes(pcm):
    """24 个等距 64 字节探针，跳过开头 2% 静音。"""
    n = len(pcm)
    if n < 4096:
        return []
    start = int(n * 0.02)
    span = n - start
    out = []
    for i in range(24):
        pos = start + (span * i) // 24
        seg = pcm[pos:pos + 64]
        if len(seg) == 64 and any(b != 0 for b in seg):
            out.append((pos, seg))
    return out


def compare(wav_buf, vsnd_buf):
    w = read_wav(wav_buf)
    if not w or not w['data']:
        return 'BAD_WAV', 0.0
    pcm = w['data']
    if len(pcm) < 4096:
        return 'BAD_WAV', 0.0
    if pcm in vsnd_buf:
        return 'IDENTICAL', 1.0
    pr = probes(pcm)
    if not pr:
        return 'BAD_WAV', 0.0
    hits = 0
    offsets = []
    for pos, seg in pr:
        idx = vsnd_buf.find(seg)
        if idx >= 0:
            hits += 1
            offsets.append(idx - pos)
    rate = hits / len(pr)
    if rate >= 0.9 and len(set(offsets)) == 1:
        return 'IDENTICAL', 1.0
    if rate >= 0.9:
        return 'PARTIAL', rate
    if hits > 0:
        return 'PARTIAL', rate
    return 'DIFFERENT', 0.0


def load_vpk(d):
    """加载目录下所有 pak01_*.vpk；返回 {小写路径: (vpk, 真实路径)}"""
    import glob
    table = {}
    dirs = sorted(glob.glob(os.path.join(d, 'pak01_dir.vpk')))
    if not dirs:
        raise SystemExit('未找到 pak01_dir.vpk: ' + d)
    v = VPK(dirs[0])
    for k in v.entries:
        table[k.lower()] = (v, k)
    return table


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        return 64
    req = json.load(open(sys.argv[1], encoding='utf-8'))
    go_dir, cs2_dir, out_path = sys.argv[2], sys.argv[3], sys.argv[4]

    print('[1/4] 加载 CS:GO VPK ...', flush=True)
    go_vpk = load_vpk(go_dir)
    print('      %d 条目' % len(go_vpk), flush=True)
    print('[2/4] 加载 CS2 VPK ...', flush=True)
    cs2_vpk = load_vpk(cs2_dir)
    print('      %d 条目' % len(cs2_vpk), flush=True)

    print('[3/4] 读取 wav ...', flush=True)
    wavs = {}
    miss_wav = []
    for p in req['csgo_wavs']:
        key = p.lower()
        if key not in go_vpk:
            miss_wav.append(p)
            continue
        v, real = go_vpk[key]
        try:
            wavs[p] = v.read(real)
        except Exception as e:  # noqa
            miss_wav.append('%s (%s)' % (p, e))
    print('      wav %d / 缺 %d' % (len(wavs), len(miss_wav)), flush=True)

    print('[4/4] 读取 vsnd_c ...', flush=True)
    vsnds = {}
    miss_vsnd = []
    for p in req['cs2_vsnd']:
        key = p.lower()
        if key not in cs2_vpk:
            miss_vsnd.append(p)
            continue
        v, real = cs2_vpk[key]
        try:
            vsnds[p] = v.read(real)
        except Exception as e:  # noqa
            miss_vsnd.append('%s (%s)' % (p, e))
    print('      vsnd %d / 缺 %d' % (len(vsnds), len(miss_vsnd)), flush=True)

    # 逐事件判定
    rows = []
    stats = {}
    for ev in req['events']:
        verdicts = []
        for w in ev['csgo_wavs']:
            if w not in wavs:
                verdicts.append(('MISSING_WAV', w, None))
                continue
            best = ('DIFFERENT', 0.0, None)
            for v in ev['cs2_vsnd']:
                if v not in vsnds:
                    continue
                r, score = compare(wavs[w], vsnds[v])
                if r == 'IDENTICAL':
                    best = (r, score, v)
                    break
                if score > best[1]:
                    best = (r, score, v)
            verdicts.append((best[0], w, best[2]))
        # 事件整体: 所有 wav 都 IDENTICAL 才算 SAME
        kinds = [v[0] for v in verdicts]
        if not kinds:
            cls = 'NO_WAV'
        elif all(k == 'IDENTICAL' for k in kinds):
            cls = 'SAME'
        elif any(k == 'IDENTICAL' for k in kinds):
            cls = 'MIXED'
        elif any(k == 'DIFFERENT' for k in kinds):
            cls = 'DIFFERENT'
        else:
            cls = kinds[0]
        stats[cls] = stats.get(cls, 0) + 1
        rows.append({
            'event': ev['event'], 'old_cls': ev['cls'], 'pcm_cls': cls,
            'details': [{'verdict': a, 'wav': b, 'vsnd': c} for a, b, c in verdicts],
        })

    result = {
        'stats': stats,
        'missing_wav': miss_wav,
        'missing_vsnd': miss_vsnd,
        'rows': rows,
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print('结果: %s' % json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
