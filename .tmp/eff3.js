const fs = require('fs');
const L = JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json', 'utf8'));
const rms = new Map();
for (const r of L.rows) rms.set(r.file.replace(/\\/g, '/').toLowerCase(), r.rms_db);
const cg = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;
const gains = JSON.parse(fs.readFileSync('tools/volume_gains.json', 'utf8')).suffixes;
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));

function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const m = new Map();
  let cur = null, buf = [];
  for (const l of lines) {
    const x = l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/);
    if (x) { if (cur) m.set(cur, buf); cur = x[1]; buf = [l]; }
    else if (cur) buf.push(l);
  }
  if (cur) m.set(cur, buf);
  return m;
}
const G = parse('data/gsw.txt');
function fld(a, n) {
  const re = new RegExp('^\\t\\t' + n + '[ \\t]*=[ \\t]*(.*)$');
  for (const l of a || []) { const m = l.match(re); if (m) return m[1].trim(); }
  return null;
}
function vsnds(a) {
  const out = [];
  const re = /^\t\tvsnd_files_track_0\d[ \t]*=[ \t]*(.*)$/;
  const i = a.findIndex((l) => re.test(l));
  if (i < 0) return out;
  const rest = a[i].match(re)[1].trim();
  if (rest) { out.push(rest.replace(/"/g, '')); return out; }
  for (let j = i + 1; j < a.length; j++) {
    const t = a[j].trim();
    if (t === ']') break;
    if (t.startsWith('"')) out.push(t.replace(/[",]/g, '').trim());
  }
  return out;
}
const wavOf = (v) => v.replace(/^sounds\//, 'sounds/').replace(/^sounds\/weapons_csgo\//, 'weapons/').replace(/\.vsnd$/, '.wav').toLowerCase();
const num = (v) => { if (v == null) return null; const p = String(v).split(',').map((s) => parseFloat(s.trim())).filter((x) => isFinite(x) && x > 0); return p.length ? p.reduce((a, b) => a + b, 0) / p.length : null; };
const sfx = (e) => e.slice(e.indexOf('.') + 1).replace(/_Q$/, '');
const db = (v) => 20 * Math.log10(v);
const stat = (a) => { const n = a.length; const m = a.reduce((x, y) => x + y, 0) / n; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / n); return { n, m, sd, range: Math.max(...a) - Math.min(...a) }; };

const CAP = Number(process.argv[2] || 6); // dB
const by = new Map();
for (const t of plan.events) {
  const s = sfx(t.event);
  const c2 = num(fld(G.get(t.event), 'volume'));
  const gv = num(cg[t.event] && cg[t.event].volume);
  const o = G.get(t.event);
  const ws = t.wavs.map((w) => w.toLowerCase());
  const rs = ws.map((w) => rms.get(w)).filter((x) => x != null);
  if (!rs.length || !c2 || !gv) continue;
  const r = rs.reduce((a, b) => a + b, 0) / rs.length;
  const g = gains[s] ? gains[s].gain : 1;
  let pure = Math.min(1, gv * g);
  let capped = pure;
  const lim = Math.pow(10, CAP / 20);
  if (capped / c2 > lim) capped = c2 * lim;
  if (capped / c2 < 1 / lim) capped = c2 / lim;
  capped = Math.min(1, capped);
  if (!by.has(s)) by.set(s, { c2: [], pure: [], cap: [] });
  const b = by.get(s);
  b.c2.push(db(c2) + r);
  b.pure.push(db(pure) + r);
  b.cap.push(db(capped) + r);
}
const rows = [...by.entries()].filter(([, v]) => v.pure.length >= 2).sort((a, b) => b[1].pure.length - a[1].pure.length);
console.log('后缀              n   cs2 sd/rng        pureGain sd/rng     cap' + CAP + 'dB sd/rng');
let sp = 0, sc = 0, s0 = 0, n = 0;
for (const [s, v] of rows) {
  const a = stat(v.c2), p = stat(v.pure), c = stat(v.cap);
  s0 += a.sd; sp += p.sd; sc += c.sd; n++;
  if (v.pure.length >= 4) {
    console.log(s.padEnd(18), String(a.n).padStart(3),
      `${a.sd.toFixed(1)}/${a.range.toFixed(1)}`.padEnd(14),
      `${p.sd.toFixed(1)}/${p.range.toFixed(1)}`.padEnd(16),
      `${c.sd.toFixed(1)}/${c.range.toFixed(1)}`);
  }
}
console.log(`\n加权平均 sd: cs2=${(s0 / n).toFixed(2)}  pure=${(sp / n).toFixed(2)}  cap${CAP}=${(sc / n).toFixed(2)}`);
