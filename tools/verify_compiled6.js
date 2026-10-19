// 校验编译产物（resourceinfo dump）：
//   1. 每个主覆盖块都带 vsnd，且路径都在 addon 私有命名空间 sounds/weapons_csgo/
//   2. Orig_ 回退块指向原版音（不在私有命名空间）
//   3. **vsnd_duration 与实际 wav 长度一致**（差 >20ms 即报错）—— 这是「切枪音效不完整」的根因
//
// 用法: node tools/verify_compiled6.js [dump路径]
const fs = require('fs');
const path = require('path');

const DUMP = process.argv[2] || 'data/out/compiled_dump7.txt';
const WAVDIR = 'data/csgo_ref/wavout';
const dump = fs.readFileSync(DUMP, 'utf8').split(/\r?\n/);
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const Q = '"';

const blocks = new Map();
for (let i = 0; i < dump.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(dump[i]);
  if (!m) continue;
  const lines = [];
  for (let j = i; j < dump.length; j++) {
    lines.push(dump[j]);
    if (j > i && /^\t\}$/.test(dump[j])) break;
  }
  blocks.set(m[1], lines);
}
console.log('dump 里的顶层块: ' + blocks.size);

function vsnds(lines) {
  const out = [];
  for (let j = 0; j < lines.length; j++) {
    const m = /vsnd_files_track_0\d+\s*=\s*(.*)$/.exec(lines[j]);
    if (!m) continue;
    const rest = m[1].trim();
    if (rest.startsWith(Q)) { out.push(rest.replace(/"/g, '')); return out; }
    let sawOpen = rest.includes('[');
    for (let k = j + 1; k < lines.length; k++) {
      const t = lines[k].trim();
      if (t === '') continue;
      if (!sawOpen) { if (t.startsWith('[')) { sawOpen = true; continue; } return out; }
      if (t.startsWith(']')) return out;
      if (t.startsWith(Q)) { out.push(t.replace(/^"/, '').replace(/"\,?$/, '')); continue; }
      return out;
    }
    return out;
  }
  return out;
}

function declaredDur(lines) {
  for (const l of lines) {
    const m = /^\t\tvsnd_duration\s*=\s*([0-9.]+)/.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
}

// ---- wav 真实时长 ----
const durCache = new Map();
function wavDuration(file) {
  if (durCache.has(file)) return durCache.get(file);
  let d = null;
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { buf = null; }
  if (buf && buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    let off = 12, byteRate = 0, dataLen = 0;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      const sz = buf.readUInt32LE(off + 4);
      const body = off + 8;
      if (id === 'fmt ') byteRate = buf.readUInt32LE(body + 8);
      else if (id === 'data') { dataLen = Math.min(sz, buf.length - body); break; }
      off = body + sz + (sz % 2);
    }
    if (byteRate > 0 && dataLen > 0) d = dataLen / byteRate;
  }
  durCache.set(file, d);
  return d;
}

/** vsnd 路径 → wavout 下的真实 wav 路径（vsndOf 剥掉了开头的 weapons/，两种都试） */
function wavPathOf(vsnd) {
  const rel = vsnd.replace(/^sounds\/weapons_csgo\//, '').replace(/\.vsnd$/, '.wav');
  for (const c of [path.join(WAVDIR, rel), path.join(WAVDIR, 'weapons', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** 该事件 vsnd 池里最长的真实时长（声明值必须覆盖它，否则随机到长音会被截断） */
function realDurOf(vsndList) {
  let max = null;
  for (const v of vsndList) {
    const p = wavPathOf(v);
    if (!p) continue;
    const d = wavDuration(p);
    if (d !== null && (max === null || d > max)) max = d;
  }
  return max;
}

const problems = [];
const expected = new Set(plan.events.map((e) => e.event));
let okCount = 0;
let durOk = 0;
const durBad = [];
for (const e of plan.events) {
  const b = blocks.get(e.event);
  if (!b) { problems.push(`编译产物缺块: ${e.event}`); continue; }
  const v = vsnds(b);
  if (!v.length) { problems.push(`${e.event} 编译后无 vsnd`); continue; }
  const bad = v.filter((p) => !p.startsWith('sounds/weapons_csgo/'));
  if (bad.length) problems.push(`${e.event} 有非私有命名空间的路径: ${bad.join(', ')}`);
  okCount++;

  const real = realDurOf(v);
  const decl = declaredDur(b);
  if (real !== null && decl !== null) {
    const delta = real - decl;
    if (Math.abs(delta) <= 0.02) durOk++;
    else durBad.push({ event: e.event, real: +real.toFixed(6), decl, delta: +delta.toFixed(6) });
  }
}

// Orig_ 块：指向原版音，并保持 CS2 原时长（不参与时长校验）
const origs = [...blocks.keys()].filter((k) => k.startsWith('Orig_'));
for (const o of origs) {
  const v = vsnds(blocks.get(o));
  if (!v.length) problems.push(`${o} 编译后无 vsnd`);
  const bad = v.filter((p) => p.startsWith('sounds/weapons_csgo/'));
  if (bad.length) problems.push(`${o} 应指向原版音却指向自定义音: ${bad.join(', ')}`);
}

console.log(`主覆盖块校验通过: ${okCount}/${plan.events.length}`);
console.log(`Orig_ 回退块: ${origs.length} 个`);
console.log(`vsnd_duration 与实际 wav 一致: ${durOk}  不符: ${durBad.length}`);
for (const d of durBad.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20)) {
  console.log(`  ${d.event.padEnd(42)} real=${d.real} decl=${d.decl} delta=${d.delta}`);
}
if (durBad.length) problems.push(`${durBad.length} 个事件 vsnd_duration 与实际 wav 长度不符`);

// `_Q` 块：CS2 独有的「安静版」工艺音。主事件已覆盖时必须一并覆盖，
// 否则引擎在快速动作场景（快速切枪/换弹）仍播 CS2 原音 —— 用户报的
// 「切枪拉栓声还是 CS2 的」就是这个漏网。校验：必须指向自定义旧音 + 时长对齐。
const qBlocks = [...blocks.keys()].filter((k) => /_Q$/.test(k) && !k.startsWith('Orig_'));
let qOk = 0;
const qBad = [];
for (const q of qBlocks) {
  const b = blocks.get(q);
  const v = vsnds(b);
  if (!v.length) { qBad.push(`${q} 无 vsnd`); continue; }
  if (!v.every((p) => p.startsWith('sounds/weapons_csgo/'))) { qBad.push(`${q} 未指向自定义旧音`); continue; }
  const real = realDurOf(v);
  if (real === null) { qBad.push(`${q} 无法测量时长`); continue; }
  const declM = /^\t\tvsnd_duration\s*=\s*([0-9.]+)/m.exec(b.join('\n'));
  const decl = declM ? Number(declM[1]) : null;
  if (decl === null || Math.abs(decl - real) > 0.02) { qBad.push(`${q} 时长不符 real=${real.toFixed(3)} decl=${decl}`); continue; }
  qOk++;
}
console.log(`_Q 安静版块: ${qOk}/${qBlocks.length} 通过`);
for (const q of qBad) problems.push(q);

const extra = [...blocks.keys()].filter((k) => !expected.has(k) && !k.startsWith('Orig_') && !/_Q$/.test(k));
if (extra.length) console.log(`其他块（可能来自元数据）: ${extra.join(', ')}`);

if (problems.length) {
  console.log('\n❌ 问题 ' + problems.length + ' 个:');
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('\n✅ 编译产物校验通过');
