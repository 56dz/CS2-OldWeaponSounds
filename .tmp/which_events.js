// 统计 gsw.txt 里每个事件引用的 vsnd 路径，反查「某个 vsnd 文件被哪些事件使用」。
// 用法: node .tmp/which_events.js <子串>
const fs = require('fs');
const gsw = fs.readFileSync('data/gsw.txt', 'utf8').split('\n');
const needle = (process.argv[2] || '').toLowerCase();

let cur = null;
const rows = [];
for (let i = 0; i < gsw.length; i++) {
  const line = gsw[i];
  const m = /^\t(\S[^\s=]*)[ \t]*=[ \t]*$/.exec(line);
  if (m) { cur = { event: m[1], start: i, vsnds: [], vol: null, dur: null, meta: null }; rows.push(cur); continue; }
  if (!cur) continue;
  if (line === '\t}') { cur = null; continue; }
  const v = /^\t\tvsnd_files_track_0\d\s*=\s*"([^"]+)"/.exec(line);
  if (v) cur.vsnds.push(v[1]);
  const vv = /^\t\tvsnd_files_track_0\d\s*=\s*$/.exec(line);
  if (vv) {
    // 后续若干行是数组
    for (let j = i + 1; j < gsw.length && j < i + 40; j++) {
      const a = /^\t\t\t"([^"]+)",?$/.exec(gsw[j]);
      if (a) cur.vsnds.push(a[1]);
      if (/^\t\t\]/.test(gsw[j])) break;
    }
  }
  const vol = /^\t\tvolume\s*=\s*([0-9.]+)/.exec(line);
  if (vol) cur.vol = vol[1];
  const dur = /^\t\tvsnd_duration\s*=\s*([0-9.]+)/.exec(line);
  if (dur) cur.dur = dur[1];
  const meta = /^\t\tmetadata\s*=\s*(.+)$/.exec(line);
  if (meta) cur.meta = meta[1].trim();
}

for (const r of rows) {
  if (!r.vsnds.length) continue;
  if (needle && !r.vsnds.some(v => v.toLowerCase().includes(needle))) continue;
  console.log(`${r.event.padEnd(38)} vol=${(r.vol || '-').padEnd(9)} dur=${(r.dur || '-').padEnd(9)} ${r.vsnds.join(', ')}`);
}
