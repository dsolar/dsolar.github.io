// Regression checks for manual lineup imports, authoritative Yahoo finals and live roster refreshes.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
cp.execFileSync('python3',['-c',`
import sys
sys.path.insert(0,'tools')
from guillotine_paste import parse_rosters
from guillotine_projections import reconcile_roster_only_scores
from guillotine_paste import parse_offers, merge_offers
from guillotine_update import team_roster, strip_ns
import xml.etree.ElementTree as ET
# Yahoo's weekly roster response contains both slots and league-scored player totals.
class RosterYahoo:
    def get(self, path, soft=False):
        assert path.endswith('/roster;week=8/players/stats;type=week;week=8')
        return strip_ns(ET.fromstring('''<fantasy_content xmlns="http://fantasysports.yahooapis.com/fantasy/v2/base.rng"><team><roster><players><player><name><full>Test Player</full></name><primary_position>QB</primary_position><editorial_team_abbr>NE</editorial_team_abbr><selected_position><position>QB</position></selected_position><player_points><total>0.00</total></player_points></player></players></roster></team></fantasy_content>'''))
assert team_roster(RosterYahoo(),'470.l.157731.t.1',8,[('QB',1)])[0]['yahoo_actual']==0
# Transactions page: winning bid, every losing bid with its reason, the winner and the waiver run.
rows=['Joe Burrow Cin - QB','$207 Winning Offer','Drake Mayezini $161 (Lower Offer)','','Holofernes $0 (Invalid claim due to previous transaction)','','Awarded To:\t','Likely to Burden Tate w Penix','Oct 28,4:31 am']
o=parse_offers(rows,2026)[0]
assert o['bid']==207 and o['team']=='Likely to Burden Tate w Penix' and o['run']=='2026-10-28' and [b['why'] for b in o['bids']]==['lower','invalid']
assert len(merge_offers([o],[dict(o)]))==1
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
const context={Date,Promise,LEAGUE:{live_url:'relay'},HIST:{weeks:{}},YAHOO:{status:'connected'}};vm.createContext(context);
// The live overlay lives in guillotine/live.js (shared with the home-page ticker); the roster refresh stays inline.
context.applyLive=require('../guillotine/live.js').apply;
vm.runInContext(html.slice(html.indexOf('  var rosterCheckedAt'),html.indexOf('  function refreshLive(')),context);
const data={week:7,teams:[{name:'Test',points:12,roster:[{name:'Test Player',slot:'QB',pos:'QB',nfl:'NE',proj:10,yfinal:true,yahoo_actual:12}]}]};
const live={week:7,games:{NE:{state:'post'}},pts:{'test player|QB':{pts:99}}};
const after=context.applyLive(data,live);assert.equal(after.teams[0].roster[0].actual,12);assert.equal(data.teams[0].roster[0].actual,undefined,'overlay must not mutate BASE');
const mismatch=context.applyLive(data,{...live,week:8});assert.equal(mismatch.teams[0].roster[0].actual,undefined);
const seasonData={...data,season:2026};
assert.equal(context.applyLive(seasonData,{...live,season:2025}).teams[0].roster[0].actual,undefined,'never overlay a different season');
// A mid-game Yahoo import contains 12 final points plus 25 live points in its raw total.
// The simulation must bank 37, not 62, after the live feed arrives.
const sim=require('../guillotine/sim.js');
const ongoing={points:37,points_final:12,roster:[
  {slot:'QB',pos:'QB',proj:20,yfinal:true,final:true,actual:12},
  {slot:'WR',pos:'WR',proj:20,live:true,actual:25,frac:0.5}
]};
assert.equal(sim.thisWeek(ongoing,60,sim.DEFAULTS).banked,37,'Yahoo and live points must not be counted twice');
const zero=JSON.parse(JSON.stringify(ongoing));zero.points_final=0;zero.roster[0].actual=0;
assert.equal(sim.thisWeek(zero,60,sim.DEFAULTS).banked,25,'a zero-point bank is a valid observation');
const negative=JSON.parse(JSON.stringify(ongoing));negative.roster[1].actual=-4;
assert.equal(sim.thisWeek(negative,60,sim.DEFAULTS).banked,8,'negative live points must remain exact');
const finished=JSON.parse(JSON.stringify(ongoing));delete finished.roster[1].live;finished.roster[1].final=true;
assert.equal(sim.thisWeek(finished,60,sim.DEFAULTS).banked,37,'newly final games are added exactly once');
assert.equal(sim.thisWeek(ongoing,60,{...sim.DEFAULTS,pregame:true}).banked,0,'opening odds ignore all scored points');
const current=JSON.parse(fs.readFileSync('guillotine/data.json','utf8'));
for(const n of current.roster_verified_teams||[]){const t=current.teams.find(t=>t.name===n);assert.equal(t.roster.filter(p=>!['BN','IR'].includes(p.slot)).length,9);assert.equal(new Set(t.roster.map(p=>p.name)).size,t.roster.length);}
for(const n of current.lineup_verified_teams||[]){const t=current.teams.find(t=>t.name===n),starters=t.roster.filter(p=>!['BN','IR'].includes(p.slot));assert.equal(starters.length,9);assert(!starters.some(p=>p.empty));assert.equal(new Set(t.roster.map(p=>p.name)).size,t.roster.length);const done=starters.filter(p=>p.yfinal);assert.equal(Math.round(done.reduce((n,p)=>n+p.yahoo_actual,0)*100),Math.round(t.points*100));assert.equal(Math.round((t.points+starters.filter(p=>!p.yfinal).reduce((n,p)=>n+p.yahoo_proj,0))*100),Math.round(t.proj*100));}
(async()=>{
  context.BASE=data;
  context.getJSON=async url=>url.startsWith('data.json')?{week:7,teams:[{name:'New roster'}]}:
    url.startsWith('league.json')?{live_url:'new relay'}:url.startsWith('history.json')?{weeks:{7:{}}}:{status:'connected',last_success:'2026-11-01T18:00:00Z'};
  assert.equal(await context.refreshRosterSnapshot(),true);
  assert.equal(context.BASE.teams[0].name,'New roster');
  assert.equal(context.LEAGUE.live_url,'new relay');
  assert(context.HIST.weeks[7]);
  assert.equal(context.YAHOO.last_success,'2026-11-01T18:00:00Z');
  context.rosterCheckedAt=0;context.getJSON=async()=>{throw Error('offline')};
  assert.equal(await context.refreshRosterSnapshot(),false);
  assert.equal(context.BASE.teams[0].name,'New roster');
  // Published lineup updates must render even when the live-score feed fails.
  const rendered=[],delays=[];
  Object.assign(context,{liveTimer:null,liveBusy:false,liveFails:0,document:{visibilityState:'visible'},
    clearTimeout:()=>{},setTimeout:(_f,ms)=>{delays.push(ms);return 1;},
    refreshRosterSnapshot:async()=>true,getLive:async()=>{throw Error('feed offline');},
    render:d=>rendered.push(d.teams[0].name),updateJumpLabels:()=>{},
    // refreshLive writes its status line through the page's $() helper and reads the page state
    $:()=>({textContent:'',open:false}),state:{data:null},openName:null});
  vm.runInContext(html.slice(html.indexOf('  function refreshLive('),html.indexOf('  document.addEventListener("visibilitychange"')),context);
  await context.refreshLive();
  assert.deepEqual(rendered,['New roster']);assert.equal(delays[0],60000);assert.equal(context.liveBusy,false);
  // A relay serving an old season or stale cache must fall back to the direct feeds.
  for(const relay of [
    {season:2025,week:8,fetched:new Date().toISOString(),games:{},pts:{}},
    {season:2026,week:8,fetched:'2000-01-01T00:00:00Z',games:{},pts:{}},
    {season:2026,week:8,fetched:new Date().toISOString(),games:{},pts:{}}
  ]){
    const urls=[],sandbox={module:{exports:{}},Date,fetch:async url=>{
      urls.push(url);return {ok:true,json:async()=>url==='relay'?relay:url.includes('sleeper')?[]:{events:[]}};
    }};
    vm.createContext(sandbox);vm.runInContext(fs.readFileSync('guillotine/live.js','utf8'),sandbox);
    const got=await sandbox.module.exports.get({season:2026,week:8,teams:[]},'relay');
    assert.equal(got.season,2026);assert.equal(got.week,8);
    const fresh=relay.season===2026&&relay.fetched!=='2000-01-01T00:00:00Z';
    assert.equal(urls.length,fresh?1:3);
  }
  console.log('Passed: parsing, exact Yahoo finals, single-counted live points, negative scores, season/week isolation, stale-relay fallback, all-file refresh and roster updates during a live-feed outage.');
})().catch(e=>{console.error(e);process.exitCode=1});

