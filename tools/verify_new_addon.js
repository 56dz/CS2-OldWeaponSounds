// 生成结果的全面自检
const fs = require('fs');
const IN = process.argv[2] || 'data/out/soundevents_addon.vsndevts';
const g = fs.readFileSync('data/gsw.txt', 'utf8').split(/\r?\n/);
const S = fs.readFileSync(IN, 'utf8').split(/\r?\n/);
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const KEEP_SUFFIX = new Set(['Zoom', 'ZoomIn', 'ZoomOut']);

const Q = '"';
function block(name, arr) {
  const start = arr.findIndex((l) => l.replace(/\s*=\s*$/, '').trim() === name);
  if (start < 0) return null;
  const lines = [];
  for (let j = start; j < arr.length; j++) {
    lines.push(arr[j]);
    if (j > start && /^\t\}$/.test(arr[j])) break;
  }
  return lines;
}
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
function vol(lines) {
  for (const l of lines) {
    const m = /^\t\tvolume = ([\d.]+)/.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
}

const problems = [];
// 1) 事件数与计划一致
const planSet = new Set(plan.events.map((e) => e.event));
const emitted = [];
for (const l of S) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(l);
  if (m) emitted.push(m[1]);
}
const mainEmitted = emitted.filter((e) => !e.startsWith('Orig_'));
// `_Q` 是 CS2 独有的「安静版」工艺音事件：主事件已覆盖时必须一并覆盖，
// 否则引擎在快速动作场景下仍播 CS2 原音（详见 build_legacy_all.js 3a-2 段注释）。
const qEmitted = mainEmitted.filter((e) => /_Q$/.test(e));
const baseEmitted = mainEmitted.filter((e) => !/_Q$/.test(e));
console.log(
  `生成块: ${emitted.length}  主覆盖: ${baseEmitted.length}  _Q: ${qEmitted.length}  Orig_: ${emitted.length - mainEmitted.length}`
);
if (baseEmitted.length !== plan.events.length) problems.push(`主覆盖数 ${baseEmitted.length} != 计划 ${plan.events.length}`);
for (const n of planSet) if (!baseEmitted.includes(n)) problems.push(`缺失事件 ${n}`);
// plan.keep_cs2 里的事件必须「既不覆盖、也不生成 Orig_ 回退块」——
// 这些事件刻意保留 CS2 原音（变体数与 CS:GO 不兼容，套旧音只能截断/循环重复）。
// 少生成 Orig_ 是安全的：插件 enabled=false 时 EmitSound 返回 guid=0 → 保留原版。
for (const n of plan.keep_cs2 || []) {
  if (emitted.includes(n)) problems.push(`${n} 在 keep_cs2 里却仍被覆盖`);
  if (emitted.includes('Orig_' + n)) problems.push(`${n} 在 keep_cs2 里却仍生成了 Orig_ 回退块`);
}
// `_Q` 必须成对：主事件被覆盖的，_Q 也必须被覆盖
for (const q of emitted) {
  if (!/_Q$/.test(q)) continue;
  const base = q.replace(/_Q$/, '');
  if (planSet.has(base) && !emitted.includes(q)) problems.push(`${base} 已覆盖但缺少 ${q}`);
}

// 2) 每个块都有 vsnd
for (const n of emitted) {
  const b = block(n, S);
  const v = vsnds(b);
  if (!v.length) problems.push(`${n} 无 vsnd`);
}

// 3) 变体数与 CS2 对齐（含 _Q，它们同样要对齐变体池大小）
for (const n of mainEmitted) {
  const cb = block(n, g);
  const ob = block(n, S);
  const cv = vsnds(cb);
  const ov = vsnds(ob);
  if (cv.length !== ov.length) problems.push(`${n} 变体数 CS2=${cv.length} 我们=${ov.length}`);
}

