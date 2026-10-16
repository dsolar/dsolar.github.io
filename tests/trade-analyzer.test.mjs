import test from 'node:test';
import assert from 'node:assert/strict';
import {projection,optimizeLineup,analyzeTrade,leagueDefaults,keeperCost,keeperPortfolio,marketEstimates,starterSlots} from '../trade-analyzer/lib/trade.mjs';

// Small synthetic leagues make each expected marginal lineup change explicit.
const NOW=Date.parse('2026-10-16T18:00:00Z');
const player=(id,points,extra={})=>({id,name:`Player ${id}`,positionId:2,position:'RB',eligibleSlots:[2,23,20],nflTeamId:id,nflTeam:`NFL ${id}`,injuryStatus:'ACTIVE',active:true,availability:'ROSTERED',lineupSlotId:20,acquisitionType:'DRAFT',draft:{auctionPrice:5,keeper:false},stats:[{sourceId:1,splitTypeId:0,week:0,points:points*3,stats:{210:3}},{sourceId:1,splitTypeId:1,week:6,points}],...extra});
function league(a,b,free=[],slots=[{id:2,name:'RB',count:2},{id:20,name:'Bench',count:1}]){
  const all=[...a,...b,...free];
  return {leagueId:1,season:2026,week:6,status:{finalScoringPeriod:8},teamCount:2,teams:[{id:1,name:'Your team',roster:a},{id:2,name:'Partner',roster:b}],availablePlayers:free,coverage:{availablePlayers:true},rules:{draft:{keeperCount:3,auctionBudget:205},lineupSlots:slots,schedule:{matchupPeriodCount:8,matchupPeriods:{6:[6],7:[7],8:[8]}}},nflSchedule:Object.fromEntries(all.map(p=>[p.nflTeamId,{games:Object.fromEntries([6,7,8].map(w=>[w,[{date:NOW+(w-5)*86400000}]]))}]))};
}
const run=(s,sendA,sendB,options={},settings={})=>analyzeTrade(s,{teamA:1,teamB:2,sendA,sendB},{...leagueDefaults(s),format:'redraft',...settings},{},{now:NOW,...options});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

