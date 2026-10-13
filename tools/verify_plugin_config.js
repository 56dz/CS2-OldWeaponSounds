// 交叉校验插件 config.json 与 addon、items_game.txt 的一致性
// 用法: node verify_plugin_config.js <config.json> <生成的.vsndevts> <items_game_defindex.tsv> <legacy_map_full.json>
//
// 校验：
//   1. config 条目数 = 35，且与映射表一一对应
//   2. 每条 legacy_event / orig_event 都在 addon vsndevts 里真实存在（Weapon_*.Single / Orig_Weapon_*.Single）
//   3. 每个数字 key 都等于映射表的 item_def_index，且 weapon_name 与 CS2 items_game.txt 中该 def_index 的 name 一致
//   4. 数字 key 无重复、无遗漏；非数字 key（PartyHorn）确实在 items_game.txt 中不存在
const fs = require('fs');

const [cfgPath, addonPath, itemsPath, mapPath] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const addon = fs.readFileSync(addonPath, 'utf8').replace(/\r\n/g, '\n');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')).weapons;

const items = new Map();
for (const line of fs.readFileSync(itemsPath, 'utf8').split('\n')) {
  const p = line.split('\t');
  if (p.length >= 2 && /^\d+$/.test(p[0])) items.set(parseInt(p[0]), p[1]);
}

let fail = 0;
const err = (m) => { console.log('  [FAIL] ' + m); fail++; };
const ok = (m) => console.log('  [ OK ] ' + m);

const keys = Object.keys(cfg.weapons);
console.log('1) 条目数');
keys.length === map.length ? ok(`config 武器条目 ${keys.length} = 映射表 ${map.length}`) : err(`config 条目 ${keys.length} != ${map.length}`);

console.log('2) 事件名存在于 addon');
const expectEvents = new Set();
for (const w of map) { expectEvents.add(`${w.event}.Single`); expectEvents.add(`Orig_${w.event}.Single`); }
let evOk = 0;
for (const k of keys) {
  const w = cfg.weapons[k];
  for (const f of ['legacy_event', 'orig_event']) {
    const name = w[f];
    if (!new RegExp('^\\t' + name.replace(/\./g, '\\.') + ' = $', 'm').test(addon)) { err(`${k}/${w.name}: ${f}="${name}" 不在 addon vsndevts 中`); }
    else if (!expectEvents.has(name)) err(`${k}/${w.name}: ${f}="${name}" 不是预期的 35x2 事件之一`);
    else evOk++;
  }
}
if (evOk === keys.length * 2) ok(`${evOk} 个事件名全部命中 addon 的 35x2 事件`);

console.log('3) item_def_index / weapon_name 与 CS2 items_game.txt 一致');
let nOk = 0;
for (const k of keys) {
  const w = cfg.weapons[k];
  if (!/^\d+$/.test(k)) {
    // 非数字 key：必须确实没有 def_index
    const found = [...items.entries()].filter(([, n]) => n === w.weapon_name);
    found.length === 0 && w.item_def_index === null
      ? ok(`${k}(${w.name}): items_game.txt 无 ${w.weapon_name}，key 为非数字，永不误匹配`)
      : err(`${k}(${w.name}): 非数字 key 但 items_game 中存在 ${w.weapon_name}`);
    continue;
  }
  const di = parseInt(k);
  if (w.item_def_index !== di) err(`${k}: item_def_index 字段 ${w.item_def_index} != key ${di}`);
  const nm = items.get(di);
  if (nm === undefined) err(`${k}: items_game.txt 无 def_index ${di}`);
  else if (nm !== w.weapon_name) err(`${k}(${w.name}): weapon_name=${w.weapon_name}，items_game.txt 中 def ${di} = ${nm}`);
  else nOk++;
}
if (nOk) ok(`${nOk}/${keys.filter(k => /^\d+$/.test(k)).length} 个数字条目与 items_game.txt 完全一致`);

console.log('4) 映射表覆盖');
const cfgEvents = new Set(keys.map(k => cfg.weapons[k].legacy_event));
const missing = [...expectEvents].filter(e => !e.startsWith('Orig_') && !cfgEvents.has(e));
missing.length === 0 ? ok('映射表 35 个 Weapon_*.Single 全部出现在 config') : err('config 缺少: ' + missing.join(', '));

console.log(fail === 0 ? '\n结果: 全部通过' : `\n结果: ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
