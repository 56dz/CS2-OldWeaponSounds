// 对「CS2 同名同路径」的开火音做 PCM 内嵌检测：
// 若 CS2 的 vsnd_c 不内嵌 CS:GO wav 的 PCM，则音色已经变了，必须覆盖。
const fs = require('fs');
const { execFileSync } = require('child_process');
const csgo = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/legacy_all_plan.json', 'utf8'));

function readWav(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF') return null;
  let off = 12;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('latin1', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      dataOff = off + 8;
      dataLen = len;
      break;
    }
    off += 8 + len + (len & 1);
  }
  if (dataOff < 0) return null;
  return buf.subarray(dataOff, Math.min(dataOff + dataLen, buf.length));
}

// 简单响度：RMS
function rms(pcm) {
  let s = 0;
  const n = Math.floor(pcm.length / 2);
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    s += v * v;
  }
  return Math.sqrt(s / Math.max(n, 1));
}

const rows = [];
for (const t of plan.events) {
  if (!/\.Single$/.test(t.event)) continue;
  const wavs = csgo[t.event] && csgo[t.event].waves;
  if (!wavs || !wavs.length) continue;
  const w0 = wavs[0].replace(/^sound\//i, '').replace(/\\/g, '/');
  const local = 'data/csgo_ref/wavout/' + w0;
  if (!fs.existsSync(local)) continue;
  const pcm = readWav(fs.readFileSync(local));
  if (!pcm) continue;
  rows.push({ ev: t.event, wav: w0, rms: rms(pcm) });
}
console.log('可检测的 Single 事件: ' + rows.length);
for (const r of rows.slice(0, 10)) console.log('  ' + r.ev.padEnd(30) + ' rms=' + r.rms.toFixed(4) + '  ' + r.wav);
fs.writeFileSync('data/csgo_ref/single_wavs.json', JSON.stringify(rows, null, 1));
