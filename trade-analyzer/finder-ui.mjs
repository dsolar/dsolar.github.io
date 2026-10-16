import {finalWeek} from './lib/trade.mjs?v=3';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const points=v=>`${v>0?'+':''}${v.toLocaleString(undefined,{maximumFractionDigits:2})}`;
function compactSnapshot(s){
  const compact=p=>({...p,stats:(p.stats||[]).filter(st=>st.splitTypeId===0||st.splitTypeId===1&&st.week===s.week).map(st=>({...st,stats:{210:st.stats?.['210']}}))});
  return {...s,teams:s.teams.map(t=>({...t,roster:t.roster.map(compact)})),availablePlayers:s.availablePlayers.map(compact)};
}
export function createTradeFinder({getState,onTeamChange,onOffer}){
  let worker=null,suggestions=[],generation=0;
  function status(message,error=false){$('finder-status').textContent=message;$('finder-status').hidden=!message;$('finder-status').className='notice'+(error?' error':'');}
  function stop(){if(worker)worker.terminate();worker=null;generation++;$('find-trades').disabled=false;$('stop-finder').hidden=true;$('finder-progress').hidden=true;}
  function invalidate(){stop();suggestions=[];$('finder-results').replaceChildren();status('');}
  function assumptions(){const {snapshot,settings}=getState();$('finder-keeper-wrap').hidden=settings.format==='redraft';const free=snapshot.availablePlayers.filter(p=>p.availability==='FREEAGENT').length;$('finder-assumptions').textContent=(settings.format==='redraft'?'Both teams must gain starting points.':'Both teams must gain starting points. Keeper surplus is separate; incomplete costs are flagged.')+` ${free} immediate free agents · ${snapshot.availablePlayers.length-free} on waivers.`;}
  function horizon(){
    const {snapshot:s}=getState();if(!s)return;
    const choice=$('finder-horizon').value,regular=s.rules.schedule.matchupPeriodCount||13,periods=s.rules.schedule.matchupPeriods||{};
    const regularEnd=Math.max(regular,...Object.entries(periods).filter(([id])=>Number(id)<=regular).flatMap(([,weeks])=>weeks));
    const playoffStart=Math.min(finalWeek(s),...Object.entries(periods).filter(([id])=>Number(id)>regular).flatMap(([,weeks])=>weeks));
    if(choice!=='custom'){$('finder-start').value=choice==='next'?s.week+1:choice==='playoffs'?Math.max(s.week,playoffStart):s.week;$('finder-end').value=choice==='week'?s.week:choice==='regular'?regularEnd:finalWeek(s);}
    invalidate();
  }
  function update(snapshot,teamId){
    const partner=$('finder-partner').value;
    for(const id of ['finder-team','finder-partner']){const select=$(id);select.replaceChildren();if(id==='finder-partner')select.append(new Option('Entire league',0));for(const t of snapshot.teams)if(id==='finder-team'||t.id!==teamId)select.append(new Option(t.name,t.id));}
    $('finder-team').value=String(teamId);$('finder-partner').value=[...$('finder-partner').options].some(o=>o.value===partner)?partner:'0';
    for(const id of ['finder-start','finder-end']){$(id).min=snapshot.week;$(id).max=finalWeek(snapshot);}
    horizon();assumptions();
  }
  function progress(p){
    $('finder-progress-bar').value=p.stage==='screening'?Math.round(10+50*p.completed/Math.max(1,p.total)):p.stage==='verifying'?Math.round(60+40*p.completed/Math.max(1,p.total)):100;
    $('finder-progress-label').textContent=p.stage==='screening'?`Checking roster fits with ${p.partner} · ${p.screened.toLocaleString()} offers screened`:p.stage==='verifying'?`Verifying starting lineups, replacements and keeper costs · ${p.completed} of ${p.total} shortlisted offers`:'Search complete';
  }
  function render(result){
    suggestions=result.suggestions;$('finder-results').replaceChildren();
    const root=$('finder-results');
    const info=el('div',undefined,'finder-summary');info.append(el('h3',suggestions.length?`${suggestions.length} offers improve both starting lineups.`:'No offers met all your filters.'),el('p',`Weeks ${result.weeks[0]}–${result.weeks.at(-1)} · ${result.screened.toLocaleString()} offers screened · ${result.verified} fully verified · minimum +${result.minimum} points per week each`,'fine'));root.append(info);
    if(!suggestions.length){const p=el('p','Try a lower minimum gain, a wider balance setting, or a different week range. No suggestion means the screened offers did not meet these filters.','finder-empty');root.append(p);}
    if(result.keeperRejected)root.append(el('p',`${result.keeperRejected} offers were excluded because keeper costs were incomplete or a team lost keeper surplus. Review Keeper rules and player values, or turn off that filter.`,'notice'));
    const notes=[];if(result.lockedExcluded)notes.push(`${result.lockedExcluded} players excluded because their games have started.`);if(result.missingExcluded)notes.push(`${result.missingExcluded} players excluded for missing projections.`);if(notes.length)root.append(el('p',notes.join(' '),'fine'));
    const cards=el('div',undefined,'finder-result-grid');
    suggestions.forEach((suggestion,index)=>{
      const card=el('article',undefined,'finder-card');card.append(el('p',`${suggestion.offer.sendA.length} FOR ${suggestion.offer.sendB.length} · ${suggestion.gains[1].name}`,'eyebrow'));
      const exchange=el('div',undefined,'finder-exchange');for(const [label,players]of [['You send',suggestion.players[0]],['You receive',suggestion.players[1]]]){const col=el('div');col.append(el('small',label));for(const player of players)col.append(el('p',`${player.name} · ${player.position}`));exchange.append(col);}card.append(exchange);
      const gains=el('div',undefined,'finder-gains');for(const [i,gain]of suggestion.gains.entries()){
        const side=el('div');side.append(el('small',i===0?'Your lineup':gain.name),el('strong',`${points(gain.weeklyDelta)} / week`),el('span',`${points(gain.delta)} starter points total`));gains.append(side);
      }card.append(gains);
      const positions=el('p',undefined,'fine');positions.textContent=suggestion.gains.map((gain,i)=>`${i===0?'Your fit':'Their fit'}: ${gain.positions.length?gain.positions.map(p=>`${p.name} ${points(p.points)} / week`).join(', '):'weekly lineup depth'}`).join(' · ');card.append(positions);
      const {settings}=getState();
      if(settings.format!=='redraft'){
        const incomplete=suggestion.gains.some(g=>g.keeperIncomplete);
        card.append(el('p',incomplete?'Keeper costs incomplete. Review house rules before judging long-term fairness.':`Keeper surplus: you ${points(suggestion.gains[0].keeperDelta)} dollars · partner ${points(suggestion.gains[1].keeperDelta)} dollars`,'finder-keeper'+(incomplete?' incomplete':'')));
      }
      const moves=suggestion.gains.flatMap((g,i)=>g.moves.map(m=>`${i===0?'You':'Partner'}: ${m.type==='add'?'add':'drop'} ${m.name}${m.waiver?' (claim assumed)':''}`));if(moves.length)card.append(el('p',moves.join(' · '),'fine finder-moves'));
      const check=el('button','Analyze this trade ↗','secondary');check.dataset.suggestion=String(index);card.append(check);cards.append(card);
    });root.append(cards);
    if(suggestions.length)root.append(el('p','These are projected lineup gains, not a guarantee of fair keeper value or manager acceptance. Open an offer to review weekly lineups, stress tests and assumptions.','fine'));
  }
  async function search(){
    const {snapshot,settings,overrides,stress}=getState();if(!snapshot)return;
    for(const id of ['finder-start','finder-end'])if(!$(id).checkValidity()){$(id).reportValidity();return;}
    invalidate();const id=generation;
    const options={startWeek:Number($('finder-start').value),endWeek:Number($('finder-end').value),partnerId:Number($('finder-partner').value),minWeeklyGain:Number($('finder-min-gain').value),maxGainRatio:Number($('finder-balance').value),sort:$('finder-sort').value,includeUneven:$('finder-uneven').checked,optimizeWaivers:$('finder-waivers').checked,includeWaivers:$('finder-claims').checked,includeSpecialists:$('finder-specialists').checked,protectKeepers:$('finder-protect-keepers').checked,stress};
    if(options.startWeek>options.endWeek){status('Choose an end week on or after the start week.',true);return;}
    $('find-trades').disabled=true;$('stop-finder').hidden=false;$('finder-progress').hidden=false;$('finder-progress-bar').value=5;$('finder-progress-label').textContent='Preparing league projections…';
    const payload={snapshot:compactSnapshot(snapshot),teamId:Number($('finder-team').value),settings,overrides,options};
    const receive=message=>{
      if(id!==generation)return;
      if(message.type==='progress'){progress(message.progress);return;}
      stop();
      if(message.type==='result'){render(message.result);return;}
      status(message.message || 'The search could not be completed. Refresh and try again.',true);
    };
    try{
      if(typeof Worker==='function'){
        worker=new Worker(new URL('./trade-finder-worker.mjs?v=3',import.meta.url),{type:'module'});
        worker.addEventListener('message',e=>receive(e.data));worker.addEventListener('error',()=>receive({type:'error',message:'The trade search could not load. Refresh this page and try again.'}));worker.postMessage(payload);
      }else{
        const {findMutualTrades}=await import('./lib/finder.mjs?v=3');
        const result=await findMutualTrades(payload.snapshot,payload.teamId,settings,overrides,options,p=>{if(id!==generation)throw new Error('Search stopped.');progress(p);});receive({type:'result',result});
      }
    }catch(error){if(id===generation)receive({type:'error',message:error.message});}
  }
  $('find-trades').addEventListener('click',search);
  $('stop-finder').addEventListener('click',()=>{stop();status('Search stopped. Adjust the filters or search again.');});
  $('finder-team').addEventListener('change',()=>onTeamChange(Number($('finder-team').value)));
  $('finder-horizon').addEventListener('change',horizon);
  for(const id of ['finder-start','finder-end'])$(id).addEventListener('change',()=>{$('finder-horizon').value='custom';invalidate();});
  for(const id of ['finder-partner','finder-min-gain','finder-balance','finder-sort','finder-uneven','finder-waivers','finder-claims','finder-specialists','finder-protect-keepers'])$(id).addEventListener('change',invalidate);
  $('finder-results').addEventListener('click',e=>{const index=e.target.dataset.suggestion;if(index!==undefined&&suggestions[Number(index)])onOffer(suggestions[Number(index)].offer,{startWeek:Number($('finder-start').value),endWeek:Number($('finder-end').value),optimizeWaivers:$('finder-waivers').checked,includeWaivers:$('finder-claims').checked});});
  window.addEventListener('pagehide',stop);
  return {update,invalidate,assumptions};
}
