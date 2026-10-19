const fs = require('fs');
const L = JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json', 'utf8'));
const rms = new Map();
for (const r of L.rows) rms.set(r.file.replace(/\\/g, '/').toLowerCase(), r.rms_db);
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const G = parse('data/gsw.txt');
const O = parse('data/out/soundevents_addon.vsndevts');

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
const wavOf = (v) => v.replace(/^sounds\/weapons_csgo\//, 'weapons/').replace(/\.vsnd$/, '.wav').toLowerCase();
const num = (v) => { if (v == null) return null; const p = String(v).split(',').map((s) => parseFloat(s.trim())).filter((x) => isFinite(x) && x > 0); return p.length ? p.reduce((a, b) => a + b, 0) / p.length : null; };
const sfx = (e) => e.slice(e.indexOf('.') + 1).replace(/_Q$/, '');

const target = process.argv[2] || 'Draw';
const rows = [];
for (const t of plan.events) {
  if (sfx(t.event) !== target) continue;
  const c2 = num(fld(G.get(t.event), 'volume'));
  const o = O.get(t.event); if (!o) continue;
  const nv = num(fld(o, 'volume'));
  const ws = vsnds(o);
  const rs = ws.map((w) => rms.get(wavOf(w))).filter((x) => x != null);
  if (!rs.length || !c2 || !nv) continue;
  const r = rs.reduce((a, b) => a + b, 0) / rs.length;
  rows.push({ ev: t.event, c2, nv, rms: r, e2: 20 * Math.log10(c2) + r, en: 20 * Math.log10(nv) + r });
}
rows.sort((a, b) => a.e2 - b.e2);
console.log('事件                             volCS2  volNew  rms    effCS2  effNew');
for (const x of rows) console.log(x.ev.padEnd(32), String(x.c2).padEnd(7), String(+x.nv.toFixed(3)).padEnd(7), x.rms.toFixed(1).padStart(6), x.e2.toFixed(1).padStart(7), x.en.toFixed(1).padStart(7));
