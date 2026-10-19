const fs=require('fs');
const plan=JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json','utf8'));
const src=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);
const idx=new Map();
for(let i=0;i<src.length;i++){const m=src[i].match(/^\t(\S[^\s=]*)[ \t]*=[ \t]*$/);if(!m)continue;let e=-1;for(let j=i+1;j<src.length;j++){if(src[j]==='\t}'){e=j;break;}if(/^\t\S[^\s=]*[ \t]*=[ \t]*$/.test(src[j]))break;}if(e>0)idx.set(m[1],{s:i,e});}
function cnt(ev){const h=idx.get(ev);if(!h)return 0;for(let j=h.s+1;j<=h.e;j++){const m=/^\t\tvsnd_files_track_0\d+\s*=\s*(.*)$/.exec(src[j]);if(!m)continue;const r=m[1].trim();if(r.startsWith('"'))return 1;let n=0,open=r.includes('[');for(let k=j+1;k<h.e;k++){const t=src[k].trim();if(t==='')continue;if(!open){if(t.startsWith('[')){open=true;continue;}return 1;}if(t.startsWith(']'))return n;if(t.startsWith('"'))n++;else return n;}return n;}return 0;}
const bigger=[];
for(const t of plan.events){const c=cnt(t.event);const g=(t.wavs||[]).length;if(g>c)bigger.push({ev:t.event,cs2:c,csgo:g});}
console.log('CS:GO 变体多于 CS2 的事件:',bigger.length);
bigger.sort((a,b)=>(b.csgo-b.cs2)-(a.csgo-a.cs2)).slice(0,25).forEach(x=>console.log('  ',x.ev.padEnd(32),'cs2='+x.cs2,'csgo='+x.csgo));
