// 生成 "事件 -> CS:GO wav 列表" 覆盖表，并判断哪些 wav 需要自带
const fs = require('fs');
const cmp = require('../data/csgo_ref/pcm_compare.json');
const req = require('../data/csgo_ref/compare_request.json');
const csgo = require('../data/csgo_ref/csgo_events.json').events;

const need = cmp.rows.filter((r) => r.pcm_cls !== 'SAME');
const reqByEvent = new Map(req.events.map((e) => [e.event, e]));

// 1) 收集每个需要覆盖的事件对应的 CS:GO wav（规范化路径）
const overrides = [];
const allWavs = new Set();
for (const r of need) {
  const e = reqByEvent.get(r.event);
  if (!e || !e.csgo_wavs.length) continue;
  const wavs = e.csgo_wavs.map((w) => w.replace(/^sound\//, '').replace(/\\/g, '/'));
  overrides.push({ event: r.event, pcm_cls: r.pcm_cls, wavs });
  wavs.forEach((w) => allWavs.add(w));
}

// 2) 判定每个 wav 在 CS2 客户端「同路径」是否存在
//    sound/<rel>.wav -> sounds/<rel>.vsnd_c
const cs2List = fs
  .readFileSync('data/cs2_vpk_list.txt', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => l.split(/\s+/).slice(1).join(' ').toLowerCase());
const cs2Set = new Set(cs2List);

const ship = [];
const reuse = [];
for (const w of [...allWavs].sort()) {
  const target = ('sounds/' + w.replace(/\.wav$/i, '') + '.vsnd_c').toLowerCase();
  if (cs2Set.has(target)) reuse.push({ wav: 'sound/' + w, vsnd: 'sounds/' + w.replace(/\.wav$/i, '.vsnd') });
  else ship.push({ wav: 'sound/' + w, vsnd: 'sounds/' + w.replace(/\.wav$/i, '.vsnd') });
}

console.log('覆盖事件:', overrides.length);
console.log('唯一 CS:GO wav:', allWavs.size);
console.log('  CS2 已有同路径 vsnd:', reuse.length);
console.log('  需 addon 自带 wav   :', ship.length);

fs.writeFileSync(
  'data/csgo_ref/override_plan.json',
  JSON.stringify({ overrides, ship, reuse }, null, 1)
);

// 3) 汇总一下：按武器前缀统计
const byWeapon = {};
overrides.forEach((o) => {
  const p = o.event.replace(/^Weapon_/, '').split('.')[0];
  byWeapon[p] = (byWeapon[p] || 0) + 1;
});
console.log('\n每个武器的覆盖事件数:');
Object.keys(byWeapon)
  .sort((a, b) => byWeapon[b] - byWeapon[a])
  .forEach((k) => console.log('  ' + k, byWeapon[k]));
