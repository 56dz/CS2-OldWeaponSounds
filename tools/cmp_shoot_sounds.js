// 对比 vdata_dump 中不同条目的 m_aShootSounds 键集合
// 用法: node tools/cmp_shoot_sounds.js <vdata_dump.txt> [条目名...]
const fs = require('fs');

const dump = process.argv[2];
const names = process.argv.slice(3);
const lines = fs.readFileSync(dump, 'utf8').split(/\r?\n/);

function entryBlock(name) {
  const head = '\t' + name + ' =';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.replace(/\s+$/, '') !== head) continue;
    let d = 0;
    for (let j = i + 1; j < lines.length; j++) {
      d += (lines[j].match(/\{/g) || []).length;
      d -= (lines[j].match(/\}/g) || []).length;
      if (d <= 0 && /\}/.test(lines[j])) return lines.slice(i, j + 1);
    }
  }
  return null;
}

function sounds(name) {
  const b = entryBlock(name);
  if (!b) return null;
  const si = b.findIndex(l => /^\t\tm_aShootSounds/.test(l));
  if (si < 0) return {};
  const out = {};
  for (let k = si + 1; k < b.length; k++) {
    if (/^\t\t\}/.test(b[k])) break;
    const m = /^\t\t\t([A-Z_0-9]+)\s*=\s*soundevent:"([^"]+)"/.exec(b[k]);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const results = {};
for (const n of names) {
  const s = sounds(n);
  results[n] = s;
  if (s === null) { console.log('--- ' + n + ': (条目不存在)'); continue; }
  console.log('--- ' + n + ' --- 键数 ' + Object.keys(s).length);
  for (const k of Object.keys(s)) console.log('    ' + k + ' = ' + s[k]);
}

// 与第一个条目做键集合差异
const first = names.find(n => results[n]);
if (first && Object.keys(results).length > 1) {
  const base = new Set(Object.keys(results[first]));
  console.log('\n=== 相对 ' + first + ' 的键差异 ===');
  for (const n of names) {
    if (!results[n] || n === first) continue;
    const cur = new Set(Object.keys(results[n]));
    const missing = [...base].filter(k => !cur.has(k));
    const extra = [...cur].filter(k => !base.has(k));
    if (missing.length || extra.length)
      console.log('  ' + n + ': 缺少=[' + missing.join(',') + '] 多出=[' + extra.join(',') + ']');
    else
      console.log('  ' + n + ': 键集合一致');
  }
}
