#!/usr/bin/env node
'use strict';
/**
 * 交叉比对：CS2 的 soundevent（gsw.txt，文本 kv3）vs CS:GO 的同名 soundevent（csgo_events.json）
 *
 * 用法:
 *   node cross_check_csgo.js <gsw.txt> <csgo_events.json> <cs2_vpk_list.txt> <out.json>
 *
 * 输出每把武器 / 每个事件后缀的：
 *   cs2_vsnd       CS2 事件当前引用的 vsnd 路径（如果能在文本里直接读到）
 *   csgo_wavs      CS:GO 同名事件引用的 wav（去掉前缀、加 sounds/ 与 .vsnd 后缀）
 *   cs2_has_wav    该 wav 对应路径是否存在于 CS2 的 pak01（=> 可直接引用，无需自带文件）
 */
const fs = require('fs');

const [gswPath, csgoPath, vpkListPath, outPath] = process.argv.slice(2);
if (!gswPath || !csgoPath || !vpkListPath || !outPath) {
  console.error('用法: node cross_check_csgo.js <gsw.txt> <csgo_events.json> <vpk_list.txt> <out.json>');
  process.exit(1);
}

// ---- CS2 事件块 ----
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

/** 读出一个事件块里的 vsnd 列表（支持数组与标量） */
function readVsnd(body) {
  const vi = body.findIndex((l) => /vsnd_files_track_01\s*=/.test(l));
  if (vi < 0) return null;
  if (/vsnd_files_track_01\s*=\s*"/.test(body[vi])) {
    const m = /"([^"]+)"/.exec(body[vi]);
    return m ? [m[1]] : null;
  }
  let k = vi + 1;
  while (k < body.length && body[k].trim() === '') k++;
  if (body[k] === undefined || body[k].trim() !== '[') return null;
  const out = [];
  for (let m = k + 1; m < body.length; m++) {
    if (body[m].trim() === ']') break;
    const mm = /"([^"]+)"/.exec(body[m]);
    if (mm) out.push(mm[1]);
  }
  return out;
}

// ---- CS:GO 事件 ----
const csgo = JSON.parse(fs.readFileSync(csgoPath, 'utf8')).events;

// ---- CS2 vpk ----
const vpk = new Set();
for (const line of fs.readFileSync(vpkListPath, 'utf8').split('\n')) {
  const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
  if (m) vpk.add(m[2]);
}

const rows = [];
for (const [name, [s, e]] of blocks) {
  const body = lines.slice(s, e + 1);
  const vsnd = readVsnd(body);
  const cg = csgo[name];
  const cgWavs = cg ? cg.waves : null;
  // CS:GO wav -> CS2 的 vsnd 路径：sounds/ 前缀 + 扩展名 .vsnd
  const csvsnd = cgWavs ? cgWavs.map((w) => 'sounds/' + w.replace(/\.wav$/i, '.vsnd')) : null;
  // VPK 里是编译产物 xxx.vsnd_c；源码里引用的是 xxx.vsnd
  const present = csvsnd ? csvsnd.map((p) => vpk.has(p + '_c')) : null;
  rows.push({
    event: name,
    cs2_vsnd: vsnd,
    csgo_has: !!cg,
    csgo_wavs: cgWavs,
    csgo_vsnd: csvsnd,
    cs2_has_csgo_file: present,
  });
}

const stats = {
  total: rows.length,
  weaponPrefix: rows.filter((r) => /^Weapon_/.test(r.event)).length,
  csgoMatched: rows.filter((r) => r.csgo_has).length,
  csgoMissing: rows.filter((r) => !r.csgo_has).map((r) => r.event),
  samePath: rows.filter((r) => r.cs2_vsnd && r.csgo_vsnd &&
    r.cs2_vsnd.length === r.csgo_vsnd.length &&
    r.cs2_vsnd.every((v, i) => v === r.csgo_vsnd[i])).length,
  allFilesPresent: rows.filter((r) => r.cs2_has_csgo_file && r.cs2_has_csgo_file.every(Boolean)).length,
  someMissing: rows.filter((r) => r.cs2_has_csgo_file && r.cs2_has_csgo_file.some((x) => !x)).length,
};

fs.writeFileSync(outPath, JSON.stringify({ stats, rows }, null, 1), 'utf8');
console.log('事件总数:', stats.total, ' Weapon_*:', stats.weaponPrefix);
console.log('CS:GO 有同名事件:', stats.csgoMatched, ' 缺:', stats.csgoMissing.length);
console.log('CS2 引用路径与 CS:GO 完全一致:', stats.samePath);
console.log('CS:GO 音频在 CS2 客户端里全都有:', stats.allFilesPresent);
console.log('有缺失文件的:', stats.someMissing);
if (stats.csgoMissing.length) console.log('缺失事件:', stats.csgoMissing.slice(0, 40).join(', '));
console.log('输出:', outPath);