test('a two-for-one compares bench promotion and the actual available replacement',()=>{
  const a=[player(1,20),player(2,20),player(3,15)],b=[player(4,30),player(5,12),player(6,10)],fa=player(7,8,{availability:'FREEAGENT'}),s=league(a,b,[fa]);
  const result=run(s,[1,2],[4]);
  // 20+20 becomes 30+15, not 30+8 and not a raw 40-for-30 comparison.
  close(result.teams[0].before.total,120);close(result.teams[0].after.total,135);close(result.teams[0].delta,15);
  assert.ok(result.teams[0].movesAfter.some(m=>m.type==='add'&&m.player.id===7));
  assert.ok(result.teams[1].movesAfter.some(m=>m.type==='drop'));assert.equal(result.teams[1].rosterAfter.length,3);
});
test('free-agent upgrades apply to the pre-trade baseline too',()=>{
  const s=league([player(1,20),player(2,10),player(3,5)],[player(4,20),player(5,10),player(6,5)],[player(7,30,{availability:'FREEAGENT'})]);
  const result=run(s,[1],[4]);
  close(result.teams[0].delta,0);close(result.teams[1].delta,0);
  for(const stage of ['movesBefore','movesAfter'])assert.equal(result.teams.flatMap(t=>t[stage]).filter(m=>m.type==='add'&&m.player.id===7).length,1);
});
test('waivers require an explicit successful-claim assumption',()=>{
  const s=league([player(1,20),player(2,10)],[player(4,20),player(5,10)],[player(7,30,{availability:'WAIVERS'})]);
  assert.equal(run(s,[1],[4]).teams.flatMap(t=>t.movesAfter).filter(m=>m.type==='add').length,0);
  assert.ok(run(s,[1],[4],{includeWaivers:true}).warnings.some(w=>w.includes('successful claims')));
});
test('assignment respects flex eligibility and never starts one player twice',()=>{
  const rb=player(1,15),wr=player(2,20,{positionId:3,eligibleSlots:[4,23]}),qb=player(3,99,{eligibleSlots:[0]});
  const result=optimizeLineup([rb,wr,qb],[{id:2,key:'RB'},{id:23,key:'FLEX'}],p=>p.stats[1].points);
  close(result.total,35);assert.deepEqual(new Set(result.lineup.map(x=>x.player.id)),new Set([1,2]));
});
test('negative projected scorers are preserved when a required slot can be filled',()=>{
  const p=player(1,-2),s=league([p],[]);close(projection(s,p,7,{},NOW),-2);
  const result=optimizeLineup([p],[{id:2,key:'RB'}],()=>-2);close(result.total,-2);assert.equal(result.missing,0);
});
test('ROS allocations sum to the imported total across bye weeks',()=>{
  const p=player(1,12),s=league([p],[]);delete s.nflSchedule[1].games[7];p.stats[0].points=30;p.stats[0].stats[210]=2;
  close(projection(s,p,6,{},NOW),12);close(projection(s,p,7,{},NOW),0);close(projection(s,p,8,{},NOW),18);
});
test('a Thursday lock does not cause all prior season points to be subtracted from ROS',()=>{
  const p=player(1,12),s=league([p],[]);s.nflSchedule[1].games[6][0].date=NOW-86400000;p.stats[0].points=36;p.stats.push({sourceId:0,splitTypeId:0,week:0,points:90});
  close(projection(s,p,7,{},NOW),12);
  p.stats[0].stats[210]=2;p.stats[0].points=24;close(projection(s,p,7,{},NOW),12);
});
test('a defense games stat of 17 never causes historical points to be removed from ROS',()=>{
  const p=player(1,7,{positionId:16,position:'D/ST'}),s=league([p],[]);p.stats[0].points=21;p.stats[0].stats[210]=17;p.stats.push({sourceId:0,splitTypeId:0,week:0,points:60});close(projection(s,p,7,{},NOW),7);
});
test('availability overrides remove missed production without inflating later games',()=>{
  const p=player(1,12),s=league([p],[]),o={1:{returnWeek:8}};
  close(projection(s,p,6,o,NOW),0);close(projection(s,p,7,o,NOW),0);close(projection(s,p,8,o,NOW),12);
});
test('games already started defer a proposed trade until next week',()=>{
  const s=league([player(1,10),player(2,9)],[player(3,12),player(4,8)]);s.nflSchedule[1].games[6][0].date=NOW-1000;
  assert.equal(run(s,[1],[3],{optimizeWaivers:false}).weeks[0],7);
  assert.throws(()=>run(s,[1],[3],{endWeek:6}),/take effect/);
});
test('existing locked starters retain actual points and cannot be replaced with hindsight',()=>{
  const p=player(1,20,{lineupSlotId:2}),s=league([p,player(2,10),player(3,9)],[player(4,12),player(5,8)]);p.stats.push({sourceId:0,splitTypeId:1,week:6,points:1});s.nflSchedule[1].games[6][0].date=NOW-1000;
  const r=run(s,[2],[4],{optimizeWaivers:false});close(r.teams[0].before.weekly[0].total,11);close(r.teams[0].after.weekly[0].total,13);assert.equal(r.teams[0].after.weekly[0].lineup.find(x=>x.player?.id===1).locked,true);
});
test('IR players do not silently fill active lineup slots',()=>{
  const s=league([player(1,99,{lineupSlotId:21}),player(2,10),player(3,9)],[player(4,12),player(5,8)]);
  const r=run(s,[2],[4],{optimizeWaivers:false});assert.ok(r.teams[0].before.weekly.every(w=>w.lineup.every(x=>x.player?.id!==1)));assert.ok(r.warnings.some(w=>w.includes('IR or reserve')));
});
test('cost rules preserve historical prices and distinguish waiver keeper costs',()=>{
  const s=league([player(1,20)],[]),settings={...leagueDefaults(s),increaseType:'fixed',increase:5,tradedKeeperRule:'retain',waiverCost:10};
  const p=s.teams[0].roster[0];assert.equal(keeperCost(p,settings).cost,10);assert.equal(p.draft.auctionPrice,5);
  assert.equal(keeperCost({...p,acquisitionType:'ADD'},settings).cost,15);
  assert.equal(keeperCost(p,{...settings,tradedKeeperRule:'ineligible'},{},true).eligible,false);
  assert.equal(keeperCost(p,{...settings,increaseType:'unconfirmed'}).cost,null);
  assert.equal(keeperCost(p,settings,{1:{nextCost:27}}).cost,27);
});
test('keeper count and draft budget choose the portfolio, not every cheap player',()=>{
  const roster=[player(1,20),player(2,15),player(3,10)],s=league(roster,[]),market=new Map([[1,50],[2,40],[3,30]]),settings={...leagueDefaults(s),increaseType:'none',tradedKeeperRule:'retain',keeperCount:1};
  let p=keeperPortfolio(roster,settings,market,{},new Set(),3);assert.equal(p.players.length,1);close(p.total,45);
  p=keeperPortfolio(roster,{...settings,keeperCount:2},market,{},new Set(),3);assert.equal(p.players.length,2);close(p.total,80);
  p=keeperPortfolio(roster,{...settings,keeperCount:3,budget:10},market,{},new Set(),3);assert.equal(p.players.length,1);
  assert.equal(keeperPortfolio(roster,{...settings,format:'redraft'},market).enabled,false);
});
test('unknown keeper costs block the keeper verdict without blocking season points',()=>{
  const s=league([player(1,20),player(2,10)],[player(3,15),player(4,12)]),r=run(s,[1],[3],{optimizeWaivers:false},{format:'keeper'});
  assert.equal(r.teams[0].keeperDelta,null);close(r.teams[0].delta,-15);assert.ok(r.teams[0].keeperAfter.unknown.length);
});
test('sensitivity is symmetric input stress, not probability or doubled traded-player value',()=>{
  const s=league([player(1,20),player(2,10)],[player(3,15),player(4,12)]),r=run(s,[1],[3],{optimizeWaivers:false,stress:.2});
  close(r.teams[0].delta,-15);close(r.teams[0].sensitivity.low,-36);close(r.teams[0].sensitivity.high,6);assert.equal(r.teams[0].sensitivity.percent,20);
});
test('market planning estimates are finite and do not overwrite auction history',()=>{
  const s=league([player(1,20),player(2,10)],[player(3,15),player(4,12)],[player(5,5,{availability:'FREEAGENT'})]),market=marketEstimates(s,leagueDefaults(s));
  assert.ok(market.get(1)>market.get(2));assert.equal(s.teams[0].roster[0].draft.auctionPrice,5);assert.equal(starterSlots(s).length,2);
});
test('invalid teams, empty offers and stale ownership fail explicitly',()=>{
  const s=league([player(1,20)],[player(2,20)]);assert.throws(()=>run(s,[],[2]),/at least one/);assert.throws(()=>run(s,[999],[2]),/at least one/);
  assert.throws(()=>analyzeTrade(s,{teamA:1,teamB:1,sendA:[1],sendB:[2]},leagueDefaults(s)),/different teams/);
});
