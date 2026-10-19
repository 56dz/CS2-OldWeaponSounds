const fs = require('fs');
const path = require('path');
const ROOT = 'D:/Users/Daniel/code/DSH/cssharp/CS2_Old_Weapon_Sounds';
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/csgo_ref/legacy_all_plan.json'), 'utf8'));

function vsndOf(wav) {
  const rel = wav.replace(/^sound\//i, '').replace(/\.wav$/i, '.vsnd');
  const rel2 = rel.replace(/^weapons\//i, '');
  return 'sounds/weapons_csgo/' + rel2;
}
const map = new Map();
let dup = 0;
for (const w of plan.wavs) {
  const v = vsndOf(w);
  if (map.has(v) && map.get(v) !== w) { console.log('COLLISION', v, map.get(v), w); dup++; }
  map.set(v, w);
}
console.log('wavs', plan.wavs.length, 'vsnd paths', map.size, 'collisions', dup);

// 检查 wav 是否都在本地
const miss = plan.wavs.filter((w) => !fs.existsSync(path.join(ROOT, 'data/csgo_ref/wavout', w)));
console.log('missing wav', miss.length);

// 统计事件覆盖明细
const byPrefix = {};
for (const e of plan.events) {
  const p = e.event.split('.')[0];
  byPrefix[p] = (byPrefix[p] || 0) + 1;
}
const sorted = Object.entries(byPrefix).sort((a, b) => b[1] - a[1]);
console.log('事件前缀分布:', sorted.map(([k, v]) => `${k}=${v}`).join(' '));

// 检查每个事件是否有 vsnd 字段可替换（用生成的 out 文件验证）
const out = fs.readFileSync(path.join(ROOT, 'data/out/soundevents_addon.vsndevts'), 'utf8');
const lines = out.split('\n');
const blockRe = /^\t(\S[^\s=]*)\s*=\s*$/;
const idx = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = blockRe.exec(lines[i]);
  if (!m) continue;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j] === '\t}') { idx.set(m[1], [i, j]); break; }
  }
}
let noVsnd = [];
for (const e of plan.events) {
  const r = idx.get(e.event);
  if (!r) { console.log('MISSING BLOCK', e.event); continue; }
  const body = lines.slice(r[0], r[1] + 1).join('\n');
  if (!body.includes('vsnd_files_track_01')) noVsnd.push(e.event);
}
console.log('生成块数', idx.size, '缺 vsnd 字段的事件', noVsnd.length);
if (noVsnd.length) console.log(noVsnd.join('\n'));
