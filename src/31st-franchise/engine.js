// ===== Expansion rules (2027-28) =====
const LEAGUE_CAP = 176.0;                                   // NBA projection, Sept 2026
const EXP_CAP = Math.round(LEAGUE_CAP * 0.666 * 10) / 10;   // year-one expansion cap: 66.6% of league cap
const EXP_FLOOR = Math.round(EXP_CAP * 0.9 * 10) / 10;      // floor: 90% of the expansion cap
const PICKS = 14;
const MIN_FA = 2.6;                                         // minimum contract, signable over the cap

// ===== Depth chart =====
const POS5 = ["PG", "SG", "SF", "PF", "C"];
const START_MIN = [34, 33, 32, 30, 28];
const BENCH_MIN = [24, 20, 16, 13, 10, 0, 0, 0, 0];
const BENCH_SLOTS = 9;

// ===== Sim constants =====
const REPL = -2.5, SCALE = 1.5, KNEE = 10, KNEE_RATE = 0.55;
const HCA = 1.5, GAME_SD = 12, INJ_LEN = 8;
const COACHES = {
  balanced: { name: "Balanced", blurb: "No system. Plays the best five." },
  grind: { name: "Defense first", blurb: "Slow it down, win ugly. Rewards rosters that defend." },
  pace: { name: "Pace and space", blurb: "Run and shoot. Rewards rosters that score." }
};
const EXP = {
  SEA: { code: "SEA", city: "Seattle", nick: "SuperSonics", abbr: "SEA" },
  LV: { code: "LV", city: "Las Vegas", nick: "Outlaws", abbr: "LV" }
};
const HISTORY = [
  { team: "1966-67 Chicago Bulls", w: 33, l: 48, note: "Best expansion debut. Made the playoffs." },
  { team: "1989-90 Minnesota Timberwolves", w: 22, l: 60 },
  { team: "1995-96 Toronto Raptors", w: 21, l: 61 },
  { team: "1988-89 Charlotte Hornets", w: 20, l: 62 },
  { team: "1989-90 Orlando Magic", w: 18, l: 64 },
  { team: "2004-05 Charlotte Bobcats", w: 18, l: 64 },
  { team: "1988-89 Miami Heat", w: 15, l: 67 },
  { team: "1995-96 Vancouver Grizzlies", w: 15, l: 67 }
];

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
function gauss(rng){let u=0,v=0;while(!u)u=rng();while(!v)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function phi(x){const t=1/(1+0.2316419*Math.abs(x)),d=0.3989423*Math.exp(-x*x/2);let p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>0?1-p:p;}
function knee(v){return v<=KNEE?v:KNEE+(v-KNEE)*KNEE_RATE;}
const rating = p => p.o + p.d;
// Star power: impact above All-Star level (+2) counts extra, because stars carry teams more than a sum of parts
// suggests (the same idea as the +10% Noh's salary model gives MVP-level players)
const STAR_K = 0.35;
const star = p => STAR_K*Math.max(0, p.o + p.d - 2);
// Role stretch: a player pushed well past his usual minutes plays worse (bench players starting on expansion teams).
// 0.08 points per 100 for every minute beyond his 2025-26 role plus a four-minute cushion.
const ROLE_K = 0.08;
const roleMin = p => p.mpg!=null ? p.mpg : (rating(p)>=2?32:rating(p)>=1?30:rating(p)>=-0.9?25:rating(p)>=-2?17:10);
const stretch = (p,m) => ROLE_K*Math.max(0, m - roleMin(p) - 4);
// Display ratings are league percentiles (built in the data step): 99 is the best projected player, ~64 the median rotation player
const ovr = p => p.ovr ?? Math.max(30, Math.min(99, Math.round(60 + 3 * rating(p))));
const offR = p => p.offr ?? Math.max(25, Math.min(99, Math.round(60 + 5 * p.o)));
const defR = p => p.defr ?? Math.max(25, Math.min(99, Math.round(60 + 7 * p.d)));
const plays = p => (p.ps && p.ps.length ? p.ps : [p.bpos]);
// No penalty at any position a player actually plays (15%+ of his minutes, or his profile says he can).
// One spot beyond his range costs a little, two or more costs a lot.
function fitPenalty(p, slot){
  const si=POS5.indexOf(slot);
  const d=Math.min(...plays(p).map(x=>Math.abs(POS5.indexOf(x)-si)));
  return d===0?0:d===1?0.75:2.5;
}
const posLabel = p => plays(p).join("/");

// Generic minimum free agent, for when the board runs dry
function minimumFA(slot, n){
  return { key:"FA|"+slot+"|"+n, n:"Minimum free agent ("+slot+")", t:"FA", pos:slot==="C"?"B":(slot==="PG"||slot==="SG")?"G":"W", bpos:slot, ps:[slot],
    usg:15, astp:slot==="PG"?20:10, blk:slot==="C"?3:1, tpar:slot==="C"?0.1:0.4, ts:0.54, rm:0, ovr:64, offr:60, defr:65, ovn:64, tier:"Replacement",
    age:29, s:MIN_FA, yrs:1, st:"fa", o:-1.6, d:-0.7, mv:MIN_FA, ppg:null, rpg:null, apg:null, gp:0, h:0.92, prot:false, note:"Signed with the minimum exception", src:"fa" };
}

// ---------- NBA rotations: best ten by impact ----------
const NBA_MIN = [34, 33, 32, 30, 28, 24, 20, 16, 13, 10];
function rawOf(list){
  const r=[...list].sort((a,b)=>rating(b)-rating(a)).slice(0,10); let o=0,d=0;
  r.forEach((p,i)=>{const m=NBA_MIN[i], b=star(p)-stretch(p,m);o+=(p.o+b*0.6)*m/48;d+=(p.d+b*0.4)*m/48;});
  for(let i=r.length;i<10;i++){o+=REPL*0.6*NBA_MIN[i]/48;d+=REPL*0.4*NBA_MIN[i]/48;}
  return {o,d,raw:o+d};
}

// ---------- Expansion depth chart ----------
function emptyDepth(){ return { slots:{PG:null,SG:null,SF:null,PF:null,C:null}, bench:[], auto:true }; }
// Best starting five: maximize impact minus position penalties (searches the top nine players)
function autoDepth(roster){
  const cand=[...roster].sort((a,b)=>rating(b)-rating(a));
  const top=cand.slice(0,9);
  let best=-Infinity, bestA=null;
  const assign=new Array(5).fill(null), used=new Set();
  (function dfs(i,sum){
    if(i===5){ if(sum>best){best=sum;bestA=assign.slice();} return; }
    const slot=POS5[i]; let any=false;
    for(const p of top){ if(used.has(p.key)) continue; any=true; used.add(p.key); assign[i]=p; dfs(i+1,sum+rating(p)-fitPenalty(p,slot)); used.delete(p.key); assign[i]=null; }
    const remain=top.length-used.size, need=5-i;
    if(!any||remain<need){ dfs(i+1,sum+REPL-1); }
  })(0,0);
  const slots={}; POS5.forEach((s,i)=>slots[s]=bestA&&bestA[i]?bestA[i].key:null);
  const inStart=new Set(Object.values(slots).filter(Boolean));
  const bench=cand.filter(p=>!inStart.has(p.key)).map(p=>p.key);
  return { slots, bench, auto:true };
}
function addToDepth(depth, p, roster){
  if(depth.auto) return autoDepth(roster);
  const d={slots:{...depth.slots},bench:[...depth.bench],auto:false};
  const open=plays(p).find(s=>!d.slots[s]);
  if(open) d.slots[open]=p.key; else d.bench.push(p.key);
  return d;
}
function removeFromDepth(depth, key, roster){
  if(depth.auto) return autoDepth(roster);
  const d={slots:{...depth.slots},bench:depth.bench.filter(k=>k!==key),auto:false};
  POS5.forEach(s=>{ if(d.slots[s]===key){ d.slots[s]=d.bench.length?d.bench.shift():null; } });
  return d;
}
// Who plays tonight: healthy starters keep their spots, the best-fitting healthy bench player covers an injured starter
function lineup(depth, getP, isAvail){
  const L=[], used=new Set(), out=[];
  POS5.forEach(slot=>{ const k=depth.slots[slot]; const p=k?getP(k):null;
    if(p&&isAvail(p)){ L.push({p,slot,pen:fitPenalty(p,slot),start:true}); used.add(p.key); } else out.push(slot); });
  const bench=depth.bench.map(getP).filter(p=>p&&isAvail(p));
  out.forEach(slot=>{
    const c=bench.filter(p=>!used.has(p.key));
    if(!c.length){ L.push({p:null,slot,pen:0,start:true}); return; }
    let bi=0; c.forEach((p,i)=>{ if(fitPenalty(p,slot)<fitPenalty(c[bi],slot)) bi=i; });
    const p=c[bi]; used.add(p.key); L.push({p,slot,pen:fitPenalty(p,slot),start:true});
  });
  const st=L.slice().sort((a,b)=>(b.p?rating(b.p):-9)-(a.p?rating(a.p):-9)); st.forEach((x,i)=>x.m=START_MIN[i]);
  const rest=bench.filter(p=>!used.has(p.key)).map((p,i)=>({p,slot:"B"+(i+1),pen:0,start:false,m:BENCH_MIN[i]||0}));
  for(let i=rest.length;i<5;i++) rest.push({p:null,slot:"B"+(i+1),pen:0,start:false,m:BENCH_MIN[i]});
  return L.concat(rest);
}
function lineupRaw(lu){
  let o=0,d=0,pen=0;
  lu.forEach(x=>{ if(!x.m) return; if(!x.p){o+=REPL*0.6*x.m/48;d+=REPL*0.4*x.m/48;return;}
    const b=star(x.p)-stretch(x.p,x.m); o+=(x.p.o+b*0.6)*x.m/48; d+=(x.p.d+b*0.4)*x.m/48; pen+=x.pen*x.m/48; });
  return {o,d,pen,raw:o+d};
}

// ---------- Chemistry (healthy depth chart) ----------
// Lineup analytics from 2025-26 rate stats: position range, spacing (3PA rate), usage load, playmaking (assist %),
// rim protection (block %), bench coverage, and coach fit
function chemistry(team, getP){
  const lu=lineup(team.depth,getP,()=>true);
  const r=lineupRaw(lu);
  const notes=[];
  const starters=lu.filter(x=>x.start), sp=starters.filter(x=>x.p).map(x=>x.p);
  const oop=starters.filter(x=>x.p&&x.pen>0);
  const empty=starters.filter(x=>!x.p).length;
  const last=n=>n.split(" ").filter(w=>!/^(Jr\.|Sr\.|II|III|IV)$/.test(w)).slice(-1)[0];
  if(empty) notes.push({k:"Starting five",t:`${empty} starting spot${empty>1?"s":""} empty.`,v:-(empty*1.5)});
  else if(oop.length) notes.push({k:"Starting five",t:oop.map(x=>`${last(x.p.n)} (${posLabel(x.p)}) at ${x.slot}`).join(", ")+".",v:-Math.round(r.pen*SCALE*10)/10});
  else notes.push({k:"Starting five",t:"Every starter is playing a position he plays.",v:0});
  // spacing: starters who take 40%+ of their shots from three
  const shooters=sp.filter(p=>p.tpar>=0.40).length;
  const avg3=sp.length?sp.reduce((s,p)=>s+p.tpar,0)/sp.length:0;
  notes.push(shooters>=3?{k:"Spacing",t:`${shooters} starters take 40%+ of their shots from three.`,v:0}
    :{k:"Spacing",t:`Only ${shooters} starter${shooters===1?"":"s"} live${shooters===1?"s":""} behind the arc. Defenses pack the paint.`,v:shooters===2?-0.75:-1.5});
  // usage: a lineup's usage rates should add up to about 100%
  const usg=sp.reduce((s,p)=>s+p.usg,0);
  if(sp.length===5&&usg>112) notes.push({k:"Usage",t:`Starters' usage adds to ${Math.round(usg)}%. Too many players need the ball.`,v:-Math.min(2,Math.round((usg-112)*0.1*10)/10)});
  else if(sp.length===5&&usg<90) notes.push({k:"Usage",t:`Starters' usage adds to ${Math.round(usg)}%. Nobody wants the last shot.`,v:-Math.min(1.5,Math.round((90-usg)*0.08*10)/10)});
  else notes.push({k:"Usage",t:`Starters' usage adds to ${Math.round(usg)}%, a workable split.`,v:0});
  // playmaking: someone in the rotation who assists on a quarter of teammates' baskets
  const rot=lu.filter(x=>x.p&&x.m>0).map(x=>x.p);
  const bestAst=Math.max(0,...rot.map(p=>p.astp));
  notes.push(bestAst>=25?{k:"Playmaking",t:`A real playmaker (${Math.round(bestAst)}% assist rate).`,v:0}
    :bestAst>=20?{k:"Playmaking",t:`Best assist rate is ${Math.round(bestAst)}%. Playmaking by committee.`,v:-0.5}
    :{k:"Playmaking",t:"Nobody in the rotation creates for others.",v:-1.5});
  // rim protection: a starter at PF or C with a strong block rate
  const bigs=starters.filter(x=>x.p&&(x.slot==="C"||x.slot==="PF")).map(x=>x.p);
  const bestBlk=Math.max(0,...bigs.map(p=>p.blk));
  notes.push(bestBlk>=3.5?{k:"Rim protection",t:`A starting big who blocks ${bestBlk.toFixed(1)}% of shots.`,v:0}
    :bestBlk>=2.5?{k:"Rim protection",t:"Starting bigs only contest some shots.",v:-0.4}
    :{k:"Rim protection",t:"No starting big who protects the rim.",v:-1});
  const benchTop=lu.filter(x=>!x.start&&x.p&&x.m>0).map(x=>x.p);
  const hasG=benchTop.some(p=>plays(p).some(s=>s==="PG"||s==="SG")), hasB=benchTop.some(p=>plays(p).includes("C"));
  notes.push(hasG&&hasB?{k:"Bench",t:"Backup guard and backup center in the top five reserves.",v:0}:{k:"Bench",t:`No backup ${!hasG?"guard":"center"} in the top five reserves.`,v:-0.75});
  notes.push({k:"Year one",t:"Nobody has played together, and there are no systems yet. Teams with no continuity play about three points worse.",v:-3.0});
  const lean=r.o-r.d; let fit=0, ft="A balanced coach. No boost, no clash.";
  if(team.coach==="pace"){ fit=(lean>1.5||avg3>=0.45)?1:(lean<-0.5&&avg3<0.35)?-1:0; ft=fit>0?"Pace and space fits a roster that scores and shoots.":fit<0?"Pace and space with a roster that can't score or shoot.":"Pace and space is a neutral fit."; }
  else if(team.coach==="grind"){ fit=(lean<0.5||bestBlk>=4)?1:lean>2.5?-1:0; ft=fit>0?"Defense first fits a roster that defends.":fit<0?"Defense first with a roster built to score.":"Defense first is a neutral fit."; }
  notes.push({k:"Coach",t:ft,v:fit});
  return notes;
}

// ---------- League ----------
// expTeams: [{code, roster:[players], depth, coach}]
function buildLeague(expTeams){
  const taken=new Set(); expTeams.forEach(t=>{ t.roster.forEach(p=>taken.add(p.key)); (t.waived||[]).forEach(k=>taken.add(k)); });
  const nba=Object.keys(TEAMS).map(code=>{
    const all=PLAYERS.filter(p=>p.t===code);
    const left=all.filter(p=>!taken.has(p.key));
    return {code,name:TEAMS[code],players:left,before:rawOf(all).raw,raw:rawOf(left).raw,o:rawOf(left).o,d:rawOf(left).d};
  });
  const mean=nba.reduce((s,t)=>s+t.before,0)/nba.length;
  nba.forEach(t=>{t.net=knee((t.raw-mean)*SCALE);t.netBefore=knee((t.before-mean)*SCALE);});
  const exp=expTeams.map(t=>{
    const byKey=new Map(t.roster.map(p=>[p.key,p]));
    const chem=chemistry(t,k=>byKey.get(k));
    const chemPts=chem.reduce((s,c)=>s+c.v,0);
    const netWith=(getP,isAvail)=>knee((lineupRaw(lineup(t.depth,getP,isAvail)).raw-mean)*SCALE)+chemPts;
    const lr=lineupRaw(lineup(t.depth,k=>byKey.get(k),()=>true));
    return {...t,byKey,chem,chemPts,netWith,o:lr.o,d:lr.d,netFull:netWith(k=>byKey.get(k),()=>true)};
  });
  return {nba,exp,mean};
}
function expectedNet(et, rng, n){
  let s=0; for(let i=0;i<n;i++){ const out=new Set(et.roster.filter(p=>rng()>=p.h).map(p=>p.key)); s+=et.netWith(k=>et.byKey.get(k),p=>!out.has(p.key)); } return s/n;
}
function expectedOppNets(lg, rng, n){
  return lg.nba.map(t=>{ let s=0; for(let i=0;i<n;i++){ const a=t.players.filter(p=>rng()<p.h); s+=knee((rawOf(a).raw-lg.mean)*SCALE); } return s/n; });
}
function developed(roster, rng){
  const sig=a=>a<=22?1.6:a<=25?1.2:a<=29?0.85:0.9;
  return new Map(roster.map(p=>{ const z=p.t==="FA"?0:gauss(rng)*sig(p.age); return [p.key,Object.assign({},p,{o:p.o+z*0.6,d:p.d+z*0.4,dev:z})]; }));
}

// ---------- Schedules ----------
function shuffle(a,rng){for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
// solo: 22 NBA teams x3 + 8 x2. two teams: 4 vs the other expansion team + 18 NBA teams x3 + 12 x2
function buildSchedule(rng, rival){
  const idx=shuffle(Object.keys(TEAMS).map((_,i)=>i),rng);
  const threes=rival?18:22; const g=[];
  idx.forEach((t,k)=>{const n=k<threes?3:2;for(let i=0;i<n;i++)g.push({opp:t});});
  if(rival) for(let i=0;i<4;i++) g.push({opp:rival,h2h:i});
  shuffle(g,rng); g.forEach((x,i)=>x.home=i%2===0);
  return g;
}

// ---------- One season for one expansion team (streaky injuries) ----------
function playSeason(et, sched, oppNet, dev, rng, h2hResults){
  const out=new Map(et.roster.map(p=>[p.key,0])), missed=new Map(et.roster.map(p=>[p.key,0]));
  const getP=k=>dev.get(k);
  const games=sched.map(g=>{
    et.roster.forEach(p=>{ let o=out.get(p.key);
      if(o>0){ if(rng()<1/INJ_LEN) o=0; } else { const q=(1-p.h)/(p.h*INJ_LEN); if(rng()<q) o=1; } out.set(p.key,o); });
    const absent=et.roster.filter(p=>out.get(p.key)); absent.forEach(p=>missed.set(p.key,missed.get(p.key)+1));
    let m;
    if(g.h2h!=null&&h2hResults){ m=h2hResults[g.h2h][et.code]; }
    else{
      const net=et.netWith(getP,p=>!out.get(p.key));
      m=Math.round(net-oppNet(g.opp)+(g.home?HCA:-HCA)+gauss(rng)*GAME_SD); if(m===0) m=rng()<0.5?1:-1;
    }
    const base=Math.round(112+gauss(rng)*7);
    const us=m>0?base+Math.ceil(m/2):base-Math.ceil(-m/2);
    return {opp:g.opp,home:g.home,h2h:g.h2h,win:m>0,us,them:us-m,out:absent.map(p=>p.n)};
  });
  return {games,missed};
}
// The four head-to-head games, decided once so both teams' records agree
function simH2H(a, b, netA, netB, rng){
  const res=[];
  for(let i=0;i<4;i++){ const aHome=i%2===0; let m=Math.round(netA-netB+(aHome?HCA:-HCA)+gauss(rng)*GAME_SD); if(m===0) m=1; res.push({[a]:m,[b]:-m,aHome}); }
  return res;
}

// Expected wins for every team against the full field
function fieldWins(nets){
  return nets.map((n,i)=>{let w=0;nets.forEach((o,j)=>{if(i!==j)w+=phi((n-o)/GAME_SD)*82/(nets.length-1);});return w;});
}
// Playoffs: top 16 records, 1 vs 16 bracket, best-of-seven, higher seed hosts games 1, 2, 5, 7
function playoffs(field, rng){
  const f=[...field].sort((a,b)=>b.w-a.w||b.net-a.net);
  const res={}; f.forEach((t,i)=>{ if(typeof t.id==="string") res[t.id]={seed:i+1,made:i<16,rounds:0,champ:false,lostTo:null}; });
  const top=f.slice(0,16);
  const order=[0,15,7,8,4,11,3,12,5,10,2,13,6,9,1,14], HOME=[1,1,0,0,1,0,1];
  const series=(a,b)=>{let wa=0,wb=0,g=0;while(wa<4&&wb<4){const h=HOME[g++]?HCA:-HCA;if(rng()<phi((a.net-b.net+h)/GAME_SD))wa++;else wb++;}return wa===4?[a,b]:[b,a];};
  let round=order.map(i=>top[i]);
  while(round.length>1){
    const next=[];
    for(let i=0;i<round.length;i+=2){ const [w,l]=series(round[i],round[i+1]);
      if(typeof w.id==="string") res[w.id].rounds++;
      if(typeof l.id==="string") res[l.id].lostTo=w.id;
      next.push(w); }
    round=next;
  }
  if(typeof round[0].id==="string") res[round[0].id].champ=true;
  return res;
}

// 1,000 more seasons for one expansion team
function monteCarlo(lg, et, expNet, oppNet, sched, nbaWins, otherExp, n, rng){
  const injuryLoss=et.netFull-expNet;
  const wins=new Array(n); let made=0,champ=0,finals=0;
  for(let s=0;s<n;s++){
    const dev=developed(et.roster,rng);
    const net=et.netWith(k=>dev.get(k),()=>true)-injuryLoss;
    let w=0; for(const g of sched){ if(rng()<phi((net-oppNet(g.opp)+(g.home?HCA:-HCA))/(GAME_SD+0.4))) w++; } wins[s]=w;
    const field=lg.nba.map((t,i)=>({id:i,net:t.expNet,w:nbaWins[i]})).concat([{id:et.code,net,w}]).concat(otherExp?[{id:otherExp.code+"~",net:otherExp.net,w:otherExp.w}]:[]);
    const po=playoffs(field,rng)[et.code];
    if(po.made) made++; if(po.champ) champ++; if(po.rounds>=3) finals++;
  }
  const sorted=[...wins].sort((a,b)=>a-b), q=x=>sorted[Math.min(n-1,Math.floor(x*n))];
  const hist=new Array(83).fill(0); wins.forEach(w=>hist[w]++);
  return {mean:wins.reduce((a,b)=>a+b,0)/n,p10:q(0.1),p50:q(0.5),p90:q(0.9),max:sorted[n-1],min:sorted[0],
    beatBulls:wins.filter(w=>w>=34).length/n,playoffs:made/n,title:champ/n,finals:finals/n,hist};
}

// Roster grade on the expansion curve, from average wins across simulated seasons
function grade(w){
  if(w>=30) return "A+"; if(w>=26) return "A"; if(w>=23.5) return "A-"; if(w>=21.5) return "B+"; if(w>=20) return "B";
  if(w>=18.5) return "B-"; if(w>=17) return "C+"; if(w>=15) return "C"; if(w>=12) return "D"; return "F";
}
// Franchise value ($B): roughly $7B for Seattle, ~$10B for Las Vegas, moved by winning and playoff success (game estimate)
function franchiseValue(code, w, po, payroll, picks){
  let v=(code==="LV"?10.0:7.0)+0.025*(w-20)+0.12*(po.rounds||0)+(po.made?0.1:0)+(po.champ?0.5:0)+0.05*(picks||0);
  if(payroll<EXP_FLOOR) v-=(EXP_FLOOR-payroll)/1000;
  return Math.round(v*100)/100;
}

// ---------- Computer GM ----------
// Score = impact, plus a bump for filling an open starting spot and for youth, minus money it can't afford to spend
function aiScore(team, p, payroll, noise){
  const left=PICKS-team.picks.length, room=EXP_CAP-payroll, per=room/Math.max(1,left);
  const need=plays(p).some(s=>!team.depth.slots[s])?0.7:0;
  // potential: young players are worth a bit more than their 2027-28 number (where they're headed by 27)
  const youth=p.age<=24?Math.min(1,0.3*Math.max(0,(p.pot??rating(p))-rating(p))):p.age>=33?-0.4:0;
  const cost=Math.max(0,p.s-per*1.8)*0.06;
  const floorPush=(left<=4&&payroll+p.s<EXP_FLOOR)?Math.min(p.s,EXP_FLOOR-payroll)*0.02:0;
  // value over a season: when he sits, a replacement-level player (about -2) takes his minutes
  const avail=-2+Math.min(1,p.h/0.92)*(rating(p)+2);
  return avail+need+youth-cost+floorPush+(noise||0);
}
function pickGrade(rank){ return rank<=1?"A":rank<=3?"A-":rank<=6?"B":rank<=12?"C":"D"; }

if(typeof module!=="undefined") module.exports={LEAGUE_CAP,EXP_CAP,EXP_FLOOR,PICKS,MIN_FA,POS5,EXP,emptyDepth,autoDepth,addToDepth,removeFromDepth,lineup,lineupRaw,chemistry,buildLeague,expectedNet,expectedOppNets,developed,buildSchedule,playSeason,simH2H,fieldWins,playoffs,monteCarlo,grade,franchiseValue,aiScore,pickGrade,mulberry32,rating,minimumFA,gauss};

// ===================== Draft controller =====================
function newDraft(mode, human, rng){
  const codes=mode==="solo"?["SEA"]:["SEA","LV"];
  const first=codes.length===2?(rng()<0.5?"SEA":"LV"):"SEA";
  const second=codes.find(c=>c!==first);
  const order=[]; for(let i=0;i<PICKS;i++){ order.push(first); if(second) order.push(second); }
  const teams={};
  codes.forEach(c=>teams[c]={code:c,picks:[],depth:emptyDepth(),coach:"balanced",human:mode!=="ai"||c===human,assets:[],handsOff:[]});
  const D={mode,codes,first,order,turn:0,teams,log:[],fa:{},exposed:[],protExtra:[]};
  wildcardExposure(D,rng);
  D.offers=genOffers(D,rng);
  return D;
}

// ===================== Draft-day side deals =====================
// Two kinds, both from real expansion drafts:
//  dump:     an NBA team gives you picks to take an overpaid player off its books (uses your pick on him)
//  handsoff: an NBA team gives you a pick to agree not to take a young player it couldn't protect
let RANKS=null;
function nbaRanks(){
  if(RANKS) return RANKS;
  const raws=Object.keys(TEAMS).map(c=>({c,raw:rawOf(PLAYERS.filter(p=>p.t===c)).raw})).sort((a,b)=>b.raw-a.raw);
  RANKS={}; raws.forEach((x,i)=>RANKS[x.c]=i+1); return RANKS;
}
// Real future picks each NBA team owns and can legally trade, from RealGM's future draft pick tracker (Oct 2026).
// [year, original team], in the order the team would give them up. Rules applied: no picks already owed, frozen
// (second apron) or tied up in another team's swap rights, and the Stepien rule (never two straight years without a first).
// Second-round picks each team owns outright, 2027-2032 (RealGM, Oct 2026), in the order it would give them up.
// The 2027 picks are in the NBA draft held days after the expansion draft; only clean ones are listed (no "more favorable
// of" conditions). Teams with none (they've traded them all) pay in cash instead, within the league's cash-in-trades limit.
const SEC_MENU={
  ATL:[[2029,"CLE"],[2030,"NYK"]], BOS:[[2032,"BOS"]],
  BRK:[[2029,"DAL"],[2029,"GSW"],[2030,"LAL"],[2031,"LAL"],[2028,"ATL"],[2032,"DEN"]],
  CHO:[[2027,"MEM"],[2028,"HOU"],[2028,"ORL"],[2031,"MIL"],[2031,"PHO"],[2032,"MIN"]], CHI:[[2027,"CLE"],[2029,"CHI"],[2031,"DEN"],[2031,"NYK"],[2032,"CHI"]],
  CLE:[], DAL:[], DEN:[[2028,"MIN"],[2031,"SAC"],[2032,"SAC"]], DET:[[2027,"DET"],[2030,"DET"],[2032,"DET"]], GSW:[[2032,"GSW"]], HOU:[],
  IND:[[2027,"UTA"],[2032,"IND"]], LAC:[[2031,"LAC"],[2032,"LAC"],[2030,"TOR"]], LAL:[[2031,"WAS"],[2032,"WAS"]],
  MEM:[[2029,"HOU"],[2029,"LAL"],[2029,"POR"]], MIA:[], MIL:[], MIN:[], NOP:[[2032,"NOP"]],
  NYK:[[2027,"NYK"],[2027,"WAS"],[2029,"PHO"],[2029,"SAC"],[2032,"NYK"],[2032,"DAL"]], OKC:[[2027,"CHI"],[2030,"ATL"],[2029,"OKC"],[2031,"DET"],[2032,"LAL"]],
  ORL:[[2030,"MIL"],[2032,"ORL"]], PHI:[[2029,"PHI"],[2031,"PHI"]], PHO:[], POR:[[2027,"MIN"],[2031,"POR"],[2032,"POR"],[2028,"SAC"]],
  SAC:[], SAS:[[2029,"NOP"],[2030,"SAS"],[2029,"LAC"],[2030,"CLE"],[2031,"SAS"]], TOR:[[2027,"TOR"],[2028,"TOR"],[2029,"TOR"]],
  UTA:[[2027,"DEN"],[2027,"LAC"],[2029,"UTA"],[2031,"UTA"]], WAS:[],
};
// First-round picks each team could trade (real ownership; the Stepien check below has the final say)
const FIRST_MENU={
  BOS:[[2031,"PHI"]], SAS:[[2029,"SAS"],[2032,"SAS"]], DEN:[[2031,"CLE"]], CHI:[[2032,"CHI"],[2031,"CHI"]], TOR:[[2029,"TOR"]],
  POR:[[2028,"ORL"],[2032,"POR"]], PHI:[[2029,"PHI"],[2030,"PHI"],[2032,"PHI"]], MEM:[[2030,"ORL"],[2031,"PHO"]], NOP:[[2030,"NOP"]],
  LAC:[[2031,"TOR"]], IND:[[2032,"IND"]], SAC:[[2031,"MIN"],[2032,"SAC"]], MIL:[[2031,"MIA"]], BRK:[[2031,"NYK"]],
};
const PICK_MENU=new Proxy({}, {get:(_,t)=>({F:FIRST_MENU[t]||[],S:SEC_MENU[t]||[]})});
// Stepien rule: a team can't trade away firsts so that it has none in two straight future drafts.
// Firsts each team is sure to have, 2027-2032 (own or acquired). A pick that might convey to someone else counts as gone,
// which is how the league applies the rule; forfeited picks count as gone. Swaps don't change the count.
const FIRSTS_HELD={
  BOS:{2027:1,2028:1,2029:0,2030:1,2031:2,2032:1}, SAS:{2027:2,2028:1,2029:1,2030:1,2031:1,2032:1},
  DEN:{2027:1,2028:0,2029:0,2030:0,2031:2,2032:0}, CHI:{2027:1,2028:1,2029:1,2030:1,2031:1,2032:1},
  TOR:{2027:1,2028:1,2029:1,2030:1,2031:0,2032:1}, POR:{2027:1,2028:2,2029:2,2030:1,2031:1,2032:1},
  PHI:{2027:1,2028:0,2029:1,2030:1,2031:0,2032:1}, MEM:{2027:1,2028:1,2029:1,2030:2,2031:2,2032:1},
  NOP:{2027:0,2028:1,2029:1,2030:1,2031:1,2032:1}, LAC:{2027:1,2028:0,2029:1,2030:0,2031:1,2032:0},
  IND:{2027:1,2028:1,2029:0,2030:1,2031:1,2032:1}, SAC:{2027:1,2028:1,2029:1,2030:1,2031:2,2032:1},
  MIL:{2027:1,2028:1,2029:0,2030:1,2031:2,2032:1}, BRK:{2027:1,2028:1,2029:2,2030:1,2031:2,2032:2},
};
function stepienOK(team, years){
  const h=FIRSTS_HELD[team]; if(!h) return true;
  const after={...h}; years.forEach(y=>after[y]=(after[y]||0)-1);
  if(Object.values(after).some(v=>v<0)) return false;
  for(let y=2027;y<2032;y++) if(after[y]===0&&after[y+1]===0&&!(h[y]===0&&h[y+1]===0)) return false;
  return true;
}
// A first's value tracks where its original team projects to finish; later years regress to the middle and are discounted
const PICK_DISC={2027:1,2028:1,2029:0.95,2030:0.9,2031:0.85,2032:0.8};
const ncdf=z=>{ const t=1/(1+0.2316419*Math.abs(z)), q=0.3989423*Math.exp(-z*z/2)*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274)))); return z>0?1-q:q; };
const npdf=z=>0.3989423*Math.exp(-z*z/2);
// Protections, the way real dumps are written: a team protects itself against a collapse. A weak team protects the
// lottery, a middling one roughly the top 10, a good team's late first goes clean. Picks three or more years out carry
// lighter protection. A first that lands inside its protection turns into two seconds, the usual fallback.
function protFor(orig,year){
  const r=nbaRanks()[orig], near=year<=2029;
  if(r>=21) return near?14:10;
  if(r>=13) return near?10:6;
  if(r>=8) return near?5:0;
  return 0;
}
function pickAsset(orig,year,round,owner,prot){
  const raw=31-nbaRanks()[orig], w=year<=2028?1:year===2029?0.5:year===2030?0.25:0;
  const slot=Math.round(raw*w+15.5*(1-w)), disc=PICK_DISC[year]||0.8, sec=0.3*disc;
  let value=round===1?(3.2-0.08*(slot-1))*disc:sec, conv=null;
  if(round===1&&prot>0){
    // odds it conveys, and where it lands when it does; otherwise it's two seconds
    const sd=year<=2028?4.5:year===2029?6.5:8.5, a=(prot+0.5-slot)/sd, pin=ncdf(a);
    const at=Math.min(30,slot+sd*npdf(a)/Math.max(1e-6,1-pin));
    value=(1-pin)*(3.2-0.08*(at-1))*disc+pin*2*sec; conv=Math.round((1-pin)*100);
  }
  value=round===1?Math.round(value*10)/10:Math.round(value*100)/100;
  const out={nba:orig,owner:owner||orig,year,round,slot:round===1||year===2027?slot:null,value};
  if(conv!=null){ out.prot=prot; out.conv=conv; }
  return out;
}
const nickOf=c=>TEAMS[c]?TEAMS[c].split(" ").pop():c;
function pickLabel(a){
  if(a.cash) return `$${a.cash}M cash from the ${nickOf(a.owner)}`;
  const bits=[]; if(a.owner&&a.owner!==a.nba) bits.push("via "+nickOf(a.owner));
  if(a.round===1&&a.prot) bits.push(`top-${a.prot} protected`);
  if(a.round===1&&a.year<=2029) bits.push("proj. #"+a.slot);
  if(a.round===2&&a.year===2027&&a.slot) bits.push(`this June, proj. #${30+a.slot}`);
  return `${a.year} ${a.round===1?"1st":"2nd"} from the ${nickOf(a.nba)}${bits.length?` (${bits.join(", ")})`:""}`;
}
const protNote=a=>a.prot?`Top-${a.prot} protected: about a ${a.conv}% chance it conveys. If it lands in the top ${a.prot}, you get two seconds instead.`:"";
const assetValue=t=>Math.round(t.assets.reduce((s,a)=>s+a.value,0)*10)/10;
// The league's worst contracts. Core dumps are on the table every draft; two from the second list rotate in.
// Players a team just paid real assets to acquire (Jaren Jackson Jr., Desmond Bane) are never dumped.
const CORE_DUMPS=["BOS|Paul George","SAS|De'Aaron Fox","DEN|Christian Braun","CHI|Patrick Williams","TOR|Jakob Poeltl","POR|Ja Morant"];
// Minnesota (Gobert) and Phoenix (Dillon Brooks) are out of tradeable picks, so they can't pay anyone to take a contract
const SIDE_DUMPS=["MEM|Jerami Grant","NOP|Dejounte Murray","LAC|Darius Garland","IND|Pascal Siakam","SAC|Keegan Murray","MIL|Myles Turner","BRK|Julius Randle"];
// Now and then a team exposes a star on a contract it would love to escape
const WILDCARDS=[{key:"PHI|Joel Embiid",odds:0.33}];
const isProt=(D,p)=>(p.prot&&!((D&&D.exposed)||[]).includes(p.key))||((D&&D.protExtra)||[]).includes(p.key);
function poolOf(D){
  const ex=(D&&D.exposed)||[], pe=(D&&D.protExtra)||[];
  if(!ex.length&&!pe.length) return POOLP;
  return POOLP.filter(p=>!pe.includes(p.key)).concat(ex.map(k=>PBYKEY.get(k)).filter(Boolean));
}
function wildcardExposure(D,rng){
  WILDCARDS.forEach(w=>{
    const p=PBYKEY.get(w.key); if(!p||rng()>=w.odds) return;
    D.exposed.push(p.key);
    // his team protects its best exposed player in his place
    const sub=POOLP.filter(x=>x.t===p.t&&x.st!=="tw").sort((a,b)=>(b.o+b.d)-(a.o+a.d))[0];
    if(sub) D.protExtra.push(sub.key);
  });
}
// Contract surplus, Stephen Noh's way: what he's worth each remaining season (his model, with this player's
// availability and role) minus what he's paid, summed. Dead money is a negative surplus.
function surplus(p){ return [[p.s,p.mv],[p.s28,p.mv28],[p.s29,p.mv29]].reduce((t,[s,v])=>s==null?t:t+((v??p.mv)-s),0); }
function deadMoney(p){ return Math.max(0,-surplus(p)); }
const yearsLeft=p=>[p.s,p.s28,p.s29].filter(x=>x!=null).length;
// Cash a team can send in trades over a season is capped at about 5.15% of the cap, roughly $9M for 2027-28
const CASH_MAX=Math.round(LEAGUE_CAP*0.0515);
function cashAsset(owner,amount){ return {cash:amount,owner,nba:owner,year:2027,round:3,value:Math.round(amount/50*100)/100}; }
// The asking price comes from dead money; the team pays it with picks it really owns. Two seconds stand in for a missing first.
// Picks a team can still hand out in this draft (each pick goes to one offer only)
function pickPurse(){
  const usedF={}, usedS={}, cash={};
  return {
    firsts(t,n){ const out=[]; for(const [y,o] of (FIRST_MENU[t]||[])){ if(out.length>=n) break; const k=y+o; if((usedF[t]||[]).includes(k)) continue; if(!stepienOK(t,(usedF[t]||[]).map(x=>+x.slice(0,4)).concat(out.map(z=>z[0]),[y]))) { this.blocked=true; continue; } out.push([y,o]); } out.forEach(([y,o])=>(usedF[t]=usedF[t]||[]).push(y+o)); return out; },
    seconds(t,n){ const out=[]; for(const [y,o] of (SEC_MENU[t]||[])){ if(out.length>=n) break; const k=y+o; if((usedS[t]||[]).includes(k)) continue; out.push([y,o]); } out.forEach(([y,o])=>(usedS[t]=usedS[t]||[]).push(y+o)); return out; },
    secLeft(t){ return (SEC_MENU[t]||[]).filter(([y,o])=>!(usedS[t]||[]).includes(y+o)).length; },
    cash(t,amt){ const a=Math.max(0,Math.min(amt,CASH_MAX-(cash[t]||0))); cash[t]=(cash[t]||0)+a; return a; },
  };
}
// Pay with real picks. A protected first that may well not convey comes with a second on top. A team short of seconds
// makes up each one with $3M cash, up to the league's cash limit.
function pay(purse,t,nF,nS){
  purse.blocked=false;
  const F=purse.firsts(t,nF).map(([y,o])=>pickAsset(o,y,1,t,protFor(o,y)));
  const want=nS+2*(nF-F.length)+F.filter(a=>a.conv!=null&&a.conv<75).length, S=purse.seconds(t,want);
  const picks=F.concat(S.map(([y,o])=>pickAsset(o,y,2,t)));
  if(S.length<want){ const c=purse.cash(t,3*(want-S.length)); if(c>0) picks.push(cashAsset(t,c)); }
  picks.why=purse.blocked&&F.length<nF?`The Stepien rule stops the ${nickOf(t)} from trading ${F.length?"another":"a"} first: they'd go two straight drafts without one.`:"";
  return picks;
}
// The price of a dump follows dead money (Noh surplus). One expiring season never buys a first: a big one brings
// two seconds. Every team adds at least something to get it done.
function dumpTerms(p){
  const dm=deadMoney(p);
  if(yearsLeft(p)<=1) return [0,dm>=25?2:1];
  return [dm>=60?2:dm>=20?1:0, dm>=60?0:dm>=35?1:dm>=20?0:dm>=8?2:1];
}
function dumpPicks(p,purse){ const [f,sec]=dumpTerms(p); return pay(purse||pickPurse(),p.t,f,sec); }
// Each team's prize: the exposed player it would most hate to lose (good value now, or young with upside)
function prizeOf(D,t,pool){
  return pool.filter(p=>p.t===t&&p.st!=="tw"&&p.st!=="ufa"&&surplus(p)>=4&&(ovr(p)>=74||(p.age<=24&&(p.potr||0)>=76)))
    .sort((a,b)=>surplus(b)-surplus(a))[0]||null;
}
function genOffers(D,rng){
  const offers=[]; let id=0;
  const poolL=poolOf(D), pool=new Set(poolL.map(p=>p.key)), purse=pickPurse();
  const ok=k=>{ const p=PBYKEY.get(k); return p&&pool.has(k)&&p.st!=="ufa"&&p.st!=="tw"?p:null; };
  const used=new Set(), dumps=[];
  const add=k=>{ const p=ok(k); if(p&&!used.has(p.t)){ used.add(p.t); dumps.push(p); } };
  D.exposed.forEach(add);
  CORE_DUMPS.forEach(add);
  const side=SIDE_DUMPS.slice();
  for(let i=side.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [side[i],side[j]]=[side[j],side[i]]; }
  let n=0; side.forEach(k=>{ if(n<2&&ok(k)&&!used.has(k.split("|")[0])){ add(k); n++; } });
  const deals=dumps.map(p=>({p,picks:dumpPicks(p,purse),protects:(prizeOf(D,p.t,poolL)||{}).key||null})).filter(x=>x.picks.length);
  const prizes=Object.keys(TEAMS).map(t=>({t,prize:prizeOf(D,t,poolL)})).filter(x=>x.prize).sort((a,b)=>surplus(b.prize)-surplus(a.prize));
  // Pass deals: a team pays you to leave its prize alone, two seconds for a real asset, one otherwise. Teams pay with
  // real picks; a team that has traded all its seconds can only offer cash, and only one of those makes the list.
  const pass=[]; let cashOnly=0;
  for(const {t,prize} of prizes){
    if(pass.length>=6) break;
    if(!purse.secLeft(t)&&cashOnly>=1) continue;
    const picks=pay(purse,t,0,surplus(prize)>=25||ovr(prize)>=82?2:1);
    if(!picks.length) continue;
    if(picks.every(a=>a.cash)) cashOnly++;
    pass.push({p:prize,picks});
  }
  // Steer offers: a team with a prize and a bad contract asks you to take the bad contract instead. Taking anyone
  // from a team uses up its one loss, so the prize is safe.
  prizes.forEach(({t,prize})=>{
    if(used.has(t)) return;
    const dud=poolL.filter(p=>p.t===t&&p.key!==prize.key&&p.st==="con"&&p.s>=8&&deadMoney(p)>=8).sort((a,b)=>deadMoney(b)-deadMoney(a))[0];
    if(!dud||deals.filter(x=>x.steer).length>=3) return;
    const picks=dumpPicks(dud,purse); if(!picks.length) return;
    used.add(t); deals.push({p:dud,picks,protects:prize.key,steer:true});
  });
  D.codes.forEach(code=>{
    deals.forEach(({p,picks,protects,steer})=>offers.push({id:"o"+(++id),kind:"dump",steer:!!steer,protects,nba:p.t,key:p.key,picks:picks.map(a=>Object.assign({},a)),dead:Math.round(deadMoney(p)),why:picks.why||"",for:code,status:"open"}));
    pass.forEach(({p,picks})=>offers.push({id:"o"+(++id),kind:"handsoff",nba:p.t,key:p.key,picks:picks.map(a=>Object.assign({},a)),for:code,status:"open"}));
  });
  return offers;
}
// Open offers die when the player is gone or his NBA team has already lost someone (one player per team)
function refreshOffers(D){
  (D.offers||[]).forEach(o=>{
    if(o.status==="accepted"||o.status==="declined") return;
    const gone=takenBy(D,o.key), lost=teamUsedBy(D,o.nba);
    o.status=(gone||lost)?"expired":"open";
  });
}
function acceptOffer(D,code,id){
  const o=D.offers.find(x=>x.id===id); if(!o||o.for!==code||o.status!=="open") return false;
  const t=D.teams[code];
  if(o.kind==="dump"){
    if(onClock(D)!==code) return false;
    const p=PBYKEY.get(o.key); if(!canDraft(D,code,p).ok) return false;
    o.status="accepted"; t.assets.push(...o.picks);
    makePick(D,code,p,{deal:o.id});
  } else {
    o.status="accepted"; t.assets.push(...o.picks); t.handsOff.push(o.key);
  }
  return true;
}
function declineOffer(D,code,id){ const o=D.offers.find(x=>x.id===id); if(o&&o.for===code&&o.status==="open") o.status="declined"; }
function undoDeal(D,code,id){
  const o=D.offers.find(x=>x.id===id); if(!o||o.status!=="accepted") return;
  const t=D.teams[code];
  o.picks.forEach(a=>{ const i=t.assets.indexOf(a); if(i>=0) t.assets.splice(i,1); });
  if(o.kind==="handsoff") t.handsOff=t.handsOff.filter(k=>k!==o.key);
  o.status="open"; refreshOffers(D);
}
const draftDone=D=>D.turn>=D.order.length;
const onClock=D=>draftDone(D)?null:D.order[D.turn];
function getPlayer(D,k){ return D.fa[k]||PBYKEY.get(k); }
// Active roster: drafted players and free-agent signings, minus anyone waived
function rosterKeys(D,code){ const t=D.teams[code], w=t.waived||[]; return t.picks.concat(t.fas||[]).filter(k=>!w.includes(k)); }
function rosterOf(D,code){ return rosterKeys(D,code).map(k=>getPlayer(D,k)); }
function payrollOf(D,code){ return rosterOf(D,code).reduce((s,p)=>s+p.s,0); }
// Waived players' salaries leave the cap sheet but still count toward the floor (and still get paid)
function deadOf(D,code){ return (D.teams[code].waived||[]).reduce((s,k)=>s+getPlayer(D,k).s,0); }
function takenBy(D,k){ for(const c of D.codes) if(D.teams[c].picks.includes(k)) return c; return null; }
function teamUsedBy(D,nba){ for(const c of D.codes) if(rosterOf(D,c).some(p=>p.t===nba)) return c; return null; }
function cheapestFill(D,usedTeams,left,exclude){
  const mins={}, taken=new Set(); D.codes.forEach(c=>D.teams[c].picks.forEach(k=>taken.add(k)));
  poolOf(D).forEach(x=>{ if(!usedTeams.has(x.t)&&!exclude.has(x.key)&&!taken.has(x.key)) mins[x.t]=Math.min(mins[x.t]??1e9,x.s); });
  const arr=Object.values(mins).sort((a,b)=>a-b);
  if(arr.length<left) return Infinity;
  return arr.slice(0,left).reduce((a,b)=>a+b,0);
}
function canDraft(D,code,p){
  if(!code) return {ok:false,why:"The draft is over"};
  if(isProt(D,p)) return {ok:false,why:"Protected by the "+TEAMS[p.t].split(" ").pop()};
  const tb=takenBy(D,p.key); if(tb) return {ok:false,why:(tb===code?"Already on your roster":"Taken by "+EXP[tb].city)};
  const team=D.teams[code];
  if(team.handsOff&&team.handsOff.includes(p.key)) return {ok:false,why:"You agreed not to take him"};
  if(team.picks.length>=PICKS) return {ok:false,why:"All 14 spots are full"};
  const used=teamUsedBy(D,p.t);
  if(used) return {ok:false,why:`The ${TEAMS[p.t].split(" ").pop()} already lost a player${D.codes.length>1?" to "+EXP[used].city:""}`};
  const pay=payrollOf(D,code)+p.s;
  if(pay>EXP_CAP+1e-9) return {ok:false,why:"$"+(pay-EXP_CAP).toFixed(1)+"M over the cap"};
  const left=PICKS-team.picks.length-1;
  if(left>0){
    const usedT=new Set(); D.codes.forEach(c=>rosterOf(D,c).forEach(x=>usedT.add(x.t))); usedT.add(p.t);
    const need=cheapestFill(D,usedT,left,new Set([p.key]));
    if(pay+need>EXP_CAP+1e-9) return {ok:false,why:`Leaves $${Math.max(0,EXP_CAP-pay).toFixed(1)}M for ${left} more spot${left>1?"s":""}`};
  }
  return {ok:true};
}
function draftable(D,code){ return poolOf(D).filter(p=>canDraft(D,code,p).ok); }
function rankFor(D,code,p){
  const t=D.teams[code], pay=payrollOf(D,code);
  const list=draftable(D,code).map(x=>({x,s:aiScore(t,x,pay,0)})).sort((a,b)=>b.s-a.s);
  const i=list.findIndex(o=>o.x.key===p.key); return i<0?list.length+1:i+1;
}
function makePick(D,code,p,meta){
  const t=D.teams[code];
  t.picks.push(p.key);
  t.depth=addToDepth(t.depth,p,rosterOf(D,code));
  D.log.push(Object.assign({no:D.turn+1,code,key:p.key},meta||{}));
  D.turn++;
  refreshOffers(D);
}
function signFA(D,code){
  const t=D.teams[code];
  const open=POS5.find(s=>!t.depth.slots[s])||"SF";
  const fa=minimumFA(open,Object.keys(D.fa).length+1); D.fa[fa.key]=fa;
  makePick(D,code,fa,{fa:true});
  return fa;
}
// Best move for a team: the best straight pick, or a contract dump if the player plus the picks beats it
function bestMove(D,code,noise){
  const t=D.teams[code], pay=payrollOf(D,code);
  const list=draftable(D,code);
  if(!list.length) return {type:"fa"};
  let best=null,bs=-1e9;
  list.forEach(p=>{ const s=aiScore(t,p,pay,noise?noise():0); if(s>bs){bs=s;best=p;} });
  let deal=null;
  (D.offers||[]).filter(o=>o.for===code&&o.kind==="dump"&&o.status==="open").forEach(o=>{
    const p=PBYKEY.get(o.key); if(!canDraft(D,code,p).ok) return;
    const s=aiScore(t,p,pay,0)+0.5*o.picks.reduce((a,x)=>a+x.value,0);
    if(s>bs){bs=s;deal=o;}
  });
  return deal?{type:"deal",o:deal}:{type:"pick",p:best};
}
function aiPick(D,rng){
  const code=onClock(D); const t=D.teams[code], pay=payrollOf(D,code);
  const list=draftable(D,code);
  if(list.length){
    // hands-off deals: take the pick unless the player is one of its top three targets
    const top3=new Set(list.map(p=>({p,s:aiScore(t,p,pay,0)})).sort((a,b)=>b.s-a.s).slice(0,3).map(x=>x.p.key));
    (D.offers||[]).filter(o=>o.for===code&&o.kind==="handsoff"&&o.status==="open"&&!top3.has(o.key)).forEach(o=>acceptOffer(D,code,o.id));
  }
  const m=bestMove(D,code,()=>gauss(rng)*0.35);
  if(m.type==="fa") return {p:signFA(D,code),fa:true};
  if(m.type==="deal"){ acceptOffer(D,code,m.o.id); return {p:PBYKEY.get(m.o.key),fa:false,deal:true}; }
  makePick(D,code,m.p,{});
  return {p:m.p,fa:false};
}

