const fs=require('fs'),path=require('path');
const src=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);
const plan=JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json','utf8'));
const ld=JSON.parse(fs.readFileSync('data/csgo_ref/loudness.json','utf8'));
const rms={}; for(const r of ld.rows){ if(!r.err) rms[r.file]=r; }
function durOf(file){
  const b=fs.readFileSync(file);
  if(b.toString('ascii',0,4)!=='RIFF') return null;
  let p=12, byteRate=null, dataLen=null;
  while(p+8<=b.length){
    const id=b.toString('ascii',p,p+4); const sz=b.readUInt32LE(p+4);
    if(id==='fmt '){ byteRate=b.readUInt32LE(p+8+8); }
    else if(id==='data'){ dataLen=Math.min(sz,b.length-p-8); break; }
    p+=8+sz+(sz%2);
  }
  if(!byteRate||dataLen==null) return null;
  return dataLen/byteRate;
}
function blockOf(name){
  const i=src.findIndex(l=>l.replace(/\s+$/,'')==='\t'+name+' =');
  if(i<0) return null; let j=i+1; for(;j<src.length;j++) if(src[j]==='\t}') break;
  return src.slice(i,j+1);
}
function fld(arr,n){const re=new RegExp('^\t\t'+n+'[ \t]*=[ \t]*(.*)$');for(const l of arr){const m=l.match(re);if(m)return m[1].trim();}return null;}
const rows=[];
for(const t of plan.events){
  const suf=t.event.slice(t.event.indexOf('.')+1);
  if(!['Draw','Clipin','Clipout','Slideback','Sliderelease'].includes(suf)) continue;
  const b=blockOf(t.event); if(!b) continue;
  const decl=parseFloat(fld(b,'vsnd_duration'));
  const cs2vsnds=[]; // skip
  let maxReal=null, mrw=null;
  for(const w of t.wavs){
    const rel=w.replace(/^sound\//,'');
    const cands=[path.join('data/csgo_ref/wavout',rel), path.join('data/csgo_ref/wavout','weapons',rel.replace(/^weapons\//,''))];
    let f=cands.find(c=>fs.existsSync(c));
    if(!f) continue;
    const d=durOf(f); if(d!=null && (maxReal==null||d>maxReal)){maxReal=d;mrw=rel;}
  }
  rows.push({ev:t.event,suf,decl:isNaN(decl)?null:decl,real:maxReal,wav:mrw,rms:rms[mrw]?rms[mrw].rms_db:null});
}
const bySuf={};
for(const r of rows){ (bySuf[r.suf]=bySuf[r.suf]||[]).push(r); }
for(const s of ['Draw','Clipin','Clipout','Slideback','Sliderelease']){
  const rs=bySuf[s]||[];
  console.log('\n=== '+s+'  n='+rs.length+' ===');
  rs.sort((a,b)=>(b.real||0)-(a.real||0));
  for(const r of rs.slice(0,8)) console.log(' ',r.ev.padEnd(26),'decl='+(r.decl??'-'),'real='+(r.real?r.real.toFixed(3):'-'),'rms='+(r.rms??'-'),r.wav);
}
// summary: real vs decl
const valid=rows.filter(r=>r.real&&r.decl);
const longer=valid.filter(r=>r.real>r.decl*1.3).length;
console.log('\n合计',valid.length,'个，wav 比 CS2 声明长 >30% 的有',longer);
const avgReal=valid.reduce((a,b)=>a+b.real,0)/valid.length;
const avgDecl=valid.reduce((a,b)=>a+b.decl,0)/valid.length;
console.log('平均 real',avgReal.toFixed(3),'平均 decl',avgDecl.toFixed(3));
