import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { importLeague, leagueIdentity, validateSession, normalizeLeague, loadProSchedule } from '../trade-analyzer/lib/espn.mjs';
import { createHandler, hashToken, sessionKey, sealSession, openSession } from '../supabase/functions/espn-sync/handler.mjs';

// Synthetic ESPN-shaped fixtures, never live private league data or credentials.
const session={swid:'{11111111-2222-3333-4444-555555555555}',espnS2:'synthetic-session-for-tests-only'};
const TOKEN='a'.repeat(64), OTHER='b'.repeat(64), SECRET='synthetic-server-secret-for-tests-only';
const identity={leagueId:270405,season:2026};
const NOW='2026-10-16T18:00:00.000Z';
const clone=object=>structuredClone(object);
const player=(id,status='FREEAGENT',onTeamId=0)=>({id,status,onTeamId,player:{id,fullName:`Test Player ${id}`,defaultPositionId:2,proTeamId:17,eligibleSlots:[2,3,7,20,23],injuryStatus:'ACTIVE',active:true,ownership:{percentOwned:50},stats:[{seasonId:2026,statSourceId:1,statSplitTypeId:1,scoringPeriodId:2,appliedTotal:15.25,stats:{24:90,25:.5,53:2}}]}});
const rosterEntry=id=>({lineupSlotId:2,acquisitionType:'DRAFT',keeperValue:8,playerPoolEntry:player(id,'ONTEAM',id===101?1:2)});
function coreFixture(){return {
  id:270405,seasonId:2026,scoringPeriodId:2,status:{currentMatchupPeriod:2},
  settings:{name:'Synthetic Test League',size:2,rosterSettings:{lineupSlotCounts:{0:1,2:2,4:3,6:1,23:1,16:1,17:1,20:6,21:2},positionLimits:{1:4}},
    scoringSettings:{scoringType:'H2H_POINTS',scoringItems:[{statId:1,points:.7},{statId:2,points:-1},{statId:53,points:.5},{statId:37,points:1.5},{statId:991,points:2,pointsOverrides:{custom:7}}]},
    acquisitionSettings:{acquisitionBudget:100,waiverProcessDays:[3,4,5,6,0]},tradeSettings:{vetoVotesRequired:5,deadlineDate:1794416400000},
    scheduleSettings:{playoffTeamCount:6,matchupPeriods:{1:[1],2:[2],3:[3,4]}},draftSettings:{keeperCount:3,draftType:'SALARY_CAP',auctionBudget:205}},
  teams:[{id:1,name:'Test Team One',owners:[session.swid],record:{overall:{wins:1,losses:0,ties:0}},roster:{entries:[rosterEntry(101)]}},{id:2,name:'Test Team Two',owners:[],record:{overall:{wins:0,losses:1,ties:0}},roster:{entries:[rosterEntry(201)]}}],
  draftDetail:{picks:[{playerId:101,bidAmount:8,roundId:1,overallPickNumber:1,keeper:true}]},
  schedule:[{id:1,matchupPeriodId:3,home:{teamId:1,totalPoints:0},away:{teamId:2,totalPoints:0},winner:'UNDECIDED'}],
};}
function espnFetcher({core=coreFixture(),available=[player(301),player(302,'WAIVERS'),player(303,'FREEAGENT',-1)],fail,repeat=false}={}){
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(fail)return new Response('DO NOT LEAK THIS UPSTREAM BODY',{status:fail});
    const u=new URL(url);
    if(!u.searchParams.getAll('view').includes('kona_player_info'))return Response.json(clone(core));
    const filter=JSON.parse(options.headers['X-Fantasy-Filter']).players;
    return Response.json({players:repeat?available:available.slice(filter.offset,filter.offset+filter.limit),total:repeat?999:available.length});
  };
  return {fetcher,calls};
}

