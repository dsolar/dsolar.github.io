const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{JSDOM}=require("jsdom");
const ROOT=path.join(__dirname,".."),html=fs.readFileSync(path.join(ROOT,"cbb/index.html"),"utf8"),core=fs.readFileSync(path.join(ROOT,"cbb/model.js"),"utf8"),app=fs.readFileSync(path.join(ROOT,"cbb/app.js"),"utf8");
const data=JSON.parse(fs.readFileSync(path.join(ROOT,"cbb/data/hub.json"),"utf8"));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<80;i++){if(fn())return;await pause(10);}assert.fail("UI condition did not settle");}
async function boot(hash="#/today",live=null){
 const dom=new JSDOM(html,{url:"https://davidsolar.dev/cbb/"+hash,runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
 w.AbortSignal.timeout=()=>new w.AbortController().signal;
 w.fetch=async url=>{if(String(url).includes("espn.com")){if(!live)throw Error("offline test");return {ok:true,json:async()=>structuredClone(live)};}return {ok:true,json:async()=>structuredClone(data)};};
 const ready=new Promise(resolve=>w.document.addEventListener("cbb:ready",resolve,{once:true}));
 w.eval(core);w.eval(app);await ready;await pause(0);return w;
}
async function go(w,hash){w.location.hash=hash;await until(()=>w.document.querySelector('[data-tab="'+(hash.includes("team?")?"teams":hash.split("/")[1].split("?")[0])+'"]')?.getAttribute("aria-current")==="page");await pause(15);}
test("every primary section renders from the actual college snapshot",async()=>{
 const w=await boot();try{
  for(const name of ["today","rankings","conferences","teams","players","march","sources"]){
   await go(w,"#/"+name);const text=w.document.querySelector("#view").textContent;
   assert.ok(text.trim().length>200,name+" has useful content");assert.ok(!/\bundefined\b|\bNaN\b/.test(text),name+" does not invent missing values");
  }
 }finally{w.close();}
});
test("rankings search and conference filters narrow the actual team pool",async()=>{
 const w=await boot("#/rankings");try{
  const team=data.teams.find(t=>t.conference==="ACC")||data.teams[0];
  const q=w.document.querySelector("#hub-search");q.value=team.short;q.dispatchEvent(new w.Event("input",{bubbles:true}));await pause(200);
  const names=[...w.document.querySelectorAll("tbody .team-lockup a")].map(a=>a.textContent);assert.ok(names.includes(team.short));assert.ok(names.length<35);
  w.location.hash="#/rankings?conference="+encodeURIComponent(team.conference);await pause(30);
  const conf=[...w.document.querySelectorAll("tbody .team-lockup small")].map(a=>a.textContent);assert.ok(conf.length>0&&conf.every(x=>x===team.conference));
 }finally{w.close();}
});
test("advanced mode reveals analytical columns and its controls remain valid",async()=>{
 const w=await boot("#/rankings");try{
  const before=w.document.querySelectorAll("thead th").length,control=w.document.querySelector("#advanced");control.checked=true;control.dispatchEvent(new w.Event("change",{bubbles:true}));
  assert.ok(w.document.querySelectorAll("thead th").length>before);assert.ok(w.document.querySelector('[data-sort="margin"]'));
  assert.equal(w.document.querySelectorAll("button button").length,0);
  w.document.querySelector('[data-sort="margin"]').click();assert.ok(w.location.hash.includes("sort=margin"));
 }finally{w.close();}
});
test("following a team persists locally and the following-only team grid is correct",async()=>{
 const w=await boot("#/teams");try{
  const star=w.document.querySelector("[data-favorite]"),id=star.dataset.favorite;star.click();
  assert.ok(JSON.parse(w.localStorage.getItem("ds-cbb:favorites")).includes(id));
  w.location.hash="#/teams?favorites=1";await pause(30);const tiles=w.document.querySelectorAll(".team-tile");assert.equal(tiles.length,1);assert.equal(tiles[0].querySelector("[data-favorite]").dataset.favorite,id);
 }finally{w.close();}
});
test("team profiles include their actual roster and comparisons resolve both teams",async()=>{
 const t=data.teams[0],other=data.teams[1],w=await boot("#/team?id="+t.id);try{
  assert.ok(w.document.querySelector("#view").textContent.includes(t.short));assert.ok(w.document.querySelectorAll("[data-player]").length>0);
  w.location.hash="#/compare?a="+t.id+"&b="+other.id;await pause(30);const text=w.document.querySelector("#view").textContent;
  assert.ok(text.includes(t.short)&&text.includes(other.short));assert.ok(text.includes("Adjusted offense"));
 }finally{w.close();}
});
test("player search opens a real player card and reports its source",async()=>{
 const p=data.players.find(p=>p.stats.pts>10),w=await boot("#/players?q="+encodeURIComponent(p.name));try{
  const button=w.document.querySelector('[data-player="'+p.id+'"]');assert.ok(button);button.click();const d=w.document.querySelector("#player-card");
  assert.ok(d.open);assert.equal(w.document.querySelector("#player-title").textContent,p.name);assert.ok(d.textContent.includes("ESPN roster snapshot"));
  d.querySelector(".close").click();assert.equal(d.open,false);
 }finally{w.close();}
});
test("the March views show 64 slots and twelve actual Opening Round pairings",async()=>{
 const w=await boot("#/march");try{
  assert.equal(w.document.querySelectorAll(".seed-row").length,64);
  w.document.querySelector('[data-march-mode="opening"]').click();
  assert.equal(w.document.querySelectorAll(".grid.three .panel").length,12);
  assert.ok(w.document.querySelector("#view").textContent.includes("Haslametrics"));
 }finally{w.close();}
});
test("a live scoreboard response updates scores and credits its refresh time",async()=>{
 const a=data.teams[0],b=data.teams[1],live={leagues:[{season:{year:data.season}}],events:[{id:"test-fixture",date:new Date().toISOString(),season:{year:data.season},competitions:[{competitors:[{id:a.id,homeAway:"home",score:"121"},{id:b.id,homeAway:"away",score:"119"}],status:{type:{state:"in",shortDetail:"0:10 - OT"}},broadcasts:[{names:["Test fixture"]}]}]}]};
 const w=await boot("#/today",live);try{
  await until(()=>w.document.querySelector("#view").textContent.includes("119–121"));
  assert.ok(w.document.querySelector("#score-stamp").textContent.includes("ESPN scores checked"));
  assert.ok(w.document.querySelector(".tag.live"));
 }finally{w.close();}
});
