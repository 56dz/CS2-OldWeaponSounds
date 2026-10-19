#!/usr/bin/env node
'use strict';
/**
 * 生成「CS2 事件 -> CS:GO 旧音频」的全量差异报告。
 *
 * 用法:
 *   node analyze_full_mapping.js <gsw.txt> <csgo_events.json> <cs2_vpk_list.txt> <out.json> [filter]
 *
 * 分类（每类决定后续处理方式）：
 *   SAME_PATH      CS2 事件当前引用的 vsnd 列表 == CS:GO 的 wave 列表（同名同序）→ 已用 CS:GO 音频
 *   DIFF_PATH      CS2 引用了别的文件（CS2 换过音频）→ 需要覆盖，且音频在 CS2 客户端已存在
 *   NEED_SHIP      CS2 引用了别的文件，且 CS:GO 的 wav 在 CS2 客户端不存在 → addon 必须自带
 *   NO_CSGO        CS2 有该事件但 CS:GO 没有 → 不处理
 *   NO_VSND        CS2 事件块里没有 vsnd_files_track_01 → 不处理
 */
const fs = require('fs');

const [gswPath, csgoPath, vpkListPath, outPath, filter] = process.argv.slice(2);
if (!gswPath || !csgoPath || !vpkListPath || !outPath) {
  console.error('用法: node analyze_full_mapping.js <gsw.txt> <csgo_events.json> <vpk_list.txt> <out.json> [filter]');
  process.exit(1);
}

const USE_NODE_MODULES = false;

// ---------- CS2 事件 ----------
const raw = fs.readFileSync(gswPath, 'utf8').replace(/\r\n/g, '\n');
const lines = raw.split('\n');
const blocks = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(lines[i]);
  if (!m) continue;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j] === '\t}') { blocks.set(m[1], [i, j]); break; }
  }
}

function readVsnd(body) {
  const vi = body.findIndex((l) => /vsnd_files_track_01\s*=/.test(l));
  if (vi < 0) return { missing: true };
  if (/vsnd_files_track_01\s*=\s*"/.test(body[vi])) {
    const m = /"([^"]+)"/.exec(body[vi]);
    return { list: m ? [m[1]] : [] };
  }
  let k = vi + 1;
  while (k < body.length && body[k].trim() === '') k++;
  if (body[k] === undefined || body[k].trim() !== '[') return { missing: true };
  const out = [];
  for (let m = k + 1; m < body.length; m++) {
    if (body[m].trim() === ']') break;
    const mm = /"([^"]+)"/.exec(body[m]);
    if (mm) out.push(mm[1]);
  }
  return { list: out };
}

// ---------- CS:GO 事件 ----------
const csgo = JSON.parse(fs.readFileSync(csgoPath, 'utf8')).events;

// ---------- CS2 vpk ----------
const vpk = new Set();
for (const line of fs.readFileSync(vpkListPath, 'utf8').split('\n')) {
  const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
  if (m) vpk.add(m[2]);
}

const rows = [];
for (const [name, [s, e]] of blocks) {
  if (filter && !new RegExp(filter).test(name)) continue;
  const body = lines.slice(s, e + 1);
  const cur = readVsnd(body);
  const cg = csgo[name];
  if (cur.missing) { rows.push({ event: name, cls: 'NO_VSND' }); continue; }
  if (!cg) { rows.push({ event: name, cls: 'NO_CSGO', cs2_vsnd: cur.list }); continue; }

  const want = cg.waves.map((w) => 'sounds/' + w.replace(/\.wav$/i, '.vsnd'));
  const same = want.length === cur.list.length && want.every((v, i) => v === cur.list[i]);
  const allPresent = want.every((p) => vpk.has(p + '_c'));
  let cls;
  if (same) cls = 'SAME_PATH';
  else cls = allPresent ? 'DIFF_PATH' : 'NEED_SHIP';
  rows.push({
    event: name,
    cls,
    cs2_vsnd: cur.list,
    csgo_wavs: cg.waves,
    want_vsnd: want,
    missing_files: want.filter((p) => !vpk.has(p + '_c')),
    csgo_volume: cg.volume,
    csgo_soundlevel: cg.soundlevel,
    csgo_channel: cg.channel,
  });
}

const byCls = {};
for (const r of rows) byCls[r.cls] = (byCls[r.cls] || 0) + 1;
fs.writeFileSync(outPath, JSON.stringify({ byCls, rows }, null, 1), 'utf8');

console.log('过滤:', filter || '(无)');
console.log('事件数:', rows.length);
for (const [k, v] of Object.entries(byCls).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

const diff = rows.filter((r) => r.cls === 'DIFF_PATH');
console.log('\n-- DIFF_PATH 前 40 条 --');
for (const r of diff.slice(0, 40)) {
  console.log(`${r.event}\n    CS2 : ${r.cs2_vsnd.join(', ')}\n    GO  : ${r.want_vsnd.join(', ')}`);
}
const ship = rows.filter((r) => r.cls === 'NEED_SHIP');
if (ship.length) {
  console.log('\n-- NEED_SHIP 全部 --');
  for (const r of ship) console.log(`${r.event}: ${r.missing_files.join(', ')}`);
}
const same = rows.filter((r) => r.cls === 'SAME_PATH').length;
console.log('\nSAME_PATH:', same);
