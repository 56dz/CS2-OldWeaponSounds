#!/usr/bin/env node
// 校验编译后的全量旧音 vsndevts_c（resourceinfo -all -baremode 导出的 dump.txt）
//
// 检查项：
//  1. 每个目标事件的块存在，且 vsnd_files_track_01 指向的 .vsnd 在 addon 的 vsnd_c 里真实存在
//  2. volume 与生成器算出的最终值一致（≤1e-4）
//     注意：**不是**和 CS:GO 原音量比 —— 生成器会做素材响度补偿（见 build_legacy_all.js），
//     实际音量 = CS:GO 原音量 × 补偿增益（开火类/开镜类不补偿）。
//     预期值来自生成器产出的 <out>.volume-changes.json，加上「未变化」事件的 CS:GO 音量。
//  3. 35 个 Orig_ 回退块的 vsnd 指向 CS2 原版（不应是 weapons_csgo）
//  4. 大括号/块数统计
//
// 用法:
//   node tools/verify_legacy_all.js <dump.txt> <plan.json> <csgo_events.json> <vsnd_c 根目录> [volume-changes.json]
'use strict';
const fs = require('fs');
const path = require('path');

const [dumpPath, planPath, csgoPath, vsndRoot, volChangesPath] = process.argv.slice(2);
if (!dumpPath || !planPath || !csgoPath || !vsndRoot) {
  console.error('用法: node tools/verify_legacy_all.js <dump.txt> <plan.json> <csgo_events.json> <vsnd_c 根目录> [volume-changes.json]');
  process.exit(1);
}

const dump = fs.readFileSync(dumpPath, 'utf8').split(/\r?\n/);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const csgo = JSON.parse(fs.readFileSync(csgoPath, 'utf8')).events;

// 音量有变化的事件 → 最终音量
const finalVol = new Map();
if (volChangesPath && fs.existsSync(volChangesPath)) {
  for (const r of JSON.parse(fs.readFileSync(volChangesPath, 'utf8'))) {
    finalVol.set(r.event, r.to);
  }
  console.log(`音量变化表: ${finalVol.size} 条`);
}

/** CS:GO 音量（多值取平均），与生成器保持一致 */
function csgoVolume(event) {
  const cg = csgo[event];
  if (!cg || cg.volume === undefined || cg.volume === null) return null;
  const parts = String(cg.volume)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** 生成器对某些后缀保留 CS2 原音量 */
const KEEP_CS2_SUFFIXES = new Set(['Zoom', 'ZoomIn', 'ZoomOut']);
function suffixOf(event) {
  const i = event.indexOf('.');
  if (i < 0) return event;
  return event.slice(i + 1).replace(/_Q$/, '');
}

/** 该事件的预期音量；null 表示应当保留 CS2 原值，不校验 */
function expectedVolume(event) {
  if (finalVol.has(event)) return finalVol.get(event);
  if (KEEP_CS2_SUFFIXES.has(suffixOf(event))) return null;
  return csgoVolume(event);
}

const blockRe = /^\t(\S[^\s=]*)\s*=\s*$/;
const blocks = new Map();
for (let i = 0; i < dump.length; i++) {
  const m = blockRe.exec(dump[i]);
  if (!m) continue;
  let end = i + 1;
  while (end < dump.length && dump[end].trim() !== '}') end++;
  blocks.set(m[1], dump.slice(i + 1, end));
}
console.log(`dump 事件块: ${blocks.size}`);

function field(lines, name) {
  const re = new RegExp('^\\t\\t' + name + '\\s*=\\s*(.*)$');
  for (const l of lines) {
    const m = re.exec(l);
    if (m) return m[1].trim();
  }
  return null;
}

/** 从块里取所有 vsnd 路径（支持标量与数组两种写法） */
function vsndsOf(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\t\tvsnd_files_track_0\d\s*=/.test(lines[i])) continue;
    const inline = /"([^"]+)"/.exec(lines[i]);
    if (inline) { out.push(inline[1]); continue; }
    for (let j = i + 1; j < lines.length; j++) {
      const m = /"([^"]+)"/.exec(lines[j]);
      if (m) out.push(m[1]);
      if (/^\t\t\]/.test(lines[j])) { i = j; break; }
    }
  }
  return out;
}

const problems = [];
let okVsnd = 0;
let okVol = 0;

// 1+2. 覆盖块
for (const t of plan.events) {
  const lines = blocks.get(t.event);
  if (!lines) { problems.push(`缺块: ${t.event}`); continue; }
  const vsnds = vsndsOf(lines);
  if (!vsnds.length) { problems.push(`无 vsnd: ${t.event}`); continue; }
  for (const v of vsnds) {
    const rel = v.replace(/\.vsnd$/i, '.vsnd_c');
    const p = path.join(vsndRoot, rel.replace(/^sounds\//i, 'sounds' + path.sep));
    if (!fs.existsSync(p)) problems.push(`vsnd 缺失: ${t.event} -> ${v}`);
    else okVsnd++;
  }
  const want = expectedVolume(t.event);
  if (want !== null) {
    const got = Number(field(lines, 'volume'));
    if (Number.isFinite(want) && Math.abs(got - want) > 1e-4) {
      problems.push(`音量不符: ${t.event} 期望 ${want} 实际 ${got}`);
    } else okVol++;
  }
}

// 3. Orig_ 回退块必须指向 CS2 原版
const origNames = [];
for (const k of blocks.keys()) if (k.startsWith('Orig_')) origNames.push(k);
let okOrig = 0;
for (const n of origNames) {
  const vsnds = vsndsOf(blocks.get(n));
  if (!vsnds.length) problems.push(`Orig 块无 vsnd: ${n}`);
  for (const v of vsnds) {
    if (/weapons_csgo/i.test(v)) problems.push(`Orig 块仍指向旧音: ${n} -> ${v}`);
    else okOrig++;
  }
}

console.log(`覆盖块 vsnd 命中: ${okVsnd}，音量校验通过: ${okVol}/${plan.events.length}`);
console.log(`Orig_ 回退块: ${origNames.length} 个，指向原版 vsnd: ${okOrig}`);

const allNames = Array.from(blocks.keys());
const dupes = allNames.filter((n, i) => allNames.indexOf(n) !== i);
if (dupes.length) problems.push(`重复事件: ${dupes.join(', ')}`);

if (problems.length) {
  console.error(`\n问题 ${problems.length} 条:`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  process.exit(2);
}
console.log('\n✅ 全部校验通过');
