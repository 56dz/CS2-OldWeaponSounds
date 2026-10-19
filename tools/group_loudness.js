// 按事件后缀分类统计 CS:GO 素材响度，得出各类事件的典型补偿需求
'use strict';
const fs = require('fs');
const path = require('path');

function wavPcm(buf) {
  let j = 0;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') { j = buf.indexOf('RIFF'); if (j < 0) return null; buf = buf.subarray(j); }
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(body + 2), sr: buf.readUInt32LE(body + 4) };
    else if (id === 'data') { data = buf.subarray(body, Math.min(body + size, buf.length)); break; }
    off = body + size + (size & 1);
  }
  return data && fmt ? { fmt, data } : null;
}
function rms(data) {
  const n = Math.floor(data.length / 2);
  let s = 0;
  for (let i = 0; i < n; i++) { const v = data.readInt16LE(i * 2) / 32768; s += v * v; }
  return Math.sqrt(s / Math.max(n, 1));
}

const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const wavRoot = process.argv[3];
const outPath = process.argv[4];

const rows = [];
for (const e of plan.events) {
  const p = path.join(wavRoot, e.wavs[0]);
  if (!fs.existsSync(p)) continue;
  const w = wavPcm(fs.readFileSync(p));
  if (!w) continue;
  const r = rms(w.data);
  const db = 20 * Math.log10(r || 1e-9);
  const suffix = e.event.includes('.') ? e.event.split('.').slice(1).join('.') : e.event;
  // 归一化后缀：去掉 _Q
  const base = suffix.replace(/_Q$/, '');
  rows.push({ event: e.event, suffix, base, wav: e.wavs[0], db: +db.toFixed(1), rms: +r.toFixed(4), dur: +(w.data.length / 2 / w.fmt.ch / w.fmt.sr).toFixed(3) });
}

// 按 base 后缀分组
const groups = {};
for (const r of rows) (groups[r.base] = groups[r.base] || []).push(r);

const summary = [];
for (const [k, v] of Object.entries(groups)) {
  const dbs = v.map((x) => x.db);
  const avg = dbs.reduce((a, b) => a + b, 0) / dbs.length;
  summary.push({ suffix: k, count: v.length, avg_db: +avg.toFixed(1), min_db: Math.min(...dbs), max_db: Math.max(...dbs) });
}
summary.sort((a, b) => a.avg_db - b.avg_db);

console.log('=== 按事件后缀的平均素材响度（从轻到重）===');
for (const s of summary) {
  console.log(`${s.suffix.padEnd(26)} n=${String(s.count).padStart(3)}  平均 ${String(s.avg_db).padStart(7)} dB  范围 ${String(s.min_db).padStart(6)} ~ ${String(s.max_db).padStart(6)} dB`);
}

fs.writeFileSync(outPath, JSON.stringify({ rows, summary }, null, 1));
console.log(`\n写出 → ${outPath}  (${rows.length} 条，${summary.length} 类)`);
