const fs = require('fs');
const gsw = fs.readFileSync('data/gsw.txt', 'utf8').split('\n');
const idx = new Map();
for (let i = 0; i < gsw.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(gsw[i]);
  if (!m) continue;
  for (let j = i + 1; j < gsw.length; j++) if (gsw[j] === '\t}') { idx.set(m[1], [i, j]); break; }
}
const names = process.argv.slice(2);
for (const n of names) {
  const r = idx.get(n);
  if (!r) { console.log(n, 'MISSING'); continue; }
  const body = gsw.slice(r[0], r[1] + 1);
  const keep = body.filter((l) => /type|volume\s*=|pitch\s*=|mixgroup|vsnd_files_track|soundevent_|enable_child|vsnd_duration|metadata/.test(l));
  console.log('=== ' + n + ' (' + body.length + ' lines)');
  for (const l of keep) console.log('   ' + l.replace(/\t/g, '  '));
}
