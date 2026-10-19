const fs = require('fs');
const path = require('path');
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const loud = JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json', 'utf8'));
const dur = new Map();
for (const r of loud.rows || []) dur.set(r.file.toLowerCase(), r.seconds);
const want = ['Weapon_Glock.Single', 'Weapon_GalilAR.Single', 'Weapon_Sawedoff.Insertshell', 'Weapon_MP7.Single', 'Weapon_SCAR20.SingleDistant', 'Weapon_FAMAS.Single'];
for (const t of plan.events) {
  if (!want.includes(t.event)) continue;
  console.log(t.event);
  for (const w of t.wavs) {
    const d = dur.get(w.toLowerCase());
    console.log('   ', path.basename(w), d === undefined ? 'NA' : d.toFixed(3) + 's');
  }
}
