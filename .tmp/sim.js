const fs=require('fs');
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
const CRAFT=new Set(['Draw','Clipin','Clipout','Slideback','Sliderelease','BoltBack','BoltForward','Boltpull','Boltrelease','InsertShell','Insertshell','PumpBack','PumpForward','WeaponMove1','WeaponMove2','WeaponMove3','ClipHit','Cliphit','Coverup','Coverdown','Deploy']);
const rows=[];
for(const t of plan.events){
  const b=blocks.get(t.event); if(!b)continue;
  const c2=num(fld(b,'volume'));
  const gv=num(cg[t.event]&&cg[t.event].volume);
  const wav=(t.wavs||[])[0]; if(!wav)continue;
  const key=wav.replace(/^sound\//,'');
  const r=rms[key]; if(r==null)continue;
  rows.push({ev:t.event,s:suff(t.event),c2,gv,r, eff2: c2? 20*Math.log10(c2)+r:null, effg: gv? 20*Math.log10(gv)+r:null});
}
const byS={};
for(const r of rows)(byS[r.s]=byS[r.s]||[]).push(r);
console.log('后缀            n   CS2均值  GO均值   差   CS2_sd GO_sd  改音量数(>1%)  最大倍数');
for(const s of Object.keys(byS).sort((a,b)=>byS[b].length-byS[a].length)){
  const rs=byS[s].filter(r=>r.eff2!=null&&r.effg!=null);
  if(rs.length<2)continue;
  const m2=rs.reduce((a,b)=>a+b.eff2,0)/rs.length, mg=rs.reduce((a,b)=>a+b.effg,0)/rs.length;
  const sd=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length);};
  const changed=rs.filter(r=>Math.abs(r.gv-r.c2)/r.c2>0.01);
  const maxRatio=Math.max(...changed.map(r=>Math.max(r.gv/r.c2,r.c2/r.gv)),1);
  console.log(s.padEnd(14), String(rs.length).padStart(3), m2.toFixed(1).padStart(8), mg.toFixed(1).padStart(7), (mg-m2).toFixed(1).padStart(6), sd(rs.map(r=>r.eff2)).toFixed(2).padStart(7), sd(rs.map(r=>r.effg)).toFixed(2).padStart(6), String(changed.length).padStart(12), maxRatio.toFixed(1).padStart(8), CRAFT.has(s)?'[工艺]':'');
}
