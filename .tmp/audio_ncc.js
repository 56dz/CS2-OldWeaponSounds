// 判断 CS2 的 vsnd_c 与 CS:GO 的 wav 是否为「同一录音的重编码」。
// 方法：把 vsnd_c 尾部当成 PCM（已知贴尾），与 wav 的 PCM 做归一化互相关（NCC），
// 并允许 ±2048 样本的偏移搜索。NCC > 0.9 基本可判定同一录音，< 0.3 判定不同录音。
const fs = require('fs');

function readWav(buf) {
  if (buf.slice(0, 4).toString('ascii') !== 'RIFF') return null;
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.slice(off, off + 4).toString('ascii');
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === 'data') {
      data = buf.slice(off + 8, Math.min(off + 8 + size, buf.length));
    }
    off += 8 + size + (size & 1);
  }
  return fmt && data ? { fmt, data } : null;
}

// 把 16bit PCM 转 float 数组
function toFloat(buf) {
  const out = new Float32Array(Math.floor(buf.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

// 归一化互相关，在 hay 里搜索 needle（needle 为 hay 的一段）
function nccAt(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 256) return 0;
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

// 从 vsnd 尾部取一段作为 needle，在 wav PCM 里搜（允许 vsnd 头部长度未知）
function compare(vsndBuf, wavPcm) {
  const w = toFloat(wavPcm);
  const v = toFloat(vsndBuf);
  // 取 wav 中段 8192 样本作为参照（避开首尾静音）
  const refLen = 8192;
  const refStart = Math.floor(w.length * 0.3);
  if (refStart + refLen > w.length) return { ncc: 0, note: 'wav too short' };
  const ref = w.subarray(refStart, refStart + refLen);

  let best = -1, bestAt = -1;
  // 在 vsnd 里滑窗搜索同一段
  for (let at = 0; at + refLen <= v.length; at += 512) {
    const seg = v.subarray(at, at + refLen);
    const c = nccAt(ref, seg);
    if (c > best) { best = c; bestAt = at; }
  }
  return { ncc: best, at: bestAt, refStart, refLen, vLen: v.length, wLen: w.length };
}

const pairs = process.argv.slice(2);
for (const p of pairs) {
  const [wavPath, vsndPath] = p.split('=');
  const w = readWav(fs.readFileSync(wavPath));
  const v = fs.readFileSync(vsndPath);
  if (!w) { console.log(`${wavPath}: BAD WAV`); continue; }
  const r = compare(v, w.data);
  const verdict = r.ncc > 0.9 ? 'SAME(同一录音)' : r.ncc > 0.6 ? 'SIMILAR(相似)' : 'DIFFERENT(不同录音)';
  console.log(
    `${wavPath.split('/').pop().padEnd(22)} vs ${vsndPath.split('/').pop().padEnd(26)} ` +
    `NCC=${r.ncc.toFixed(3)} bestAt=${r.at} wavPCM=${(r.wLen / 2 / 44100).toFixed(3)}s vsnd=${(r.vLen / 2 / 44100).toFixed(3)}s  ${verdict}`
  );
}
