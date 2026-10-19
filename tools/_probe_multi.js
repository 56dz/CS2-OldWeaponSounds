// 检查 CS2 原版多 vsnd 事件的语义：完整打印 vsnd 区
const fs = require('fs');
const g = fs.readFileSync('data/gsw.txt', 'utf8').split(/\r?\n/);
const idx = [];
for (let i = 0; i < g.length; i++) {
  const m = g[i].match(/^\t(\S[^\s=]*)\s*=\s*$/);
  if (m) idx.push({ i, n: m[1] });
}
function block(name) {
  const e = idx.find((x) => x.n === name);
  if (!e) return null;
  const out = [];
  for (let j = e.i; j < g.length; j++) {
    out.push(g[j]);
    if (j > e.i && /^\t\}$/.test(g[j])) break;
  }
  return out;
}
const want = [
  'FX_RicochetSound.Ricochet',
  'Weapon_Glock.Single',
  'Weapon_USP.SilencedShot',
  'Weapon_Sawedoff.Insertshell',
  'Weapon_Knife.Hit',
  'Weapon_AK47.Single',
];
for (const n of want) {
  const b = block(n);
  console.log('=== ' + n + ' ===');
  // 找 vsnd_files_track 起始，打印到该数组结束
  const si = b.findIndex((l) => /vsnd_files_track_\d+/.test(l));
  if (si < 0) {
    console.log('  无 vsnd 字段');
    continue;
  }
  let depth = 0;
  let started = false;
  for (let j = si; j < b.length; j++) {
    console.log('  ' + b[j]);
    depth += (b[j].match(/\[/g) || []).length;
    depth -= (b[j].match(/\]/g) || []).length;
    if (/\[/.test(b[j])) started = true;
    if (started && depth <= 0) break;
    if (!started && j > si && /=/.test(b[j])) break;
  }
  console.log();
}
