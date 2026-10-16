// All comparisons use projections known at evaluation time, never simulated
// realized scores. Money and starting-lineup points remain separate outputs.
export const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const stat=(p,source,split,week=0)=>(p.stats || []).find(s=>s.sourceId===source&&s.splitTypeId===split&&s.week===week);
export const auctionPrice=p=>finite(p.draft?.auctionPrice)?p.draft.auctionPrice:null;
export function leagueDefaults(s){const count=Number(s.rules.draft.keeperCountFuture ?? s.rules.draft.keeperCount ?? 0);return {format:count>0?'keeper':'redraft',keeperCount:count,budget:Number(s.rules.draft.auctionBudget || 200),increaseType:'unconfirmed',increase:0,waiverCost:null,tradedKeeperRule:'unconfirmed',minBid:1};}
export function allPlayers(s){return [...new Map([...s.teams.flatMap(t=>t.roster),...s.availablePlayers].map(p=>[p.id,p])).values()];}
export function game(s,p,week){return s.nflSchedule?.[p.nflTeamId]?.games?.[week]?.[0] || null;}
export function isBye(s,p,week){const team=s.nflSchedule?.[p.nflTeamId];return !!team && !team.games?.[week]?.length;}
export function hasStarted(s,p,week,now=Date.now()){const g=game(s,p,week),date=typeof g?.date==='number'?g.date:Date.parse(g?.date);return !!g&&Number.isFinite(date)&&date<=now;}
export function finalWeek(s){return Math.max(s.week,...Object.values(s.rules.schedule.matchupPeriods || {}).flat().map(Number).filter(x=>x<=18),Number(s.status.finalScoringPeriod || 18));}
export function activeLimit(s){return s.rules.lineupSlots.filter(x=>![21,25].includes(x.id)).reduce((n,x)=>n+x.count,0);}
export function starterSlots(s){return s.rules.lineupSlots.filter(x=>![20,21,25].includes(x.id)).flatMap(x=>Array.from({length:x.count},(_,i)=>({id:x.id,key:`${x.id}:${i}`,name:x.name})));}

export function projection(s,p,week,overrides={},now=Date.now()){
  const o=overrides[p.id] || {};
  if(isBye(s,p,week) || (finite(o.returnWeek)&&week<o.returnWeek))return 0;
  if(week===s.week){const weekly=stat(p,1,1,week);if(finite(o.weekly))return o.weekly;if(finite(weekly?.points))return weekly.points;}
  const current=stat(p,1,1,s.week);
  const raw=stat(p,1,0,0);
  let total=finite(o.ros)?o.ros:raw?.points;
  if(!finite(total))return null;
  const end=finalWeek(s);
  const weeks=Array.from({length:end-s.week+1},(_,i)=>s.week+i).filter(w=>!isBye(s,p,w));
  // Source 1, split 0 is the in-season ROS feed. Its games stat can remain 17
  // for defenses, so it cannot safely identify or subtract full-season totals.
  const projectedGames=raw?.stats?.['210'];
  const alreadyPlayed=hasStarted(s,p,s.week,now);
  const includesCurrent=weeks.includes(s.week)&&!(alreadyPlayed&&finite(projectedGames)&&projectedGames<weeks.length-.5);
  const thisWeek=includesCurrent?(finite(o.weekly)?o.weekly:current?.points):0;
  const future=weeks.filter(w=>w>s.week);
  if(week===s.week)return finite(thisWeek)?thisWeek:(weeks.length?total/weeks.length:null);
  if(!weeks.includes(week))return 0;
  if(finite(thisWeek))return future.length?(total-thisWeek)/future.length:0;
  const games=future.length+(includesCurrent?1:0);
  return games?total/games:null;
}

