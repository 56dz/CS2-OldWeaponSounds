const fs = require('fs');
const path = require('path');
const GAME = 'D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo_addons/csgo_old_weapon_sounds';
const CONTENT = 'D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive/content/csgo_addons/csgo_old_weapon_sounds';
function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, e.name);
    e.isDirectory() ? walk(q, o) : o.push(q);
  }
  return o;
}
const wavSet = new Set(
  walk(path.join(CONTENT, 'sounds'))
    .filter((f) => f.toLowerCase().endsWith('.wav'))
    .map((f) => path.relative(CONTENT, f).split(path.sep).join('/').replace(/\.wav$/i, '.vsnd_c'))
);
const all = walk(path.join(GAME, 'sounds')).filter((f) => f.endsWith('.vsnd_c'));
let removed = 0;
for (const f of all) {
  const rel = path.relative(GAME, f).split(path.sep).join('/');
  if (!wavSet.has(rel)) { fs.unlinkSync(f); removed++; console.log('remove', rel); }
}
console.log('removed', removed, 'kept', wavSet.size);
