#!/usr/bin/env node
// 生成「全量旧音」版 soundevents_addon.vsndevts
//
// 思路：对每个目标事件，从 CS2 原版 gsw.txt 里原样取块（保留全部 3D/曲线/混音字段），
// 只把 vsnd_files_track_01 替换成 CS:GO 的音频；另外为 35 把武器生成 Orig_ 回退块。
//
// 用法:
//   node tools/build_legacy_all.js data/gsw.txt data/csgo_ref/legacy_all_plan.json \
//        data/out/soundevents_addon.vsndevts [--csgo-volume data/csgo_ref/csgo_events.json] \
//        [--loudness data/csgo_ref/loudness_by_suffix.json]
//
// --csgo-volume：把覆盖块的 volume 换成 CS:GO 原事件音量。
// 必要性：CS2 原块里的 volume 是为 CS2 自己的音频调的，部分事件被压得极低
// （例如所有武器的 Clipin：AK47 0.3 / SCAR20 0.15 / FAMAS 0.2，而 CS:GO 都是 1.0），
// 换成 CS:GO 原音后沿用 CS2 音量 → 换弹声几乎听不见。
//
// --loudness（诊断用）：加载各事件类型的素材平均响度表，仅用于日志输出，
// **不参与音量计算**。历史教训：用「全局目标 dB」做归一化会把开镜音
// 从 0.1 提到 2.5（25 倍，比 CS2 原版响 34dB），彻底破坏强弱层次。
// 正确做法是直接用 CS:GO 配套的音量（见 resolveVolume）。
'use strict';
const fs = require('fs');

const argv = process.argv.slice(2);
let csgoVolumePath = null;
let loudnessPath = null;
let wavDir = null;
let gainsPath = null;
let excludePath = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--gains') { gainsPath = argv[++i]; continue; }
  if (argv[i].startsWith('--gains=')) { gainsPath = argv[i].split('=')[1]; continue; }
  if (argv[i] === '--csgo-volume') { csgoVolumePath = argv[++i]; continue; }
  if (argv[i].startsWith('--csgo-volume=')) { csgoVolumePath = argv[i].split('=')[1]; continue; }
  if (argv[i] === '--loudness') { loudnessPath = argv[++i]; continue; }
  if (argv[i].startsWith('--loudness=')) { loudnessPath = argv[i].split('=')[1]; continue; }
  if (argv[i] === '--wav-dir') { wavDir = argv[++i]; continue; }
  if (argv[i].startsWith('--wav-dir=')) { wavDir = argv[i].split('=')[1]; continue; }
  if (argv[i] === '--exclude') { excludePath = argv[++i]; continue; }
  if (argv[i].startsWith('--exclude=')) { excludePath = argv[i].split('=')[1]; continue; }
  positional.push(argv[i]);
}
const [gswPath, planPath, outPath] = positional;
if (!gswPath || !planPath || !outPath) {
  console.error('用法: node tools/build_legacy_all.js <gsw.txt> <legacy_all_plan.json> <out.vsndevts> [--csgo-volume <csgo_events.json>] [--loudness <loudness_by_suffix.json>]');
  process.exit(1);
}

// 音量归一化参数（结论见下方 resolveVolume 的完整说明）
// 设计依据：不要用「全局目标 dB」，因为 CS:GO 素材类型间响度差异是**设计意图**
// （开镜 -33.7dB / 装弹 -34dB 本来就是轻音；Clipout -23dB 中等；Single -19dB 响）。
// 用全局目标会把开镜音放大到离谱（AWP.Zoom 0.1→2.5 = 25 倍）。
//
// 正确做法：以 CS:GO 原生音量为基准（它已经和 CS:GO 素材配套）。
// 但**不是所有事件都改**——开镜（Zoom/ZoomIn/ZoomOut）在 CS2 里被刻意压到极低
// （AWP 0.1、G3SG1 0.05），CS2 配的是重编码的更响素材，最终有效响度已经合适。
// 换成 CS:GO 素材后若照搬 CS:GO 的 1.0，反而可能过头。而开镜音轻本来就正常，
// 不改它也听不出问题；改错了却是明显 bug。故开镜类**保留 CS2 原音量**。
// 常量 CSGO_VOL_CAP / volumeGains 已在 resolveVolume 之前声明。

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const csgoEvents = csgoVolumePath
  ? JSON.parse(fs.readFileSync(csgoVolumePath, 'utf8')).events
  : null;

// 载入素材响度表：后缀 → 平均 dBFS（用于响度补偿）
const loudnessBySuffix = new Map();
if (loudnessPath) {
  const raw = JSON.parse(fs.readFileSync(loudnessPath, 'utf8'));
  for (const s of raw.summary || []) loudnessBySuffix.set(s.suffix, s.avg_db);
  console.log(`素材响度表: ${loudnessBySuffix.size} 个事件类型（仅诊断用）`);
}

