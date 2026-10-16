import { allPlayers,auctionPrice,leagueDefaults,keeperCost,marketEstimates,analyzeTrade,projection,stat,finite,finalWeek,starterSlots } from './lib/trade.mjs?v=2';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const number=v=>finite(v)?v.toLocaleString(undefined,{maximumFractionDigits:1}):'N/A';
const money=v=>finite(v)?`$${v.toFixed(v%1?1:0)}`:'Not supplied';
const signed=v=>finite(v)?`${v>0?'+':''}${number(v)}`:'Incomplete';
function table(heads,rows){const t=el('table'),h=el('tr');for(const heading of heads)h.append(el('th',heading));const head=el('thead');head.append(h);t.append(head);const body=el('tbody');for(const row of rows){const tr=el('tr');for(const value of row){const cell=el('td');if(value instanceof Node)cell.append(value);else cell.textContent=value ?? 'N/A';tr.append(cell);}body.append(tr);}t.append(body);return t;}
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key)) || fallback;}catch{return fallback;}}
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}

export function createTradeTool({onTeamChange=()=>{}}={}){
  let data=null,settings={},overrides={},market=new Map(),offer={teamA:null,teamB:null,sendA:[],sendB:[]},lastResult=null,running=false;
  const key=()=>`sdn-trade:${data.leagueId}:${data.season}`;
  function persist(){write(key(),{settings,overrides});}
  function showTab(name){document.dispatchEvent(new CustomEvent('sdn-show-tab',{detail:name}));}
  function error(message){$('trade-error').textContent=message || '';$('trade-error').hidden=!message;$('trade-error').className='notice error';}
  function team(id){return data?.teams.find(t=>t.id===Number(id));}
  function cost(p){return settings.format==='dynasty'?{eligible:overrides[p.id]?.eligible!==false,cost:0}:keeperCost(p,settings,overrides);}
  function profile(p){const current=projection(data,p,data.week,overrides);return {weekly:current,ros:overrides[p.id]?.ros ?? stat(p,1,0,0)?.points,cost:cost(p)};}

  function refreshSettings(){
    $('league-format').value=settings.format;$('keeper-count').value=settings.keeperCount;$('keeper-count-wrap').hidden=settings.format!=='keeper';
    $('imported-draft-meta').textContent=`ESPN: ${data.rules.draft.keeperCountFuture ?? data.rules.draft.keeperCount ?? 0} keeper slots · ${money(data.rules.draft.auctionBudget)} auction budget`;
    $('keeper-budget').value=settings.budget;$('keeper-increase-type').value=settings.increaseType;$('keeper-increase').value=settings.increase;
    $('keeper-increase-wrap').hidden=!['fixed','percent'].includes(settings.increaseType);$('keeper-waiver-cost').value=settings.waiverCost ?? '';
    $('keeper-trade-rule').value=settings.tradedKeeperRule;$('keeper-min-bid').value=settings.minBid;
    $('keeper-settings-status').textContent=settings.format==='redraft'?'Redraft selected. Keeper costs do not affect this trade comparison.':settings.format==='dynasty'?'Dynasty selected. All eligible retained assets are compared using editable planning values.':settings.increaseType==='unconfirmed'||settings.tradedKeeperRule==='unconfirmed'?'Set annual cost changes and traded-player eligibility to complete the keeper comparison.':'Keeper rules saved for analysis. Missing player costs are flagged individually.';
    market=marketEstimates(data,settings,overrides);renderPlayers();renderAuction();if(lastResult)run(false);
  }
  function updateSettings(){
    if(!data)return;
    const n=(id,fallback)=>{const x=Number($(id).value);return Number.isFinite(x)?x:fallback;};
    settings={format:$('league-format').value,keeperCount:Math.max(0,Math.min(40,Math.trunc(n('keeper-count',0)))),budget:Math.max(1,n('keeper-budget',205)),increaseType:$('keeper-increase-type').value,increase:Math.max(0,n('keeper-increase',0)),waiverCost:$('keeper-waiver-cost').value===''?null:Math.max(0,n('keeper-waiver-cost',0)),tradedKeeperRule:$('keeper-trade-rule').value,minBid:Math.max(0,n('keeper-min-bid',1))};
    persist();refreshSettings();
  }
  for(const id of ['league-format','keeper-count','keeper-budget','keeper-increase-type','keeper-increase','keeper-waiver-cost','keeper-trade-rule','keeper-min-bid'])$(id).addEventListener('change',updateSettings);
  $('keeper-rule-shortcut').addEventListener('click',()=>showTab('keepers'));
  $('reset-keeper-settings').addEventListener('click',()=>{settings=leagueDefaults(data);persist();refreshSettings();});

  function renderPlayers(){
    for(const side of ['a','b']){
      const selected=side==='a'?offer.sendA:offer.sendB,roster=team(side==='a'?offer.teamA:offer.teamB)?.roster || [],query=$(`trade-search-${side}`).value.toLowerCase();
      const sorted=roster.slice().sort((a,b)=>(profile(b).ros??0)-(profile(a).ros??0));
      const nodes=[];
      for(const p of sorted){if(query&&!`${p.name} ${p.position}`.toLowerCase().includes(query))continue;
        const row=el('div',undefined,'trade-player'+(selected.includes(p.id)?' selected':''));
        const label=el('label',undefined,'player-pick'),check=el('input');check.type='checkbox';check.checked=selected.includes(p.id);check.dataset.playerId=p.id;check.dataset.side=side;check.setAttribute('aria-label',`Trade ${p.name}`);
        const name=el('span');name.append(el('strong',p.name),el('small',`${p.position} · ${p.nflTeam} · ${p.injuryStatus}`));label.append(check,name);row.append(label);
        const info=profile(p),metrics=el('div',undefined,'player-trade-metrics');
        for(const [title,value]of [[`W${data.week}`,number(info.weekly)],['ROS',number(info.ros)],['Auction paid',money(auctionPrice(p))],['Next keeper',settings.format==='redraft'?'—':info.cost.eligible?finite(info.cost.cost)?money(info.cost.cost):'Set rules':'Ineligible']]){const span=el('span');span.append(el('small',title),el('b',value));metrics.append(span);}row.append(metrics);nodes.push(row);
      }
      $(`trade-players-${side}`).replaceChildren(...nodes);
      const chosen=roster.filter(p=>selected.includes(p.id)),known=chosen.filter(p=>auctionPrice(p)!==null);
      $(`trade-summary-${side}`).textContent=`${chosen.length} selected · ${money(known.reduce((n,p)=>n+auctionPrice(p),0))} original auction cost${known.length<chosen.length?` + ${chosen.length-known.length} unpriced`:''}`;
    }
  }
  for(const side of ['a','b']){
    $(`trade-search-${side}`).addEventListener('input',renderPlayers);
    $(`trade-players-${side}`).addEventListener('change',event=>{const input=event.target;if(input.type!=='checkbox')return;const list=side==='a'?offer.sendA:offer.sendB,id=Number(input.dataset.playerId);if(input.checked&&!list.includes(id))list.push(id);else if(!input.checked)list.splice(list.indexOf(id),1);renderPlayers();lastResult=null;$('trade-results').replaceChildren();error('');});
    $(`trade-team-${side}`).addEventListener('change',()=>{offer[side==='a'?'teamA':'teamB']=Number($(`trade-team-${side}`).value);offer[side==='a'?'sendA':'sendB']=[];if(side==='a')onTeamChange(offer.teamA);lastResult=null;$('trade-results').replaceChildren();renderPlayers();});
  }

  function updateHorizon(){
    if(!data)return;
    const choice=$('trade-horizon').value,regular=data.rules.schedule.matchupPeriodCount || 13,periods=data.rules.schedule.matchupPeriods || {};
    if(choice!=='custom'){
      const regularEnd=Math.max(...Object.entries(periods).filter(([id])=>Number(id)<=regular).flatMap(([,weeks])=>weeks),data.week);
      const playoffStart=Math.min(...Object.entries(periods).filter(([id])=>Number(id)>regular).flatMap(([,weeks])=>weeks),finalWeek(data));
      $('trade-start').value=choice==='playoffs'?Math.max(data.week,playoffStart):data.week;
      $('trade-end').value=choice==='week'?data.week:choice==='regular'?regularEnd:finalWeek(data);
    }
    lastResult=null;$('trade-results').replaceChildren();
  }
  $('trade-horizon').addEventListener('change',updateHorizon);
  function clearResult(){lastResult=null;$('trade-results').replaceChildren();error('');}
  for(const id of ['trade-start','trade-end'])$(id).addEventListener('change',()=>{$('trade-horizon').value='custom';clearResult();});
  for(const id of ['trade-waivers','trade-claims','trade-stress'])$(id).addEventListener('change',clearResult);
  $('clear-trade').addEventListener('click',()=>{offer.sendA=[];offer.sendB=[];lastResult=null;renderPlayers();$('trade-results').replaceChildren();error('');});

  function input(value,field,id,{min=0,max,step=1,placeholder=''}={}){
    const node=el('input');node.type='number';node.min=min;if(max!==undefined)node.max=max;node.step=step;node.value=finite(value)?value:'';node.placeholder=placeholder;node.dataset.field=field;node.dataset.playerId=id;node.setAttribute('aria-label',`${field} for ${allPlayers(data).find(p=>p.id===id)?.name || 'player'}`);return node;
  }
  function renderAuction(){
    if(!data)return;
    const owner=Number($('auction-team').value),q=$('auction-search').value.toLowerCase();
    const ownerNames=new Map(data.teams.map(t=>[t.id,t.name])),owners=new Map(data.teams.flatMap(t=>t.roster.map(p=>[p.id,t.id])));
    let players=owner?team(owner)?.roster || []:data.teams.flatMap(t=>t.roster);
    players=players.filter(p=>!q||p.name.toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
    const rows=players.map(p=>{
      const o=overrides[p.id] || {},check=el('input');check.type='checkbox';check.checked=o.eligible!==false;check.dataset.playerId=p.id;check.dataset.field='eligible';check.setAttribute('aria-label',`Keeper eligible: ${p.name}`);
      const keeper=cost(p),value=input(o.marketValue,'marketValue',p.id,{placeholder:`Est. ${Math.round(market.get(p.id)||1)}`});
      return [p.name,ownerNames.get(owners.get(p.id)) || 'Available',money(auctionPrice(p)),p.draft?.keeper?'Yes':'No',keeper.eligible?money(keeper.cost):'Ineligible',input(o.nextCost,'nextCost',p.id,{placeholder:'Use league rule'}),value,input(o.returnWeek,'returnWeek',p.id,{min:data.week,max:18,placeholder:'ESPN outlook'}),input(o.ros,'ros',p.id,{min:-1000,step:.1,placeholder:number(stat(p,1,0,0)?.points)}),check];
    });
    $('auction-table').replaceChildren(table(['Player','Current team','Original auction','Keeper at draft','Next keeper cost','Override next cost ($)','Market plan ($)','Available from week','Override ROS pts','Eligible'],rows));
    const all=data.teams.flatMap(t=>t.roster),priced=all.filter(p=>auctionPrice(p)!==null);
    $('auction-coverage').textContent=`${priced.length} of ${all.length} rostered players have an original auction price in the import. Waiver pickups can have a different keeper cost. Blank overrides use the current league rule or projection.`;
    const map=new Map(allPlayers(data).map(p=>[p.id,p]));
    const picks=data.draftResults?.length?data.draftResults:[...new Map(allPlayers(data).filter(p=>p.draft).map(p=>[p.id,{playerId:p.id,teamId:p.draft.teamId,auctionPrice:p.draft.auctionPrice,keeper:p.draft.keeper}])).values()];
    $('draft-results-table').replaceChildren(table(['Player','Drafting team','Auction paid','Keeper'],picks.map(p=>[map.get(p.playerId)?.name || `ESPN player ${p.playerId}`,ownerNames.get(p.teamId)||`Team ${p.teamId}`,money(p.auctionPrice),p.keeper?'Yes':'No'])));
  }
  $('auction-team').addEventListener('change',renderAuction);$('auction-search').addEventListener('input',renderAuction);
  $('auction-table').addEventListener('change',event=>{
    const target=event.target,field=target.dataset.field,id=Number(target.dataset.playerId);if(!field||!Number.isSafeInteger(id))return;
    overrides[id] ||= {};
    if(field==='eligible')overrides[id][field]=target.checked;
    else if(target.value==='')delete overrides[id][field];
    else{const value=Number(target.value);if(!finite(value)||!target.checkValidity()){target.reportValidity();return;}overrides[id][field]=value;}
    persist();market=marketEstimates(data,settings,overrides);renderPlayers();renderAuction();if(lastResult)run(false);
  });

  function renderResults(result){
    const root=$('trade-results');root.replaceChildren();const header=el('div',undefined,'trade-verdict');header.append(el('p',`WEEKS ${result.weeks[0]}–${result.weeks.at(-1)} · ${settings.format.toUpperCase()}`,'eyebrow'),el('h3',result.verdict));root.append(header);
    const cards=el('div',undefined,'trade-result-grid');
    result.teams.forEach((side,i)=>{
      const card=el('section',undefined,'trade-result-card');card.append(el('h3',side.team.name));const score=el('p',signed(side.delta),'trade-delta '+(side.delta>0?'positive':side.delta<0?'negative':''));score.append(el('small','projected starter points'));card.append(score,el('p',`${signed(side.weeklyDelta)} per week · ${number(side.before.total)} before → ${number(side.after.total)} after`,'fine'));
      card.append(el('p',`Projection stress test: ${signed(side.sensitivity.low)} to ${signed(side.sensitivity.high)} starter points`,'range-note'));
      if(settings.format!=='redraft')card.append(el('p',finite(side.keeperDelta)?`Keeper portfolio surplus: ${signed(side.keeperDelta)} dollars`:'Keeper comparison needs cost rules or player cost overrides.','keeper-result'));
      const received=result.outgoing[1-i];const starts=received.map(p=>`${p.name}: ${side.after.weekly.filter(w=>w.lineup.some(x=>x.player?.id===p.id)).length} projected starts`);card.append(el('p',starts.join(' · '),'fine'));
      const moves=el('div',undefined,'trade-moves');for(const [label,list]of [['Before: best available moves',side.movesBefore],['After: required / suggested moves',side.movesAfter]]){moves.append(el('h4',label));moves.append(el('p',list.length?list.map(m=>`${m.type==='add'?'Add':'Drop'} ${m.player.name}${m.player.availability==='WAIVERS'?' (waiver claim)':''} · ${m.reason}`).join('; '):'No add/drop changes.','fine'));}card.append(moves);cards.append(card);
    });root.append(cards);
    const assumptions=el('div',undefined,'model-note');assumptions.append(el('h4','How to read this comparison'));
    const notes=el('ul');for(const warning of result.warnings)notes.append(el('li',warning));notes.append(el('li',`The ±${result.teams[0].sensitivity.percent}% range changes traded players’ projections in both the before and after rosters. It is a sensitivity test, not a probability interval.`),el('li','ESPN is the connected projection source. Original auction dollars do not count as fantasy points.'));assumptions.append(notes);root.append(assumptions);
    const weekly=el('section',undefined,'result-weekly');weekly.append(el('h3','Where the points change'));
    const rows=result.weeks.map((week,j)=>[week,...result.teams.flatMap(t=>[number(t.before.weekly[j].total),number(t.after.weekly[j].total),signed(t.after.weekly[j].total-t.before.weekly[j].total)])]);
    const wrap=el('div',undefined,'table-scroll');wrap.append(table(['Week',`${result.teams[0].team.name}: before`,'After','Change',`${result.teams[1].team.name}: before`,'After','Change'],rows));weekly.append(wrap);root.append(weekly);
    const lineups=el('section',undefined,'result-weekly');lineups.append(el('h3','Starting lineups before and after'));
    const controls=el('div',undefined,'lineup-controls'),chooseTeam=el('select'),chooseWeek=el('select');chooseTeam.setAttribute('aria-label','Team for lineup comparison');chooseWeek.setAttribute('aria-label','Week for lineup comparison');
    result.teams.forEach((s,i)=>chooseTeam.append(new Option(s.team.name,i)));result.weeks.forEach(w=>chooseWeek.append(new Option(`Week ${w}`,w)));controls.append(chooseTeam,chooseWeek);lineups.append(controls);const view=el('div',undefined,'table-scroll');lineups.append(view);
    function draw(){const side=result.teams[Number(chooseTeam.value)],week=Number(chooseWeek.value),before=side.before.weekly.find(w=>w.week===week),after=side.after.weekly.find(w=>w.week===week);const a=new Map(before.lineup.map(x=>[x.key,x])),b=new Map(after.lineup.map(x=>[x.key,x]));view.replaceChildren(table(['Slot','Before','Points','After','Points','Change'],starterSlots(data).map(slot=>{const x=a.get(slot.key),y=b.get(slot.key);return [slot.name,x?.player?.name || 'Unfilled',number(x?.points),y?.player?.name || 'Unfilled',number(y?.points),signed((y?.points||0)-(x?.points||0))];})));}
    chooseTeam.addEventListener('change',draw);chooseWeek.addEventListener('change',draw);draw();root.append(lineups);
    if(settings.format!=='redraft'){
      const section=el('section',undefined,'result-weekly');section.append(el('h3','Keeper portfolios'),el('p','These are the best eligible combinations under your keeper limit and budget. Planning values are editable estimates; unknown costs keep the overall keeper verdict incomplete.','fine'));
      for(const side of result.teams)for(const [label,portfolio]of [['Before',side.keeperBefore],['After',side.keeperAfter]]){const d=el('details',undefined,'rule-detail');d.append(el('summary',`${side.team.name} · ${label} · ${portfolio.players.length} keepers${portfolio.unknown.length?` · ${portfolio.unknown.length} unpriced`:''}`));d.append(table(['Player','Keeper cost','Planning value','Surplus'],portfolio.players.map(p=>[p.player.name,money(p.cost),money(p.marketValue),money(p.surplus)])));section.append(d);}root.append(section);
    }
  }
  async function run(scroll=true){
    if(running||!data)return;
    for(const id of ['trade-start','trade-end'])if(!$(id).checkValidity()){$(id).reportValidity();return;}
    running=true;$('analyze-trade').disabled=true;$('analyze-trade').textContent='Comparing lineups…';error('');
    await new Promise(resolve=>setTimeout(resolve,30));
    try{const result=analyzeTrade(data,offer,settings,overrides,{startWeek:Number($('trade-start').value),endWeek:Number($('trade-end').value),optimizeWaivers:$('trade-waivers').checked,includeWaivers:$('trade-claims').checked,stress:Number($('trade-stress').value)});lastResult=result;renderResults(result);if(scroll)$('trade-results').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){error(e.message);}finally{running=false;$('analyze-trade').disabled=false;$('analyze-trade').replaceChildren(document.createTextNode('Analyze trade '),el('span','↗'));}
  }
  $('analyze-trade').addEventListener('click',()=>run());

  return {
    update(snapshot,selectedTeam){
      const previous=data?`${data.leagueId}:${data.season}`:null;data=snapshot;
      const saved=read(key(),{});settings={...leagueDefaults(data),...saved.settings};overrides=saved.overrides || {};
      if(previous!==`${data.leagueId}:${data.season}`){offer={teamA:Number(selectedTeam || data.myTeamIds?.[0] || data.teams[0].id),teamB:data.teams.find(t=>t.id!==Number(selectedTeam || data.myTeamIds?.[0] || data.teams[0].id))?.id,sendA:[],sendB:[]};lastResult=null;$('trade-results').replaceChildren();}
      for(const [id,selected]of [['trade-team-a',offer.teamA],['trade-team-b',offer.teamB],['auction-team',Number(selectedTeam || offer.teamA)]]){const select=$(id);select.replaceChildren();if(id==='auction-team')select.append(new Option('All rosters',0));for(const team of data.teams)select.append(new Option(team.name,team.id));select.value=String(selected);}
      offer.sendA=offer.sendA.filter(id=>team(offer.teamA)?.roster.some(p=>p.id===id));offer.sendB=offer.sendB.filter(id=>team(offer.teamB)?.roster.some(p=>p.id===id));
      $('trade-start').min=data.week;$('trade-start').max=finalWeek(data);$('trade-end').min=data.week;$('trade-end').max=finalWeek(data);
      updateHorizon();refreshSettings();
      const rosters=data.teams.flatMap(t=>t.roster),withRos=rosters.filter(p=>finite(stat(p,1,0,0)?.points)),free=data.availablePlayers.filter(p=>p.availability==='FREEAGENT').length;$('trade-projection-source').textContent=`ESPN: ${withRos.length}/${rosters.length} rostered players with ROS forecasts · ${free} immediate free agents · ${data.availablePlayers.length-free} on waivers · ${data.nflSchedule?'NFL byes imported':'Refresh ESPN to load NFL byes'}`;
    },
    selectTeam(id){if(!data)return;offer.teamA=id;offer.sendA=[];$('trade-team-a').value=id;renderPlayers();lastResult=null;$('trade-results').replaceChildren();},
  };
}
