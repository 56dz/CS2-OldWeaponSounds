// 对比：CS2 原版音量 vs CS:GO 音量，对 213 个覆盖事件逐条列出
const fs = require('fs');
const g = fs.readFileSync('data/gsw.txt', 'utf8').split(/\r?\n/);
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/legacy_all_plan.json', 'utf8'));
const csgo = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;

const idx = [];
for (let i = 0; i < g.length; i++) {
  const m = g[i].match(/^\t(\S[^\s=]*)\s*=\s*$/);
  if (m) idx.push({ i, n: m[1] });
}
function cs2Vol(name) {
  const e = idx.find((x) => x.n === name);
  if (!e) return null;
  for (let j = e.i + 1; j < g.length; j++) {
    if (/^\t\}$/.test(g[j])) break;
    const m = g[j].match(/^\t\tvolume = ([\d.]+)/);
    if (m) return Number(m[1]);
  }
  return null;
}
function csgoVol(name) {
  const c = csgo[name];
  if (!c || c.volume === undefined || c.volume === null) return null;
  const parts = String(c.volume)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

const rows = [];
for (const t of plan.events) {
  const a = cs2Vol(t.event);
  const b = csgoVol(t.event);
  if (a === null || b === null) continue;
  rows.push({ ev: t.event, cs2: a, csgo: b, ratio: b / a });
}
const same = rows.filter((r) => Math.abs(r.ratio - 1) < 0.02);
const close = rows.filter((r) => Math.abs(r.ratio - 1) >= 0.02 && Math.abs(r.ratio - 1) < 0.2);
const far = rows.filter((r) => Math.abs(r.ratio - 1) >= 0.2);
console.log(`可比对事件: ${rows.length}`);
console.log(`  CS2 与 CS:GO 音量一致 (<2%): ${same.length}`);
console.log(`  接近 (2%~20%): ${close.length}`);
console.log(`  差异大 (>=20%): ${far.length}`);
console.log('\n=== 差异大的（这些才需要调音量）===');
for (const r of far.sort((x, y) => y.ratio - x.ratio)) {
  console.log('  ' + r.ev.padEnd(34) + ' CS2=' + String(r.cs2).padEnd(10) + ' CS:GO=' + String(Number(r.csgo.toFixed(3))).padEnd(8) + ' 比值 ' + r.ratio.toFixed(2));
}
