// 分析 vsnd_c 的响度：vsnd_c 是 CS2 编译后的音频容器。
// 已知规律：ak47_01.wav 502,676 B → ak47_csgo_01.vsnd_c 503,858 B（+1182 B），
// 说明内部是「wav 字节 + 头尾元数据」，因此可以找 RIFF 或直接按 int16 扫描。
const fs = require('fs');

function analyze(file) {
  const buf = fs.readFileSync(file);
  // 先试标准 RIFF
  for (const off of [0, buf.indexOf('RIFF')]) {
    if (off >= 0 && buf.toString('ascii', off, off + 4) === 'RIFF') {
      return { kind: 'RIFF@' + off, ...rmsFromWav(buf.subarray(off)) };
    }
  }
  // 退化：找最长的非零 int16 连续区
  return { kind: 'raw-int16', ...rmsRaw(buf) };
}

function rmsFromWav(b) {
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4) };
    else if (id === 'data') data = b.subarray(body, Math.min(body + size, b.length));
    off = body + size + (size & 1);
  }
  if (!data) return { err: 'no data' };
  return stat(data, fmt);
}

function rmsRaw(buf) {
  // 找最长非零连续 int16 段作为 PCM 主体
  const n = Math.floor(buf.length / 2);
  let best = { start: 0, len: 0 }, cur = { start: 0, len: 0 };
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(i * 2);
    if (v !== 0) {
      if (cur.len === 0) cur.start = i;
      cur.len++;
      if (cur.len > best.len) best = { start: cur.start, len: cur.len };
    } else cur.len = 0;
  }
  const data = buf.subarray(best.start * 2, (best.start + best.len) * 2);
  return { ...stat(data, null), pcmStart: best.start * 2, pcmBytes: data.length };
}

function stat(data, fmt) {
  const n = Math.floor(data.length / 2);
  let sum = 0, peak = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const s = data.readInt16LE(i * 2) / 32768;
    sum += s * s;
    if (Math.abs(s) > peak) peak = Math.abs(s);
    if (Math.abs(s) > 0.001) nz++;
  }
  const r = Math.sqrt(sum / Math.max(n, 1));
  return {
    samples: n,
    rms: r.toFixed(4),
    dbfs: (20 * Math.log10(r || 1e-9)).toFixed(1),
    peak: peak.toFixed(3),
    activeRatio: (nz / Math.max(n, 1)).toFixed(2),
    sr: fmt ? fmt.sr : '?',
    ch: fmt ? fmt.ch : '?',
    dur: fmt ? (n / fmt.ch / fmt.sr).toFixed(3) : '?',
  };
}

for (const f of process.argv.slice(2)) {
  const r = analyze(f);
  const name = f.split(/[\\/]/).pop();
  console.log(`${name.padEnd(38)} ${JSON.stringify(r)}`);
}
