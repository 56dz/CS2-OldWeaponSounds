// 以 content/csgo_addons/wa/sounds/**/*.wav 为准，清理 game/csgo_addons/wa/sounds 里多余的 vsnd_c
const fs = require('fs');
const path = require('path');
const CS2 = 'D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive';
const GAME = path.join(CS2, 'game/csgo_addons/wa');
const CONTENT = path.join(CS2, 'content/csgo_addons/wa');

function walk(d, o = []) {
  if (!fs.existsSync(d)) return o;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, e.name);
    if (e.isDirectory()) walk(q, o);
    else o.push(q);
  }
  return o;
}

const want = new Set(
  walk(path.join(CONTENT, 'sounds'))
    .filter((f) => f.toLowerCase().endsWith('.wav'))
    .map((f) => path.relative(CONTENT, f).split(path.sep).join('/').replace(/\.wav$/i, '.vsnd_c'))
);
const all = walk(path.join(GAME, 'sounds')).filter((f) => f.endsWith('.vsnd_c'));
let removed = 0;
const keptMissingSource = [];
for (const f of all) {
  const rel = path.relative(GAME, f).split(path.sep).join('/');
  if (!want.has(rel)) {
    // .vsnd_c 但 content 里没有对应 .wav —— 可能是纯 vsnd_c 提供的历史资源，先只报不删
    keptMissingSource.push(rel);
  }
}
console.log('want (from wav):', want.size, ' game vsnd_c:', all.length);
console.log('game 里没有对应 wav 的 vsnd_c:', keptMissingSource.length);
for (const r of keptMissingSource.slice(0, 40)) console.log('  ', r);
