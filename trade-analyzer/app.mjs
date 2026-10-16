import {createTradeTool} from './trade-ui.mjs?v=2';
import {stat,auctionPrice} from './lib/trade.mjs?v=2';
const $=id=>document.getElementById(id);
const pending=new Map();
let installed=false,snapshot=null,availableLimit=100,busy=false;
const n=value=>Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:2}):'Unavailable';
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function saveTeam(id){if(!snapshot)return;$('my-team').value=id;try{localStorage.setItem(`sdn-espn-team:${snapshot.leagueId}:${snapshot.season}`,String(id));}catch{}}
const tradeTool=createTradeTool({onTeamChange:saveTeam});

function request(command,data={},timeout=120000){
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(command==='ping'?'The ESPN extension is not installed.':'The connector did not respond. Refresh this page and try again.'));},timeout);
    pending.set(id,{resolve,reject,timer});
    window.postMessage({type:'SDN_ESPN_REQUEST',id,command,...data},location.origin);
  });
}
window.addEventListener('message',event=>{
  if(event.source!==window || event.origin!==location.origin) return;
  const m=event.data;
  if(m?.type==='SDN_ESPN_UPDATED'){loadLeagues().catch(showError);return;}
  if(m?.type!=='SDN_ESPN_RESPONSE' || !pending.has(m.id))return;
  const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);
  if(m.ok)p.resolve(m.data);else{const e=new Error(m.error?.message || 'The connection failed.');e.code=m.error?.code;p.reject(e);}
});

function notice(message,error=false){$('notice').textContent=message || '';$('notice').className='notice'+(error?' error':'');$('notice').hidden=!message;}
function showError(error){notice(error.message,true);}
function badge(label,warning=false){return element('span',label,'pill'+(warning?' warning':''));}
function table(headings,rows){const t=element('table'),thead=element('thead'),tr=element('tr');for(const h of headings)tr.append(element('th',h));thead.append(tr);t.append(thead);const body=element('tbody');for(const row of rows){const r=element('tr');for(const cell of row){const td=element('td');if(cell instanceof Node)td.append(cell);else td.textContent=cell ?? 'Unavailable';r.append(td);}body.append(r);}t.append(body);return t;}
function weeklyPoints(p){return p.stats?.find(s=>s.sourceId===1&&s.week===snapshot.week&&s.splitTypeId===1)?.points ?? null;}
function readable(key){return key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,s=>s.toUpperCase());}

async function detect(){
  try{
    const result=await request('ping',{},1800);
    installed=!!result.installed;
    $('extension-status').textContent=`ESPN Connect ${result.version} is installed. Sign into ESPN in this browser to begin.`;
    $('connection-label').textContent='Ready to connect';
    $('install').open=false;
  }catch{
    installed=false;$('extension-status').textContent='Install the test extension below, then refresh this page.';
    $('connection-label').textContent='Extension needed';$('install').open=true;
  }
  if(installed)try{await loadLeagues();}catch(error){showError(error);}
}

async function loadLeagues(){
  const result=await request('leagues');
  const list=result.leagues || [];
  $('league-select').replaceChildren();
  for(const l of list){const option=element('option',`${l.summary.name} · ${l.season}`);option.value=`${l.league_id}:${l.season}`;$('league-select').append(option);}
  if(!list.length){snapshot=null;$('workspace').hidden=true;$('setup').hidden=false;$('connection-label').textContent='Ready to connect';$('connection-dot').className='status-dot';return;}
  const preferred=result.selectedLeague?`${result.selectedLeague.leagueId}:${result.selectedLeague.season}`:null;
  if(preferred && list.some(l=>`${l.league_id}:${l.season}`===preferred))$('league-select').value=preferred;
  await loadSnapshot();
}
function identity(){const [leagueId,season]=$('league-select').value.split(':').map(Number);return {leagueId,season};}
async function loadSnapshot(){const result=await request('snapshot',identity());render(result.snapshot,result.status);if(result.lastError)notice(result.lastError.message,true);else if(Date.now()-Date.parse(result.snapshot.importedAt)<=60*60000)notice('');}

