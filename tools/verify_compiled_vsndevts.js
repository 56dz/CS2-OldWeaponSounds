// 校验**编译产物** vsndevts_c：先用
//   resourceinfo.exe -i <file.vsndevts_c> -all -baremode > dump.txt
// 导出，再用本脚本比对。
//
// 用法: node verify_compiled_vsndevts.js <resourceinfo_dump.txt> <gsw.txt> <legacy_map_full.json>
//
// 校验：
//   1. 编译产物中的事件数 = 武器数 x 2（Weapon_*.Single 与 Orig_Weapon_*.Single）
//   2. 每个 Weapon_*.Single 的 vsnd 值 = 映射表 vsnd
//   3. 每个 Orig_Weapon_*.Single 的 vsnd 值 = CS2 原事件(gsw.txt)的 vsnd 列表
//   4. 同一武器的两块的**其他所有字段完全一致**（证明 Orig 块保留了全部 3D/衰减/遮挡字段）
//   5. m_SubassetDefinitions.soundevent 里列出的事件名集合与之一致
const fs = require('fs');

const [dumpPath, gswPath, mapPath] = process.argv.slice(2);
const dumpLines = fs.readFileSync(dumpPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
const gsw = fs.readFileSync(gswPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')).weapons;

let fail = 0;
const err = (m) => { console.log('  [FAIL] ' + m); fail++; };
const ok = (m) => console.log('  [ OK ] ' + m);

// ---- 定位 DATA 块（第一个事件定义之前的顶层 '{'）----
let firstEvent = -1;
for (let i = 0; i < dumpLines.length; i++) {
  if (/^\tWeapon_AK47\.Single\s*=\s*$/.test(dumpLines[i])) { firstEvent = i; break; }
}
if (firstEvent < 0) { console.error('未在 dump 中找到 Weapon_AK47.Single'); process.exit(1); }
let dataStart = -1;
for (let i = firstEvent; i >= 0; i--) if (dumpLines[i] === '{') { dataStart = i; break; }
const data = dumpLines.slice(dataStart);
console.log(`DATA 块: dump 第 ${dataStart + 1} 行 ~ 结束（${data.length} 行）`);

function parseBlocks(lines) {
  const m = new Map();
  for (let i = 0; i < lines.length; i++) {
    const mm = /^\t(\S[^\s=]*)\s*=\s*$/.exec(lines[i]);
    if (!mm) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === '\t}') { m.set(mm[1], lines.slice(i, j + 1)); break; }
    }
  }
  return m;
}
const c = parseBlocks(data);
const g = parseBlocks(gsw);

// 1) 事件数
console.log('1) 事件数量');
c.size === map.length * 2
  ? ok(`编译产物事件数 ${c.size} = ${map.length} x 2`)
  : err(`编译产物事件数 ${c.size} != ${map.length * 2}`);

// 5) 子资源清单（编译产物在 RED2 块里登记了全部 soundevent 子资源）
console.log('2) m_SubassetDefinitions.soundevent 清单');
const subNames = [];
{
  const si = dumpLines.findIndex(l => /m_SubassetDefinitions\s*=/.test(l));
  if (si >= 0) {
    for (let i = si; i < dumpLines.length; i++) {
      const q = /"([^"]+\.Single)"/.exec(dumpLines[i]);
      if (q) subNames.push(q[1]);
      if (/^\t\}$/.test(dumpLines[i])) break;
    }
  }
}
const expectNames = [];
for (const w of map) { expectNames.push(`${w.event}.Single`); expectNames.push(`Orig_${w.event}.Single`); }
const missingInSub = expectNames.filter(n => !subNames.includes(n));
const extraInSub = subNames.filter(n => !expectNames.includes(n));
missingInSub.length === 0 && extraInSub.length === 0
  ? ok(`子资源清单 ${subNames.length} 项与预期一致`)
  : err(`子资源清单差异: 缺 [${missingInSub.join(', ')}] 多 [${extraInSub.join(', ')}]`);

