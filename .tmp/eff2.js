const fs = require('fs');
const L = JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json', 'utf8'));
const rms = new Map();
for (const r of L.rows) rms.set(r.file.replace(/\\/g, '/').toLowerCase(), r.rms_db);
const cg = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));

function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const m = new Map();
  let cur = null;
  let buf = [];
  for (const l of lines) {
    const x = l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/);
    if (x) {
      if (cur) m.set(cur, buf);
      cur = x[1];
      buf = [l];
    } else if (cur) buf.push(l);
  }
  if (cur) m.set(cur, buf);
  return m;
}
const G = parse('data/gsw.txt');
const O = parse('data/out/soundevents_addon.vsndevts');

function fld(a, n) {
  const re = new RegExp('^\\t\\t' + n + '[ \\t]*=[ \\t]*(.*)$');
  for (const l of a) {
    const m = l.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function vsnds(a) {
  const out = [];
  const re = /^\t\tvsnd_files_track_0\d[ \t]*=[ \t]*(.*)$/;
  const i = a.findIndex((l) => re.test(l));
  if (i < 0) return out;
  const rest = a[i].match(re)[1].trim();
  if (rest) {
    out.push(rest.replace(/"/g, ''));
    return out;
  }
  for (let j = i + 1; j < a.length; j++) {
    const t = a[j].trim();
    if (t === ']') break;
    if (t.startsWith('"')) out.push(t.replace(/[",]/g, '').trim());
  }
  return out;
}

const wavOf = (v) =>
  v.replace(/^sounds\/weapons_csgo\//, 'weapons/').replace(/\.vsnd$/, '.wav').toLowerCase();

const num = (v) => {
  if (v == null) return null;
  const p = String(v)
    .split(',')
    .map((s) => parseFloat(s.trim()))
    .filter((x) => isFinite(x) && x > 0);
  return p.length ? p.reduce((a, b) => a + b, 0) / p.length : null;
};
const sfx = (e) => e.slice(e.indexOf('.') + 1).replace(/_Q$/, '');

const groups = {};
const add = (k, val) => {
  (groups[k] = groups[k] || []).push(val);
};

for (const t of plan.events) {
  const s = sfx(t.event);
  const c2 = num(fld(G.get(t.event), 'volume'));
  const gv = num(cg[t.event] && cg[t.event].volume);
  const o = O.get(t.event);
  if (!o) continue;
  const nv = num(fld(o, 'volume'));
  const ws = vsnds(o);
  const rs = ws.map((w) => rms.get(wavOf(w))).filter((x) => x != null);
  if (!rs.length) continue;
  const r = rs.reduce((a, b) => a + b, 0) / rs.length;
  if (c2 && nv) {
    add(s + ':cs2', 20 * Math.log10(c2) + r);
    add(s + ':new', 20 * Math.log10(nv) + r);
  }
  if (gv) add(s + ':go', 20 * Math.log10(gv) + r);
}

const stat = (a) => {
  const n = a.length;
  const m = a.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / n);
  return { n, m, sd, range: Math.max(...a) - Math.min(...a) };
};

const keys = [...new Set(Object.keys(groups).map((k) => k.split(':')[0]))].filter(
  (k) => groups[k + ':new'] && groups[k + ':new'].length >= 2
);
console.log('后缀              n   CS2音量 mean/sd/极差        新策略 mean/sd/极差');
for (const k of keys.sort()) {
  const a = groups[k + ':cs2'] ? stat(groups[k + ':cs2']) : null;
  const b = stat(groups[k + ':new']);
  console.log(
    k.padEnd(18),
    String(b.n).padStart(3),
    (a ? `${a.m.toFixed(1)} sd ${a.sd.toFixed(1)} r ${a.range.toFixed(1)}` : '-').padEnd(24),
    `${b.m.toFixed(1)} sd ${b.sd.toFixed(1)} r ${b.range.toFixed(1)}`
  );
}
