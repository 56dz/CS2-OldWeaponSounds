// 正确解析 RED2 容器里内嵌的 MP3：按 MPEG1/2/2.5 Layer III 帧长公式做链式校验，
// 找出能连续串起 >=8 帧的偏移，那就是真正的 mp3 载荷起点。
const fs = require('fs');

const BR = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0], // MPEG1 L3
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],     // MPEG2/2.5 L3
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function frameLen(buf, off) {
  if (buf[off] !== 0xff || (buf[off + 1] & 0xe0) !== 0xe0) return 0;
  const verBits = (buf[off + 1] >> 3) & 3;   // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=reserved
  const layerBits = (buf[off + 1] >> 1) & 3; // 1=LayerIII
  if (verBits === 1 || layerBits !== 1) return 0;
  const bri = (buf[off + 2] >> 4) & 15;
  const sri = (buf[off + 2] >> 2) & 3;
  const pad = (buf[off + 2] >> 1) & 1;
  if (bri === 0 || bri === 15 || sri === 3) return 0;
  const table = verBits === 3 ? BR[1] : BR[2];
  const rate = SR[verBits][sri];
  const bitrate = table[bri] * 1000;
  if (verBits === 3) return Math.floor(144 * bitrate / rate) + pad;
  return Math.floor(72 * bitrate / rate) + pad;
}

function chainLen(buf, off) {
  let n = 0;
  while (off < buf.length - 4) {
    const len = frameLen(buf, off);
    if (!len) break;
    off += len;
    n++;
    if (n > 5000) break;
  }
  return n;
}

const inp = process.argv[2];
const buf = fs.readFileSync(inp);
const best = [];
for (let i = 0; i < buf.length - 4; i++) {
  if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
  if (!frameLen(buf, i)) continue;
  const n = chainLen(buf, i);
  if (n >= 8) best.push({ off: i, n });
}
best.sort((a, b) => b.n - a.n);
console.log(`${inp.split('/').pop()}: size=${buf.length} chains=${best.length}`);
console.log('  top:', best.slice(0, 5).map(b => `0x${b.off.toString(16)}(${b.n}f)`).join(' '));
if (best.length && process.argv[3]) {
  const s = best[0].off;
  fs.writeFileSync(process.argv[3], buf.slice(s));
  console.log(`  wrote ${process.argv[3]} from 0x${s.toString(16)} (${buf.length - s}B)`);
}
