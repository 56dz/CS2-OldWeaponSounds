// 解析 CS2 vsnd_c (RED2 容器) 的头部，找到真实音频负载偏移与格式。
// 头部布局(实测 ak47_boltpull.vsnd_c):
// 0x00: 16 05 00 00        版本/类型?
// 0x04: 0c 00 05 00
// 0x08: 08 00 00 00 03 00 00 00
// 0x10: 'RED2' <len=0x2C>
// 0x18: <len2=0x312> 'DATA' <len=0x340> <pad8?>  ... 'CTRL' <len>...
// 关键: 'RED2' 块里有字符串 m_RelativeFilename = sounds/weapons/ak47/_boltpull.mp3
// 音频负载在哪? mp3 sync 扫描命中多个假阳性(纯数据也可能撞 0xFFEx)。
// 正确办法: 找 'DATA' 块, 其 len 字段后 8 字节为负载起点(对齐), 负载长 len。
// 打印结构细节判断。
const fs = require('fs');
const inp = process.argv[2];
const buf = fs.readFileSync(inp);

function u32(o) { return buf.readUInt32LE(o); }
function tag(o) { return buf.slice(o, o + 4).toString('ascii'); }

console.log(`size=${buf.length}`);
for (let i = 0; i < Math.min(buf.length, 0x100); i += 4) {
  const t = tag(i);
  if (/^[A-Z0-9_]{4}$/.test(t)) {
    console.log(`0x${i.toString(16)}: '${t}' len=0x${u32(i + 4).toString(16)} (${u32(i + 4)})`);
  }
}
// mp3 sync 分布
const hits = [];
for (let i = 0; i < buf.length - 4; i++) {
  if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
    const bri = (buf[i + 2] >> 4) & 15;
    const ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3;
    if (bri !== 0 && bri !== 15 && ver !== 1 && layer !== 0) hits.push(i);
  }
}
console.log('mp3 sync offsets:', hits.map(h => '0x' + h.toString(16)).join(' '));
