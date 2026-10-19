const fs = require('fs');
const L = JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json', 'utf8'));
const rms = new Map();
for (const r of L.rows) rms.set(r.file.replace(/\\/g, '/').toLowerCase(), r.rms_db);
const cg = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;
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
const num = (v) => { if (v == null) return null; const p = String(v).split(',').map((s) => parseFloat(s.trim())).filter((x) => isFinite(x) && x > 0); return p.length ? p.reduce((a, b) => a + b, 0) / p.length : null; };
const sfx = (e) => e.slice(e.indexOf('.') + 1).replace(/_Q$/, '');
const db = (v) => 20 * Math.log10(v);
const stat = (a) => { const n = a.length; const m = a.reduce((x, y) => x + y, 0) / n; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / n); return { n, m, sd, range: Math.max(...a) - Math.min(...a) }; };

// 目标策略：同后缀内「有效响度」恒定（= CS2 该后缀平均有效响度），逐事件增益
// 限制相对 CS2 原音量最多 ±CAP dB，且 ≤1.0
const CAP = Number(process.argv[2] || 6);

const rows = [];
for (const t of plan.events) {
  const s = sfx(t.event);
  const c2 = num(fld(G.get(t.event), 'volume'));
  const gv = num(cg[t.event] && cg[t.event].volume);
  const ws = t.wavs.map((w) => w.toLowerCase());
  const rs = ws.map((w) => rms.get(w)).filter((x) => x != null);
  if (!rs.length || !c2 || !gv) continue;
  const r = rs.reduce((a, b) => a + b, 0) / rs.length;
  rows.push({ ev: t.event, s, c2, gv, r, eff2: db(c2) + r });
}
const byS = new Map();
for (const x of rows) { if (!byS.has(x.s)) byS.set(x.s, []); byS.get(x.s).push(x); }

const lim = Math.pow(10, CAP / 20);
const out = [];
for (const [s, xs] of byS) {
  if (xs.length < 1) continue;
  const target = xs.reduce((a, x) => a + x.eff2, 0) / xs.length; // 该后缀 CS2 平均有效响度
  for (const x of xs) {
    let v = Math.pow(10, (target - x.r) / 20);
    v = Math.min(1, Math.max(0.005, v));
    const lo = x.c2 / lim, hi = x.c2 * lim;
    const vc = Math.min(hi, Math.max(lo, v));
    out.push({ ...x, v, vc });
  }
}
console.log('后缀               n   cs2 sd/rng     norm sd/rng     cap' + CAP + ' sd/rng   clamp1  >6dB');
let a0 = 0, a1 = 0, a2 = 0, n = 0, c1 = 0, c6 = 0;
const byS2 = new Map();
for (const x of out) { if (!byS2.has(x.s)) byS2.set(x.s, []); byS2.get(x.s).push(x); }
for (const [s, xs] of [...byS2.entries()].sort((a, b) => b[1].length - a[1].length)) {
  if (xs.length < 3) continue;
  const e0 = stat(xs.map((x) => x.eff2));
  const e1 = stat(xs.map((x) => db(x.v) + x.r));
  const e2 = stat(xs.map((x) => db(x.vc) + x.r));
  a0 += e0.sd; a1 += e1.sd; a2 += e2.sd; n++;
  const cl = xs.filter((x) => x.v >= 1).length;
  const big = xs.filter((x) => Math.abs(db(x.vc / x.c2)) > 6).length;
  c1 += cl; c6 += big;
  console.log(s.padEnd(18), String(xs.length).padStart(3), `${e0.sd.toFixed(1)}/${e0.range.toFixed(1)}`.padEnd(14), `${e1.sd.toFixed(1)}/${e1.range.toFixed(1)}`.padEnd(15), `${e2.sd.toFixed(1)}/${e2.range.toFixed(1)}`.padEnd(14), String(cl).padStart(4), String(big).padStart(5));
}
console.log(`\n平均 sd: cs2=${(a0 / n).toFixed(2)}  norm=${(a1 / n).toFixed(2)}  norm+cap${CAP}=${(a2 / n).toFixed(2)}`);
console.log(`被 clamp 到 1.0 的事件: ${c1}   音量变化 >${CAP}dB 的: ${c6}`);

console.log('\n变化幅度 top 25（含 cap 6）:');
for (const x of out.slice().sort((a,b)=>Math.abs(Math.log2(b.vc/b.c2))-Math.abs(Math.log2(a.vc/a.c2))).slice(0,25)) {
  console.log(' ', x.ev.padEnd(34), `c2=${x.c2.toFixed(3)} target=${x.v.toFixed(3)} final=${x.vc.toFixed(3)}`, `${(20*Math.log10(x.vc/x.c2)).toFixed(1)}dB`, 'rms', x.r.toFixed(1));
}
