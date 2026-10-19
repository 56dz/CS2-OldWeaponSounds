// 对比 CS:GO wav 与 CS2 原版 vsnd_c 的实际响度（RMS / 峰值）
// vsnd_c 内部是 PCM 直存（wav + 头尾元数据），可直接找 int16 数据段估算
const fs = require('fs');
const path = require('path');

function readWav(buf) {
  if (buf.length < 12) return null;
  let off = 12, fmt = null, data = null;
  // 兼容前置 JUNK 块
  if (buf.toString('ascii', 0, 4) !== 'RIFF') {
    const j = buf.indexOf('RIFF');
    if (j < 0) return null;
    buf = buf.subarray(j);
  }
  off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(body + 2), sr: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    else if (id === 'data') data = buf.subarray(body, Math.min(body + size, buf.length));
    off = body + size + (size & 1);
  }
  return fmt && data ? { fmt, data } : null;
}

function rms(buf) {
  const w = readWav(buf);
  if (!w) return null;
  const n = Math.floor(w.data.length / 2);
  let sum = 0, peak = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const s = w.data.readInt16LE(i * 2) / 32768;
    sum += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    if (a > 0.001) nz++;
  }
  const r = Math.sqrt(sum / n);
  return {
    dur: (n / w.fmt.ch / w.fmt.sr).toFixed(3),
    rms: r.toFixed(4),
    peak: peak.toFixed(3),
    dbfs: (20 * Math.log10(r || 1e-9)).toFixed(1),
    peakDb: (20 * Math.log10(peak || 1e-9)).toFixed(1),
    activeRatio: (nz / n).toFixed(2),
  };
}

const args = process.argv.slice(2);
for (const f of args) {
  const b = fs.readFileSync(f);
  const r = rms(b);
  const name = path.basename(f);
  if (!r) { console.log(name.padEnd(42), 'BAD/非PCM'); continue; }
  console.log(`${name.padEnd(42)} 时长=${r.dur}s RMS=${r.rms}(${r.dbfs}dB) 峰值=${r.peak}(${r.peakDb}dB) 有声占比=${r.activeRatio}`);
}
