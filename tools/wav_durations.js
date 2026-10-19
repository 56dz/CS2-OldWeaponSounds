#!/usr/bin/env node
// 扫描 wav 目录，输出每个 wav 的时长（秒）。
// 用法: node tools/wav_durations.js <wav根目录> <out.json>
//
// 用途：对比 CS2 原事件的 vsnd_duration 与 CS:GO 素材时长，
// 找出「CS2 音效明显比 CS:GO 长」的事件 —— 这类事件换短音后，
// 后面的动画窗口会变成静音，听感上就是「没声音」。
'use strict';
const fs = require('fs');
const path = require('path');

const [srcDir, outPath] = process.argv.slice(2);
if (!srcDir || !outPath) {
  console.error('用法: node tools/wav_durations.js <wav根目录> <out.json>');
  process.exit(1);
}

/** 解析 wav 的 fmt/data，返回时长；支持 JUNK 块等非标准排列 */
function wavDuration(buf) {
  if (buf.length < 12) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let dataSize = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      dataSize = size;
      if (channels && rate) break; // data 块 + 已有 fmt 即可算时长
    }
    off = body + size + (size & 1);
  }
  if (!channels || !rate) return null;
  const bytesPerSample = Math.max(1, bits / 8) * channels;
  const frames = dataSize / bytesPerSample;
  return frames / rate;
}

/** 递归收集 wav（相对路径用 / 分隔） */
function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else if (/\.wav$/i.test(name)) {
      out.push({ full, rel: path.relative(base, full).split(path.sep).join('/') });
    }
  }
}

const files = [];
walk(path.resolve(srcDir), path.resolve(srcDir), files);
files.sort((a, b) => (a.rel < b.rel ? -1 : 1));

const rows = [];
let fail = 0;
for (const f of files) {
  const buf = fs.readFileSync(f.full);
  const dur = wavDuration(buf);
  if (dur === null || !Number.isFinite(dur)) {
    fail++;
    rows.push({ wav: f.rel, dur: null, bytes: buf.length });
  } else {
    rows.push({ wav: f.rel, dur: +dur.toFixed(4), bytes: buf.length });
  }
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(rows, null, 1) + '\n');
console.log(`wav 数: ${rows.length}  解析失败: ${fail}  → ${outPath}`);
