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
const rows=[];
for(const t of plan.events){
  const b=blocks.get(t.event); if(!b)continue;
  const c2=num(fld(b,'volume'));
  const gv=num(cg[t.event]&&cg[t.event].volume);
  if(!c2||!gv)continue;
  const wav=(t.wavs||[])[0]; const key=wav?wav.replace(/^sound\//,''):null;
  rows.push({ev:t.event,s:suff(t.event),c2,gv,r:key?rms[key]:null});
}
const byS={};
for(const r of rows)(byS[r.s]=byS[r.s]||[]).push(r);
const med=a=>{const b=a.slice().sort((x,y)=>x-y);const n=b.length;return n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2;};
console.log('后缀            n   g=med(cs2/csgo)   ratio范围          合成后均值  CS2原均值  差   CS2_sd  合成_sd');
const out={};
for(const s of Object.keys(byS)){
  const rs=byS[s]; if(rs.length<2)continue;
  const ratios=rs.map(r=>r.c2/r.gv);
  const g=med(ratios);
  const eff=r=>20*Math.log10(r.c2*(r.r!=null?1:1))+ (r.r!=null?r.r:0);
  const withR=rs.filter(r=>r.r!=null);
  if(!withR.length)continue;
  const e2=withR.map(r=>20*Math.log10(r.c2)+r.r);
  const e3=withR.map(r=>20*Math.log10(Math.min(1, r.gv*g))+r.r);
  const sd=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length);};
  out[s]={g, n:withR.length, mean2:e2.reduce((a,b)=>a+b,0)/e2.length, mean3:e3.reduce((a,b)=>a+b,0)/e3.length, sd2:sd(e2), sd3:sd(e3)};
  console.log(s.padEnd(14), String(withR.length).padStart(3), g.toFixed(3).padStart(14), (Math.min(...ratios).toFixed(2)+'~'+Math.max(...ratios).toFixed(2)).padStart(16), out[s].mean3.toFixed(1).padStart(10), out[s].mean2.toFixed(1).padStart(10), (out[s].mean3-out[s].mean2).toFixed(1).padStart(5), out[s].sd2.toFixed(2).padStart(7), out[s].sd3.toFixed(2).padStart(7));
}
fs.writeFileSync('.tmp/calib.json', JSON.stringify(out,null,1));
