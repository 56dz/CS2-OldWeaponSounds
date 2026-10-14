#!/usr/bin/env node
/**
 * verify_merged_vdata.js — 校验编译后的 weapons.vdata_c 转储
 *
 * 用法：
 *   resourceinfo.exe -i <addon>/scripts/weapons.vdata_c -all -baremode -game "<CS2>\game\csgo" > merged_vdata_dump.txt
 *   node tools/verify_merged_vdata.js <merged dump> <vanilla dump> <modelpack dump> <tsv>
 *
 * 校验项：
 *   A. 条目数 / 89 个皮肤全部在册 / 括号平衡（转储本身由 CS2 生成，故只查条目）
 *   B. 每个皮肤：除「允许变更的字段」外，其余字段与它的原版模板**逐行完全一致**
 *   C. 每个皮肤的 m_aShootSounds 深等于其原版模板的 m_aShootSounds
 *   D. m_szWorldModel = 模型包里该皮肤的模型；m_szAnimSkeleton 一致
 *   E. AWP 皮肤 m_iMaxClip1 = 10 且 m_iDefaultClip1 = 10
 *   F. 所有 _base 引用的条目都在本文件内（自包含）
 *   G. 与模型包原始条目对比：列出被修正的开火事件
 */
'use strict';
const fs = require('fs');

const TYPED_PREFIX = /\b(resource_name|soundevent|resource|particle|material|vtex|vcompmat|vmix|vmdl|vsnd|vpost|vmap):/g;
const ALLOWED_DIFF = new Set(['m_szWorldModel', 'm_szAnimSkeleton', 'm_szName', 'm_iMaxClip1', 'm_iDefaultClip1']);
const KNIFE_ALIAS = {
  weapon_bayonet: 'weapon_knife', weapon_knife_butterfly: 'weapon_knife',
  weapon_knife_css: 'weapon_knife', weapon_knife_karambit: 'weapon_knife',
  weapon_knife_kukri: 'weapon_knife', weapon_knife_m9_bayonet: 'weapon_knife',
  weapon_knife_skeleton: 'weapon_knife',
};