// 工具：取 vsnd 列表
function vsndList(body) {
  const vi = body.findIndex(l => /vsnd_files_track_01\s*=/.test(l));
  if (vi < 0) return null;
  if (/vsnd_files_track_01\s*=\s*"/.test(body[vi])) return [/"([^"]+)"/.exec(body[vi])[1]];
  const out = [];
  for (let i = vi + 1; i < body.length; i++) {
    if (/^\s*\]/.test(body[i])) break;
    const q = /"([^"]+)"/.exec(body[i]);
    if (q) out.push(q[1]);
  }
  return out;
}
function stripVsnd(body) {
  const vi = body.findIndex(l => /vsnd_files_track_01\s*=/.test(l));
  if (vi < 0) return body.slice();
  if (/vsnd_files_track_01\s*=\s*"/.test(body[vi])) return [...body.slice(0, vi), 'VSND', ...body.slice(vi + 1)];
  let end = vi + 1;
  for (let i = vi + 1; i < body.length; i++) if (/^\s*\]\s*$/.test(body[i])) { end = i + 1; break; }
  return [...body.slice(0, vi), 'VSND', ...body.slice(end)];
}
// 编译器会用实际引用的 vsnd 重新计算 vsnd_duration，故结构比对时排除该字段
const stripDur = (body) => body.filter(l => !/vsnd_duration\s*=/.test(l));
function durationOf(body) {
  const l = body.find(x => /vsnd_duration\s*=/.test(x));
  return l ? parseFloat(/vsnd_duration\s*=\s*([0-9.]+)/.exec(l)[1]) : null;
}

// 3~4) 逐武器
console.log('3) 逐武器 vsnd / 结构比对');
let checked = 0;
const durations = [];
const srcVsndByEvent = new Map();
for (const w of map) {
  const gb = g.get(`${w.event}.Single`);
  if (!gb) { err(`gsw.txt 缺 ${w.event}.Single`); continue; }
  srcVsndByEvent.set(w.event, vsndList(gb));
}
for (const w of map) {
  const ln = `${w.event}.Single`, on = `Orig_${w.event}.Single`;
  const lb = c.get(ln), ob = c.get(on);
  if (!lb) { err(`编译产物缺 ${ln}`); continue; }
  if (!ob) { err(`编译产物缺 ${on}`); continue; }
  const lv = vsndList(lb), ov = vsndList(ob);
  const src = srcVsndByEvent.get(w.event);
  if (!lv || lv.length !== 1 || lv[0] !== w.vsnd) err(`${ln}: vsnd=${JSON.stringify(lv)} 期望 ["${w.vsnd}"]`);
  if (!ov || !src || ov.join('|') !== src.join('|')) err(`${on}: vsnd=${JSON.stringify(ov)} 期望 ${JSON.stringify(src)}`);
  // 结构一致（除 vsnd / vsnd_duration / 首行事件名外）
  const a = stripDur(stripVsnd(lb)); a[0] = 'NAME';
  const b = stripDur(stripVsnd(ob)); b[0] = 'NAME';
  if (a.join('\n') !== b.join('\n')) err(`${ln} 与 ${on} 除 vsnd/vsnd_duration 外结构不一致`);
  const dl = durationOf(lb), dor = durationOf(ob);
  if (dl === null || !(dl > 0)) err(`${ln}: vsnd_duration 非法 (${dl})`);
  durations.push(`${w.name}\t旧音=${dl}\tCS2原音=${dor}`);
  checked++;
}
if (fail === 0) ok(`${checked}/${map.length} 把武器：旧音 vsnd 正确、Orig vsnd 保留 CS2 原值、其余字段逐行一致`);
console.log('   编译器按实际 vsnd 重算的 vsnd_duration（节选）:');
console.log('     ' + durations.slice(0, 6).join('\n     '));

console.log(fail === 0 ? '\n结果: 全部通过' : `\n结果: ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