// Rectangular Hungarian assignment: one player per starter slot, respecting
// positional eligibility. Dummy columns are used only when no valid player can
// fill a slot; a negative projection does not silently become an empty lineup.
export function optimizeLineup(roster,slots,value,{unavailable=new Set(),fixed=[]}={}){
  const used=new Set(),locked=[],remaining=slots.slice();
  for(const f of fixed){const i=remaining.findIndex(slot=>slot.id===f.slotId);if(i>=0){locked.push({...remaining.splice(i,1)[0],player:f.player,points:f.points,locked:true});used.add(f.player.id);}}
  const players=roster.filter(p=>!used.has(p.id)&&!unavailable.has(p.id));
  const n=remaining.length,m=players.length+n;
  if(!n)return {total:locked.reduce((n,x)=>n+x.points,0),lineup:locked,missing:0};
  const values=players.map(p=>value(p));
  const cost=remaining.map(slot=>Array.from({length:m},(_,j)=>j>=players.length?1e5:!players[j].eligibleSlots.includes(slot.id)?1e8:-(finite(values[j])?values[j]:0)));
  const u=new Float64Array(n+1),v=new Float64Array(m+1),assigned=new Int32Array(m+1),way=new Int32Array(m+1);
  for(let i=1;i<=n;i++){
    assigned[0]=i;let j0=0;const minv=new Float64Array(m+1).fill(Infinity),seen=new Uint8Array(m+1);
    do{seen[j0]=1;const i0=assigned[j0];let delta=Infinity,j1=0;for(let j=1;j<=m;j++)if(!seen[j]){const cur=cost[i0-1][j-1]-u[i0]-v[j];if(cur<minv[j]){minv[j]=cur;way[j]=j0;}if(minv[j]<delta){delta=minv[j];j1=j;}}for(let j=0;j<=m;j++){if(seen[j]){u[assigned[j]]+=delta;v[j]-=delta;}else minv[j]-=delta;}j0=j1;}while(assigned[j0]!==0);
    do{const j1=way[j0];assigned[j0]=assigned[j1];j0=j1;}while(j0);
  }
  const result=Array(n);
  for(let j=1;j<=m;j++)if(assigned[j]){const i=assigned[j]-1,p=j<=players.length&&cost[i][j-1]<1e5?players[j-1]:null;result[i]={...remaining[i],player:p,points:p?(values[j-1]??0):0,projectionMissing:p?!finite(values[j-1]):false};}
  const lineup=[...locked,...result];
  return {total:lineup.reduce((n,x)=>n+x.points,0),lineup,missing:lineup.filter(x=>!x.player).length};
}

export function evaluateRoster(s,roster,original,weeks,overrides,multipliers={},now=Date.now(),forecasts){
  const slots=starterSlots(s),weekly=[];
  for(const week of weeks){
    const fixed=week===s.week?original.filter(p=>![20,21,25].includes(p.lineupSlotId)&&hasStarted(s,p,week,now)&&roster.some(x=>x.id===p.id)).map(player=>({slotId:player.lineupSlotId,player,points:stat(player,0,1,week)?.points || 0})):[];
    const unavailable=new Set(roster.filter(p=>[21,25].includes(p.lineupSlotId)||isBye(s,p,week)||(week===s.week&&hasStarted(s,p,week,now))).map(p=>p.id));
    const best=optimizeLineup(roster,slots,p=>{const x=forecasts?forecasts.get(p.id)?.get(week):projection(s,p,week,overrides,now);return finite(x)?x*(multipliers[p.id]??1):null;},{fixed,unavailable});
    weekly.push({week,...best});
  }
  return {total:weekly.reduce((n,w)=>n+w.total,0),weekly,missing:weekly.reduce((n,w)=>n+w.missing,0)};
}
function average(s,p,overrides){const ros=overrides[p.id]?.ros ?? stat(p,1,0,0)?.points;const games=Array.from({length:finalWeek(s)-s.week+1},(_,i)=>s.week+i).filter(w=>!isBye(s,p,w)).length;return finite(ros)?ros/Math.max(1,games):0;}

