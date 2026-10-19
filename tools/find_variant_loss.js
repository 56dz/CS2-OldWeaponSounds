// 对比 CS2 原版与我们的输出：每个事件的 vsnd 变体数量
const fs = require('fs');
const g = fs.readFileSync('data/gsw.txt', 'utf8').split(/\r?\n/);
const S = fs.readFileSync('data/out/soundevents_addon.vsndevts', 'utf8').split(/\r?\n/);
const Q = String.fromCharCode(34);

function countVsnd(arr, start) {
  for (let j = start + 1; j < arr.length; j++) {
    if (/^\t\}$/.test(arr[j])) return 0;
    const m = arr[j].match(/vsnd_files_track_0\d+\s*=\s*(.*)$/);
    if (!m) continue;
    const rest = m[1].trim();
    if (rest.startsWith(Q)) return 1;
    let n = 0;
    let sawOpen = rest.includes('[');
    for (let k = j + 1; k < arr.length; k++) {
      const t = arr[k].trim();
      if (t === '') continue;
      if (!sawOpen) {
        if (t.startsWith('[')) { sawOpen = true; continue; }
        return 1; // 标量写在了下一行
      }
      if (t.startsWith(']')) return n;
      if (t.startsWith(Q)) n++;
      else return n;
    }
    return n;
  }
  return -1;
}
const find = (arr, name) => arr.findIndex((l) => l.replace(/\s*=\s*$/, '').trim() === name);

const plan = JSON.parse(fs.readFileSync('data/csgo_ref/legacy_all_plan.json', 'utf8'));
let same = 0;
const diff = [];
for (const t of plan.events) {
  const iC = find(g, t.event);
  const iO = find(S, t.event);
  if (iC < 0 || iO < 0) {
    diff.push({ ev: t.event, c: iC < 0 ? 'CS2缺' : countVsnd(g, iC), o: iO < 0 ? '我们缺' : countVsnd(S, iO) });
    continue;
  }
  const a = countVsnd(g, iC);
  const b = countVsnd(S, iO);
  if (a === b) same++;
  else diff.push({ ev: t.event, c: a, o: b });
}
console.log('变体数一致: ' + same + ' / ' + plan.events.length);
console.log('变体数不同: ' + diff.length);
for (const d of diff) console.log('  ' + d.ev.padEnd(32) + ' CS2=' + d.c + '  我们=' + d.o);
