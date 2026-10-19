#!/usr/bin/env node
// 对比「CS2 原事件时长」vs「CS:GO 素材时长」，找出时长严重不匹配的事件。
//
// 为什么重要：CS2 换音时把很多动作音做长了（例如 ak47_clipout_01.vsnd 0.727s，
// 而 CS:GO ak47_clipout.wav 只有 0.189s）。动画窗口按长音设计，换短音后
// 剩余时间静音 → 主观听感「没声音 / 声音没了」。
//
// 用法: node tools/cmp_durations.js <gsw.txt> <legacy_all_plan.json> <wav_durations.json> <out.json>
'use strict';
const fs = require('fs');

const [gswPath, planPath, durPath, outPath] = process.argv.slice(2);
if (!gswPath || !planPath || !durPath || !outPath) {
  console.error('用法: node tools/cmp_durations.js <gsw.txt> <legacy_all_plan.json> <wav_durations.json> <out.json>');
  process.exit(1);
}

// --- CS2 侧：事件 → vsnd_duration ---
const lines = fs.readFileSync(gswPath, 'utf8').split(/\r?\n/);
const cs2dur = new Map();
const cs2vol = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = /^\t(\S+)\s*=\s*$/.exec(lines[i]);
  if (!m) continue;
  let d = 0;
  let v = null;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j] === '\t}') break;
    const dm = /^\t\tvsnd_duration\s*=\s*([0-9.]+)/.exec(lines[j]);
    if (dm) d = parseFloat(dm[1]);
    const vm = /^\t\tvolume\s*=\s*([0-9.]+)/.exec(lines[j]);
    if (vm) v = parseFloat(vm[1]);
  }
  cs2dur.set(m[1], d);
  cs2vol.set(m[1], v);
}

// --- CS:GO 素材时长 ---
// plan 里的 wavs 是相对 sound/ 的路径（如 weapons/ak47/ak47_01.wav），
// 时长表里的 wav 字段也是相对 wavout 根（同样是相对 sound/）。
// 两边统一去掉前缀后匹配。
const normKey = (p) => String(p).replace(/^sound\//i, '').replace(/^\.\//, '');
const wavDur = new Map();
for (const r of JSON.parse(fs.readFileSync(durPath, 'utf8'))) {
  if (r.dur) wavDur.set(normKey(r.wav), r.dur);
}
console.log(`素材时长表: ${wavDur.size} 条`);

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

const rows = [];
for (const t of plan.events) {
  const d2 = cs2dur.get(t.event) || 0;
  // CS:GO 侧取时长最长的那个 wav（多 wav 事件是随机变体，动画窗口按最长算）
  let dg = 0;
  let anyMissing = false;
  for (const w of t.wavs || []) {
    const d = wavDur.get(normKey(w));
    if (d === undefined) { anyMissing = true; continue; }
    if (d > dg) dg = d;
  }
  if (!dg) continue;
  const ratio = d2 > 0 ? dg / d2 : 1;
  // 判定：CS:GO 素材比 CS2 短很多 → 静音尾巴；或长很多 → 可能被截断
  let cls = 'OK';
  if (ratio < 0.6) cls = 'SHORT';       // 换短音，尾部静音
  else if (ratio > 1.6) cls = 'LONG';   // 换长音，可能被截断
  rows.push({
    event: t.event,
    cs2_dur: +d2.toFixed(3),
    csgo_dur: +dg.toFixed(3),
    ratio: +ratio.toFixed(2),
    cls,
    cs2_vol: cs2vol.get(t.event),
    wavs: t.wavs,
    any_missing: anyMissing,
  });
}

const byCls = {};
for (const r of rows) byCls[r.cls] = (byCls[r.cls] || 0) + 1;

const report = { total: rows.length, byCls, rows };
fs.mkdirSync(require('path').dirname(require('path').resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 1) + '\n');

console.log(`对比 ${rows.length} 个事件 → ${outPath}`);
console.log(JSON.stringify(byCls, null, 1));

const short = rows.filter((r) => r.cls === 'SHORT').sort((a, b) => a.ratio - b.ratio);
if (short.length) {
  console.log('\n=== CS:GO 素材明显更短（换后尾部静音，听感像“没声音”）===');
  for (const r of short) {
    console.log(
      r.event.padEnd(32),
      `CS2 ${String(r.cs2_dur).padEnd(6)}s → GO ${String(r.csgo_dur).padEnd(6)}s`,
      `(${r.ratio}x)`,
      r.wavs.map((w) => w.split('/').pop()).join(',')
    );
  }
}

const long = rows.filter((r) => r.cls === 'LONG').sort((a, b) => b.ratio - a.ratio);
if (long.length) {
  console.log('\n=== CS:GO 素材明显更长（可能被截断）===');
  for (const r of long) {
    console.log(
      r.event.padEnd(32),
      `CS2 ${String(r.cs2_dur).padEnd(6)}s → GO ${String(r.csgo_dur).padEnd(6)}s`,
      `(${r.ratio}x)`,
      r.wavs.map((w) => w.split('/').pop()).join(',')
    );
  }
}
