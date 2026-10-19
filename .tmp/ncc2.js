// 修正版 NCC：vsnd_c 的 PCM 起点必须是「文件尾 - PCM长度」，且要注意奇数长度导致的字节错位。
// 对齐后再做归一化互相关，才能真正判断是否同一录音。
const fs = require('fs');

function readWav(buf) {
  if (buf.slice(0, 4).toString('ascii') !== 'RIFF') return null;
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.slice(off, off + 4).toString('ascii');
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.slice(off + 8, Math.min(off + 8 + size, buf.length));
    off += 8 + size + (size & 1);
  }
  return fmt && data ? { fmt, data } : null;
}

function toFloat(buf, start) {
  const n = Math.floor((buf.length - start) / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(start + i * 2) / 32768;
  return out;
}

function ncc(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 512) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

// dur: CS2 声明的时长（用来反推 PCM 长度，从而确定 PCM 起点）
function compare(wavPath, vsndPath, dur) {
  const w = readWav(fs.readFileSync(wavPath));
  const vbuf = fs.readFileSync(vsndPath);
  if (!w) return { err: 'bad wav' };
  const rate = w.fmt.rate, ch = w.fmt.ch, bits = w.fmt.bits;
  const pcmLen = Math.round(dur * rate * ch * bits / 8);
  // PCM 起点：从文件尾倒数 pcmLen，并保证偶数对齐
  let start = vbuf.length - pcmLen;
  if (start % 2 !== 0) start += 1;
  const v = toFloat(vbuf, start);
  const wf = toFloat(w.data, 0);

  // 取 wav 中段 8192 样本作为参照
  const refLen = 8192;
  const refStart = Math.floor(wf.length * 0.25);
  if (refStart + refLen > wf.length) return { err: 'wav too short', wLen: wf.length };
  const ref = wf.subarray(refStart, refStart + refLen);

  let best = -1, bestAt = -1;
  for (let at = 0; at + refLen <= v.length; at += 256) {
    const c = ncc(ref, v.subarray(at, at + refLen));
    if (c > best) { best = c; bestAt = at; }
  }
  return { ncc: best, at: bestAt, start, pcmLen, vLen: v.length, wLen: wf.length, secs: (pcmLen / (rate * ch * bits / 8)) };
}

const args = process.argv.slice(2);
for (const a of args) {
  const [wavPath, vsndPath, dur] = a.split('|');
  const r = compare(wavPath, vsndPath, Number(dur));
  if (r.err) { console.log(`${wavPath}: ${r.err}`); continue; }
  const verdict = r.ncc > 0.9 ? '★同一录音' : r.ncc > 0.6 ? '相似' : '不同录音';
  console.log(
    `${vsndPath.split('/').pop().padEnd(26)} NCC=${r.ncc.toFixed(3).padStart(6)} ` +
    `pcmStart=0x${r.start.toString(16)} len=${r.pcmLen}B(${r.secs.toFixed(3)}s) ` +
    `wav=${(r.wLen / 44100).toFixed(3)}s  ${verdict}`
  );
}
