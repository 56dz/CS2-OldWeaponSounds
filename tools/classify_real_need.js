// 修正版：正确解析 CS2 的 vsnd 数组与标量写法，判定哪些事件真正需要覆盖
const fs = require('fs');
const g = fs.readFileSync('data/gsw.txt', 'utf8').split(/\r?\n/);
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/legacy_all_plan.json', 'utf8'));
const csgo = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;

const idx = [];
for (let i = 0; i < g.length; i++) {
  const m = g[i].match(/^\t(\S[^\s=]*)\s*=\s*$/);
  if (m) idx.push({ i, n: m[1] });
}

// 正确解析：从 vsnd_files_track_01 行开始，若为数组则扫描到配平的 ]
function cs2Vsnds(name) {
  const e = idx.find((x) => x.n === name);
  if (!e) return null;
  const a = [];
  for (let j = e.i + 1; j < g.length; j++) {
    if (/^\t\}$/.test(g[j])) break;
    const start = g[j].match(/vsnd_files_track_0\d+\s*=\s*(.*)$/);
    if (!start) continue;
    const rest = start[1].trim();
    if (rest.startsWith('"')) {
      a.push(rest.replace(/^"|"$/g, ''));
    } else if (rest === '' || rest.startsWith('[')) {
      // 数组形式：从下一行开始收集 "..." 直到 ]
      let depth = rest.includes('[') ? (rest.match(/\[/g) || []).length : 0;
      for (let k = j + 1; k < g.length; k++) {
        const l = g[k].trim();
        const q = l.match(/^"([^"]+)"\,?$/);
        if (q) a.push(q[1]);
        depth += (l.match(/\[/g) || []).length;
        depth -= (l.match(/\]/g) || []).length;
        if (l.startsWith(']') && depth <= 0) break;
        if (!l.startsWith('"') && !/^[\[\]]/.test(l)) break;
      }
    }
  }
  return a;
}

const base = (p) =>
  p
    .replace(/^.*\//, '')
    .replace(/\.(vsnd|wav)$/i, '')
    .replace(/_\d+$/, '')
    .toLowerCase();

// 「CS2 换了音」的判定：文件基名集合不同，或 CS2 用的是通用共享音（magazine_slide 等）
const GENERIC = /magazine_slide|weapon_zoom|movement\d|bullet_ric/;

let sameN = 0;
const realNeed = [];
const sameList = [];
for (const t of plan.events) {
  const cv = cs2Vsnds(t.event);
  const wv = csgo[t.event] && csgo[t.event].waves;
  if (!cv || !wv) continue;
  if (cv.length === 0) {
    // CS2 无 vsnd → 必须覆盖
    realNeed.push({ ev: t.event, cs2: [], go: wv, why: 'CS2无vsnd' });
    continue;
  }
  const generic = cv.some((x) => GENERIC.test(x));
  const A = new Set(cv.map(base));
  const B = new Set(wv.map(base));
  const same = A.size === B.size && [...A].every((x) => B.has(x));
  if (same && !generic) {
    sameN++;
    sameList.push(t.event);
  } else {
    realNeed.push({ ev: t.event, cs2: cv, go: wv, why: generic ? 'CS2用通用音' : '素材不同' });
  }
}
console.log(`「CS2 已是同款音」: ${sameN}`);
console.log(`「CS2 换了音/用通用音/无vsnd」: ${realNeed.length}`);
console.log('\n=== 真正需要覆盖的事件 ===');
for (const d of realNeed) {
  console.log('  ' + d.ev.padEnd(32) + '[' + d.why + ']');
  console.log('      CS2 : ' + (d.cs2.length ? d.cs2.join(', ') : '(空)'));
  console.log('      CSGO: ' + d.go.join(', '));
}
fs.writeFileSync('data/csgo_ref/real_need.json', JSON.stringify(realNeed, null, 1));
console.log('\n→ data/csgo_ref/real_need.json');
