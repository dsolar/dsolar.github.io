const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const M=require("../cbb/model.js");
const sample=[
{id:"a",name:"A",short:"A",conference:"East",haslamRank:1,metrics:{adjO:125,adjD:90,tempo:72}},
{id:"b",name:"B",short:"B",conference:"West",haslamRank:2,metrics:{adjO:120,adjD:94,tempo:68}},
{id:"c",name:"C",short:"C",conference:"East",haslamRank:3,metrics:{adjO:110,adjD:100,tempo:64}},
{id:"d",name:"D",short:"D",conference:"West",haslamRank:null,metrics:{adjO:null,adjD:null,tempo:null}}
];
test("missing metrics remain missing while a real zero survives",()=>{assert.equal(M.num(null),null);assert.equal(M.num(""),null);assert.equal(M.num(0),0);assert.equal(M.mean([null,0,10]),5);assert.equal(M.em(sample[3]),null);});
test("conference strength uses available team ratings and reports its coverage",()=>{const c=M.conferences(sample);assert.equal(c[0].name,"West");assert.equal(c[0].rated,1);assert.equal(c[0].average,26);assert.equal(c[1].average,22.5);});
test("rankings put unavailable ranks after rated teams",()=>assert.deepEqual(M.ranked(sample).map(t=>t.id),["a","b","c","d"]));
test("a neutral-court estimate changes only by the documented home adjustment",()=>{const h=M.matchup(sample[0],sample[1]),n=M.matchup(sample[0],sample[1],true);assert.equal(M.round(h.homeMargin-n.homeMargin),3);assert.equal(M.matchup(sample[0],sample[3]),null);});
test("player search preserves zero scoring and never promotes missing values",()=>{const ps=[{id:"1",name:"Bench",stats:{pts:0}},{id:"2",name:"Missing",stats:{}},{id:"3",name:"Scorer",stats:{pts:20}}];assert.deepEqual(M.selectPlayers(ps).map(p=>p.id),["3","1","2"]);});
test("a 76-team field produces 64 main-bracket slots and twelve opening games",()=>{
 const ts=Array.from({length:365},(_,i)=>({id:String(i),name:"Team "+i,short:"T"+i,conference:"C"+i%32,haslamRank:i+1,metrics:{adjO:130-i/20,adjD:90+i/20}}));
 const f=M.strengthField(ts);assert.equal(f.field.length,76);assert.equal(f.automatic,32);assert.equal(f.regions.flat().length,64);assert.equal(f.regions.flat().filter(s=>s.teams.length===2).length,12);assert.equal(new Set(f.field.map(t=>t.id)).size,76);
});
test("the published snapshot is current-season, complete and internally consistent",()=>{
 const d=JSON.parse(fs.readFileSync(path.join(__dirname,"../cbb/data/hub.json"),"utf8"));
 assert.equal(d.sport,"ncaam");assert.ok(d.teams.length>=350);assert.ok(d.players.length>=2500);
 const ids=new Set(d.teams.map(t=>t.id));assert.equal(ids.size,d.teams.length);
 assert.ok(d.teams.filter(t=>M.finite(t.haslamRank)).length>=300);
 assert.equal(new Set(d.players.map(p=>p.id)).size,d.players.length);
 for(const p of d.players){assert.ok(ids.has(p.teamId));for(const v of Object.values(p.stats||{}))assert.ok(v===null||Number.isFinite(v));}
 for(const g of d.games){assert.ok(ids.has(g.home)&&ids.has(g.away));if(g.state==="pre")assert.equal(g.homeScore,null);}
 assert.equal(d.sources.kenpom.status,"linked");assert.equal(d.sources.evanmiya.status,"linked");
 assert.ok(d.march,"A real provider bracket must be present");const slots=d.march.slots;
 assert.equal(slots.length,64);assert.equal(slots.filter(s=>s.teamIds.length===2).length,12);
 const field=slots.flatMap(s=>s.teamIds);assert.equal(field.length,76);assert.equal(new Set(field).size,76);
 for(const id of field)assert.ok(ids.has(id));
 for(let seed=1;seed<=16;seed++)assert.equal(slots.filter(s=>s.seed===seed).length,4,"four slots on seed "+seed);
});

test("game snapshots use the New York game day and never manufacture pregame scores",()=>{
 const data={events:[{id:"x",date:"2026-11-17T02:00:00Z",season:{year:2027},competitions:[{competitors:[{id:"a",homeAway:"home",score:"0"},{id:"b",homeAway:"away",score:"0"}],status:{type:{state:"pre"}}}]}]};
 const out=M.gamesFromESPN(data,Object.fromEntries(sample.map(t=>[t.id,t])),2027);
 assert.equal(out.length,1);assert.equal(out[0].day,"2026-11-16");assert.equal(out[0].homeScore,null);
 data.events[0].competitions[0].status.type={state:"post",description:"Final"};data.events[0].competitions[0].competitors[0].score="103";
 const final=M.gamesFromESPN(data,Object.fromEntries(sample.map(t=>[t.id,t])),2027)[0];assert.equal(final.homeScore,103);assert.equal(final.awayScore,0);
 assert.equal(M.gamesFromESPN(data,{},2027).length,0);assert.equal(M.gamesFromESPN(data,Object.fromEntries(sample.map(t=>[t.id,t])),2026).length,0);
});
