// 全量覆盖计划：CS:GO 有对应 wav 的 CS2 事件全部纳入（不再依赖 SAME_PATH 假设）
// 输出兼容 build_legacy_all.js 的 plan JSON
const fs = require('fs');

// ---------------------------------------------------------------------------
// 刻意不覆盖的事件：这些事件在 CS2 里的变体数比 CS:GO 多，套用旧音只能靠
// 「截断/循环重复」，听感收益为零却增加出错面 —— 直接保留 CS2 原音。
//
// 判定依据（2026-10-20 用户决定）：CS:GO 变体数 > CS2 变体数的 6 个事件。
// 其余事件的变体关系是「CS:GO ≤ CS2」，循环填充不会丢素材，不属于这一类。
// 从 CSV 层面排除后：这些事件不进 events（不生成覆盖块）、
// 若其中有 .Single 也不会进 legacyEvents（不生成 Orig_ 回退块）；
// 因为没有 Orig_ 块，插件关闭旧音时 emit 得到 guid=0 → Continue 播原版，
// CS2 原音与原来完全一致，功能不受影响。
// ---------------------------------------------------------------------------
const KEEP_CS2_EVENTS = new Set([
  'Weapon_GalilAR.Single',        // CS2 1 个 vs CS:GO 4 个
  'Weapon_Glock.Single',          // CS2 1 个 vs CS:GO 2 个
  'Weapon_FAMAS.Single',          // CS2 3 个 vs CS:GO 4 个
  'Weapon_MP7.Single',            // CS2 3 个 vs CS:GO 4 个
  'Weapon_Sawedoff.Insertshell',  // CS2 2 个 vs CS:GO 4 个
  'Weapon_SCAR20.SingleDistant',  // CS2 1 个 vs CS:GO 3 个
]);

const gsw = fs.readFileSync(process.argv[2] || 'data/gsw.txt', 'utf8').split(/\r?\n/);
const csgoAll = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;

// 索引 gsw.txt 的块
const blockStart = new Map();
const blockEnd = new Map();
for (let i = 0; i < gsw.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(gsw[i]);
  if (!m) continue;
  for (let j = i + 1; j < gsw.length; j++) {
    if (/^\t\}$/.test(gsw[j])) { blockStart.set(m[1], i); blockEnd.set(m[1], j); break; }
  }
}
console.log('gsw 块: ' + blockStart.size);

// 事件是否使用 vsnd_files_track_0N（而不是 src1_3d 的 vsnd_files）
function usesTrack(name) {
  const a = blockStart.get(name), b = blockEnd.get(name);
  if (a === undefined) return false;
  for (let i = a; i <= b; i++) if (/^\t\tvsnd_files_track_0\d\s*=/.test(gsw[i])) return true;
  return false;
}

const targets = [];
const wavSet = new Set();
let skippedNoTrack = [], skippedNoCsgo = 0, skippedNoWave = 0, skippedKeepCs2 = [];
for (const name of blockStart.keys()) {
  if (KEEP_CS2_EVENTS.has(name)) { skippedKeepCs2.push(name); continue; }
  const c = csgoAll[name];
  if (!c || !c.waves || !c.waves.length) { skippedNoCsgo++; continue; }
  if (!usesTrack(name)) { skippedNoTrack.push(name); continue; }
  // 清理 wave 路径
  // 统一小写：CS:GO 里存在 weapons/DEagle 与 weapons/deagle 两种写法，
  // Windows 不区分大小写会合并成同一文件，但 addon 内路径必须一致，
  // 否则在 Linux 客户端（大小写敏感）会找不到 vsnd。
  const wavs = c.waves
    .map((w) => String(w).replace(/^[^A-Za-z0-9]+/, '').replace(/\\/g, '/').replace(/^sound\//i, '').toLowerCase())
    .filter((w) => /\.wav$/i.test(w));
  if (!wavs.length) { skippedNoWave++; continue; }
  targets.push({ event: name, wavs, src: 'full_cover', csgo_vol: c.volume || null });
  for (const w of wavs) wavSet.add(w);
}

const wavs = [...wavSet].sort();
console.log(`目标事件: ${targets.length}`);
console.log(`唯一 wav: ${wavs.length}`);
console.log(`跳过: 无 vsnd_files_track(${skippedNoTrack.length}) 无CSGO事件(${skippedNoCsgo}) 无wav(${skippedNoWave}) 刻意保留CS2音(${skippedKeepCs2.length})`);
if (skippedNoTrack.length) console.log('  非track字段事件: ' + skippedNoTrack.join(', '));
if (skippedKeepCs2.length) console.log('  刻意保留 CS2 原音: ' + skippedKeepCs2.join(', '));

// 硬校验：KEEP_CS2_EVENTS 里的每一项都必须真的被这份 gsw.txt 命中，
// 否则说明事件名拼错了 / 游戏更新改了名字 —— 直接报错，不静默放过。
const notFound = [...KEEP_CS2_EVENTS].filter((e) => !blockStart.has(e));
if (notFound.length) {
  console.error('!! KEEP_CS2_EVENTS 里这些事件在 gsw.txt 中不存在（拼写错误或游戏已改名）:');
  for (const e of notFound) console.error('   ' + e);
  process.exit(1);
}

// 本地已有 wav 统计
let have = 0, miss = [];
let bytes = 0;
for (const w of wavs) {
  const p = 'data/csgo_ref/wavout/' + w;
  if (fs.existsSync(p)) { have++; bytes += fs.statSync(p).size; }
  else miss.push(w);
}
console.log(`本地已有: ${have}  缺失: ${miss.length}  已有字节: ${bytes} (${(bytes / 1048576).toFixed(1)} MB)`);

// legacyEvents = 35 把武器的 Single（用于 Orig_ 回退块）
const legacyEvents = targets.filter((t) => /\.Single$/.test(t.event)).map((t) => t.event);
console.log(`Single 事件（Orig_ 回退用）: ${legacyEvents.length}`);

const plan = {
  _说明: '全量覆盖：CS:GO 有对应 wav 的事件全部替换；KEEP_CS2_EVENTS 里的刻意保留 CS2 原音',
  stats: {
    targets: targets.length,
    unique_wavs: wavs.length,
    legacy_singles: legacyEvents.length,
    skipped_no_track: skippedNoTrack.length,
    skipped_no_csgo: skippedNoCsgo,
    skipped_keep_cs2: skippedKeepCs2.length,
  },
  keep_cs2: skippedKeepCs2,
  events: targets,
  legacyEvents,
  origBlocks: legacyEvents,
  wavs,
  missing: miss,
};
fs.writeFileSync('data/csgo_ref/plan_full_cover.json', JSON.stringify(plan, null, 1));
fs.writeFileSync('data/csgo_ref/wav_need_full.json', JSON.stringify(miss, null, 1));
console.log('已写 data/csgo_ref/plan_full_cover.json');
