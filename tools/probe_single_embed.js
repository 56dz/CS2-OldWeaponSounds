// 批量：从 CS2 pak01 提取全部 Single 事件对应的 vsnd_c，检测是否内嵌 CS:GO 原 PCM
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const csgo = JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json', 'utf8')).events;
const plan = JSON.parse(fs.readFileSync('data/csgo_ref/legacy_all_plan.json', 'utf8'));

const CS2 = 'D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive';
const OUT = 'data/csgo_ref/cs2_singles';
fs.mkdirSync(OUT, { recursive: true });

function readWavPcm(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF') return null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('latin1', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (id === 'data') return buf.subarray(off + 8, Math.min(off + 8 + len, buf.length));
    off += 8 + len + (len & 1);
  }
  return null;
}

const want = [];
for (const t of plan.events) {
  if (!/\.Single$/.test(t.event)) continue;
  const wavs = csgo[t.event] && csgo[t.event].waves;
  if (!wavs || !wavs.length) continue;
  const w0 = wavs[0].replace(/^sound\//i, '').replace(/\\/g, '/');
  want.push({ ev: t.event, wav: w0 });
}
const files = want.map((w) => 'sounds/' + w.wav.replace(/\.wav$/i, '.vsnd_c'));
const listFile = path.join(OUT, 'filelist.txt');
fs.writeFileSync(listFile, files.join('\n') + '\n');

// 用 vpk_extract.js extract --filelist? 不支持 → 逐个 --only
console.log('需要提取 ' + files.length + ' 个 vsnd_c');
let ok = 0;
const results = [];
for (let i = 0; i < want.length; i++) {
  const w = want[i];
  const inner = 'sounds/' + w.wav.replace(/\.wav$/i, '.vsnd_c');
  const dest = path.join(OUT, w.wav.replace(/\//g, '_').replace(/\.wav$/i, '.vsnd_c'));
  if (!fs.existsSync(dest)) {
    try {
      execFileSync(
        process.execPath,
        ['tools/vpk_extract.js', 'extract', CS2 + '/game/csgo/pak01_dir.vpk', OUT, '--only', inner, '--quiet'],
        { stdio: 'pipe' }
      );
    } catch (e) {
      results.push({ ev: w.ev, wav: w.wav, status: 'EXTRACT_FAIL' });
      continue;
    }
  }
  // vpk_extract 保持目录结构
  const extracted = path.join(OUT, inner.replace(/\//g, path.sep));
  if (!fs.existsSync(extracted)) {
    results.push({ ev: w.ev, wav: w.wav, status: 'NOT_FOUND' });
    continue;
  }
  const vsnd = fs.readFileSync(extracted);
  const pcm = readWavPcm(fs.readFileSync('data/csgo_ref/wavout/' + w.wav));
  const probe = pcm ? pcm.subarray(0, Math.min(4096, pcm.length)) : Buffer.alloc(0);
  const embedded = probe.length > 0 && vsnd.indexOf(probe) >= 0;
  const full = pcm && pcm.length > 0 && vsnd.indexOf(pcm) >= 0;
  results.push({ ev: w.ev, wav: w.wav, vsndSize: vsnd.length, pcmSize: pcm ? pcm.length : 0, embedded, full });
  if (embedded) ok++;
}
console.log(`内嵌 CS:GO PCM 的: ${ok} / ${results.length}`);
console.log('\n=== 未内嵌（音色已被 CS2 重编码，必须覆盖）===');
for (const r of results.filter((r) => r.embedded === false)) {
  console.log('  ' + r.ev.padEnd(30) + ' vsnd=' + r.vsndSize + '  pcm=' + r.pcmSize);
}
fs.writeFileSync('data/csgo_ref/single_embed_check.json', JSON.stringify(results, null, 1));
