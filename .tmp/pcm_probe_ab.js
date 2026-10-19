// 用 CS:GO wav 的 PCM 做探针，在 CS2 的 vsnd_c 里搜索，判断 CS2 用的到底是不是 CS:GO 那份录音。
// 这比解析 RED2 容器可靠：只要 PCM 字节在，就说明音频相同。
const fs = require('fs');
const path = require('path');

function readWav(buf) {
  if (buf.slice(0, 4).toString('ascii') !== 'RIFF') return null;
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.slice(off, off + 4).toString('ascii');
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(off + 10),
        rate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      data = buf.slice(off + 8, Math.min(off + 8 + size, buf.length));
    }
    off += 8 + size + (size & 1);
  }
  return fmt && data ? { fmt, data } : null;
}

function probe(hay, needle) {
  // 取 3 段各 512 字节做探针，避开开头静音
  const results = [];
  const segLen = 512;
  const starts = [
    Math.floor(needle.length * 0.15),
    Math.floor(needle.length * 0.45),
    Math.floor(needle.length * 0.75),
  ];
  for (const s of starts) {
    const p = needle.slice(s, s + segLen);
    const at = hay.indexOf(p);
    results.push({ from: s, found: at >= 0, at });
  }
  return results;
}

const wavDir = process.argv[2];
const vsndDir = process.argv[3];
const pairs = process.argv.slice(4);

for (const pair of pairs) {
  const [wavRel, vsndRel] = pair.split('=');
  const wavPath = path.join(wavDir, wavRel);
  const vsndPath = path.join(vsndDir, vsndRel);
  if (!fs.existsSync(wavPath) || !fs.existsSync(vsndPath)) {
    console.log(`${wavRel}: MISSING FILE`);
    continue;
  }
  const w = readWav(fs.readFileSync(wavPath));
  const v = fs.readFileSync(vsndPath);
  if (!w) { console.log(`${wavRel}: BAD WAV`); continue; }
  const res = probe(v, w.data);
  const hits = res.filter(r => r.found).length;
  const secs = (w.data.length / (w.fmt.rate * w.fmt.channels * w.fmt.bits / 8)).toFixed(3);
  console.log(
    `${wavRel.padEnd(34)} wav ${w.fmt.channels}ch/${w.fmt.rate}Hz/${w.fmt.bits}bit ${secs}s ` +
    `pcm=${w.data.length}B vsnd=${v.length}B  probes=${hits}/3 ` +
    res.map(r => (r.found ? `@0x${r.at.toString(16)}` : 'miss')).join(',')
  );
}
