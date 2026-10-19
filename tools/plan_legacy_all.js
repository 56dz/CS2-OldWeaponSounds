#!/usr/bin/env node
// 汇总「全量旧音覆盖计划」：把 PCM 差异事件 + 35 把武器的 Single 事件合并成目标表，
// 并算出需要打进 addon 的 CS:GO wav 全集。
//
// 用法: node tools/plan_legacy_all.js \
//          data/csgo_ref/override_plan.json \
//          data/csgo_ref/csgo_events.json \
//          tools/legacy_map_full.json \
//          data/csgo_ref/legacy_all_plan.json \
//          [--gsw data/gsw.txt]
//
// --gsw：同时处理 CS2 的 `_Q` 变体事件。
// 背景：CS:GO 没有 `_Q` 事件，但 CS2 的 `_Q` 变体常常和主事件共用同一个 vsnd，
// 只是 volume 更低（如 AK47.BoltPull 与 AK47.BoltPull_Q 都指向 ak47_boltpull_01.vsnd，
// 后者 volume 0.5）。若只覆盖主事件，游戏播放 `_Q` 变体时听到的仍是 CS2 音频。
// 处理策略：`_Q` 变体继承主事件的 CS:GO wav，并保留自己的 volume。
'use strict';
const fs = require('fs');

const argv = process.argv.slice(2);
let gswPath = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--gsw') { gswPath = argv[++i]; continue; }
  if (argv[i].startsWith('--gsw=')) { gswPath = argv[i].split('=')[1]; continue; }
  positional.push(argv[i]);
}
const [planPath, eventsPath, legacyPath, outPath] = positional;
if (!planPath || !outPath) {
  console.error('用法: node tools/plan_legacy_all.js <override_plan.json> <csgo_events.json> <legacy_map_full.json> <out.json> [--gsw data/gsw.txt]');
  process.exit(1);
}

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const csgoEvents = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const legacyRaw = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
const legacyMap = Array.isArray(legacyRaw) ? legacyRaw : (legacyRaw.weapons || []);

const norm = (w) => w.replace(/\\/g, '/').replace(/^sound\//i, '');

// csgo_events.json 结构: { events: [...] } 或直接数组
const evRoot = csgoEvents.events || csgoEvents;
const eventList = Array.isArray(evRoot) ? evRoot : Object.values(evRoot);
const byName = new Map();
for (const ev of eventList) {
  if (!ev || !ev.name) continue;
  byName.set(ev.name, ev);
}

const targets = new Map();     // event -> { wavs: [rel], src: 'pcm'|'legacy'|'pcm+legacy' }
const notes = [];

for (const o of plan.overrides || []) {
  const wavs = (o.wavs || []).map(norm);
  if (!wavs.length) { notes.push(`跳过无 wav 事件: ${o.event}`); continue; }
  targets.set(o.event, { wavs, src: 'pcm', pcm_cls: o.pcm_cls });
}

// legacy_map_full.json 的 event 是武器级（如 Weapon_AK47），实际事件名是 <event>.Single
const legacyEvents = [];
for (const w of legacyMap) {
  let evName = w.event;
  if (!evName) { notes.push(`legacy 条目缺 event: ${JSON.stringify(w)}`); continue; }
  if (!evName.includes('.')) evName += '.Single';
  const ev = byName.get(evName);
  if (!ev || !Array.isArray(ev.waves) || !ev.waves.length) {
    notes.push(`CS:GO 事件缺失或无语 wav，跳过: ${evName}（legacy_map 条目 ${w.event}）`);
    continue;
  }
  legacyEvents.push(evName);
  const wavs = ev.waves.map(norm);
  const existing = targets.get(evName);
  if (existing) {
    existing.src = 'pcm+legacy';
    existing.legacy = true;
    // legacy 的选曲优先（上一 session 已用实机听感确认过）
    existing.wavs = wavs;
    existing.pcm_cls = existing.pcm_cls || null;
    continue;
  }
  targets.set(evName, { wavs, src: 'legacy', legacy: true, group: w.group });
}

// 收集所有需要的 wav
// ---- CS2 `_Q` 变体补全 ----
// 找出所有「主事件已被我们覆盖、但 _Q 变体没覆盖、且两者共用同一 vsnd」的事件
let qAdded = 0;
const qAddedList = [];
if (gswPath) {
  const gswLines = fs.readFileSync(gswPath, 'utf8').split(/\r?\n/);
  const blockRe = /^\t(\S[^\s=]*)\s*=\s*$/;
  const blocks = new Map();
  for (let i = 0; i < gswLines.length; i++) {
    const m = blockRe.exec(gswLines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < gswLines.length && gswLines[end].trim() !== '}') end++;
    blocks.set(m[1], gswLines.slice(i + 1, end));
  }
  const vsndOf = (lines) => {
    for (const l of lines) {
      const m = /^\t\tvsnd_files_track_0\d\s*=\s*"([^"]+)"/.exec(l);
      if (m) return m[1];
    }
    for (let i = 0; i < lines.length; i++) {
      if (/^\t\tvsnd_files_track_0\d\s*=/.test(lines[i])) {
        for (let j = i + 1; j < lines.length; j++) {
          const m = /"([^"]+)"/.exec(lines[j]);
          if (m) return m[1];
          if (/^\t\t\]/.test(lines[j])) break;
        }
      }
    }
    return null;
  };
  for (const name of blocks.keys()) {
    if (!name.endsWith('_Q')) continue;
    if (targets.has(name)) continue;              // 已覆盖
    if (byName.get(name)) continue;               // CS:GO 有同名事件 → 不该发生，跳过
    const base = name.slice(0, -2);
    const baseTarget = targets.get(base);
    if (!baseTarget) continue;                    // 主事件没被覆盖 → 无需处理
    const qVsnd = vsndOf(blocks.get(name));
    const baseVsnd = vsndOf(blocks.get(base));
    if (!qVsnd || qVsnd !== baseVsnd) continue;   // vsnd 不同 → 已是独立音频，不处理
    targets.set(name, { wavs: baseTarget.wavs.slice(), src: 'q-variant', base, volume_kept: true });
    qAdded++;
    qAddedList.push({ event: name, base, wavs: baseTarget.wavs.slice() });
  }
}

const wavSet = new Set();
for (const t of targets.values()) for (const w of t.wavs) wavSet.add(w);

const overrideEvents = (plan.overrides || []).map((o) => o.event).filter((e) => targets.has(e));
const result = {
  stats: {
    targets: targets.size,
    override_from_pcm: overrideEvents.length,
    legacy_weapons: legacyEvents.length,
    q_variants: qAdded,
    unique_wavs: wavSet.size,
    orig_blocks: legacyEvents.length,
  },
  events: Array.from(targets.entries()).map(([event, t]) => ({ event, wavs: t.wavs, src: t.src, pcm_cls: t.pcm_cls || null, legacy: !!t.legacy, base: t.base || null })),
  qVariants: qAddedList,
  legacyEvents,
  origBlocks: legacyEvents.map((e) => 'Orig_' + e),
  wavs: Array.from(wavSet).sort(),
  notes,
};
fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result.stats, null, 1));
if (notes.length) console.log('notes:\n  ' + notes.join('\n  '));
