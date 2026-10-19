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
const cs2=load('data/gsw.txt'), ours=load('data/out/soundevents_addon.vsndevts');
const pats=['Draw','Clipin','Clipout','Slideback','Sliderelease','BoltBack','BoltForward','Insertshell','PumpBack','PumpForward','WeaponMove1','SingleDistant','SilencedShot','Zoom'];
const keys=[...cs2.keys()].filter(k=>pats.includes(k.slice(k.indexOf('.')+1)));
let same=0, diff=[];
for(const k of keys){
  const a=cs2.get(k), b=ours.get(k);
  if(!b){continue;}
  const norm=(arr)=>{const r=[];let acc=null;
    for(const l of arr){const t=l.trim();
      if(acc!==null){acc+=' '+t; if(t.includes(']')){r.push(acc);acc=null;} continue;}
      if(/=$/.test(t)||/=\s*\[$/.test(t)){acc=t+' ';continue;}
      r.push(t);}
    if(acc)r.push(acc); return r;};
  const strip=(arr)=>norm(arr).filter(l=>!l.startsWith('vsnd_files_track')&&!l.startsWith('vsnd_duration'));
  const A=strip(a).join('|'), B=strip(b).join('|');
  if(A===B) same++; else diff.push(k);
}
console.log('工艺音事件:',keys.length,'结构完全一致:',same,'有差异:',diff.length);
if(diff.length) console.log(diff.join(', '));
