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
function fld(ev, name) {
  const h = index.get(ev); if (!h) return null;
  const re = new RegExp('^\\t\\t' + name + '[ \\t]*=[ \\t]*(.*)$');
  for (let j = h.start + 1; j <= h.end; j++) { const m = re.exec(lines[j]); if (m) return m[1].trim(); }
  return null;
}
const c2p = [];
for (const t of plan.events) {
  const cs2 = fld(t.event, 'pitch');
  if (cs2 === null) continue;
  const c = cg[t.event];
  let go = null;
  if (c && c.pitch) {
    const p = String(c.pitch).split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
    if (p.length) go = p.reduce((a, b) => a + b, 0) / p.length / 100;
  }
  const cs2n = Number(cs2);
  const cents = go ? 1200 * Math.log2(go / cs2n) : null;
  c2p.push({ event: t.event, cs2: cs2n, go, cents });
}
console.log('CS2 有显式 pitch 的覆盖事件:', c2p.length);
const diff = c2p.filter((r) => r.cents !== null && Math.abs(r.cents) > 30).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
console.log('与 CS:GO 差异 >30 音分:', diff.length);
for (const r of diff) console.log(' ', r.event.padEnd(34), 'cs2=' + r.cs2, 'go=' + (r.go ? r.go.toFixed(3) : '-'), (r.cents > 0 ? '+' : '') + r.cents.toFixed(0) + 'c');
const same = c2p.filter((r) => r.cents !== null && Math.abs(r.cents) <= 30).length;
const noGo = c2p.filter((r) => r.cents === null).length;
console.log(`差异 <=30 音分: ${same}   CS:GO 无 pitch 数据: ${noGo}`);
