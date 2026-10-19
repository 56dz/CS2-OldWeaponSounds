// 比较两个 addon 编译出的同名 vsnd_c：确认差异只在 RED2 头部（内嵌 addon 名/路径），PCM 完全一致
const fs = require('fs');
const CS2 = 'D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive';
const A = CS2 + '/game/csgo_addons/csgo_old_weapon_sounds/sounds/weapons_csgo/';
const B = CS2 + '/game/csgo_addons/wa/sounds/weapons_csgo/';

function cmp(rel) {
  const a = fs.readFileSync(A + rel);
  const b = fs.readFileSync(B + rel);
  const n = Math.min(a.length, b.length);
  // 找最后一段连续相同的尾部（PCM）
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  // 从尾部往前，找最长连续相同块
  let firstDiff = -1;
  for (let k = 0; k < n; k++) if (a[k] !== b[k]) { firstDiff = k; break; }
  let lastDiff = -1;
  for (let k = 0; k < n; k++) if (a[a.length - 1 - k] !== b[b.length - 1 - k]) { lastDiff = k; break; }
  // 统计 a 在 [0, n) 内与 b 不同的字节数
  let diff = 0;
  for (let k = 0; k < n; k++) if (a[k] !== b[k]) diff++;
  console.log(
    rel.padEnd(42),
    'size', String(a.length).padStart(7), String(b.length).padStart(7),
    '| firstDiff@', String(firstDiff).padStart(5),
    '| tail same bytes', String(i).padStart(7),
    '| diffBytes', String(diff).padStart(5),
    '| pcmEqual', a.length - i === b.length - i ? 'YES' : 'NO'
  );
}

for (const f of [
  'ak47/ak47_01.vsnd_c', 'ak47/ak47_boltpull.vsnd_c', 'usp/usp_clipin.vsnd_c',
  'm4a1/m4a1_draw.vsnd_c', 'glock18/glock_02.vsnd_c', 'famas/famas_01.vsnd_c',
  'knife/knife_hit1.vsnd_c', 'physics/body/body_impact_self_06.vsnd_c',
]) {
  try { cmp(f); } catch (e) { console.log(f, 'ERR', e.message); }
}
