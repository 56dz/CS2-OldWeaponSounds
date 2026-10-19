const fs=require('fs');
function load(p){
  const lines=fs.readFileSync(p,'utf8').split(/\r?\n/);
  const out=new Map(); let cur=null,buf=[];
  for(const l of lines){
    const mm=l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/);
    if(mm){ if(cur) out.set(cur,buf); cur=mm[1]; buf=[l]; }
    else if(cur) buf.push(l);
  }
  if(cur) out.set(cur,buf);
  return out;
}
const cs2=load('data/gsw.txt');
const ours=load('data/out/soundevents_addon.vsndevts');
const names=process.argv.slice(2);
for(const n of names){
  const a=cs2.get(n), b=ours.get(n);
  console.log('\n===== '+n+' =====  cs2:'+(a?a.length:'-')+' ours:'+(b?b.length:'-'));
  if(!a||!b) continue;
  // normalize by collapsing multi-line arrays into single logical lines
  const norm=(arr)=>{ const r=[]; let acc=null;
    for(const l of arr){
      if(acc!==null){ acc+=' '+l.trim(); if(l.includes(']')){ r.push(acc); acc=null; } continue; }
      if(/=\s*$/.test(l)||/=\s*\[$/.test(l)){ acc=l.trim()+' '; continue; }
      r.push(l.trim());
    }
    if(acc) r.push(acc);
    return r;
  };
  const A=norm(a), B=norm(b);
  const setA=new Set(A), setB=new Set(B);
  for(const l of A) if(!setB.has(l)) console.log('  - '+l);
  for(const l of B) if(!setA.has(l)) console.log('  + '+l);
}
