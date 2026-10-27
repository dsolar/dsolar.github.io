// Regression checks for manual lineup imports, authoritative Yahoo finals and live roster refreshes.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
cp.execFileSync('python3',['-c',`
import sys
sys.path.insert(0,'tools')
from guillotine_paste import parse_rosters
from guillotine_projections import reconcile_roster_only_scores
rows=['Team','Pos\\tPlayer','QB','Test Player','Test PlayerNote','NE - QB','Final (Yahoo screenshot)','Yahoo snapshot points\\t0.00\\tprojection\\t12.50']
p=parse_rosters(rows)['Team'][0]
assert p['yfinal'] and p['yahoo_actual']==0 and p['yahoo_proj']==12.5
rows[-1]='Yahoo snapshot points\\t—\\tprojection\\t12.50'
p=parse_rosters(rows)['Team'][0]
assert 'yahoo_actual' not in p and p['yahoo_proj']==12.5
t={'season_pts':100,'points':5,'roster':[{'slot':'WR','yfinal':True,'final':True,'actual':2,'proj':3} for _ in range(8)]+[{'slot':'QB','proj':10}]}
# The season total moves with the rebuilt points, so season minus points stays the pre-week total.
assert reconcile_roster_only_scores(t) and t['points']==16 and t['proj']==26 and t['season_pts']==111
t['roster'][-1].update(final=True,actual=20)
assert reconcile_roster_only_scores(t) and t['points']==16 and t['proj']==36
# A newly completed game stays outside the old bank, so a live overlay adds it exactly once.
t['roster'][0].pop('actual')
assert not reconcile_roster_only_scores(t)
`],{stdio:'inherit'});
const html=fs.readFileSync('guillotine/index.html','utf8');
const context={norm:n=>n.toLowerCase(),startersOf:t=>t.roster.filter(p=>!['BN','IR'].includes(p.slot)),Date,Promise};vm.createContext(context);
// The live overlay lives in guillotine/live.js (shared with the home-page ticker); the roster refresh stays inline.
context.applyLive=require('../guillotine/live.js').apply;
vm.runInContext(html.slice(html.indexOf('  var rosterCheckedAt'),html.indexOf('  function refreshLive(')),context);
const data={week:7,teams:[{name:'Test',points:12,roster:[{name:'Test Player',slot:'QB',pos:'QB',nfl:'NE',proj:10,yfinal:true,yahoo_actual:12}]}]};
const live={week:7,games:{NE:{state:'post'}},pts:{'test player|QB':{pts:99}}};
const after=context.applyLive(data,live);assert.equal(after.teams[0].roster[0].actual,12);assert.equal(data.teams[0].roster[0].actual,undefined,'overlay must not mutate BASE');
const mismatch=context.applyLive(data,{...live,week:8});assert.equal(mismatch.teams[0].roster[0].actual,undefined);
const current=JSON.parse(fs.readFileSync('guillotine/data.json','utf8'));
for(const n of current.roster_verified_teams||[]){const t=current.teams.find(t=>t.name===n);assert.equal(t.roster.filter(p=>!['BN','IR'].includes(p.slot)).length,9);assert.equal(new Set(t.roster.map(p=>p.name)).size,t.roster.length);}
for(const n of current.lineup_verified_teams||[]){const t=current.teams.find(t=>t.name===n),starters=t.roster.filter(p=>!['BN','IR'].includes(p.slot));assert.equal(starters.length,9);assert(!starters.some(p=>p.empty));assert.equal(new Set(t.roster.map(p=>p.name)).size,t.roster.length);const done=starters.filter(p=>p.yfinal);assert.equal(Math.round(done.reduce((n,p)=>n+p.yahoo_actual,0)*100),Math.round(t.points*100));assert.equal(Math.round((t.points+starters.filter(p=>!p.yfinal).reduce((n,p)=>n+p.yahoo_proj,0))*100),Math.round(t.proj*100));}
(async()=>{context.BASE=data;context.getJSON=async()=>({week:7,teams:[{name:'New roster'}]});await context.refreshRosterSnapshot();assert.equal(context.BASE.teams[0].name,'New roster');context.rosterCheckedAt=0;context.getJSON=async()=>{throw Error('offline')};await context.refreshRosterSnapshot();assert.equal(context.BASE.teams[0].name,'New roster');console.log('Passed: snapshot parsing, zero-point finals, exact lineup totals, Yahoo score priority, week isolation, immutable live overlays and roster-refresh fallback.');})().catch(e=>{console.error(e);process.exitCode=1});
