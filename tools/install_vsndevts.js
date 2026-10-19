// install_vsndevts.js — 把生成的 vsndevts 装进本机 CS2 addon 源目录
const fs = require('fs');
const path = require('path');
const SRC = 'D:/Users/Daniel/code/DSH/cssharp/CS2_Old_Weapon_Sounds/data/out/soundevents_addon.vsndevts';
const DST = 'D:/Program Files/Steam/steamapps/common/Counter-Strike Global Offensive/content/csgo_addons/csgo_old_weapon_sounds/soundevents/soundevents_addon.vsndevts';
fs.copyFileSync(SRC, DST);
const st = fs.statSync(DST);
console.log('installed', DST, st.size, 'B');
