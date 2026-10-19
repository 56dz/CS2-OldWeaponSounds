const fs=require('fs');
const lines=fs.readFileSync(process.argv[3]||'data/gsw.txt','utf8').split(/\r?\n/);
const want=process.argv[2].split(',');
let cur=null,buf=[];
const out=new Map();
for(const l of lines){
  const mm=l.match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/);
  if(mm){ if(cur) out.set(cur,buf); cur=mm[1]; buf=[l]; }
  else if(cur) buf.push(l);
}
if(cur) out.set(cur,buf);
for(const w of want){
  const b=out.get(w);
  console.log('\n===== '+w+' ('+(b?b.length+' lines':'MISSING')+') =====');
  if(!b) continue;
  for(const l of b){
    if(/volume|pitch|vsnd_files|soundevent_|duration|type =|random|limit/.test(l)) console.log('  '+l.trim());
  }
}
