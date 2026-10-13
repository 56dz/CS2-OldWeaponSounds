// 由 .tools/legacy_map_full.json 生成插件 config.json
// 用法: node gen_config_full.js <legacy_map_full.json> <输出 config.json>
const fs = require('fs');

const [mapPath, outPath] = process.argv.slice(2);
const weapons = JSON.parse(fs.readFileSync(mapPath, 'utf8')).weapons;

const out = {
  enabled: true,
  debug: true,
  weapons: {},
};

for (const w of [...weapons].sort((a, b) => (a.item_def_index ?? 9999) - (b.item_def_index ?? 9999) || (a.name < b.name ? -1 : 1))) {
  // key 必须是 item_def_index 的字符串形式：插件按 452 消息里的 item_def_index 查表。
  // PartyHorn 在 items_game.txt 里没有条目、没有 item_def_index，用非数字 key 保证永不误匹配。
  const key = w.item_def_index === null || w.item_def_index === undefined ? w.name.toLowerCase() : String(w.item_def_index);
  const entry = {
    name: w.name,
    weapon_name: w.weapon_name,
    item_def_index: w.item_def_index === undefined ? null : w.item_def_index,
    legacy_event: `${w.event}.Single`,
    orig_event: `Orig_${w.event}.Single`,
    enabled: true,
  };
  if (key !== String(w.item_def_index)) {
    entry.note = 'items_game.txt 中无此武器的 item_def_index，此项不会生效（addon 覆盖仍然有效）';
  }
  out.weapons[key] = entry;
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('已生成', outPath);
console.log('武器条目数:', Object.keys(out.weapons).length);
console.log('key:', Object.keys(out.weapons).join(','));
