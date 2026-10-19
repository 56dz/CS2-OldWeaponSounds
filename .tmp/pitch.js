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
function fld(a, n) {
  const re = new RegExp('^\\t\\t' + n + '[ \\t]*=[ \\t]*(.*)$');
  for (const l of a || []) { const m = l.match(re); if (m) return m[1].trim(); }
  return null;
}
const num = (v) => { if (v == null) return null; const p = String(v).split(',').map((s) => parseFloat(s.trim())).filter((x) => isFinite(x) && x > 0); return p.length ? p.reduce((a, b) => a + b, 0) / p.length : null; };
const sfx = (e) => e.slice(e.indexOf('.') + 1).replace(/_Q$/, '');

const rows = [];
for (const t of plan.events) {
  const p2 = num(fld(G.get(t.event), 'pitch'));
  const raw = cg[t.event] && cg[t.event].pitch;
  const pgo = num(raw) ? num(raw) / 100 : null;
  if (p2 == null || pgo == null) continue;
  rows.push({ ev: t.event, s: sfx(t.event), p2, pgo, cents: 1200 * Math.log2(p2 / pgo) });
}
console.log('可比对 pitch 的事件:', rows.length);
const byS = new Map();
for (const r of rows) { if (!byS.has(r.s)) byS.set(r.s, []); byS.get(r.s).push(r); }
console.log('\n后缀            n  |cents|均值 差异>50音分 最大偏差事件');
for (const [s, xs] of [...byS.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const ac = xs.map((x) => Math.abs(x.cents));
  const mean = ac.reduce((a, b) => a + b, 0) / ac.length;
  const big = xs.filter((x) => Math.abs(x.cents) > 50).length;
  const worst = xs.slice().sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))[0];
  console.log(s.padEnd(16), String(xs.length).padStart(3), mean.toFixed(1).padStart(11), String(big).padStart(10), ` ${worst.ev} cs2=${worst.p2} go=${worst.pgo.toFixed(2)} ${worst.cents.toFixed(0)}c`);
}
const all = rows.map((x) => Math.abs(x.cents));
console.log(`\n全部: 平均 ${(all.reduce((a, b) => a + b, 0) / all.length).toFixed(1)} 音分, 差异>50音分 ${rows.filter((x) => Math.abs(x.cents) > 50).length} 个, >100音分 ${rows.filter((x) => Math.abs(x.cents) > 100).length} 个`);
console.log('\n最大 20 个偏差:');
for (const x of rows.slice().sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)).slice(0, 20)) {
  console.log(' ', x.ev.padEnd(34), `cs2=${x.p2.toFixed(2)} go=${x.pgo.toFixed(2)}`, `${x.cents > 0 ? '+' : ''}${x.cents.toFixed(0)}c`);
}