/** 事件名 → 一级后缀（去 _Q） */
function suffixOf(event) {
  const i = event.indexOf('.');
  if (i < 0) return event;
  return event.slice(i + 1).replace(/_Q$/, '');
}

/**
 * 决定最终音量。
 *
 * 【最终策略（第 5 版，当前）】逐事件把「有效响度」归一到同后缀的 CS2 平均水平：
 *
 *     eff(event) = 20log10(volume) + rms(wav)              ← 真正听到的响度
 *     volume     = 10^((target_suffix - rms)/20)           ← target = 该后缀 CS2 平均 eff
 *
 *   并限制单事件相对 CS2 原 volume 的变化不超过 ±6 dB、上限 1.0。
 *   方案的绝对音量表由 tools/plan_volume_gains.js 生成（tools/volume_gains.json），
 *   本文件只负责应用；表里没有的事件退回「CS:GO 音量 × 后缀兜底增益」。
 *
 * 为什么必须这么做（四版实机反馈换来的教训）：
 *   第 1 版「全局目标 dB 归一化」→ AWP 开镜音放大 25 倍，报废。
 *   第 2 版「照抄 CS:GO 音量 × 素材响度补偿(≤2.5x)」→ AK47.Clipin 放大 15 倍，
 *     用户报「a1/a4 切枪音忽大忽小」「AK 切枪不完整」「USP 切枪有问题」。
 *   第 3 版「纯保留 CS2 音量」→ 更糟：CS2 的 volume 是为**CS2 自己那份素材**
 *     调的，换音源后同一类工艺音在武器间响度参差（实测 Draw 类有效响度极差 20dB）。
 *   第 4 版「按后缀给统一增益」→ 均值保住了，但同后缀内部各武器素材 RMS 差 12dB，
 *     统一增益压不平（AWP.Draw 与 MP5.Draw 仍差 10dB）。
 *   第 5 版（本策略）逐事件归一实测：Draw sd 4.63→1.27dB、Clipin 5.27→1.45、
 *     Clipout 3.96→1.40、Slideback 5.26→0.48、BoltBack 3.07→0.66，且整体响度不变。
 *
 * 关键点：不是「照抄 CS:GO 音量」，也不是「保留 CS2 音量」，而是按素材实测 RMS
 * 反解出「让同类音效听起来一样响」的音量——所以既不会忽大忽小，也不会整体炸响。
 */
const CSGO_VOL_CAP = 1.0;   // CS:GO 音量上限（CS:GO 原值最大就是 1.0）

// 音量方案（由 tools/plan_volume_gains.js 生成，勿手改）
//   events[事件名] = 最终绝对 volume（逐事件归一后的结果，优先使用）
//   suffixes[后缀].gain = 兜底增益（仅用于没有实测 RMS 的事件）
const volumePlan = (() => {
  if (!gainsPath) return null;
  const raw = JSON.parse(fs.readFileSync(gainsPath, 'utf8'));
  const ev = new Map(Object.entries(raw.events || {}));
  const su = new Map();
  for (const [s, v] of Object.entries(raw.suffixes || {})) su.set(s, v.gain);
  console.log(`音量方案: ${ev.size} 个逐事件音量, ${su.size} 个后缀兜底增益`);
  return { events: ev, suffixes: su };
})();

