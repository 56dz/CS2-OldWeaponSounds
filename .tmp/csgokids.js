const fs = require('fs');
const txt = fs.readFileSync('data/csgo_ref/csgo_game_sounds_weapons.txt', 'utf8').split('\n');
const want = ['Weapon_Glock.Single', 'Weapon_M249.Single', 'Weapon_FAMAS.Single', 'Weapon_Taser.Single',
  'SmokeGrenade.Bounce', 'IncGrenade.Bounce', 'Weapon_M4A1.Single'];
for (const name of want) {
  const head = `"${name}"`;
  let s = -1;
  for (let i = 0; i < txt.length; i++) if (txt[i].trim() === head) { s = i; break; }
  if (s < 0) { console.log(name, 'NOT FOUND'); continue; }
  // find matching closing brace
  let depth = 0, e = -1;
  for (let i = s; i < txt.length; i++) {
    depth += (txt[i].match(/\{/g) || []).length;
    depth -= (txt[i].match(/\}/g) || []).length;
    if (i > s && depth === 0) { e = i; break; }
  }
  const body = txt.slice(s, e + 1);
  const refs = body.filter((l) => /entry_name|import_stack|mixgroup|"volume"|"pitch"|"channel"|"wave"|play_distant/.test(l));
  console.log('=== ' + name + '  (line ' + (s + 1) + ')');
  for (const l of refs) console.log('    ' + l.trim());
}
