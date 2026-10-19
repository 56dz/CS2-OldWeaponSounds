// 对比：我们覆盖的每个事件，CS2 原块 volume vs CS:GO 事件的 volume
// 目的：CS2 的 block.volume 是为 CS2 自己的音频调的；我们换成 CS:GO 原音后，
// 沿用 CS2 的 volume 会导致音量/听感错位（例如 AK47.Clipin CS2=0.3 / CS:GO=1.0）。
const fs = require('fs');

const gswPath = process.argv[2];
const planPath = process.argv[3];
const csgoPath = process.argv[4];

const gsw = fs.readFileSync(gswPath, 'utf8').split(/\r?\n/);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const csgo = JSON.parse(fs.readFileSync(csgoPath, 'utf8')).events;

// 索引 gsw.txt 的一级块
const blocks = new Map();
for (let i = 0; i < gsw.length; i++) {
  const m = /^\t(\S[^\s=]*)\s*=\s*$/.exec(gsw[i]);
  if (!m) continue;
  let end = i + 1;
  while (end < gsw.length && gsw[end].trim() !== '}') end++;
  blocks.set(m[1], { start: i, end, lines: gsw.slice(i, end + 1) });
}

function getField(lines, name) {
  const re = new RegExp('^\\t\\t' + name + '\\s*=\\s*(.*)$');
  for (const l of lines) {
    const m = re.exec(l);
    if (m) return m[1].trim();
  }
  return null;
}

const rows = [];
for (const ev of plan.events) {
  const b = blocks.get(ev.event);
  if (!b) continue;
  const cs2Vol = getField(b.lines, 'volume');
  const cs2PitchRandomMin = getField(b.lines, 'pitch_random_min');
  const cs2PitchRandomMax = getField(b.lines, 'pitch_random_max');
  const cg = csgo[ev.event];
  const cgVol = cg && cg.volume ? String(cg.volume).trim() : null;
  const cgPitch = cg && cg.pitch ? String(cg.pitch).trim() : null;
  const cs2v = cs2Vol === null ? null : Number(cs2Vol);
  const cgv = cgVol === null ? null : Number(cgVol);
  let diff = null;
  if (cs2v !== null && cgv !== null && cs2v > 0 && cgv > 0) diff = cs2v / cgv;
  rows.push({
    event: ev.event,
    cs2_volume: cs2Vol,
    csgo_volume: cgVol,
    ratio: diff === null ? null : Number(diff.toFixed(4)),
    cs2_pitch_random_min: cs2PitchRandomMin,
    cs2_pitch_random_max: cs2PitchRandomMax,
    csgo_pitch: cgPitch,
    csgo_soundlevel: cg && cg.soundlevel,
    csgo_channel: cg && cg.channel,
  });
}

const mismatched = rows.filter((r) => r.ratio !== null && (r.ratio < 0.8 || r.ratio > 1.25));
mismatched.sort((a, b) => a.ratio - b.ratio);
console.log('覆盖事件总数:', rows.length, ' 音量差异明显的:', mismatched.length);
console.log('ratio = cs2_volume / csgo_volume（越小说明 CS2 把音量调得越低，我们换成 CS:GO 音后会偏轻）');
for (const r of mismatched) {
  console.log(
    `${r.event.padEnd(34)} cs2=${String(r.cs2_volume).padEnd(9)} csgo=${String(r.csgo_volume).padEnd(6)} ratio=${String(r.ratio).padEnd(8)} csgo_pitch=${r.csgo_pitch} lvl=${r.csgo_soundlevel}`
  );
}
const noCsgoVol = rows.filter((r) => r.csgo_volume === null);
console.log('\nCS:GO 侧没有 volume 字段的事件数:', noCsgoVol.length);
console.log(noCsgoVol.slice(0, 40).map((r) => r.event).join(', '));
fs.writeFileSync('data/csgo_ref/volume_compare.json', JSON.stringify({ rows, mismatched }, null, 2));
console.log('\n已写出 data/csgo_ref/volume_compare.json');
