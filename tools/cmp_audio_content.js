#!/usr/bin/env node
'use strict';
/**
 * 判定 CS2 的 xxx.vsnd_c 与 CS:GO 的 xxx.wav 是否为同一段音频数据。
 *
 * 原理：CS2 的 .vsnd_c 内部保存的是转换后的 Vorbis/Opus 或未压缩 PCM，
 * 但从实测看，绝大多数 SoundEvent 素材是「源 wav 的 PCM 直接内嵌」，
 * 因此可以在 vsnd_c 中搜索 wav 的 data 块片段来做内容比对。
 *
 * 用法:
 *   node cmp_audio_content.js <wav目录> <vsnd_c目录> <映射json> <输出json>
 *
 * 映射 json: [{ "wav": "sound/weapons/ak47/ak47_01.wav",
 *               "vsnd": "sounds/weapons/ak47/ak47_01.vsnd_c" }, ...]
 *
 * 输出: 每条 { wav, vsnd, verdict, detail }
 *   verdict:
 *     IDENTICAL   wav 的 PCM 在 vsnd_c 中完整找到
 *     PARTIAL     找到 >= 90% 的探针片段
 *     DIFFERENT   完全找不到 -> 必须由 addon 自带该 wav
 *     MISSING_*   文件缺失
 */
const fs = require('fs');
const path = require('path');

function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const sz = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = buf.subarray(pos + 8, pos + 8 + sz);
    else if (id === 'data') data = buf.subarray(pos + 8, pos + 8 + sz);
    pos += 8 + sz + (sz & 1);
  }
  if (!data) return null;
  const info = {};
  if (fmt && fmt.length >= 16) {
    info.format = fmt.readUInt16LE(0);
    info.channels = fmt.readUInt16LE(2);
    info.rate = fmt.readUInt32LE(4);
    info.bits = fmt.readUInt16LE(14);
  }
  info.data = data;
  return info;
}

/**
 * 在 hay 中搜索 needle。返回首次出现的偏移或 -1。
 * 为速度考虑，用首 16 字节做启发式定位。
 */
function indexOfBuf(hay, needle, from) {
  if (needle.length === 0) return -1;
  const first = needle[0];
  let i = from || 0;
  const limit = hay.length - needle.length;
  while (i <= limit) {
    const j = hay.indexOf(first, i);
    if (j < 0 || j > limit) return -1;
    if (hay.compare(needle, 0, needle.length, j, j + needle.length) === 0) return j;
    i = j + 1;
  }
  return -1;
}

/** 从 wav PCM 中取 N 个等距探针（每段 64 字节），避开首尾静音 */
function probes(data, n) {
  const out = [];
  const usable = data.length;
  if (usable < 128) return out;
  // 跳过前 2%（通常是攻击瞬态前的静音）
  const start = Math.floor(usable * 0.02);
  const end = usable - 128;
  if (end <= start) return out;
  const step = Math.floor((end - start) / n);
  for (let k = 0; k < n; k++) {
    const off = start + k * step;
    if (off + 64 > data.length) break;
    out.push({ off, buf: data.subarray(off, off + 64) });
  }
  return out;
}

function compare(wavBuf, vsndBuf) {
  const wav = readWav(wavBuf);
  if (!wav) return { verdict: 'BAD_WAV', detail: '不是合法 RIFF/WAVE' };
  const data = wav.data;
  if (data.length < 256) return { verdict: 'BAD_WAV', detail: 'PCM 数据过短 ' + data.length };

  // 1) 整段直接命中
  const whole = indexOfBuf(vsndBuf, data);
  if (whole >= 0) {
    return {
      verdict: 'IDENTICAL',
      detail: `完整 PCM(${data.length}B) 命中 @${whole}`,
      wav: wav,
    };
  }

  // 2) 探针命中率
  const ps = probes(data, 24);
  let hit = 0;
  const offsets = [];
  for (const p of ps) {
    const idx = indexOfBuf(vsndBuf, p.buf);
    if (idx >= 0) { hit++; offsets.push(idx - p.off); }
  }
  const ratio = ps.length ? hit / ps.length : 0;
  const sameDelta = offsets.length > 1 && offsets.every((o) => o === offsets[0]);
  if (ratio >= 0.9 && sameDelta) {
    return {
      verdict: 'IDENTICAL',
      detail: `探针 ${hit}/${ps.length} 命中，固定偏移差 ${offsets[0]}`,
      wav: wav,
    };
  }
  if (ratio >= 0.9) {
    return { verdict: 'PARTIAL', detail: `探针 ${hit}/${ps.length} 命中但偏移不一致`, wav: wav };
  }
  return {
    verdict: 'DIFFERENT',
    detail: `探针 ${hit}/${ps.length} 命中 (vsnd ${vsndBuf.length}B / wav PCM ${data.length}B)`,
    wav: wav,
  };
}

function main() {
  const [wavRoot, vsndRoot, mapPath, outPath] = process.argv.slice(2);
  if (!outPath) {
    console.error('用法: node cmp_audio_content.js <wav目录> <vsnd_c目录> <映射json> <输出json>');
    return 64;
  }
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const results = [];
  const tally = {};
  for (const m of map) {
    const wavPath = path.join(wavRoot, m.wav);
    const vsndPath = path.join(vsndRoot, m.vsnd);
    if (!fs.existsSync(wavPath)) {
      results.push({ ...m, verdict: 'MISSING_WAV', detail: wavPath });
      tally.MISSING_WAV = (tally.MISSING_WAV || 0) + 1;
      continue;
    }
    if (!fs.existsSync(vsndPath)) {
      results.push({ ...m, verdict: 'MISSING_VSND', detail: vsndPath });
      tally.MISSING_VSND = (tally.MISSING_VSND || 0) + 1;
      continue;
    }
    const r = compare(fs.readFileSync(wavPath), fs.readFileSync(vsndPath));
    results.push({ ...m, verdict: r.verdict, detail: r.detail });
    tally[r.verdict] = (tally[r.verdict] || 0) + 1;
    process.stderr.write(`${r.verdict.padEnd(13)} ${m.wav}\n`);
  }
  fs.writeFileSync(outPath, JSON.stringify(results, null, 1), 'utf8');
  console.log('\n=== 统计 ===');
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log('输出:', outPath);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { compare, readWav, indexOfBuf };
