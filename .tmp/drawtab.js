const fs=require('fs');
const cg=require('../data/csgo_ref/csgo_events.json').events;
const plan=JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json','utf8'));
const G=require('../tools/volume_gains.json').suffixes;
const src=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);
const blocks=new Map(); let cur=null,buf=[];
for(const l of src){const m=l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/); if(m){if(cur)blocks.set(cur,buf);cur=m[1];buf=[l];} else if(cur)buf.push(l);}
if(cur)blocks.set(cur,buf);
const fld=(a,n)=>{const re=new RegExp('^\t\t'+n+'[ \t]*=[ \t]*(.*)$');for(const l of a){const m=l.match(re);if(m)return m[1].trim();}return null;};
const num=v=>{if(v==null)return null;const p=String(v).split(',').map(s=>parseFloat(s.trim())).filter(x=>isFinite(x));if(!p.length)return null;return p.reduce((a,b)=>a+b,0)/p.length;};
const rows=[];
for(const t of plan.events){
  const s=t.event.slice(t.event.indexOf('.')+1);
  if(s!=='Draw')continue;
  const b=blocks.get(t.event);if(!b)continue;
  const c2=num(fld(b,'volume')); const gv=num(cg[t.event]&&cg[t.event].volume);
  if(!c2||!gv)continue;
  const gain=G[s]?G[s].gain:1;
  const nv=Math.min(1,gv*gain);
  rows.push({ev:t.event,c2,gv,nv,db:20*Math.log10(nv/c2)});
}
rows.sort((a,b)=>a.db-b.db);
console.log('事件                            cs2    csgo   new    ΔdB');
for(const r of rows) console.log(r.ev.padEnd(30), String(r.c2).padEnd(6), String(r.gv).padEnd(6), r.nv.toFixed(3).padEnd(6), r.db.toFixed(1).padStart(6));