/** CS:GO 事件的音量（逗号列表取均值），无定义返回 null */
function csgoVolumeOf(event) {
  const cg = csgoEvents && csgoEvents[event];
  if (!cg || cg.volume === undefined || cg.volume === null) return null;
  const parts = String(cg.volume)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/**
 * 决定最终音量。
 *
 * @param event     事件名
 * @param cs2Vol    CS2 原版该事件的 volume（可能为 null）
 * @returns 新音量，或 null 表示「不改，保留 CS2 原值」
 */
function resolveVolume(event, cs2Vol) {
  const csgoVol = csgoVolumeOf(event);
  if (csgoVol === null) return null; // CS:GO 也没定义 → 什么都不改

  // CS2 音量异常（无定义 / <=0）→ 直接用 CS:GO 原音量救回来
  if (cs2Vol === null || cs2Vol === undefined || !(cs2Vol > 0)) {
    return Math.min(csgoVol, CSGO_VOL_CAP);
  }

  // 优先用逐事件归一后的绝对音量（有效响度对齐）
  const abs = volumePlan ? volumePlan.events.get(event) : undefined;
  let next;
  if (abs !== undefined) {
    next = Math.min(Math.max(Number(abs), 0), CSGO_VOL_CAP);
  } else {
    const gain = volumePlan ? volumePlan.suffixes.get(suffixOf(event)) : undefined;
    if (gain === undefined) return null; // 该后缀没有样本 → 保守不动
    next = Math.min(Math.max(csgoVol * gain, 0), CSGO_VOL_CAP);
  }
  if (Math.abs(next - cs2Vol) < 1e-6) return null; // 没变化就不写
  return next;
}
const gswLines = fs.readFileSync(gswPath, 'utf8').split(/\r?\n/);

// ---- 1. 建 gsw.txt 事件索引 ----
const blockRe = /^\t(\S[^\s=]*)\s*=\s*$/;
const index = new Map(); // event -> { start, end }  (end 含 '\t}' 行)
for (let i = 0; i < gswLines.length; i++) {
  const m = blockRe.exec(gswLines[i]);
  if (!m) continue;
  let end = -1;
  for (let j = i + 1; j < gswLines.length; j++) {
    if (gswLines[j] === '\t}') { end = j; break; }
    if (blockRe.test(gswLines[j])) break; // 防御：撞到下一个块
  }
  if (end < 0) { console.error(`块未闭合: ${m[1]} (行 ${i + 1})`); process.exit(2); }
  index.set(m[1], { start: i, end });
}
console.log(`gsw.txt 事件块: ${index.size}`);

// ---- 2. 工具函数 ----
const header = gswLines[0];
if (!header.startsWith('<!-- kv3')) {
  console.error(`gsw.txt 首行不是 kv3 头: ${header.slice(0, 80)}`);
  process.exit(2);
}

function getBlock(event) {
  const hit = index.get(event);
  if (!hit) return null;
  return gswLines.slice(hit.start, hit.end + 1).join('\n');
}

/** 收集一个块的字段行号偏移（含数组元素），返回去掉 vsnd 行后的行数组 */
function stripVsnd(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\t\tvsnd_files_track_0\d\s*=/.test(l)) {
      // 标量写法：整行去掉；数组写法：吞到与之配平的 ']'
      if (/=\s*$/.test(l)) {
        // 可能是 `[` 在下一行，也可能 `=` 后直接 '['
        let depth = 0;
        let j = i;
        for (; j < lines.length; j++) {
          const s = lines[j];
          depth += (s.match(/\[/g) || []).length;
          depth -= (s.match(/\]/g) || []).length;
          if (j > i && depth <= 0) break;
        }
        i = j;
      }
      continue;
    }
    out.push(l);
  }
  return out;
}

/**
 * 在块里定位 vsnd 字段所在位置并替换。
 * @param {string} block 原始块文本（\n 分隔）
 * @param {string[]} vsnds 形如 'sounds/weapons/ak47/ak47_01.vsnd'
 */
function replaceVsnd(block, vsnds) {
  const lines = block.split('\n');
  const startIdx = lines.findIndex((l) => /^\t\tvsnd_files_track_0\d\s*=/.test(l));
  if (startIdx < 0) {
    // 没有 vsnd 字段 → 插到 vsnd_duration 之前，或块尾
    const durIdx = lines.findIndex((l) => /^\t\tvsnd_duration\s*=/.test(l));
    const insertAt = durIdx >= 0 ? durIdx : lines.length - 1;
    const blockLines = [`\t\tvsnd_files_track_01 = [`, ...vsnds.map((v) => `\t\t\t"${v}",`), `\t\t]`];
    lines.splice(insertAt, 0, ...blockLines);
    return lines.join('\n');
  }

  const wasArray = /=\s*$/.test(lines[startIdx]) || /=\s*\[/.test(lines[startIdx]);
  if (!wasArray) {
    if (vsnds.length === 1) {
      lines[startIdx] = `\t\tvsnd_files_track_01 = "${vsnds[0]}"`;
    } else {
      // 原本是标量但目标有多个音源 → 展开成数组写法
      const newLines = [`\t\tvsnd_files_track_01 = `, `\t\t[`, ...vsnds.map((v) => `\t\t\t"${v}",`), `\t\t]`];
      lines.splice(startIdx, 1, ...newLines);
    }
    return lines.join('\n');
  }

  // 数组：找到配平的 ']' 行
  let depth = 0;
  let endIdx = -1;
  for (let j = startIdx; j < lines.length; j++) {
    depth += (lines[j].match(/\[/g) || []).length;
    depth -= (lines[j].match(/\]/g) || []).length;
    if (j > startIdx && depth <= 0) { endIdx = j; break; }
  }
  if (endIdx < 0) throw new Error('vsnd 数组未配平');

  const newLines = [`\t\tvsnd_files_track_01 = `, `\t\t[`, ...vsnds.map((v) => `\t\t\t"${v}",`), `\t\t]`];
  lines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
  return lines.join('\n');
}

function renameBlock(block, newName) {
  const lines = block.split('\n');
  lines[0] = `\t${newName} = `;
  return lines.join('\n');
}

/**
 * 重写块里的 soundevent_N 子事件引用（支持标量写法与 `=` 后换行数组写法）。
 *
 * 为什么需要：CS2 的 soundevent_01 既可能是
 *     soundevent_01 = "X"
 * 也可能是
 *     soundevent_01 = 
 *     [
 *         "A",
 *         "B",
 *     ]
 * 旧代码只处理标量形式，数组形式（Glock.Single 那种）根本匹配不到。
 *
 * @param fn 名字 → 新名字；返回 null 表示删除这一项
 */
function mapChildren(block, fn) {
  const lines = block.split('\n');
  let firstIdx = -1;
  let lastIdx = -1;
  const names = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\t\tsoundevent_\d+\s*=\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (firstIdx < 0) firstIdx = i;
    lastIdx = i;
    const rest = m[1].trim();
    if (rest.startsWith('"')) {
      names.push(rest.replace(/^"/, '').replace(/",?$/, ''));
      continue;
    }
    // 数组写法
    for (let j = i + 1; j < lines.length; j++) {
      const mm = /^\t\t\t"([^"]*)",?$/.exec(lines[j]);
      if (mm) names.push(mm[1]);
      if (/^\t\t\]/.test(lines[j])) { lastIdx = j; i = j; break; }
    }
  }
  if (firstIdx < 0) return block;

  const keep = [];
  let changed = false;
  for (const n of names) {
    if (n === '') { keep.push(''); continue; } // 空字符串是占位，原样保留
    const next = fn(n);
    if (next === null) { changed = true; continue; }
    if (next !== n) changed = true;
    if (next !== '') keep.push(next);
    else changed = true;
  }
  if (!changed) return block;

  let repl;
  if (keep.length === 0) repl = [];
  else if (keep.length === 1) repl = [`\t\tsoundevent_01 = "${keep[0]}"`];
  else repl = [`\t\tsoundevent_01 = `, '\t\t[', ...keep.map((k) => `\t\t\t"${k}",`), '\t\t]'];
  lines.splice(firstIdx, lastIdx - firstIdx + 1, ...repl);
  return lines.join('\n');
}

