#!/usr/bin/env node
// Measure per-wav RMS / peak level (dBFS) to see whether "volume jumps up and down"
// comes from the source material itself rather than the soundevent volume field.
const fs = require('fs');
const path = require('path');

function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = { start: body, size: Math.min(size, buf.length - body) };
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) return null;
  return { fmt, data };
}

function analyze(buf, info) {
  const { channels, rate, bits } = info.fmt;
  const start = info.data.start;
  const n = info.data.size;
  if (bits !== 16) return null;
  const samples = Math.floor(n / 2);
  const step = Math.max(1, Math.floor(samples / 400000));
  let sum = 0;
  let peak = 0;
  let count = 0;
  for (let i = 0; i < samples; i += step) {
    const v = buf.readInt16LE(start + i * 2) / 32768;
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    count += 1;
  }
  if (!count) return null;
  const r = Math.sqrt(sum / count);
  return {
    rms_db: r > 0 ? 20 * Math.log10(r) : -120,
    peak_db: peak > 0 ? 20 * Math.log10(peak) : -120,
    seconds: samples / (rate * (channels || 1)),
  };
}

function walk(d, acc) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.wav$/i.test(e.name)) acc.push(p);
  }
  return acc;
}

const dir = process.argv[2] || 'data/csgo_ref/wavout';
const out = process.argv[3] || null;
const files = walk(dir, []);
const SEP = String.fromCharCode(92);
const rows = [];
for (const f of files) {
  const rel = f.split(SEP).join('/').replace(/^.*?wavout\//, '');
  const buf = fs.readFileSync(f);
  const info = readWav(buf);
  if (!info) {
    rows.push({ file: rel, err: 'badwav' });
    continue;
  }
  const m = analyze(buf, info);
  if (!m) {
    rows.push({ file: rel, err: 'unsupported' });
    continue;
  }
  rows.push({ file: rel, ...m });
}

const ok = rows.filter((r) => !r.err).sort((a, b) => b.rms_db - a.rms_db);
console.log('files', rows.length, 'measurable', ok.length, 'skipped', rows.length - ok.length);
let mean = null;
if (ok.length) {
  const vals = ok.map((r) => r.rms_db);
  mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  console.log(
    'RMS mean ' + mean.toFixed(1) + ' dBFS  sd ' + sd.toFixed(1) +
    '  min ' + lo.toFixed(1) + '  max ' + hi.toFixed(1) +
    '  range ' + (hi - lo).toFixed(1) + ' dB',
  );
  console.log('--- loudest 15 ---');
  for (const r of ok.slice(0, 15)) {
    console.log('  ' + r.rms_db.toFixed(1).padStart(6) + ' dB  peak ' + r.peak_db.toFixed(1).padStart(6) + '  ' + r.file);
  }
  console.log('--- quietest 15 ---');
  for (const r of ok.slice(-15)) {
    console.log('  ' + r.rms_db.toFixed(1).padStart(6) + ' dB  peak ' + r.peak_db.toFixed(1).padStart(6) + '  ' + r.file);
  }
}
if (out) {
  fs.writeFileSync(out, JSON.stringify({ mean, rows }, null, 1));
  console.log('wrote ' + out);
}
