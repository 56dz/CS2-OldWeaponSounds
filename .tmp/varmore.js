// 检查「CS:GO 变体多于 CS2」的事件，其 CS:GO 各变体的 RMS 极差
const fs = require('fs');
const path = require('path');
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const gsw = fs.readFileSync('data/gsw.txt', 'utf8');
const loud = JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json', 'utf8'));
const rms = new Map();
for (const r of loud.rows || []) rms.set(r.file.toLowerCase(), r.rms_db);
const WAV = 'data/csgo_ref/wavout';

function cs2Count(ev) {
  const re = new RegExp('^\\t' + ev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' = $', 'm');
  const m = re.exec(gsw);
  if (!m) return 0;
  const start = m.index;
  const end = gsw.indexOf('\n\t}', start);
  const body = gsw.slice(start, end);
  const one = /^\t\tvsnd_files_track_0\d\s*=\s*"([^"]+)"/m.exec(body);
  if (one) return 1;
  const arr = /^\t\tvsnd_files_track_0\d\s*=\s*$/m.exec(body);
  if (arr) {
    const rest = body.slice(arr.index + arr[0].length);
    const o = rest.indexOf('[');
    const c = rest.indexOf(']');
    if (o >= 0 && c > o) {
      const inner = rest.slice(o + 1, c);
      return (inner.match(/"[^"]+"/g) || []).length;
    }
  }
  const sc = /^\t\tvsnd_files\s*=\s*$/m.exec(body);
  if (sc) {
    const rest = body.slice(sc.index + sc[0].length);
    const o = rest.indexOf('[');
    const c = rest.indexOf(']');
    if (o >= 0 && c > o) return (rest.slice(o + 1, c).match(/"[^"]+"/g) || []).length;
  }
  return 0;
}

let shown = 0;
for (const t of plan.events) {
  const c2 = cs2Count(t.event);
  const cg = t.wavs.length;
  if (cg <= c2) continue;
  const vals = t.wavs.map((w) => {
    const k = w.toLowerCase();
    return rms.has(k) ? rms.get(k) : (rms.has('weapons/' + k.replace(/^weapons\//, '')) ? rms.get('weapons/' + k.replace(/^weapons\//, '')) : null);
  });
  const ok = vals.filter((v) => v !== null && v !== undefined);
  const spread = ok.length ? Math.max(...ok) - Math.min(...ok) : null;
  console.log(
    `${t.event}  cs2=${c2} csgo=${cg}  spread=${spread === null ? 'NA' : spread.toFixed(1)}  ` +
    t.wavs.map((w, i) => path.basename(w) + '=' + (vals[i] === null ? '?' : vals[i])).join(' ')
  );
  shown++;
}
console.log('total', shown);
