const fs=require('fs');
const cg=JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json','utf8'));
const ev=cg.events;
const want=['Weapon_USP.Draw','Weapon_USP.Clipin','Weapon_USP.Clipout','Weapon_USP.Slideback','Weapon_USP.Sliderelease',
'Weapon_AK47.Draw','Weapon_AK47.Clipin','Weapon_AK47.Clipout','Weapon_AK47.Single',
'Weapon_Glock.Draw','Weapon_Glock.Single','Weapon_Glock.Clipin','Weapon_Glock.Clipout',
'Weapon_M4A1.Draw','Weapon_M4A1.Clipin','Weapon_M4A1.Clipout','Weapon_M4A1.Single',
'Weapon_M4A4.Draw','Weapon_M4A4.Single'];
for(const w of want){
  const e=ev[w];
  if(!e){console.log(w.padEnd(28),'-- no csgo event');continue;}
  console.log(w.padEnd(28),'vol='+(e.volume??'-'),'lvl='+(e.soundlevel??'-'),'ch='+(e.channel??'-'),'n='+(e.waves?e.waves.length:0));
  if(e.waves) for(const x of e.waves) console.log('   ',x);
}
