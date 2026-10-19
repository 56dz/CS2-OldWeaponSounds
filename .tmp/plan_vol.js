const fs=require('fs'),path=require('path');
const cg=require('../data/csgo_ref/csgo_events.json').events;
const plan=JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json','utf8'));
const ld=JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json','utf8'));
const rms={}; for(const r of ld.rows){ if(!r.err) rms[r.file]=r.rms_db; }
const src=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);
const blocks=new Map(); let cur=null,buf=[];
for(const l of src){const m=l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/); if(m){if(cur)blocks.set(cur,buf);cur=m[1];buf=[l];} else if(cur)buf.push(l);}
if(cur)blocks.set(cur,buf);
const fld=(a,n)=>{const re=new RegExp('^\t\t'+n+'[ \t]*=[ \t]*(.*)$');for(const l of a){const m=l.match(re);if(m)return m[1].trim();}return null;};
const num=v=>{if(v==null)return null;const p=String(v).split(',').map(s=>parseFloat(s.trim())).filter(x=>isFinite(x));if(!p.length)return null;return p.reduce((a,b)=>a+b,0)/p.length;};
const suff=ev=>ev.slice(ev.indexOf('.')+1).replace(/_Q$/,'');
// per-event avg rms over its wavs
function rmsOf(t){
  const rs=[];
  for(const w of t.wavs||[]){ const k=w.replace(/^sound\//,''); if(rms[k]!=null) rs.push(rms[k]); }
  if(!rs.length) return null;
  return rs.reduce((a,b)=>a+b,0)/rs.length;
}
const rows=[];
for(const t of plan.events){
  const b=blocks.get(t.event); if(!b)continue;
  const c2=num(fld(b,'volume'));
  const gv=num(cg[t.event]&&cg[t.event].volume);
  const r=rmsOf(t);
  rows.push({ev:t.event,s:suff(t.event),c2,gv,r});
}
const byS={};
for(const r of rows)(byS[r.s]=byS[r.s]||[]).push(r);
const sd=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length);};
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const out={};
console.log('后缀               n  gain       均值CS2  均值新   差     sdCS2  sd新  改音量数');
for(const s of Object.keys(byS)){
  const rs=byS[s].filter(r=>r.c2>0&&r.gv>0&&r.r!=null);
  if(rs.length<2)continue;
  const e2=rs.map(r=>20*Math.log10(r.c2)+r.r);
  const e1=rs.map(r=>20*Math.log10(r.gv)+r.r);
  let g=Math.pow(10,(mean(e2)-mean(e1))/20);
  // 迭代一次：代入 clamp 后重算 gain，保证均值仍然对齐
  for(let it=0;it<3;it++){
    const e3=rs.map((r,i)=>{const nv=Math.min(1,r.gv*g);return 20*Math.log10(nv)+r.r;});
    const d=mean(e2)-mean(e3);
    g*=Math.pow(10,d/20);
  }
  const e3=rs.map(r=>{const nv=Math.min(1,r.gv*g);return 20*Math.log10(nv)+r.r;});
  const changed=rs.filter(r=>{const nv=Math.min(1,r.gv*g);return Math.abs(nv-r.c2)/r.c2>0.02;});
  out[s]={gain:g,n:rs.length,mean_cs2:mean(e2),mean_new:mean(e3),sd_cs2:sd(e2),sd_new:sd(e3),changed:changed.length};
  console.log(s.padEnd(20), String(rs.length).padStart(2), g.toFixed(3).padStart(6), mean(e2).toFixed(1).padStart(8), mean(e3).toFixed(1).padStart(7), (mean(e3)-mean(e2)).toFixed(1).padStart(5), sd(e2).toFixed(2).padStart(7), sd(e3).toFixed(2).padStart(5), String(changed.length).padStart(7));
}
// overall: weighted sd across all
const allrs=rows.filter(r=>r.c2>0&&r.gv>0&&r.r!=null);
const e2all=allrs.map(r=>20*Math.log10(r.c2)+r.r);
const e3all=allrs.map(r=>{const g=out[r.s]?out[r.s].gain:1;return 20*Math.log10(Math.min(1,r.gv*g))+r.r;});
console.log('\n全事件  n='+allrs.length, 'sd_cs2', sd(e2all).toFixed(2), 'sd_new', sd(e3all).toFixed(2), '| 均值', mean(e2all).toFixed(2), '->', mean(e3all).toFixed(2));
fs.writeFileSync('.tmp/gain.json', JSON.stringify(out,null,1));
