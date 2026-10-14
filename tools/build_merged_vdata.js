#!/usr/bin/env node
/**
 * build_merged_vdata.js — 生成「干净合并 addon」的 scripts/weapons.vdata
 *
 * 方案：每个 weapon_skin_XXX = 其 base_weapon「原版条目」的完整拷贝，只替换模型相关字段。
 *
 * 数据来源：
 *   --vanilla  <vanilla dump>   当前 CS2 安装里 scripts/weapons.vdata_c 的 resourceinfo 转储
 *                               （权威「原版条目」模板。注意：模型包自带的 vdata_dump.txt 是
 *                                 更早 CS2 版本的拷贝，103/103 共有条目内容都不同，会带来过期数值）
 *   --modelpack <model dump>    模型包 weapons.vdata_c 的 resourceinfo 转储
 *                               （只用来取每个皮肤的 m_szWorldModel / m_szAnimSkeleton / m_szName）
 *   --tsv      <映射表>         docs/weapon_skin-音效事件映射表.tsv（subclass / base_weapon / model / 事件 / 状态）
 *
 * 关键约束（实测）：
 *   * 根块第一个键必须是 generic_data_type = "CBasePlayerWeaponVData"，否则
 *     「RESOURCE COMPILE ERROR: VData must have a 'generic_data_type' key」
 *   * `_base` 在**编译期**解析：引用的条目必须出现在同一个文件里，否则
 *     「Invalid _base specified: 'xxx' - no entry with that name.」
 *     → 必须把 base 链（taxonomy 标签 + *_prefab）一起写进输出，否则编译失败。
 *   * 值统一写成纯字符串（resourceinfo 转储里的 resource_name:"x" / soundevent:"x" 前缀要去掉）；
 *     模型包与音效包的既有 kv3 源文件都是这种写法。
 *
 * 用法：
 *   node tools/build_merged_vdata.js \
 *     --vanilla  data/model-pack-analysis/vanilla_weapons_vdata_dump.txt \
 *     --modelpack data/model-pack-analysis/vdata_dump.txt \
 *     --tsv      "docs/weapon_skin-音效事件映射表.tsv" \
 *     --out      "<CS2>/content/csgo_addons/server_addon_56dz/scripts/weapons.vdata" \
 *     [--report  report.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const KV3_HEADER =
  '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} ' +
  'format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->';

// TSV 里的 base_weapon 是 items_game 的 weapon_name；刀在 weapons.vdata 里统一是 weapon_knife
const KNIFE_ALIAS = {
  weapon_bayonet: 'weapon_knife',
  weapon_knife_butterfly: 'weapon_knife',
  weapon_knife_css: 'weapon_knife',
  weapon_knife_karambit: 'weapon_knife',
  weapon_knife_kukri: 'weapon_knife',
  weapon_knife_m9_bayonet: 'weapon_knife',
  weapon_knife_skeleton: 'weapon_knife',
};

const TYPED_PREFIX = /\b(resource_name|soundevent|resource|particle|material|vtex|vcompmat|vmix|vmdl|vsnd|vpost|vmap):/g;

function stripTyped(line) { return line.replace(TYPED_PREFIX, ''); }

/** 解析 resourceinfo 转储：返回 Map<entryName, {start,end,lines}>，只取含 generic_data_type 的那个数据块 */
function parseDump(text) {
  const lines = text.split(/\r?\n/);
  // 找出所有 column-0 的 {...} 块
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '{') {
      let d = 0;
      for (let j = i; j < lines.length; j++) {
        if (lines[j] === '{') d++;
        else if (lines[j] === '}') { d--; if (d === 0) { blocks.push([i, j]); break; } }
      }
    }
  }
  const data = blocks.find(([a, b]) =>
    lines.slice(a, b + 1).some(l => /^\tgeneric_data_type = /.test(l)));
  if (!data) throw new Error('找不到数据块（没有 generic_data_type 的块）');
  const [a, b] = data;

  const entries = new Map();
  let i = a + 1;
  while (i < b) {
    const m = /^\t([^\s=]+) = *$/.exec(lines[i]);
    if (m && lines[i + 1] === '\t{') {
      let d = 0, j = i + 1;
      for (; j < b; j++) {
        const t = lines[j].trim();
        if (t === '{') d++;
        else if (t === '}') { d--; if (d === 0) break; }
      }
      entries.set(m[1], {
        name: m[1],
        // body = 内容行（含首尾的 \t{ / \t}）
        body: lines.slice(i + 1, j + 1).map(stripTyped),
        order: i,
      });
      i = j + 1;
    } else i++;
  }
  return entries;
}

