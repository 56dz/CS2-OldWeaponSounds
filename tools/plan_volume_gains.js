#!/usr/bin/env node
/**
 * plan_volume_gains.js —— 生成「音量方案」（第 5 版：逐事件归一 + 后缀增益兜底）
 *
 * 用法:
 *   node tools/plan_volume_gains.js <gsw.txt> <csgo_events.json> <plan.json> <loudness.json> <out.json> [cap_db]
 *
 * 为什么要有这个工具（改动前务必读完，这是本项目最贵的教训）：
 *
 *   CS2 的 `volume` 是为 **CS2 自己重编码过的那份素材** 调的。我们把 vsnd 换成
 *   CS:GO 原始 wav 后，素材 RMS 变了，但 volume 没变 → 同一类工艺音（Draw / Clipin /
 *   Clipout …）在不同武器之间响度参差。实测以 CS2 原 volume 播放 CS:GO 素材：
 *       Draw 类有效响度 sd 4.6 dB、极差 20.2 dB
 *   这正是用户反复反馈的「a1/a4 等枪械切枪音忽大忽小」。
 *
 *   但也不能照抄 CS:GO 的 volume（第 3 版教训：AK47.Clipin 涨 3.3 倍、AWP 开镜涨 25 倍）。
 *   第 4 版试过「按后缀给一个统一增益 g_s」，均值保持不变，但同一后缀内部各武器素材
 *   的 RMS 差 12 dB，统一增益压不平（AWP.Draw 与 MP5.Draw 仍差 10 dB）。
 *
 *   第 5 版（本工具）改为**逐事件**求解，让「有效响度」在同一后缀内恒定：
 *
 *       eff(event) = 20log10(volume) + rms(wav)          ← 真正听到的响度
 *       volume = 10^((target_s - rms)/20)                ← target_s = 该后缀 CS2 平均有效响度
 *
 *   即「保持每一类音效在 CS2 里的整体响度水平不变，但把该类内部各武器拉到同一响度」。
 *   实测把 Draw 的 sd 从 4.6 → 1.3 dB、Clipin 5.3 → 1.4、Clipout 4.0 → 1.4，且
 *   任何单个事件的音量相对 CS2 原值变化不超过 cap_db（默认 6 dB），不会突然炸响。
 *
 *   没有实测 RMS 的事件（素材损坏/无法解析）退回第 4 版的「后缀增益」兜底。
 */
const fs = require('fs');

const [gswPath, csgoPath, planPath, loudPath, outPath, capArg] = process.argv.slice(2);
if (!outPath) {
  console.error('用法: node tools/plan_volume_gains.js <gsw.txt> <csgo_events.json> <plan.json> <loudness.json> <out.json> [cap_db]');
  process.exit(1);
}
const CAP = Number(capArg || 6);

// ---- 1. 建 gsw.txt 事件索引 ----
const gswLines = fs.readFileSync(gswPath, 'utf8').split(/\r?\n/);
const blockRe = /^\t(\S[^\s=]*)[ \t]*=[ \t]*$/;
const index = new Map();
for (let i = 0; i < gswLines.length; i++) {
  const m = blockRe.exec(gswLines[i]);
  if (!m) continue;
  let end = -1;
  for (let j = i + 1; j < gswLines.length; j++) {
    if (gswLines[j] === '\t}') { end = j; break; }
    if (blockRe.test(gswLines[j])) break;
  }
  if (end > 0) index.set(m[1], { start: i, end });
}

function fieldOf(event, name) {
  const hit = index.get(event);
  if (!hit) return null;
  const re = new RegExp(`^\t\t${name}[ \t]*=[ \t]*(.*)$`);
  for (let j = hit.start + 1; j <= hit.end; j++) {
    const m = re.exec(gswLines[j]);
    if (m) return m[1].trim();
  }
  return null;
}

