// 生成 compare_request.json（规范化反斜杠路径）
const fs = require('fs');
const m = require('../data/csgo_ref/full_mapping.json');
const inScope = m.rows.filter((r) => ['SAME_PATH', 'DIFF_PATH', 'NEED_SHIP'].includes(r.cls));
const norm = (w) => 'sound/' + w.replace(/\\/g, '/');
const events = inScope.map((r) => ({
  event: r.event,
  cls: r.cls,
  csgo_wavs: (r.csgo_wavs || []).map(norm),
  cs2_vsnd: (r.cs2_vsnd || []).map((v) => v + '_c'),
}));
const goSet = new Set();
const cs2Set = new Set();
events.forEach((e) => {
  e.csgo_wavs.forEach((w) => goSet.add(w));
  e.cs2_vsnd.forEach((v) => cs2Set.add(v));
});
fs.writeFileSync(
  'data/csgo_ref/compare_request.json',
  JSON.stringify({ events, csgo_wavs: [...goSet].sort(), cs2_vsnd: [...cs2Set].sort() }, null, 0)
);
console.log('events', events.length, 'wavs', goSet.size, 'vsnds', cs2Set.size);
