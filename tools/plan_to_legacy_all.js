#!/usr/bin/env node
// 把 plan_real.json 转成 build_legacy_all.js 能直接吃的 legacy_all_plan 格式
//
// build_legacy_all.js 需要的结构：
//   { events: [{event, wavs, src, ...}], legacyEvents: [...], wavs: [...] }
//
// 本脚本额外产出 legacyEvents（Orig_ 回退块）：只有「35 把主武器的 .Single」
// 才生成 Orig_ 块，供 CSS 插件按武器开关旧音时回退到 CS2 原音。
//
// 用法:
//   node tools/plan_to_legacy_all.js data/csgo_ref/plan_real.json \
//        tools/legacy_map_full.json data/csgo_ref/legacy_all_plan.json
'use strict';
const fs = require('fs');

const [realPath, legacyMapPath, outPath] = process.argv.slice(2);
if (!realPath || !legacyMapPath || !outPath) {
  console.error('用法: node tools/plan_to_legacy_all.js <plan_real.json> <legacy_map_full.json> <out.json>');
  process.exit(1);
}

const real = JSON.parse(fs.readFileSync(realPath, 'utf8'));
const legacy = JSON.parse(fs.readFileSync(legacyMapPath, 'utf8'));
const weapons = legacy.weapons || legacy;

// 覆盖清单
const events = real.events.map((e) => ({
  event: e.event,
  wavs: e.wavs,
  src: 'real_need',
  pcm_cls: e.why,
  legacy: false,
}));

// Orig_ 回退块：只对「确实被覆盖了」的主武器 .Single 生成
const overridden = new Set(events.map((e) => e.event));
const legacyEvents = [];
for (const w of weapons) {
  const ev = w.event.includes('.') ? w.event : w.event + '.Single';
  if (overridden.has(ev)) legacyEvents.push(ev);
}

const wavs = [...new Set(events.flatMap((e) => e.wavs))].sort();

const out = {
  _说明:
    '只含「CS2 确实变了音」的事件（保守方案）。生成自 tools/plan_real_overrides.js → plan_to_legacy_all.js。',
  stats: {
    targets: events.length,
    legacy_weapons: legacyEvents.length,
    unique_wavs: wavs.length,
  },
  events,
  legacyEvents,
  wavs,
  notes: [
    '开火音：CS2 内嵌 CS:GO 原 PCM 的 30 个不覆盖；仅 Glock/XM1014/FAMAS/AK47/Revolver 覆盖',
    '工艺音：CS2 用通用音（magazine_slide/movement）或有专属旧音的才覆盖',
    '音量：直接照搬 CS:GO 原值，不乘任何响度补偿；开镜类保留 CS2 值',
  ],
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(
  JSON.stringify({ targets: events.length, legacy_weapons: legacyEvents.length, unique_wavs: wavs.length, outPath }, null, 1)
);
console.log('legacyEvents: ' + legacyEvents.join(', '));
