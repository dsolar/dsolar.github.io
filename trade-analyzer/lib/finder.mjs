import {analyzeTrade,createTradeContext,evaluateRoster,finite,hasStarted,starterSlots} from './trade.mjs?v=3';

const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const bundleKey=players=>players.map(p=>p.id).sort((a,b)=>a-b).join(',');
const balancedScore=(a,b)=>Math.min(a,b)+.05*(a+b);
function packages(players){return [...players.map(p=>[p]),...players.flatMap((p,i)=>players.slice(i+1).map(q=>[p,q]))];}
function qualifies(a,b,minimum,ratio){return finite(a)&&finite(b)&&a>0&&b>0&&Math.min(a,b)+1e-8>=minimum&&Math.max(a,b)/Math.min(a,b)<=ratio+1e-8;}
function positionChanges(side,weeks){
  const changes=new Map();
  for(let i=0;i<weeks;i++)for(const [sign,lineup]of [[-1,side.before.weekly[i].lineup],[1,side.after.weekly[i].lineup]])for(const slot of lineup){const row=changes.get(slot.id)||{name:slot.name,points:0};row.points+=sign*slot.points/weeks;changes.set(slot.id,row);}
  return [...changes.values()].filter(x=>x.points>.05).sort((a,b)=>b.points-a.points).slice(0,2);
}
function summary(offer,result){
  const gains=result.teams.map(side=>({teamId:side.team.id,name:side.team.name,delta:side.delta,weeklyDelta:side.weeklyDelta,keeperDelta:side.keeperDelta,keeperIncomplete:side.keeperBefore.enabled&&(!finite(side.keeperDelta)),positions:positionChanges(side,result.weeks.length),sensitivity:side.sensitivity,moves:side.movesAfter.map(m=>({type:m.type,name:m.player.name,reason:m.reason,waiver:m.player.availability==='WAIVERS'}))}));
  return {offer,weeks:result.weeks,players:result.outgoing.map(list=>list.map(p=>({id:p.id,name:p.name,position:p.position}))),gains,score:balancedScore(gains[0].weeklyDelta,gains[1].weeklyDelta),balance:Math.max(...gains.map(g=>g.weeklyDelta))/Math.min(...gains.map(g=>g.weeklyDelta)),warnings:result.warnings};
}

