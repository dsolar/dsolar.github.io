/* Dynasty laboratory. Amounts in $M. See rules.md for modeled rules and data limits. */
(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const rnd=x=>Math.round(x*100)/100;
function limits(year){const cap=176*Math.pow(1.05,year-2027),scale=cap/140.588;return {cap,tax:170.814*scale,first:178.132*scale,second:188.931*scale,min:2.6*cap/176,bracket:5.168*scale,match:7.752*scale};}
function roster(s,c){return s.players.filter(p=>p.team===c);}
function payroll(s,c){return sum(roster(s,c).map(p=>p.salary))+(s.teams[c].dead||0);}
function reserved(s,c){return sum(s.offers.filter(o=>o.bidder===c).map(o=>o.salary));}
function holds(s,c,exclude){return sum(s.players.filter(p=>!p.team&&p.rights===c&&p.id!==exclude).map(p=>p.hold||0));}
function capUsed(s,c,exclude){return payroll(s,c)+holds(s,c,exclude)+reserved(s,c)+Math.max(0,12-roster(s,c).length)*limits(s.year).min;}
function tax(s,c,pay=payroll(s,c)){const l=limits(s.year),rep=(s.teams[c].taxHistory||[]).slice(-4).filter(Boolean).length>=3;let rem=Math.max(0,pay-l.tax),total=0,i=0;while(rem>0){const rate=([1,1.25,3.5,4.75][i]??(5.25+(i-4)*.5))+(rep?2:0);let n=Math.min(rem,l.bracket);total+=n*rate;rem-=n;i++;}return rnd(total);}
function strength(s,c){const r=roster(s,c).sort((a,b)=>b.ovr-a.ovr).slice(0,10);return sum(r.map((p,i)=>(p.ovr-72)*(i<5?1:.5)))/7.5;}
function outlook(s,c){const r=roster(s,c),avg=sum(r.map(p=>p.age))/Math.max(1,r.length),power=strength(s,c);return power>8?'Contender':avg<26.5||power<0?'Rebuilding':'Playoff chase';}
function budget(s,c){const l=limits(s.year),t=s.teams[c],goal=outlook(s,c);return t.spend==='tax' ? l.tax-.1 : t.spend==='all-in'&&goal==='Contender'?l.second+l.cap*.06:l.second-.1;}
function financial(s,c){const l=limits(s.year),p=payroll(s,c);return p>l.second?'Second apron':p>l.first?'First apron':p>l.tax?'Taxpayer':p>l.cap?'Over cap':'Cap space';}
function log(s,msg){s.log.unshift({year:s.year,day:s.day,text:msg});s.log=s.log.slice(0,150);}
function normalize(p,team){return {id:p.key||p.id||p.t+'|'+p.n,name:p.n||p.name,team,origin:p.t,age:p.age||25,pos:p.bpos||p.pos||'SF',ovr:p.ovr||65,potential:p.potr||p.ovr||65,salary:+p.s||2.6,years:Math.max(1,p.yrs||1),schedule:[p.s28,p.s29].filter(v=>v!=null),market:Math.max(2.6,p.mv||p.s||2.6),rights:null,tenure:0,rfaEligible:p.st==='rfa',twoWay:p.st==='tw',newUntil:0};}
function seed(data,names,expansion){
 const teams={};Object.keys(names).forEach(c=>{teams[c]={name:names[c],spend:'apron',dead:0,assets:[],taxHistory:[]};});
 const players=data.map(p=>normalize(p,p.st==='ufa'?null:p.t));
 const s={version:1,year:2027,day:0,phase:'offseason',user:Object.keys(names)[0],teams,players,offers:[],log:[],history:[],seed:4137};
 Object.keys(teams).forEach(c=>{const state=outlook(s,c);teams[c].spend=state==='Rebuilding'?'tax':state==='Contender'&&strength(s,c)>12?'all-in':'apron';});
 players.forEach(p=>{if(p.twoWay){p.team=null;p.rfaEligible=false;} if(p.team){p.tenure=2;} });
 if(expansion){
  s.user=expansion.user;const ids=new Set();
  for(const [code,t] of Object.entries(expansion.teams)){
   teams[code]={name:t.name,spend:'apron',dead:0,assets:copy(t.assets||[]),taxHistory:[],depth:copy(t.depth),coach:t.coach};
   for(const raw of t.roster){const p=normalize(raw,code),i=players.findIndex(x=>x.id===p.id);p.tenure=raw.signed?1:2; if(i>=0)players[i]=p;else players.push(p);ids.add(p.id);}
   for(const id of t.waived||[]){const p=players.find(x=>x.id===id);if(p&&!ids.has(id))p.team=null;}
  }
  // Year-one market did not retain NBA destinations. Keep unassigned UFAs in the market.
  s.history.push({year:2027,records:copy(expansion.results||{}),note:'Expansion season imported'});
  log(s,'Imported expansion rosters, contracts, assets, depth charts and season records. NBA free-agent destinations missing from the old game remain unassigned.');
  rollover(s);
 }else{ s.user='BOS';log(s,'Sandbox starts from the expansion game’s projected 2027 player pool. Ownership budgets and contract rights are modeled assumptions.'); }
 return s;
}
function random(s){let a=s.seed|0;a=a+0x6D2B79F5|0;s.seed=a;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}
function rollover(s){
 s.year++;s.day=0;s.phase='offseason';s.offers=[];
 for(const p of s.players){p.age++;p.newUntil=0;if(p.team){p.years--;p.tenure++;if(p.years<=0){p.rights=p.team;p.team=null;p.rfa=!!p.rfaEligible;p.hold=rnd(p.salary*(p.tenure>=3?1.5:1.2));p.lastSalary=p.salary;}else{p.salary=p.schedule.length?p.schedule.shift():p.salary;}}
  const growth=p.age<27?Math.min(2,Math.max(0,p.potential-p.ovr)*.25):p.age>30?-Math.min(3,(p.age-30)*.35):0;p.ovr=clamp(rnd(p.ovr+growth+(random(s)-.5)*1.5),45,99);p.market=clamp(p.market*(1+growth*.035),limits(s.year).min,limits(s.year).cap*.35);
 }
 for(const t of Object.values(s.teams)){t.hardCap=null;t.deadContracts=(t.deadContracts||[]).map(d=>({...d,years:d.years-1})).filter(d=>d.years>0);t.dead=sum(t.deadContracts.map(d=>d.salary));}
 log(s,'Offseason opened. Contracts advanced one year; expiring players retain modeled rights and cap holds.');
}
function ask(s,p,c){const veteran=p.age>=30&&outlook(s,c)!=='Contender'?1.12:1;return rnd(clamp(p.market*veteran*Math.max(.7,1-s.day*.025),limits(s.year).min,limits(s.year).cap*.35));}
function signCheck(s,c,p,salary,years){
 if(s.phase!=='offseason')return 'Free agency is closed.';
 if(!p||p.team)return 'Player is no longer available.';
 if(s.offers.some(o=>o.player===p.id))return 'An offer sheet is pending.';
 if(!Number.isFinite(salary)||!Number.isInteger(years)||years<1||years>4)return 'Use a valid salary and a 1–4 year term.';
 const l=limits(s.year);if(salary<l.min-.01||salary>l.cap*.35+.01)return 'Salary is outside this prototype’s minimum/maximum range.';
 if(roster(s,c).length+s.offers.filter(o=>o.bidder===c).length>=15)return 'No roster slot available.';
 if(s.teams[c].hardCap&&payroll(s,c)+reserved(s,c)+salary>s.teams[c].hardCap+.001)return 'This team is hard-capped by an earlier transaction.';
 const own=p.rights===c;
 const bird=own&&p.tenure>=3;
 const nonBird=own&&salary<=Math.max((p.lastSalary||p.salary)*1.2,l.min*1.2);
 if(salary>l.min+.01&&!bird&&!nonBird&&capUsed(s,c,p.id)+salary>l.cap+.001)return 'Not enough cap room. Renounce rights or shed salary; this build does not use the mid-level exception.';
 if(salary+0.01<ask(s,p,c))return 'Player declines: below his current asking price.';
 return null;
}
function commitSign(s,p,c,salary,years){p.team=c;p.salary=salary;p.years=years;p.schedule=Array(years-1).fill(salary);p.rights=null;p.hold=0;p.rfa=false;p.rfaEligible=false;p.newUntil=s.day+90;log(s,`${s.teams[c].name} signed ${p.name}: ${years} years, $${salary.toFixed(1)}M per year.`);}
function sign(s,c,id,salary,years){const p=s.players.find(p=>p.id===id),err=signCheck(s,c,p,salary,years);if(err)return {ok:false,why:err};if(p.rfa&&p.rights&&p.rights!==c){s.offers.push({player:id,bidder:c,owner:p.rights,salary,years,expires:s.day+2});log(s,`${p.name} signed an offer sheet with ${s.teams[c].name}; ${s.teams[p.rights].name} has two days to match.`);}else commitSign(s,p,c,salary,years);return {ok:true};}
function resolve(s,id,match){const o=s.offers.find(x=>x.player===id);if(!o)return {ok:false,why:'Offer not found.'};const p=s.players.find(x=>x.id===id);if(match&&(roster(s,o.owner).length>=15||s.teams[o.owner].hardCap&&payroll(s,o.owner)+o.salary>s.teams[o.owner].hardCap))return {ok:false,why:'Matching would exceed a roster limit or hard cap.'};s.offers=s.offers.filter(x=>x!==o);commitSign(s,p,match?o.owner:o.bidder,o.salary,o.years);log(s,`${s.teams[o.owner].name} ${match?'matched':'declined'} the offer sheet for ${p.name}.`);return {ok:true};}
function renounce(s,c,id){const p=s.players.find(x=>x.id===id);if(!p||p.team||p.rights!==c||s.offers.some(o=>o.player===id))return {ok:false,why:'Rights cannot be renounced now.'};p.rights=null;p.rfa=false;p.hold=0;log(s,`${s.teams[c].name} renounced ${p.name}.`);return {ok:true};}
function release(s,c,id){const p=s.players.find(x=>x.id===id);if(!p||p.team!==c||s.phase!=='offseason')return {ok:false,why:'Player cannot be waived now.'};const t=s.teams[c];t.deadContracts=t.deadContracts||[];t.deadContracts.push({name:p.name,salary:p.salary,years:p.years});t.dead=(t.dead||0)+p.salary;p.team=null;p.rights=null;p.rfa=false;p.hold=0;p.newUntil=0;log(s,`${s.teams[c].name} waived ${p.name}; guaranteed salary remains on its books. Set-off is not modeled.`);return {ok:true};}
function tradeSide(s,c,out,inc){
 const l=limits(s.year),before=payroll(s,c),os=sum(out.map(p=>p.salary)),ins=sum(inc.map(p=>p.salary)),after=before-os+ins;
 if(roster(s,c).length-out.length+inc.length>15)return {error:'Trade would exceed 15 roster spots.'};
 if(out.some(p=>p.newUntil>s.day))return {error:'A recently signed player is not trade eligible in this offseason.'};
 if(s.teams[c].hardCap&&after>s.teams[c].hardCap+.001)return {error:'Trade violates the team’s existing hard cap.'};
 if(after>l.second&&out.length>1&&ins>Math.max(0,...out.map(p=>p.salary))+.001)return {error:'Second-apron team cannot aggregate salaries to acquire this package.'};
 let hard=null;
 if(after>l.first){if(ins>os+.001)return {error:'Above the first apron, incoming salary cannot exceed outgoing salary.'};}
 else if(capUsed(s,c)-os+ins<=l.cap+.25){}
 else {const allowed=Math.max(Math.min(2*os+.25,os+l.match),1.25*os+.25);if(ins>allowed+.001)return {error:'Incoming salary exceeds matching allowance.'};if(ins>os+.25)hard=l.first;}
 if(out.length>1&&ins>Math.max(0,...out.map(p=>p.salary))+.25)hard=Math.min(hard||Infinity,l.second);
 return {after,hard};
}
function tradeValue(s,c,p){const rebuild=outlook(s,c)==='Rebuilding',r=roster(s,c),need=r.filter(x=>x.pos===p.pos).length<2?3:0;return (p.ovr-62)*(rebuild?1:1.6)+(rebuild?Math.max(0,28-p.age)*2:0)+Math.max(0,p.potential-p.ovr)*.6+(p.market-p.salary)*Math.min(p.years,3)*.35+need;}
function evaluateTrade(s,a,b,outIds,inIds){
 if(a===b||!s.teams[a]||!s.teams[b])return {ok:false,why:'Choose two different teams.'};
 if(new Set(outIds).size!==outIds.length||new Set(inIds).size!==inIds.length||!outIds.length&&!inIds.length)return {ok:false,why:'Select a valid package.'};
 const out=outIds.map(id=>s.players.find(p=>p.id===id)),inc=inIds.map(id=>s.players.find(p=>p.id===id));
 if(out.some(p=>!p||p.team!==a)||inc.some(p=>!p||p.team!==b))return {ok:false,why:'Roster changed; select again.'};
 const aa=tradeSide(s,a,out,inc),bb=tradeSide(s,b,inc,out);if(aa.error||bb.error)return {ok:false,why:`${s.teams[aa.error?a:b].name}: ${aa.error||bb.error}`};
 const savings=(payroll(s,b)+tax(s,b))-(bb.after+tax(s,b,bb.after));
 const pressure=payroll(s,b)>budget(s,b)?1.1:.2;
 const delta=sum(out.map(p=>tradeValue(s,b,p)))-sum(inc.map(p=>tradeValue(s,b,p)))+savings*pressure;
 const rejects=bb.after>budget(s,b)&&bb.after>payroll(s,b)+.01;
 const starLoss=inc.some(p=>p.ovr>=90)&&!out.some(p=>p.ovr>=86);
 return {ok:!rejects&&!starLoss&&delta>=2,legal:true,why:rejects?'Ownership rejects the added payroll.':starLoss?'Their franchise player requires a credible star return.':delta<2?'The return does not justify the talent, age and contract value they give up.':`Accepted: roster fit and value justify the deal; estimated payroll + tax change $${(-savings).toFixed(1)}M.`,aa,bb,out,inc};
}
function trade(s,a,b,outIds,inIds){const e=evaluateTrade(s,a,b,outIds,inIds);if(!e.ok)return e;e.out.forEach(p=>p.team=b);e.inc.forEach(p=>p.team=a);if(e.aa.hard)s.teams[a].hardCap=Math.min(s.teams[a].hardCap||Infinity,e.aa.hard);if(e.bb.hard)s.teams[b].hardCap=Math.min(s.teams[b].hardCap||Infinity,e.bb.hard);log(s,`${s.teams[a].name} sent ${e.out.map(p=>p.name).join(', ')||'cap room'} to ${s.teams[b].name} for ${e.inc.map(p=>p.name).join(', ')||'cap relief'}.`);return {ok:true,why:e.why};}
function advance(s){
 if(s.phase!=='offseason')return {ok:false,why:'Open the next offseason first.'};if(s.offers.some(o=>o.owner===s.user&&o.expires<=s.day))return {ok:false,why:'Decide on the pending offer sheet first.'};s.day++;
 for(const o of [...s.offers])if(o.expires<=s.day){if(o.owner===s.user)return {ok:true,why:'An offer sheet needs your decision before advancing again.'};const p=s.players.find(p=>p.id===o.player);resolve(s,o.player,payroll(s,o.owner)+o.salary<=budget(s,o.owner)&&p.market*1.2>=o.salary&&roster(s,o.owner).length<15);}
 const codes=Object.keys(s.teams).filter(c=>c!==s.user);
 // AI salary relief only happens when both clubs approve the package.
 let deals=0;
 for(const seller of codes){
  if(payroll(s,seller)<=budget(s,seller)||deals>=3)continue;
  const candidates=roster(s,seller).filter(p=>p.ovr<90&&p.newUntil<=s.day).sort((a,b)=>(b.salary-b.market)-(a.salary-a.market));
  let done=false;
  for(const p of candidates){for(const buyer of codes){if(buyer===seller||payroll(s,buyer)+p.salary>budget(s,buyer))continue;
   const a=evaluateTrade(s,buyer,seller,[],[p.id]),b=evaluateTrade(s,seller,buyer,[p.id],[]);
   if(a.ok&&b.ok){trade(s,buyer,seller,[],[p.id]);deals++;done=true;break;}
  }if(done)break;}
 }

 for(const c of codes){
  const opts=s.players.filter(p=>!p.team).sort((a,b)=>(b.ovr+(b.rights===c?4:0))-(a.ovr+(a.rights===c?4:0)));
  for(const p of opts){const salary=ask(s,p,c),years=p.age<28?3:p.age<32?2:1;if(payroll(s,c)+reserved(s,c)+salary>budget(s,c))continue;if(sign(s,c,p.id,salary,years).ok)break;}
  // Renounce unaffordable expiring rights after a week so the market can open.
  if(s.day>=7)for(const p of s.players.filter(p=>!p.team&&p.rights===c&&!p.rfa))renounce(s,c,p.id);
 }
 return {ok:true,why:'Market advanced one day. Other teams made offers within their budgets.'};
}
function simulate(s){
 if(s.phase!=='offseason')return {ok:false,why:'This season has already been played.'};
 if(s.offers.length)return {ok:false,why:'Resolve pending offer sheets before playing.'};
 if(roster(s,s.user).length>15)return {ok:false,why:'Your roster exceeds 15 players. Waive or trade surplus players first.'};
 if(roster(s,s.user).length<13)return {ok:false,why:'Sign at least 13 players before playing.'};
 const codes=Object.keys(s.teams);for(const c of codes){while(roster(s,c).length>15){const surplus=roster(s,c).sort((a,b)=>a.ovr-b.ovr)[0];release(s,c,surplus.id);}while(roster(s,c).length<13){const i=s.players.length;s.players.push({id:`replacement-${s.year}-${i}`,name:`Replacement ${i}`,team:c,age:25,pos:['PG','SG','SF','PF','C'][i%5],ovr:60,potential:62,salary:limits(s.year).min,years:1,schedule:[],market:limits(s.year).min,tenure:0});}}
 const records={};codes.forEach(c=>records[c]={w:0,l:0});
 // Each team plays the same opponent twice per round: 82 games, conserved wins/losses.
 function game(a,b){const win=random(s)<1/(1+Math.exp(-(strength(s,a)-strength(s,b))/6))?a:b;records[win].w++;records[win===a?b:a].l++;}
 for(let i=0;i<codes.length;i++)for(let j=i+1;j<codes.length;j++){game(codes[i],codes[j]);game(codes[j],codes[i]);}
 const extra=(82-2*(codes.length-1))/2;
 for(let d=1;d<=extra;d++)for(let i=0;i<codes.length;i++)game(codes[i],codes[(i+d)%codes.length]);
 const ranked=codes.sort((a,b)=>records[b].w-records[a].w);s.history.push({year:s.year,records,leader:ranked[0]});s.phase='results';codes.forEach(c=>s.teams[c].taxHistory.push(payroll(s,c)>limits(s.year).tax));log(s,`Season finished. ${s.teams[ranked[0]].name} led the regular season. Playoffs and rookie drafts are not yet simulated in this build.`);return {ok:true};
}
function validate(s){if(!s||s.version!==1||!s.teams||!Array.isArray(s.players)||!s.teams[s.user]||!Array.isArray(s.offers)||!Array.isArray(s.history)||!Array.isArray(s.log)||!Number.isInteger(s.year)||s.year<2027||s.year>2200||!Number.isFinite(s.day))throw Error('Unsupported or invalid save.');for(const [c,t] of Object.entries(s.teams)){if(!/^[A-Z]{2,4}$/.test(c)||typeof t.name!=='string'||!Array.isArray(t.assets)||!Array.isArray(t.taxHistory))throw Error('Invalid team data.');}const ids=new Set();for(const p of s.players){if(typeof p.id!=='string'||ids.has(p.id)||typeof p.name!=='string'||p.team&&!s.teams[p.team]||!Number.isFinite(p.salary)||p.salary<0||!Number.isFinite(p.ovr)||!Array.isArray(p.schedule))throw Error('Invalid roster data.');ids.add(p.id);}for(const o of s.offers)if(!ids.has(o.player)||!s.teams[o.bidder]||!s.teams[o.owner])throw Error('Invalid offer sheet.');return s;}
const api={seed,limits,roster,payroll,capUsed,tax,outlook,budget,financial,ask,sign,resolve,renounce,release,evaluateTrade,trade,advance,simulate,rollover,validate,copy};if(typeof module!=='undefined')module.exports=api;else root.Dynasty=api;
})(typeof window!=='undefined'?window:globalThis);
