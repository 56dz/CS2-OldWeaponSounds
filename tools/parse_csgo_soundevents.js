#!/usr/bin/env node
'use strict';
/**
 * 解析 CS:GO 的 scripts/game_sounds_weapons.txt（KV1 文本），
 * 抽出所有 soundevent 及其引用的 wave 文件，输出 JSON。
 *
 * 用法: node parse_csgo_soundevents.js <csgo_game_sounds_weapons.txt> <out.json>
 *
 * 输出的每个事件:
 *   { name, channel, soundlevel, volume, pitch, waves: [ "weapons/ak47/ak47_01.wav", ... ],
 *     rndwave: bool, nested: [[...]] }
 */
const fs = require('fs');

const inPath = process.argv[2];
const outPath = process.argv[3];
if (!inPath || !outPath) {
  console.error('用法: node parse_csgo_soundevents.js <in.txt> <out.json>');
  process.exit(1);
}

const text = fs.readFileSync(inPath, 'utf8').replace(/\r\n/g, '\n');

// ---------------- 词法分析：KV1 的 token 化 ----------------
// token: { type: 'str'|'{'|'}'|'[', value, line }
function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '{') { toks.push({ type: '{', line }); i++; continue; }
    if (c === '}') { toks.push({ type: '}', line }); i++; continue; }
    if (c === '[') { toks.push({ type: '[', line }); i++; continue; }
    if (c === ']') { toks.push({ type: ']', line }); i++; continue; }
    if (c === '"') {
      let j = i + 1, buf = '';
      while (j < n) {
        if (src[j] === '\\' && src[j + 1] === '"') { buf += '"'; j += 2; continue; }
        if (src[j] === '"') break;
        if (src[j] === '\n') line++;
        buf += src[j]; j++;
      }
      toks.push({ type: 'str', value: buf, line });
      i = j + 1;
      continue;
    }
    // 非引号裸词（少数文件里有）
    let j = i;
    let buf = '';
    while (j < n && !' \t\r\n{}[]"'.includes(src[j])) { buf += src[j]; j++; }
    toks.push({ type: 'str', value: buf, line });
    i = j;
  }
  return toks;
}

// ---------------- 递归解析成对象树 ----------------
// 节点: { kind:'obj', entries: [[key,node],...] } | { kind:'str', value } | { kind:'arr', items:[] }
function parse(toks, pos) {
  if (toks[pos] && toks[pos].type === '{') {
    pos++;
    const entries = [];
    while (pos < toks.length && toks[pos].type !== '}') {
      // key
      const k = toks[pos];
      if (k.type !== 'str') { pos++; continue; }
      pos++;
      // value
      let v;
      if (toks[pos] && toks[pos].type === '{') { const r = parse(toks, pos); v = r.node; pos = r.pos; }
      else if (toks[pos] && toks[pos].type === '[') {
        pos++;
        const items = [];
        while (pos < toks.length && toks[pos].type !== ']') { items.push(toks[pos].value); pos++; }
        pos++;
        v = { kind: 'arr', items };
      }
      else if (toks[pos] && toks[pos].type === 'str') { v = { kind: 'str', value: toks[pos].value }; pos++; }
      else if (toks[pos] && toks[pos].type === '}') break;
      else { pos++; continue; }
      entries.push([k.value, v]);
    }
    if (toks[pos] && toks[pos].type === '}') pos++;
    return { node: { kind: 'obj', entries }, pos };
  }
  return { node: { kind: 'str', value: '' }, pos };
}

const toks = tokenize(text);
// 根：顶层 key { ... }
const root = { kind: 'obj', entries: [] };
let p = 0;
while (p < toks.length) {
  if (toks[p].type !== 'str') { p++; continue; }
  const key = toks[p].value;
  p++;
  if (toks[p] && toks[p].type === '{') {
    const r = parse(toks, p);
    p = r.pos;
    root.entries.push([key, r.node]);
  } else {
    // 顶层裸值，跳过
    p++;
  }
}

// ---------------- 提取事件 ----------------
function getStr(node, key) {
  if (!node || node.kind !== 'obj') return undefined;
  for (const [k, v] of node.entries) if (k.toLowerCase() === key) return v.kind === 'str' ? v.value : undefined;
  return undefined;
}
function getNode(node, key) {
  if (!node || node.kind !== 'obj') return undefined;
  for (const [k, v] of node.entries) if (k.toLowerCase() === key) return v;
  return undefined;
}

/** 收集一个事件块里所有 wave 值（递归，含 rndwave / soundlevel 等嵌套） */
function collectWaves(node, out, depth) {
  if (depth > 6 || !node) return;
  if (node.kind === 'obj') {
    for (const [k, v] of node.entries) {
      const lk = k.toLowerCase();
      if (lk === 'wave' || lk === 'rndwave' || lk === 'sound' || lk === 'play') collectWaves(v, out, depth + 1);
      else if (v.kind === 'obj' || v.kind === 'arr') collectWaves(v, out, depth + 1);
    }
  } else if (node.kind === 'arr') {
    for (const it of node.items) out.push(it);
  } else if (node.kind === 'str') {
    out.push(node.value);
  }
}

const events = {};
for (const [name, node] of root.entries) {
  const waves = [];
  collectWaves(node, waves, 0);
  // 去掉 soundlevel 之类的非 wave；只保留看起来像路径的
  // KV1 的 wave 值前面可能带 1~2 个修饰字符（` ~ ) ! 等），一律剥掉
  const cleaned = waves
    .map((w) => String(w).replace(/^[^A-Za-z0-9]+/, ''))
    .filter((w) => /\.(wav|mp3|ogg|vsnd)$/i.test(w));
  const uniq = [...new Set(cleaned)];
  events[name] = {
    name,
    channel: getStr(node, 'channel'),
    soundlevel: getStr(node, 'soundlevel'),
    volume: getStr(node, 'volume'),
    pitch: getStr(node, 'pitch'),
    waves: uniq,
  };
}

fs.writeFileSync(outPath, JSON.stringify({ count: Object.keys(events).length, events }, null, 1), 'utf8');
console.log('事件数:', Object.keys(events).length);
const withWaves = Object.values(events).filter((e) => e.waves.length > 0).length;
console.log('有 wave 的事件数:', withWaves);
const allWaves = new Set();
for (const e of Object.values(events)) for (const w of e.waves) allWaves.add(w);
console.log('唯一 wave 文件数:', allWaves.size);
console.log('输出:', outPath);
