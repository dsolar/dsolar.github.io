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
// Scheduled guarantees survive waivers and each offseason.
s=fixture();s.players=[{...player('guaranteed',c,10),years:3,schedule:[12,14]}];assert(E.release(s,c,'guaranteed').ok);assert.equal(E.payroll(s,c),10);s.phase='results';E.rollover(s);assert.equal(E.payroll(s,c),12);s.phase='results';E.rollover(s);assert.equal(E.payroll(s,c),14);s.phase='results';E.rollover(s);assert.equal(E.payroll(s,c),0);
// Minimum/maximum depend on service, and a cap hold is replaced by a signing.
s=fixture();let f={...player('min',null,3),market:3,yos:0};s.players=[f];assert(E.minimum(s,f)<E.minimum(s,{...f,yos:10}));assert.equal(E.maximum(s,f),Math.round(E.limits(s.year).cap*.25*100)/100);assert(!E.sign(s,c,'min',E.maximum(s,f)+1,1).ok);
// Mid-levels are a finite pool with persistent hard caps, including pending offer sheets.
s=fixture();s.teams[c].dead=E.limits(s.year).cap;s.players=[{...player('r',null,5),rights:b,rfa:true},{...player('u',null,12),market:12}];assert(E.sign(s,c,'r',5,2).ok);assert(s.offers[0].route.hard);assert(!E.sign(s,c,'u',12,2).ok,'pending sheet reserves MLE');assert(E.resolve(s,'r',false).ok);assert.equal(s.teams[c].mleUsed,5);assert(!E.sign(s,c,'u',12,2).ok,'committed MLE cannot be reused');
s=fixture();s.teams[c].dead=E.limits(s.year).first-1;s.players=[{...player('taxmle',null,5),market:5}];assert(E.sign(s,c,'taxmle',5,2).ok);assert.equal(s.teams[c].hardCap,E.limits(s.year).second);
// A completed season closes trades and FA; opening another offseason twice cannot age everyone.
s=seed();s.phase='results';const snapshot=JSON.stringify(s);assert(!E.evaluateTrade(s,c,b,[],['bad']).ok);assert(!E.sign(s,c,'bad',5,1).ok);assert.equal(JSON.stringify(s),snapshot);E.rollover(s);let age=s.players[0].age;assert(!E.rollover(s).ok);assert.equal(s.players[0].age,age);
// Talent uses impact, and deeper rotations cushion injuries. Health isn't applied twice.
s=fixture();s.players=[{...player('star',c,10,90),o:5,d:2,h:.5},{...player('backup',c,2,60),o:-2,d:-1,h:.9}];const strength=E.strength(s,c);s.players[0].h=.95;assert.equal(E.strength(s,c),strength);assert(E.strength(s,c,p=>p.id!=='star')<strength);
// Monte Carlo: stationary injury burden tracks health; every season conserves results.
let played=0,opportunities=0,healthyPlayed=0,healthyOpportunities=0,wins=0;
for(let run=0;run<40;run++){s=seed();s.seed=run*991+23;for(const code of Object.keys(s.teams))while(E.roster(s,code).length<14)s.players.push({...player(code+'-extra-'+s.players.length,code,3),h:.85});for(const p of s.players)p.h=p.id===s.players[0].id?.6:.9;const id=s.players[0].id,other=s.players.find(p=>p.team&&p.id!==id).id;assert(E.simulate(s).ok);const h=s.history.at(-1);played+=h.availability[id];opportunities+=82;healthyPlayed+=h.availability[other];healthyOpportunities+=82;wins+=Object.values(h.records).reduce((n,r)=>n+r.w,0);E.validate(s);}
assert(Math.abs(played/opportunities-.6)<.06,`fragile availability ${played/opportunities}`);assert(Math.abs(healthyPlayed/healthyOpportunities-.9)<.04,`healthy availability ${healthyPlayed/healthyOpportunities}`);assert.equal(wins,40*30*41);
s=seed();s.injuries='off';for(const code of Object.keys(s.teams))while(E.roster(s,code).length<14)s.players.push(player(code+'-extra-'+s.players.length,code,3));assert(E.simulate(s).ok);for(const p of s.players.filter(p=>p.team))assert.equal(s.history.at(-1).availability[p.id],82);
console.log(`Passed: scheduled dead money, service-based salary bounds, MLE reservations/hard caps, phase guards, rotation depth and 40-season injury calibration (${(100*played/opportunities).toFixed(1)}% / ${(100*healthyPlayed/healthyOpportunities).toFixed(1)}%).`);
// An imported save is rendered into the page: anything but the plain numbers and text the game writes is rejected.
s=seed();for(const code of Object.keys(s.teams))while(E.roster(s,code).length<13)s.players.push(player(code+'-fill-'+s.players.length,code,3));assert(E.simulate(s).ok);const played1=JSON.parse(JSON.stringify(s));E.validate(played1);
const evil='<img src=x onerror=alert(1)>',tamper=fn=>{const t=JSON.parse(JSON.stringify(s));fn(t);return t;};
for(const [what,fn] of [['history year',t=>{t.history[0].year=evil;}],['record',t=>{t.history[0].records[c].w=evil;}],['unknown team record',t=>{t.history[0].records.XX={w:1,l:1};}],['availability',t=>{t.history[0].availability[t.players[0].id]=evil;}],['dead money',t=>{t.teams[c].deadContracts=[{name:'x',salary:1,years:evil}];}],['asset',t=>{t.teams[c].assets=[{year:evil,round:1}];}],['offer',t=>{t.offers=[{player:t.players[0].id,bidder:c,owner:b,salary:1,years:evil,expires:2}];}],['log',t=>{t.log=[{year:evil,day:0,text:'x'}];}]])
  assert.throws(()=>E.validate(tamper(fn)),undefined,`a tampered ${what} must be rejected`);
console.log('Passed: imported saves with markup or malformed history, dead money, assets, offers or log are rejected.');
