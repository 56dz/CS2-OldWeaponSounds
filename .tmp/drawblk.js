const fs=require('fs');
const src=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);
const gen=fs.readFileSync('data/out/soundevents_addon.vsndevts','utf8').split(/\r?\n/);
function get(lines,name){
  const i=lines.findIndex(l=>l.replace(/\s+$/,'')==='\t'+name+' =');
  if(i<0) return null;
  let j=i+1; for(;j<lines.length;j++){ if(lines[j]==='\t}') break; }
  return lines.slice(i,j+1);
}
for(const n of ['Weapon_M4A1.Draw','Weapon_M4A4.Single','Weapon_USP.Draw','Weapon_Glock.Single','Weapon_AK47.Draw']){
  console.log('='.repeat(70));
  console.log('### gsw:',n);
  const b=get(src,n); console.log(b?b.map((l,i)=>i+': '+l).join('\n'):'  <missing>');
}
