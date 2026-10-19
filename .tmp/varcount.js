// 候选：CS2 里用到多条 vsnd（数组）的事件，CS2 引擎会在每次播放随机选一条。
// 上一版生成器把 CS:GO 的 wave 数强行对齐到 CS2 的变体数：
//   - CS:GO 少 -> 循环填充 -> 同一文件重复多次（AK47.Single 3 次同一文件）
//   - CS:GO 多 -> 截断 -> 丢掉 CS:GO 的变体
// 对 .Single 类事件来说，这会让玩家感觉"每枪都一样"，而 CS:GO 是随机变体。
// 这里评估：如果改成"CS:GO 有几个就用几个"，会改动哪些事件。
const fs = require('fs');

const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const gsw = fs.readFileSync('data/gsw.txt', 'utf8').split('\n');

function blockLines(name) {
  const head = '\t' + name + ' =';
  for (let i = 0; i < gsw.length; i++) {
    if (gsw[i].replace(/\s+$/, '') === head) {
      for (let j = i + 1; j < gsw.length; j++) if (gsw[j] === '\t}') return gsw.slice(i, j + 1);
      return null;
    }
  }
  return null;
}

function cs2VsndCount(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = /^\t\tvsnd_files_track_0\d\s*=\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let rest = m[1].trim();
    if (!rest) rest = (lines[i + 1] || '').trim();
    if (rest.startsWith('[')) {
      let n = 0;
      for (let j = i; j < lines.length; j++) {
        if (/^\t\t\t"/.test(lines[j])) n++;
        if (/^\t\t\]/.test(lines[j])) break;
      }
      return n;
    }
    return rest ? 1 : 0;
  }
  return 0;
}

const rows = [];
for (const e of plan.events) {
  const lines = blockLines(e.event);
  if (!lines) continue;
  const cs2n = cs2VsndCount(lines);
  const gon = (e.wavs || []).length;
  if (cs2n === gon) continue;
  rows.push({ event: e.event, cs2n, gon, delta: gon - cs2n });
}
rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.event.localeCompare(b.event));
console.log('变体数不一致的事件:', rows.length);
for (const r of rows) {
  const tag = r.delta > 0 ? 'CS:GO更多(现被截断)' : 'CS:GO更少(现被重复填充)';
  console.log('  ' + r.event.padEnd(38), 'cs2=' + String(r.cs2n).padEnd(3), 'go=' + String(r.gon).padEnd(3), tag);
}
const gt = rows.filter((r) => r.delta > 0).length;
console.log('');
console.log('CS:GO 变体更多（截断丢失）: ' + gt + '   CS:GO 变体更少（重复填充）: ' + (rows.length - gt));
