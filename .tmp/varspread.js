const fs = require('fs');
const L = JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json', 'utf8'));
const rms = new Map();
for (const r of L.rows || []) rms.set(String(r.file).replace(/\\/g, '/').toLowerCase(), r.rms_db);
const lines = fs.readFileSync('data/out/soundevents_addon.vsndevts', 'utf8').split(/\r?\n/);
const blockRe = /^\t(\S[^\s=]*)[ \t]*=[ \t]*$/;
function parseBlock(start) {
  const out = [];
  for (let j = start + 1; j < lines.length; j++) {
    if (lines[j] === '\t}') break;
    out.push(lines[j]);
  }
  return out;
}
function vsnds(body) {
  const res = [];
  for (let i = 0; i < body.length; i++) {
    if (!/^\t\tvsnd_files_track_0\d[ \t]*=/.test(body[i])) continue;
    const v = body[i].replace(/^\t\tvsnd_files_track_0\d[ \t]*=[ \t]*/, '').trim();
    if (v) { const q = /^"([^"]*)"$/.exec(v); if (q) res.push(q[1]); continue; }
    for (let k = i + 1; k < body.length; k++) {
      const s = body[k].trim();
      if (s === '[') continue;
      if (s.startsWith(']')) break;
      const q = /^"([^"]*)"[,]?$/.exec(s);
      if (q) res.push(q[1]); else break;
    }
  }
  return res;
}
const out = [];
for (let i = 0; i < lines.length; i++) {
  const m = blockRe.exec(lines[i]);
  if (!m) continue;
  const name = m[1];
  if (name.startsWith('Orig_')) continue;
  const vs = vsnds(parseBlock(i));
  if (vs.length < 2) continue;
  const rs = vs.map((v) => rms.get(v.replace(/^sounds\/weapons_csgo\//, '').replace(/\.vsnd$/i, '.wav')))
    .map((x) => (x === undefined ? rms.get('weapons/' + '') : x));
  // 直接按 vsnd -> wav 试多种前缀
  const rs2 = vs.map((v) => {
    const rel = v.replace(/^sounds\/weapons_csgo\//, '').replace(/\.vsnd$/i, '.wav');
    return rms.has(rel) ? rms.get(rel) : rms.has('weapons/' + rel) ? rms.get('weapons/' + rel) : null;
  });
  const ok = rs2.filter((x) => typeof x === 'number');
  if (ok.length < 2) continue;
  const spread = Math.max(...ok) - Math.min(...ok);
  const uniq = new Set(vs).size;
  out.push({ name, n: vs.length, uniq, spread: Number(spread.toFixed(1)), rs: ok.map((x) => x.toFixed(1)) });
}
out.sort((a, b) => b.spread - a.spread);
console.log('多变体事件:', out.length, ' 其中变体 RMS 极差 >3dB:', out.filter((r) => r.spread > 3).length);
for (const r of out.filter((r) => r.spread > 2).slice(0, 30)) {
  console.log(' ', r.name.padEnd(34), 'n=' + r.n, 'uniq=' + r.uniq, 'spread=' + r.spread + 'dB', r.rs.join(','));
}