test('league links are parsed and arbitrary hosts/paths cannot become requests',()=>{
  assert.deepEqual(leagueIdentity('https://fantasy.espn.com/football/league?leagueId=270405&seasonId=2026',2025),identity);
  for(const input of ['https://evil.example/football/league?leagueId=270405','https://fantasy.espn.com.evil.example/football/league?leagueId=270405','https://fantasy.espn.com/basketball/league?leagueId=270405','0','123&view=other','9007199254740992'])assert.throws(()=>leagueIdentity(input,2026));
  assert.throws(()=>leagueIdentity('270405',2017));
});
test('session validation rejects missing cookies and header injection',()=>{
  assert.deepEqual(validateSession(session),session);
  assert.throws(()=>validateSession({...session,espnS2:'bad\r\nCookie: extra'}));
  assert.throws(()=>validateSession({...session,swid:'../../other'}));
  assert.throws(()=>validateSession({}));
});
test('custom scoring, bonuses, unknown parameters and keeper prices survive import',async()=>{
  const {fetcher}=espnFetcher();
  const s=await importLeague(identity,session,{fetcher,now:NOW});
  assert.equal(s.rules.scoringItems.find(x=>x.statId===1).points,.7);
  assert.equal(s.rules.scoringItems.find(x=>x.statId===2).points,-1);
  assert.equal(s.rules.scoringItems.find(x=>x.statId===37).points,1.5);
  assert.deepEqual(s.rules.scoringItems.find(x=>x.statId===991).pointsOverrides,{custom:7});
  assert.equal(s.teams[0].roster[0].draft.auctionPrice,8);
  assert.equal(s.teams[0].roster[0].keeperValue,8);
  assert.deepEqual(s.myTeamIds,[1]);
  assert.equal(s.rules.lineupSlots.find(x=>x.id===21).count,2);
  assert.deepEqual(s.rules.schedule.matchupPeriods[3],[3,4]);
  assert.equal(s.keeperRules.reviewRequired,true);
  assert.equal(s.teams[0].roster[0].stats[0].points,15.25);
  assert.ok(!JSON.stringify(s).includes(session.swid));
});
test('all available-player pages import and rostered players never become replacements',async()=>{
  const available=[player(301),player(302,'WAIVERS'),player(303,'FREEAGENT',-1),player(101)];
  const {fetcher,calls}=espnFetcher({available});
  const s=await importLeague(identity,session,{fetcher,pageSize:2});
  assert.deepEqual(s.availablePlayers.map(p=>p.id),[301,302,303]);
  assert.equal(s.availablePlayers[1].availability,'WAIVERS');
  assert.equal(s.coverage.availablePlayers,true);
  assert.equal(calls.length,4);
  assert.equal(JSON.parse(calls[2].options.headers['X-Fantasy-Filter']).players.offset,2);
  assert.ok(calls.every(c=>new URL(c.url).hostname==='lm-api-reads.fantasy.espn.com'&&c.options.method==='GET'&&c.options.redirect==='error'));
  assert.equal(calls[3].options.headers.cookie,undefined);
});
test('NFL schedule preserves dates, opponents and bye gaps without league credentials',async()=>{
  const teams=Array.from({length:32},(_,i)=>({id:i+1,byeWeek:3,proGamesByScoringPeriod:{2:[{date:1792080000000,homeProTeamId:i+1,awayProTeamId:99}],4:[{date:1793289600000,homeProTeamId:99,awayProTeamId:i+1}]}}));
  const schedule=await loadProSchedule(2025,async(url,opts)=>{assert.equal(opts.headers.cookie,undefined);assert.ok(url.endsWith('?view=proTeamSchedules_wl'));return Response.json({settings:{proTeams:teams}});});
  assert.equal(schedule[1].byeWeek,3);assert.equal(schedule[1].games[3],undefined);assert.equal(schedule[1].games[2][0].date,1792080000000);assert.equal(schedule[1].games[4][0].opponentId,99);
});
test('ignored pagination is reported as incomplete rather than full coverage',async()=>{
  const {fetcher}=espnFetcher({available:[player(301),player(302)],repeat:true});
  const s=await importLeague(identity,session,{fetcher,pageSize:2});
  assert.equal(s.availablePlayers.length,2);
  assert.equal(s.coverage.availablePlayers,false);
  assert.match(s.warnings.join(' '),/incomplete/);
});
test('missing rosters, rules, teams or free-agent data cause an explicit failure',async()=>{
  for(const mutate of [c=>delete c.teams[0].roster,c=>delete c.settings.scoringSettings,c=>c.teams.pop()]){
    const core=coreFixture();mutate(core);
    await assert.rejects(importLeague(identity,session,{fetcher:espnFetcher({core}).fetcher}));
  }
  const {fetcher}=espnFetcher();
  const bad=async(url,opts)=>new URL(url).searchParams.getAll('view').includes('kona_player_info')?Response.json({}):fetcher(url,opts);
  await assert.rejects(importLeague(identity,session,{fetcher:bad}),error=>error.code==='incomplete_available');
});
test('ESPN authentication failures never echo upstream response bodies',async()=>{
  await assert.rejects(importLeague(identity,session,{fetcher:espnFetcher({fail:403}).fetcher}),error=>error.code==='reconnect_required'&&!error.message.includes('DO NOT LEAK'));
});
test('session encryption is randomized, authenticated, and requires the server key',async()=>{
  const key=await sessionKey(SECRET),other=await sessionKey(SECRET+'different');
  const a=await sealSession(session,key),b=await sealSession(session,key);
  assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
  assert.ok(!JSON.stringify(a).includes(session.espnS2));
  assert.deepEqual(await openSession(a,key),session);
  await assert.rejects(openSession(a,other));
  await assert.rejects(openSession({...a,ciphertext:a.ciphertext.slice(0,-4)+'AAAA'},key));
});

