#!/usr/bin/env node
'use strict';
/**
 * 生成「需要从 CS:GO 提取的 wav 清单」以及「需要从 CS2 提取的 vsnd_c 清单」。
 *
 * 范围：所有 CS2 里存在、且 CS:GO 里也有同名定义的 Weapon_* / Weapon.* / Default.* 事件。
 * 对每个事件：
 *   - CS:GO 侧 wave 列表 -> 需要 CS:GO 的 wav（sound/<path>.wav）
 *   - CS2  侧 vsnd 列表 -> 需要 CS2 的 vsnd_c（<path>_c）
 *
 * 两份清单都是「路径集合」，供后续从 VPK 批量提取后做 PCM 内容比对。
 *
 * 用法:
 *   node build_manifest.js <gsw.txt> <csgo_events.json> <csgo_vpk_list.txt> <cs2_vpk_list.txt> <out_dir>
 *
 * 产物:
 *   <out_dir>/csgo_wav_list.txt    每行一个 VPK 内路径（sound/weapons/xxx/yyy.wav）
 *   <out_dir>/cs2_vsnd_list.txt    每行一个 VPK 内路径（sounds/weapons/xxx/yyy.vsnd_c）
 *   <out_dir>/pairs.json           [{ event, wav, vsnd }]  用于 PCM 比对
 *   <out_dir>/events.json          全量事件表（含分类）
 */
const fs = require('fs');

const [gswPath, csgoPath, csgoVpkPath, cs2VpkPath, outDir] = process.argv.slice(2);
if (!outDir) {
  console.error('用法: node build_manifest.js <gsw.txt> <csgo_events.json> <csgo_vpk_list.txt> <cs2_vpk_list.txt> <out_dir>');
  process.exit(64);
}

// ---------- CS2 事件 ----------
const lines = fs.readFileSync(gswPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
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
  if (vi < 0) return null;
  if (/vsnd_files_track_01\s*=\s*"/.test(body[vi])) {
    const m = /"([^"]+)"/.exec(body[vi]);
    return m ? [m[1]] : [];
  }
  let k = vi + 1;
  while (k < body.length && body[k].trim() === '') k++;
  if (!body[k] || body[k].trim() !== '[') return null;
  const out = [];
  for (let m = k + 1; m < body.length; m++) {
    if (body[m].trim() === ']') break;
    const mm = /"([^"]+)"/.exec(body[m]);
    if (mm) out.push(mm[1]);
  }
  return out;
}

// ---------- CS:GO 事件 ----------
const csgo = JSON.parse(fs.readFileSync(csgoPath, 'utf8')).events;

// ---------- VPK 清单 ----------
function loadVpk(p) {
  const set = new Map(); // 小写 -> 真实路径
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) set.set(m[2].toLowerCase(), m[2]);
  }
  return set;
}
const csgoVpk = loadVpk(csgoVpkPath);
const cs2Vpk = loadVpk(cs2VpkPath);

// ---------- 主循环 ----------
const SCOPE = /^(Weapon_|Weapon\.|Default\.)/;
const wavSet = new Map();   // csgo 路径 -> true
const vsndSet = new Map();  // cs2 路径 -> true
const pairs = [];
const events = [];
const stats = { total: 0, inScope: 0, noCsgo: 0, noVsnd: 0, shippedWav: 0, missingCsgoWav: 0, missingCs2Vsnd: 0 };

for (const [name, [s, e]] of blocks) {
  stats.total++;
  if (!SCOPE.test(name)) continue;
  stats.inScope++;
  const body = lines.slice(s, e + 1);
  const cur = readVsnd(body);
  const cg = csgo[name];
  if (!cur) { stats.noVsnd++; events.push({ event: name, cls: 'NO_VSND' }); continue; }
  if (!cg) { stats.noCsgo++; events.push({ event: name, cls: 'NO_CSGO', cs2_vsnd: cur }); continue; }

  const wavs = cg.waves.map((w) => 'sound/' + w.replace(/\.wav$/i, '.wav');
  void 0;
}