/**
 * 统计一个 gsw.txt 块里 vsnd_files_track_01 的音源变体数量。
 *
 * 为什么要这个：CS2 的开火音是多变体随机池（AK47.Single 有 ak47_02/01/04 三个，
 * M4A1.Single 有四个）。换成 CS:GO 素材时，如果 CS:GO 侧只有一个 wave
 * （CS:GO 的 Weapon_AK47.Single 就是单 wave），直接覆盖会把随机池压成 1 个，
 * 每次开火都一模一样 → 用户反馈「AK 声音假 / 不完整」。
 *
 * 对策见 fitVariants()。
 */
function countCs2Variants(event) {
  const hit = index.get(event);
  if (!hit) return 0;
  for (let j = hit.start + 1; j <= hit.end; j++) {
    const m = /^\t\tvsnd_files_track_0\d+\s*=\s*(.*)$/.exec(gswLines[j]);
    if (!m) continue;
    const rest = m[1].trim();
    if (rest.startsWith('"')) return 1;
    let n = 0;
    let sawOpen = rest.includes('[');
    for (let k = j + 1; k < hit.end; k++) {
      const t = gswLines[k].trim();
      if (t === '') continue;
      if (!sawOpen) {
        if (t.startsWith('[')) { sawOpen = true; continue; }
        return 1;
      }
      if (t.startsWith(']')) return n;
      if (t.startsWith('"')) n++;
      else return n;
    }
    return n;
  }
  return 0;
}

