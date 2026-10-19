// 校验编译产物（resourceinfo dump）：每个事件块是否都带 vsnd、路径是否指向 addon 私有命名空间
const fs = require('fs');
const dump = fs.readFileSync(process.argv[2] || 'data/out/compiled_dump6.txt', 'utf8').split(/\r?\n/);
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const Q = '"';

const blocks = new Map();
for (let i = 0; i < dump.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(dump[i]);
  if (!m) continue;
  const lines = [];
  for (let j = i; j < dump.length; j++) {
    lines.push(dump[j]);
    if (j > i && /^\t\}$/.test(dump[j])) break;
  }
  blocks.set(m[1], lines);
}
console.log('dump 里的顶层块: ' + blocks.size);

function vsnds(lines) {
  const out = [];
  for (let j = 0; j < lines.length; j++) {
    const m = /vsnd_files_track_0\d+\s*=\s*(.*)$/.exec(lines[j]);
    if (!m) continue;
    const rest = m[1].trim();
    if (rest.startsWith(Q)) { out.push(rest.replace(/"/g, '')); return out; }
    let sawOpen = rest.includes('[');
    for (let k = j + 1; k < lines.length; k++) {
      const t = lines[k].trim();
      if (t === '') continue;
      if (!sawOpen) { if (t.startsWith('[')) { sawOpen = true; continue; } return out; }
      if (t.startsWith(']')) return out;
      if (t.startsWith(Q)) { out.push(t.replace(/^"/, '').replace(/"\,?$/, '')); continue; }
      return out;
    }
    return out;
  }
  return out;
}

const problems = [];
const expected = new Set(plan.events.map((e) => e.event));
let okCount = 0;
for (const e of plan.events) {
  const b = blocks.get(e.event);
  if (!b) { problems.push(`编译产物缺块: ${e.event}`); continue; }
  const v = vsnds(b);
  if (!v.length) { problems.push(`${e.event} 编译后无 vsnd`); continue; }
  const bad = v.filter((p) => !p.startsWith('sounds/weapons_csgo/'));
  if (bad.length) problems.push(`${e.event} 有非私有命名空间的路径: ${bad.join(', ')}`);
  okCount++;
}
// Orig_ 块
const origs = [...blocks.keys()].filter((k) => k.startsWith('Orig_'));
for (const o of origs) {
  const v = vsnds(blocks.get(o));
  if (!v.length) problems.push(`${o} 编译后无 vsnd`);
  const bad = v.filter((p) => p.startsWith('sounds/weapons_csgo/'));
  if (bad.length) problems.push(`${o} 应指向原版音却指向自定义音: ${bad.join(', ')}`);
}

console.log(`主覆盖块校验通过: ${okCount}/${plan.events.length}`);
console.log(`Orig_ 回退块: ${origs.length} 个 (${origs.join(', ')})`);

// 检查是否有多余块（不该出现的）
const extra = [...blocks.keys()].filter((k) => !expected.has(k) && !k.startsWith('Orig_'));
if (extra.length) console.log(`其他块（可能来自元数据）: ${extra.join(', ')}`);

if (problems.length) {
  console.log('\n❌ 问题 ' + problems.length + ' 个:');
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('\n✅ 编译产物校验通过');
