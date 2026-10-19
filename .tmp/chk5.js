const fs = require('fs');
const txt = fs.readFileSync('data/out/soundevents_addon.vsndevts', 'utf8').split('\n');
const want = ['Weapon_USP.Draw', 'Weapon_USP.Clipin', 'Weapon_USP.Clipout', 'Weapon_USP.Slideback',
  'Weapon_USP.Sliderelease', 'Weapon_AK47.Draw', 'Weapon_AK47.Clipin', 'Weapon_AK47.Clipout',
  'Weapon_M4A1.Draw', 'Weapon_M4A1.Clipin', 'Weapon_M4A1.Clipout', 'Weapon_Glock.Single',
  'Weapon_Glock.Draw', 'Weapon_Glock.Clipin', 'Weapon_M4A4.Single', 'Weapon_MP5.Draw', 'Weapon_AWP.Draw'];
const idx = new Map();
for (let i = 0; i < txt.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(txt[i]);
  if (!m) continue;
  for (let j = i + 1; j < txt.length; j++) if (txt[j] === '\t}') { idx.set(m[1], [i, j]); break; }
}
for (const n of want) {
  if (!idx.has(n)) { console.log(n.padEnd(26), 'MISSING'); continue; }
  const [s, e] = idx.get(n);
  const body = txt.slice(s, e + 1).join('\n');
  const vol = /^\t\tvolume = ([0-9.]+)/m.exec(body);
  const dur = /^\t\tvsnd_duration = ([0-9.]+)/m.exec(body);
  const one = /^\t\tvsnd_files_track_0\d = "([^"]+)"/m.exec(body);
  let vs = one ? [one[1]] : [];
  if (!one) {
    const a = /^\t\tvsnd_files_track_0\d = \s*$/m.exec(body);
    if (a) {
      const rest = body.slice(a.index + a[0].length);
      const o = rest.indexOf('['), c = rest.indexOf(']');
      vs = (rest.slice(o + 1, c).match(/"([^"]+)"/g) || []).map((x) => x.replace(/"/g, ''));
    }
  }
  console.log(n.padEnd(26), 'vol=' + (vol ? vol[1] : '?').padEnd(10), 'dur=' + (dur ? dur[1] : '?').padEnd(10), 'n=' + vs.length, vs.map((v) => v.replace('sounds/weapons_csgo/', '')).join(' '));
}
