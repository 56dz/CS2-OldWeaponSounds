const fs=require('fs');
const lines=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);
const out=new Map(); let cur=null,buf=[];
for(const l of lines){
  const mm=l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/);
  if(mm){ if(cur) out.set(cur,buf); cur=mm[1]; buf=[l]; }
  else if(cur) buf.push(l);
}
if(cur) out.set(cur,buf);
const rows=[];
for(const [n,arr] of out){
  const g=(k)=>{for(const l of arr){const m=l.match(new RegExp('^\t\t'+k+'\s*=\s*(.*)$')); if(m) return m[1].trim();} return null;};
  const vmin=g('volume_random_min'), vmax=g('volume_random_max');
  if(vmin!==null||vmax!==null) rows.push({n,vmin,vmax,pmin:g('pitch_random_min'),pmax:g('pitch_random_max')});
}
console.log('blocks with volume_random:', rows.length);
const nz=rows.filter(r=>parseFloat(r.vmin||0)!==0||parseFloat(r.vmax||0)!==0);
console.log('non-zero:', nz.length);
for(const r of nz.slice(0,40)) console.log(' ', r.n.padEnd(32), 'volmin='+r.vmin, 'volmax='+r.vmax);
console.log('\n--- sample zero ones ---');
for(const r of rows.slice(0,5)) console.log(' ', r.n.padEnd(32), r.vmin, r.vmax);
