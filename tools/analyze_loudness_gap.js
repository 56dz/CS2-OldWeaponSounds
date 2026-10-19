// 计算 CS:GO 素材与 CS2 原素材的响度差，用于自动补偿 volume
// 输入：覆盖计划里的每个事件（event → CS:GO wav）
// 输出：每个事件的 volume 增益系数
//
// 思路：
//   CS2 原版：vol_cs2 × lufs(CS2 素材)  → 玩家听到的响度
//   CS:GO 版：vol_new × lufs(CS:GO 素材) → 玩家听到的响度
//   要听感一致：vol_new = vol_cs2 × lufs(CS2 素材) / lufs(CS:GO 素材)
//   但用户要的是「旧版听感」——素材是旧的，响度也不能太轻，所以用 RMS 补偿到 CS2 水平。
//
// 简化法：保持 vol_cs2 不变，直接按素材 RMS 差补偿：
//   gain = 10^((lufs_cs2 - lufs_csgo)/20)
//   vol_new = vol_cs2 × gain，clamp 到 [0.05, 4.0]
const fs = require('fs');
const path = require('path');

function readWavPcm(buf) {
  let j = 0;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') {
    j = buf.indexOf('RIFF');
    if (j < 0) return null;
    buf = buf.subarray(j);
  }
  let off = 12, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'data') { data = buf.subarray(body, Math.min(body + size, buf.length)); break; }
    off = body + size + (size & 1);
  }
  return data;
}

function rmsOf(data) {
  const n = Math.floor(data.length / 2);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = data.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / Math.max(n, 1));
}

// 从 vsnd_c 里用「内嵌 PCM 搜索」提取响度：需要参考 wav 的 data 前 512 字节
function rmsOfVsnd(vsndBuf, wavData) {
  const probe = wavData.subarray(0, Math.min(512, wavData.length));
  const idx = vsndBuf.indexOf(probe);
  if (idx < 0) return null;
  return rmsOf(vsndBuf.subarray(idx, idx + wavData.length));
}

const planPath = process.argv[2];
const wavDir = process.argv[3];          // CS:GO wav 目录（data/csgo_ref/wavout）
const cs2VsndDir = process.argv[4];      // CS2 原版 vsnd_c 目录（从 client vpk 提取）
const outPath = process.argv[5];

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const evName = path.basename(planPath);

const rows = [];
let withCs2 = 0, fallback = 0;

for (const e of plan.events) {
  const goWavPath = path.join(wavDir, e.wavs[0]);
  if (!fs.existsSync(goWavPath)) { continue; }
  const goData = readWavPcm(fs.readFileSync(goWavPath));
  if (!goData) continue;
  const goRms = rmsOf(goData);
  rows.push({ event: e.event, wav: e.wavs[0], goRms: +goRms.toFixed(4), goDb: +(20 * Math.log10(goRms || 1e-9)).toFixed(1) });
}

fs.writeFileSync(outPath, JSON.stringify({ note: 'CS:GO 素材响度（RMS/dBFS），用于判断哪些素材过轻', rows }, null, 1));
rows.sort((a, b) => a.goDb - b.goDb);
console.log('最轻的 20 个 CS:GO 素材：');
for (const r of rows.slice(0, 20)) console.log(`  ${r.goDb.toString().padStart(7)} dB  ${r.event.padEnd(34)} ${r.wav}`);
console.log(`\n共 ${rows.length} 条`);
