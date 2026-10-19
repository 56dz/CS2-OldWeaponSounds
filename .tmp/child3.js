const fs = require('fs');
const gsw = fs.readFileSync('data/gsw.txt', 'utf8').split('\n');
const csgo = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const overridden = new Set(plan.events.map((e) => e.event));

function blockLines(name) {
  const head = '\t' + name + ' =';
  for (let i = 0; i < gsw.length; i++) {
    if (gsw[i].replace(/\s+$/, '') === head) {
      for (let j = i + 1; j < gsw.length; j++) if (gsw[j] === '\t}') return gsw.slice(i, j + 1);
      return null;
    }
  }
  return null;
}

function childList(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\t\tsoundevent_\d+\s*=\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let rest = m[1].trim();
    if (rest.startsWith('"')) { out.push(rest.replace(/^"|",?$/g, '')); continue; }
    for (let j = i + 1; j < lines.length; j++) {
      const mm = /^\t\t\t"([^"]+)",?$/.exec(lines[j]);
      if (mm) out.push(mm[1]);
      if (/^\t\t\]/.test(lines[j])) break;
    }
  }
  return out;
}

const rows = [];
for (const e of plan.events) {
  const lines = blockLines(e.event);
  if (!lines) continue;
  for (const c of childList(lines)) {
    rows.push({ parent: e.event, child: c, inCsgo: !!csgo[c], overridden: overridden.has(c) });
  }
}
console.log('child 引用总数:', rows.length);
for (const r of rows) {
  const act = r.overridden ? 'COVERED' : r.inCsgo ? 'keep' : /Distant$/.test(r.child) ? 'keep(distant)' : 'DROP';
  console.log('  ' + r.parent.padEnd(30) + ' -> ' + r.child.padEnd(38) + ' ' + act);
}
const drop = rows.filter((r) => !r.overridden && !r.inCsgo && !/Distant$/.test(r.child));
console.log('\n将删除的 CS2 独有层:', drop.length, [...new Set(drop.map((d) => d.child))].join(', '));
