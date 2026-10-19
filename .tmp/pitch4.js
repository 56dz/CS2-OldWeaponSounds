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
const buckets = { noPitch: 0, hasPitch: 0 };
const goDefault = [];
let c2Dist = {};
for (const t of plan.events) {
  const c = cg[t.event];
  const cs2 = fld(t.event, 'pitch');
  const cs2n = cs2 === null ? 1.0 : Number(cs2);
  if (!c || !c.pitch) {
    buckets.noPitch++;
    const cents = 1200 * Math.log2(1.0 / cs2n);
    goDefault.push({ event: t.event, cs2: cs2n, cents });
  } else buckets.hasPitch++;
}
const big = goDefault.filter((r) => Math.abs(r.cents) > 30).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
console.log(`无 CS:GO pitch（默认 1.0）: ${buckets.noPitch}   有 pitch: ${buckets.hasPitch}`);
console.log(`其中若按 1.0 会变 >30 音分: ${big.length}`);
for (const r of big.slice(0, 40)) console.log('  ', r.event.padEnd(34), 'cs2=' + r.cs2, (r.cents > 0 ? '+' : '') + r.cents.toFixed(0) + 'c');
