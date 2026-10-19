// 从 CS2 vsnd_c (RED2/DATA 容器) 中提取音频负载并包装成可播放 wav。
// 容器结构: 头部后依次出现 "RED2" 块与 "DATA" 块 (4字节对齐, 带小端长度)。
// DATA 坑: 音频负载可能是 PCM 也可能是 mp3/adpcm。我们先探格式:
//   - 若负载以 0xFFFB/0xFFF3/0xFFE3 (mp3 frame sync) 或 "ID3" 开头 -> mp3, 无法直接包装, 报告并跳过
//   - 否则按 fmt 块(独立列出)包装 wav
// 实测: CS2 vsnd_c 的 DATA 常是 mp3 载荷 (m_SearchPath csgo, _boltpull.mp3)。
// 于是退而求其次: 本脚本支持 --mp3 输出原始 mp3, 让用户用播放器试听。
const fs = require('fs');

const [, , inp, outp, mode] = process.argv;
const buf = fs.readFileSync(inp);

// 找 DATA 块: 'DATA' 后跟 4 字节小端长度, 再跟 4 字节 (通常是下一个块如 CTRL 的长度字段, 结构不统一)
// 实测布局: RED2<header> ... 'DATA' <len> <???> 'CTRL' <len> ...
// 所以 DATA 的负载长度就在 'DATA' 后 4 字节, 负载紧随其后 8 字节偏移处? 需要验证:
// 0x1A: 'DATA' 0x1E: 40030000 (0x340) 0x22: 00000000  -> 负载从 0x26 或 0x2A 开始?
// 0x26: 'CTRL' 可见, 说明 DATA 头是 8 字节: len(4) + 0(4), 负载在 'DATA'+8 后?
// 但 0x26 就是 CTRL -> 说明 DATA 的 len=0x340 指向的是 CTRL 之后的那块(头部表)。
// 更稳妥: RED2 容器里通常有两份: 头部表 + 实际音频。直接全局扫描 mp3/PCM 特征。
const isId3 = buf.slice(0, 3).toString('ascii') === 'ID3';
function scanMp3() {
  const hits = [];
  for (let i = 0; i < buf.length - 4; i++) {
    const b0 = buf[i], b1 = buf[i + 1];
    if (b0 === 0xff && (b1 & 0xe0) === 0xe0) {
      // MPEG sync: 验证版本/layer/bitr index 合法
      const ver = (b1 >> 3) & 3, layer = (b1 >> 1) & 3, bri = (buf[i + 2] >> 4) & 15;
      if (ver !== 1 && layer !== 0 && bri !== 0 && bri !== 15) hits.push(i);
    }
  }
  return hits;
}
const mp3Hits = scanMp3();
console.log(`file=${inp} size=${buf.length} ID3=${isId3} mp3SyncHits=${mp3Hits.length}`);
if (mp3Hits.length) {
  const s = mp3Hits[0];
  console.log(`first mp3 sync at 0x${s.toString(16)}`);
  if (mode === '--mp3') {
    // 从第一个 sync 截到文件尾, 播放器一般能容错尾部元数据
    fs.writeFileSync(outp, buf.slice(s));
    console.log(`wrote ${outp} (${buf.length - s}B, 可能含尾部元数据, 播放器可容错)`);
  }
}
