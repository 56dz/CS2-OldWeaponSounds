const fs = require('fs');
const path = require('path');
const DST = 'D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive/content/csgo_addons/csgo_old_weapon_sounds';
function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, e.name);
    e.isDirectory() ? walk(q, o) : o.push(q);
  }
  return o;
}
const wavs = walk(path.join(DST, 'sounds')).filter((f) => f.toLowerCase().endsWith('.wav'));
const list = wavs.map((w) => path.relative(DST, w).split(path.sep).join('/'));
fs.writeFileSync(path.join(DST, 'soundevents', 'wavlist.txt'), list.join('\n') + '\n');
console.log('wavs', wavs.length);
console.log(list.slice(0, 3).join('\n'));
