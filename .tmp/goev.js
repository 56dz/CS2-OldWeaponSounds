const fs = require('fs');
const cg = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;
const names = process.argv.slice(2);
for (const n of names) {
  const c = cg[n];
  if (!c) { console.log(n, 'NO CSGO'); continue; }
  console.log(n.padEnd(32), 'vol=' + JSON.stringify(c.volume), 'pitch=' + JSON.stringify(c.pitch), 'lvl=' + c.soundlevel, 'ch=' + c.channel, 'n=' + (c.waves ? c.waves.length : 0));
}
