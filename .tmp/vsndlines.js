const fs = require('fs');
const gsw = fs.readFileSync('data/gsw.txt', 'utf8').split('\n');
const names = process.argv.slice(2);
for (const name of names) {
  const head = '\t' + name + ' =';
  let s = -1;
  for (let i = 0; i < gsw.length; i++) if (gsw[i].replace(/\s+$/, '') === head) { s = i; break; }
  if (s < 0) { console.log(name, 'NOT FOUND'); continue; }
  let e = -1;
  for (let j = s + 1; j < gsw.length; j++) if (gsw[j] === '\t}') { e = j; break; }
  console.log('=== ' + name + ' lines ' + (s + 1) + '..' + (e + 1) + ' total ' + (e - s + 1));
  for (let j = s; j <= e; j++) {
    if (/vsnd_files|vsnd_duration|^\t\tvolume|^\t\tpitch|soundevent_|enable_child/.test(gsw[j])) console.log('  ' + (j + 1) + ' |' + gsw[j] + '|');
  }
}
