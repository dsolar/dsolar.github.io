/* Shared calculations for the College Basketball Hub. Provider ratings retain their own names. */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory();else root.CBB=factory();})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const finite=x=>x!==null&&x!==undefined&&x!==""&&Number.isFinite(Number(x));
const num=x=>finite(x)?Number(x):null;
const mean=xs=>{const a=xs.map(num).filter(x=>x!==null);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;};
const round=(x,n=1)=>finite(x)?Math.round(Number(x)*10**n)/10**n:null;
const key=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]/g,"");
const teamMetric=(t,k)=>num(t&&t.metrics&&t.metrics[k]);
const em=t=>{const o=teamMetric(t,"adjO"),d=teamMetric(t,"adjD");return o!==null&&d!==null?o-d:null;};
const HOME_EDGE=3;let SPREAD_SD=11; // the page sets the measured width from extras.json (spreadSd) with setSpreadSd
let MKT=null;const setMarket=m=>{MKT=m&&m.r?m:null;};
// home court as the blended line counts it: Haslametrics' HOME_EDGE and the market's fitted value, weighted like the spread
const homeEdgeFor=(home,away)=>{if(!MKT||!MKT.r||MKT.r[home.id]==null||MKT.r[away.id]==null)return HOME_EDGE;const w=MKT.w*Math.min(1,Math.min(MKT.n[home.id]||0,MKT.n[away.id]||0)/MKT.full);return (1-w)*HOME_EDGE+w*MKT.home;};
const setSpreadSd=v=>{if(v!==null&&v!==undefined&&Number.isFinite(Number(v)))SPREAD_SD=Number(v);};
const phi=z=>{const t=1/(1+0.3275911*Math.abs(z)/Math.SQRT2),y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-z*z/2);return 0.5*(1+(z<0?-y:y));};
const leagueAvg=teams=>mean(teams.map(t=>teamMetric(t,"adjO")));
// Projected score from adjusted efficiency and tempo. tools/cbb_extras.py logs the same line before each game.
function line(home,away,neutral,avg){
 if(!home||!away)return null;
 const ho=teamMetric(home,"adjO"),hd=teamMetric(home,"adjD"),ao=teamMetric(away,"adjO"),ad=teamMetric(away,"adjD"),ht=teamMetric(home,"tempo"),at=teamMetric(away,"tempo");
 if([ho,hd,ao,ad,ht,at,avg].some(x=>x===null||x===undefined))return null;
 const pace=(ht+at)/2,edge=neutral?0:HOME_EDGE/2;let hp=ho*ad/avg*pace/100+edge,ap=ao*hd/avg*pace/100-edge;
 // blend with the market rating (fit to closing lines; fit_market in tools/cbb_extras.py): 80% market, less for teams with few lined games
 const hub=hp-ap,tot=hp+ap;let m=hub,mk=null;
 if(MKT&&MKT.r){const rh=MKT.r[home.id],ra=MKT.r[away.id];if(rh!=null&&ra!=null){mk=rh-ra+(neutral?0:MKT.home);const w=MKT.w*Math.min(1,Math.min(MKT.n[home.id]||0,MKT.n[away.id]||0)/MKT.full);m=(1-w)*hub+w*mk;}}
 hp=(tot+m)/2;ap=(tot-m)/2;
 return {homePts:round(hp),awayPts:round(ap),spread:round(m),total:round(tot),homeProb:round(phi(m/SPREAD_SD),3),pace:round(pace),hub:round(hub),mkt:mk==null?null:round(mk)};
}
// Game Score per game (Hollinger, rebounds weighted 0.45). Mirrors production() in tools/cbb_extras.py.
function gameScore(p){
 const s=p&&p.stats||{},g=k=>num(s[k]),pts=g("pts"),reb=g("reb"),ast=g("ast");
 if(!(pts||reb||ast))return null;
 if(g("fga")!==null&&g("fgm")!==null)return round((pts||0)+0.4*g("fgm")-0.7*g("fga")-0.4*((g("fta")||0)-(g("ftm")||0))+0.45*(reb||0)+(g("stl")||0)+0.7*(ast||0)+0.7*(g("blk")||0)-0.4*(g("pf")||0)-(g("tov")||0));
 return round(0.7*((pts||0)+0.6*(reb||0)+0.9*(ast||0)));
}
function ranked(teams,source="haslam"){
 const field=source+"Rank";
 return teams.slice().sort((a,b)=>{const x=num(a[field]),y=num(b[field]);return (x===null)-(y===null)||(x!==null&&y!==null?x-y:0)||(em(b)??-1e6)-(em(a)??-1e6)||a.name.localeCompare(b.name);});
}
function conferences(teams){
 const groups=new Map();
 for(const t of teams){if(!t.conference)continue;if(!groups.has(t.conference))groups.set(t.conference,[]);groups.get(t.conference).push(t);}
 return [...groups].map(([name,ts])=>{const rated=ranked(ts).filter(t=>em(t)!==null);return {name,teams:ts,rated:rated.length,average:mean(rated.map(em)),top3:mean(rated.slice(0,3).map(em)),leader:rated[0]||ranked(ts)[0]};}).sort((a,b)=>(b.average??-1e6)-(a.average??-1e6)||a.name.localeCompare(b.name));
}
function percentile(teams,t,k,low=false){
 const v=k==="margin"?em(t):teamMetric(t,k),xs=teams.map(x=>k==="margin"?em(x):teamMetric(x,k)).filter(x=>x!==null);
 if(v===null||!xs.length)return null;
 return Math.round(100*xs.filter(x=>low?x>=v:x<=v).length/xs.length);
}
function teamStory(t,teams){
 const o=percentile(teams,t,"adjO"),d=percentile(teams,t,"adjD",true),pace=teamMetric(t,"tempo"),m=teamMetric(t,"momentum");
 const parts=[];
 if(o!==null&&d!==null){parts.push(o>=85&&d>=85?"An elite profile at both ends of the floor.":o-d>=18?"Its offense is the stronger part of its analytical profile.":d-o>=18?"Defense is the stronger part of its analytical profile.":"Its offensive and defensive ratings are relatively balanced.");}
 if(pace!==null){const p=percentile(teams,t,"tempo");parts.push(p>=75?"It plays at one of the quicker tempos in the country.":p<=25?"It prefers a slower, more deliberate game.":"Its pace sits around the middle of Division I.");}
 if(m!==null&&Math.abs(m)>1)parts.push(m>0?"Haslametrics rates its recent performances above its season baseline.":"Haslametrics rates its recent performances below its season baseline.");
 if(!parts.length)parts.push("Explore the roster, results and schedule while more analytical data becomes available.");
 return parts.join(" ");
}
function matchup(a,b,neutral=false){
 if(!a||!b||em(a)===null||em(b)===null)return null;
 const pace=mean([teamMetric(a,"tempo"),teamMetric(b,"tempo")]);if(pace===null)return null;
 const margin=(em(a)-em(b))*pace/100+(neutral?0:3);
 return {homeMargin:round(margin),pace:round(pace),source:"Hub estimate from Haslametrics efficiency and tempo; 3-point home adjustment. Not a provider prediction."};
}
function watchScore(g,byId){
 const a=byId[g.home],b=byId[g.away];if(!a||!b)return 0;
 const ra=num(a.haslamRank)||num(a.bpiRank),rb=num(b.haslamRank)||num(b.bpiRank);
 let s=ra&&rb?Math.max(0,100-(ra+rb)/5)+35/(1+Math.abs(ra-rb)/25):5;
 if(g.state==="in")s+=35;
 if(a.conference===b.conference)s+=8;
 return round(s,2);
}
function gameReason(g,byId){
 const a=byId[g.home],b=byId[g.away];if(!a||!b)return "Follow the matchup and its key players.";
 const ar=num(a.haslamRank),br=num(b.haslamRank),r=[];
 if(ar&&br&&ar<=35&&br<=35)r.push("Two of the strongest teams in the Haslametrics ratings.");
 else if(ar&&br&&Math.min(ar,br)<=30&&Math.max(ar,br)<=120)r.push("A useful test against a highly rated opponent.");
 else if(ar&&br&&Math.abs(ar-br)<35)r.push("The ratings suggest a competitive matchup.");
 else r.push("An opportunity to learn more about both teams.");
 if(a.conference===b.conference)r.push("A conference result that counts toward the league race.");
 const ao=percentile(Object.values(byId),a,"adjO"),bd=percentile(Object.values(byId),b,"adjD",true);
 if(ao>=85&&bd>=85)r.push(a.short+"'s offense meets "+b.short+"'s strong defense.");
 return r.join(" ");
}
function playerValue(p,stat="pts"){return num(p.stats&&p.stats[stat]);}
function selectPlayers(players,opts={}){
 let a=players.filter(p=>(!opts.team||p.teamId===opts.team)&&(!opts.conference||p.conference===opts.conference)&&(!opts.q||key(p.name+" "+p.team+" "+p.pos).includes(key(opts.q))));
 if(opts.pool==="prospects")a=a.filter(p=>finite(p.draftRank));
 if(opts.pool==="freshmen")a=a.filter(p=>/^fr|fresh/i.test(p.year||""));
 if(opts.pool==="playmakers")a=a.filter(p=>(playerValue(p,"ast")??0)>=3);
 if(opts.pool==="shooters")a=a.filter(p=>(playerValue(p,"threePct")??0)>=35&&(playerValue(p,"threeAtt")??0)>=2);
 const stat=opts.stat||"pts",asc=stat==="draftRank";
 a.sort((x,y)=>{const u=stat==="draftRank"?num(x.draftRank):playerValue(x,stat),v=stat==="draftRank"?num(y.draftRank):playerValue(y,stat);return (u===null)-(v===null)||(u===null||v===null?0:asc?u-v:v-u)||x.name.localeCompare(y.name);});
 return a;
}
function strengthField(teams,size=76){
 // A clearly labeled strength-only preview. It is not an NCAA selection model.
 const eligible=ranked(teams).filter(t=>t.eligible!==false&&t.conference&&finite(t.haslamRank));
 const aq=new Map();for(const t of eligible)if(!aq.has(t.conference))aq.set(t.conference,t);
 if(aq.size>size||eligible.length<size)return null;
 const auto=[...aq.values()],autoIds=new Set(auto.map(t=>t.id));
 const large=eligible.filter(t=>!autoIds.has(t.id)).slice(0,size-auto.length);
 const remaining=eligible.filter(t=>!autoIds.has(t.id)).slice(size-auto.length,size-auto.length+8);
 const field=[...auto,...large],autoOpen=auto.slice(-12),largeOpen=large.slice(-12);
 const openIds=new Set([...autoOpen,...largeOpen].map(t=>t.id));
 const slots=field.filter(t=>!openIds.has(t.id)).map(t=>({teams:[t],auto:autoIds.has(t.id),score:t.haslamRank}));
 for(const [list,type] of [[autoOpen,"AQ"],[largeOpen,"At-large"]])for(let i=0;i<list.length;i+=2){if(!list[i+1])return null;slots.push({teams:[list[i],list[i+1]],opening:type,auto:type==="AQ",score:mean([list[i].haslamRank,list[i+1].haslamRank])});}
 if(slots.length!==64)return null;
 slots.sort((a,b)=>a.score-b.score);
 const regions=[[],[],[],[]];slots.forEach((s,i)=>{const line=Math.floor(i/4),r=line%2?3-i%4:i%4;regions[r].push({...s,seed:line+1});});
 return {size,automatic:auto.length,atLarge:large.length,field,regions,lastIn:large.slice(-8),firstOut:remaining,source:"Haslametrics strength-only preview",note:"The highest-rated eligible team in each conference is the projected automatic qualifier; other spots follow Haslametrics rank. This is not a résumé-based committee prediction. Regions are illustrative and do not apply official bracketing constraints."};
}
function providerField(data){
 const rows=data&&data.march&&data.march.teams;
 if(!Array.isArray(rows)||rows.length<50)return null;
 return rows.filter(x=>x.teamId&&finite(x.seed));
}
function gamesFromESPN(data,byId,season){
 if(!Array.isArray(data?.events))return [];
 const out=[];
 for(const e of data.events){
  if(e.season?.year!=null&&Number(e.season.year)!==Number(season))continue;
  const c=e.competitions?.[0],cs=c?.competitors||[],h=cs.find(x=>x.homeAway==="home"),a=cs.find(x=>x.homeAway==="away");
  if(!h||!a||!byId[String(h.id)]||!byId[String(a.id)]||!Number.isFinite(Date.parse(e.date)))continue;
  const st=(c.status||e.status||{}).type||{},state=/postpon|cancel/i.test(st.description||"")?"off":st.state||"pre";
  out.push({id:String(e.id),day:new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(e.date)),at:e.date,home:String(h.id),away:String(a.id),neutral:!!c.neutralSite,state,detail:st.shortDetail||st.detail||"",homeScore:["in","post"].includes(state)?num(h.score):null,awayScore:["in","post"].includes(state)?num(a.score):null,tv:[...new Set((c.broadcasts||[]).flatMap(b=>b.names||[]))].join(", "),source:"ESPN live scoreboard",url:(e.links||[]).find(x=>(x.rel||[]).includes("summary"))?.href||"https://www.espn.com/mens-college-basketball/scoreboard"});
 }
 return out;
}
return {gameScore,HOME_EDGE,get SPREAD_SD(){return SPREAD_SD;},setSpreadSd,setMarket,homeEdgeFor,phi,leagueAvg,line,finite,num,mean,round,key,em,ranked,conferences,percentile,teamStory,matchup,watchScore,gameReason,playerValue,selectPlayers,strengthField,providerField,gamesFromESPN};
});
