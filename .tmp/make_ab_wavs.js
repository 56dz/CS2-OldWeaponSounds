// 生成 A/B 试听文件：把 CS2 与 CS:GO 的对应音效都导出成可直接双击播放的 wav。
// CS2 侧：vsnd_c 尾部就是裸 PCM，头部长度 = 文件大小 - round(声明时长 × 采样率 × 声道 × 2)
// CS:GO 侧：源 wav 直接可用
const fs = require('fs');
const path = require('path');

const OUT = '.tmp/ab_test/out';
fs.mkdirSync(OUT, { recursive: true });

function wavHeader(pcmLen, rate, channels, bits) {
  const h = Buffer.alloc(44);
  const byteRate = rate * channels * bits / 8;
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcmLen, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(byteRate, 28); h.writeUInt16LE(channels * bits / 8, 32);
  h.writeUInt16LE(bits, 34); h.write('data', 36); h.writeUInt32LE(pcmLen, 40);
  return h;
}

function stats(pcm) {
  let sum = 0, peak = 0, n = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const s = pcm.readInt16LE(i) / 32768;
    sum += s * s; if (Math.abs(s) > peak) peak = Math.abs(s); n++;
  }
  const rms = Math.sqrt(sum / Math.max(n, 1));
  const db = v => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
  return { rms: db(rms), peak: db(peak) };
}

// CS2: 已知声明时长，按贴尾切
function fromVsnd(vsndPath, dur, outName, rate = 44100, ch = 1) {
  const buf = fs.readFileSync(vsndPath);
  const pcmLen = Math.round(dur * rate * ch * 2);
  const start = buf.length - pcmLen;
  if (start < 0) { console.log(`  !! ${vsndPath} 头长算出负数`); return; }
  const pcm = buf.slice(start);
  const h = wavHeader(pcm.length, rate, ch, 16);
  fs.writeFileSync(path.join(OUT, outName), Buffer.concat([h, pcm]));
  const s = stats(pcm);
  console.log(`  CS2  ${outName.padEnd(38)} hdr=${start}B ${(pcmLen / (rate * ch * 2)).toFixed(3)}s rms=${s.rms}dB peak=${s.peak}dB`);
}

function fromWav(wavPath, outName) {
  const buf = fs.readFileSync(wavPath);
  fs.copyFileSync(wavPath, path.join(OUT, outName));
  // 解析得到时长
  let off = 12, fmt = null, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.slice(off, off + 4).toString('ascii');
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') dataLen = size;
    off += 8 + size + (size & 1);
  }
  const secs = dataLen / (fmt.rate * fmt.ch * fmt.bits / 8);
  console.log(`  GO   ${outName.padEnd(38)} ${secs.toFixed(3)}s ${fmt.ch}ch/${fmt.rate}Hz`);
}

const CS2DIR = '.tmp/ab_test/cs2/sounds/weapons/ak47';
const GODIR = 'data/csgo_ref/wavout/weapons/ak47';

console.log('=== AK47 掏枪 / 拉栓 ===');
fromVsnd(`${CS2DIR}/ak47_draw.vsnd_c`, 0.451701, '1_CS2_A_AK47_掏枪_draw.wav');
fromWav(`${GODIR}/ak47_draw.wav`, '2_CSGO_B_AK47_掏枪_draw.wav');
fromVsnd(`${CS2DIR}/ak47_boltpull_01.vsnd_c`, 0.375147, '3_CS2_A_AK47_拉栓_boltpull.wav');
fromWav(`${GODIR}/ak47_boltpull.wav`, '4_CSGO_B_AK47_拉栓_boltpull.wav');

console.log('\n=== AK47 换弹 ===');
fromVsnd(`${CS2DIR}/ak47_clipout_01.vsnd_c`, 0.727415, '5_CS2_A_AK47_拔弹匣_clipout.wav');
fromWav(`${GODIR}/ak47_clipout.wav`, '6_CSGO_B_AK47_拔弹匣_clipout.wav');
fromWav(`${GODIR}/ak47_clipin.wav`, '7_CSGO_B_AK47_插弹匣_clipin.wav');
console.log('  （CS2 的插弹匣用的是通用占位音 magazine_slide_01，无 AK 专属录音）');
