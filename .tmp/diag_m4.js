const fs=require('fs');
const cg=JSON.parse(fs.readFileSync('data/csgo_ref/csgo_events.json','utf8')).events;
const plan=JSON.parse(fs.readFileSync('data/csgo_ref/plan_full_cover.json','utf8'));
const gsw=fs.readFileSync('data/gsw.txt','utf8').split(/\r?\n/);

function blocks(lines){
  const m=new Map(); let cur=null, buf=[];
  for(const l of lines){
    const mm=l.match(/^\t(\S[^\s=]*)\s*=\s*$/);
    if(mm){ if(cur) m.set(cur,buf.join('\n')); cur=mm[1]; buf=[l]; }
    else if(cur) buf.push(l);
  }
  if(cur) m.set(cur,buf.join('\n'));
  return m;
}
const cs2=blocks(gsw);
function field(b,name){
  const m=b.match(new RegExp('^\t\t'+name+'\s*=\s*(.*)$','m'));
  return m?m[1].trim():null;
}
function vsnds(b){
  const lines=b.split('\n');
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(/^\t\tvsnd_files_track_0\d\s*=\s*(.*)$/);
    if(!m) continue;
    let rest=m[1].trim();
    if(rest.startsWith('[')){
      // collect until ]
      let acc=rest, j=i;
      while(!acc.includes(']') && j+1<lines.length){ j++; acc+='\n'+lines[j]; }
      return (acc.match(/"([^"]+)"/g)||[]).map(s=>s.replace(/"/g,''));
    }
    return rest.replace(/"/g,'')?[rest.replace(/"/g,'')]:[];
  }
  return [];
}
const names=['Weapon_M4A1','Weapon_M4A4','Weapon_M4A1S','Weapon_Glock','Weapon_USP','Weapon_AK47','Weapon_M4A1_Silencer'];
for(const n of names){
  const evs=[...cs2.keys()].filter(k=>k.startsWith(n+'.'));
  if(!evs.length){ console.log('\n### '+n+' -> (no cs2 events)'); continue; }
  console.log('\n### '+n+'  ('+evs.length+' cs2 events)');
  for(const e of evs.slice(0,30)){
    const suffix=e.slice(n.length+1);
    const b=cs2.get(e);
    const cvs=vsnds(b);
    const cgo=cg[e];
    const mapped=(plan.events||plan.targets||[]).find(t=>t.event===e);
    const tag=(!mapped)?'NO-MAP':(cgo?'CSGO':'CSGO-missing');
    console.log(suffix.padEnd(22), 'cs2vol='+String(field(b,'volume')).padEnd(9), 'cs2='+cvs.join('|'));
    if(cgo) console.log(' '.repeat(23)+'go   vol='+String(cgo.volume).padEnd(9)+' waves='+(cgo.waves||[]).map(w=>w.split('/').pop()).join('|'));
  }
}