class MemoryRepository{
  connections=new Map();snapshots=new Map();schedulerToken='c'.repeat(64);
  async connection(hash){return clone(this.connections.get(hash)||null);}
  async saveConnection(row){const existing=this.connections.get(row.token_hash);const saved={...existing,...clone(row)};this.connections.set(row.token_hash,saved);return clone(saved);}
  async updateConnection(id,body){for(const [key,row]of this.connections)if(row.id===id)this.connections.set(key,{...row,...clone(body)});}
  async leagues(id){return [...this.snapshots.values()].filter(row=>row.connection_id===id).map(({snapshot,...row})=>clone(row));}
  async league(id,{leagueId,season}){return clone([...this.snapshots.values()].find(r=>r.connection_id===id&&r.league_id===leagueId&&r.season===season)||null);}
  async saveLeague(row){const existing=await this.league(row.connection_id,{leagueId:row.league_id,season:row.season});const saved={...existing,id:existing?.id||crypto.randomUUID(),...clone(row)};this.snapshots.set(saved.id,saved);return clone(saved);}
  async updateLeague(id,body){this.snapshots.set(id,{...this.snapshots.get(id),...clone(body)});}
  async claimLeague(id,now){const row=this.snapshots.get(id);if(row.sync_started_at&&Date.parse(row.sync_started_at)>Date.parse(now)-120000)return false;await this.updateLeague(id,{sync_started_at:now,last_attempt_at:now});return true;}
  async disconnect(id){for(const[k,row]of this.connections)if(row.id===id)this.connections.delete(k);for(const[k,row]of this.snapshots)if(row.connection_id===id)this.snapshots.delete(k);}
  async schedulerHash(){return hashToken(this.schedulerToken);}
  async due(now){return [...this.snapshots.values()].filter(r=>Date.parse(r.next_sync_at)<=Date.parse(now)&&['connected','partial','error'].includes(r.status)).slice(0,4).map(clone);}
  async connectionById(id){return clone([...this.connections.values()].find(c=>c.id===id)||null);}
  async purgeExpired(now){for(const c of [...this.connections.values()])if(Date.parse(c.expires_at)<Date.parse(now))await this.disconnect(c.id);}
}
function setup(){
  const repo=new MemoryRepository();let current=NOW,upstreamFailure=0;
  const normal=espnFetcher();
  const handler=createHandler({repository:repo,serviceKey:SECRET,clock:()=>new Date(current),fetcher:(...args)=>upstreamFailure?new Response('private upstream text',{status:upstreamFailure}):normal.fetcher(...args)});
  return {repo,handler,normal,setTime:value=>current=value,setFailure:value=>upstreamFailure=value};
}
function call(handler,action,{token=TOKEN,body,params={},origin='https://davidsolar.dev',headers={}}={}){
  const url=new URL('https://example.test/espn-sync');url.searchParams.set('action',action);for(const[k,v]of Object.entries(params))url.searchParams.set(k,String(v));
  return handler(new Request(url,{method:body===undefined?'GET':'POST',headers:{...(origin?{Origin:origin}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}));
}
async function connect(ctx,token=TOKEN){const r=await call(ctx.handler,'connect',{token,body:{...identity,session}});assert.equal(r.status,200,await r.clone().text());return r.json();}

test('health has no private data; every league read requires the paired device',async()=>{
  const ctx=setup();const health=await call(ctx.handler,'health',{token:null});assert.equal(health.status,200);assert.deepEqual(Object.keys(await health.json()).sort(),['mode','ok','platform','refreshMinutes','version']);
  for(const action of ['leagues','snapshot','refresh','disconnect']){const r=await call(ctx.handler,action,{token:null,body:['refresh','disconnect'].includes(action)?{}:undefined,params:identity});assert.equal(r.status,401);}
  const blocked=await call(ctx.handler,'health',{origin:'https://evil.example'});assert.equal(blocked.status,403);
});
test('connect stores only encrypted session data and does not return credentials',async()=>{
  const ctx=setup(),result=await connect(ctx);
  assert.equal(ctx.repo.connections.size,1);assert.equal(ctx.repo.snapshots.size,1);
  const stored=[...ctx.repo.connections.values()][0];assert.equal(stored.token_hash,await hashToken(TOKEN));assert.notEqual(stored.token_hash,TOKEN);
  for(const value of [JSON.stringify(stored),JSON.stringify(result)]){assert.ok(!value.includes(session.espnS2));assert.ok(!value.includes(TOKEN));}
  assert.equal(result.snapshot.rules.scoringItems.find(s=>s.statId===2).points,-1);
});
test('failed initial import cannot create a falsely connected league',async()=>{
  const ctx=setup();ctx.setFailure(403);
  const r=await call(ctx.handler,'connect',{body:{...identity,session}});
  assert.equal(r.status,401);assert.equal(ctx.repo.connections.size,0);assert.equal(ctx.repo.snapshots.size,0);
});
test('unknown tokens and foreign league selectors cannot read another device’s data',async()=>{
  const ctx=setup();await connect(ctx);
  assert.equal((await call(ctx.handler,'snapshot',{token:OTHER,params:identity})).status,401);
  const foreign=await call(ctx.handler,'snapshot',{params:{leagueId:999,season:2026}});assert.equal(foreign.status,404);
  await connect(ctx,OTHER);assert.equal(ctx.repo.connections.size,2);
  const list=await(await call(ctx.handler,'leagues',{token:OTHER})).json();assert.equal(list.leagues.length,1);
  assert.ok(!JSON.stringify(list).includes('session_cipher'));assert.ok(!JSON.stringify(list).includes('token_hash'));
});
test('failed refresh preserves the prior snapshot and exposes a reconnect state',async()=>{
  const ctx=setup();await connect(ctx);const before=clone([...ctx.repo.snapshots.values()][0].snapshot);
  ctx.setTime('2026-10-16T18:01:00.000Z');ctx.setFailure(403);
  const r=await call(ctx.handler,'refresh',{body:identity});assert.equal(r.status,401);
  const saved=[...ctx.repo.snapshots.values()][0];assert.deepEqual(saved.snapshot,before);assert.equal(saved.status,'reconnect_required');
  const read=await(await call(ctx.handler,'snapshot',{params:identity})).json();assert.equal(read.snapshot.importedAt,NOW);assert.equal(read.status,'reconnect_required');
  assert.ok(!JSON.stringify(read).includes('private upstream text'));
});
test('refresh uses a lease and protects ESPN against immediate repeated requests',async()=>{
  const ctx=setup();await connect(ctx);const count=ctx.normal.calls.length;
  const r=await(await call(ctx.handler,'refresh',{body:identity})).json();assert.equal(r.cached,true);assert.equal(ctx.normal.calls.length,count);
  ctx.setTime('2026-10-16T18:01:00.000Z');const refreshed=await(await call(ctx.handler,'refresh',{body:identity})).json();assert.equal(refreshed.cached,false);assert.equal(refreshed.snapshot.importedAt,'2026-10-16T18:01:00.000Z');
});
test('scheduler requires its own secret and refreshes without a browser token',async()=>{
  const ctx=setup();await connect(ctx);ctx.setTime('2026-10-16T18:21:00.000Z');
  const no=await call(ctx.handler,'scheduled',{token:null,body:{},origin:null});assert.equal(no.status,401);
  const yes=await call(ctx.handler,'scheduled',{token:null,body:{},origin:null,headers:{'X-ESPN-Scheduler':ctx.repo.schedulerToken}});assert.equal(yes.status,200);assert.equal((await yes.json()).succeeded,1);
  assert.equal([...ctx.repo.snapshots.values()][0].snapshot.importedAt,'2026-10-16T18:21:00.000Z');
});
test('disconnect deletes snapshots and invalidates subsequent access',async()=>{
  const ctx=setup();await connect(ctx);assert.equal((await call(ctx.handler,'disconnect',{body:{}})).status,200);assert.equal(ctx.repo.connections.size,0);assert.equal(ctx.repo.snapshots.size,0);assert.equal((await call(ctx.handler,'snapshot',{params:identity})).status,401);
});

test('site messages cannot trigger cookie reads or access the extension’s privileged commands',async()=>{
  let listener,cookieReads=0;const id='a'.repeat(32),storage={};
  const chrome={runtime:{id,getURL:path=>`chrome-extension://${id}/${path.replace(/^\//,'')}`,getManifest:()=>({version:'0.1.0'}),onMessage:{addListener:fn=>listener=fn}},action:{onClicked:{addListener(){}}},
    storage:{local:{async get(key){return typeof key==='string'?{[key]:storage[key]}:storage;},async set(values){Object.assign(storage,values);},async remove(keys){for(const k of keys)delete storage[k];},async setAccessLevel(value){assert.equal(value.accessLevel,'TRUSTED_CONTEXTS');}}},
    cookies:{async get(){cookieReads++;return null;}},tabs:{async query(){return[];},async create(){return{};},async sendMessage(){}}};
  const source=readFileSync(new URL('../extensions/espn-connector/worker.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
  vm.runInNewContext(source,{chrome,leagueIdentity,URL,crypto,AbortSignal,fetch,console});
  const dispatch=(command,url='https://davidsolar.dev/trade-analyzer/',other={})=>new Promise(resolve=>listener({source:'sdn-espn-bridge-v1',command,...other},{id,url},resolve));
  assert.equal((await dispatch('ping')).ok,true);
  assert.equal((await dispatch('connect',undefined,identity)).ok,false);assert.equal(cookieReads,0);
  assert.equal((await dispatch('openLeagues')).ok,false);
  assert.equal((await dispatch('ping','https://evil.example/trade-analyzer/')).ok,false);
  assert.equal((await dispatch('connect','file:///connect.html',identity)).ok,false);assert.equal(cookieReads,0);
  assert.equal((await dispatch('connect',`chrome-extension://${id}/connect.html`,identity)).error.code,'sign_in_required');assert.equal(cookieReads,2);
});

test('packaged extension and backend share the same parser and do not expose backend secrets',()=>{
  const shared=readFileSync(new URL('../trade-analyzer/lib/espn.mjs',import.meta.url),'utf8');
  for(const path of ['../extensions/espn-connector/espn.mjs','../supabase/functions/espn-sync/espn.mjs'])assert.equal(readFileSync(new URL(path,import.meta.url),'utf8'),shared);
  const manifest=JSON.parse(readFileSync(new URL('../extensions/espn-connector/manifest.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.permissions,['cookies','storage']);
  assert.ok(manifest.content_scripts[0].matches.every(x=>x.includes('/trade-analyzer/')));
  for(const path of ['../trade-analyzer/app.mjs','../extensions/espn-connector/bridge.js','../extensions/espn-connector/connect.mjs']){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');assert.ok(!source.includes('SUPABASE_SERVICE_ROLE_KEY'));assert.ok(!source.includes('innerHTML'));
  }
});
