import test from 'node:test';
import assert from 'node:assert/strict';
import {isUsableSnapshot,currentMatchups,weeklyProjection,points,isStale} from '../rohan/connected-model.mjs';
test('only complete Rohan imports are accepted',()=>{
 const s={leagueId:270405,platform:'espn',week:10,importedAt:new Date().toISOString(),teams:[{id:1,roster:[]}]};
 assert.equal(isUsableSnapshot(s),true);
 for(const change of [{leagueId:123},{importedAt:'invalid'},{teams:[]},{teams:[{}]},{platform:'other'}])assert.equal(isUsableSnapshot({...s,...change}),false);
});
test('matchups use ESPN matchup period, not the NFL week',()=>{
 const s={week:16,status:{currentMatchupPeriod:14},schedule:[{id:1,matchupPeriodId:14,home:{},away:{}},{id:2,matchupPeriodId:16,home:{},away:{}}]};
 assert.deepEqual(currentMatchups(s).map(x=>x.id),[1]);assert.deepEqual(currentMatchups({...s,status:{}}),[]);
});
test('missing scores stay missing and projections match week and source',()=>{
 assert.equal(points(null),'—');assert.equal(points(0),'0');assert.equal(points(NaN),'—');
 const p={stats:[{sourceId:0,week:10,splitTypeId:1,points:15},{sourceId:1,week:9,splitTypeId:1,points:12},{sourceId:1,week:10,splitTypeId:1,points:0}]};
 assert.equal(weeklyProjection(p,10),0);assert.equal(weeklyProjection(p,11),null);
});
test('old or invalid import timestamps need attention',()=>{assert.equal(isStale({importedAt:'invalid'}),true);assert.equal(isStale({importedAt:new Date(Date.now()-7200000).toISOString()}),true);assert.equal(isStale({importedAt:new Date().toISOString()}),false);});
