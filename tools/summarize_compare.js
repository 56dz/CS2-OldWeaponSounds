// 汇总 PCM 比对结果，列出真正需要覆盖的事件
const fs = require('fs');
const d = require('../data/csgo_ref/pcm_compare.json');
const req = require('../data/csgo_ref/compare_request.json');
const csgo = require('../data/csgo_ref/csgo_events.json').events;

const byCls = {};
d.rows.forEach((r) => (byCls[r.old_cls] = (byCls[r.old_cls] || 0) + 1));
console.log('old_cls:', JSON.stringify(byCls));
console.log('pcm_cls:', JSON.stringify(d.stats));

const need = d.rows.filter((r) => r.pcm_cls !== 'SAME');
console.log('\n需要覆盖的事件数:', need.length, '/', d.rows.length);

// 按 pcm_cls 分组打印
const groups = {};
need.forEach((r) => ((groups[r.pcm_cls] = groups[r.pcm_cls] || []).push(r)));
for (const k of Object.keys(groups)) {
  console.log(`\n=== ${k} (${groups[k].length}) ===`);
  groups[k].forEach((r) => {
    const det = r.details.map((x) => `${x.verdict}`).join(',');
    console.log(`  ${r.event}  [${r.old_cls}] ${det}`);
  });
}
fs.writeFileSync(
  'data/csgo_ref/need_override.json',
  JSON.stringify(
    {
      events: need.map((r) => ({ event: r.event, pcm_cls: r.pcm_cls, old_cls: r.old_cls })),
      rows: need,
    },
    null,
    1
  )
);
console.log('\n已写 data/csgo_ref/need_override.json');