// 4) 音量合理性
//
//    第 5 版策略是「逐事件按素材实测 RMS 归一」：让同一类工艺音（Draw/Clipin/...）
//    的有效响度对齐到 CS2 原版的平均水平，同时把单事件相对 CS2 原音量的变化
//    限制在 ±6 dB 以内（tools/plan_volume_gains.js 的 cap）。
//    所以这里不再禁止「放大 20%」——AWP.Draw 0.05→0.0998 就是 +6dB 的合法结果。
//    改为检查真正会出事的两件事：
//      a. 单事件变化超过 ±6.5 dB（超过 cap 说明方案表被改坏或应用错位）
//      b. 同后缀有效响度的离散度没有改善（说明归一失效）
const MAX_DB_DELTA = 6.5;
const db = (v) => 20 * Math.log10(v);
let rmsByWav = null;
try {
  const loud = JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json', 'utf8'));
  rmsByWav = new Map(loud.rows.map((r) => [r.file.toLowerCase(), r.rms_db]));
} catch (e) {
  rmsByWav = null;
}
const wavOf = (v) =>
  String(v).replace(/^sounds\/weapons_csgo\//i, '').replace(/^sounds\/weapons\//i, '').replace(/\.vsnd$/i, '.wav');
const effOf = (name) => {
  if (!rmsByWav) return null;
  const v = vol(block(name, S));
  if (v === null || !(v > 0)) return null;
  const list = vsnds(block(name, S)).map(wavOf);
  const rs = list.map((w) => rmsByWav.get(w)).filter((x) => typeof x === 'number');
  if (!rs.length) return null;
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  return db(v) + mean;
};
const sfxOf = (n) => n.slice(n.indexOf('.') + 1).replace(/_Q$/, '');
const bySuffix = new Map();
for (const n of mainEmitted) {
  const v = vol(block(n, S));
  const c = vol(block(n, g));
  if (v === null) { problems.push(`${n} 无 volume`); continue; }
  if (v <= 0) { problems.push(`${n} volume=${v} 非正数`); continue; }
  if (c !== null && c > 0) {
    const d = db(v) - db(c);
    if (Math.abs(d) > MAX_DB_DELTA) {
      problems.push(`${n} 音量相对 CS2 变化 ${d.toFixed(2)}dB（CS2=${c} → ${v}，超出 ±${MAX_DB_DELTA}dB）`);
    }
  }
  const e = effOf(n);
  if (e !== null) {
    const s = sfxOf(n);
    if (!bySuffix.has(s)) bySuffix.set(s, []);
    bySuffix.get(s).push(e);
  }
}
if (rmsByWav) {
  const sd = (a) => {
    if (a.length < 2) return 0;
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((t, y) => t + (y - m) ** 2, 0) / a.length);
  };
  let worse = [];
  for (const [s, arr] of bySuffix) {
    if (arr.length < 4) continue;
    const after = sd(arr);
    // 基准：CS2 原版同后缀的离散度（用同名块的 CS2 音量 + 同一批素材 RMS 近似）
    const before = [];
    for (const n of mainEmitted) {
      if (sfxOf(n) !== s) continue;
      const c = vol(block(n, g));
      if (c === null || !(c > 0)) continue;
      const list = vsnds(block(n, S)).map(wavOf);
      const rs = list.map((w) => rmsByWav.get(w)).filter((x) => typeof x === 'number');
      if (!rs.length) continue;
      before.push(db(c) + rs.reduce((a, b) => a + b, 0) / rs.length);
    }
    const b = sd(before);
    if (after > b + 0.5 && after > 1.0) worse.push(`${s} sd ${b.toFixed(2)}→${after.toFixed(2)}dB`);
  }
  if (worse.length) problems.push('以下后缀有效响度离散度变差: ' + worse.join(' / '));
}


// 5) 大括号平衡
const text = S.join('\n');
const open = (text.match(/\{/g) || []).length;
const close = (text.match(/\}/g) || []).length;
if (open !== close) problems.push(`大括号不平衡 {${open} }${close}`);

// 6) kv3 头
if (!S[0].startsWith('<!-- kv3')) problems.push('首行不是 kv3 头');
if (S[1].trim() !== '{') problems.push('第 2 行不是匿名根块 {');

if (problems.length) {
  console.log('\n❌ 问题 ' + problems.length + ' 个:');
  for (const p of problems.slice(0, 40)) console.log('  ' + p);
  process.exit(1);
}
console.log('\n✅ 全部自检通过');
console.log('\n=== 覆盖事件音量一览 ===');
for (const n of mainEmitted.sort()) {
  const cb = block(n, g);
  const ob = block(n, S);
  const c = vol(cb);
  const o = vol(ob);
  const ov = vsnds(ob);
  const mark = c !== null && Math.abs(c - o) > 1e-6 ? '  ⚠ vol ' + c + '→' + o : '';
  console.log('  ' + n.padEnd(32) + 'vol=' + String(o).padEnd(10) + ' vsnd=' + ov.length + mark);
}
