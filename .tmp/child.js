const fs = require('fs');
const lines = fs.readFileSync('data/gsw.txt', 'utf8').split(/\r?\n/);
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const targets = new Set(plan.events.map((e) => e.event));
// 索引
const idx = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/);
  if (!m) continue;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() !== '}') j++;
  idx.set(m[1], [i, j]);
}
function children(name) {
  const r = idx.get(name);
  if (!r) return [];
  const body = lines.slice(r[0], r[1] + 1);
  const out = [];
  for (let k = 0; k < body.length; k++) {
    const m = body[k].match(/^\t\tsoundevent_\d+[ \t]*=[ \t]*(.*)$/);
    if (!m) continue;
    let rest = m[1].trim();
    if (!rest) { let kk = k + 1; while (kk < body.length && !body[kk].trim()) kk++; rest = (body[kk] || '').trim(); k = kk - 1; }
    if (rest.startsWith('[')) {
      let depth = (rest.match(/\[/g) || []).length - (rest.match(/\]/g) || []).length;
      let kk = k + 1;
      while (depth > 0 && kk < body.length) {
        rest += ' ' + body[kk];
        depth += (body[kk].match(/\[/g) || []).length - (body[kk].match(/\]/g) || []).length;
        kk++;
      }
    }
    const names = rest.match(/"[^"]+"/g) || [];
    for (const s of names) out.push({ field: m[0].split('=')[0].trim(), ev: s.replace(/"/g, '') });
  }
  return out;
}
const stat = new Map();
const detail = [];
for (const ev of [...targets].sort()) {
  const ch = children(ev);
  if (!ch.length) continue;
  const extra = ch.filter((c) => !/\.SingleDistant$/.test(c.ev));
  if (extra.length) detail.push({ ev, children: ch.map((c) => c.ev) });
  for (const c of ch) {
    const kind = /\.SingleDistant$/.test(c.ev) ? 'SingleDistant' : (c.ev.includes('Element') ? 'Element' : 'OTHER');
    stat.set(kind, (stat.get(kind) || 0) + 1);
  }
}
console.log('子事件类型分布（仅被覆盖的 468 个事件）:');
for (const [k, v] of [...stat.entries()].sort((a, b) => b[1] - a[1])) console.log(' ', k, v);
console.log(`\n带「非 SingleDistant」子事件的事件: ${detail.length}`);
for (const d of detail.slice(0, 60)) console.log(' ', d.ev, '→', d.children.join(', '));
