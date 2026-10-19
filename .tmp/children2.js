const fs = require('fs');
const gsw = fs.readFileSync('data/gsw.txt', 'utf8').split('\n');
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const csgo = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;

const idx = new Map();
for (let i = 0; i < gsw.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(gsw[i]);
  if (!m) continue;
  for (let j = i + 1; j < gsw.length; j++) if (gsw[j] === '\t}') { idx.set(m[1], [i, j]); break; }
}

function childrenOf(name) {
  const r = idx.get(name);
  if (!r) return [];
  const body = gsw.slice(r[0], r[1] + 1);
  const outNames = [];
  for (let i = 0; i < body.length; i++) {
    const m = /^\t\tsoundevent_(\d+)\s*=\s*(.*)$/.exec(body[i]);
    if (!m) continue;
    const rest = m[2].trim();
    if (rest.startsWith('"')) {
      const v = /"([^"]+)"/.exec(rest);
      if (v) outNames.push(v[1]);
    } else {
      let depth = 0, started = false;
      for (let k = i; k < body.length; k++) {
        for (const ch of body[k]) {
          if (ch === '[') { depth++; started = true; }
          else if (ch === ']') depth--;
        }
        if (started && depth === 0) break;
        const vs = body[k].match(/"([^"]+)"/g);
        if (vs) for (const v of vs) outNames.push(v.replace(/"/g, ''));
      }
    }
  }
  return outNames;
}

const onlyCs2 = new Map();
for (const t of plan.events) {
  const ch = childrenOf(t.event);
  if (!ch.length) continue;
  const keep = [], drop = [];
  for (const c of ch) (csgo[c] ? keep : drop).push(c);
  if (drop.length) onlyCs2.set(t.event, { keep, drop });
}
console.log('带 CS2 独有子事件的覆盖事件: ' + onlyCs2.size);
for (const [k, v] of onlyCs2) console.log('  ' + k.padEnd(28), 'drop=' + v.drop.join(',') + (v.keep.length ? '  keep=' + v.keep.join(',') : ''));
console.log('');
console.log('--- 所有覆盖事件里存在 CS:GO 定义的子事件（保留）---');
const keepSet = new Map();
for (const t of plan.events) for (const c of childrenOf(t.event)) if (csgo[c]) keepSet.set(c, (keepSet.get(c) || 0) + 1);
for (const [k, n] of keepSet) console.log('  ' + k.padEnd(32), 'x' + n);
