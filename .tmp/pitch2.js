const fs = require('fs');
const cg = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const m = new Map(); let cur = null, buf = [];
  for (const l of lines) {
    const x = l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/);
    if (x) { if (cur) m.set(cur, buf); cur = x[1]; buf = [l]; }
    else if (cur) buf.push(l);
  }
  if (cur) m.set(cur, buf);
  return m;
}
const G = parse('data/gsw.txt');
const fld = (a, n) => { const re = new RegExp('^\\t\\t' + n + '[ \\t]*=[ \\t]*(.*)$'); for (const l of a || []) { const m = l.match(re); if (m) return m[1].trim(); } return null; };
let multi = 0, hasRandomCs2 = 0, total = 0, willChange = 0, big = 0;
const bigList = [];
for (const t of plan.events) {
  const p = cg[t.event] && cg[t.event].pitch;
  if (!p) continue;
  total++;
  const parts = String(p).split(',').map((s) => Number(s.trim())).filter((n) => isFinite(n));
  if (!parts.length) continue;
  if (parts.length > 1) multi++;
  const b = G.get(t.event);
  if (fld(b, 'pitch_random_min') !== null) hasRandomCs2++;
  const cs2p = Number(fld(b, 'pitch'));
  const goMean = parts.reduce((a, c) => a + c, 0) / parts.length / 100;
  if (!isFinite(cs2p)) continue;
  const cents = 1200 * Math.log2(goMean / cs2p);
  if (Math.abs(cents) > 5) willChange++;
  if (Math.abs(cents) > 50) { big++; bigList.push(`${t.event} cs2=${cs2p} go=${goMean.toFixed(3)} ${cents.toFixed(0)}c`); }
}
console.log(`有 CS:GO pitch: ${total}  多值: ${multi}  CS2 有 pitch_random 字段: ${hasRandomCs2}`);
console.log(`会变(>5音分): ${willChange}  大幅(>50音分): ${big}`);
for (const s of bigList) console.log(' ', s);