function parseDump(text) {
  const lines = text.split(/\r?\n/);
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
  const data = blocks.find(([a, b]) => lines.slice(a, b + 1).some(l => /^\tgeneric_data_type = /.test(l)));
  if (!data) throw new Error('找不到数据块');
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
      entries.set(m[1], lines.slice(i + 1, j + 1).map(l => l.replace(TYPED_PREFIX, '')));
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
function shootSounds(body) {
  const s = body.findIndex(l => l.trim() === 'm_aShootSounds =');
  if (s < 0) return null;
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
  const [mergedP, vanillaP, modelP, tsvP] = process.argv.slice(2);
  if (!mergedP || !vanillaP || !modelP || !tsvP) {
    console.error('用法: verify_merged_vdata.js <merged dump> <vanilla dump> <modelpack dump> <tsv>');
    process.exit(64);
  }
  const A = parseDump(fs.readFileSync(mergedP, 'utf8'));
  const V = parseDump(fs.readFileSync(vanillaP, 'utf8'));
  const M = parseDump(fs.readFileSync(modelP, 'utf8'));
  const rows = fs.readFileSync(tsvP, 'utf8').trim().split(/\r?\n/).slice(1)
    .map(l => l.split('\t')).filter(r => r.length >= 5 && /^weapon_skin_\d+$/.test(r[0]));

  const fails = [];
  const info = { entries: A.size, skins: 0, baseEntries: 0, changes: [], awp: [], sample: [] };
  const skins = [], baseNames = [];
  for (const k of A.keys()) (/^weapon_skin_\d+$/.test(k) ? skins : baseNames).push(k);
  info.skins = skins.length;
  info.baseEntries = baseNames.length;
  // generic_data_type 是键值对而不是条目，单独扫
  info.hasGenericDataType = /\r?\n\tgeneric_data_type = "CBasePlayerWeaponVData"/.test(
    '\n' + fs.readFileSync(mergedP, 'utf8'));
  if (!info.hasGenericDataType) fails.push('缺少 generic_data_type = "CBasePlayerWeaponVData"');
  if (info.skins !== 89) fails.push('皮肤条目数 != 89: ' + info.skins);

  // F. 自包含
  for (const [k, body] of A) {
    const b = unq(field(body, '_base'));
    if (b && !A.has(b)) fails.push(k + ': _base 指向不存在的条目 ' + b);
  }

  // H. 原版条目必须全部在册且逐行与原版一致
  let vanillaChecked = 0;
  const missingVanilla = [];
  for (const [k, body] of V) {
    const a2 = A.get(k);
    if (!a2) { missingVanilla.push(k); continue; }
    vanillaChecked++;
    if (a2.join('\n') !== body.join('\n')) fails.push(k + ': 原版条目内容与当前 CS2 原版不一致');
  }
  if (missingVanilla.length) fails.push('缺少原版条目 ' + missingVanilla.length + ' 个: ' + missingVanilla.slice(0, 10));
  info.vanillaEntriesInFile = vanillaChecked;
  info.vanillaEntriesInSource = V.size;

  for (const r of rows) {
    const [skin, tsvBase] = r;
    const tmplName = KNIFE_ALIAS[tsvBase] || tsvBase;
    const A2 = A.get(skin);
    if (!A2) { fails.push(skin + ': 编译产物里缺失'); continue; }
    const T = V.get(tmplName);
    const S = M.get(skin);
    if (!S) { fails.push(skin + ': 模型包 dump 缺失'); continue; }

    // D. 模型/骨骼
    if (field(A2, 'm_szWorldModel') !== field(S, 'm_szWorldModel'))
      fails.push(skin + ': m_szWorldModel 与模型包不一致');
    const skelT = field(T, 'm_szAnimSkeleton'), skelS = field(S, 'm_szAnimSkeleton');
    const skelWant = (skelS && skelS !== skelT) ? skelS : skelT;
    if (field(A2, 'm_szAnimSkeleton') !== skelWant)
      fails.push(skin + ': m_szAnimSkeleton 期望 ' + skelWant + ' 实际 ' + field(A2, 'm_szAnimSkeleton'));

    // C. 开火音效
    const wantShoot = shootSounds(T), gotShoot = shootSounds(A2);
    if (JSON.stringify(wantShoot) !== JSON.stringify(gotShoot))
      fails.push(skin + ': m_aShootSounds 与 ' + tmplName + ' 不一致 ' +
        JSON.stringify(gotShoot) + ' vs ' + JSON.stringify(wantShoot));

    // E. AWP
    if (tsvBase === 'weapon_awp') {
      if (field(A2, 'm_iMaxClip1') !== '10') fails.push(skin + ': AWP m_iMaxClip1 != 10');
      if (field(A2, 'm_iDefaultClip1') !== '10') fails.push(skin + ': AWP m_iDefaultClip1 != 10');
      info.awp.push({ skin, maxClip: field(A2, 'm_iMaxClip1'), defClip: field(A2, 'm_iDefaultClip1') });
    } else {
      if (field(A2, 'm_iMaxClip1') !== field(T, 'm_iMaxClip1'))
        fails.push(skin + ': m_iMaxClip1 未保持原版默认值');
    }

    // B. 逐字段与模板比较（只允许 ALLOWED_DIFF 里的字段不同）
    const keyOf = l => { const m = /^\t\t([^\s=]+) =/.exec(l); return m ? m[1] : null; };
    const tmap = new Map(), amap = new Map();
    for (const l of T) { const k = keyOf(l); if (k) tmap.set(k, l); }
    for (const l of A2) { const k = keyOf(l); if (k) amap.set(k, l); }
    for (const [k, l] of tmap) {
      if (ALLOWED_DIFF.has(k)) continue;
      if (!amap.has(k)) { fails.push(skin + ': 缺少模板字段 ' + k); continue; }
      if (amap.get(k) !== l) fails.push(strip(skin + ': 字段 ' + k + ' 与模板不同: ' + amap.get(k) + ' vs ' + l));
    }
    for (const k of amap.keys()) if (!tmap.has(k) && k !== 'm_szName')
      fails.push(skin + ': 出现模板以外的字段 ' + k);

    // G. 与模型包原条目对比开火事件
    const before = shootSounds(S);
    if (JSON.stringify(before) !== JSON.stringify(gotShoot))
      info.changes.push({ skin, tsvBase, template: tmplName, before, after: gotShoot });
  }

  function strip(s) { return s; }

  // 抽样
  for (const s of ['weapon_skin_001', 'weapon_skin_007', 'weapon_skin_054', 'weapon_skin_083', 'weapon_skin_089']) {
    const b = A.get(s);
    if (b) info.sample.push({
      skin: s, _class: unq(field(b, '_class')), _base: unq(field(b, '_base')),
      m_szName: unq(field(b, 'm_szName')), m_szWorldModel: unq(field(b, 'm_szWorldModel')),
      m_iMaxClip1: field(b, 'm_iMaxClip1'), m_iDefaultClip1: field(b, 'm_iDefaultClip1'),
      m_aShootSounds: shootSounds(b),
    });
  }

  console.log(JSON.stringify(info, null, 1));
  if (fails.length) {
    console.error('\n校验失败 ' + fails.length + ' 条:');
    for (const f of fails.slice(0, 40)) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('\n全部校验通过：89 皮肤在册 / 字段与模板逐行一致 / 开火音效等于 base_weapon / AWP 10 发 / 自包含');
  return 0;
}
process.exit(main());
