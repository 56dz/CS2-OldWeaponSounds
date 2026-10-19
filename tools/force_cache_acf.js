#!/usr/bin/env node
/**
 * Patch appworkshop_730.acf so a manually-placed VPK is treated as current.
 *
 * Usage: node tools/force_cache_acf.js <acf> <workshopId> <manifest> <timeupdated> <totalSize>
 *
 * Steam only serves the *approved* build of a workshop item, so a freshly
 * published (pending-review) upload never reaches the cache via steamcmd.
 * After copying the VPKs in by hand we must also rewrite the manifest fields,
 * otherwise Steam sees a mismatch and re-downloads the old approved build.
 */
const fs = require('fs');
const path = require('path');

function main() {
  const [acf, wid, manifest, timeupdated, totalSize] = process.argv.slice(2);
  if (!acf || !wid || !manifest || !timeupdated || !totalSize) {
    console.error('usage: node force_cache_acf.js <acf> <wid> <manifest> <timeupdated> <totalSize>');
    process.exit(2);
  }
  const text = fs.readFileSync(acf, 'utf8');
  const lines = text.split('\n');

  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `"${wid}"`) starts.push(i);
  }
  if (!starts.length) {
    console.error(`[ERR] item "${wid}" not found in ${acf}`);
    process.exit(3);
  }
  console.log(`[acf] blocks for ${wid}: ${starts.length}`);

  const resolve = (key) => {
    if (key === 'manifest' || key === 'latest_manifest') return manifest;
    if (key === 'timeupdated' || key === 'latest_timeupdated') return timeupdated;
    if (key === 'size') return String(totalSize);
    return null;
  };

  let changed = 0;
  for (const i of starts) {
    let j = i + 1;
    if (j >= lines.length || lines[j].trim() !== '{') continue;
    j++;
    while (j < lines.length && lines[j].trim() !== '}') {
      const m = lines[j].match(/^(\s*)"([a-z_]+)"(\s+)"(.*)"\s*$/);
      if (m) {
        const nv = resolve(m[2]);
        if (nv !== null) {
          const nl = `${m[1]}"${m[2]}"${m[3]}"${nv}"`;
          if (nl !== lines[j]) {
            console.log(`[acf] line ${j + 1}: ${m[2]} ${m[4]} -> ${nv}`);
            lines[j] = nl;
            changed++;
          }
        }
      }
      j++;
    }
  }

  const out = lines.join('\n');
  if (out === text) {
    console.log('[acf] no change needed');
    return;
  }
  const bak = `${acf}.bak-force-${Math.floor(Date.now() / 1000)}`;
  fs.copyFileSync(acf, bak);
  console.log(`[acf] backup ${bak}`);
  fs.writeFileSync(acf, out, 'utf8');
  console.log(`[acf] wrote ${changed} field(s)`);
}

main();
