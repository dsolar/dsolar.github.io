'use strict';
const originals=['Lolz','moost','whens dat visit?','folkz','international girl dad','magachusetts','all white beach town','guy lost the plot','StReetz','we do it all','top tier MTL','Visit or peRish','champion','Queeb','Mattenyahu','Son-He','chapHim','Majdiion','Gutter Boy','#Ring'];
const topics=[
 {id:'visit',re:/\b(visit|trip|travel|flight|come over|coming|weekend|vacation)\b/i,quotes:['whens dat visit?','Visit or peRish','top tier MTL'],replies:['whens dat visit?','“might” is doing a lot of work here folkz. Visit or peRish','book it champion. top tier MTL awaits','dates. need dates. this is not a theoretical visit']},
 {id:'boston',re:/\b(boston|massachusetts|magachusetts|sox|fenway)\b/i,quotes:['magachusetts','Lolz','top tier MTL'],replies:['magachusetts propaganda. Lolz','strong claim from someone who could be in MTL','guy lost the plot. whens dat visit?']},
 {id:'ring',re:/\b(ring|baseball|world series|championship|champion)\b/i,quotes:['#Ring','champion','we do it all'],replies:['#Ring','some folkz talk. some folkz have hardware. #Ring','champion behavior. we do it all']},
 {id:'work',re:/\b(work|boss|job|meeting|office|email|stress|worst|bad day)\b/i,quotes:['guy lost the plot','Lolz','Visit or peRish'],replies:['guy lost the plot','another meeting that could have been a visit to MTL','sounds like a change of scenery is required champion. whens dat visit?']},
 {id:'montreal',re:/\b(montreal|mtl|canada|quebec|city|restaurant|food|dinner)\b/i,quotes:['top tier MTL','we do it all','whens dat visit?'],replies:['top tier MTL','food. StReetz. culture. we do it all','cannot fully explain the vision remotely. whens dat visit?']},
 {id:'music',re:/\b(music|song|bar|jukebox|touchtunes|playlist|party)\b/i,quotes:['we do it all','StReetz','Lolz'],replies:['hand over the TouchTunes folkz','playlist privileges are earned champion','we do it all. especially the soundtrack']},
 {id:'dad',re:/\b(dad|father|parent|daughter|kid|family)\b/i,quotes:['international girl dad','we do it all'],replies:['international girl dad','international girl dad schedule. we do it all']},
 {id:'hello',re:/\b(hi|hello|hey|sup|yo)\b/i,quotes:['folkz','whens dat visit?'],replies:['folkz have arrived','champion. whens dat visit?']},
 {id:'no',re:/\b(no|never|cant|cannot|busy|not coming)\b|can't/i,quotes:['Visit or peRish','Lolz','guy lost the plot'],replies:['Lolz. noted and disputed','guy lost the plot','we will revisit this unfortunate position']},
 {id:'yes',re:/\b(yes|yeah|sure|okay|ok|agreed|deal|absolutely)\b/i,quotes:['champion','we do it all','#Ring'],replies:['champion','we do it all','excellent. converting this into actual plans immediately']},
 {id:'laugh',re:/\b(lol|haha|funny|lmao)\b/i,quotes:['Lolz','moost'],replies:['Lolz','folkz understand the vision']}
];
const fallback={id:'fallback',quotes:['Lolz','guy lost the plot','we do it all','whens dat visit?','moost'],replies:['bold statement folkz','will be discussing this in MTL. attendance encouraged','guy lost the plot','not sure what to do with this information champion','Lolz. elaborate']};
const counters={};let lastTopic=null;
const $=id=>document.getElementById(id);
function choose(message){let topic=topics.find(t=>t.re.test(message));if(!topic&&/^(why|what|how|when|really|tell me more)[?!. ]*$/i.test(message)&&lastTopic)topic=lastTopic;topic=topic||fallback;if(topic!==fallback)lastTopic=topic;const pool=topic.replies;const i=counters[topic.id]||0;counters[topic.id]=i+1;return pool[i%pool.length];}
function bubble(text,user){const row=document.createElement('div');row.className='row'+(user?' user':'');const sender=document.createElement('div');sender.className='sender';sender.textContent=user?'You':'Nick';const b=document.createElement('div');b.className='bubble';b.textContent=text;row.append(sender,b);$('messages').append(row);$('messages').scrollTop=$('messages').scrollHeight;}
function send(text){text=text.trim();if(!text)return;bubble(text,true);bubble(choose(text),false);$('input').value='';$('send').disabled=true;$('input').focus();}
function reset(){lastTopic=null;Object.keys(counters).forEach(k=>delete counters[k]);$('messages').replaceChildren();const day=document.createElement('div');day.className='day';day.textContent='New conversation';$('messages').append(day);bubble('whens dat visit?',false);$('input').value='';$('send').disabled=true;}
$('form').onsubmit=e=>{e.preventDefault();send($('input').value)};$('input').oninput=()=>{$('send').disabled=!$('input').value.trim()};$('reset').onclick=()=>{reset();$('input').focus()};reset();
