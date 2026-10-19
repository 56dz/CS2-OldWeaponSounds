// 把全量旧音（csgo_old_weapon_sounds）合并进服务器模型包 wa
// 用法: node tools/merge_audio_into_wa.js [--apply]
//   - 备份 wa/soundevents + wa/sounds 到 wa 目录同级 _backup-<ts>/
//   - 用新 vsndevts 覆盖 wa/soundevents/soundevents_addon.vsndevts
//   - 用新 477 个 wav 覆盖 wa/sounds/weapons_csgo/**
//   - 删除 wa 里不再被引用的 sounds/weapons/ak47/ak47_csgo_01.*
//   - 删除模板残留 bird_01..06 / interior_01 / vent_01（content + game）
// 默认 dry-run，只有带 --apply 才落盘
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CS2 = 'D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive';
const SRC_C = path.join(CS2, 'content/csgo_addons/csgo_old_weapon_sounds');
const SRC_G = path.join(CS2, 'game/csgo_addons/csgo_old_weapon_sounds');
const WAC = path.join(CS2, 'content/csgo_addons/wa');
const WAG = path.join(CS2, 'game/csgo_addons/wa');

const plan = JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json', 'utf8'));
const wavs = (plan.wavs || []).map((w) => (typeof w === 'string' ? w : w.wav)).map((w) => w.toLowerCase());
console.log('plan wavs', wavs.length);

const relOf = (w) =>
  w
    .replace(/^sound\//i, '')
    .replace(/^weapons\//i, '')
    .replace(/\.wav$/i, '');

let copied = 0;
let missing = 0;
const log = [];
for (const w of wavs) {
  const rel = relOf(w);
  const srcWav = path.join(SRC_C, 'sounds/weapons_csgo', rel + '.wav');
  const dstWav = path.join(WAC, 'sounds/weapons_csgo', rel + '.wav');
  const srcVsnd = path.join(SRC_G, 'sounds/weapons_csgo', rel + '.vsnd_c');
  const dstVsnd = path.join(WAG, 'sounds/weapons_csgo', rel + '.vsnd_c');
  if (!fs.existsSync(srcWav)) missing++;
  log.push([srcWav, dstWav]);
  log.push([srcVsnd, dstVsnd]);
}

// 新 vsndevts
log.push([path.join(SRC_C, 'soundevents/soundevents_addon.vsndevts'), path.join(WAC, 'soundevents/soundevents_addon.vsndevts')]);

// 待删除
const deletes = [
  path.join(WAC, 'sounds/weapons/ak47/ak47_csgo_01.wav'),
  path.join(WAG, 'sounds/weapons/ak47/ak47_csgo_01.vsnd_c'),
];
for (let i = 1; i <= 6; i++) {
  deletes.push(path.join(WAC, `sounds/bird_0${i}.vsnd_c`));
  deletes.push(path.join(WAG, `sounds/bird_0${i}.vsnd_c`));
}
deletes.push(path.join(WAC, 'sounds/interior_01.vsnd_c'), path.join(WAG, 'sounds/interior_01.vsnd_c'));
deletes.push(path.join(WAC, 'sounds/vent_01.vsnd_c'), path.join(WAG, 'sounds/vent_01.vsnd_c'));

console.log('待拷贝', log.length, '条；缺失源 wav', missing);
console.log('待删除', deletes.length, '个（存在的）：');
deletes.filter((p) => fs.existsSync(p)).forEach((p) => console.log('  DEL', path.relative(CS2, p)));

if (!APPLY) {
  console.log('\n[dry-run] 加 --apply 才落盘');
  process.exit(0);
}

const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const bk = path.join(CS2, 'game/csgo_addons', `_bk-wa-audio-${ts}`);
fs.mkdirSync(path.join(bk, 'soundevents'), { recursive: true });
fs.copyFileSync(path.join(WAG, 'soundevents/soundevents_addon.vsndevts_c'), path.join(bk, 'soundevents/soundevents_addon.vsndevts_c'));
fs.copyFileSync(path.join(WAC, 'soundevents/soundevents_addon.vsndevts'), path.join(bk, 'soundevents/soundevents_addon.vsndevts'));
console.log('备份到', bk);

let n = 0;
for (const [s, d] of log) {
  if (!fs.existsSync(s)) { console.log('  MISS SRC', s); continue; }
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(s, d);
  n++;
}
let del = 0;
for (const p of deletes) {
  if (fs.existsSync(p)) { fs.unlinkSync(p); del++; }
}
console.log('已拷贝', n, '已删除', del);
