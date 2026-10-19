const fs=require('fs'),path=require('path');
function fmt(file){
  const b=fs.readFileSync(file);
  let p=12,ch=null,sr=null;
  while(p+8<=b.length){
    const id=b.toString('ascii',p,p+4), sz=b.readUInt32LE(p+4);
    if(id==='fmt '){ ch=b.readUInt16LE(p+10); sr=b.readUInt32LE(p+12); break; }
    p+=8+sz+(sz%2);
  }
  return {ch,sr};
}
const list=['weapons/usp/usp_draw','weapons/m4a1/m4a1_draw','weapons/ak47/ak47_draw','weapons/glock18/glock_draw','weapons/glock18/glock_02','weapons/glock18/glock_01','weapons/ak47/ak47_clipin','weapons/ak47/ak47_clipout','weapons/usp/usp_clipin','weapons/m4a1/m4a1_clipin','weapons/m4a1/m4a1_clipout','weapons/m4a1/m4a1_01','weapons/m4a1/m4a1_02','weapons/ak47/ak47_01','weapons/usp/usp_unsilenced_01'];
for(const l of list){
  const f=path.join('data/csgo_ref/wavout',l+'.wav');
  if(!fs.existsSync(f)){console.log(l,'MISSING');continue;}
  const o=fmt(f); console.log(l.padEnd(34), 'ch='+o.ch, 'sr='+o.sr, fs.statSync(f).size);
}
