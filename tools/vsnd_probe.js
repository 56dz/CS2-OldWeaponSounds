// 从 CS2 客户端 pak01 提取 vsnd_c 并估算响度
// vsnd_c 结构未知，但其 PCM 数据段是 int16 直存，用滑动窗口扫描最大连续 int16 段估算
const fs = require('fs');

function readVpkEntry(vpkDir, target) {
  const buf = fs.readFileSync(vpkDir);
  const sig = buf.readUInt32LE(0);
  if (sig !== 0x55aa1234) throw new Error('bad sig');
  const ver = buf.readUInt32LE(4);
  let headerSize = 12, treeSize;
  if (ver === 1) { treeSize = buf.readUInt32LE(8); }
  else { treeSize = buf.readUInt32LE(12); headerSize = 28; }
  const tree = buf.subarray(headerSize, headerSize + treeSize);
  let p = 0;
  while (p < tree.length) {
    let end = p; while (end < tree.length && tree[end] !== 0) end++;
    const ext = tree.toString('ascii', p, end); p = end + 1;
    if (!ext) break;
    while (p < tree.length) {
      end = p; while (end < tree.length && tree[end] !== 0) end++;
      const dir = tree.toString('ascii', p, end); p = end + 1;
      if (!dir) break;
      while (p < tree.length) {
        end = p; while (end < tree.length && tree[end] !== 0) end++;
        const fname = tree.toString('ascii', p, end); p = end + 1;
        if (!fname) break;
        const crc = tree.readUInt32LE(p);
        const preload = tree.readUInt16LE(p + 4);
        const arch = tree.readUInt16LE(p + 6);
        const eoff = tree.readUInt32LE(p + 8);
        const elen = tree.readUInt32LE(p + 12);
        p += 16 + preload;
        const full = (dir ? dir + '/' : '') + fname + '.' + ext;
        if (full.toLowerCase() === target.toLowerCase()) return { arch, eoff, elen, preload, crc };
      }
    }
  }
  return null;
}

function extract(entry, dirVpk) {
  if (entry.arch === 0x7fff) {
    const all = fs.readFileSync(dirVpk);
    const hdr = all.readUInt32LE(4) === 1 ? 12 : 28;
    const treeSize = all.readUInt32LE(4) === 1 ? all.readUInt32LE(8) : all.readUInt32LE(12);
    return all.subarray(hdr + treeSize + entry.eoff, hdr + treeSize + entry.eoff + entry.elen);
  }
  const base = dirVpk.replace(/pak01_dir\.vpk$/i, `pak01_${String(entry.arch).padStart(3, '0')}.vpk`);
  const fd = fs.openSync(base, 'r');
  const b = Buffer.alloc(entry.elen);
  fs.readSync(fd, b, 0, entry.elen, entry.eoff);
  fs.closeSync(fd);
  return b;
}

// 估算 vsnd_c 里的 PCM 响度：扫描所有 2 字节对齐位置，找最长的「非零且能量高」段
function estimate(buf) {
  const n = Math.floor(buf.length / 2);
  const samples = [];
  let zeros = 0;
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(i * 2);
    if (v === 0) zeros++;
  }
  // 采样统计：每隔 16 个样本取一个
  let sum = 0, cnt = 0, peak = 0;
  let run = 0, bestRun = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768;
    if (Math.abs(s) > 0.0005) { run++; if (run > bestRun) bestRun = run; } else run = 0;
    if (i % 16 === 0) { sum += s * s; cnt++; if (Math.abs(s) > peak) peak = Math.abs(s); }
  }
  return { total: buf.length, zeroRatio: (zeros / n).toFixed(2), rms: Math.sqrt(sum / Math.max(cnt, 1)).toFixed(4), peak: peak.toFixed(3), longestNonSilentRun: bestRun };
}

const dirVpk = process.argv[2];
const targets = process.argv.slice(3);
for (const t of targets) {
  const e = readVpkEntry(dirVpk, t);
  if (!e) { console.log(t, 'NOT FOUND'); continue; }
  const b = extract(e, dirVpk);
  const s = estimate(b);
  console.log(`${t.padEnd(52)} ${e.elen}B zero=${s.zeroRatio} rms≈${s.rms} peak≈${s.peak} 最长有声段=${s.longestNonSilentRun}`);
}
