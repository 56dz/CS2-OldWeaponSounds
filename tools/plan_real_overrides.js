#!/usr/bin/env node
// 生成「真正需要覆盖」的目标清单（取代 legacy_all_plan.json）
//
// 判定原则（每一条都有实测依据，改动前务必读懂）：
//
//  1) 开火音（*.Single）
//     CS2 客户端里同名 vsnd_c 是否内嵌 CS:GO 原 PCM，见
//     data/csgo_ref/single_embed_check.json（用 tools/probe_single_embed.js 生成）。
//       内嵌 → 音色本来就是 CS:GO 的，**不覆盖**（覆盖只会引入音量/变体风险）
//       未内嵌 → CS2 重编码过（Glock/XM1014/FAMAS/AK47/Revolver 这 5 把），**必须覆盖 + 自带 wav**
//
//  2) 工艺音（Clipin/Clipout/BoltPull/Draw/Zoom/Insertshell/Taunt...）
//     判断 CS2 当前 vsnd 与 CS:GO wave 是否是同一个音：
//       文件名基名相同（去掉 _01/_02 数字后缀）→ 同一个音，**不覆盖**
//       CS2 用了通用共享音（magazine_slide_01 / movementN / weapon_zoom_out_N）
//       而 CS:GO 有该武器专属音 → **覆盖**（这是用户最直观能听出的「旧音回归」）
//       素材确实不同（ssg08_hit_01 vs ssg08_cliphit 等）→ **覆盖**
//
//  3) CS:GO 没有对应事件（_Q 变体、CS2 新增检视音）→ 完全不碰
//
// 输出：覆盖事件清单，字段 {event, wavs, why}
//
// 用法:
//   node tools/plan_real_overrides.js data/gsw.txt data/csgo_ref/csgo_events.json \
//        data/csgo_ref/single_embed_check.json data/csgo_ref/plan_real.json
'use strict';
const fs = require('fs');

const [gswPath, csgoEvPath, embedPath, outPath] = process.argv.slice(2);
if (!gswPath || !csgoEvPath || !embedPath || !outPath) {
  console.error('用法: node tools/plan_real_overrides.js <gsw.txt> <csgo_events.json> <single_embed_check.json> <out.json>');
  process.exit(1);
}

const gsw = fs.readFileSync(gswPath, 'utf8').split(/\r?\n/);
const csgo = JSON.parse(fs.readFileSync(csgoEvPath, 'utf8')).events;
const embed = JSON.parse(fs.readFileSync(embedPath, 'utf8'));
// 内嵌检测结果：event → true(内嵌,无需覆盖) / false(需覆盖)
const embedByEvent = new Map();
for (const r of embed) if (r.ev) embedByEvent.set(r.ev, { embedded: r.embedded, full: r.full });

// ---- CS2 侧事件索引 ----
const blockRe = /^\t(\S[^\s=]*)\s*=\s*$/;
const idx = [];
for (let i = 0; i < gsw.length; i++) {
  const m = blockRe.exec(gsw[i]);
  if (m) idx.push({ i, n: m[1] });
}
const idxByName = new Map(idx.map((x) => [x.n, x]));

