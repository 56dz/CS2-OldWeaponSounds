// 独立校验生成的 soundevents_addon.vsndevts
// 用法: node verify_full_addon.js <生成的.vsndevts> <gsw.txt> <legacy_map_full.json>
//
// 校验项：
//   1. 首行是 kv3 头注释、第二行是匿名 '{'、末尾 '}'
//   2. 事件总数 = 武器数 * 2，且每个武器恰好有一个 Weapon_*.Single 与一个 Orig_Weapon_*.Single
//   3. 每个事件块都能在 gsw.txt 里找到对应原块
//   4. Weapon_*.Single：与 gsw 原块逐行比较，差异只允许出现在 vsnd_files_track_01 上，且值 = 映射表 vsnd
//   5. Orig_Weapon_*.Single：与 gsw 原块逐行比较，差异只允许出现在块首行(事件名)
//   6. 每个事件块都含 vsnd_files_track_01
//   7. 大括号平衡
const fs = require('fs');

const [outPath, gswPath, mapPath] = process.argv.slice(2);
const out = fs.readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
const gsw = fs.readFileSync(gswPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')).weapons;

let fail = 0;
const err = (m) => { console.log('  [FAIL] ' + m); fail++; };
const ok = (m) => console.log('  [ OK ] ' + m);

// 1
console.log('1) 文件结构');
out[0].startsWith('<!-- kv3') ? ok('第 1 行 kv3 头注释') : err('第 1 行不是 kv3 头注释: ' + out[0]);
out[1] === '{' ? ok("第 2 行匿名 '{'") : err("第 2 行不是匿名 '{': " + out[1]);
out[out.length - 1] === '' && out[out.length - 2] === '}' ? ok("末尾 '}'") : err('末尾不是 }');
const braces = (t) => [(t.match(/\{/g) || []).length, (t.match(/\}/g) || []).length];
const [b1, b2] = braces(out.join('\n'));
b1 === b2 ? ok(`大括号平衡 { ${b1} } ${b2}`) : err(`大括号不平衡 { ${b1} } ${b2}`);

// 解析输出块
const blocks = new Map();
for (let i = 0; i < out.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(out[i]);
  if (!m) continue;
  for (let j = i + 1; j < out.length; j++) {
    if (out[j] === '\t}') { blocks.set(m[1], [i, j]); break; }
  }
}
const gswBlocks = new Map();
for (let i = 0; i < gsw.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(gsw[i]);
  if (!m) continue;
  for (let j = i + 1; j < gsw.length; j++) {
    if (gsw[j] === '\t}') { gswBlocks.set(m[1], [i, j]); break; }
  }
}

// 2
console.log('2) 事件数量');
blocks.size === map.length * 2
  ? ok(`事件总数 ${blocks.size} = 武器数 ${map.length} x 2`)
  : err(`事件总数 ${blocks.size} != ${map.length * 2}`);
console.log('   输出块数(含顶层): ' + blocks.size);

function blockBody(mapObj, name) {
  const b = mapObj.get(name);
  return b ? out.slice(b[0], b[1] + 1) : null;
}
function gswBody(name) {
  const b = gswBlocks.get(name);
  return b ? gsw.slice(b[0], b[1] + 1) : null;
}

// 逐武器检查
console.log('3~6) 逐武器比对');
let checked = 0;
for (const w of map) {
  const legacyName = `${w.event}.Single`;
  const origName = `Orig_${w.event}.Single`;
  const orig = gswBody(legacyName);
  if (!orig) { err(`${legacyName}: gsw.txt 无此事件块`); continue; }

  const lb = blockBody(blocks, legacyName);
  const ob = blockBody(blocks, origName);
  if (!lb) { err(`${legacyName}: 输出缺失`); continue; }
  if (!ob) { err(`${origName}: 输出缺失`); continue; }

  // 6) vsnd 字段存在
  if (!lb.some(l => /vsnd_files_track_01\s*=/.test(l))) err(`${legacyName}: 缺 vsnd_files_track_01`);
  if (!ob.some(l => /vsnd_files_track_01\s*=/.test(l))) err(`${origName}: 缺 vsnd_files_track_01`);

  // 4) legacy: 去掉 vsnd 区域后应与原块一致，且 vsnd 值 = 映射
  const strip = (body) => {
    const vi = body.findIndex(l => /vsnd_files_track_01\s*=/.test(l));
    if (vi < 0) return body.slice();
    if (/vsnd_files_track_01\s*=\s*"/.test(body[vi])) return [...body.slice(0, vi), 'VSND', ...body.slice(vi + 1)];
    let k = vi + 1;
    while (k < body.length && body[k].trim() === '') k++;
    let close = -1;
    for (let m = k + 1; m < body.length; m++) if (body[m].trim() === ']') { close = m; break; }
    return [...body.slice(0, vi), 'VSND', ...body.slice(close + 1)];
  };
  const a = strip(orig).join('\n'), b = strip(lb).join('\n');
  if (a !== b) err(`${legacyName}: 除 vsnd 外与原块不一致`);
  const vsndLine = lb.find(l => /vsnd_files_track_01\s*=/.test(l));
  const vsndVals = [];
  if (/vsnd_files_track_01\s*=\s*"/.test(vsndLine)) {
    vsndVals.push(/"([^"]+)"/.exec(vsndLine)[1]);
  } else {
    const vi = lb.indexOf(vsndLine);
    for (let m = vi + 1; m < lb.length; m++) {
      if (lb[m].trim() === ']') break;
      const q = /"([^"]+)"/.exec(lb[m]);
      if (q) vsndVals.push(q[1]);
    }
  }
  if (vsndVals.length !== 1 || vsndVals[0] !== w.vsnd) {
    err(`${legacyName}: vsnd = [${vsndVals.join(', ')}] 期望 [${w.vsnd}]`);
  }

  // 5) orig: 只有首行不同
  const ob2 = ob.slice(); ob2[0] = orig[0];
  if (ob2.join('\n') !== orig.join('\n')) err(`${origName}: 除事件名外与原块不一致`);

  checked++;
}
if (fail === 0) ok(`${checked}/${map.length} 把武器全部通过`);

// 不允许出现额外事件
const extra = [...blocks.keys()].filter(n => {
  if (/^Orig_/.test(n)) return !map.some(w => `Orig_${w.event}.Single` === n);
  return !map.some(w => `${w.event}.Single` === n);
});
extra.length === 0 ? ok('无多余事件') : err('多余事件: ' + extra.join(', '));

console.log(fail === 0 ? '\n结果: 全部通过' : `\n结果: ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
