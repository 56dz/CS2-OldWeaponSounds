// 检查所有 _Q 变体事件：CS2 用的是什么音频，是否有 CS:GO 对应音
// 核心问题：CS:GO 没有 _Q 事件，但 CS2 的 _Q 事件常常和主事件共用同一个 vsnd。
// 我们只覆盖了主事件，_Q 变体仍是 CS2 音频 → 如果游戏触发的是 _Q，覆盖就不生效。
const fs = require('fs');

const gswPath = process.argv[2];
const csgoPath = process.argv[3];
const planPath = process.argv[4];

const gsw = fs.readFileSync(gswPath, 'utf8').split(/\r?\n/);
const csgo = JSON.parse(fs.readFileSync(csgoPath, 'utf8')).events;
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const overridden = new Set(plan.events.map((e) => e.event));

// 索引 gsw.txt 块
const blockRe = /^\t(\S[^\s=]*)\s*=\s*$/;
const blocks = new Map();
for (let i = 0; i < gsw.length; i++) {
  const m = blockRe.exec(gsw[i]);
  if (!m) continue;
  let end = i + 1;
  while (end < gsw.length && gsw[end].trim() !== '}') end++;
  blocks.set(m[1], { lines: gsw.slice(i + 1, end) });
}

function vsndOf(lines) {
  for (const l of lines) {
    const m = /^\t\tvsnd_files_track_0\d\s*=\s*"([^"]+)"/.exec(l);
    if (m) return m[1];
  }
  // 数组写法
  for (let i = 0; i < lines.length; i++) {
    if (/^\t\tvsnd_files_track_0\d\s*=/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        const m = /"([^"]+)"/.exec(lines[j]);
        if (m) return m[1];
        if (/^\t\t\]/.test(lines[j])) break;
      }
    }
  }
  return null;
}

function volOf(lines) {
  for (const l of lines) {
    const m = /^\t\tvolume\s*=\s*([0-9.]+)/.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
}

// 找出所有 _Q 事件
const qEvents = [];
for (const name of blocks.keys()) {
  if (!name.endsWith('_Q')) continue;
  const lines = blocks.get(name).lines;
  const vsnd = vsndOf(lines);
  const vol = volOf(lines);
  const base = name.slice(0, -2); // 去掉 _Q
  const baseBlock = blocks.get(base);
  const baseVsnd = baseBlock ? vsndOf(baseBlock.lines) : null;
  const baseVol = baseBlock ? volOf(baseBlock.lines) : null;
  const hasCsgo = !!csgo[name];
  const baseHasCsgo = !!csgo[base];
  const baseOverridden = overridden.has(base);
  qEvents.push({
    event: name,
    vsnd,
    volume: vol,
    base,
    base_vsnd: baseVsnd,
    base_volume: baseVol,
    same_vsnd_as_base: vsnd === baseVsnd,
    csgo_has_Q: hasCsgo,
    csgo_has_base: baseHasCsgo,
    base_overridden: baseOverridden,
    // 关键：如果 _Q 和主事件共用 vsnd，且主事件被我们覆盖，_Q 仍是 CS2 音 → 不一致
    risk: vsnd === baseVsnd && baseOverridden && !hasCsgo,
  });
}

qEvents.sort((a, b) => a.event.localeCompare(b.event));
const risky = qEvents.filter((r) => r.risk);

console.log(`CS2 中 _Q 事件总数: ${qEvents.length}`);
console.log(`其中「与主事件共用 vsnd 且主事件已被覆盖」的风险项: ${risky.length}\n`);

// 按武器汇总
const byWeapon = {};
for (const r of risky) {
  const w = r.event.split('.')[0];
  (byWeapon[w] = byWeapon[w] || []).push(r.event.split('.')[1]);
}
for (const [w, evs] of Object.entries(byWeapon)) {
  console.log(`${w.padEnd(22)} ${evs.join(', ')}`);
}

console.log('\n=== 全部 _Q 事件明细 ===');
for (const r of qEvents) {
  const flag = r.risk ? '⚠️ 风险' : '  ok  ';
  console.log(`${flag} ${r.event.padEnd(34)} vsnd=${(r.vsnd || '-').padEnd(46)} vol=${String(r.volume).padEnd(5)} baseOverridden=${r.base_overridden}`);
}

fs.writeFileSync('data/csgo_ref/q_events.json', JSON.stringify({ total: qEvents.length, risky, all: qEvents }, null, 2));
console.log('\n已写出 data/csgo_ref/q_events.json');