/** "0.15, 0.25" → 均值 0.2；单值原样 */
function avgVolume(v) {
  if (v === null || v === undefined) return null;
  const parts = String(v)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

function suffixOf(event) {
  const i = event.indexOf('.');
  if (i < 0) return event;
  return event.slice(i + 1).replace(/_Q$/, '');
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const db = (v) => 20 * Math.log10(v);

// ---- 2. 素材响度表（wav 相对路径，小写化以便大小写不敏感匹配）----
const rmsByWav = new Map();
if (loudPath && fs.existsSync(loudPath)) {
  const L = JSON.parse(fs.readFileSync(loudPath, 'utf8'));
  for (const r of L.rows || []) rmsByWav.set(String(r.file).replace(/\\/g, '/').toLowerCase(), r.rms_db);
}
console.log(`素材响度表: ${rmsByWav.size} 个 wav`);

// ---- 3. 收集样本 ----
const csgoEvents = JSON.parse(fs.readFileSync(csgoPath, 'utf8')).events;
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

const rows = [];
let noVol = 0;
let noRms = 0;
for (const t of plan.events) {
  const cs2Vol = avgVolume(fieldOf(t.event, 'volume'));
  const cg = csgoEvents[t.event];
  const csgoVol = avgVolume(cg ? cg.volume : null);
  if (cs2Vol === null || csgoVol === null) { noVol++; continue; }
  const wavs = (t.wavs || []).map((w) => String(w).replace(/\\/g, '/').toLowerCase());
  const rs = wavs.map((w) => rmsByWav.get(w)).filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!rs.length) { noRms++; rows.push({ event: t.event, s: suffixOf(t.event), cs2Vol, csgoVol, rms: null }); continue; }
  rows.push({ event: t.event, s: suffixOf(t.event), cs2Vol, csgoVol, rms: mean(rs) });
}

// ---- 4. 逐后缀：目标有效响度 ----
const bySuffix = new Map();
for (const r of rows) {
  if (!bySuffix.has(r.s)) bySuffix.set(r.s, []);
  bySuffix.get(r.s).push(r);
}

const suffixes = {};
const eventVolumes = {};
const STAT = { clamped: 0, capped: 0, gainFallback: 0, changed: 0 };

for (const [s, xs] of bySuffix) {
  const measured = xs.filter((r) => r.rms !== null);
  // 目标：该后缀在 CS2 下的平均有效响度（只统计可测事件）
  const target = measured.length
    ? mean(measured.map((r) => db(r.cs2Vol) + r.rms))
    : mean(xs.map((r) => db(r.cs2Vol)));

  // 兜底增益（无 RMS 事件用）：保均值搬比例，迭代修正 clamp 偏差
  let g = Math.pow(10, (mean(xs.map((r) => db(r.cs2Vol))) - mean(xs.map((r) => db(r.csgoVol)))) / 20);
  for (let it = 0; it < 6; it++) {
    const cur = mean(xs.map((r) => db(Math.min(1, Math.max(0.005, r.csgoVol * g)))));
    g *= Math.pow(10, (mean(xs.map((r) => db(r.cs2Vol))) - cur) / 20);
  }

  const lim = Math.pow(10, CAP / 20);
  let sdBefore = 0;
  let sdAfter = 0;
  if (measured.length > 1) {
    const b = measured.map((r) => db(r.cs2Vol) + r.rms);
    sdBefore = Math.sqrt(mean(b.map((x) => (x - mean(b)) ** 2)));
  }
  const afterEff = [];
  for (const r of xs) {
    let v;
    if (r.rms !== null) {
      v = Math.pow(10, (target - r.rms) / 20); // 逐事件归一
      STAT.clamped += v >= 1 ? 1 : 0;
      // 相对 CS2 原值的限幅，防止单事件突变
      const lo = r.cs2Vol / lim;
      const hi = r.cs2Vol * lim;
      if (v > hi) STAT.capped++;
      if (v < lo) STAT.capped++;
      v = Math.min(hi, Math.max(lo, v));
      v = Math.min(1, Math.max(0.005, v));
      afterEff.push(db(v) + r.rms);
    } else {
      v = Math.min(1, Math.max(0.005, r.csgoVol * g));
      STAT.gainFallback++;
    }
    eventVolumes[r.event] = Number(v.toFixed(6));
    if (Math.abs(v - r.cs2Vol) > 1e-6) STAT.changed++;
    else delete eventVolumes[r.event];
  }
  if (afterEff.length > 1) {
    sdAfter = Math.sqrt(mean(afterEff.map((x) => (x - mean(afterEff)) ** 2)));
  }
  suffixes[s] = {
    gain: Number(g.toFixed(4)),
    n: xs.length,
    measured: measured.length,
    target_db: Number(target.toFixed(2)),
    mean_cs2_db: Number(mean(xs.map((r) => db(r.cs2Vol))).toFixed(2)),
    sd_eff_before: Number(sdBefore.toFixed(2)),
    sd_eff_after: Number(sdAfter.toFixed(2)),
  };
}

const report = {
  _说明:
    '音量方案 v5：逐事件把「有效响度」= 20log10(volume)+rms(wav) 归一到该事件后缀在 CS2 下的平均值，' +
    `并限制单个事件相对 CS2 原 volume 的变化不超过 ±${CAP} dB（上限 1.0）。` +
    'events 里的值是最终绝对 volume（已 clamp），未列出的保留 CS2 原值。' +
    'suffixes[*].gain 仅作无 RMS 事件的兜底。由 tools/plan_volume_gains.js 生成，勿手改。',
  _generatedBy: 'tools/plan_volume_gains.js',
  _params: { cap_db: CAP, rms_source: loudPath || null },
  _samples: { events: rows.length, skipped_no_volume: noVol, no_rms: noRms, suffixes: Object.keys(suffixes).length, ...STAT },
  suffixes,
  events: Object.fromEntries(Object.entries(eventVolumes).sort(([a], [b]) => a.localeCompare(b))),
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

// ---- 5. 报告 ----
const sorted = Object.entries(suffixes).sort((a, b) => b[1].n - a[1].n);
console.log(`样本事件: ${rows.length}（无 CS:GO 音量 ${noVol} / 无实测 RMS ${noRms}）  后缀: ${sorted.length}  cap: ±${CAP} dB`);
console.log('后缀                    n  实测   sd_eff前  sd_eff后   target   兜底gain');
for (const [s, v] of sorted) {
  console.log(
    s.padEnd(22),
    String(v.n).padStart(3),
    String(v.measured).padStart(4),
    String(v.sd_eff_before).padStart(9),
    String(v.sd_eff_after).padStart(9),
    String(v.target_db).padStart(9),
    String(v.gain).padStart(9)
  );
}
console.log(`\n写入 events: ${Object.keys(eventVolumes).length} 条（改动 ${STAT.changed}）`);
console.log(`clamp 到 1.0: ${STAT.clamped}   被 ±${CAP}dB 限幅: ${STAT.capped}   无 RMS 走兜底 gain: ${STAT.gainFallback}`);
