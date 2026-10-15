'use strict';
// Local phrase matching, not a language model. No word or phrase blacklist.
(function(root){
const normalize=s=>String(s).toLowerCase().replace(/[’‘]/g,"'").replace(/[^a-z0-9' ]/g,' ').replace(/\s+/g,' ').trim();
const filler=new Set(['i','im','i’m','a','an','the','it','is','are','to','of','and','you','your','me','my','we','this','that','what','how','do','does','would','can','could','be','in','on','for']);
const tokens=s=>new Set(normalize(s).split(' ').filter(w=>w&&!filler.has(w)));
const bank={
 hello:['yo folkz','champion','what we got bra','bruv'],
 visit:['whens dat visit?','need dates folkz','Visit or peRish'],
 visitNo:['Lolz\nanother cancelled visit','all talk folkz','guy lost the plot\nVisit or peRish'],
 visitMaybe:['might. classic','need a date not a concept bud','whens dat visit?'],
 visitYes:['champion\nwhat dates','we do it all','top tier MTL incoming'],
 visitDates:['now we have a date\nchampion','actual plans\nwe do it all','top tier MTL'],
 boston:['magachusetts','magachusetts folkz at it again','Lolz. hometown propaganda'],
 bostonToMtl:['Boston to MTL','magachusetts to da great norfe','top tier route folkz'],
 ring:['#Ring','hardware speaks folkz','champion. #Ring'],
 work:['guy lost the plot','meeting about a meeting rn?','folkz doing the moost','Tryna stay locked in at work and coparenting','Doing it all up here'],
 music:['Lolz appreciate the trust musically','I still use Pandora mainly but also have a basic Spotify acct','who has TouchTunes','hand over the playlist folkz','I usually go hip hop and r&b based on the crowd','dude I’m a customer lol'],
 dad:['international girl dad','girl dad hours','we do it all','Tryna stay locked in at work and coparenting'],
 montreal:['top tier MTL','MTL folkz know','StReetz'],
 sports:['GameDay baby\nWe are so back','One inning at a time','King Vrabez will have the boys regroup','U can lose to the defending champs on the road lol','champion behavior','Son-He Gray WednesDaze for da szn','sports folkz rn'],
 nightlife:["int’l StReetz is hot",'Ok I’ll make friends lfg','Nice yeah I been running music at half the bars I’m a regular at','We Up'],
 analysis:['Guy lost da plot years ago','No longer a funny banter talking point someone actually has to intervene','This is how it goes','they’re good at short memory move on'],
 fashion:["your favorite rapper's dressin' like Comic Con",'Comic Con fit bra','guy dressed for the moost'],
 relationship:['international singlehood','Int’l singlehood > whipped Magamericans','international single girl dads straight crushing da game tho','Need more whipped friends to come wing','Lolz\nchapHim'],
 beach:['all white beach town','beach folkz doing the moost'],
 matt:['Mattenyahu','Matt Trump','Mattenyahu rn'],
 wednesday:['WednesDaze','WednesDaze folkz'],
 north:['da great norfe','top tier da great norfe'],
 quebec:['Queeb','Queeb StReetz','top tier Queeb'],
 goodbye:['talk soonZ','talk soonZ bruv'],
 laugh:['Lolz','Lolz yikeZ','Lmao','moost','folkz get it'],
 yes:['champion','we do it all','there it is','Ya','Oh dam of course'],
 no:['Lolz. noted','tough crowd folkz','guy lost the plot'],
 repeat:['fair. new material needed','Lolz. caught me','guy has one bit'],
 unknown:['what happened bra','go on folkz','need more here bud','bruv\nexplain that one','I know','iykyk'],
 question:['need more context folkz','what are the options rn','what are we working with bruv'],
 followup:['go on bra','what happened next','explain that part bud'],
 visitFollow:['a date. thats what we need','less theory more booking','whens dat visit?'],
 ringFollow:['the hardware folkz. #Ring','champion credentials'],
 workFollow:['what did they say','how many meetings are we talking','guy lost the plot'],
 musicFollow:['what song','who picked this','TouchTunes situation?','Lolz appreciate the trust musically'],
 montrealFollow:['top tier. self explanatory','MTL StReetz folkz'],
 bostonFollow:['magachusetts defense team has arrived','Lolz. make the case'],
 dadFollow:['international girl dad schedule','we do it all'],
 sportsFollow:['I know','1 of 17','This is how it goes','we Up','Son-He'],
 nightlifeFollow:["int’l StReetz is hot",'Need more whipped friends to come wing','We Up'],
 analysisFollow:['guy lost da plot','I know','iykyk'],
 fashionFollow:['Comic Con bruv','the fit doing the moost'],
 relationshipFollow:['international singlehood tho','chapHim'],
 beachFollow:['all white beach town','beach folkz'],
 mattFollow:['Mattenyahu','Matt Trump'],
 quebecFollow:['Queeb folkz','top tier Queeb']
};
const rules=[
 ['matt',/\b(matt|matthew|mattenyahu)\b/],
 ['ring',/\b(world series|championship|ring)\b/],
 ['work',/\b(work|boss|job|meeting|office|email|coworker|deadline)\b/],
 ['music',/\b(music|song|jukebox|touchtunes|playlist|spotify|pandora|dj|concert)\b/],
 ['dad',/\b(dad|father|parent|daughter|kid|kids|family|coparent|coparenting)\b/],
 ['fashion',/\b(rapper|comic con|outfit|fit|fashion|dress|dressed|dressing)\b/],
 ['relationship',/\b(girlfriend|boyfriend|wife|husband|wedding|date|dating|single|singlehood|whipped)\b/],
 ['nightlife',/\b(bar|bars|club|party|nightlife|weekend|wknd|wingman|wing)\b/],
 ['beach',/\b(beach|shore|ocean|seaside)\b/],
 ['sports',/\b(soccer|football|baseball|basketball|nba|nfl|mlb|celtics|bruins|habs|hockey|sox|titans|spurs|tottenham|son heung|min|team|game|playoffs|match|season|playcalling)\b/],
 ['analysis',/\b(take|opinion|propaganda|debate|argument|intervene|intervention|lost the plot)\b/],
 ['wednesday',/\bwednesday\b/],
 ['goodbye',/\b(bye|goodbye|later|talk soon|good night|goodnight)\b/],
 ['visit',/\b(visit|trip|travel|flight|come over|coming|vacation|booked|booking)\b/],
 ['boston',/\b(boston|massachusetts|magachusetts|sox|fenway)\b/],
 ['quebec',/\b(quebec|queb|queeb)\b/],
 ['montreal',/\b(montreal|mtl)\b/],
 ['north',/\b(canada|north|norfe)\b/]
];
function createEngine(random=Math.random){
 let state={topic:null,age:0,recent:[],used:new Map(),lastInput:''};
 function pick(pool){const fresh=pool.filter(s=>!state.recent.includes(s));const choices=fresh.length?fresh:pool;const min=Math.min(...choices.map(s=>state.used.get(s)||0));const least=choices.filter(s=>(state.used.get(s)||0)===min);return least[Math.floor(random()*least.length)];}
 function reply(input,examples=[]){
  const s=normalize(input), words=tokens(input);let topic=null,key=null;
  // Exact user-supplied exchanges win. Related examples require meaningful overlap.
  const matches=examples.filter(e=>e&&typeof e.prompt==='string'&&typeof e.reply==='string'&&e.reply.trim()).map(e=>{const p=normalize(e.prompt),t=tokens(e.prompt);const overlap=[...t].filter(w=>words.has(w)).length;return {e,score:s===p?100:overlap>=2?overlap/(t.size+words.size-overlap):0};}).filter(m=>m.score>=.45).sort((a,b)=>b.score-a.score);
  let text;
  if(matches.length){text=pick(matches.filter(m=>m.score===matches[0].score).map(m=>m.e.reply));topic='custom';}
  else {
   const found=rules.filter(([,re])=>re.test(s));
   // Prefer the later topic after contrast: "not work, about the ring".
   const contrast=s.split(/\b(?:but|instead|actually)\b/).pop();
   topic=found.find(([,re])=>contrast!==s&&re.test(contrast))?.[0]||found[0]?.[0]||null;
   if(/\b(boston|magachusetts)\b.*\b(montreal|mtl)\b|\b(montreal|mtl)\b.*\b(boston|magachusetts)\b/.test(s))topic='bostonToMtl';
   const follow=/^(why|how so|really|what do you mean|tell me more|and then|what next|what about that|what|how come)\b/.test(s);
   const negative=/\b(no|never|not|cant|cannot|can't|won't|wont|cancelled|canceled|busy)\b/.test(s);
   const maybe=/\b(maybe|might|possibly|sometime|eventually|thinking)\b/.test(s);
   const positive=/\b(yes|yeah|sure|okay|ok|agreed|deal|absolutely|booked|coming|will)\b/.test(s);
   const date=/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|january|february|march|april|may|june|july|august|september|october|november|december|next week|next month|weekend)\b/.test(s);
   if(/\b(repeating|repeat yourself|said that|same thing|another line|new material)\b/.test(s)||s===state.lastInput) key='repeat';
   else if(!topic&&/^(hi|hey|hello|yo|sup)( nick| folkz)?$/.test(s))key='hello';
   else if((topic==='visit'||(!topic&&state.topic==='visit'&&state.age<2&&(follow||negative||positive||date)))){topic='visit';key=negative?'visitNo':maybe?'visitMaybe':date?'visitDates':positive?'visitYes':follow?'visitFollow':'visit';}
   else if(topic)key=topic;
   else if(follow&&state.topic&&state.age<2)key=bank[state.topic+'Follow']?state.topic+'Follow':'followup';
   else if(/^(lol|lolz|haha|hahaha|lmao)[! .]*$/.test(s))key='laugh';
   else if(/^(yes|yeah|sure|okay|ok|agreed|deal|absolutely)$/.test(s))key='yes';
   else if(/^(no|nah|nope|never)$/.test(s))key='no';
   else key=input.includes('?')?'question':'unknown';
   text=pick(bank[key]);
  }
  if(topic){state.topic=topic;state.age=0;}else state.age++;
  state.lastInput=s;state.recent.push(text);state.recent=state.recent.slice(-8);state.used.set(text,(state.used.get(text)||0)+1);
  return text;
 }
 return {reply,reset(){state={topic:null,age:0,recent:[],used:new Map(),lastInput:''};}};
}
root.NickEngine={createEngine,normalize};
if(typeof module!=='undefined')module.exports=root.NickEngine;
})(typeof globalThis!=='undefined'?globalThis:window);
