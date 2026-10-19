// 音量归一化：为每个覆盖事件计算音量补偿系数
//
// 原理：
//   CS2 原版听感 = vol_cs2 × rms(CS2 素材)
//   我们要让 CS:GO 素材达到同样响度 → vol_new × rms(CSGO 素材) = vol_cs2 × rms(CS2 素材)
//   ⇒ vol_new = vol_cs2 × rms(CS2 素材) / rms(CSGO 素材)
//
// 数据来源：
//   - CS:GO 素材：data/csgo_ref/wavout/**/*.wav（直接读 PCM 算 RMS）
//   - CS2 素材：从客户端 pak01_dir.vpk 提取 vsnd_c，用「内嵌 PCM 搜索法」定位其 PCM。
//     但 CS2 的 vsnd_c 多数是重编码的（不内嵌原 wav），无法直接读。
//     替代方案：用 vsnd_c 的「PCM 段能量均值」估算（滑动窗口取最大连续非零区）。
//
// 为保证可靠性，对无法估算的 CS2 素材退化为「用武器类别的典型增益」。
'use strict';
const fs = require('fs');
const path = require('path');

// ---------- wav 解析 ----------
function wavPcm(buf) {
  let j = 0;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') {
    j = buf.indexOf('RIFF');
    if (j < 0) return null;
    buf = buf.subarray(j);
  }
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(body + 2), sr: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    else if (id === 'data') { data = buf.subarray(body, Math.min(body + size, buf.length)); break; }
    off = body + size + (size & 1);
  }
  return data && fmt ? { fmt, data } : null;
}

function rms(data) {
  const n = Math.floor(data.length / 2);
  let s = 0;
  for (let i = 0; i < n; i++) { const v = data.readInt16LE(i * 2) / 32768; s += v * v; }
  return Math.sqrt(s / Math.max(n, 1));
}

// 从 vsnd_c 估算 PCM 响度：
// 策略1：如果 vsnd_c 内嵌了完整 wav（我们自己的产物），直接用 wav 的 data 长度截取
// 策略2：否则按「最长连续非零 int16 区」取 PCM 估算（对 CS2 重编码素材近似）
function vsndRms(vsndBuf, refWavData) {
  if (refWavData && refWavData.length > 512) {
    const probe = refWavData.subarray(0, 512);
    const idx = vsndBuf.indexOf(probe);
    if (idx >= 0) {
      const seg = vsndBuf.subarray(idx, idx + refWavData.length);
      return { rms: rms(seg), method: 'embedded' };
    }
  }
  // 滑动窗口：找能量最高的连续段作为 PCM 主体
  const n = Math.floor(vsndBuf.length / 2);
  const win = 512; // 512 samples
  let best = -1, bestStart = 0;
  for (let start = 0; start + win <= n; start += 64) {
    let s = 0;
    for (let i = 0; i < win; i++) { const v = vsndBuf.readInt16LE((start + i) * 2) / 32768; s += v * v; }
    const e = s / win;
    if (e > best) { best = e; bestStart = start; }
  }
  if (best <= 0) return { rms: 0, method: 'silent' };
  // 以最佳窗口为中心，向前后扩展到能量降到 1/10
  const thresh = best / 10;
  let a = bestStart, b = bestStart + win;
  const eAt = (p) => {
    if (p < 0 || p + 64 > n) return 0;
    let s = 0;
    for (let i = 0; i < 64; i++) { const v = vsndBuf.readInt16LE((p + i) * 2) / 32768; s += v * v; }
    return s / 64;
  };
  while (a > 0 && eAt(a - 64) > thresh) a -= 64;
  while (b < n && eAt(b) > thresh) b += 64;
  const seg = vsndBuf.subarray(a * 2, b * 2);
  return { rms: rms(seg), method: 'window', span: b - a };
}

// ---------- main ----------
const planPath = process.argv[2];
const wavRoot = process.argv[3];       // data/csgo_ref/wavout
const cs2Dir = process.argv[4];        // CS2 原版 vsnd_c 提取目录 /tmp/cs2probe
const outPath = process.argv[5];

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const rows = [];
const missing = [];

for (const e of plan.events) {
  // CS:GO 素材
  const goPath = path.join(wavRoot, e.wavs[0]);
  if (!fs.existsSync(goPath)) { missing.push({ event: e.event, why: 'CSGO wav 缺失', p: goPath }); continue; }
  const goWav = wavPcm(fs.readFileSync(goPath));
  if (!goWav) { missing.push({ event: e.event, why: 'CSGO wav 解析失败' }); continue; }
  const goRms = rms(goWav.data);
  const goDb = 20 * Math.log10(goRms || 1e-9);

  rows.push({
    event: e.event,
    go_wav: e.wavs[0],
    go_db: +goDb.toFixed(1),
    go_rms: +goRms.toFixed(4),
    cs2_vsnd: null,
    cs2_db: null,
    gain: null,
  });
}

fs.writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), rows, missing }, null, 1));
console.log(`写出 ${rows.length} 条 → ${outPath}`);
if (missing.length) console.log(`缺失 ${missing.length} 条`);

// 按 dBFS 分布统计
const buckets = {};
for (const r of rows) {
  const b = Math.floor(r.go_db / 5) * 5;
  buckets[b] = (buckets[b] || 0) + 1;
}
console.log('\nCS:GO 素材 dBFS 分布（5dB 一档）：');
for (const k of Object.keys(buckets).sort((a, b) => a - b)) {
  console.log(`  ${String(k).padStart(4)} ~ ${String(+k + 5).padStart(3)} dB : ${'█'.repeat(buckets[k])} ${buckets[k]}`);
}
