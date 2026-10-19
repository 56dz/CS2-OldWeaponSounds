#!/usr/bin/env node
// 分析 vsnd_c 的音频能量分布（不依赖音频解码，用启发式：
// 在文件中寻找 PCM 数据的统计特征）。
//
// 更可靠的办法：vsnd_c 是 CS2 自定义容器，内含波形数据（可能是 ADPCM/自定义压缩）。
// 本工具做的是「文件体积分段能量估算」——把文件按等分切块，统计每块的高熵字节比例，
// 用来粗略判断声音在文件时间轴上的分布。**只能做定性参考**。
//
// 用法: node tools/vsnd_profile.js <file.vsnd_c> [...more]
'use strict';
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node tools/vsnd_profile.js <file.vsnd_c> [...]');
  process.exit(1);
}

for (const f of files) {
  const buf = fs.readFileSync(f);
  const N = 40;
  const seg = Math.floor(buf.length / N);
  const parts = [];
  for (let i = 0; i < N; i++) {
    const s = buf.subarray(i * seg, (i + 1) * seg);
    // 用「非零字节 + 非重复字节」做粗略活动度指标
    let nonzero = 0;
    const seen = new Set();
    for (const b of s) {
      if (b !== 0) nonzero++;
      if (seen.size < 64) seen.add(b);
    }
    const act = nonzero / s.length;
    const div = seen.size / 64;
    parts.push(Math.round((act * 0.6 + div * 0.4) * 9));
  }
  console.log(`${f.split(/[\\/]/).pop()}  ${buf.length}B`);
  console.log('  ' + parts.join(''));
}
