// 检查 4 个问题事件在新 vsndevts 里的实际内容
const fs = require('fs');
const txt = fs.readFileSync('data/out/soundevents_addon.vsndevts', 'utf8');
const lines = txt.split('\n');

function block(name) {
  const head = '\t' + name + ' =';
  const i = lines.findIndex((l) => l.replace(/\s+$/, '') === head);
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && lines[j] !== '\t}') j++;
  return lines.slice(i, j + 1).join('\n');
}

function info(name) {
  const b = block(name);
  if (!b) return name + ': MISSING';
  const vol = (b.match(/^\t\tvolume\s*=\s*([\d.]+)/m) || [])[1];
  const dur = (b.match(/^\t\tvsnd_duration\s*=\s*([\d.]+)/m) || [])[1];
  const vs = Array.from(b.matchAll(/"([^"]+\.vsnd)"/g)).map((m) => m[1]);
  return name + ': vol=' + vol + ' dur=' + dur + ' n=' + vs.length + ' ' + vs.join(', ');
}

[
  'Weapon_USP.Draw', 'Weapon_USP.Clipout', 'Weapon_USP.Clipin', 'Weapon_USP.Slideback', 'Weapon_USP.Sliderelease',
  'Weapon_AK47.Draw', 'Weapon_AK47.Clipin', 'Weapon_AK47.Clipout', 'Weapon_AK47.Single',
  'Weapon_Glock.Draw', 'Weapon_Glock.Clipin', 'Weapon_Glock.Single',
  'Weapon_M4A1.Draw', 'Weapon_M4A1.Clipin', 'Weapon_M4A1.Single', 'Weapon_M4A1.Clipout',
  'Weapon_M4A4.Single', 'Orig_Weapon_AK47.Single', 'Orig_Weapon_USP.Single',
].forEach((n) => console.log(info(n)));
