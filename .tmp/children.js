const fs = require('fs');
const cg = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const lines = fs.readFileSync('data/gsw.txt', 'utf8').split(/\r?\n/);
const blockRe = /^\t(\S[^\s=]*)[ \t]*=[ \t]*$/;
const index = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = blockRe.exec(lines[i]);
  if (!m) continue;
  let end = -1;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j] === '\t}') { end = j; break; }
    if (blockRe.test(lines[j])) break;
  }
  if (end > 0) index.set(m[1], { start: i, end });
}
/** 取块的 child soundevent（支持标量/数组/空行数组） */
function childEvents(ev) {
  const h = index.get(ev); if (!h) return [];
  const out = [];
  for (let j = h.start + 1; j <= h.end; j++) {
    const m = /^\t\tsoundevent_\d+[ \t]*=[ \t]*(.*)$/.exec(lines[j]);
    if (!m) continue;
    const v = m[1].trim();
    if (v === '') {
      // 可能是数组：往下找 [
      for (let k = j + 1; k <= h.end; k++) {
        const s = lines[k].trim();
        if (s === '[') continue;
        if (s.startsWith(']')) break;
        const q = /^"([^"]*)",?$/.exec(s);
        if (q && q[1]) out.push(q[1]);
        if (!q) break;
      }
    } else {
      const q = /^"([^"]*)"$/.exec(v);
      if (q && q[1]) out.push(q[1]);
    }
  }
  return out;
}
const want = new Set(plan.events.map((e) => e.event));
const rows = [];
const cs2Only = new Map();
for (const e of want) {
  const ch = childEvents(e);
  if (!ch.length) continue;
  for (const c of ch) {
    const isWanted = want.has(c);
    const hasGo = !!cg[c];
    rows.push({ parent: e, child: c, wanted: isWanted, hasGo });
    if (!hasGo) {
      if (!cs2Only.has(c)) cs2Only.set(c, []);
      cs2Only.get(c).push(e);
    }
  }
}
console.log('覆盖事件中带 child 的条目:', rows.length);
console.log('\n=== child 是 CS2 独有（CS:GO 无此事件）===');
for (const [c, ps] of cs2Only) console.log(' ', c.padEnd(34), '←', ps.join(', '));
console.log('\n=== child 在 CS:GO 有但没有被我们覆盖 ===');
const notCovered = rows.filter((r) => r.hasGo && !r.wanted);
const uniq = new Map();
for (const r of notCovered) uniq.set(r.child, (uniq.get(r.child) || 0) + 1);
for (const [c, n] of uniq) console.log(' ', c.padEnd(34), 'x' + n);
