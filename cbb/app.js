/* College Basketball Hub. Real provider snapshots, plain-language context and browser-local favorites. */
(function(){
"use strict";
const M=window.CBB,$=s=>document.querySelector(s),view=$("#view");
const esc=x=>String(x==null?"":x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safe=x=>/^https?:\/\//.test(x||"")?esc(x):"#";
const n=(x,d=1)=>M.finite(x)?Number(x).toFixed(d):"—",signed=(x,d=1)=>M.finite(x)?(x>0?"+":"")+Number(x).toFixed(d):"—";
const fmtInt=x=>M.finite(x)?Number(x).toLocaleString("en-US"):"—";
function read(k,fallback){try{return JSON.parse(localStorage.getItem(k))??fallback;}catch(e){return fallback;}}
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
let D=null,byId={},byPlayer={},advanced=!!read("ds-cbb:advanced",false),faves=new Set(read("ds-cbb:favorites",[])),pageSize=35,loading=false,liveStamp=null;
$("#advanced").checked=advanced;
const definitions={
 strength:["Team strength","A prediction-oriented assessment of how good a team is, accounting for the opposition it has faced. A team can be strong even when its tournament résumé is still thin."],
 efficiency:["Adjusted efficiency","Points scored or allowed per 100 possessions against an average opponent. Haslametrics adjusts for opponent quality; higher offensive efficiency and lower defensive efficiency are better."],
 tempo:["Tempo","Estimated possessions per 40 minutes. Pace changes how many points appear in a box score, so possession-based efficiency helps compare fast and slow teams."],
 bpi:["ESPN Basketball Power Index","ESPN's estimate of future team strength, expressed as expected point margin per 70 possessions against an average opponent on a neutral court. It has a different scale and methodology from Haslametrics."],
 sor:["Strength of Record","ESPN's résumé measure: how difficult it would be for a typical top-25 team to match or beat a team's record against that schedule. A lower SOR rank indicates a stronger résumé."],
 quadrant:["Quadrant records","The NCAA groups opponents by ranking and game location. The quadrant records shown in this hub come from Haslametrics' own hNET calculations. They are not official NCAA NET quadrant records."],
 net:["NCAA NET","The NCAA Evaluation Tool helps the selection committee organize team résumés. It is one of several selection criteria. The first official rankings are normally published in December; we do not substitute another provider's ratings for NET."],
 margin:["Efficiency margin","Adjusted offensive efficiency minus adjusted defensive efficiency, measured per 100 possessions. It is a useful summary of the two ratings; the provider's overall rank may also reflect other parts of its methodology."],
 momentum:["Haslametrics momentum","A comparison of a team's recent performances with its overall season performance. A positive reading means the recent stretch has been stronger. It is unavailable until the provider has enough data."],
 bpr:["Player impact ratings","An impact model estimates how much a player contributes beyond a traditional stat line. EvanMiya's BPR and Hoop Explorer's RAPM are different provider models. Neither is connected to this hub yet, so points per game is never presented as an impact rating."],
 seed:["Seeds, bids and the Opening Round","Conference automatic qualifiers and selected at-large teams make the NCAA tournament. In 2027 the field contains 76 teams: 24 play in 12 Opening Round games, leaving the familiar 64-team bracket. Every seed line then has four slots."],
 projections:["Projection versus result","A projection estimates something that has not happened. The forecast shown here is credited to its provider and dated. A projected conference winner or tournament seed is not a clinched outcome."],
 fg:["Field-goal percentage","Made field goals divided by attempts. It combines two- and three-point shots, so it does not by itself account for the extra value of threes or the value of free throws."]
};
function help(k,label){return '<button class="metric-help" data-learn="'+k+'" type="button">'+esc(label||definitions[k]?.[0]||k)+'</button>';}
function route(){const [r,q]=(location.hash.replace(/^#\/?/,"")||"today").split("?");return {page:r||"today",q:new URLSearchParams(q||"")};}
function setParams(values){const r=route();for(const [k,v]of Object.entries(values)){if(v===null||v===""||v===false)r.q.delete(k);else r.q.set(k,String(v));}if(!Object.hasOwn(values,"p"))r.q.delete("p");history.replaceState(null,"","#/"+r.page+(r.q.size?"?"+r.q:""));render();}
function dayNY(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function dateLabel(x,full=false){if(!x)return"Not available";const s=/^\d{4}-\d{2}-\d{2}$/.test(x)?x+"T12:00:00Z":x;const d=new Date(s);return Number.isFinite(+d)?new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",month:"short",day:"numeric",...(full?{hour:"numeric",minute:"2-digit",timeZoneName:"short"}:{})}).format(d):esc(x);}
function gameTime(g){return g.at?new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(g.at)):"Time TBA";}
function confOptions(value){const names=[...new Set(D.teams.map(t=>t.conference).filter(Boolean))].sort();return '<option value="">Every conference</option>'+names.map(c=>'<option value="'+esc(c)+'"'+(value===c?" selected":"")+'>'+esc(c)+'</option>').join("");}
function teamOptions(value,empty="Choose a team"){return '<option value="">'+empty+'</option>'+D.teams.slice().sort((a,b)=>a.short.localeCompare(b.short)).map(t=>'<option value="'+esc(t.id)+'"'+(value===t.id?" selected":"")+'>'+esc(t.short)+'</option>').join("");}
function logo(t,size){return t?.logo?'<img src="'+safe(t.logo)+'" alt="" loading="lazy"'+(size?' width="'+size+'" height="'+size+'"':"")+' onerror="this.hidden=true">':'<span class="lettermark">'+esc(t?.abbr?.slice(0,3)||"CBB")+'</span>';}
function teamName(t,sub="",star=false){if(!t)return"—";return '<div class="team-lockup">'+logo(t)+'<div class="identity"><a href="#/team?id='+encodeURIComponent(t.id)+'">'+esc(t.short)+'</a>'+(sub?'<small>'+esc(sub)+'</small>':"")+'</div>'+(star?starButton(t):"")+'</div>';}
function starButton(t){const on=faves.has(t.id);return '<button type="button" class="star" data-favorite="'+esc(t.id)+'" aria-label="'+(on?"Unfollow ":"Follow ")+esc(t.short)+'" aria-pressed="'+on+'">'+(on?"★":"☆")+'</button>';}
function record(t,conference=false){const r=t.record||{},w=conference?r.cw:r.w,l=conference?r.cl:r.l;return M.finite(w)&&M.finite(l)?n(w,0)+"–"+n(l,0):"—";}
function panel(title,body,foot="",cls=""){return '<section class="panel '+cls+'"><div class="panel-head"><h3>'+title+'</h3></div>'+body+(foot?'<div class="panel-foot">'+foot+'</div>':"")+'</section>';}
function head(title,description,kicker=""){return '<div class="section-head"><div>'+(kicker?'<p class="eyebrow">'+esc(kicker)+'</p>':"")+'<h2>'+title+'</h2><p>'+description+'</p></div></div>';}
function empty(text){return '<div class="empty">'+text+'</div>';}
function sourceLink(id){const s=D.sources[id];return s?'<a href="'+safe(s.url)+'" target="_blank" rel="noopener">'+esc(s.name)+' ↗</a>':"";}
function sourceDate(id){return dateLabel(D.sources[id]?.updated);}
function filters(q,opts={}){return '<div class="filters">'+(opts.search!==false?'<label class="grow">Search '+esc(opts.kind||"teams")+'<input id="hub-search" type="search" value="'+esc(q.get("q")||"")+'" placeholder="'+esc(opts.placeholder||"School or team name")+'" data-param="q"></label>':"")+(opts.conference===false?"":'<label>Conference<select id="hub-conference" data-param="conference">'+confOptions(q.get("conference")||"")+'</select></label>')+(opts.favorite?'<label class="check"><input type="checkbox" data-param="favorites" value="1"'+(q.get("favorites")==="1"?" checked":"")+'> Following only</label>':"")+(opts.extra||"")+'</div>';}
function filteredTeams(q){return D.teams.filter(t=>(!q.get("q")||M.key(t.name+" "+t.short+" "+t.abbr).includes(M.key(q.get("q"))))&&(!q.get("conference")||t.conference===q.get("conference"))&&(q.get("favorites")!=="1"||faves.has(t.id)));}
function pageSlice(rows,q,size=pageSize){const pages=Math.max(1,Math.ceil(rows.length/size)),p=Math.min(pages,Math.max(1,Math.floor(Number(q.get("p")))||1));return {rows:rows.slice((p-1)*size,p*size),pages,p,total:rows.length};}
function pagination(s){return '<div class="paginate"><button type="button" data-page="'+(s.p-1)+'"'+(s.p<=1?" disabled":"")+'>← Previous</button><span>'+fmtInt(s.total)+' results · '+s.p+' / '+s.pages+'</span><button type="button" data-page="'+(s.p+1)+'"'+(s.p>=s.pages?" disabled":"")+'>Next →</button></div>';}
function statusTag(g){const text=g.state==="in"?"Live · "+g.detail:g.state==="post"?"Final":g.state==="off"?"Postponed / canceled":g.at&&Date.parse(g.at)<Date.now()?"Awaiting score update":gameTime(g);return '<span class="tag '+(g.state==="in"?"live":g.state==="post"?"":"gold")+'">'+esc(text)+'</span>';}
function gameCard(g){const h=byId[g.home],a=byId[g.away];if(!h||!a)return"";const rank=t=>M.finite(t.haslamRank)?"Haslametrics #"+n(t.haslamRank,0):t.conference;
 const m=M.matchup(h,a,g.neutral),score=g.state==="in"||g.state==="post";
 return '<article class="watch-card"><div class="watch-meta"><span>'+esc(dateLabel(g.day))+(g.tv?" · "+esc(g.tv):"")+'</span>'+statusTag(g)+'</div><div class="match-teams'+(score?" has-score":"")+'">'+teamName(a,rank(a))+'<span class="'+(score?"match-score":"vs")+'">'+(score?n(g.awayScore,0)+"–"+n(g.homeScore,0):"at")+'</span>'+teamName(h,rank(h))+'</div><p class="watch-why">'+esc(M.gameReason(g,byId))+'</p><div class="watch-bottom"><a href="'+safe(g.url)+'" target="_blank" rel="noopener">'+(score?"Game & box score":"Game details")+' ↗</a><a href="#/compare?a='+esc(a.id)+'&b='+esc(h.id)+'">Compare teams →</a></div>'+(advanced&&m?'<p class="caption" style="margin:10px 0 0">Hub efficiency estimate: '+esc(m.homeMargin>=0?h.short:a.short)+' by '+n(Math.abs(m.homeMargin))+'. '+esc(m.source)+'</p>':"")+'</article>';
}
function topList(ts,source="haslam",limit=5){return '<ol class="board-list">'+M.ranked(ts,source).slice(0,limit).map(t=>'<li><span class="n">'+n(t[source+"Rank"],0)+'</span>'+teamName(t,t.conference)+'<div class="right"><b>'+record(t)+'</b><small>'+esc(source==="bpi"?"ESPN BPI":"Haslametrics")+'</small></div></li>').join("")+'</ol>';}
function featureTeam(t){if(!t)return"";return '<article class="feature-team">'+logo(t,52)+'<p class="eyebrow">Get to know a team</p><h3>'+esc(t.short)+'</h3><p>'+esc(M.teamStory(t,D.teams))+'</p><a href="#/team?id='+esc(t.id)+'">The team in 60 seconds →</a></article>';}
function learningCard(){return panel("A little context goes a long way",'<div class="learning-card"><p>College basketball makes more sense once you can separate a strong team, a good record and a tournament résumé.</p><div class="learn-links">'+["strength","efficiency","sor","seed"].map(k=>'<button type="button" data-learn="'+k+'">'+esc(definitions[k][0])+' →</button>').join("")+'</div></div>');}
function today(q){
 const day=q.get("day")||dayNY(),all=D.games.filter(g=>g.day===day&&g.state!=="off"),followed=all.filter(g=>faves.has(g.home)||faves.has(g.away));
 const chosen=(q.get("favorites")==="1"?followed:all).sort((a,b)=>M.watchScore(b,byId)-M.watchScore(a,byId));
 const dates=[...new Set([dayNY(),...D.games.filter(g=>g.day>=dayNY()).map(g=>g.day)])].sort().slice(0,12);
 if(!dates.includes(day))dates.unshift(day);
 const extra='<label>Game date<select id="game-day" data-param="day">'+dates.map(d=>'<option value="'+d+'"'+(d===day?" selected":"")+'>'+dateLabel(d)+(d===dayNY()?" · Today":"")+'</option>').join("")+'</select></label><label class="check"><input type="checkbox" data-param="favorites" value="1"'+(q.get("favorites")==="1"?" checked":"")+'> Following only</label><button class="outline" type="button" data-refresh>Refresh scores ↻</button>';
 const ranked=M.ranked(D.teams),movers=D.teams.filter(t=>M.finite(t.change7)&&t.change7>0).sort((a,b)=>b.change7-a.change7).slice(0,5);
 const bestDisagreement=D.teams.filter(t=>t.haslamRank&&t.bpiRank).sort((a,b)=>Math.abs(b.haslamRank-b.bpiRank)-Math.abs(a.haslamRank-a.bpiRank)).slice(0,5);
 const feature=ranked.filter(t=>t.haslamRank>25&&t.haslamRank<=120)[Math.floor(Date.now()/864e5)%Math.max(1,ranked.filter(t=>t.haslamRank>25&&t.haslamRank<=120).length)]||ranked[0];
 return head("Your courtside guide","Start with the games and stories that help you get into the season.","What matters "+(day===dayNY()?"today":dateLabel(day)))+
 '<div class="filters">'+extra+'</div><div class="grid two"><div class="stack" style="display:block">'+panel(chosen.length+" games to explore",chosen.length?chosen.map(gameCard).join(""):empty(q.get("favorites")==="1"?'No followed teams on this slate. <a href="#/teams">Find a team to follow</a>.':"No Division I matchups in this snapshot for the selected day."),'<span id="score-stamp">'+(liveStamp?"ESPN scores checked "+dateLabel(liveStamp,true):"Game snapshots: "+dateLabel(D.sources.games?.updated,true))+'</span>. Times shown in Eastern time.')+
 '<div class="space">'+panel("Where the models disagree",'<ol class="board-list">'+bestDisagreement.map(t=>'<li>'+teamName(t,t.conference)+'<div class="right"><b>#'+n(t.haslamRank,0)+' / #'+n(t.bpiRank,0)+'</b><small>Haslametrics / BPI</small></div></li>').join("")+'</ol>',"Different models answer similar questions in different ways. Early-season rankings can move quickly.")+'</div></div><aside class="stack">'+panel("The national picture",topList(ranked),"Haslametrics · "+sourceDate("haslam")+' · <a href="#/rankings">All team rankings →</a>')+featureTeam(feature)+learningCard()+'</aside></div>'+
 (movers.length?'<div class="space">'+head("Moving up","Biggest improvements in Haslametrics rank over seven days.")+'<div class="grid '+(movers.length>=4?"four":"three")+'">'+movers.slice(0,4).map(t=>'<div class="panel panel-body">'+teamName(t,t.conference)+'<div class="conf-facts"><div><b>↑ '+n(t.change7,0)+'</b><small>places this week</small></div><div><b>#'+n(t.haslamRank,0)+'</b><small>current rank</small></div></div><a class="more" href="#/team?id='+esc(t.id)+'">Explore '+esc(t.short)+' →</a></div>').join("")+'</div></div>':"");
}
function sortButton(key,label){return '<button type="button" data-sort="'+key+'">'+label+'</button>';}
function teamTable(rows,opts={}){
 const source=opts.source||"haslam";
 return '<div class="table-wrap"><table class="data-table"><thead><tr><th class="left">'+sortButton("rank","RK")+'</th><th class="left team-cell">Team</th><th>'+sortButton("record","Record")+'</th><th>'+sortButton("haslam","Haslametrics")+'</th><th>'+sortButton("bpi","BPI rank")+'</th><th>'+sortButton("sor","SOR rank")+'</th>'+(advanced?'<th>'+sortButton("adjO","Off /100")+'</th><th>'+sortButton("adjD","Def /100")+'</th><th>'+sortButton("margin","Margin")+'</th><th>'+sortButton("tempo","Pace")+'</th><th>'+sortButton("change","7D change")+'</th><th>'+sortButton("threeShare","3PA share")+'</th>':"")+'<th>AP poll</th><th></th></tr></thead><tbody>'+
 rows.map((t,i)=>'<tr><td class="rank">'+n(t[source+"Rank"],0)+'</td><td class="left">'+teamName(t,t.conference)+'</td><td>'+record(t)+'</td><td>'+n(t.haslamRank,0)+'</td><td>'+n(t.bpiRank,0)+'</td><td>'+n(t.sorRank,0)+'</td>'+(advanced?'<td>'+n(t.metrics.adjO)+'</td><td>'+n(t.metrics.adjD)+'</td><td>'+signed(M.em(t))+'</td><td>'+n(t.metrics.tempo)+'</td><td class="'+(t.change7>0?"positive":t.change7<0?"negative":"")+'">'+(M.finite(t.change7)?(t.change7>0?"↑ ":"↓ ")+n(Math.abs(t.change7),0):"—")+'</td><td>'+(M.finite(t.metrics.threeShare)?n(t.metrics.threeShare)+"%":"—")+'</td>':"")+'<td>'+n(t.apRank,0)+'</td><td>'+starButton(t)+'</td></tr>').join("")+'</tbody></table></div>';
}
function rankings(q){
 const source=q.get("source")==="bpi"?"bpi":"haslam",sort=q.get("sort")||"rank";let ts=M.ranked(filteredTeams(q),source);
 if(sort!=="rank"){
  const low=["haslam","bpi","sor","adjD"].includes(sort);
  const val=t=>sort==="haslam"?M.num(t.haslamRank):sort==="bpi"?M.num(t.bpiRank):sort==="sor"?M.num(t.sorRank):sort==="margin"?M.em(t):sort==="change"?M.num(t.change7):sort==="record"?(t.record.w+t.record.l>0?t.record.w/(t.record.w+t.record.l):null):M.num(t.metrics[sort]);
  ts.sort((a,b)=>{const x=val(a),y=val(b);return (x===null)-(y===null)||(x===null||y===null?0:low?x-y:y-x)||a.name.localeCompare(b.name);});
 }
 const s=pageSlice(ts,q),extra='<label>Order by model<select id="rank-source" data-param="source"><option value="haslam"'+(source==="haslam"?" selected":"")+'>Haslametrics</option><option value="bpi"'+(source==="bpi"?" selected":"")+'>ESPN BPI</option></select></label>';
 return head("The national rankings","Compare predictive team strength with tournament résumé. Each source keeps its own rating and rank.","The national picture")+filters(q,{favorite:true,extra})+
 '<div class="panel">'+(s.rows.length?teamTable(s.rows,{source}):empty("No teams match these filters."))+pagination(s)+'</div><p class="caption">Haslametrics: '+sourceDate("haslam")+' · ESPN BPI and SOR: '+sourceDate("bpi")+'. '+help("net","Where is NCAA NET?")+' · Turn on Advanced for efficiency, pace and shooting profile.</p>'+
 '<div class="space">'+comparePicker(q)+'</div>';
}
function comparePicker(q){return panel("Put two teams side by side",'<div class="panel-body"><div class="filters"><label class="grow">First team<select id="compare-a">'+teamOptions(q.get("a")||"")+'</select></label><label class="grow">Second team<select id="compare-b">'+teamOptions(q.get("b")||"")+'</select></label><button type="button" class="action" data-compare>Compare teams →</button></div></div>');}
function compare(q){
 const a=byId[q.get("a")],b=byId[q.get("b")];
 if(!a||!b)return head("Compare two teams","See their ratings, résumé, pace and shooting tendencies together.")+comparePicker(q);
 const rows=[["Haslametrics rank",a.haslamRank,b.haslamRank,0,true],["ESPN BPI rank",a.bpiRank,b.bpiRank,0,true],["ESPN SOR rank",a.sorRank,b.sorRank,0,true],["Adjusted offense /100",a.metrics.adjO,b.metrics.adjO,1,false],["Adjusted defense /100",a.metrics.adjD,b.metrics.adjD,1,true],["Efficiency margin",M.em(a),M.em(b),1,false],["Tempo",a.metrics.tempo,b.metrics.tempo,1,null],["Three-point attempt share",a.metrics.threeShare,b.metrics.threeShare,1,null],["Near-rim attempt share",a.metrics.rimShare,b.metrics.rimShare,1,null],["Projected overall wins",a.projection?.wins,b.projection?.wins,1,false]];
 return head("A closer look at the matchup","Context for the numbers: possession-adjusted ratings, results and playing style.")+comparePicker(q)+'<div class="panel space"><div class="panel-head">'+teamName(a,record(a))+'<span>vs.</span>'+teamName(b,record(b))+'</div><div class="panel-body">'+rows.map(([label,x,y,dp,low])=>'<div class="compare-row"><b class="'+(low!==null&&M.finite(x)&&M.finite(y)&&(low?x<y:x>y)?"best":"")+'">'+n(x,dp)+'</b><span>'+esc(label)+'</span><b class="'+(low!==null&&M.finite(x)&&M.finite(y)&&(low?y<x:y>x)?"best":"")+'">'+n(y,dp)+'</b></div>').join("")+'</div><div class="panel-foot">Haslametrics efficiency and shooting profile · ESPN BPI, SOR and season projections. A dash means the source has not supplied the metric.</div></div><div class="grid equal space">'+featureTeam(a)+featureTeam(b)+'</div>';
}
function conferencePage(q){
 const selected=q.get("conference"),groups=M.conferences(D.teams);
 if(selected){
  const g=groups.find(c=>c.name===selected);if(!g)return empty('Conference not found. <a href="#/conferences">Explore every conference</a>.');
  const mode=q.get("mode")||"power";let ts=M.ranked(g.teams);
  if(mode==="standings")ts.sort((a,b)=>{const ar=a.record,br=b.record,ap=(ar.cw+ar.cl)>0?ar.cw/(ar.cw+ar.cl):-1,bp=(br.cw+br.cl)>0?br.cw/(br.cw+br.cl):-1;return bp-ap||(br.cw??0)-(ar.cw??0)||((br.w??0)/Math.max(1,(br.w??0)+(br.l??0)))-((ar.w??0)/Math.max(1,(ar.w??0)+(ar.l??0)));});
  return head(esc(selected),"Conference records, power rankings and the teams driving the race.",'Conference profile')+
  '<p><a class="more" href="#/conferences">← Every conference</a></p><div class="filters"><label>View<select id="conference-mode" data-param="mode"><option value="power"'+(mode==="power"?" selected":"")+'>Team power rankings</option><option value="standings"'+(mode==="standings"?" selected":"")+'>Conference standings</option></select></label></div>'+
  '<div class="panel table-wrap"><table class="data-table"><thead><tr><th class="left">Team</th><th>Conference</th><th>Overall</th><th>Haslametrics</th><th>BPI</th><th>Projected conf W</th><th>Share of title</th><th></th></tr></thead><tbody>'+ts.map(t=>'<tr><td class="left">'+teamName(t)+'</td><td>'+record(t,true)+'</td><td>'+record(t)+'</td><td>'+n(t.haslamRank,0)+'</td><td>'+n(t.bpiRank,0)+'</td><td>'+n(t.projection?.confWins)+'</td><td>'+n(t.metrics.confTitle)+'%</td><td>'+starButton(t)+'</td></tr>').join("")+'</tbody></table></div><p class="caption">Title share is ESPN BPI’s probability of at least tying for the best regular-season conference record. Standings ties are not official tiebreaker projections.</p>';
 }
 const fields=new Set(D.march?.slots?.flatMap(s=>s.teamIds)||[]);
 return head("Every conference has a story","Compare league strength, meet the contenders, and follow the race within each conference.","The conference landscape")+
 '<div class="notice">Conference strength below is the average Haslametrics efficiency margin of rated members. It is different from a conference’s standings or tournament résumé.</div><div class="grid three">'+groups.map((g,i)=>'<article class="panel conf-card"><div class="conf-top"><div><p class="eyebrow">Conference strength</p><h3><a href="#/conferences?conference='+encodeURIComponent(g.name)+'">'+esc(g.name)+'</a></h3></div><span class="conf-rank">'+String(i+1).padStart(2,"0")+'</span></div><div class="conf-facts"><div><b>'+signed(g.average)+'</b><small>average efficiency margin</small></div><div><b>'+g.teams.filter(t=>fields.has(t.id)).length+'</b><small>in Haslametrics field</small></div></div><ul class="conf-list">'+M.ranked(g.teams).slice(0,3).map(t=>'<li><a href="#/team?id='+esc(t.id)+'">'+esc(t.short)+'</a><span>#'+n(t.haslamRank,0)+' · '+record(t)+'</span></li>').join("")+'</ul><p>'+g.rated+' of '+g.teams.length+' teams rated. '+(g.rated!==g.teams.length?"Coverage affects the average.":"")+'</p><a class="more" href="#/conferences?conference='+encodeURIComponent(g.name)+'">Standings & contenders →</a></article>').join("")+'</div>';
}

function teamsPage(q){
 const ts=pageSlice(M.ranked(filteredTeams(q)),q,32);
 return head("Find a team to follow","Meet the schools, learn their style, and make the season your own.","The teams")+filters(q,{favorite:true})+
 (faves.size?'<p class="caption">Following '+faves.size+' teams. Favorites are saved on this browser.</p>':'<p class="caption">Tap a star to follow a team. Its games will appear in your personal watchlist.</p>')+
 '<div class="team-grid">'+ts.rows.map(t=>'<article class="team-tile" style="--team:'+esc(/^#[a-f0-9]{6}$/i.test(t.color)?t.color:"#153d32")+'"><div class="tile-top"><div>'+logo(t,42)+'<h3><a href="#/team?id='+esc(t.id)+'">'+esc(t.short)+'</a></h3><span class="caption">'+esc(t.conference)+'</span></div>'+starButton(t)+'</div><div class="tile-bottom"><span>'+record(t)+' overall</span><span>Haslametrics #'+n(t.haslamRank,0)+'</span></div></article>').join("")+'</div>'+(ts.rows.length?"":empty("No teams match your filters."))+pagination(ts);
}
function metric(label,value,note){return '<div class="metric"><small>'+label+'</small><b>'+value+'</b><span>'+note+'</span></div>';}
function trend(t){const a=(t.history||[]).slice(-20).filter(M.finite);if(a.length<2)return empty("More ranking snapshots are needed for a trend.");
 const lo=Math.min(...a),hi=Math.max(...a),points=a.map((v,i)=>(10+i*480/(a.length-1)).toFixed(1)+","+(10+55*(v-lo)/Math.max(1,hi-lo)).toFixed(1)).join(" ");
 return '<div class="panel-body"><svg viewBox="0 0 500 80" role="img" aria-label="'+esc(t.short)+' Haslametrics rank moved from '+a[0]+' to '+a[a.length-1]+' over '+a.length+' published snapshots" style="display:block;width:100%;height:100px"><path d="M10 65H490" stroke="#d9ddd3" fill="none"/><polyline points="'+points+'" fill="none" stroke="#153d32" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg><div style="display:flex;justify-content:space-between" class="caption"><span>Earlier: #'+a[0]+'</span><span>Latest: #'+a[a.length-1]+'</span></div></div>';
}
function teamPage(q){
 const t=byId[q.get("id")];if(!t)return empty('Team not found. <a href="#/teams">Browse every school</a>.');
 const ps=M.selectPlayers(D.players,{team:t.id}),slot=D.march?.slots?.find(s=>s.teamIds.includes(t.id)),future=D.games.filter(g=>(g.home===t.id||g.away===t.id)&&g.day>=dayNY()).sort((a,b)=>(a.at||a.day).localeCompare(b.at||b.day)).slice(0,5);
 const highlights=t.highlights||{},shot=t.metrics||{};
 return '<p><a class="more" href="#/teams">← Every team</a></p><header class="panel team-profile" style="--team:'+esc(/^#[a-f0-9]{6}$/i.test(t.color)?t.color:"#153d32")+'">'+logo(t,76)+'<div class="profile-meta"><p class="eyebrow">'+esc(t.conference)+' · '+record(t)+' OVERALL</p><h2>'+esc(t.short)+'</h2><p>'+esc(t.coach?"Head coach: "+t.coach:t.name)+'</p></div>'+starButton(t)+'</header>'+
 '<div class="metrics">'+metric("Haslametrics rank",n(t.haslamRank,0),"Team strength · "+sourceDate("haslam"))+metric(help("bpi","ESPN BPI rank"),n(t.bpiRank,0),"Predictive rating · "+sourceDate("bpi"))+metric(help("sor","Strength of Record"),n(t.sorRank,0),"Résumé rank · ESPN")+metric("Projected seed",slot?n(slot.seed,0):"Out",slot?(slot.opening?"Opening Round · Haslametrics":"Haslametrics “deserves”"):"Haslametrics field forecast")+'</div>'+
 '<div class="panel panel-body"><p class="eyebrow">The team in 60 seconds</p><p class="team-story">'+esc(M.teamStory(t,D.teams))+'</p><div class="profile-links"><a class="outline" href="#/players?team='+esc(t.id)+'">Explore the roster →</a><a class="outline" href="#/conferences?conference='+encodeURIComponent(t.conference)+'">The conference race →</a><a class="outline" href="#/compare?a='+esc(t.id)+'">Compare a matchup →</a>'+(t.links?.schedule?'<a class="outline" href="'+safe(t.links.schedule)+'" target="_blank" rel="noopener">Full schedule ↗</a>':"")+'</div></div>'+
 '<div class="grid two space"><div>'+panel("The rotation & roster",playerTable(ps.slice(0,15),true),'<a href="#/players?team='+esc(t.id)+'">All '+ps.length+' roster players →</a> · Reported ESPN season averages. These are not impact ratings.')+'<div class="space">'+panel("The ranking trail",trend(t),"Haslametrics · last "+Math.min(20,(t.history||[]).length)+" published snapshots")+'</div></div><aside class="stack">'+panel("The analytical profile",'<div class="panel-body">'+[["Offense /100",shot.adjO,"adjO",false],["Defense /100",shot.adjD,"adjD",true],["Tempo",shot.tempo,"tempo",false]].map(([label,value,k,low])=>'<div class="compare-row" style="grid-template-columns:1fr 70px 80px;text-align:left"><span>'+label+'</span><b>'+n(value)+'</b><span class="mini-bar"><i style="width:'+(M.percentile(D.teams,t,k,low)||0)+'%"></i></span></div>').join("")+'<p class="caption" style="margin:15px 0 0">Bars show national percentiles; a longer defensive bar means fewer points allowed. '+help("efficiency","How efficiency works")+'</p></div>',sourceLink("haslam")+' · '+sourceDate("haslam"))+
 panel("Next on the schedule",future.length?future.map(gameCard).join(""):empty("No upcoming fixtures in the current snapshot."),"Games and scores are updated periodically.")+'</aside></div>'+
 (advanced?'<div class="space">'+head("How it gets its shots","Opponent-adjusted shooting tendencies from Haslametrics.")+'<div class="metrics">'+metric("Three-point attempt share",M.finite(shot.threeShare)?n(shot.threeShare)+"%":"—","Share of adjusted field-goal attempts")+metric("Near-rim attempt share",M.finite(shot.rimShare)?n(shot.rimShare)+"%":"—","Layups, tips and dunks")+metric("Three-point accuracy",M.finite(shot.threePct)?n(shot.threePct)+"%":"—","Adjusted conversion rate")+metric(help("momentum","Recent momentum"),signed(shot.momentum),"Against its season baseline")+'</div></div>':"")+
 '<div class="grid three space">'+[["latest","Most recent performance"],["best","Best performance"],["worst","Toughest performance"]].map(([k,label])=>{const g=highlights[k];return panel(label,g?'<div class="panel-body"><h3>'+n(g.us,0)+'–'+n(g.them,0)+'</h3><p class="caption">'+esc(g.venue==="A"?"at ":g.venue==="N"?"Neutral vs. ":"vs. ")+esc(g.opponent)+' · '+esc(g.date)+'</p><p class="caption">Performance versus expectation: '+signed(g.performance)+'. Haslametrics identifies this by analytical performance, rather than margin alone.</p></div>':empty("No result supplied by this source."));}).join("")+'</div>'+
 '<p class="caption">School and roster information: ESPN. Analytical profile, ranking history and performance highlights: '+sourceLink("haslam")+'. '+help("quadrant","About quadrant records")+'</p>';
}
function playerTable(ps,compact=false){
 if(!ps.length)return empty("No roster players match these filters.");
 return '<div class="table-wrap"><table class="data-table"><thead><tr><th class="left">Player</th>'+(!compact?'<th class="left">School</th>':"")+'<th>'+sortButton("pts","PTS")+'</th><th>'+sortButton("reb","REB")+'</th><th>'+sortButton("ast","AST")+'</th><th>'+sortButton("fgPct","FG%")+'</th>'+(advanced?'<th>Draft board</th>':"")+'</tr></thead><tbody>'+ps.map(p=>'<tr><td class="left"><div class="team-lockup">'+(p.head?'<img class="player-avatar" src="'+safe(p.head)+'" alt="" loading="lazy" onerror="this.hidden=true">':"")+'<div class="identity"><button type="button" class="text-button" data-player="'+esc(p.id)+'">'+esc(p.name)+'</button><small>'+esc([p.pos,p.year].filter(Boolean).join(" · "))+'</small></div></div></td>'+(!compact?'<td class="left"><a href="#/team?id='+esc(p.teamId)+'">'+esc(p.team)+'</a><small style="display:block" class="muted">'+esc(p.conference)+'</small></td>':"")+'<td>'+n(p.stats.pts)+'</td><td>'+n(p.stats.reb)+'</td><td>'+n(p.stats.ast)+'</td><td>'+(M.finite(p.stats.fgPct)?n(p.stats.fgPct)+"%":"—")+'</td>'+(advanced?'<td>'+(p.draftRank?'<a href="../draft/">#'+n(p.draftRank,0)+'</a>':"—")+'</td>':"")+'</tr>').join("")+'</tbody></table></div>';
}
function playersPage(q){
 const opts={q:q.get("q"),team:q.get("team"),conference:q.get("conference"),pool:q.get("pool"),stat:q.get("sort")||"pts"};
 let ps=M.selectPlayers(D.players,opts);if(q.get("favorites")==="1")ps=ps.filter(p=>faves.has(p.teamId));
 const s=pageSlice(ps,q,40),extra='<label>Player pool<select id="player-pool" data-param="pool">'+[["","Every roster"],["prospects","NBA draft watch"],["freshmen","Freshmen"],["playmakers","Playmakers · 3+ AST"]].map(([v,label])=>'<option value="'+v+'"'+((q.get("pool")||"")===v?" selected":"")+'>'+label+'</option>').join("")+'</select></label><label>School<select id="player-team" data-param="team">'+teamOptions(q.get("team")||"","Every school")+'</select></label>';
 return head("Get to know the players","Find a star, a freshman, a playmaker or a name to watch for the NBA draft.","The player pool")+
 filters(q,{favorite:true,kind:"players",placeholder:"Player, school or position",extra})+
 '<div class="panel">'+playerTable(s.rows)+pagination(s)+'</div><p class="caption">'+sourceLink("players")+' · '+sourceDate("players")+'. Averages are shown where reported; a dash means unavailable. Players with zero reported points remain in the roster pool. NBA prospect ranks link to the existing Big Board.</p>'+
 '<div class="notice">'+help("bpr","Looking for BPR, RAPM and other impact models?")+' Explore the specialist providers in <a href="#/sources">The analytics</a>. Those feeds are not connected yet.</div>';
}
function marchPage(q){
 const m=D.march;if(!m)return head("The road to March","Explore the tournament format and follow the published projections.")+empty('The provider has not published a complete current-season field. '+sourceLink("haslam"))+learningCard();
 const groups=[[],[],[],[]];m.slots.slice().sort((a,b)=>a.seed-b.seed).forEach(s=>groups[Math.floor((s.seed-1)/4)].push(s));
 const title=q.get("mode")==="opening"?"The Opening Round":"The projected seed lines";
 const opener=m.slots.filter(s=>s.teamIds.length===2);
 let content=q.get("mode")==="opening"?'<div class="grid three">'+opener.map(s=>'<div class="panel panel-body"><span class="tag gold">No. '+s.seed+' seed · '+esc(s.opening)+'</span><div style="margin-top:15px">'+s.teamIds.map(id=>teamName(byId[id],byId[id]?.conference)).join('<p class="caption" style="margin:10px 0">vs.</p>')+'</div></div>').join("")+'</div>':
 '<div class="seed-board">'+groups.map((ss,i)=>'<section class="seed-region"><h3>Seeds '+(i*4+1)+'–'+(i*4+4)+'</h3>'+ss.map(s=>'<div class="seed-row"><span class="seed-number">'+s.seed+'</span><div>'+s.teamIds.map(id=>'<a href="#/team?id='+esc(id)+'">'+esc(byId[id]?.short||id)+'</a>').join(' <span class="muted">/</span> ')+(s.opening?'<span class="opening">Opening Round · '+esc(s.opening)+'</span>':"")+'</div></div>').join("")+'</section>').join("")+'</div>';
 return '<div class="march-banner"><div><p class="eyebrow" style="color:#f0c65c">The road to March · '+D.season+'</p><h2>Every game adds to the résumé.</h2><p>Haslametrics’ published “deserves” projection gives us a field to follow throughout the season. In November, expect substantial movement as teams build their schedules and results.</p></div><div class="march-counter"><b>76</b><small>TEAMS IN THE FIELD</small></div></div>'+
 '<div class="notice">Projection: '+sourceLink("haslam")+' · '+dateLabel(m.updated)+'. '+esc(m.note)+' '+help("seed","How the 76-team tournament works")+'</div>'+
 '<div class="section-head"><div><h2>'+title+'</h2><p>12 Opening Round games feed into 64 main-bracket slots. These are seed lists, not official regional placements.</p></div><div class="seg" role="group" aria-label="Tournament view"><button type="button" data-march-mode="seeds" aria-pressed="'+(q.get("mode")!=="opening")+'">Seed lines</button><button type="button" data-march-mode="opening" aria-pressed="'+(q.get("mode")==="opening")+'">Opening Round</button></div></div>'+content+
 '<div class="space">'+head("Just outside the field","The next eight teams in Haslametrics’ published projection. This order is the provider’s, not an inclusion probability.")+'<div class="bubble-list">'+m.firstOut.map((id,i)=>'<article class="bubble-item">'+teamName(byId[id],byId[id]?.conference)+'<div><b>'+record(byId[id])+'</b><small style="display:block">Next out '+(i+1)+'</small></div></article>').join("")+'</div></div>'+
 '<div class="grid equal space">'+panel("Strength and résumé tell different stories",'<div class="panel-body"><p class="team-story">A team can project well in BPI or Haslametrics and still have work to do on its résumé. Compare the models with Strength of Record to understand the gap.</p><a class="more" href="#/rankings?sort=sor">Explore the résumé rankings →</a></div>')+
 panel("How the field is selected",'<div class="panel-body"><p class="team-story">Conference automatic qualifiers and at-large selections make up the field. NET is one sorting tool among several; the committee also evaluates results, schedule and other context.</p><a class="more" href="https://www.ncaa.org/championships/march-madness/selections-101/division-i-mens-basketball-championship/" target="_blank" rel="noopener">NCAA selection guide ↗</a></div>')+'</div>';
}
const providerCopy={
 haslam:"Opponent-adjusted team offense and defense, tempo, shooting profile, momentum, ranking history and a results-focused tournament forecast.",
 bpi:"ESPN's predictive team strength, offense and defense, schedule strength, season projections and conference title estimates. Strength of Record adds a résumé perspective.",
 players:"Current roster players, positions, class, coaches and reported per-game scoring, rebounding, assists and field-goal percentage.",
 games:"Game times, television listings, status and score snapshots. Extra future fixtures come from Haslametrics.",
 torvik:"T-Rank team strength, historical splits and advanced player metrics. Visit the original site while direct-feed access is unresolved.",
 kenpom:"Adjusted efficiency, tempo, schedule strength and team analysis. Full data integration needs provider access and public-display permission.",
 evanmiya:"Player BPR, team and opponent-adjusted lineup ratings, projections and roster analysis.",
 shotquality:"Expected scoring from shot quality, shot outcomes and analysis of performance against expectation.",
 cbbanalytics:"Shot charts, player and team splits, lineups, on/off statistics and scouting reports.",
 hoopexplorer:"Player impact, RAPM, lineup combinations, on/off analysis, shot charts and play-style exploration."
};
function sourcesPage(){
 const order=["haslam","bpi","players","games","torvik","kenpom","evanmiya","shotquality","cbbanalytics","hoopexplorer"];
 return head("The numbers behind the stories","Know where each number comes from, how it is being used, and which specialist tools are available at the original source.","The analytics")+
 '<div class="grid three">'+order.map(id=>{const s=D.sources[id];if(!s)return"";const on=["connected","partial"].includes(s.status);
 return '<article class="panel source-card"><span class="source-state '+(on?"ready":"")+'">'+(on?(s.error?"Connected · last successful snapshot":s.status==="partial"?"Connected · partial coverage":"Connected feed"):"Explore the original source")+'</span><h3>'+esc(s.name)+'</h3><p>'+esc(providerCopy[id]||s.note)+'</p>'+(on?'<p class="caption">'+(s.coverage?fmtInt(s.coverage)+" "+(id==="players"?"players":id==="games"?"games":"teams")+" · ":"")+"Data through "+dateLabel(s.updated)+(s.missingTeams?.length?" · "+s.missingTeams.length+" team rosters pending":"")+'</p>':'<p class="caption">'+esc(s.note||"This provider’s metrics are not currently displayed in the hub.")+'</p>')+'<a href="'+safe(s.url)+'" target="_blank" rel="noopener">Explore '+esc(s.name)+' ↗</a></article>';}).join("")+'</div>'+
 '<div class="panel space"><div class="panel-head"><h3>How this hub uses analytics</h3></div><div class="panel-body"><ol class="method-list"><li><b>Each model stays identifiable.</b> Haslametrics and BPI keep their own ranks and scales. The hub does not average ranks into an unexplained consensus.</li><li><b>Strength and résumé are separate.</b> BPI and Haslametrics describe team strength; ESPN SOR and the Haslametrics “deserves” bracket describe accomplishment and tournament outlook.</li><li><b>Conference strength is transparent.</b> We average Haslametrics offensive-minus-defensive efficiency margin across rated conference members and show the coverage.</li><li><b>Player averages are not impact ratings.</b> Reported ESPN box-score averages support the roster browser. BPR, RAPM and branded shot-quality metrics appear only when their actual feeds are connected.</li><li><b>Projections are dated.</b> Conference title shares and season wins come from ESPN BPI; the 76-team field comes from Haslametrics. No outcome is presented as clinched.</li><li><b>Unavailable values stay unavailable.</b> Missing stats and provider sentinel values are not converted into real zeroes. A failed source keeps its last successful snapshot and original timestamp.</li><li><b>Men’s Division I is the first release.</b> Women’s basketball needs separate team IDs, datasets, models and tournament projections; these men’s metrics do not stand in for them.</li><li><b>Game scores carry their own timestamps.</b> Live checks use ESPN when the browser can reach the feed; the published snapshots remain available when it cannot.</li></ol></div></div>'+
 '<div class="space">'+head("Learn the language","Short explanations for the terms you will see across the hub.")+'<div class="glossary-grid">'+Object.entries(definitions).map(([key,[title,body]])=>'<div><h3>'+esc(title)+'</h3><p>'+esc(body)+'</p></div>').join("")+'</div></div>';
}
function openPlayer(id){
 const p=byPlayer[id];if(!p)return;
 const dialog=$("#player-card"),t=byId[p.teamId],stats=[["PTS","pts"],["REB","reb"],["AST","ast"],["FG%","fgPct"]];
 $("#player-body").innerHTML='<div class="player-hero">'+(p.head?'<img src="'+safe(p.head)+'" alt="" onerror="this.hidden=true">':"")+'<p class="eyebrow">'+esc(p.team)+' · '+esc(p.conference)+'</p><h2 id="player-title">'+esc(p.name)+'</h2><p class="player-bio">'+esc([p.pos,p.year,p.height,p.weight,p.jersey?"No. "+p.jersey:""].filter(Boolean).join(" · "))+'</p><div class="player-stats">'+stats.map(([label,k])=>'<div><b>'+n(p.stats[k])+(k==="fgPct"&&M.finite(p.stats[k])?"%":"")+'</b><small>'+label+' · SEASON AVERAGE</small></div>').join("")+'</div><p class="player-take">'+(M.finite(p.stats.pts)?esc(p.name)+" is averaging "+n(p.stats.pts)+" points"+(M.finite(p.stats.reb)?", "+n(p.stats.reb)+" rebounds":"")+(M.finite(p.stats.ast)?" and "+n(p.stats.ast)+" assists":"")+" for "+esc(p.team)+".":"Reported season averages are not available for this player yet.")+'</p>'+(p.draftRank?'<p class="player-take">No. '+n(p.draftRank,0)+' on the <a href="../draft/">NBA Draft Big Board</a>, drawn from '+fmtInt(p.draftSources)+' boards. Snapshot: '+dateLabel(p.draftUpdated)+'.</p>':"")+'<p class="caption">ESPN roster snapshot · '+dateLabel(p.updated||D.sources.players?.updated)+'. These are reported averages, not a player impact model. '+help("bpr","About player impact")+'</p><div class="profile-links"><a class="outline" href="#/team?id='+esc(p.teamId)+'" data-dialog-nav>Explore '+esc(p.team)+' →</a>'+(p.url?'<a class="outline" href="'+safe(p.url)+'" target="_blank" rel="noopener">Full player statistics ↗</a>':"")+'</div></div>';
 if(!dialog.open)dialog.showModal();dialog.querySelector(".close").focus();
}
function learn(k){const d=definitions[k];if(!d)return;$("#learn-body").innerHTML='<p class="eyebrow">College basketball, explained</p><h2 id="learn-title">'+esc(d[0])+'</h2><p>'+esc(d[1])+'</p><a class="more" href="#/sources" data-dialog-nav>Explore the analytics →</a>';if(!$("#learn-card").open)$("#learn-card").showModal();}
function render(){
 if(!D)return;
 const r=route(),active=r.page==="team"?"teams":r.page==="compare"?"rankings":r.page;
 document.querySelectorAll("[data-tab]").forEach(a=>{if(a.dataset.tab===active)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});
 const focused=document.activeElement,id=focused?.id,start=focused?.selectionStart;
 const renderers={today,rankings,conferences:conferencePage,teams:teamsPage,team:teamPage,players:playersPage,march:marchPage,sources:sourcesPage,compare};
 view.innerHTML=(renderers[r.page]||today)(r.q);
 if(id){const target=document.getElementById(id);if(target&&view.contains(target)){target.focus({preventScroll:true});if(typeof start==="number"&&target.setSelectionRange)try{target.setSelectionRange(start,start);}catch(e){}}}
 $("#season-label").textContent=D.seasonLabel+" · MEN’S DIVISION I";
 $("#season-strip").innerHTML='<span>Men’s Division I · '+esc(D.seasonLabel)+'</span><span>'+fmtInt(D.teams.length)+' schools</span><span>'+fmtInt(D.players.length)+' roster players</span><span>'+M.conferences(D.teams).length+' conferences</span><span>Haslametrics through '+sourceDate("haslam")+' · BPI '+sourceDate("bpi")+'</span>';
 $("#data-foot").textContent="Haslametrics through "+sourceDate("haslam")+" · Roster snapshots "+sourceDate("players")+".";
 const stale=Date.now()-Date.parse(D.updated)>36*3600e3;
 $("#load-state").innerHTML=stale?'<div class="notice">This snapshot was last updated '+dateLabel(D.updated,true)+'. New results may not be included yet.</div>':"";
 document.dispatchEvent(new CustomEvent("cbb:render",{detail:{page:r.page}}));
}
async function load(){
 if(loading)return;loading=true;
 try{
  const res=await fetch("data/hub.json",{cache:"no-store"});if(!res.ok)throw new Error("Data snapshot unavailable");
  const data=await res.json();if(data.sport!=="ncaam"||!Array.isArray(data.teams)||!Array.isArray(data.players))throw new Error("Invalid data snapshot");
  D=data;byId=Object.fromEntries(D.teams.map(t=>[t.id,t]));byPlayer=Object.fromEntries(D.players.map(p=>[p.id,p]));render();
  document.dispatchEvent(new CustomEvent("cbb:ready"));if(route().page==="today")refreshLive(false);
 }catch(e){if(!D)view.innerHTML=empty('The basketball snapshot could not load. <button class="outline" data-reload type="button">Try again</button> or <a href="https://haslametrics.com/">explore Haslametrics</a>.');else $("#load-state").innerHTML='<div class="notice">Could not refresh. The previous snapshot is still available.</div>';}
 finally{loading=false;}
}
async function refreshLive(manual=true){
 if(!D||document.hidden)return;
 const r=route(),day=r.q.get("day")||dayNY(),url="https://site.web.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?region=us&lang=en&contentorigin=espn&dates="+day.replace(/-/g,"")+"&groups=50&limit=1000";
 const button=view.querySelector("[data-refresh]");if(button){button.disabled=true;button.textContent="Checking scores…";}
 try{
  const res=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(12000)});if(!res.ok)throw Error("Feed unavailable");
  const body=await res.json();if(!Array.isArray(body.events)||body.leagues?.[0]?.season?.year!==D.season)throw Error("Season mismatch");
  const rows=M.gamesFromESPN(body,byId,D.season),map=new Map(D.games.map(g=>[g.day+"-"+g.away+"-"+g.home,g]));
  rows.forEach(g=>map.set(g.day+"-"+g.away+"-"+g.home,g));D.games=[...map.values()];liveStamp=new Date().toISOString();
  if(route().page==="today"&&(route().q.get("day")||dayNY())===day)render();
 }catch(e){
  if(manual){const stamp=$("#score-stamp");if(stamp)stamp.textContent="Live feed unavailable · showing snapshot from "+dateLabel(D.sources.games?.updated,true);}
 }finally{const b=view.querySelector("[data-refresh]");if(b){b.disabled=false;b.textContent="Refresh scores ↻";}}
}
document.addEventListener("click",e=>{
 const b=e.target.closest("button,a");if(!b)return;
 if(b.dataset.player){openPlayer(b.dataset.player);return;}
 if(b.dataset.learn){learn(b.dataset.learn);return;}
 if(b.dataset.favorite){
  const id=b.dataset.favorite;if(faves.has(id))faves.delete(id);else faves.add(id);save("ds-cbb:favorites",[...faves]);render();view.querySelector('[data-favorite="'+id+'"]')?.focus({preventScroll:true});return;
 }
 if(b.dataset.sort){
  // Roster tables in a team profile use their own default; full sorting is in the player pool.
  if(route().page==="team"){location.hash="#/players?team="+encodeURIComponent(route().q.get("id"))+"&sort="+b.dataset.sort;return;}
  setParams({sort:b.dataset.sort});return;
 }
 if(b.dataset.page){setParams({p:b.dataset.page});return;}
 if(b.dataset.marchMode){setParams({mode:b.dataset.marchMode});return;}
 if(b.hasAttribute("data-refresh")){refreshLive(true);return;}
 if(b.hasAttribute("data-reload")){load();return;}
 if(b.hasAttribute("data-compare")){
  const a=$("#compare-a")?.value,bid=$("#compare-b")?.value;if(a&&bid)location.hash="#/compare?a="+encodeURIComponent(a)+"&b="+encodeURIComponent(bid);return;
 }
 if(b.hasAttribute("data-dialog-nav"))document.querySelectorAll("dialog[open]").forEach(d=>d.close());
});
let searchTimer;
view.addEventListener("input",e=>{const p=e.target.dataset.param;if(!p||e.target.type!=="search")return;clearTimeout(searchTimer);const value=e.target.value;searchTimer=setTimeout(()=>setParams({[p]:value}),160);});
view.addEventListener("change",e=>{const p=e.target.dataset.param;if(p)setParams({[p]:e.target.type==="checkbox"?(e.target.checked?"1":null):e.target.value});});
$("#advanced").addEventListener("change",e=>{advanced=e.target.checked;save("ds-cbb:advanced",advanced);render();});
document.querySelectorAll("dialog").forEach(d=>{d.querySelector(".close").addEventListener("click",()=>d.close());d.addEventListener("click",e=>{if(e.target===d)d.close();});});
window.addEventListener("hashchange",()=>{document.querySelectorAll("dialog[open]").forEach(d=>d.close());render();view.focus({preventScroll:true});view.scrollIntoView({block:"start"});if(route().page==="today")refreshLive(false);});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&route().page==="today")refreshLive(false);});
setInterval(()=>{if(!document.hidden&&route().page==="today")refreshLive(false);},90000);
load();
})();
