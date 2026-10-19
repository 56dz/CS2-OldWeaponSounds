// verify_vsnd_pcm.js — 逐字节校验 addon 编译出的 .vsnd_c 是否内嵌了 CS:GO 原始 wav 的 PCM
//
// 用法: node tools/verify_vsnd_pcm.js <wav_root> <game_addon_dir> <plan.json>
//   wav_root        = data/csgo_ref/wavout        （保持 weapons/... physics/... 结构）
//   game_addon_dir  = <CS2>/game/csgo_addons/csgo_old_weapon_sounds
//   plan.json       = data/csgo_ref/legacy_all_plan.json
'use strict';
const fs = require('fs');
const path = require('path');

const [, , wavRoot, gameAddonDir, planPath] = process.argv;
if (!wavRoot || !gameAddonDir || !planPath) {
  console.error('用法: node verify_vsnd_pcm.js <wav_root> <game_addon_dir> <plan.json>');
  process.exit(2);
}

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

function vsndOf(wav) {
  const rel = wav.replace(/^sound\//i, '').replace(/\\/g, '/').replace(/\.wav$/i, '.vsnd');
  return 'sounds/weapons_csgo/' + rel.replace(/^weapons\//i, '');
}

/** 解析 RIFF，返回 {fmt, data}；支持 JUNK/LIST 等前置块 */
function readWav(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = buf.toString('latin1', body, Math.min(body + size, buf.length));
    else if (id === 'data') { data = buf.subarray(body, Math.min(body + size, buf.length)); break; }
    off = body + size + (size & 1);
  }
  return data ? { fmt, data } : null;
}

const rows = [];
let identical = 0, partial = 0, missing = 0, badwav = 0;
for (const raw of plan.wavs) {
  const rel = raw.replace(/^sound\//i, '').replace(/\\/g, '/');
  const wavPath = path.join(wavRoot, rel);
  const vsndPath = path.join(gameAddonDir, vsndOf(raw).replace(/\.vsnd$/i, '.vsnd_c'));
  const row = { wav: rel, wavSize: 0, vsndSize: 0, verdict: '', offset: -1 };

  if (!fs.existsSync(wavPath)) { row.verdict = 'MISSING_WAV'; missing++; rows.push(row); continue; }
  if (!fs.existsSync(vsndPath)) { row.verdict = 'MISSING_VSND'; missing++; rows.push(row); continue; }

  const wavBuf = fs.readFileSync(wavPath);
  const vsndBuf = fs.readFileSync(vsndPath);
  row.wavSize = wavBuf.length;
  row.vsndSize = vsndBuf.length;

  const w = readWav(wavBuf);
  if (!w || !w.data || w.data.length < 1024) { row.verdict = 'BAD_WAV'; badwav++; rows.push(row); continue; }

  const off = vsndBuf.indexOf(w.data);
  if (off >= 0) {
    row.verdict = 'PCM_IDENTICAL';
    row.offset = off;
    identical++;
  } else {
    // 退化判定：24 个等距 64 字节探针
    const pcm = w.data;
    const n = 24;
    const step = Math.max(1, Math.floor(pcm.length / n));
    let hit = 0;
    const offsets = new Set();
    for (let i = 0; i < n; i++) {
      const p = i * step;
      if (p + 64 > pcm.length) break;
      const o = vsndBuf.indexOf(pcm.subarray(p, p + 64));
      if (o >= 0) { hit++; offsets.add(o - p); }
    }
    const score = hit / n;
    row.score = Number(score.toFixed(3));
    row.verdict = score >= 0.9 && offsets.size === 1 ? 'PROBE_IDENTICAL' : score >= 0.5 ? 'PARTIAL' : 'DIFFERENT';
    if (row.verdict === 'PROBE_IDENTICAL') identical++;
    else if (row.verdict === 'PARTIAL') partial++;
    else missing++;
  }
  rows.push(row);
}

const outPath = path.resolve(wavRoot, '..', 'vsnd_pcm_verify.json');
fs.writeFileSync(outPath, JSON.stringify({ stats: { total: plan.wavs.length, identical, partial, failed: missing, badwav }, rows }, null, 1));

const bad = rows.filter((r) => !/IDENTICAL$/.test(r.verdict));
console.log(JSON.stringify({
  total: plan.wavs.length,
  identical,
  partial,
  failed: missing,
  badwav,
  outPath,
}, null, 1));
if (bad.length) {
  console.error('不合格 ' + bad.length + ' 个:');
  for (const r of bad.slice(0, 20)) console.error('  ' + r.verdict.padEnd(16) + r.wav + '  wav=' + r.wavSize + ' vsnd=' + r.vsndSize);
  process.exit(1);
}
