// 从 CS2 的 vsnd_c 里抽出内嵌 PCM，写成可播放 wav，用于 A/B 试听。
// 依据（已实测验证）：
//   vsnd_c = [头部元数据] + [裸 PCM]，音频紧贴文件尾。
//   头部长度不固定（1302/1317/1334...），但 PCM 长度 = 声明时长 × 采样率 × 声道数 × 2。
//   验证：ak47_boltpull.vsnd_c 28648B，CS:GO 的 ak47_boltpull.wav PCM=27346B，
//        探针命中位置反推 PCM 起点 = 1302 = 28648 - 27346，正好贴尾。
// 用法: node .tmp/vsnd2wav.js <in.vsnd_c> <out.wav> [duration] [rate] [channels]
const fs = require('fs');

const [, , inp, outp, durArg, rateArg, chArg] = process.argv;
const buf = fs.readFileSync(inp);
const rate = Number(rateArg) || 44100;
const channels = Number(chArg) || 1;
const bits = 16;

let pcmLen;
if (durArg) {
  pcmLen = Math.round(Number(durArg) * rate * channels * bits / 8);
} else {
  // 没有时长就用「找最后一个非零字节」估算，再按 4 字节对齐
  let end = buf.length - 1;
  while (end > 0 && buf[end] === 0 && buf[end - 1] === 0) end -= 2;
  pcmLen = buf.length - 1302;
}
if (pcmLen > buf.length) {
  console.error(`PCM 长度 ${pcmLen} 超过文件 ${buf.length}`);
  process.exit(1);
}
const start = buf.length - pcmLen;
const pcm = buf.slice(start);
const byteRate = rate * channels * bits / 8;

// RMS / peak
let sum = 0, peak = 0, n = 0;
for (let i = 0; i + 1 < pcm.length; i += 2) {
  const s = pcm.readInt16LE(i) / 32768;
  sum += s * s;
  if (Math.abs(s) > peak) peak = Math.abs(s);
  n++;
}
const rms = Math.sqrt(sum / Math.max(n, 1));
const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');

const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24);
h.writeUInt32LE(byteRate, 28); h.writeUInt16LE(channels * bits / 8, 32);
h.writeUInt16LE(bits, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);

fs.writeFileSync(outp, Buffer.concat([h, pcm]));
console.log(
  `${inp.split('/').pop().padEnd(28)} -> ${outp.split('/').pop().padEnd(30)} ` +
  `pcm=${pcm.length}B start=0x${start.toString(16)} ` +
  `${(pcm.length / byteRate).toFixed(3)}s rms=${db(rms)}dB peak=${db(peak)}dB`
);
