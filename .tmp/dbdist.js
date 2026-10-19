const fs=require('fs');
const cg=require('../data/csgo_ref/csgo_events.json').events;
const plan=JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json','utf8'));
const src=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);
const blocks=new Map(); let cur=null,buf=[];
for(const l of src){const m=l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/); if(m){if(cur)blocks.set(cur,buf);cur=m[1];buf=[l];} else if(cur)buf.push(l);}
if(cur)blocks.set(cur,buf);
const fld=(a,n)=>{const re=new RegExp('^\t\t'+n+'[ \t]*=[ \t]*(.*)$');for(const l of a){const m=l.match(re);if(m)return m[1].trim();}return null;};
const num=v=>{if(v==null)return null;const p=String(v).split(',').map(s=>parseFloat(s.trim())).filter(x=>isFinite(x));if(!p.length)return null;return p.reduce((a,b)=>a+b,0)/p.length;};
const suff=ev=>ev.slice(ev.indexOf('.')+1).replace(/_Q$/,'');
const calib=JSON.parse(fs.readFileSync('.tmp/calib.json','utf8'));
const rows=[];
for(const t of plan.events){
  const b=blocks.get(t.event); if(!b)continue;
  const c2=num(fld(b,'volume')); const gv=num(cg[t.event]&&cg[t.event].volume);
  if(!c2||!gv)continue;
  const s=suff(t.event);
  const g=calib[s]?calib[s].g:1;
  const nv=Math.min(1, gv*g);
  rows.push({ev:t.event,s,c2,gv,g,nv,db:20*Math.log10(nv/c2)});
}
const bins=[1,2,3,4,6,8,10,12,15,20,999];
for(let i=0;i<bins.length-1;i++){
  const lo=bins[i],hi=bins[i+1];
  const n=rows.filter(r=>Math.abs(r.db)>=lo&&Math.abs(r.db)<hi).length;
  console.log(`|ΔdB| ${String(lo).padStart(2)}-${String(hi).padEnd(3)} : ${n}`);
}
console.log('总计',rows.length,'| 变化>0.5dB:',rows.filter(r=>Math.abs(r.db)>0.5).length);
console.log('\n=== |ΔdB| > 10 的事件 ===');
rows.filter(r=>Math.abs(r.db)>10).sort((a,b)=>Math.abs(b.db)-Math.abs(a.db)).forEach(r=>console.log(' ',r.ev.padEnd(30),('cs2='+r.c2).padEnd(10),('go='+r.gv).padEnd(9),('g='+r.g.toFixed(3)).padEnd(9),('new='+r.nv.toFixed(3)).padEnd(11),r.db.toFixed(1)+'dB'));