export function marketEstimates(s,settings,overrides={}){
  const pool=allPlayers(s),replacements=new Map();
  for(const p of s.availablePlayers){const val=average(s,p,overrides);replacements.set(p.positionId,Math.max(replacements.get(p.positionId) || 0,val));}
  const ratings=pool.map(p=>({id:p.id,vor:Math.max(0,average(s,p,overrides)-(replacements.get(p.positionId)||0))})).sort((a,b)=>b.vor-a.vor);
  const count=activeLimit(s)*s.teamCount,denominator=ratings.slice(0,count).reduce((n,r)=>n+r.vor,0);
  const premium=Math.max(0,settings.budget*s.teamCount-settings.minBid*count);
  return new Map(ratings.map(r=>[r.id,settings.minBid+(denominator?premium*r.vor/denominator:0)]));
}
export function keeperCost(p,settings,overrides={},traded=false){
  const o=overrides[p.id] || {};
  if(o.eligible===false || o.yearsRemaining===0 || (traded&&settings.tradedKeeperRule==='ineligible'))return {eligible:false,cost:null,basis:'Ineligible'};
  if(finite(o.nextCost))return {eligible:true,cost:o.nextCost,basis:'Your next-year cost'};
  if(traded&&settings.tradedKeeperRule!=='retain')return {eligible:true,cost:null,basis:'Confirm traded-player rule'};
  if(finite(p.keeperValueFuture)&&p.keeperValueFuture>0)return {eligible:true,cost:p.keeperValueFuture,basis:'ESPN future keeper cost'};
  if(settings.increaseType==='unconfirmed')return {eligible:true,cost:null,basis:'Set keeper cost rule'};
  let base=finite(o.baseCost)?o.baseCost:finite(p.keeperValue)&&p.keeperValue>0?p.keeperValue:null;
  if(base===null){
    if(['DRAFT','TRADE'].includes(p.acquisitionType)||!p.acquisitionType)base=auctionPrice(p);
    else base=finite(settings.waiverCost)?settings.waiverCost:null;
  }
  if(base===null)return {eligible:true,cost:null,basis:'Set waiver / player cost'};
  const cost=settings.increaseType==='fixed'?base+settings.increase:settings.increaseType==='percent'?Math.ceil(base*(1+settings.increase/100)):base;
  return {eligible:true,cost:Math.max(settings.minBid,cost),basis:finite(o.baseCost)?'Your cost basis':p.acquisitionType==='DRAFT'?'Original auction price':'Roster / house-rule cost'};
}
export function keeperPortfolio(roster,settings,market,overrides={},tradedIds=new Set(),rosterSize=17){
  if(settings.format==='redraft')return {enabled:false,total:0,players:[],unknown:[],estimated:0};
  if(settings.format==='keeper'&&settings.keeperCount===0)return {enabled:true,total:0,players:[],unknown:[],estimated:0};
  const candidates=[],unknown=[];
  for(const p of roster){const cost=settings.format==='dynasty'?{eligible:overrides[p.id]?.eligible!==false,cost:0,basis:'Dynasty retention'}:keeperCost(p,settings,overrides,tradedIds.has(p.id));if(!cost.eligible)continue;
    const manual=overrides[p.id]?.marketValue,price=finite(manual)?manual:market.get(p.id);
    if(!finite(cost.cost)||!finite(price)){unknown.push(p.id);continue;}
    candidates.push({player:p,cost:cost.cost,marketValue:price,surplus:price-cost.cost,estimated:!finite(manual),basis:cost.basis});
  }
  const maxCount=settings.format==='dynasty'?roster.length:Math.max(0,Math.min(roster.length,settings.keeperCount));
  // Sparse knapsack also reserves the minimum bid for every unfilled draft slot.
  let states=new Map([['0:0',{count:0,spend:0,total:0,players:[]}]]);
  for(const candidate of candidates.filter(c=>c.surplus>0)){
    const next=new Map(states);
    for(const state of states.values()){
      const count=state.count+1,spend=Math.round((state.spend+candidate.cost)*100)/100;
      if(count>maxCount || (settings.format!=='dynasty'&&spend+Math.max(0,rosterSize-count)*settings.minBid>settings.budget))continue;
      const key=`${count}:${spend}`,total=state.total+candidate.surplus;
      if(!next.has(key)||next.get(key).total<total)next.set(key,{count,spend,total,players:[...state.players,candidate]});
    }
    states=next;
  }
  const best=[...states.values()].reduce((a,b)=>b.total>a.total?b:a);
  return {enabled:true,total:best.total,players:best.players,unknown,estimated:best.players.filter(p=>p.estimated).length};
}