function render(data,status='connected'){
  snapshot=data;availableLimit=100;
  $('setup').hidden=true;$('workspace').hidden=false;
  $('league-name').textContent=data.name;$('league-season').textContent=`ESPN FOOTBALL / ${data.season}`;
  const stale=Date.now()-Date.parse(data.importedAt)>60*60000;
  const needsAttention=status!=='connected'||!data.coverage.availablePlayers||stale;
  $('connection-label').textContent=needsAttention?'Import needs attention':'Connected to ESPN';
  $('connection-dot').className='status-dot '+(needsAttention?'warning':'connected');
  $('sync-time').textContent=`Last successful import: ${new Date(data.importedAt).toLocaleString()} · Automatic refresh approximately every 20 minutes`;
  $('metric-teams').textContent=data.teamCount;$('metric-rostered').textContent=data.teams.reduce((n,t)=>n+t.roster.length,0);$('metric-available').textContent=data.availablePlayers.length;$('metric-week').textContent=data.week ?? '—';
  const checks=[['Scoring and roster rules',data.coverage.settings],['Every team’s roster',data.coverage.rosters],['League schedule',data.coverage.schedule],['Available-player pool',data.coverage.availablePlayers],['Draft and keeper data',data.coverage.draft]];
  $('coverage').replaceChildren(...checks.map(([label,ok])=>{const row=element('div',undefined,'coverage-row');row.append(element('span',label),badge(ok?'Imported':'Needs review',!ok));return row;}));
  $('warnings').replaceChildren();
  if(data.warnings.length){const list=element('ul',undefined,'warnings');for(const warning of data.warnings)list.append(element('li',warning));$('warnings').append(list);}
  if(stale)notice('This import is over an hour old. Refresh ESPN to check the latest rosters and availability.');
  $('my-team').replaceChildren();
  for(const team of data.teams){const o=element('option',team.name);o.value=team.id;$('my-team').append(o);}
  const key=`sdn-espn-team:${data.leagueId}:${data.season}`;
  let saved;try{saved=localStorage.getItem(key);}catch{}
  const chosen=data.teams.find(t=>String(t.id)===saved)?.id ?? data.myTeamIds?.[0];
  if(chosen)$('my-team').value=chosen;
  $('scoring-table').replaceChildren(table(['Category','Points'],data.rules.scoringItems.filter(s=>s.points!==0).map(s=>[s.label,n(s.points)])));
  $('slots-table').replaceChildren(table(['Slot','Count'],data.rules.lineupSlots.map(s=>[s.name,s.count])));
  $('rule-details').replaceChildren();
  for(const [name,values] of [['Roster limits',data.rules.roster],['Acquisitions and waivers',data.rules.acquisition],['Trades',data.rules.trade],['Playoffs and matchup periods',data.rules.schedule],['Draft and keeper settings',data.rules.draft],['Original scoring parameters',data.rules.scoring]]){
    const d=element('details',undefined,'rule-detail');d.append(element('summary',name));const dl=element('dl');for(const [key,value]of Object.entries(values)){dl.append(element('dt',readable(key)),element('dd',typeof value==='object'?JSON.stringify(value):String(value)));}d.append(dl);$('rule-details').append(d);
  }
  renderRosters();
  const prior=$('position-filter').value;$('position-filter').replaceChildren(new Option('All positions',''));
  for(const position of [...new Set(data.availablePlayers.map(p=>p.position))].sort())$('position-filter').append(new Option(position,position));
  if([...$('position-filter').options].some(o=>o.value===prior))$('position-filter').value=prior;
  renderAvailable();renderSchedule();tradeTool.update(data,Number($('my-team').value));
}

