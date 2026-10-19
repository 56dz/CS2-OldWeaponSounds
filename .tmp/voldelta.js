const fs = require('fs');
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const chg = JSON.parse(fs.readFileSync('data/out/soundevents_addon.volume-changes.json', 'utf8'));
const rows = (chg.changes || chg.rows || chg) instanceof Array ? chg.changes || chg.rows || chg : [];
const sfx = (e) => e.slice(e.indexOf('.') + 1).replace(/_Q$/, '');
const list = rows
  .filter((r) => r.from && r.to)
  .map((r) => ({ ev: r.event, s: sfx(r.event), from: r.from, to: r.to, db: 20 * Math.log10(r.to / r.from) }))
  .sort((a, b) => b.db - a.db);
console.log('总变化: ' + list.length);
const up = list.filter((r) => r.db > 6);
const down = list.filter((r) => r.db < -6);
console.log('\n=== 变响 >6dB (' + up.length + ') ===');
for (const r of up.slice(0, 40)) console.log('  ' + r.ev.padEnd(34) + r.from + ' → ' + r.to + '  +' + r.db.toFixed(1) + 'dB');
console.log('\n=== 变轻 >6dB (' + down.length + ') ===');
for (const r of down.slice(-40)) console.log('  ' + r.ev.padEnd(34) + r.from + ' → ' + r.to + '  ' + r.db.toFixed(1) + 'dB');
