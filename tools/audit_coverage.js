// 核对 legacy_all_plan 与 CS2 原版：①CS2 有但我们漏生成的 Draw 类 ②音量被放大的工艺音
const fs = require('fs');
const g = fs.readFileSync('data/gsw.txt', 'utf8').split(/\r?\n/);
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/legacy_all_plan.json', 'utf8'));
const csgo = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;

// 索引 CS2 块
const idx = [];
for (let i = 0; i < g.length; i++) {
  const m = g[i].match(/^\t(\S[^\s=]*)\s*=\s*$/);
  if (m) idx.push({ i, n: m[1] });
}
function cs2Info(name) {
  const e = idx.find((x) => x.n === name);
  if (!e) return null;
  const a = [];
  let vol = null;
  for (let j = e.i + 1; j < g.length; j++) {
    if (/^\t\}$/.test(g[j])) break;
    let m;
    if ((m = g[j].match(/vsnd_files_track_\d+\s*=\s*"([^"]+)"/))) a.push(m[1]);
    if ((m = g[j].match(/^\t\tvolume = ([\d.]+)/))) vol = m[1];
  }
  return { a, vol };
}

const planned = new Set(plan.events.map((e) => e.event));

// ① CS:GO 有、CS2 也有、但我们没覆盖的「工艺音」
const SUFFIX_RE = /\.(Draw|Clipin|Clipout|BoltPull|Boltpull|BoltBack|BoltForward|Boltrelease|Sliderelease|Slideback|Slideback2|Sliderelease_Q|Slideback_Q|Insertshell|InsertShell|Pump|PumpBack|PumpForward|ClipHit|Cliphit|Zoom|ZoomIn|ZoomOut|WeaponMove\d|SilencerScrew\d|DetachSilencer|AttachSilencer)$/;
const missed = [];
for (const { n } of idx) {
  if (planned.has(n)) continue;
  if (!SUFFIX_RE.test(n)) continue;
  if (!csgo[n]) continue; // CS:GO 无 → 无旧音可换
  missed.push(n);
}
console.log('=== ① CS:GO 有旧音、我们没覆盖的工艺音: ' + missed.length + ' ===');
for (const n of missed.sort()) {
  const c = cs2Info(n);
  console.log('  ' + n.padEnd(34) + ' CS2 vol=' + String(c && c.vol).padEnd(9) + ' CS:GO vol=' + csgo[n].volume + '  waves=' + (csgo[n].waves || []).length);
}

// ② 音量被放大的事件（我们 vol > CS2 vol）
const changes = JSON.parse(fs.readFileSync('data/out/soundevents_addon.volume-changes.json', 'utf8'));
const up = changes.filter((c) => c.from !== null && c.to > c.from * 1.001);
console.log('\n=== ② 音量被放大的事件: ' + up.length + ' ===');
const bySuffix = {};
for (const c of up) {
  const s = c.event.slice(c.event.indexOf('.') + 1).replace(/_Q$/, '');
  (bySuffix[s] = bySuffix[s] || []).push(c);
}
for (const s of Object.keys(bySuffix).sort()) {
  const arr = bySuffix[s];
  const ratios = arr.map((c) => c.to / c.from);
  console.log('  ' + s.padEnd(18) + ' ' + String(arr.length).padStart(2) + ' 个  放大倍数 ' + Math.min(...ratios).toFixed(2) + 'x ~ ' + Math.max(...ratios).toFixed(2) + 'x');
}
