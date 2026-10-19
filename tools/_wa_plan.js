const fs = require('fs');
const path = require('path');
const CS2 = 'D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive';
const AUD = path.join(CS2, 'content/csgo_addons/csgo_old_weapon_sounds');
const WAC = path.join(CS2, 'content/csgo_addons/wa');
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const wavs = (plan.wavs || []).map((w) => (typeof w === 'string' ? w : w.wav));
console.log('plan wavs', wavs.length);

function walk(root, ext, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (p.toLowerCase().endsWith(ext)) out.push(p);
  }
  return out;
}
const newVsnd = new Set(wavs.map((w) => 'sounds/weapons_csgo/' + w.replace(/^sound\//i, '').replace(/^weapons\//i, '').replace(/\.wav$/i, '.vsnd_c').toLowerCase()));

// existing wa sounds (relative)
const waFiles = walk(path.join(WAC, 'sounds'), '.vsnd_c').map((p) => path.relative(WAC, p).split(path.sep).join('/'));
const stale = waFiles.filter((r) => r.startsWith('sounds/weapons_csgo/') && !newVsnd.has(r.toLowerCase()));
const keepZero = waFiles.filter((r) => !r.startsWith('sounds/weapons_csgo/'));
console.log('wa existing vsnd_c', waFiles.length, 'stale weapons_csgo', stale.length, 'others', keepZero.length);
console.log('stale list:'); stale.forEach((s) => console.log('  ', s));

// collision check: new wav paths overlapping existing wa non-weapons_csgo paths
const overlap = wavs.filter((w) => waFiles.some((r) => r.toLowerCase() === ('sounds/weapons_csgo/' + w.replace(/^sound\//i, '').replace(/^weapons\//i, '').replace(/\.wav$/i, '.vsnd_c')).toLowerCase()));
console.log('overlap with existing', overlap.length);

// compiled vsnd_c available?
const AUDG = path.join(CS2, 'game/csgo_addons/csgo_old_weapon_sounds');
const missing = wavs.filter((w) => !fs.existsSync(path.join(AUDG, 'sounds/weapons_csgo', w.replace(/^sound\//i, '').replace(/^weapons\//i, '').replace(/\.wav$/i, '.vsnd_c'))));
console.log('missing compiled vsnd_c', missing.length);
missing.slice(0, 10).forEach((m) => console.log('  MISS', m));
