// 生成覆盖全部 35 把武器的 soundevents_addon.vsndevts
//
// 每个武器输出两个事件块：
//   Weapon_XXX.Single      -> CS:GO 旧音（替换 vsnd_files_track_01，其余字段原样保留）
//   Orig_Weapon_XXX.Single -> CS2 原音（内容与原事件完全相同，仅事件名加 Orig_ 前缀）
//
// 兼容 vsnd_files_track_01 的两种写法：数组 ["a","b"] 与 标量 "a"
//
// 用法: node build_full_addon.js <gsw.txt> <legacy_map_full.json> <输出文件>
const fs = require('fs');

const [gswPath, mapPath, outPath] = process.argv.slice(2);
if (!gswPath || !mapPath || !outPath) {
  console.error('用法: node build_full_addon.js <gsw.txt> <map.json> <out.vsndevts>');
  process.exit(1);
}

const raw = fs.readFileSync(gswPath, 'utf8').replace(/\r\n/g, '\n');
const lines = raw.split('\n');
const mapFile = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const weapons = mapFile.weapons;

// kv3 头注释 = 第一行
const header = lines[0];
if (!header.startsWith('<!-- kv3')) {
  console.error('gsw.txt 首行不是 kv3 头注释: ' + header);
  process.exit(1);
}

// ---- 索引所有 "1 级 tab 缩进" 的事件块 ----
const blocks = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(lines[i]);
  if (!m) continue;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j] === '\t}') { blocks.set(m[1], [i, j]); break; }
  }
}
console.error(`gsw.txt 事件块总数: ${blocks.size}`);

// ---- 只替换 vsnd_files_track_01 ----
function replaceVsnd(body, vsnd) {
  const vi = body.findIndex(l => /vsnd_files_track_01\s*=/.test(l));
  if (vi < 0) return null;
  const indent = (body[vi].match(/^[\t ]*/) || [''])[0];
  const scalar = /vsnd_files_track_01\s*=\s*"/.test(body[vi]);
  if (scalar) {
    const out = body.slice();
    out[vi] = `${indent}vsnd_files_track_01 = "${vsnd}"`;
    return out;
  }
  let k = vi + 1;
  while (k < body.length && body[k].trim() === '') k++;
  if (body[k] === undefined || body[k].trim() !== '[') return null;
  let close = -1;
  for (let m = k + 1; m < body.length; m++) {
    if (body[m].trim() === ']') { close = m; break; }
  }
  if (close < 0) return null;
  return [
    ...body.slice(0, k + 1),
    `${indent}\t"${vsnd}",`,
    ...body.slice(close),
  ];
}

// ---- 改名（只改块首行的事件名） ----
function renameBlock(body, newName) {
  const out = body.slice();
  out[0] = `\t${newName} = `;
  return out;
}

const out = [header, '{'];
const problems = [];
let legacyCount = 0, origCount = 0;
const seen = new Set();

// 按 event 名排序，输出稳定
const sorted = [...weapons].sort((a, b) => (a.event < b.event ? -1 : a.event > b.event ? 1 : 0));

for (const w of sorted) {
  const legacyName = `${w.event}.Single`;
  const origName = `Orig_${w.event}.Single`;
  if (seen.has(w.event)) problems.push(`${w.event}: 重复条目`);
  seen.add(w.event);

  const blk = blocks.get(legacyName);
  if (!blk) { problems.push(`${legacyName}: gsw.txt 中找不到事件块`); continue; }
  const [s, e] = blk;
  const body = lines.slice(s, e + 1);

  // 1) 旧音块
  const legacyBody = replaceVsnd(body, w.vsnd);
  if (!legacyBody) { problems.push(`${legacyName}: vsnd_files_track_01 格式无法处理`); continue; }
  out.push(...legacyBody);
  legacyCount++;

  // 2) Orig 块（内容原样，仅改名）
  out.push(...renameBlock(body, origName));
  origCount++;
}

out.push('}');
out.push('');

fs.writeFileSync(outPath, out.join('\n'), 'utf8');

// ---- 自检 ----
const text = out.join('\n');
const open = (text.match(/\{/g) || []).length;
const close = (text.match(/\}/g) || []).length;
const eventLines = out.filter(l => /^\t\S.* = $/.test(l));
const vsndCount = out.filter(l => /vsnd_files_track_01\s*=/.test(l)).length;

console.log('输出文件:', outPath);
console.log('武器数(输入):', weapons.length);
console.log('旧音事件(Weapon_*.Single):', legacyCount);
console.log('原音事件(Orig_Weapon_*.Single):', origCount);
console.log('事件总数:', legacyCount + origCount);
console.log('大括号 {:', open, ' }:', close, open === close ? '(平衡)' : '(不平衡!!)');
console.log('行首事件定义数:', eventLines.length);
console.log('vsnd_files_track_01 字段数:', vsndCount);
console.log('文件字节数:', Buffer.byteLength(text, 'utf8'));
if (problems.length) {
  console.error('!! 问题:');
  for (const p of problems) console.error('   ' + p);
  process.exit(2);
}
if (legacyCount !== weapons.length || origCount !== weapons.length) {
  console.error('!! 事件数不等于武器数');
  process.exit(3);
}
