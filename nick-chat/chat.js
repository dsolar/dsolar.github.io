'use strict';
const $=id=>document.getElementById(id);
const engine=NickEngine.createEngine();
const storageKey='nick-examples-v1';
let examples=[];
try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))examples=saved.filter(valid).slice(0,500);}catch{}
function valid(e){return e&&typeof e.prompt==='string'&&typeof e.reply==='string'&&e.prompt.trim()&&e.reply.trim()&&e.prompt.length<=1200&&e.reply.length<=1200;}
function status(text){$('teach-status').textContent=text;}
function save(){try{localStorage.setItem(storageKey,JSON.stringify(examples));return true;}catch{status('Browser storage is unavailable. Export your examples to keep them.');return false;}}
function renderExamples(){const list=$('example-list');list.replaceChildren();$('example-count').textContent=examples.length+' saved';examples.forEach((e,i)=>{const row=document.createElement('div');row.className='example';const prompt=document.createElement('p');prompt.textContent='You: '+e.prompt;const reply=document.createElement('p');reply.textContent='Nick: '+e.reply;const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove example '+(i+1));remove.onclick=()=>{examples.splice(i,1);save();renderExamples()};row.append(prompt,reply,remove);list.append(row);});}
function bubble(text,user){const row=document.createElement('div');row.className='row'+(user?' user':'');const sender=document.createElement('div');sender.className='sender';sender.textContent=user?'You':'Nick';const b=document.createElement('div');b.className='bubble';b.textContent=text;row.append(sender,b);$('messages').append(row);$('messages').scrollTop=$('messages').scrollHeight;}
function send(text){text=text.trim();if(!text)return;bubble(text,true);bubble(engine.reply(text,examples),false);$('input').value='';$('send').disabled=true;$('input').focus();}
function reset(){engine.reset();$('messages').replaceChildren();const day=document.createElement('div');day.className='day';day.textContent='New conversation';$('messages').append(day);bubble('yo folkz',false);$('input').value='';$('send').disabled=true;}
$('form').onsubmit=e=>{e.preventDefault();send($('input').value)};
$('input').oninput=()=>{$('send').disabled=!$('input').value.trim()};
$('reset').onclick=()=>{reset();$('input').focus()};
$('teach-open').onclick=()=>{$('teach-dialog').showModal();$('example-prompt').focus()};
$('teach-close').onclick=()=>$('teach-dialog').close();
$('teach-form').onsubmit=e=>{e.preventDefault();const item={prompt:$('example-prompt').value.trim(),reply:$('example-reply').value.trim()};if(!valid(item))return;if(examples.length>=500){status('This browser has 500 examples. Export them before replacing any.');return;}if(examples.some(x=>x.prompt===item.prompt&&x.reply===item.reply)){status('That exchange is already saved.');return;}examples.push(item);const kept=save();renderExamples();if(kept)status('Saved. Try that message or a similar one in the chat.');$('teach-form').reset();$('example-prompt').focus();};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,examples},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='nick-examples.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw Error('Use a file smaller than 2 MB.');const data=JSON.parse(await file.text());const incoming=Array.isArray(data)?data:data.examples;if(!Array.isArray(incoming)||!incoming.every(valid))throw Error('Use an exported examples file with prompt and reply fields.');const additions=incoming.filter(x=>!examples.some(y=>x.prompt===y.prompt&&x.reply===y.reply));if(examples.length+additions.length>500)throw Error('Import would exceed 500 examples.');examples.push(...additions);const kept=save();renderExamples();if(kept)status('Imported '+additions.length+' examples.');}catch(err){status(err.message||'Could not read this file.');}finally{e.target.value='';}};
renderExamples();reset();