function candidates(s,weeks,overrides,includeWaivers,now,forecasts){
  const list=s.availablePlayers.filter(p=>(p.availability==='FREEAGENT'||includeWaivers&&p.availability==='WAIVERS')&&p.active!==false&&!(weeks[0]===s.week&&hasStarted(s,p,s.week,now)));
  const groups=new Map();
  for(const p of list){const score=weeks.reduce((n,w)=>n+((forecasts?forecasts.get(p.id)?.get(w):projection(s,p,w,overrides,now))||0),0);if(score<=0)continue;const group=groups.get(p.positionId)||[];group.push({player:p,score});groups.set(p.positionId,group);}
  return [...groups.values()].flatMap(group=>group.sort((a,b)=>b.score-a.score).slice(0,5).map(x=>x.player));
}

function adjustWorld(s,teams,originals,weeks,overrides,settings,options,multipliers){
  const cap=activeLimit(s),pool=candidates(s,weeks,overrides,options.includeWaivers,options.now,options.forecasts),used=new Set(),moves=[[],[]];
  const evaluateTeam=(i,roster)=>evaluateRoster(s,roster,originals[i],weeks,overrides,multipliers,options.now,options.forecasts);
  const activeCount=roster=>roster.filter(p=>![21,25].includes(p.lineupSlotId)).length;
  const droppable=p=>![21,25].includes(p.lineupSlotId)&&!(weeks[0]===s.week&&hasStarted(s,p,s.week,options.now));
  // Required drops are explicit in the report, not hidden in a value score.
  for(let i=0;i<2;i++)while(activeCount(teams[i])>cap){
    const choices=teams[i].filter(droppable);
    if(!choices.length)throw new Error('Required roster drops are locked this week. Start the comparison next week.');
    let drop=choices[0],best=-Infinity;
    for(const p of choices){const score=evaluateTeam(i,teams[i].filter(x=>x.id!==p.id)).total;const tie=average(s,p,overrides);if(score>best+1e-8 || Math.abs(score-best)<1e-8&&tie<average(s,drop,overrides)){best=score;drop=p;}}
    teams[i]=teams[i].filter(p=>p.id!==drop.id);moves[i].push({type:'drop',player:drop,reason:'Roster limit'});
  }
  if(options.optimizeWaivers){
    const upgrades=[0,0];
    for(let step=0;step<8;step++){
      let best=null;
      for(let i=0;i<2;i++){
        const baseline=evaluateTeam(i,teams[i]).total,room=activeCount(teams[i])<cap;
        if(!room&&upgrades[i]>=2)continue;
        const drops=room?[null]:teams[i].filter(droppable).sort((a,b)=>average(s,a,overrides)-average(s,b,overrides)).slice(0,5);
        for(const p of pool)if(!used.has(p.id))for(const drop of drops){
          const roster=[...teams[i].filter(x=>x.id!==drop?.id),{...p,lineupSlotId:20,lineupSlot:'Bench'}];
          const gain=evaluateTeam(i,roster).total-baseline;
          const score=gain+(room?1e-5*Math.max(0,average(s,p,overrides)):0);
          if((room||gain>0.01)&&(!best||score>best.score))best={i,p,drop,roster,score,room};
        }
      }
      if(!best)break;
      teams[best.i]=best.roster;used.add(best.p.id);if(!best.room)upgrades[best.i]++;
      if(best.drop)moves[best.i].push({type:'drop',player:best.drop,reason:'Waiver upgrade'});
      moves[best.i].push({type:'add',player:best.p,reason:best.room?'Open roster spot':'Waiver upgrade'});
    }
  }
  return {teams,moves,results:teams.map((r,i)=>evaluateTeam(i,r))};
}