function field(body, key) {
  const re = new RegExp('^\\t\\t' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' = (.*)$');
  for (const l of body) { const m = re.exec(l); if (m) return m[1]; }
  return null;
}
function setField(body, key, value) {
  const re = new RegExp('^\\t\\t' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' = ');
  const idx = body.findIndex(l => re.test(l));
  if (idx >= 0) { body[idx] = '\t\t' + key + ' = ' + value; return 'replaced'; }
  const close = body.length - 1;              // 末行是 \t}
  body.splice(close, 0, '\t\t' + key + ' = ' + value);
  return 'inserted';
}
function shootSounds(body) {
  const s = body.findIndex(l => l.trim() === 'm_aShootSounds =');
  if (s < 0) return {};
  const out = {};
  for (let i = s + 1; i < body.length; i++) {
    if (body[i].trim() === '}') break;
    const m = /^\t\t\t(\w+) = (.*)$/.exec(body[i]);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const unq = s => (s == null ? null : s.replace(/^"|"$/g, ''));

function main() {
  const argv = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  for (const k of ['vanilla', 'modelpack', 'tsv', 'out']) {
    if (!opt[k]) { console.error('缺少 --' + k); console.error(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(64); }
  }

  const V = parseDump(fs.readFileSync(opt.vanilla, 'utf8'));
  const M = parseDump(fs.readFileSync(opt.modelpack, 'utf8'));
  const rows = fs.readFileSync(opt.tsv, 'utf8').trim().split(/\r?\n/).slice(1)
    .map(l => l.split('\t')).filter(r => r.length >= 5 && /^weapon_skin_\d+$/.test(r[0]));

  const report = {
    generatedAt: new Date().toISOString(),
    sources: { vanilla: opt.vanilla, modelpack: opt.modelpack, tsv: opt.tsv, out: opt.out },
    counts: {}, skins: [], problems: [],
  };

  // ---- 1) 决定要把哪些「原版条目」一起写进输出 ----
  // mode=all（默认）：把当前 CS2 原版 weapons.vdata 的**全部**条目原样带上。
  //   理由（实测证据）：
  //   * `_base` 在编译期解析，被引用的条目必须在同一文件内，否则
  //     「Invalid _base specified: 'xxx' - no entry with that name.」→ 至少要带 base 链；
  //   * 本机工坊缓存里另外 6 个武器皮肤 addon（3608612434 / 3615968422 / 3670050075 /
  //     3672657008 / 3711322683 / 3758986810）**全部**都带完整原版条目
  //     （43 prefab + 45 武器 + 旧版数字别名 "1".."526"）；
  //   * 模型包本身也是「完整原版 + 89 皮肤」的形状（31,441 B）。
  //   在「addon vdata 覆盖 game vdata」与「两者合并」两种语义下，带完整集合都安全
  //   （副本与当前原版逐字段相同）；只带 base 链在覆盖语义下会让全部原版武器失效。
  //   mode=chain：只带 base 链闭包（体积最小，仅供对比）。
  const mode = opt.mode || 'all';
  let baseNames;
  if (mode === 'all') {
    baseNames = [...V.keys()].sort((a, b) => V.get(a).order - V.get(b).order);
  } else {
    const needed = new Set();
    for (const r of rows) {
      const t = KNIFE_ALIAS[r[1]] || r[1];
      if (!V.has(t)) { report.problems.push('TSV base_weapon 在原版 vdata 中不存在: ' + r[1]); continue; }
      const b = unq(field(V.get(t).body, '_base'));
      if (b) needed.add(b);
    }
    const closure = new Set();
    const stack = [...needed];
    while (stack.length) {
      const n = stack.pop();
      if (closure.has(n)) continue;
      if (!V.has(n)) { report.problems.push('_base 目标在原版 vdata 中不存在: ' + n); continue; }
      closure.add(n);
      const b = unq(field(V.get(n).body, '_base'));
      if (b) stack.push(b);
    }
    baseNames = [...closure].sort((a, b) => V.get(a).order - V.get(b).order);
  }
  // 所有 _base 引用都必须能在输出里找到
  const inFile = new Set([...baseNames, ...rows.map(r => r[0])]);
  for (const n of baseNames) {
    const b = unq(field(V.get(n).body, '_base'));
    if (b && !inFile.has(b)) report.problems.push(n + ': _base 指向输出里没有的条目 ' + b);
  }

  // ---- 2) 生成 89 个皮肤条目 ----
  const outEntries = [];
  for (const r of rows) {
    const [skin, tsvBase, tsvModel, tsvEvent, tsvStatus] = r;
    const tmplName = KNIFE_ALIAS[tsvBase] || tsvBase;
    const tmpl = V.get(tmplName);
    const src = M.get(skin);
    if (!tmpl) { report.problems.push(skin + ': 找不到模板 ' + tmplName); continue; }
    if (!src) { report.problems.push(skin + ': 模型包 dump 里没有这个条目'); continue; }

    const body = tmpl.body.slice();
    const srcModel = field(src.body, 'm_szWorldModel');
    const srcSkel = field(src.body, 'm_szAnimSkeleton');
    const srcName = field(src.body, 'm_szName');
    if (!srcModel) { report.problems.push(skin + ': 模型包里没有 m_szWorldModel'); continue; }

    const changed = {};
    changed.m_szWorldModel = setField(body, 'm_szWorldModel', srcModel);
    const oldSkel = field(body, 'm_szAnimSkeleton');
    if (srcSkel && srcSkel !== oldSkel) changed.m_szAnimSkeleton = setField(body, 'm_szAnimSkeleton', srcSkel);
    // 原版 weapon_knife 没有 m_szName；保留模型包的身份名（= items_game weapon_name），
    // 否则 22 个刀皮肤会丢掉各自的基准武器名，可能导致模型插件无法识别。
    if (srcName && field(body, 'm_szName') === null) changed.m_szName = setField(body, 'm_szName', srcName);
    // AWP 皮肤 10 发弹匣
    if (tsvBase === 'weapon_awp') {
      changed.m_iMaxClip1 = setField(body, 'm_iMaxClip1', '10');
      changed.m_iDefaultClip1 = setField(body, 'm_iDefaultClip1', '10');
    }

    const shoot = shootSounds(body);
    const tmplShoot = shootSounds(tmpl.body);
    const ok = JSON.stringify(shoot) === JSON.stringify(tmplShoot);
    if (!ok) report.problems.push(skin + ': m_aShootSounds 与模板不一致');

    outEntries.push({ name: skin, body });
    report.skins.push({
      skin, tsvBase, tsvModel, tsvEventFromTsv: tsvEvent, tsvStatus,
      template: tmplName,
      class: unq(field(body, '_class')),
      base: unq(field(body, '_base')),
      m_szName: unq(field(body, 'm_szName')),
      m_szWorldModel: unq(field(body, 'm_szWorldModel')),
      m_szAnimSkeleton: unq(field(body, 'm_szAnimSkeleton')),
      m_iMaxClip1: field(body, 'm_iMaxClip1'),
      m_iDefaultClip1: field(body, 'm_iDefaultClip1'),
      shootSounds: shoot,
      shootMatchesTemplate: ok,
      changedFields: changed,
    });
  }

  // ---- 3) 组装输出 ----
  const L = [];
  L.push(KV3_HEADER);
  L.push('{');
  L.push('\tgeneric_data_type = "CBasePlayerWeaponVData"');
  // 3a) 原版条目（保持原版 dump 中的顺序）
  for (const n of baseNames) {
    L.push('\t' + n + ' = ');
    L.push(...V.get(n).body);
  }
  // 3b) 89 个皮肤
  for (const e of outEntries) {
    L.push('\t' + e.name + ' = ');
    L.push(...e.body);
  }
  L.push('}');
  const text = L.join('\n') + '\n';

  // ---- 4) 自检 ----
  let depth = 0;
  for (const ch of text) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  report.counts = {
    rows: rows.length,
    skinsEmitted: outEntries.length,
    vanillaEntries: baseNames.length,
    totalEntries: outEntries.length + baseNames.length + 1,
    bytes: Buffer.byteLength(text, 'utf8'),
    braceDepthAtEnd: depth,
  };
  if (depth !== 0) report.problems.push('大括号不平衡，末尾深度 ' + depth);
  if (outEntries.length !== 89) report.problems.push('皮肤条目数不是 89: ' + outEntries.length);

  fs.mkdirSync(path.dirname(opt.out), { recursive: true });
  fs.writeFileSync(opt.out, text, 'utf8');
  if (opt.report) fs.writeFileSync(opt.report, JSON.stringify(report, null, 1), 'utf8');

  console.log('已写出 ' + opt.out);
  console.log('  mode=%s  条目: 皮肤 %d + 原版条目 %d + generic_data_type 1 = %d',
    mode, report.counts.skinsEmitted, report.counts.vanillaEntries, report.counts.totalEntries);
  console.log('  行数 %d，大小 %d B，大括号末尾深度 %d', L.length, report.counts.bytes, depth);
  console.log('  原版条目: ' + baseNames.length + ' 项');
  const byBase = {};
  for (const s of report.skins) byBase[s.tsvBase] = (byBase[s.tsvBase] || 0) + 1;
  console.log('  皮肤按 base_weapon 分布: ' + JSON.stringify(byBase));
  if (report.problems.length) {
    console.error('问题 ' + report.problems.length + ' 条:');
    for (const p of report.problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('自检通过（89 皮肤 / 括号平衡 / m_aShootSounds 与模板一致）');
  return 0;
}

process.exit(main());