function renderRosters(){
  if(!snapshot)return;
  const query=$('roster-search').value.toLowerCase().trim();
  $('rosters').replaceChildren();
  for(const team of snapshot.teams){
    const players=team.roster.filter(p=>!query || `${p.name} ${team.name}`.toLowerCase().includes(query));
    if(query&&!players.length)continue;
    const d=element('details',undefined,'team-roster');if(query)d.open=true;
    const s=element('summary'),wrap=element('span'),r=team.record?.overall;
    wrap.append(element('strong',team.name),element('small',`${r?`${r.wins}–${r.losses}${r.ties?`–${r.ties}`:''} · `:''}${team.roster.length} players`));s.append(wrap);d.append(s);
    const scroll=element('div',undefined,'table-scroll');scroll.append(table(['Slot','Player','Position','NFL','Injury status',`Week ${snapshot.week} proj.`,'Remaining proj.','Original auction'],players.map(p=>[p.lineupSlot || '—',p.name,p.position,p.nflTeam,p.injuryStatus,n(weeklyPoints(p)),n(stat(p,1,0)?.points),auctionPrice(p)===null?'Not returned':`$${n(auctionPrice(p))}`])));d.append(scroll);$('rosters').append(d);
  }
}
function renderAvailable(){
  if(!snapshot)return;
  const search=$('available-search').value.toLowerCase().trim(),position=$('position-filter').value,status=$('availability-filter').value;
  const players=snapshot.availablePlayers.filter(p=>(!search||p.name.toLowerCase().includes(search))&&(!position||p.position===position)&&(!status||p.availability===status)).sort((a,b)=>(weeklyPoints(b)??-Infinity)-(weeklyPoints(a)??-Infinity)||(b.percentOwned??0)-(a.percentOwned??0));
  $('available-coverage').textContent=snapshot.coverage.availablePlayers?'All pages returned by ESPN were imported. Players on waivers are labeled separately.':'ESPN returned a partial pool. Refresh the import before using these players as replacement options.';
  $('available-count').textContent=`Showing ${Math.min(availableLimit,players.length)} of ${players.length} matching players`;
  $('available-table').replaceChildren(table(['Player','Position','NFL','Availability','Injury status',`Week ${snapshot.week} proj.`,'Remaining proj.'],players.slice(0,availableLimit).map(p=>[p.name,p.position,p.nflTeam,p.availability==='WAIVERS'?'Waivers':'Free agent',p.injuryStatus,n(weeklyPoints(p)),n(stat(p,1,0)?.points)])));
  $('more-available').hidden=players.length<=availableLimit;
}
function renderSchedule(){
  const names=new Map(snapshot.teams.map(t=>[t.id,t.name]));
  const periods=snapshot.rules.schedule.matchupPeriods || {};
  const rows=snapshot.schedule.map(m=>{
    const weeks=periods[m.matchupPeriodId];
    const label=Array.isArray(weeks)?`Week${weeks.length>1?'s':''} ${weeks.join(', ')}`:`Matchup ${m.matchupPeriodId}`;
    const score=m.winner&&m.winner!=='UNDECIDED'?`${n(m.away?.totalPoints)} – ${n(m.home?.totalPoints)}`:'Upcoming / in progress';
    return [label,names.get(m.away?.teamId)||'Bye / TBD',names.get(m.home?.teamId)||'Bye / TBD',score];
  });
  $('schedule-table').replaceChildren(table(['Scoring period','Away','Home','Result'],rows));
}

async function openConnect(){
  if(!installed){$('install').open=true;$('install').scrollIntoView({behavior:'smooth',block:'center'});return;}
  try{await request('open',snapshot?{leagueId:snapshot.leagueId,season:snapshot.season}:{leagueId:270405,season:new Date().getFullYear()});}catch(error){showError(error);}
}
$('connect').addEventListener('click',openConnect);$('add-league').addEventListener('click',openConnect);
$('league-select').addEventListener('change',()=>loadSnapshot().catch(showError));
$('refresh').addEventListener('click',async()=>{
  if(busy)return;busy=true;$('refresh').disabled=true;$('refresh').textContent='Refreshing…';notice('Checking ESPN’s settings, rosters, and available players.');
  try{const result=await request('refresh',identity());render(result.snapshot);notice(result.cached?'Your most recent import is already current.':'ESPN import refreshed.');}catch(error){showError(error);}finally{busy=false;$('refresh').disabled=false;$('refresh').textContent='Refresh ESPN';}
});
$('my-team').addEventListener('change',()=>{saveTeam(Number($('my-team').value));tradeTool.selectTeam(Number($('my-team').value));});
$('roster-search').addEventListener('input',renderRosters);
for(const id of ['available-search','position-filter','availability-filter'])$(id).addEventListener(id.endsWith('search')?'input':'change',()=>{availableLimit=100;renderAvailable();});
$('more-available').addEventListener('click',()=>{availableLimit+=100;renderAvailable();});
$('copy-extensions').addEventListener('click',async()=>{try{await navigator.clipboard.writeText('chrome://extensions');$('copy-extensions').textContent='Copied';}catch{$('copy-extensions').textContent='Type chrome://extensions in your address bar';}});
$('export').addEventListener('click',()=>{if(!snapshot)return;const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=element('a');a.href=url;a.download=`espn-${snapshot.leagueId}-${snapshot.season}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('disconnect').addEventListener('click',async()=>{if(busy)return;busy=true;$('disconnect').disabled=true;try{await request('disconnect');await loadLeagues();notice('The saved ESPN session and this browser’s imported leagues have been deleted.');}catch(error){showError(error);}finally{busy=false;$('disconnect').disabled=false;}});
const tabs=[...document.querySelectorAll('[role=tab]')];
function showTab(tab){for(const t of tabs){const selected=t===tab;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;$(t.getAttribute('aria-controls')).hidden=!selected;}}
for(const tab of tabs){tab.addEventListener('click',()=>showTab(tab));tab.addEventListener('keydown',event=>{const index=tabs.indexOf(tab);if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;showTab(tabs[next]);tabs[next].focus();});}
document.addEventListener('sdn-show-tab',event=>{const tab=tabs.find(t=>t.dataset.tab===event.detail);if(tab){showTab(tab);tab.focus();}});
detect();
