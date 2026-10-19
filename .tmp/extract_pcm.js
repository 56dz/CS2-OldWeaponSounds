// 提取 vsnd_c 内嵌的 PCM 数据为可播放的 wav，供 A/B 试听。
// 用法: node .tmp/extract_pcm.js <in.vsnd_c> <out.wav>
// vsnd_c 容器内嵌原始 PCM（与源 wav 同 fmt），我们扫描 RIFF fmt/data 块重建可播 wav。
const fs = require('fs');

const [, , inp, outp] = process.argv;
const buf = fs.readFileSync(inp);

// 找 fmt 块
function findChunk(name, from) {
  const pat = Buffer.from(name, 'ascii');
  let i = from;
  while (true) {
    i = buf.indexOf(pat, i);
    if (i < 0) return null;
    // 块头: 4字节ID + 4字节小端大小
    const size = buf.readUInt32LE(i + 4);
    if (size > 0 && size < buf.length) return { off: i, size };
    i += 4;
  }
}
const fmt = findChunk('fmt ', 0);
if (!fmt) { console.error('no fmt chunk'); process.exit(1); }
const fmtBody = buf.slice(fmt.off + 8, fmt.off + 8 + fmt.size);
const channels = fmtBody.readUInt16LE(2);
const rate = fmtBody.readUInt32LE(4);
const bits = fmtBody.readUInt16LE(14);
const data = findChunk('data', fmt.off);
if (!data) { console.error('no data chunk'); process.exit(1); }
const pcm = buf.slice(data.off + 8, data.off + 8 + data.size);
const byteRate = rate * channels * bits / 8;

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
fmtBody.copy(header, 20, 0, 16);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

fs.writeFileSync(outp, Buffer.concat([header, pcm]));
console.log(`${path2(inp)} -> ${outp}: ${channels}ch ${rate}Hz ${bits}bit ${(pcm.length / byteRate).toFixed(3)}s`);
function path2(p) { return p.split('/').pop(); }