// ===================== Free agency =====================
// How it works for real: the expansion draft comes first, then the NBA draft, then free agency opens June 30.
// In year one an expansion team's cap is 66.6% of the league cap, so the same $117.2M. Under it, a team can sign anyone
// into its room; over it, only minimum contracts. Teams carry up to 15 players. A player the expansion team waives before
// the season comes off its cap but still counts toward the floor, and the team still pays him.
const ROSTER_MAX=15, ROSTER_MIN=13;
// Prices fall as rosters fill. Role players' prices fall fastest; by late July many take the minimum.
const FA_DAYS=[{n:"Opening night",d:"June 30, 6 p.m. ET",f:1.0,r:1.0},{n:"Day two",d:"July 1",f:0.94,r:0.86},{n:"First week",d:"July 6",f:0.87,r:0.68},{n:"Late market",d:"Late July",f:0.78,r:0.5}];
function faStart(D,seed){
  D.phase="fa";
  D.faState={day:0,gone:[],seed:seed>>>0||1,log:[]};
  D.codes.forEach(c=>{ const t=D.teams[c]; t.fas=t.fas||[]; t.waived=t.waived||[]; });
}
const faOn=D=>D&&D.phase==="fa";
function faTaken(D){ const s=new Set(D.faState?D.faState.gone:[]); D.codes.forEach(c=>(D.teams[c].fas||[]).forEach(k=>s.add(k))); return s; }
function faPool(D){ const tk=faTaken(D); return PLAYERS.filter(p=>p.st==="ufa"&&!tk.has(p.key)); }
function faYears(p){ return p.age<=26?4:p.age<=29?3:p.age<=32?2:1; }
// Asking price for one team: market value, plus 20% for veterans who'd rather chase a title than join an expansion team,
// minus 10% when he'd start for you, falling as the market dries up
function faAsk(D,code,p){
  const day=FA_DAYS[(D.faState||{}).day||0];
  const ros=rosterOf(D,code), better=ros.filter(x=>rating(x)>rating(p)).length;
  const vet=p.age>=30, starter=better<5;
  let a=p.mv*(vet?1.2:1)*(starter?0.9:1)*(p.mv>=12?day.f:day.r);
  // The market for role players is crowded: anyone worth under $7M takes the minimum, and up to $14M takes a discount
  if(p.mv<=7) a=MIN_FA; else if(p.mv<=14) a*=0.8;
  a=Math.max(MIN_FA,Math.min(LEAGUE_CAP*0.35,a));
  const yrs=a<=MIN_FA+0.01?1:faYears(p);
  const why=[]; if(contenderOnly(p)) why.push("contenders only"); else if(vet) why.push("wants a contender"); if(starter&&!contenderOnly(p)) why.push("would start for you");
  return {sal:Math.round(a*10)/10,yrs,why};
}
// Veterans 33 and up who can still play are chasing rings: they won't sign with a first-year expansion team
const contenderOnly=p=>p.age>=33&&(p.rn??rating(p))>=-0.9;
function faCan(D,code,p){
  if(!faOn(D)) return {ok:false,why:"Free agency hasn't opened"};
  if(contenderOnly(p)) return {ok:false,why:"Only signing with a contender"};
  if(faTaken(D).has(p.key)) return {ok:false,why:"Already signed"};
  if(rosterKeys(D,code).length>=ROSTER_MAX) return {ok:false,why:"Roster is full (15). Waive someone first"};
  const a=faAsk(D,code,p), room=EXP_CAP-payrollOf(D,code);
  if(a.sal>MIN_FA+0.01&&a.sal>room+1e-9) return {ok:false,why:`Wants ${a.sal.toFixed(1)}M, you have ${Math.max(0,room).toFixed(1)}M in room`};
  return {ok:true,ask:a};
}
function faSign(D,code,p){
  const c=faCan(D,code,p); if(!c.ok) return false;
  const a=c.ask, t=D.teams[code];
  const fa=Object.assign({},p,{s:a.sal,yrs:a.yrs,st:"fa",s28:a.yrs>=2?a.sal:null,s29:a.yrs>=3?a.sal:null,src:p.src,signed:true,from:p.t,note:`Signed in free agency: ${a.yrs} yr${a.yrs>1?"s":""} at $${a.sal.toFixed(1)}M`});
  D.fa[p.key]=fa; t.fas.push(p.key);
  t.depth=addToDepth(t.depth,fa,rosterOf(D,code));
  D.faState.log.push({code,key:p.key,sal:a.sal,yrs:a.yrs,day:D.faState.day});
  return true;
}
function faRelease(D,code,key){
  const t=D.teams[code];
  if((t.fas||[]).includes(key)){ t.fas=t.fas.filter(k=>k!==key); delete D.fa[key]; D.faState.log=D.faState.log.filter(l=>!(l.code===code&&l.key===key)); }
  else if(t.picks.includes(key)&&!(t.waived||[]).includes(key)){ t.waived.push(key); }
  else return false;
  t.depth=removeFromDepth(t.depth,key,rosterOf(D,code));
  return true;
}
function faUnwaive(D,code,key){
  const t=D.teams[code]; if(!(t.waived||[]).includes(key)||rosterKeys(D,code).length>=ROSTER_MAX) return false;
  t.waived=t.waived.filter(k=>k!==key); t.depth=addToDepth(t.depth,getPlayer(D,key),rosterOf(D,code)); return true;
}
// The computer GM signs the best player it can fit, then fills out to 13 with minimum guys
function faAI(D,code){
  for(let n=0;n<4;n++){
    const pay=payrollOf(D,code), t=D.teams[code];
    if(rosterKeys(D,code).length>=ROSTER_MAX) return;
    const opts=faPool(D).map(p=>({p,c:faCan(D,code,p)})).filter(x=>x.c.ok)
      .map(x=>({p:x.p,s:aiScore(Object.assign({},t,{picks:rosterKeys(D,code)}),x.p,pay,0)-0.04*x.c.ask.sal}));
    if(!opts.length) return;
    opts.sort((a,b)=>b.s-a.s);
    const best=opts[0];
    if(best.s<-1.2&&rosterKeys(D,code).length>=ROSTER_MIN) return;
    faSign(D,code,best.p);
  }
}
// Next day: other NBA teams sign players (the best go first), and asking prices drop
function faNextDay(D){
  const st=D.faState; if(st.day>=FA_DAYS.length-1) return false;
  const rng=mulberry32((st.seed+st.day*7919)>>>0);
  const pool=faPool(D).sort((a,b)=>b.mv-a.mv);
  pool.forEach((p,i)=>{ const top=i<15, mid=i<45; const q=st.day===0?(top?0.45:mid?0.25:0.1):st.day===1?(top?0.4:mid?0.22:0.1):(top?0.35:mid?0.2:0.1); if(rng()<q) st.gone.push(p.key); });
  st.day++;
  D.codes.forEach(c=>{ if(!D.teams[c].human) faAI(D,c); });
  return true;
}
function faDone(D){ D.phase="season"; }

if(typeof module!=="undefined") Object.assign(module.exports,{faStart,faOn,faPool,faAsk,faCan,faSign,faRelease,faUnwaive,faAI,faNextDay,faDone,deadOf,rosterKeys,ROSTER_MAX,ROSTER_MIN,FA_DAYS,stepienOK,FIRSTS_HELD,PICK_MENU,pickAsset,protFor,protNote,CASH_MAX,isProt,poolOf,deadMoney,genOffers,acceptOffer,declineOffer,undoDeal,pickLabel,assetValue,refreshOffers,newDraft,draftDone,onClock,rosterOf,payrollOf,canDraft,draftable,rankFor,makePick,signFA,aiPick,takenBy});
