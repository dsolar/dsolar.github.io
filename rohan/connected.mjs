import {isUsableSnapshot,points,currentMatchups,weeklyProjection,isStale} from './connected-model.mjs';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
let snapshot=null,busy=false,ready=false,season=new Date().getFullYear();
const pending=new Map();
function request(command,timeout=120000){
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(command==='ping'?'Install or update ESPN Connect to use current league data.':'The connector did not respond. The last displayed import has not changed.'));},timeout);
    pending.set(id,{resolve,reject,timer});window.postMessage({type:'SDN_ESPN_REQUEST',id,command,leagueId:270405,season},location.origin);
  });
}
window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin)return;
  const m=event.data;
  if(m?.type==='SDN_ESPN_UPDATED'&&ready){load(false);return;}
  if(m?.type!=='SDN_ESPN_RESPONSE'||!pending.has(m.id))return;
  const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);
  if(m.ok)p.resolve(m.data);else p.reject(Error(m.error?.message||'The ESPN connection needs attention.'));
});
function table(headings,rows){
  const t=el('table'),head=el('thead'),tr=el('tr');headings.forEach(h=>{const th=el('th',h);th.scope='col';tr.append(th);});head.append(tr);t.append(head);
  const body=el('tbody');rows.forEach(row=>{const tr=el('tr');row.forEach(v=>tr.append(el('td',v)));body.append(tr);});t.append(body);return t;
}
function roster(){
  const team=snapshot?.teams.find(t=>String(t.id)===$('espn-team').value);if(!team)return;
  $('espn-roster').replaceChildren(table(['Slot','Player','NFL','Health','Week '+snapshot.week+' proj.'],team.roster.map(p=>[p.lineupSlot,p.name,p.nflTeam,p.injuryStatus,points(weeklyProjection(p,snapshot.week))])));
  try{localStorage.setItem('rohan:espn-team',String(team.id));}catch{}
}
function stamp(s,status){
  const when=new Date(s.importedAt).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const attention=isStale(s)||status!=='connected';
  $('espn-status').textContent=`${attention?'Import needs attention':'Connected to ESPN'} · ${s.season}, Week ${s.week} · Last successful import ${when} ET. ${attention?'Refresh or reconnect before relying on this data.':'Server refreshes about every 20 minutes. This page checks for updates every minute.'}`;
}
function render(s,status){
  if(!isUsableSnapshot(s))throw Error('ESPN did not return a complete Rohan snapshot. The last displayed data has not changed.');
  snapshot=s;
  $('connected-title').textContent=`Rohan · Week ${s.week}`;
  stamp(s,status);
  const teams=[...s.teams].sort((a,b)=>(a.rank??999)-(b.rank??999));
  $('espn-standings').replaceChildren(table(['Rank','Team','W–L–T','Points for'],teams.map(t=>{const r=t.record?.overall;return[t.rank??'—',t.name,r?`${r.wins??0}–${r.losses??0}–${r.ties??0}`:'—',points(t.pointsFor)];})));
  const matches=currentMatchups(s),names=new Map(teams.map(t=>[t.id,t.name]));
  $('espn-matchups').replaceChildren(...(matches.length?matches.map(m=>{const card=el('div',null,'connected-matchup');for(const side of [m.away,m.home]){const row=el('p');row.append(el('span',names.get(side.teamId)||'Unknown team'),el('strong',points(side.totalPoints)));card.append(row);}return card;}):[el('p','No current matchup-period data was supplied by ESPN.')]));
  let chosen=$('espn-team').value;try{chosen=chosen||localStorage.getItem('rohan:espn-team');}catch{}
  $('espn-team').replaceChildren(...teams.map(t=>{const o=el('option',t.name);o.value=t.id;return o;}));
  if(teams.some(t=>String(t.id)===chosen))$('espn-team').value=chosen;else if(s.myTeamIds?.length)$('espn-team').value=s.myTeamIds[0];
  roster();$('espn-content').hidden=false;$('espn-setup').hidden=true;
  // Keep the dated archive available, but never mix its old lineups with the connected board.
  document.body.classList.add('espn-connected');
}
async function load(refresh){
  if(busy)return;busy=true;$('espn-refresh').disabled=true;
  try{const result=await request(refresh?'refresh':'snapshot');render(result.snapshot,result.status||'connected');if(result.lastError)$('espn-status').append(el('span',' '+result.lastError.message));}
  catch(error){$('espn-status').textContent=error.message+(snapshot?' Displayed import: '+new Date(snapshot.importedAt).toLocaleString()+'.':' The dated archive remains available below.');$('espn-setup').hidden=false;}
  finally{busy=false;$('espn-refresh').disabled=false;}
}
$('espn-team').addEventListener('change',roster);
$('espn-refresh').addEventListener('click',()=>load(true));
async function start(){
  try{await request('ping',2500);ready=true;const result=await request('leagues');const leagues=(result.leagues||[]).filter(l=>Number(l.league_id)===270405).sort((a,b)=>b.season-a.season);if(!leagues.length)throw Error('Connect Rohan in the Trade Analyzer to enable this board.');season=leagues[0].season;$('espn-refresh').hidden=false;await load(false);}
  catch(error){$('espn-status').textContent=error.message+' The dated archive remains available below.';$('espn-setup').hidden=false;}
}
setInterval(()=>{if(ready&&!document.hidden)load(false);},60000);
document.addEventListener('visibilitychange',()=>{if(ready&&!document.hidden)load(false);});
start();
