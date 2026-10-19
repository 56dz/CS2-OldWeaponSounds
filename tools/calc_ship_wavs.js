// 计算「需要覆盖的事件」所需的 CS:GO wav 全集，并检查是否已存在于 CS2 客户端（PCM 相同）
const fs = require('fs');
const cmp = require('../data/csgo_ref/pcm_compare.json');
const req = require('../data/csgo_ref/compare_request.json');

const need = cmp.rows.filter((r) => r.pcm_cls !== 'SAME');
const reqByEvent = new Map(req.events.map((e) => [e.event, e]));

// 所有 CS2 侧 vsnd（用于确认同一 wav 是否已在客户端以同名路径存在且 PCM 一致）
const wavs = new Map(); // wav 路径 -> { events:Set, verdicts:Set }
need.forEach((r) => {
  const e = reqByEvent.get(r.event);
  if (!e) return;
  e.csgo_wavs.forEach((w, i) => {
    if (!wavs.has(w)) wavs.set(w, { events: new Set(), verdicts: new Set() });
    wavs.get(w).events.add(r.event);
    const det = r.details[i];
    if (det) wavs.get(w).verdicts.add(det.verdict);
  });
});

console.log('需覆盖事件:', need.length);
console.log('唯一 CS:GO wav 数:', wavs.size);

// 分类：所有引用该 wav 的事件都 IDENTICAL -> 不必自带
let ship = 0;
let keep = 0;
const shipList = [];
const keepList = [];
for (const [w, info] of wavs) {
  const vs = [...info.verdicts];
  if (vs.length === 1 && vs[0] === 'IDENTICAL') {
    keep++;
    keepList.push(w);
  } else {
    ship++;
    shipList.push(w);
  }
}
console.log('  已在客户端(可直引):', keep);
console.log('  需 addon 自带   :', ship);

fs.writeFileSync(
  'data/csgo_ref/ship_wavs.json',
  JSON.stringify({ ship: shipList.sort(), keep: keepList.sort() }, null, 1)
);
console.log('\n示例 ship:', shipList.slice(0, 10));
