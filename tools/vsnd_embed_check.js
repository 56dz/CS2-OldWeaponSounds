// 判断 vsnd_c 是否内嵌了某个 wav 的 PCM 数据
// 方法：取 wav 的 data 块，在 vsnd_c 里搜其前 N 字节；再比对长度
const fs = require('fs');

function wavData(buf) {
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
    else if (id === 'data') data = buf.subarray(body, Math.min(body + size, buf.length));
    off = body + size + (size & 1);
  }
  return data ? { fmt, data } : null;
}

function rmsOf(data) {
  const n = Math.floor(data.length / 2);
  let sum = 0, peak = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const s = data.readInt16LE(i * 2) / 32768;
    sum += s * s;
    if (Math.abs(s) > peak) peak = Math.abs(s);
    if (Math.abs(s) > 0.001) nz++;
  }
  const r = Math.sqrt(sum / Math.max(n, 1));
  return { rms: +r.toFixed(4), dbfs: +(20 * Math.log10(r || 1e-9)).toFixed(1), peak: +peak.toFixed(3), active: +(nz / Math.max(n, 1)).toFixed(2), samples: n };
}

const wavPath = process.argv[2];
const vsndPaths = process.argv.slice(3);
const w = wavData(fs.readFileSync(wavPath));
if (!w) { console.log('wav 解析失败'); process.exit(1); }
const wavStat = rmsOf(w.data);
console.log(`源 wav: ${wavPath.split(/[\\/]/).pop()}`);
console.log(`  格式 ${w.fmt.ch}ch/${w.fmt.sr}Hz/${w.fmt.bits}bit  data=${w.data.length}B  ${JSON.stringify(wavStat)}`);
console.log('');

for (const vp of vsndPaths) {
  const vb = fs.readFileSync(vp);
  // 1) 找完整 data
  const idxFull = vb.indexOf(w.data);
  // 2) 找前 512 字节
  const probe = w.data.subarray(0, Math.min(512, w.data.length));
  const idxProbe = vb.indexOf(probe);
  // 3) 找中段 256 字节
  const mid = w.data.subarray(Math.floor(w.data.length / 2), Math.floor(w.data.length / 2) + 256);
  const idxMid = vb.indexOf(mid);
  const name = vp.split(/[\\/]/).pop();
  console.log(`${name.padEnd(34)} size=${String(vb.length).padEnd(8)} 完整PCM=${idxFull >= 0 ? '@' + idxFull : '否'}  前512B=${idxProbe >= 0 ? '@' + idxProbe : '否'}  中段256B=${idxMid >= 0 ? '@' + idxMid : '否'}`);
  if (idxFull >= 0) {
    const st = rmsOf(vb.subarray(idxFull, idxFull + w.data.length));
    console.log(`${''.padEnd(34)} → 内嵌 PCM 响度 ${JSON.stringify(st)}  ${JSON.stringify(st) === JSON.stringify(wavStat) ? '与源 wav 完全一致' : '与源 wav 不同'}`);
  }
}
