// verify_compiled_v2.js — 校验编译后的 soundevents_addon.vsndevts_c 是否符合全量旧音计划
// 用法: node verify_compiled_v2.js <dump.txt> <legacy_all_plan.json> <game_csgo_addons_dir>
"use strict";
const fs = require("fs");
const path = require("path");

const [, , dumpPath, planPath, gameAddonDir] = process.argv;
if (!dumpPath || !planPath || !gameAddonDir) {
  console.error("用法: node verify_compiled_v2.js <dump.txt> <legacy_all_plan.json> <game_csgo_addons_dir>");
  process.exit(2);
}

const dump = fs.readFileSync(dumpPath, "utf8");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

// 与 build_legacy_all.js 完全一致的路径变换
function vsndOf(wav) {
  const rel = wav.replace(/^sound\//i, "").replace(/\\/g, "/").replace(/\.wav$/i, ".vsnd");
  return "sounds/weapons_csgo/" + rel.replace(/^weapons\//i, "");
}

const lines = dump.split(/\r?\n/);
const blocks = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = /^(\t)([A-Za-z_][^\s=]*)\s*=\s*$/.exec(lines[i]);
  if (!m) continue;
  if (i + 1 >= lines.length || lines[i + 1].trim() !== "{") continue;
  let depth = 0, end = -1;
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t === "{") depth++;
    else if (t === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end > 0) blocks.set(m[2], { startLine: i, endLine: end });
}

function vsndsOf(name) {
  const b = blocks.get(name);
  if (!b) return null;
  const body = lines.slice(b.startLine, b.endLine + 1).join("\n");
  const arr = /vsnd_files_track_01\s*=\s*\n\t\t\[\n([\s\S]*?)\n\t\t\]/.exec(body);
  if (arr) return [...arr[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const one = /vsnd_files_track_01\s*=\s*"([^"]+)"/.exec(body);
  return one ? [one[1]] : null;
}

const report = { ok: true, problems: [] };
const add = (s) => { report.ok = false; report.problems.push(s); };

// 1. 目标事件存在 + vsnd 列表与计划一致
let mismatch = [], missingTargets = [], noField = [];
for (const e of plan.events) {
  if (!blocks.has(e.event)) { missingTargets.push(e.event); continue; }
  const got = vsndsOf(e.event);
  if (!got) { noField.push(e.event); continue; }
  const want = e.wavs.map(vsndOf);
  if (got.length !== want.length || got.some((x, i) => x !== want[i])) {
    mismatch.push({ event: e.event, want: want.length, got: got.length });
  }
}
if (missingTargets.length) add(`缺少目标事件 ${missingTargets.length}: ${missingTargets.slice(0, 8).join(", ")}`);
if (noField.length) add(`目标事件无 vsnd 字段 ${noField.length}: ${noField.slice(0, 8).join(", ")}`);
if (mismatch.length) add(`vsnd 列表与计划不一致 ${mismatch.length}: ${JSON.stringify(mismatch.slice(0, 6))}`);

// 2. Orig_ 回退块存在，且其 vsnd 保持 CS2 原路径
const missingOrig = plan.origBlocks.filter((n) => !blocks.has(n));
if (missingOrig.length) add(`缺少 Orig_ 回退块 ${missingOrig.length}: ${missingOrig.slice(0, 8).join(", ")}`);
let origBad = [];
for (const n of plan.origBlocks) {
  if (!blocks.has(n)) continue;
  const v = vsndsOf(n) || [];
  if (v.length && v.every((x) => x.startsWith("sounds/weapons_csgo/"))) origBad.push(n);
}
if (origBad.length) add(`Orig_ 块也被改成了旧音 ${origBad.length}: ${origBad.slice(0, 8).join(", ")}`);

// 3. Orig_ 块内的 soundevent 引用：只有被本次覆盖过的 child 才需要重定向到 Orig_ 版本
//    （未覆盖的 child 用的仍是 CS2 原音，回退时本就该保持原样）
const overridden = new Set(plan.events.map((e) => e.event));
let redirectBad = [];
for (const n of plan.origBlocks) {
  const b = blocks.get(n);
  if (!b) continue;
  const body = lines.slice(b.startLine, b.endLine + 1).join("\n");
  for (const ref of body.matchAll(/soundevent_\d+\s*=\s*"([^"]+)"/g)) {
    const child = ref[1];
    if (overridden.has(child) && !blocks.has("Orig_" + child)) {
      redirectBad.push(`${n} -> ${child}`);
    }
  }
}
if (redirectBad.length) add(`Orig_ 的 child soundevent 未重定向 ${redirectBad.length}: ${redirectBad.slice(0, 8).join(", ")}`);

// 4. 目标事件的 vsnd_c 全部落地在磁盘
const wantVsnds = new Set(plan.events.flatMap((e) => e.wavs.map(vsndOf)));
const missingFiles = [...wantVsnds].filter(
  (v) => !fs.existsSync(path.join(gameAddonDir, v.replace(/\.vsnd$/i, ".vsnd_c")))
);
if (missingFiles.length) add(`磁盘缺少 vsnd_c ${missingFiles.length}: ${missingFiles.slice(0, 8).join(", ")}`);

// 5. 计划 271 wav 全被引用
const wantCount = plan.wavs.length;
if (wantVsnds.size !== new Set(plan.wavs.map(vsndOf)).size) add(`唯一 vsnd 数与 wav 数不符`);

report.stats = {
  compiledBlocks: blocks.size,
  targetEvents: plan.events.length,
  origBlocks: plan.origBlocks.length,
  planWavs: wantCount,
  uniqueTargetVsnd: wantVsnds.size,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
