const fs=require('fs');
const cg=JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json','utf8')).events;
const lines=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);
const blocks=new Map(); let cur=null, buf=[];
for(const l of lines){
  const mm=l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/);
  if(mm){ if(cur) blocks.set(cur,buf); cur=mm[1]; buf=[l]; }
  else if(cur) buf.push(l);
}
if(cur) blocks.set(cur,buf);
function fld(arr,name){
  const re=new RegExp('^\t\t'+name+'[ \t]*=[ \t]*(.*)$');
  for(const l of arr){ const m=l.match(re); if(m) return m[1].trim(); }
  return null;
}
const sfx=['Draw','Clipin','Clipout','Slideback','Sliderelease','BoltBack','BoltForward','ClipHit','Insertshell','PumpBack','PumpForward'];
const rows=[];
for(const [name,arr] of blocks){
  const dot=name.indexOf('.'); if(dot<0) continue;
  const suf=name.slice(dot+1);
  if(!sfx.includes(suf)) continue;
  const c2=fld(arr,'volume'); const g=cg[name];
  if(!g) continue;
  rows.push({name,suf,c2,go:g.volume});
}
function num(v){ if(v==null) return null; const parts=String(v).split(',').map(s=>parseFloat(s.trim())).filter(x=>!isNaN(x)); if(!parts.length) return null; return parts.reduce((a,b)=>a+b,0)/parts.length; }
const bySuffix={};
for(const r of rows){ (bySuffix[r.suf]=bySuffix[r.suf]||[]).push(r); }
for(const s of sfx){
  const list=bySuffix[s]||[]; if(!list.length) continue;
  console.log('\n=== '+s+'  ('+list.length+') ===');
  for(const r of list){
    const a=num(r.c2), b=num(r.go);
    const ratio=(a&&b)?(b/a).toFixed(1):'-';
    console.log(r.name.padEnd(30),'cs2='+String(r.c2).padEnd(11),'go='+String(r.go).padEnd(11),'x'+ratio);
  }
}
