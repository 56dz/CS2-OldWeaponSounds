// 从 csgo-ds 的 vpk 里提取指定 wav 并输出波形特征，用于判断两个音频是否真的不同
// 用法: node tools/extract_csgo_wav.js <服务器上的 wav 相对路径>
// 实际上服务器上已有提取脚本，这里只做本地 wav 的对比分析
const fs = require('fs');
const path = require('path');

function readWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(body + 2), sr: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    else if (id === 'data') data = buf.subarray(body, Math.min(body + size, buf.length));
    off = body + size + (size & 1);
  }
  return fmt && data ? { fmt, data } : null;
}

function features(w) {
  const n = Math.floor(w.data.length / 2);
  const sr = w.fmt.sr, ch = w.fmt.channels;
  const samples = new Float64Array(n);
  for (let i = 0; i < n; i++) samples[i] = w.data.readInt16LE(i * 2) / 32768;
  // RMS 包络（每 10ms 一格）
  const win = Math.floor(sr * 0.01);
  const env = [];
  for (let i = 0; i + win <= n; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) s += samples[i + j] * samples[i + j];
    env.push(Math.sqrt(s / win));
  }
  const peak = Math.max(...Array.from(samples, Math.abs));
  const dur = n / ch / sr;
  // 能量重心（时间加权平均位置）
  let ws = 0, wt = 0;
  for (let i = 0; i < env.length; i++) { ws += env[i]; wt += env[i] * i; }
  const centroid = ws > 0 ? wt / ws / env.length : 0;
  // 包络极值位置（前几个峰）
  const peaks = [];
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > 0.05) peaks.push({ t: (i * 0.01).toFixed(3), v: env[i].toFixed(3) });
  }
  return { dur: dur.toFixed(3), peak: peak.toFixed(3), centroid: centroid.toFixed(3), envLen: env.length, peaks: peaks.slice(0, 8), env: env.map((v) => Math.round(v * 100)) };
}

const files = process.argv.slice(2);
for (const f of files) {
  const w = readWav(fs.readFileSync(f));
  if (!w) { console.log(f, 'BAD'); continue; }
  const ft = features(w);
  console.log('\n===', path.basename(f), '===');
  console.log(`时长=${ft.dur}s 峰值=${ft.peak} 能量重心=${ft.centroid} (0=开头 1=结尾)`);
  console.log('包络峰值点:', JSON.stringify(ft.peaks));
  console.log('包络曲线(%):', ft.env.join(','));
}
