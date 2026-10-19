// 量出 477 个 wav 的真实时长，并与 vsndevts 里声明的 vsnd_duration 对比
//
// 用法: node tools/check_duration_mismatch.js [vsndevts路径] [wav目录]
//
// 注意：一个事件的 vsnd 是**随机池**，声明时长必须覆盖池里最长的那个，
// 否则随机到长音时会被截断。所以这里对每个事件取所有 vsnd 的**最大**时长比对，
// 与 build_legacy_all.js 里 vsndDuration() 的取法保持一致。
const fs = require('fs');
const path = require('path');

const CS2 = 'D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive';
const VSDNEVTS = process.argv[2] || 'data/out/soundevents_addon.vsndevts';
const WAVDIR = process.argv[3] || 'data/csgo_ref/wavout';

// ---- wav 时长解析（跳过任意顺序的块） ----
function wavDuration(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    return null;
  }
  if (buf.length < 12) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let byteRate = 0;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      byteRate = buf.readUInt32LE(body + 8);
    } else if (id === 'data') {
      dataLen = Math.min(sz, buf.length - body);
      break;
    }
    off = body + sz + (sz % 2);
  }
  if (!byteRate || !dataLen) return null;
  return dataLen / byteRate;
}

const cache = new Map();
function durOfWav(file) {
  if (cache.has(file)) return cache.get(file);
  const d = wavDuration(file);
  cache.set(file, d);
  return d;
}

// ---- 解析 vsndevts：事件 -> {dur, vsnds} ----
const txt = fs.readFileSync(VSDNEVTS, 'utf8');
const lines = txt.split('\n');
const events = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(lines[i]);
  if (!m) continue;
  const name = m[1];
  let j = i + 1;
  while (j < lines.length && lines[j] !== '\t}') j++;
  const body = lines.slice(i + 1, j).join('\n');
  const dm = /^\t\tvsnd_duration\s*=\s*([0-9.]+)/m.exec(body);
  const vsnds = [...body.matchAll(/"([^"]*\.vsnd)"/g)].map((x) => x[1]);
  if (vsnds.length) events.set(name, { dur: dm ? Number(dm[1]) : null, vsnds });
  i = j;
}

// vsnd 路径 -> 本地 wav 路径
function wavPathOf(vsnd) {
  const rel = vsnd
    .replace(/^\/+/, '')
    .replace(/^sounds\//, '')
    .replace(/\.vsnd$/, '.wav');
  const cands = [
    path.join(WAVDIR, rel.replace(/^weapons_csgo\/?/, 'weapons/')),
    path.join(WAVDIR, rel),
    path.join(WAVDIR, 'weapons', rel),
  ];
  for (const c of cands) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const rows = [];
let ok = 0;
let bad = 0;
let noData = 0;
for (const [name, ev] of events) {
  let realMax = null;
  let bottleneck = null;
  let anyData = false;
  for (const v of ev.vsnds) {
    const wp = wavPathOf(v);
    if (!wp) continue;
    const d = durOfWav(wp);
    if (d === null) continue;
    anyData = true;
    if (realMax === null || d > realMax) { realMax = d; bottleneck = wp; }
  }
  if (!anyData) {
    // 允许 62 个「无法测量」：这些 vsnd 指向 CS2 客户端内置音，本地没有 wav
    noData++;
    continue;
  }
  const delta = ev.dur === null ? null : realMax - ev.dur;
  if (delta !== null && Math.abs(delta) <= 0.02) ok++;
  else {
    bad++;
    rows.push({ event: name, real: +realMax.toFixed(6), decl: ev.dur, delta: delta === null ? null : +delta.toFixed(6), wav: bottleneck });
  }
}

rows.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
console.log(`事件总数(有 vsnd): ${events.size}`);
console.log(`时长一致(|delta|<=20ms): ${ok}`);
console.log(`时长不符 >20ms: ${bad}`);
console.log(`无法测量(CS2 内置音,本地无 wav): ${noData}`);
console.log('\n=== 时长不符 TOP 40（real=wav 实际秒数, decl=vsndevts 声明） ===');
for (const r of rows.slice(0, 40)) {
  const x = r.decl ? (r.real / r.decl).toFixed(2) : 'n/a';
  console.log(`${r.event.padEnd(42)} real=${String(r.real).padEnd(9)} decl=${String(r.decl).padEnd(10)} delta=${String(r.delta).padEnd(9)} x${x} ${r.wav.replace(/\\/g, '/').replace(/^.*\/wavout\//, '')}`);
}

const outPath = 'data/csgo_ref/duration_mismatch.json';
fs.writeFileSync(outPath, JSON.stringify({ total: events.size, ok, bad, noData, rows }, null, 1));
console.log(`\n写入 ${outPath}`);
