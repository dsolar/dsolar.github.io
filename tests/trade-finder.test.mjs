import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {findMutualTrades} from '../trade-analyzer/lib/finder.mjs';
import {analyzeTrade,createTradeContext,leagueDefaults} from '../trade-analyzer/lib/trade.mjs';
const NOW=Date.parse('2026-10-16T18:00:00Z');
const p=(id,points,position='RB',extra={})=>({id,name:`Player ${id}`,position,positionId:position==='WR'?3:2,eligibleSlots:position==='WR'?[4,23,20]:[2,23,20],nflTeamId:id,lineupSlotId:20,active:true,availability:'ROSTERED',acquisitionType:'DRAFT',draft:{auctionPrice:5},stats:[{sourceId:1,splitTypeId:0,week:0,points:points*3,stats:{210:3}},{sourceId:1,splitTypeId:1,week:6,points}],...extra});
function league(a,b,free=[]){const players=[...a,...b,...free];return {leagueId:1,season:2026,week:6,status:{finalScoringPeriod:8},teamCount:2,rules:{draft:{keeperCount:3,auctionBudget:205},schedule:{matchupPeriods:{6:[6],7:[7],8:[8]}},lineupSlots:[{id:2,name:'RB',count:1},{id:4,name:'WR',count:1},{id:20,name:'Bench',count:2}]},teams:[{id:1,name:'A',roster:a},{id:2,name:'B',roster:b}],availablePlayers:free,coverage:{availablePlayers:true},nflSchedule:Object.fromEntries(players.map(x=>[x.id,{games:Object.fromEntries([6,7,8].map(w=>[w,[{date:NOW+86400000*(w-5)}]]))}]))};}
const depthLeague=()=>league([p(1,20),p(2,18),p(3,8,'WR'),p(4,5,'WR')],[p(5,8),p(6,5),p(7,20,'WR'),p(8,18,'WR')]);
const settings=s=>({...leagueDefaults(s),format:'redraft'});
const search=(s,options={},rules=settings(s),overrides={})=>findMutualTrades(s,1,rules,overrides,{now:NOW,optimizeWaivers:false,minWeeklyGain:.5,maxGainRatio:3,...options});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('finds complementary bench-depth trades that improve both starting lineups',async()=>{
 const s=depthLeague(),r=await search(s);assert.ok(r.suggestions.length);assert.ok(r.suggestions.some(x=>x.offer.sendA.includes(2)&&x.offer.sendB.includes(8)));
 for(const x of r.suggestions){assert.ok(x.gains.every(g=>g.weeklyDelta>=.5));assert.ok(x.balance<=3);assert.ok(x.gains.every(g=>g.positions.length));}
});
test('every displayed gain agrees with an independent full manual analysis',async()=>{
 const s=depthLeague(),rules=settings(s),r=await search(s,{},rules);
 for(const x of r.suggestions){const full=analyzeTrade(s,x.offer,rules,{},r.options);for(let i=0;i<2;i++){close(x.gains[i].delta,full.teams[i].delta);close(x.gains[i].weeklyDelta,full.teams[i].weeklyDelta);}}
});
test('never recommends a one-sided upgrade or a zero-impact shuffle',async()=>{
 const s=league([p(1,20),p(2,20,'WR')],[p(3,10),p(4,10,'WR')]);assert.equal((await search(s)).suggestions.length,0);
});
test('minimum gain and balance filters apply to both teams after full verification',async()=>{
 const s=depthLeague();assert.equal((await search(s,{minWeeklyGain:20})).suggestions.length,0);
 const r=await search(s,{maxGainRatio:1});assert.ok(r.suggestions.length);assert.ok(r.suggestions.every(x=>Math.abs(x.gains[0].weeklyDelta-x.gains[1].weeklyDelta)<1e-8));
});
test('a modest one-week mutual gain keeps the same verdict when opened in the analyzer',async()=>{
 const s=depthLeague();s.teams[0].roster[2]=p(3,17.5,'WR');s.teams[1].roster[0]=p(5,17.5);
 const rules=settings(s),r=await search(s,{endWeek:6},rules);assert.ok(r.suggestions.length);
 for(const suggestion of r.suggestions){const full=analyzeTrade(s,suggestion.offer,rules,{},r.options);assert.match(full.verdict,/Both teams improve/);}
});
test('two-for-one consolidation includes bench promotion and required roster drops',async()=>{
 const s=league([p(1,20),p(2,20),p(3,15)],[p(4,30),p(5,8),p(6,0)]);s.rules.lineupSlots=[{id:2,name:'RB',count:2},{id:20,name:'Bench',count:1}];
 const r=await search(s);const offer=r.suggestions.find(x=>x.offer.sendA.length!==x.offer.sendB.length);assert.ok(offer);assert.ok(offer.gains.every(g=>g.weeklyDelta>0));assert.ok(offer.gains.some(g=>g.moves.some(m=>m.type==='drop')));
 const equal=await search(s,{includeUneven:false});assert.ok(equal.suggestions.every(x=>x.offer.sendA.length===x.offer.sendB.length));
});
test('available upgrades cannot be falsely credited as trade-created mutual gains',async()=>{
 const s=depthLeague();s.availablePlayers=[p(9,25,'WR',{availability:'FREEAGENT'}),p(10,25,'RB',{availability:'FREEAGENT'})];
 const r=await search(s,{optimizeWaivers:true});assert.equal(r.suggestions.length,0);
});
test('locked players are excluded now and become eligible for a next-week search',async()=>{
 const s=depthLeague();s.nflSchedule[2].games[6][0].date=NOW-1000;
 const r=await search(s);assert.equal(r.lockedExcluded,1);assert.ok(r.suggestions.every(x=>!x.offer.sendA.includes(2)));
 const next=await search(s,{startWeek:7});assert.ok(next.suggestions.some(x=>x.offer.sendA.includes(2)));
});
test('missing forecasts and reserve slots cannot be offered as free player value',async()=>{
 const s=depthLeague();s.teams[0].roster[1].stats=[];s.teams[1].roster[3].lineupSlotId=21;
 const r=await search(s);assert.equal(r.missingExcluded,1);assert.ok(r.suggestions.every(x=>!x.offer.sendA.includes(2)&&!x.offer.sendB.includes(8)));
});
test('unconfirmed keeper rules remain visible and keeper-protection rejects them',async()=>{
 const s=depthLeague(),rules=leagueDefaults(s),r=await search(s,{},rules);assert.ok(r.suggestions.length);assert.ok(r.suggestions.every(x=>x.gains.every(g=>g.keeperIncomplete)));
 const strict=await search(s,{protectKeepers:true},rules);assert.equal(strict.suggestions.length,0);assert.ok(strict.keeperRejected>0);
});
test('keeper protection checks portfolio opportunity cost on both sides',async()=>{
 const s=depthLeague(),rules={...leagueDefaults(s),increaseType:'none',tradedKeeperRule:'retain',keeperCount:1};
 const overrides=Object.fromEntries(s.teams.flatMap(t=>t.roster).map(player=>[player.id,{nextCost:5,marketValue:player.id===2||player.id===8?100:20}]));
 const r=await search(s,{protectKeepers:true},rules,overrides);assert.ok(r.suggestions.length);assert.ok(r.suggestions.every(x=>x.gains.every(g=>g.keeperDelta>=-.01)));
});
test('keeper protection rejects a lineup win that gives away a uniquely valuable keeper',async()=>{
 const s=depthLeague(),rules={...leagueDefaults(s),increaseType:'none',tradedKeeperRule:'retain',keeperCount:1};
 const overrides=Object.fromEntries(s.teams.flatMap(t=>t.roster).map(player=>[player.id,{nextCost:5,marketValue:player.id===2?100:20}]));
 const loose=await search(s,{},rules,overrides);assert.ok(loose.suggestions.some(x=>x.offer.sendA.includes(2)&&x.gains[0].keeperDelta<0));
 const strict=await search(s,{protectKeepers:true},rules,overrides);assert.ok(strict.suggestions.every(x=>!x.offer.sendA.includes(2)));assert.ok(strict.keeperRejected>0);
});
test('partner scope is respected and bad or identical-team scopes fail',async()=>{
 const s=depthLeague();assert.equal((await search(s,{partnerId:2})).partners,1);await assert.rejects(search(s,{partnerId:1}),/another team/);await assert.rejects(findMutualTrades(s,999,settings(s)),/Choose your team/);
});
test('cached pair baselines preserve shared-waiver ownership and changing claim options',()=>{
 const s=depthLeague();s.availablePlayers=[p(9,19,'WR',{availability:'WAIVERS'})];const rules=settings(s),overrides={},opts={now:NOW,startWeek:6,endWeek:8,optimizeWaivers:true},context=createTradeContext(s,rules,overrides,opts),offer={teamA:1,teamB:2,sendA:[2],sendB:[8]};
 for(const includeWaivers of [false,true]){const full=analyzeTrade(s,offer,rules,overrides,{...opts,includeWaivers}),cached=analyzeTrade(s,offer,rules,overrides,{...opts,includeWaivers},context);for(let i=0;i<2;i++)close(full.teams[i].delta,cached.teams[i].delta);}
 assert.equal(context.baselines.size,2);
});
test('the module worker returns progress and verified suggestions over its actual protocol',async t=>{
 const url=new URL('../trade-analyzer/trade-finder-worker.mjs',import.meta.url).href;
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={addEventListener(type,fn){parentPort.on('message',data=>fn({data}));},postMessage(data){parentPort.postMessage(data);}};import(${JSON.stringify(url)}).then(()=>parentPort.postMessage({type:'ready'}));`,{eval:true});
 t.after(()=>worker.terminate());
 const s=depthLeague(),messages=[];
 const result=await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',m=>{messages.push(m);if(m.type==='ready')worker.postMessage({snapshot:s,teamId:1,settings:settings(s),overrides:{},options:{now:NOW,optimizeWaivers:false}});if(m.type==='error')reject(Error(m.message));if(m.type==='result')resolve(m.result);});});
 assert.ok(messages.some(m=>m.type==='progress'));assert.ok(result.suggestions.length);
});
test('finder source stays local and cannot send trade offers to ESPN',()=>{
 for(const path of ['../trade-analyzer/finder-ui.mjs','../trade-analyzer/lib/finder.mjs','../trade-analyzer/trade-finder-worker.mjs']){const text=readFileSync(new URL(path,import.meta.url),'utf8');assert.ok(!/\bfetch\s*\(/.test(text));assert.ok(!text.includes('innerHTML'));assert.ok(!text.includes('SUPABASE_SERVICE_ROLE_KEY'));}
});
