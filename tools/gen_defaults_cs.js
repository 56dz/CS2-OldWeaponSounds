#!/usr/bin/env node
// 从 plugin/config.json 生成插件内建的默认武器表（C# 代码），并插入 Plugin.cs
// 用途：让"只部署插件、不带 config.json"的安装方式也能在惯例位置生成**完整**配置
// 用法: node tools/gen_defaults_cs.js [--check]
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cfgPath = path.join(root, 'plugin', 'config.json');
const csPath = path.join(root, 'plugin', 'Plugin.cs');

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const keys = Object.keys(cfg.weapons);
const isCheck = process.argv.includes('--check');

function csStr(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const lines = [];
lines.push('    /// <summary>');
lines.push('    /// 内建的默认武器表（' + keys.length + ' 把）。');
lines.push('    /// 由 tools/gen_defaults_cs.js 从 plugin/config.json 生成，请勿手工编辑。');
lines.push('    /// 作用：只部署插件（不带 config.json）时，也能在惯例位置生成**完整**的默认配置。');
lines.push('    /// </summary>');
lines.push('    private static Dictionary<string, WeaponCfg> BuildDefaultWeapons() => new()');
lines.push('    {');
for (const k of keys) {
  const w = cfg.weapons[k];
  const di = (w.item_def_index === null || w.item_def_index === undefined) ? 'null' : String(w.item_def_index);
  lines.push(
    `        [${csStr(k)}] = new WeaponCfg { name = ${csStr(w.name)}, weapon_name = ${csStr(w.weapon_name)}, ` +
    `item_def_index = ${di}, legacy_event = ${csStr(w.legacy_event)}, orig_event = ${csStr(w.orig_event)}, ` +
    `enabled = ${w.enabled ? 'true' : 'false'} },`
  );
}
lines.push('    };');
lines.push('');
const snippet = lines.join('\n');

let cs = fs.readFileSync(csPath, 'utf8');
const START = '    /// <summary>\n    /// 内建的默认武器表';
const END = '    };\n';
const anchor = '    private void LoadConfig()';

if (isCheck) {
  const inserted = cs.includes(START) && cs.includes('weapons = BuildDefaultWeapons()');
  console.log(inserted ? '✔ 已内建默认表且已接线' : '✘ 尚未内建/未接线');
  process.exit(inserted ? 0 : 1);
}

// 移除旧的生成块（若存在）
const si = cs.indexOf(START);
if (si >= 0) {
  const ei = cs.indexOf('\n' + END, si);
  if (ei >= 0) cs = cs.slice(0, si) + cs.slice(ei + 1 + END.length);
}

// 插入到 LoadConfig 之前
const ai = cs.indexOf(anchor);
if (ai < 0) { console.error('找不到锚点: ' + anchor); process.exit(1); }
cs = cs.slice(0, ai) + snippet + cs.slice(ai);

// 接线：缺配置时用内建默认表
const before = '                _cfg = new RootCfg();\n';
const after = '                _cfg = new RootCfg { weapons = BuildDefaultWeapons() };\n';
if (cs.includes(before)) cs = cs.replace(before, after);
else if (!cs.includes(after)) { console.error('找不到 `new RootCfg();` 接线点'); process.exit(1); }

fs.writeFileSync(csPath, cs, 'utf8');
console.log('已写入 ' + path.relative(root, csPath));
console.log('  内建武器条目: ' + keys.length);
console.log('  接线: 缺配置时 → new RootCfg { weapons = BuildDefaultWeapons() }');
