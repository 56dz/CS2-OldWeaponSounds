const fs = require('fs');
const csgo = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8'));
const names = Object.keys(csgo.events);
const want = process.argv.slice(2);
for (const n of want) {
  const e = csgo.events[n];
  if (!e) { console.log(n, '=> NO CSGO'); continue; }
  console.log(n, '=> vol=' + e.volume, 'waves=' + JSON.stringify(e.waves));
}
console.log('--- 含 Distant 的 CS:GO 事件 ---');
console.log(names.filter((n) => /Distant/i.test(n)).sort().join('\n'));
