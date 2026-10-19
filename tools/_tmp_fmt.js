const fs = require('fs');
const path = require('path');
const ROOT = 'D:/Users/Daniel/code/DSH/cssharp/CS2_Old_Weapon_Sounds';
function fmt(p) {
  const b = fs.readFileSync(p);
  if (b.toString('ascii', 0, 4) !== 'RIFF') return null;
  return {
    tag: b.readUInt16LE(20), ch: b.readUInt16LE(22), sr: b.readUInt32LE(24),
    bits: b.readUInt16LE(34), bytes: b.length,
  };
}
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/csgo_ref/legacy_all_plan.json'), 'utf8'));
const agg = {};
const odd = [];
let total = 0;
for (const w of plan.wavs) {
  const f = fmt(path.join(ROOT, 'data/csgo_ref/wavout', w));
  if (!f) { odd.push([w, 'notRIFF']); continue; }
  total += f.bytes;
  const k = `${f.tag}/${f.ch}ch/${f.sr}Hz/${f.bits}bit`;
  agg[k] = (agg[k] || 0) + 1;
  if (f.tag !== 1 || f.ch !== 1 || f.sr !== 44100 || f.bits !== 16) odd.push([w, k, f.bytes]);
}
console.log('total wavs', plan.wavs.length, 'bytes', total, (total / 1048576).toFixed(2) + 'MB');
console.log(agg);
console.log('non-44100/mono/16:', odd.length);
console.log(odd.slice(0, 40).map((x) => x.join('  ')).join('\n'));