// A finder run reuses immutable forecasts, market values and pair-specific
// baselines. The pair matters because both teams share one replacement pool.
export function createTradeContext(s,settings,overrides={},options={}){
  const now=options.now ?? Date.now(),start=Math.max(s.week,Math.trunc(Number(options.startWeek)||s.week)),end=Math.min(finalWeek(s),Math.trunc(Number(options.endWeek)||finalWeek(s)));
  if(start>end)throw new Error('Choose an end week on or after the start week.');
  const weeks=Array.from({length:end-start+1},(_,i)=>start+i);
  return {snapshot:s,settings,overrides,now,weeks,forecasts:new Map(allPlayers(s).map(p=>[p.id,new Map(weeks.map(w=>[w,projection(s,p,w,overrides,now)]))])),market:marketEstimates(s,settings,overrides),baselines:new Map()};
}

export function analyzeTrade(s,offer,settings,overrides={},options={},context=null){
  const teamA=s.teams.find(t=>t.id===offer.teamA),teamB=s.teams.find(t=>t.id===offer.teamB);
  if(!teamA||!teamB||teamA.id===teamB.id)throw new Error('Choose two different teams.');
  const outA=teamA.roster.filter(p=>offer.sendA.includes(p.id)),outB=teamB.roster.filter(p=>offer.sendB.includes(p.id));
  if(!outA.length||!outB.length)throw new Error('Select at least one player from each side of the trade.');
  if(outA.length!==offer.sendA.length||outB.length!==offer.sendB.length)throw new Error('A selected player is no longer on that roster. Refresh the offer.');
  const now=options.now ?? Date.now(),warnings=[];
  let start=Math.max(s.week,Number(options.startWeek)||s.week),end=Math.min(finalWeek(s),Number(options.endWeek)||finalWeek(s));
  if(start===s.week&&[...outA,...outB].some(p=>hasStarted(s,p,s.week,now))){start++;warnings.push(`A traded player’s game has already started. The comparison begins in Week ${start}.`);}
  if(start>end)throw new Error('Choose an end week on or after the trade can take effect.');
  if(!s.nflSchedule)warnings.push('Refresh ESPN to import the NFL schedule. Bye and lineup-lock checks are incomplete.');
  if(!s.coverage.availablePlayers)warnings.push('The available-player pool is incomplete. Replacement suggestions may miss players.');
  if(options.optimizeWaivers!==false&&!options.includeWaivers&&!s.availablePlayers.some(p=>p.availability==='FREEAGENT'))warnings.push('ESPN currently lists every available player on waivers. Enable successful-claim assumptions to include replacements; otherwise open roster spots remain unfilled.');
  if([...teamA.roster,...teamB.roster].some(p=>[21,25].includes(p.lineupSlotId)))warnings.push('Players currently in IR or reserve slots remain outside starting lineups. Future activations and their required drops are not assumed.');
  const weeks=Array.from({length:end-start+1},(_,i)=>start+i),originals=[teamA.roster,teamB.roster];
  const after=[teamA.roster.filter(p=>!offer.sendA.includes(p.id)).concat(outB.map(p=>({...p,lineupSlotId:20,lineupSlot:'Bench'}))),teamB.roster.filter(p=>!offer.sendB.includes(p.id)).concat(outA.map(p=>({...p,lineupSlotId:20,lineupSlot:'Bench'})))];
  const shared=context?.snapshot===s&&context.settings===settings&&context.overrides===overrides&&context.now===now&&context.weeks.join(',')===weeks.join(',')?context:null;
  const forecasts=shared?.forecasts || new Map(allPlayers(s).map(p=>[p.id,new Map(weeks.map(w=>[w,projection(s,p,w,overrides,now)]))]));
  const opts={optimizeWaivers:options.optimizeWaivers!==false,includeWaivers:options.includeWaivers===true,now,forecasts};
  const baselineKey=`${teamA.id}:${teamB.id}:${opts.optimizeWaivers}:${opts.includeWaivers}`;
  const baseline=shared?.baselines.get(baselineKey) || adjustWorld(s,originals.map(r=>r.slice()),originals,weeks,overrides,settings,opts,{});
  if(shared)shared.baselines.set(baselineKey,baseline);
  const changed=adjustWorld(s,after.map(r=>r.slice()),originals,weeks,overrides,settings,opts,{});
  const market=shared?.market || marketEstimates(s,settings,overrides),traded=[new Set(outB.map(p=>p.id)),new Set(outA.map(p=>p.id))];
  const teams=[teamA,teamB].map((team,i)=>{
    const before=baseline.results[i],after=changed.results[i];
    const keepBefore=keeperPortfolio(baseline.teams[i],settings,market,overrides,new Set(),activeLimit(s));
    const keepAfter=keeperPortfolio(changed.teams[i],settings,market,overrides,traded[i],activeLimit(s));
    return {team,before,after,delta:after.total-before.total,weeklyDelta:(after.total-before.total)/weeks.length,movesBefore:baseline.moves[i],movesAfter:changed.moves[i],rosterAfter:changed.teams[i],keeperBefore:keepBefore,keeperAfter:keepAfter,keeperDelta:keepBefore.unknown.length||keepAfter.unknown.length?null:keepAfter.total-keepBefore.total};
  });
  // Projection sensitivity is an explicit what-if, not a fabricated P10/P90.
  const stress=Math.max(0,Math.min(.5,Number(options.stress ?? .2)));
  const ranges=teams.map(t=>[t.delta]);
  for(const direction of [-1,1]){
    const multipliers=Object.fromEntries([...outA.map(p=>[p.id,1-direction*stress]),...outB.map(p=>[p.id,1+direction*stress])]);
    for(let i=0;i<2;i++){
      const before=evaluateRoster(s,baseline.teams[i],originals[i],weeks,overrides,multipliers,now,forecasts);
      const after=evaluateRoster(s,changed.teams[i],originals[i],weeks,overrides,multipliers,now,forecasts);
      ranges[i].push(after.total-before.total);
    }
  }
  for(let i=0;i<2;i++){teams[i].sensitivity={low:Math.min(...ranges[i]),high:Math.max(...ranges[i]),percent:stress*100};if(teams[i].before.missing||teams[i].after.missing)warnings.push(`${teams[i].team.name} has unfilled starting slots in one or more weeks.`);if([...teams[i].before.weekly,...teams[i].after.weekly].some(w=>w.lineup.some(p=>p.projectionMissing)))warnings.push(`${teams[i].team.name} has a starter without a projection. Missing forecasts contribute zero until overridden.`);}
  const missing=allPlayers(s).filter(p=>[...outA,...outB].some(x=>x.id===p.id)&&!finite(stat(p,1,0,0)?.points)&&!finite(overrides[p.id]?.ros));
  if(missing.length)warnings.push(`Remaining-season projections are missing for ${missing.map(p=>p.name).join(', ')}. Enter an override before relying on those players’ values.`);
  if(opts.includeWaivers)warnings.push('Waiver replacements assume successful claims. Their acquisition is not guaranteed.');
  if(opts.optimizeWaivers)warnings.push('Free-agent suggestions screen the top five projected players per position and allow up to two optional upgrades per team. Claim costs, position caps and future transactions are not modeled.');
  warnings.push('Future weeks allocate ESPN remaining-season totals across scheduled games. They are not separate matchup-specific weekly forecasts.');
  const verdict=teams.every(t=>t.delta>.01)?'Both teams improve their projected starting lineups.':teams.every(t=>Math.abs(t.delta)<=1)?'The projected starting-lineup impact is close to even.':teams[0].delta>1?'Your projected starting lineup improves.':teams[0].delta< -1?'Your projected starting lineup loses points.':'Your projected starting lineup changes very little.';
  return {weeks,teams,outgoing:[outA,outB],verdict,warnings:[...new Set(warnings)],market,options:{optimizeWaivers:opts.optimizeWaivers,includeWaivers:opts.includeWaivers,now}};
}
