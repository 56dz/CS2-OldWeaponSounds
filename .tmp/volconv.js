const fs=require('fs');
const cg=require('../data/csgo_ref/csgo_events.json').events;
const src=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);
const blocks=new Map(); let cur=null,buf=[];
for(const l of src){const m=l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/); if(m){if(cur)blocks.set(cur,buf);cur=m[1];buf=[l];} else if(cur)buf.push(l);}
if(cur)blocks.set(cur,buf);
const fld=(a,n)=>{const re=new RegExp('^\t\t'+n+'[ \t]*=[ \t]*(.*)$');for(const l of a){const m=l.match(re);if(m)return m[1].trim();}return null;};
let eqMax=0,eqMin=0,eqAvg=0,other=0,examples=[];
for(const k in cg){
  const v=cg[k].volume; if(!v||!String(v).includes(',')) continue;
  const b=blocks.get(k); if(!b) continue;
  const c2=parseFloat(fld(b,'volume')); if(!isFinite(c2)) continue;
  const parts=String(v).split(',').map(s=>parseFloat(s.trim())).filter(x=>isFinite(x));
  const mn=Math.min(...parts),mx=Math.max(...parts),av=parts.reduce((a,b)=>a+b,0)/parts.length;
  const near=(a)=>Math.abs(a-c2)<0.005;
  if(near(mx))eqMax++; else if(near(mn))eqMin++; else if(near(av))eqAvg++; else {other++; if(examples.length<10)examples.push(`${k}: csgo="${v}" cs2=${c2}`);}
}
console.log({eqMax,eqMin,eqAvg,other,total:eqMax+eqMin+eqAvg+other});
examples.forEach(e=>console.log('  ',e));
