#!/usr/bin/env node
/**
 * 从 appworkshop_730.acf 里摘除指定 workshop item 的两段记录
 * （WorkshopItemsInstalled 与 WorkshopItemDetails）。
 *
 * 用途：本地塞入「尚未通过审核」的工坊包后，若不摘除条目，
 * Steam 会按 acf 里的旧 manifest 做哈希校验并回滚文件。
 * 摘除后 Steam 不再遍历该 item，CS2 的 MultiAddonManager 仍能从
 * steamapps/workshop/content/730/<id>/ 直接挂载本地文件。
 *
 * 用法: node _acf_unpin.js <acf路径> <id> [<id>...]
 * 会先备份成 <acf>.bak-unpin-<时间戳>。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const acf = process.argv[2];
const ids = process.argv.slice(3);
if (!acf || ids.length === 0) {
  console.error('用法: node _acf_unpin.js <acf路径> <id> [<id>...]');
  process.exit(2);
}
if (!fs.existsSync(acf)) {
  console.error('acf 不存在: ' + acf);
  process.exit(2);
}

const src = fs.readFileSync(acf, 'utf8');
let text = src;

/** 找到从 openIdx 处的 '{' 开始配对的 '}' 下标 */
function matchBrace(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 在某一段（如 WorkshopItemsInstalled）内摘除 "id" { ... } 整块 */
function dropBlock(s, section, id) {
  const secRe = new RegExp('"' + section + '"\\s*\\n\\s*\\{');
  const sm = secRe.exec(s);
  if (!sm) return { text: s, dropped: false, why: 'no-section' };
  const secOpen = s.indexOf('{', sm.index);
  const secClose = matchBrace(s, secOpen);
  if (secClose < 0) return { text: s, dropped: false, why: 'unbalanced-section' };
  const body = s.slice(secOpen, secClose + 1);
  // 精确匹配 "\t\t\"<id>\"\n\t\t{" —— 避免前缀 id 误伤（如 3819498100 vs 38194981001）
  const pat = new RegExp('(\\n[\\t ]*)"' + id + '"[ \\t]*\\n[\\t ]*\\{');
  const m = pat.exec(body);
  if (!m) return { text: s, dropped: false, why: 'no-entry' };
  const openRel = m.index + m[0].length - 1;
  const closeRel = matchBrace(body, openRel);
  if (closeRel < 0) return { text: s, dropped: false, why: 'unbalanced-entry' };
  // 连同行首到块尾（含可能的尾部换行）一起删
  const newBody = body.slice(0, m.index) + body.slice(closeRel + 1);
  return {
    text: s.slice(0, secOpen) + newBody + s.slice(secClose + 1),
    dropped: true,
  };
}

function braces(s) {
  let open = 0;
  let close = 0;
  for (const c of s) {
    if (c === '{') open++;
    else if (c === '}') close++;
  }
  return { open, close };
}

const ts = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp =
  ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + '-' +
  pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds());
const bak = acf + '.bak-unpin-' + stamp;
fs.copyFileSync(acf, bak);
console.log('备份: ' + bak);

for (const id of ids) {
  for (const section of ['WorkshopItemsInstalled', 'WorkshopItemDetails']) {
    const r = dropBlock(text, section, id);
    text = r.text;
    console.log(`${section} 摘除 ${id}: ${r.dropped}${r.why ? ' (' + r.why + ')' : ''}`);
  }
}

const b = braces(text);
console.log(`花括号 open ${b.open} close ${b.close} ${b.open === b.close ? 'OK' : '!! 不平衡'}`);
if (b.open !== b.close) {
  console.error('花括号不平衡，放弃写回（原文件未改动）');
  process.exit(1);
}

fs.writeFileSync(acf, text, 'utf8');
console.log(`写回完成，长度 ${src.length} -> ${text.length}`);

// 复查：列出仍存在的 id 数
for (const section of ['WorkshopItemsInstalled', 'WorkshopItemDetails']) {
  const sm = new RegExp('"' + section + '"\\s*\\n\\s*\\{').exec(text);
  if (!sm) {
    console.log(`${section}: 段不存在`);
    continue;
  }
  const open = text.indexOf('{', sm.index);
  const close = matchBrace(text, open);
  const body = text.slice(open, close + 1);
  const n = (body.match(/\n[\t ]*"\d{5,}"[ \t]*\n[\t ]*\{/g) || []).length;
  console.log(`${section} 剩余 item 数: ${n}`);
}
