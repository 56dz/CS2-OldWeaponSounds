// 用 CS2 真实 soundevent 定义重建 addon 覆盖文件
// 只替换 vsnd_files_track_01，保留全部 3D/衰减/遮挡字段
// 用法: node build_faithful_addon.js <gsw.txt> <verified_map.json> <输出文件>
const fs = require('fs');

const [gswPath, mapPath, outPath] = process.argv.slice(2);
const lines = fs.readFileSync(gswPath, 'utf8').split(/\r?\n/);
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

// kv3 头注释（第一行）
const header = lines[0];

// 建立"缩进1级"的事件块索引
const blocks = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(lines[i]);
  if (!m) continue;
  // 找同缩进的结束大括号
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j] === '\t}') { blocks.set(m[1], [i, j]); break; }
  }
}

const out = [];
out.push(header);
out.push('{');

let ok = 0, missing = [];
const names = Object.keys(map).sort();
for (const weapon of names) {
  const short = weapon.replace(/^Weapon_/, '');
  const eventName = `Weapon_${short}.Single`;
  const blk = blocks.get(eventName);
  if (!blk) { missing.push(eventName); continue; }
  const [s, e] = blk;
  const body = lines.slice(s, e + 1);

  // 在块内定位 vsnd_files_track_01 并替换
  const vi = body.findIndex(l => /vsnd_files_track_01\s*=/.test(l));
  if (vi < 0) { missing.push(eventName + '(无vsnd字段)'); continue; }

  const indent = (body[vi].match(/^[\t ]*/) || [''])[0];
  const scalar = /vsnd_files_track_01\s*=\s*"/.test(body[vi]);

  let newBody;
  if (scalar) {
    // 标量形式：直接替换该行，保持缩进
    newBody = [...body];
    newBody[vi] = `${indent}vsnd_files_track_01 = "${map[weapon].vsnd}"`;
  } else {
    // 数组形式：紧跟其后的第一个非空行必须正好是 '['
    let k = vi + 1;
    while (k < body.length && body[k].trim() === '') k++;
    if (body[k] === undefined || body[k].trim() !== '[') {
      missing.push(eventName + '(非预期的数组格式)');
      continue;
    }
    const open = k;
    let close = -1;
    for (let m2 = open + 1; m2 < body.length; m2++) {
      if (body[m2].trim() === ']') { close = m2; break; }
    }
    if (close < 0) { missing.push(eventName + '(数组未闭合)'); continue; }
    newBody = [
      ...body.slice(0, open + 1),
      `${indent}\t"${map[weapon].vsnd}",`,
      ...body.slice(close),
    ];
  }
  out.push(...newBody);
  ok++;
}

out.push('}');
out.push('');

fs.writeFileSync(outPath, out.join('\n'), 'utf8');
console.log('已生成:', outPath);
console.log('成功覆盖(含完整3D字段):', ok, '/', names.length);
if (missing.length) console.log('未能覆盖:', missing.join(', '));
console.log('总行数:', out.length);
