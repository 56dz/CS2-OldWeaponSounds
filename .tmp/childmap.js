// 打印覆盖事件里每个 soundevent_N child 的父事件
const fs = require('fs');
const gsw = fs.readFileSync('data/gsw.txt', 'utf8').split('\n');
const csgo = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8'));
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const over = new Set(plan.events.map((e) => e.event));

// 索引块
const idx = new Map();
for (let i = 0; i < gsw.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(gsw[i]);
  if (!m) continue;
  for (let j = i + 1; j < gsw.length; j++) {
    if (gsw[j] === '\t}') { idx.set(m[1], [i, j]); break; }
  }
}

const rows = [];
for (const [name, [s, e]] of idx) {
  if (!over.has(name)) continue;
  const body = gsw.slice(s, e + 1).join('\n');
  // 标量
  for (const m of body.matchAll(/^\t\tsoundevent_(\d+)\s*=\s*"([^"]+)"/gm)) {
    rows.push({ parent: name, child: m[2] });
  }
  // 数组
  const arrRe = /^\t\tsoundevent_(\d+)\s*=\s*$/gm;
  let mm;
  while ((mm = arrRe.exec(body))) {
    let i = mm.index + mm[0].length;
    const rest = body.slice(i);
    const open = rest.indexOf('[');
    const close = rest.indexOf(']');
    if (open < 0 || close < 0) continue;
    const inner = rest.slice(open + 1, close);
    for (const c of inner.matchAll(/"([^"]+)"/g)) rows.push({ parent: name, child: c[1] });
  }
}

const seen = new Set();
for (const r of rows) {
  const key = r.parent + '>' + r.child;
  if (seen.has(key)) continue;
  seen.add(key);
  const hasGo = !!csgo.events[r.child];
  const isOver = over.has(r.child);
  console.log(`${r.parent}  ->  ${r.child}   csgo=${hasGo ? 'Y' : 'N'}  overridden=${isOver ? 'Y' : 'N'}`);
}