// Candidate screening is bounded; every displayed suggestion is independently
// checked by the same full analyzer used for manual offers. A screen score is
// never presented as a verified gain or a probability of trade acceptance.
export async function findMutualTrades(s,teamId,settings,overrides={},options={},onProgress=()=>{}){
  const own=s.teams.find(t=>t.id===Number(teamId));if(!own)throw new Error('Choose your team before searching.');
  const partners=s.teams.filter(t=>t.id!==own.id&&(!options.partnerId||t.id===Number(options.partnerId)));
  if(!partners.length)throw new Error('Choose another team or search the entire league.');
  const minimum=Math.max(.01,Number(options.minWeeklyGain ?? .5)),ratio=Math.max(1,Number(options.maxGainRatio ?? 3));
  const context=createTradeContext(s,settings,overrides,options),{weeks,now,forecasts}=context;
  let lockedExcluded=0,missingExcluded=0,screened=0,packagePairs=0;
  const relevant=new Set(starterSlots(s).map(slot=>slot.id));
  const eligible=roster=>roster.filter(p=>{
    if([21,25].includes(p.lineupSlotId)||p.active===false||!p.eligibleSlots.some(id=>relevant.has(id)))return false;
    if(!options.includeSpecialists&&[5,6,16].includes(p.positionId))return false;
    if(weeks[0]===s.week&&hasStarted(s,p,s.week,now)){lockedExcluded++;return false;}
    const values=weeks.map(w=>forecasts.get(p.id)?.get(w));if(values.some(v=>!finite(v))){missingExcluded++;return false;}
    return values.some(v=>v>0);
  });
  const players=eligible(own.roster);if(!players.length)throw new Error('Your eligible trade candidates need projections and an unlocked game. Try starting next week.');
  const ownBundles=packages(players),ownBaseline=evaluateRoster(s,own.roster,own.roster,weeks,overrides,{},now,forecasts);
  const scoreRoster=(roster,original)=>evaluateRoster(s,roster,original,weeks,overrides,{},now,forecasts);
  function losses(team,bundles,baseline){return new Map(bundles.map(bundle=>[bundleKey(bundle),baseline.total-scoreRoster(team.roster.filter(p=>!bundle.some(x=>x.id===p.id)),team.roster).total]));}
  const ownLoss=losses(own,ownBundles,ownBaseline),candidates=[];
  const partnerPools=[];
  for(let index=0;index<partners.length;index++){
    const partner=partners[index],other=eligible(partner.roster);if(!other.length)continue;
    onProgress({stage:'screening',completed:index,total:partners.length,partner:partner.name,screened});await pause();
    const otherBundles=packages(other),otherBaseline=scoreRoster(partner.roster,partner.roster),otherLoss=losses(partner,otherBundles,otherBaseline);
    const gainOwn=new Map(other.map(p=>[p.id,scoreRoster([...own.roster,{...p,lineupSlotId:20}],own.roster).total-ownBaseline.total]));
    const gainOther=new Map(players.map(p=>[p.id,scoreRoster([...partner.roster,{...p,lineupSlotId:20}],partner.roster).total-otherBaseline.total]));
    const bins=new Map(),selected=new Map();
    for(const a of ownBundles)for(const b of otherBundles){
      if(options.includeUneven===false&&a.length!==b.length)continue;
      const type=`${a.length}:${b.length}`,key=`${bundleKey(a)}|${bundleKey(b)}`;
      if(type==='1:1'){selected.set(key,{a,b});continue;}
      packagePairs++;
      const ga=b.reduce((n,p)=>n+gainOwn.get(p.id),0)-ownLoss.get(bundleKey(a)),gb=a.reduce((n,p)=>n+gainOther.get(p.id),0)-otherLoss.get(bundleKey(b));
      const rows=bins.get(type)||[];rows.push({a,b,key,score:balancedScore(ga,gb)});bins.set(type,rows);
    }
    // All eligible singles, then a broad beam of packages for each trade shape.
    for(const [type,rows]of bins)for(const row of rows.sort((a,b)=>b.score-a.score).slice(0,type==='2:2'?120:70))selected.set(row.key,row);
    const promising=[];
    for(const {a,b}of selected.values()){
      const afterA=scoreRoster(own.roster.filter(p=>!a.some(x=>x.id===p.id)).concat(b.map(p=>({...p,lineupSlotId:20}))),own.roster);
      const afterB=scoreRoster(partner.roster.filter(p=>!b.some(x=>x.id===p.id)).concat(a.map(p=>({...p,lineupSlotId:20}))),partner.roster);
      screened++;
      const ga=(afterA.total-ownBaseline.total)/weeks.length,gb=(afterB.total-otherBaseline.total)/weeks.length;
      // A modest screen margin allows the exact add/drop pass to change the
      // balance. It cannot waive the final strict mutual-gain requirements.
      if(ga>-.1&&gb>-.1)promising.push({offer:{teamA:own.id,teamB:partner.id,sendA:a.map(p=>p.id),sendB:b.map(p=>p.id)},score:balancedScore(ga,gb)});
      if(screened%100===0){onProgress({stage:'screening',completed:index,total:partners.length,partner:partner.name,screened});await pause();}
    }
    partnerPools.push(promising.sort((a,b)=>b.score-a.score));
  }
  // Round-robin shortlist gives every partner a chance at the expensive shared
  // waiver and keeper pass, rather than letting one roster consume the search.
  const verificationLimit=Number(options.verificationLimit || 48);
  for(let round=0;candidates.length<verificationLimit;round++){
    let added=0;for(const pool of partnerPools)if(pool[round]&&candidates.length<verificationLimit){candidates.push(pool[round]);added++;}if(!added)break;
  }
  const suggestions=[];let verified=0,keeperRejected=0,incompleteRejected=0;
  for(const candidate of candidates){
    onProgress({stage:'verifying',completed:verified,total:candidates.length,screened});await pause();
    let result;try{result=analyzeTrade(s,candidate.offer,settings,overrides,{...options,now},context);}catch{verified++;continue;}verified++;
    const [a,b]=result.teams.map(t=>t.weeklyDelta);
    if(!qualifies(a,b,minimum,ratio))continue;
    if(result.teams.some(t=>[...t.before.weekly,...t.after.weekly].some(w=>w.lineup.some(x=>x.projectionMissing)))){incompleteRejected++;continue;}
    if(options.protectKeepers&&settings.format!=='redraft'&&result.teams.some(t=>!finite(t.keeperDelta)||t.keeperDelta<-.01)){keeperRejected++;continue;}
    suggestions.push(summary(candidate.offer,result));
  }
  suggestions.sort((a,b)=>options.sort==='combined'?b.gains.reduce((n,g)=>n+g.weeklyDelta,0)-a.gains.reduce((n,g)=>n+g.weeklyDelta,0):b.score-a.score||a.balance-b.balance);
  const chosen=[],byPartner=new Map();
  for(const suggestion of suggestions){
    const partner=suggestion.offer.teamB,count=byPartner.get(partner)||0;
    if(count>=3)continue;
    // Suppress near-duplicate packages that merely tack a different spare player
    // onto the same core exchange. Distinct offers remain available in Analyze.
    const duplicate=chosen.some(x=>x.offer.teamB===partner&&x.offer.sendA.some(id=>suggestion.offer.sendA.includes(id))&&x.offer.sendB.some(id=>suggestion.offer.sendB.includes(id)));
    if(duplicate)continue;
    chosen.push(suggestion);byPartner.set(partner,count+1);if(chosen.length>=12)break;
  }
  onProgress({stage:'complete',completed:verified,total:candidates.length,screened});
  return {suggestions:chosen,screened,verified,packagePairs,partners:partners.length,lockedExcluded,missingExcluded,keeperRejected,incompleteRejected,weeks,minimum,maxGainRatio:ratio,limited:true,options:{...options,now}};
}
