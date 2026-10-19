// 检查 wav 是否静音/损坏：解析 RIFF，跳过 JUNK/LIST 等块，算峰值与 RMS
const fs = require('fs');
const path = require('path');

function readWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    off = body + size + (size & 1);
  }
  if (!fmt || !data) return null;
  return { fmt, data };
}

function stats(w) {
  const bits = w.fmt.bitsPerSample;
  const ch = w.fmt.channels || 1;
  const sr = w.fmt.sampleRate || 1;
  if (bits !== 16) return { note: `bits=${bits}` };
  const n = Math.floor(w.data.length / 2);
  let peak = 0, sumsq = 0;
  for (let i = 0; i < n; i++) {
    const v = w.data.readInt16LE(i * 2) / 32768;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumsq += v * v;
  }
  const rms = Math.sqrt(sumsq / Math.max(1, n));
  const seconds = n / ch / sr;
  return { peak, rms, seconds, samples: n, ch, sr };
}

const root = process.argv[2];
const out = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.toLowerCase().endsWith('.wav')) {
      const buf = fs.readFileSync(p);
      const w = readWav(buf);
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (!w) { out.push({ rel, error: 'BAD_WAV', bytes: buf.length }); continue; }
      const s = stats(w);
      out.push({ rel, bytes: buf.length, ...s });
    }
  }
}
walk(root);
const silent = out.filter((o) => o.error || (o.peak !== undefined && o.peak < 0.01));
const short = out.filter((o) => o.seconds !== undefined && o.seconds < 0.02);
console.log(JSON.stringify({ total: out.length, silentCount: silent.length, shortCount: short.length, silent, short }, null, 2));
