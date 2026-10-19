const fs=require('fs');
const ld=JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json','utf8'));
const cg=JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json','utf8')).events;
const plan=JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json','utf8'));

// rms lookup: wav key -> rms_db
const rms={};
for(const r of ld.rows){ if(r.err) continue; rms[r.file]=r.rms_db; }

const lines=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);
const blocks=new Map(); let cur=null,buf=[];
for(const l of lines){
  const mm=l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/);
  if(mm){ if(cur) blocks.set(cur,buf); cur=mm[1]; buf=[l]; }
  else if(cur) buf.push(l);
}
if(cur) blocks.set(cur,buf);
function fld(arr,name){const re=new RegExp('^\t\t'+name+'[ \t]*=[ \t]*(.*)$');for(const l of arr){const m=l.match(re);if(m)return m[1].trim();}return null;}
function avg(v){if(v==null)return null;const p=String(v).split(',').map(s=>parseFloat(s.trim())).filter(x=>!isNaN(x));if(!p.length)return null;return p.reduce((a,b)=>a+b,0)/p.length;}

const groups=['Draw','Clipin','Clipout','Slideback','Sliderelease','BoltBack','BoltForward','Single','SingleDistant','Insertshell','PumpBack','PumpForward','WeaponMove1'];
const rows=[];
for(const t of plan.events){
  const ev=t.event; const b=blocks.get(ev); if(!b) continue;
  const suf=ev.slice(ev.indexOf('.')+1);
  if(!groups.includes(suf)) continue;
  const c2=avg(fld(b,'volume'));
  const g=cg[ev]; const gvol=g?avg(g.volume):null;
  const wav=(t.wavs||[])[0];
  if(!wav) continue;
  const key=wav.replace(/^sound\//,'');
  const r=rms[key]; if(r==null) continue;
  const effC2 = c2!=null ? 20*Math.log10(c2)+r : null;
  const effGo = gvol!=null ? 20*Math.log10(gvol)+r : null;
  rows.push({ev,suf,c2,gvol,r,effC2,effGo});
}
for(const gp of groups){
  const rs=rows.filter(r=>r.suf===gp && r.effGo!=null);
  if(rs.length<3) continue;
  const e2=rs.filter(r=>r.effC2!=null).map(r=>r.effC2);
  const eg=rs.map(r=>r.effGo);
  const stat=(a)=>{const m=a.reduce((x,y)=>x+y,0)/a.length;const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length);return {m,sd,min:Math.min(...a),max:Math.max(...a)};};
  const s2=stat(e2), sg=stat(eg);
  console.log(`\n=== ${gp}  n=${rs.length} ===`);
  console.log(`  用 CS2 音量: 平均有效 ${s2.m.toFixed(1)} dB  标准差 ${s2.sd.toFixed(1)}  范围 ${(s2.max-s2.min).toFixed(1)}`);
  console.log(`  用 CSGO音量: 平均有效 ${sg.m.toFixed(1)} dB  标准差 ${sg.sd.toFixed(1)}  范围 ${(sg.max-sg.min).toFixed(1)}`);
  const worst=rs.slice().sort((a,b)=>(b.effC2-b.effGo)-(a.effC2-a.effGo)).slice(0,4);
  for(const w of worst) console.log(`    ${w.ev.padEnd(30)} cs2=${String(w.c2).padEnd(8)} go=${String(w.gvol).padEnd(8)} rms=${w.r.toFixed(1)} effC2=${w.effC2?.toFixed(1)} effGo=${w.effGo.toFixed(1)}`);
}
