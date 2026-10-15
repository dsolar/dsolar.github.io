const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const E=require('./engine.js');const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../src/31st-franchise/data.js','utf8')+';globalThis.data=PLAYERS;globalThis.names=TEAMS;',ctx);
const seed=()=>E.seed(JSON.parse(JSON.stringify(ctx.data)),JSON.parse(JSON.stringify(ctx.names)));
let s=seed();E.validate(s);assert.equal(Object.keys(s.teams).length,30);assert.equal(new Set(s.players.map(p=>p.id)).size,s.players.length);
const c='BOS',b='BRK';const p=s.players.find(p=>p.team===b);const was=JSON.stringify(s);const bad=E.trade(s,c,b,[p.id],[p.id]);assert(!bad.ok);assert.equal(JSON.stringify(s),was,'invalid trade must be atomic');
// Explicit apron and matching fixtures.
function fixture(){let t=seed();t.players=[];t.user=c;t.teams[c].dead=0;t.teams[b].dead=0;return t;}
function player(id,team,salary,ovr=75){return {id,name:id,team,salary,ovr,age:26,pos:'SG',potential:ovr,market:salary,years:2,schedule:[salary],newUntil:0};}
s=fixture();const l=E.limits(s.year);s.players=[player('a',c,20),player('b',b,30)];s.teams[c].dead=l.first;assert(!E.evaluateTrade(s,c,b,['a'],['b']).legal,'first apron incoming excess blocked');
s=fixture();s.players=[player('a',c,20),player('a2',c,20),player('b',b,35)];s.teams[c].dead=l.second;assert(!E.evaluateTrade(s,c,b,['a','a2'],['b']).legal,'second apron aggregation blocked');
// RFA reservation, deadline and matching.
s=fixture();s.players=[{...player('rfa',null,5,80),rights:b,rfa:true,tenure:3,hold:7.5}];let r=E.sign(s,c,'rfa',5,2);assert(r.ok);assert.equal(s.offers.length,1);assert.equal(s.players[0].team,null);assert(!E.sign(s,c,'rfa',5,2).ok);assert(E.resolve(s,'rfa',true).ok);assert.equal(s.players[0].team,b);assert.equal(s.offers.length,0);
s=fixture();s.players=[{...player('ufa',null,5),rights:null}];assert(!E.sign(s,c,'ufa',NaN,2).ok);assert(!E.sign(s,c,'ufa',5,9).ok);assert(E.sign(s,c,'ufa',5,2).ok);assert(!E.sign(s,b,'ufa',5,2).ok);
// Import actual player identity, remove from original club, retain assets.
let data=JSON.parse(JSON.stringify(ctx.data)),names=JSON.parse(JSON.stringify(ctx.names));let raws=data.filter(p=>p.t!=='BOS'&&p.st==='con').slice(0,14);const ex={version:1,user:'SEA',teams:{SEA:{name:'Seattle SuperSonics',roster:raws,assets:[{year:2029,round:1,nba:'PHI'}],waived:[],depth:{},coach:'balanced'}},results:{SEA:{w:31,l:51}}};
s=E.seed(data,names,ex);assert.equal(s.year,2028);assert.equal(Object.keys(s.teams).length,31);assert.equal(s.teams.SEA.assets.length,1);assert.equal(new Set(s.players.map(p=>p.id)).size,s.players.length);for(const raw of raws){const x=s.players.find(p=>p.id===raw.key);assert.equal(x.team,x.years>0?'SEA':null);}
// 30/31/32 team schedules: every team plays 82; no extra wins.
for(const n of [30,31,32]){s=seed();if(n>30)s.teams.SEA={name:'Seattle',spend:'apron',assets:[],taxHistory:[],dead:0};if(n>31)s.teams.LV={name:'Las Vegas',spend:'apron',assets:[],taxHistory:[],dead:0};for(const code of Object.keys(s.teams))while(E.roster(s,code).length<13)s.players.push(player(code+'-fill-'+s.players.length,code,3));assert(E.simulate(s).ok);const h=s.history.at(-1);for(const rec of Object.values(h.records))assert.equal(rec.w+rec.l,82,`${n} team schedule`);assert.equal(Object.values(h.records).reduce((a,r)=>a+r.w,0),n*41);const year=s.year;E.rollover(s);assert.equal(s.year,year+1);E.validate(s);}
// Tax rises progressively and repeater status increases cost.
s=seed();let pay=E.limits(s.year).tax+20;let normal=E.tax(s,c,pay);s.teams[c].taxHistory=[true,true,true];assert(E.tax(s,c,pay)>normal);
console.log('Passed: atomic trades, apron legality, RFA reservation/matching, FA validation, import identity/assets, 30/31/32-team schedules, rollover, progressive tax.');
