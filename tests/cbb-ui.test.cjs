const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{JSDOM}=require("jsdom");
const ROOT=path.join(__dirname,".."),html=fs.readFileSync(path.join(ROOT,"cbb/index.html"),"utf8").replace(/<script[^>]*src=[^>]*><\/script>/g,"");
const follow=fs.readFileSync(path.join(ROOT,"assets/follow.js"),"utf8"),search=fs.readFileSync(path.join(ROOT,"assets/search.js"),"utf8"),pcard=fs.readFileSync(path.join(ROOT,"assets/pcard.js"),"utf8"),core=fs.readFileSync(path.join(ROOT,"cbb/model.js"),"utf8"),app=fs.readFileSync(path.join(ROOT,"cbb/app.js"),"utf8");
const data=JSON.parse(fs.readFileSync(path.join(ROOT,"cbb/data/hub.json"),"utf8")),extras=JSON.parse(fs.readFileSync(path.join(ROOT,"cbb/data/extras.json"),"utf8"));
const board=JSON.parse(fs.readFileSync(path.join(ROOT,"draft/nba.json"),"utf8")),sched=JSON.parse(fs.readFileSync(path.join(ROOT,"cbb/data/schedule.json"),"utf8"));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await pause(10);}assert.fail("UI condition did not settle");}
async function boot(hash="#/today",live=null){
 const dom=new JSDOM(html,{url:"https://davidsolar.dev/cbb/"+hash,runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
 w.scrollTo=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
 w.AbortSignal.timeout=()=>new w.AbortController().signal;
 w.fetch=async url=>{url=String(url);if(url.includes("espn.com")){if(!live)throw Error("offline test");return {ok:true,json:async()=>structuredClone(live)};}
  const body=url.includes("draft/nba")?board:url.includes("extras")?extras:url.includes("schedule")?sched:data;return {ok:true,json:async()=>structuredClone(body)};};
 const ready=new Promise(resolve=>w.document.addEventListener("cbb:ready",resolve,{once:true}));
 w.eval(follow);w.eval(search);w.eval(pcard);w.eval(core);w.eval(app);await ready;await pause(0);return w;
}
async function go(w,hash){w.location.hash=hash;const page=hash.split("/")[1].split("?")[0];await until(()=>w.document.body.dataset.page===page);await pause(20);}
const text=w=>w.document.querySelector("#view").textContent;

test("every section renders from the actual snapshot without inventing values",async()=>{
 const w=await boot();try{
  for(const name of ["today","ratings","matchup","conferences","teams","players","naismith","prospects","bracket","bubble","method"]){
   await go(w,"#/"+name);assert.ok(text(w).trim().length>300,name+" has useful content");assert.ok(!/\bundefined\b|\bNaN\b/.test(text(w)),name+" does not print missing values");
  }
  await go(w,"#/ratings?view=chart");assert.ok(w.document.querySelector("svg.sc-chart circle"));
 }finally{w.close();}
});
test("tonight's games carry a line, a total and a watchability score",async()=>{
 const day=data.games.find(g=>g.state==="pre").day,w=await boot("#/today?day="+day);try{
  const cards=w.document.querySelectorAll(".gm");assert.ok(cards.length>0);
  const pre=[...cards].find(c=>/O\/U/.test(c.textContent));assert.ok(pre,"a pregame card shows a total");
  assert.ok(Number(pre.dataset.watch)>=0&&Number(pre.dataset.watch)<=100);
  const ws=[...cards].filter(c=>!c.classList.contains("is-live")).map(c=>Number(c.dataset.watch));
 }finally{w.close();}
});
test("the spread machine is symmetric and home court is worth the documented edge",async()=>{
 const [a,b]=[data.teams[0],data.teams[1]],w=await boot("#/matchup?a="+a.id+"&b="+b.id+"&site=n");try{
  const M=w.CBB,avg=M.leagueAvg(data.teams),n=M.line(b,a,true,avg),flip=M.line(a,b,true,avg);
  assert.equal(M.round(n.spread+flip.spread),0);assert.equal(M.round(n.homeProb+flip.homeProb,2),1);
  const h=M.line(b,a,false,avg),edge=M.homeEdgeFor(b,a);assert.ok(Math.abs(h.spread-n.spread-edge)<=0.11,"home edge "+(h.spread-n.spread)+" vs "+edge);assert.ok(edge>=Math.min(M.HOME_EDGE,3)-0.01&&edge<=6);
  assert.ok(text(w).includes(a.short)&&text(w).includes(b.short));assert.ok(w.document.querySelector(".pg .pg-verdict"),"the shared game page");
  const tb=w.document.querySelector('.pg [data-ctab="players"]');assert.ok(tb,"a Players tab");tb.click();
  assert.ok(!w.document.querySelector('[data-pane="players"]').hidden&&w.document.querySelector('[data-pane="matchup"]').hidden,"tabs switch panes");
  assert.ok(w.document.querySelector('[data-pane="players"] [data-out]'),"who sits is on the Players tab");
  w.document.querySelector("[data-swap]").click();await pause(20);assert.ok(w.location.hash.includes("a="+b.id));
 }finally{w.close();}
});
test("ratings search and conference filters narrow the team pool",async()=>{
 const team=data.teams.find(t=>t.conference==="ACC")||data.teams[0],w=await boot("#/ratings?conf="+encodeURIComponent(team.conference));try{
  const rows=[...w.document.querySelectorAll("tbody tr")];assert.ok(rows.length>0&&rows.length<30);
  assert.ok(rows.every(r=>r.querySelector("small.cf").textContent.startsWith(team.conference)));
  w.document.querySelector('[data-sort="adjD"]').click();assert.ok(w.location.hash.includes("sort=adjD"));
 }finally{w.close();}
});
test("standings open on the strongest eight conferences, with a button for the rest",async()=>{
 const w=await boot("#/teams");try{
  assert.equal(w.document.querySelectorAll("table.st").length,8,"eight conferences to start");
  assert.match(w.document.querySelector("[data-more]").textContent,/Show the other \d+ conferences/);
 }finally{w.close();}
});
test("following a team saves to the shared (synced) list, carries over the old one, and filters the standings",async()=>{
 const w=await boot("#/teams?all=1");try{
  assert.ok(w.document.querySelectorAll("table.st").length>=30,"a standings table for every conference");
  const star=w.document.querySelector("[data-follow]"),id=star.dataset.follow.split(":")[1];star.click();
  assert.ok(JSON.parse(w.localStorage.getItem("ds-fav:ncaab")).includes(id));
  await go(w,"#/teams?follow=1");assert.equal(w.document.querySelectorAll("table.st tbody tr").length,1);
  assert.ok(w.document.querySelector("table.st tr.mine"));
  await go(w,"#/today");assert.ok(w.document.querySelector(".ds-yours"),"your teams on Today");
  w.localStorage.removeItem("ds-fav:ncaab");w.localStorage.setItem("ds-cbb:favorites",JSON.stringify([id]));
  assert.equal(JSON.stringify(w.Follow.list("ncaab")),JSON.stringify([id]),"the old list carries over");
 }finally{w.close();}
});
test("team pages show the roster with Naismith and Big Board tags, and a player card opens",async()=>{
 const first=extras.naismith.ladder[0],p=data.players.find(x=>x.id===first.id),w=await boot("#/team?id="+p.teamId+"&v=roster");try{
  assert.ok(text(w).includes(p.name));assert.ok(w.document.querySelector(".pill.nai"));
  w.document.querySelector('[data-player="'+p.id+'"]').click();const d=w.document.querySelector("#card");
  assert.ok(d.open);assert.ok(d.textContent.includes(p.name));assert.ok(d.textContent.includes("Naismith ladder #"));
  // the shared card: tabs switch panes
  const st=d.querySelector('[data-ctab="st"]');assert.ok(st);st.click();assert.equal(d.querySelector('[data-pane="st"]').hidden,false);assert.equal(d.querySelector('[data-pane="ov"]').hidden,true);
  d.querySelector("[data-close]").click();assert.equal(d.open,false);
 }finally{w.close();}
});
test("Naismith Watch ranks all 50 listed players and prospects come from the Big Board",async()=>{
 const w=await boot("#/naismith");try{
  assert.equal(w.document.querySelectorAll(".nai-t tbody tr").length,50);
  await go(w,"#/prospects");await until(()=>w.document.querySelector("svg.spark"));
  const n=data.players.filter(p=>Number.isFinite(p.draftRank)).length;assert.equal(w.document.querySelectorAll("#view tbody tr").length,n);
 }finally{w.close();}
});
test("the bracket shows tournament odds, a 64-slot projected bracket and the provider's field",async()=>{
 const w=await boot("#/bracket");try{
  assert.equal(w.document.querySelectorAll(".regions .bs").length,64);assert.equal(w.document.querySelectorAll(".sl").length,16);assert.equal(w.document.querySelectorAll(".slot").length,64);
  assert.ok(w.document.querySelectorAll("table.odds tbody tr").length>=40);
  w.document.querySelector('[data-seg="show"][data-v="all"]').click();await pause(20);assert.equal(w.document.querySelectorAll("table.odds tbody tr").length,Object.keys(extras.season.teams).length);
  await go(w,"#/team?id="+data.teams[0].id);assert.ok(w.document.querySelector(".ladder"));
 }finally{w.close();}
});
test("bubble watch groups at-large hopefuls by conference, draws the cut line and shows swing games",async()=>{
 const w=await boot("#/bubble");try{
  assert.ok(w.document.querySelectorAll(".bconf").length>=4);assert.ok(w.document.querySelectorAll(".rlist.bub li.br").length>=10);
  assert.ok(w.document.querySelectorAll(".swc").length>=1);assert.match(text(w),/Wins Above Bubble/);
  w.document.querySelector('[data-seg="show"][data-v="cut"]').click();await pause(20);assert.ok(w.document.querySelector(".cutline"));
  const ins=[...w.document.querySelectorAll(".rlist.bub li.br .odd b")].map(b=>parseInt(b.textContent));for(let k=1;k<ins.length;k++)assert.ok(ins[k]<=ins[k-1]);
  for(const g of extras.season.swing){assert.ok(g.h[0]>=g.h[1]-1e-9&&g.a[0]>=g.a[1]-1e-9,"a win never hurts");}
 }finally{w.close();}
});
test("a live scoreboard response updates scores",async()=>{
 const g=data.games.find(x=>x.state==="pre"),live={leagues:[{season:{year:data.season}}],events:[{id:"live-fixture",date:g.at,season:{year:data.season},competitions:[{competitors:[{id:g.home,homeAway:"home",score:"121"},{id:g.away,homeAway:"away",score:"119"}],status:{type:{state:"in",shortDetail:"2nd 0:31"}}}]}]};
 const w=await boot("#/today?day="+g.day,live);try{
  await until(()=>w.document.querySelector(".gm.is-live .sc")&&/121/.test(text(w)));assert.ok(w.document.querySelector("#stamp").textContent.includes("Scores checked"));
 }finally{w.close();}
});
test("the hub is registered once and the sport switcher keeps page intent",async()=>{
 const w=await boot("#/ratings");try{
  w.eval(fs.readFileSync(path.join(ROOT,"assets/projects.js"),"utf8"));
  assert.equal(w.PROJECTS.filter(p=>p.url==="cbb/").length,1);assert.equal(w.PROJECTS.find(p=>p.url==="cbb/").hub,true);
  w.eval(fs.readFileSync(path.join(ROOT,"assets/hubswitch.js"),"utf8"));w.document.dispatchEvent(new w.Event("DOMContentLoaded"));await pause(10);
  const nav=w.document.querySelector(".hubswitch");assert.ok(nav);assert.equal(nav.querySelector('[data-hub="cbb"]').getAttribute("aria-current"),"page");
  assert.ok(nav.querySelector('[data-hub="nhl"]').href.endsWith("/nhl/#/standings"));
 }finally{w.close();}
});
test("team pages show the full season schedule and players have leaderboards",async()=>{
 const t=data.teams[0],n=sched.games.filter(g=>g.home===t.id||g.away===t.id).length,w=await boot("#/team?id="+t.id+"&v=schedule");try{
  await until(()=>w.document.querySelectorAll(".sched tbody tr").length===n);assert.ok(n>20,"a full season");
  await go(w,"#/players");assert.ok(w.document.querySelectorAll(".leaders .panel").length>=8);
  await go(w,"#/players?view=table&sort=gs");assert.ok(w.document.querySelector('th[data-sort="gs"].on'));
 }finally{w.close();}
});
test("search finds players and teams as you type and opens them",async()=>{
 const w=await boot("#/today");try{
  assert.ok(w.document.querySelector(".mast .ds-sbtn"),"a Search button in the header");
  const p=data.players.find(x=>x.name&&x.name.split(" ").length>=2);
  w.Search.open();const inp=w.document.querySelector("dialog.ds-srch input");
  inp.value=p.name.split(" ").slice(-1)[0].slice(0,4);inp.dispatchEvent(new w.Event("input"));
  const names=[...w.document.querySelectorAll(".ds-sr b")].map(b=>b.textContent);assert.ok(names.includes(p.name),"finds "+p.name);
  const t=data.teams[0];inp.value=t.name;inp.dispatchEvent(new w.Event("input"));
  inp.dispatchEvent(new w.KeyboardEvent("keydown",{key:"Enter"}));await pause(20);assert.ok(w.location.hash.includes("team?id="+t.id),"Enter opens the top match");
 }finally{w.close();}
});