/** 读出 CS2 原版某事件当前使用的 vsnd 列表（用于「优先沿用 CS2 的选择」） */
function cs2VsndList(event) {
  const hit = index.get(event);
  if (!hit) return [];
  const outArr = [];
  for (let j = hit.start + 1; j <= hit.end; j++) {
    const m = /^\t\tvsnd_files_track_0\d+\s*=\s*(.*)$/.exec(gswLines[j]);
    if (!m) continue;
    const rest = m[1].trim();
    if (rest.startsWith('"')) { outArr.push(rest.replace(/"/g, '')); return outArr; }
    let sawOpen = rest.includes('[');
    for (let k = j + 1; k < hit.end; k++) {
      const t = gswLines[k].trim();
      if (t === '') continue;
      if (!sawOpen) {
        if (t.startsWith('[')) { sawOpen = true; continue; }
        return outArr;
      }
      if (t.startsWith(']')) return outArr;
      if (t.startsWith('"')) { outArr.push(t.replace(/^"/, '').replace(/"\,?$/, '')); continue; }
      return outArr;
    }
    return outArr;
  }
  return outArr;
}

/**
 * 把 CS:GO 的音源列表调整成 CS2 原有的变体数。
 *
 * - CS2 变体数 <= CS:GO 音源数：用前 n 个（多余的自然丢弃）
 * - CS2 变体数 >  CS:GO 音源数：循环重复填充到 n 个，保住随机池大小
 *
 * 例：AK47.Single CS2 有 3 个变体，CS:GO 只有 ak47_01.wav → 填成
 *     [ak47_01, ak47_01, ak47_01]，引擎在 3 个槽位里随机，配合该事件
 *     自带的 pitch_random_min/max 仍然有变化，但不再是死板的一个声。
 *
 * 反过来，Glock.Single CS2 只有 1 个变体（glock_02），CS:GO 有 2 个
 * （glock_01 + glock_02）→ 只取第一个。这条是用户反馈「格洛克开火音有误」
 * 的直接原因：曾经把 2 个都塞进去，CS2 里数组是随机池，但 CS2 原版
 * 精心只用了 glock_02，多塞一个 glock_01 让枪声忽而是另一把枪。
 *
 * @param cs2Prefer  CS2 原版该事件当前用的 vsnd 列表（用于「优先保留 CS2 的选择」）
 */
function fitVariants(vsnds, want, cs2Prefer) {
  if (!want || want <= 0) return vsnds;
  if (vsnds.length === 0) return vsnds;
  // 先把「CS2 原本就在用的那个音」提到最前面：
  // 若 CS:GO 的音源里包含 CS2 当前用的文件（按基名比对），说明两个源是同名同音，
  // CS2 既然选了这个，就沿用它的选择，不要换成同目录下另一个变体。
  let ordered = vsnds;
  if (cs2Prefer && cs2Prefer.length) {
    // 先按「完整文件名」精确匹配（glock_01 与 glock_02 是不同的音源，不能当同一个）
    const preferFile = fileNameOf(cs2Prefer[0]);
    let hit = ordered.findIndex((v) => fileNameOf(v) === preferFile);
    // 精确匹配不到时，再退回按基名（例如 ak47_01 vs ak47-1 这类命名差异）
    if (hit < 0) {
      const preferBase = baseNameOf(cs2Prefer[0]);
      hit = ordered.findIndex((v) => baseNameOf(v) === preferBase);
    }
    if (hit > 0) ordered = [ordered[hit], ...ordered.filter((_, i) => i !== hit)];
  }
  if (want === ordered.length) return ordered;
  const outArr = [];
  for (let i = 0; i < want; i++) outArr.push(ordered[i % ordered.length]);
  return outArr;
}

/** 取文件名基名（去目录、去扩展名、去尾部数字），用于比较「是否同一个音」 */
function baseNameOf(p) {
  return String(p)
    .replace(/\\/g, '/')
    .replace(/^.*\//, '')
    .replace(/\.(vsnd|wav)$/i, '')
    .replace(/_?\d+$/, '')
    .toLowerCase();
}

/** 取完整文件名（去目录、去扩展名，保留尾部数字），用于精确比较同一个音源 */
function fileNameOf(p) {
  return String(p)
    .replace(/\\/g, '/')
    .replace(/^.*\//, '')
    .replace(/\.(vsnd|wav)$/i, '')
    .toLowerCase();
}

// ---- wav 真实时长（用于修正 vsnd_duration） ----
// 为什么必须修正：CS2 原块的 vsnd_duration 是为 CS2 自己的音频写的。换成 CS:GO 素材后
// 长度通常不同（实测 88 个事件相差 >20ms，最悬殊 8 倍：SSG08.Clipin 真实 0.719s
// 却声明 0.089s，M4A1.Clipin 真实 0.416s 却声明 0.100s）。声明值偏小 → 声音被截断，
// 这正是「切枪音效不完整 / USP 切枪有问题」的直接原因；偏大 → 尾部留静音且白占
// instance_limit。
const wavDurCache = new Map();
function wavDuration(file) {
  if (wavDurCache.has(file)) return wavDurCache.get(file);
  let d = null;
  try {
    const buf = fs.readFileSync(file);
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
      let off = 12;
      let byteRate = 0;
      let dataLen = 0;
      while (off + 8 <= buf.length) {
        const id = buf.toString('ascii', off, off + 4);
        const sz = buf.readUInt32LE(off + 4);
        const body = off + 8;
        if (id === 'fmt ') byteRate = buf.readUInt32LE(body + 8);
        else if (id === 'data') { dataLen = Math.min(sz, buf.length - body); break; }
        off = body + sz + (sz % 2);
      }
      if (byteRate > 0 && dataLen > 0) d = dataLen / byteRate;
    }
  } catch (e) {
    d = null;
  }
  wavDurCache.set(file, d);
  return d;
}

/** 取一个 vsnd 对应的 CS:GO wav 在 wavDir 下的真实时长（找不到返回 null） */
function vsndDuration(vsndPaths, wavDir) {
  if (!wavDir) return null;
  const path = require('path');
  let max = null;
  for (const v of vsndPaths) {
    const rel = v
      .replace(/^sounds\/weapons_csgo\//, '')
      .replace(/\.vsnd$/i, '.wav');
    // vsndOf 会把开头的 weapons/ 剥掉（sounds/weapons_csgo/ak47/...），
    // 而 wavout 下保留完整相对路径（weapons/ak47/...），两种都要试。
    let d = wavDuration(path.join(wavDir, rel));
    if (d === null) d = wavDuration(path.join(wavDir, 'weapons', rel));
    if (d !== null && (max === null || d > max)) max = d;
  }
  return max;
}

/** 把块里的 vsnd_duration 改成指定值（保留 6 位小数，与 CS2 原格式一致） */
function setDuration(block, value) {
  const lines = block.split('\n');
  const idx = lines.findIndex((l) => /^\t\tvsnd_duration\s*=/.test(l));
  const line = `\t\tvsnd_duration = ${value.toFixed(6)}`;
  if (idx >= 0) lines[idx] = line;
  else {
    const last = lines.length - 1;
    lines.splice(last, 0, line);
  }
  return lines.join('\n');
}

/** 把块里的 volume 字段改成指定值（CS:GO 原事件的音量） */
function setVolume(block, value) {
  const lines = block.split('\n');
  const idx = lines.findIndex((l) => /^\t\tvolume\s*=/.test(l));
  const line = `\t\tvolume = ${value.toFixed(6)}`;
  if (idx >= 0) lines[idx] = line;
  else {
    const mixIdx = lines.findIndex((l) => /^\t\tmixgroup\s*=/.test(l));
    lines.splice(mixIdx >= 0 ? mixIdx : 2, 0, line);
  }
  return lines.join('\n');
}

// 所有 CS:GO 音频一律放进私有命名空间 sounds/weapons_csgo/，
// 避免覆盖 CS2 原版同名 vsnd（否则 Orig_ 回退块会跟着变成旧音）。
function vsndOf(wav) {
  const rel = wav.replace(/^sound\//i, '').replace(/\.wav$/i, '.vsnd');
  const rel2 = rel.replace(/^weapons\//i, '');
  return 'sounds/weapons_csgo/' + rel2;
}

// ---- 3. 生成 ----
const out = [header, '{'];
const problems = [];
const emitted = new Set();
const shippedWavs = new Set();

function push(name, block) {
  if (emitted.has(name)) { problems.push(`重复事件: ${name}`); return; }
  emitted.add(name);
  out.push(block);
}

// 3a. 主覆盖块
const targetList = plan.events.slice().sort((a, b) => a.event.localeCompare(b.event));
const overriddenSet = new Set(targetList.map((t) => t.event));
let overrideCount = 0;
let volumePatched = 0;
const volumePatchedList = [];
const volumeSkipped = [];
const variantAdjusted = [];
const droppedChildren = new Set();
let durationFixed = 0;
const durationChangedList = [];
const durationNoData = [];
// 记录每个主覆盖块最终写出的音量，供 `_Q` 变体按比例继承
const emittedVolume = new Map();
for (const t of targetList) {
  const raw = getBlock(t.event);
  if (!raw) { problems.push(`gsw.txt 缺失事件: ${t.event}`); continue; }
  // 对齐 CS2 的变体数：CS:GO 音源不够时循环填充，避免把随机池压成 1 个
  const wantVariants = countCs2Variants(t.event);
  const vsndsRaw = t.wavs.map(vsndOf);
  const vsnds = fitVariants(vsndsRaw, wantVariants, cs2VsndList(t.event));
  if (vsnds.length !== vsndsRaw.length) {
    variantAdjusted.push({ event: t.event, cs2: wantVariants, csgo: vsndsRaw.length, final: vsnds.length });
  }
  t.wavs.forEach((w) => shippedWavs.add(w));
  let block = replaceVsnd(raw, vsnds);
  // 剔除 CS2 独有的「叠层」子事件。
  //
  // 背景：CS2 给部分开火音叠了额外的层（格洛克 glock18 的 Element_CRB/Element_Click、
  // M249 的 Jangle、FAMAS 的 Mech、Taser 的 Charging、烟/燃烧弹的 Bounce_Can/Bounce_M）。
  // 这些层在 CS:GO 里**完全不存在**（CS:GO 的开火音就是单 wave + 远处版本），
  // 也没有对应的旧音可换。替换主 wave 后它们仍按 CS2 原音播放并与旧音叠加，
  // 实测表现为「格洛克开火音变了味 / 有杂音」。
  // 处理：只删「CS:GO 里没有、也没被我们覆盖」的层；远处版本（*Distant）与
  // 已被覆盖的子事件必须保留，否则关掉旧音时远处枪声会错。
  block = mapChildren(block, (child) => {
    if (!csgoEvents) return child; // 没给 csgo_events.json 就无法判断，保守不动
    if (overriddenSet.has(child)) return child;
    if (csgoEvents[child]) return child;
    if (/Distant$/i.test(child)) return child;
    droppedChildren.add(child);
    return null;
  });
  if (csgoEvents) {
    // 取 CS2 原音量与 CS2 原 vsnd 列表，交给 resolveVolume 判断是否要改
    const before = /^\t\tvolume\s*=\s*([0-9.]+)/m.exec(raw);
    const cs2VolRaw = before ? Number(before[1]) : null;
    const finalV = resolveVolume(t.event, cs2VolRaw);
    if (finalV !== null) {
      const before = /^\t\tvolume\s*=\s*([0-9.]+)/m.exec(block);
      const beforeV = before ? Number(before[1]) : null;
      block = setVolume(block, finalV);
      volumePatched++;
      if (beforeV === null || Math.abs(beforeV - finalV) > 1e-6) {
        volumePatchedList.push({
          event: t.event,
          from: beforeV,
          to: +finalV.toFixed(6),
          csgo_vol: finalV,
          mat_db: loudnessBySuffix.get(suffixOf(t.event)) ?? null,
        });
      }
    } else {
      // CS:GO 无音量定义（主要是 _Q 变体）→ 保留 CS2 原音量
      volumeSkipped.push(t.event);
    }
  }
  // 修正 vsnd_duration：CS2 原块里的时长是为 CS2 自己那份音频写的，
  // 换成 CS:GO 素材后长度不同 → 偏小会被截断（「切枪音效不完整」的根因），
  // 偏大会留静音并白占 instance_limit。
  if (wavDir) {
    const realDur = vsndDuration(vsnds, wavDir);
    if (realDur !== null && realDur > 0) {
      const m = /^\t\tvsnd_duration\s*=\s*([0-9.]+)/m.exec(block);
      const decl = m ? Number(m[1]) : null;
      block = setDuration(block, realDur);
      durationFixed++;
      if (decl === null || Math.abs(decl - realDur) > 0.02) {
        durationChangedList.push({ event: t.event, from: decl, to: +realDur.toFixed(6) });
      }
    } else {
      durationNoData.push(t.event);
    }
  }

  push(t.event, block);
  overrideCount++;
  const vm = /^\t\tvolume\s*=\s*([0-9.]+)/m.exec(block);
  if (vm) emittedVolume.set(t.event, Number(vm[1]));
}

// 3a-2. `_Q` 变体事件（CS2 独有的「安静版」工艺音）
//
// 背景：CS2 给 60 个工艺音配了 `_Q` 变体（BoltPull_Q / BoltBack_Q / Slideback_Q /
// Sliderelease_Q / Pump_Q / Clipin_Q ...），volume 通常是主事件的 0.5，其余字段与主事件
// 只差 display_broadcast=false 与 metadata。引擎在「快速动作」场景（快速切枪、快速换弹）
// 播的是 `_Q` 而不是主事件。
//
// 踩坑：最初把 `_Q` 判为「CS:GO 没有对应事件 → 不处理」，导致主事件已换成 CS:GO 旧音、
// 但玩家一快速切枪仍然听到 CS2 新录音（用户报「切枪拉栓声还是 CS2 的」就是这个）。
// `_Q` 不需要 CS:GO 有同名事件 —— 它只是主事件的音量变体，把主事件的 CS:GO 素材搬过来
// 并按 CS2 原有的 `_Q`/主 音量比缩放即可。
const qEvents = (() => {
  const out = [];
  for (const [name] of index) {
    if (!/_Q$/.test(name)) continue;
    const base = name.replace(/_Q$/, '');
    if (!overriddenSet.has(base)) continue;
    if (overriddenSet.has(name)) continue; // 已被 plan 显式覆盖的不重复处理
    out.push({ q: name, base });
  }
  return out.sort((a, b) => a.q.localeCompare(b.q));
})();
let qCount = 0;
const qNoVolume = [];
for (const { q, base } of qEvents) {
  const raw = getBlock(q);
  if (!raw) continue;
  const baseTarget = targetList.find((t) => t.event === base);
  if (!baseTarget) continue;
  // 用主事件的 CS:GO 素材，但按 _Q 自己的变体数对齐
  const wantVariants = countCs2Variants(q);
  const vsndsRaw = baseTarget.wavs.map(vsndOf);
  const vsnds = fitVariants(vsndsRaw, wantVariants, cs2VsndList(q));
  let block = replaceVsnd(raw, vsnds);
  // 音量：保留 CS2 原有的 _Q/主 比例，套到主事件归一后的新音量上
  const qVolM = /^\t\tvolume\s*=\s*([0-9.]+)/m.exec(raw);
  const baseRaw = getBlock(base);
  const baseVolM = baseRaw ? /^\t\tvolume\s*=\s*([0-9.]+)/m.exec(baseRaw) : null;
  const emitted = emittedVolume.get(base);
  if (qVolM && baseVolM && emitted !== undefined) {
    const qVol = Number(qVolM[1]);
    const bVol = Number(baseVolM[1]);
    if (bVol > 0) {
      const next = Math.min(Math.max(emitted * (qVol / bVol), 0), 1);
      block = setVolume(block, next);
    }
  } else {
    qNoVolume.push(q);
  }
  if (wavDir) {
    const realDur = vsndDuration(vsnds, wavDir);
    if (realDur !== null && realDur > 0) block = setDuration(block, realDur);
  }
  push(q, block);
  qCount++;
}

// 3b. Orig_ 回退块（仅 35 把武器，供插件按武器关闭旧音时使用）
const legacyEvents = plan.legacyEvents || [];
let origCount = 0;
const origChildBlocks = new Set(); // 需要额外生成的 Orig_<child> 块
for (const ev of legacyEvents) {
  const raw = getBlock(ev);
  if (!raw) { problems.push(`Orig_ 缺失源块: ${ev}`); continue; }

  let orig = renameBlock(raw, 'Orig_' + ev);
  // 把块内所有「本次被覆盖过的」child soundevent 引用改指向 Orig_ 版本，
  // 否则关掉旧音后，child（如远处枪声）仍会播 CS:GO 音频。
  // 用 mapChildren 而不是正则：soundevent_01 还有「= 换行 + 数组」的写法，
  // 正则只能命中标量形式（Glock.Single 那种数组形式会漏）。
  orig = mapChildren(orig, (child) => {
    if (!overriddenSet.has(child)) return child;
    origChildBlocks.add(child);
    return 'Orig_' + child;
  });
  push('Orig_' + ev, orig);
  origCount++;
}

// 3c. Orig_ 的 child 事件块（内容取 CS2 原版，保持原音）
let origChildCount = 0;
for (const child of origChildBlocks) {
  const raw = getBlock(child);
  if (!raw) { problems.push(`Orig_ 缺失 child 源块: ${child}`); continue; }
  push('Orig_' + child, renameBlock(raw, 'Orig_' + child));
  origChildCount++;
}

out.push('}');
out.push('');

// ---- 4. 自检 ----
const text = out.join('\n');
const open = (text.match(/\{/g) || []).length;
const close = (text.match(/\}/g) || []).length;
if (open !== close) problems.push(`大括号不平衡: { ${open} } ${close}`);
if (overrideCount !== targetList.length) problems.push(`覆盖块数不符: ${overrideCount}/${targetList.length}`);
if (origCount !== legacyEvents.length) problems.push(`Orig 块数不符: ${origCount}/${legacyEvents.length}`);

fs.writeFileSync(outPath, text);
console.log(JSON.stringify({
  blocks: emitted.size,
  override: overrideCount,
  orig_single: origCount,
  orig_child: origChildCount,
  unique_wavs: shippedWavs.size,
  volume_patched: volumePatched,
  volume_changed: volumePatchedList.length,
  volume_skipped: volumeSkipped.length,
  variant_adjusted: variantAdjusted.length,
  child_dropped: droppedChildren.size,
  q_overridden: qCount,
  q_total: qEvents.length,
  duration_fixed: durationFixed,
  duration_changed: durationChangedList.length,
  duration_nodata: durationNoData.length,
  bytes: Buffer.byteLength(text),
  outPath,
}, null, 1));
if (variantAdjusted.length) {
  console.log('变体数已对齐 CS2（循环填充）:');
  for (const v of variantAdjusted) {
    console.log(`  ${v.event.padEnd(32)} CS2=${v.cs2}  CS:GO=${v.csgo}  → 最终=${v.final}`);
  }
}
if (volumePatchedList.length) {
  const jsonPath = outPath.replace(/\.vsndevts$/, '.volume-changes.json');
  fs.writeFileSync(jsonPath, JSON.stringify(volumePatchedList, null, 1));
  console.log(`音量有变化的事件 ${volumePatchedList.length} 个 → ${jsonPath}`);
  for (const r of volumePatchedList.slice(0, 12)) {
    console.log(`  ${r.event.padEnd(32)} ${r.from} → ${r.to}`);
  }
  if (volumePatchedList.length > 12) console.log(`  … 其余 ${volumePatchedList.length - 12} 个见 json`);
}
if (droppedChildren.size) {
  console.log('已剔除 CS:GO 不存在的叠层子事件（CS2 独有，会与旧音叠加）:');
  console.log('  ' + [...droppedChildren].sort().join(', '));
}
if (qCount) {
  console.log(`已覆盖 _Q（安静版）工艺音事件 ${qCount}/${qEvents.length} 个`);
  if (qNoVolume.length) console.log(`  _Q 音量未能按比例继承（保留 CS2 原值）: ${qNoVolume.length} 个`);
}
if (problems.length) {
  console.error('问题:\n  ' + problems.join('\n  '));
  process.exit(3);
}
fs.writeFileSync(outPath.replace(/\.vsndevts$/, '.wavlist.json'), JSON.stringify(Array.from(shippedWavs).sort(), null, 1));
