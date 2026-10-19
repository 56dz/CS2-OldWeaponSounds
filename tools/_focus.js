// 聚焦用户报告的 4 个问题：查每个相关事件在 CS2 原版与我们的输出中的实际差异
const fs = require('fs');
const g = fs.readFileSync('data/gsw.txt', 'utf8').split(/\r?\n/);
const L = fs.readFileSync('data/out/compiled_dump4.txt', 'utf8').split(/\r?\n/);
const idx = [];
for (let i = 0; i < g.length; i++) {
  const m = g[i].match(/^\t(\S[^\s=]*)\s*=\s*$/);
  if (m) idx.push({ i, n: m[1] });
}
function parse(arr, name) {
  const e = arr === L ? null : idx.find((x) => x.n === name);
  const start = e ? e.i : arr.findIndex((l) => l.replace(/\s*=\s*$/, '').trim() === name);
  if (start < 0) return null;
  const o = { vs: [], vol: null, dur: null };
  for (let j = start + 1; j < arr.length; j++) {
    if (/^\t\}$/.test(arr[j])) break;
    let m;
    if ((m = arr[j].match(/vsnd_files_track_0\d+\s*=\s*(.*)$/))) {
      const rest = m[1].trim();
      if (rest.startsWith('"')) o.vs.push(rest.replace(/"/g, ''));
      else {
        for (let k = j + 1; k < arr.length; k++) {
          const q = arr[k].trim().match(/^"([^"]+)"\,?$/);
          if (q) o.vs.push(q[1]);
          else if (/^\]/.test(arr[k].trim())) break;
          else if (!/^["\[]/.test(arr[k].trim())) break;
        }
      }
    }
    if ((m = arr[j].match(/^\t\tvolume = ([\d.]+)/))) o.vol = m[1];
    if ((m = arr[j].match(/vsnd_duration = ([\d.]+)/))) o.dur = m[1];
  }
  return o;
}
const targets = [
  // 问题1 USP 切枪
  'Weapon_USP.Draw',
  'Weapon_USP.Clipout',
  'Weapon_USP.Clipin',
  'Weapon_USP.Slideback',
  'Weapon_USP.Sliderelease',
  // 问题2 M4A1/A4 切枪忽大忽小
  'Weapon_M4A1.Draw',
  'Weapon_M4A1.Clipout',
  'Weapon_M4A1.Clipin',
  'Weapon_M4A4.Single',
  'Weapon_M4A1S.BoltBack',
  // 问题3 Glock
  'Weapon_Glock.Single',
  'Weapon_Glock.Draw',
  'Weapon_Glock.Clipin',
  'Weapon_Glock.Clipout',
  // 问题4 AK 切枪
  'Weapon_AK47.Draw',
];
for (const n of targets) {
  const c = parse(g, n);
  const o = parse(L, n);
  const fmt = (x) => (x ? `vol=${x.vol} dur=${x.dur} vsnd=${x.vs.length ? x.vs.map((v) => v.split('/').pop()).join('+') : '无'}` : '不存在');
  const changed = c && o ? (c.vol !== o.vol || c.dur !== o.dur) : !!o;
  console.log((changed ? '⚠️ ' : '   ') + n.padEnd(26) + ' | CS2: ' + fmt(c).padEnd(58) + ' | 我们: ' + fmt(o));
}