/** 读出 CS2 某事件当前的 vsnd 列表 */
function cs2Vsnds(name) {
  const e = idxByName.get(name);
  if (!e) return null;
  const out = [];
  for (let j = e.i + 1; j < gsw.length; j++) {
    if (/^\t\}$/.test(gsw[j])) break;
    const m = /^\t\tvsnd_files_track_0\d+\s*=\s*(.*)$/.exec(gsw[j]);
    if (!m) continue;
    const rest = m[1].trim();
    if (rest.startsWith('"')) { out.push(rest.replace(/"/g, '')); return out; }
    let sawOpen = rest.includes('[');
    for (let k = j + 1; k < gsw.length; k++) {
      const t = gsw[k].trim();
      if (t === '') continue;
      if (!sawOpen) { if (t.startsWith('[')) { sawOpen = true; continue; } return out; }
      if (t.startsWith(']')) return out;
      if (t.startsWith('"')) { out.push(t.replace(/^"/, '').replace(/"\,?$/, '')); continue; }
      return out;
    }
    return out;
  }
  return out;
}

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^sound\//i, '');
const baseName = (p) =>
  norm(p)
    .replace(/^.*\//, '')
    .replace(/\.(vsnd|wav)$/i, '')
    .replace(/_?\d+$/, '')
    .toLowerCase();

// CS2 里那些「通用共享音」——不是该武器专属，换成 CS:GO 专属音明显是收益
const GENERIC = /^(magazine_slide|movement\d|weapon_zoom_out|weapon_zoom_in|bullet_ric)/;

// 明确排除的事件（不属于武器装备音，改了会影响地图/环境）：
//   BaseExplosionEffect.Sound —— type=src1_3d，用 vsnd_files 单字段（不是 vsnd_files_track_01），
//   是地图油桶/气罐爆炸的通用音。CS:GO 的对应 wave 是 debris1/debris2（碎石），
//   换上去声音会完全不对，且它和「武器音效」无关，不覆盖。
const EXCLUDE = new Set(['BaseExplosionEffect.Sound']);

const overrides = [];
const skipped = { fire_same: [], craft_same: [], generic_kept: [], no_csgo: [] };

for (const ev of idx.map((x) => x.n)) {
  if (EXCLUDE.has(ev)) { skipped.no_csgo.push(ev); continue; }
  const cg = csgo[ev];
  if (!cg || !cg.waves || !cg.waves.length) { skipped.no_csgo.push(ev); continue; }
  const cur = cs2Vsnds(ev);
  if (!cur) continue;
  const wavs = cg.waves.map(norm);

  // ---- 1) 开火音 ----
  if (/\.Single$/.test(ev)) {
    const em = embedByEvent.get(ev);
    if (em && em.embedded) { skipped.fire_same.push(ev); continue; }
    // 未内嵌 或 没有检测数据 → 覆盖（保守起见：检测不到就当需要覆盖）
    overrides.push({ event: ev, wavs, why: em ? 'CS2重编码开火音' : '无内嵌检测数据' });
    continue;
  }

  // ---- 2) 工艺音 ----
  const curGeneric = cur.some((x) => GENERIC.test(baseName(x)));
  const curSet = new Set(cur.map(baseName));
  const goSet = new Set(wavs.map(baseName));
  const sameFiles = curSet.size === goSet.size && [...curSet].every((x) => goSet.has(x));
  if (sameFiles && !curGeneric) { skipped.craft_same.push(ev); continue; }
  overrides.push({
    event: ev,
    wavs,
    why: curGeneric ? 'CS2用通用音' : '素材不同',
  });
}

// ---- 统计 ----
const byWhy = {};
for (const o of overrides) byWhy[o.why] = (byWhy[o.why] || 0) + 1;
const allWavs = new Set();
for (const o of overrides) for (const w of o.wavs) allWavs.add(w);

const out = {
  _说明:
    '真正需要覆盖的事件清单。开火音按 CS2 是否内嵌 CS:GO PCM 判定；工艺音按文件名基名/通用音判定。',
  stats: {
    overrides: overrides.length,
    by_why: byWhy,
    unique_wavs: allWavs.size,
    skipped_fire_same: skipped.fire_same.length,
    skipped_craft_same: skipped.craft_same.length,
    skipped_no_csgo: skipped.no_csgo.length,
  },
  events: overrides,
  wavs: [...allWavs].sort(),
  skipped: skipped,
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));

console.log(
  JSON.stringify(
    {
      overrides: overrides.length,
      by_why: byWhy,
      unique_wavs: allWavs.size,
      '跳过-开火音本来一致': skipped.fire_same.length,
      '跳过-工艺音本来一致': skipped.craft_same.length,
      '跳过-CSGO无此事件': skipped.no_csgo.length,
      outPath,
    },
    null,
    1
  )
);
