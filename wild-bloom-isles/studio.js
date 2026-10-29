'use strict';
const STYLES=[
{id:'sakura',name:'Sakura House',era:'Japanese inspired',wall:'#f4e7dc',floor:'#d9bd92',wood:'#976d54',fabric:'#d9a5b5',accent:'#829a7b',trim:'#f8edd4',story:'Quiet timber, blossom pink, paper lanterns. A gentle place to begin.'},
{id:'victorian',name:'Rose Manor',era:'Victorian inspired',wall:'#ccd1ba',floor:'#956e51',wood:'#604936',fabric:'#9b6079',accent:'#c5a465',trim:'#eee0b9',story:'Tufted upholstery, carved posts and deep rose. A little storybook grandeur.'},
{id:'deco',name:'Golden Hour',era:'1920s Art Deco',wall:'#426761',floor:'#c9b89c',wood:'#263e3b',fabric:'#4c8580',accent:'#d5ae58',trim:'#eedeb1',story:'Stepped silhouettes, jewel tones and brass details. Dress the room for a golden evening.'},
{id:'mid',name:'Sunday Modern',era:'1950s–60s',wall:'#e9ddc4',floor:'#bc956d',wood:'#875438',fabric:'#bd714e',accent:'#b6af65',trim:'#f5e6c5',story:'Long low furniture, warm walnut and optimistic color. Put a record on.'},
{id:'boho',name:'Sunwoven',era:'1970s bohemian',wall:'#ecd4b9',floor:'#c5a77e',wood:'#af7d4f',fabric:'#d49163',accent:'#7c956a',trim:'#f7e5c1',story:'Woven details, terracotta and leafy corners. A sunlit room with a collected soul.'},
{id:'nordic',name:'Cloud & Oak',era:'Contemporary Nordic',wall:'#e6ebe5',floor:'#d9cbb3',wood:'#b9a17c',fabric:'#c7d0ca',accent:'#859bad',trim:'#fff6e6',story:'Pale oak, soft cushions and thoughtful simplicity. Leave space to breathe.'}
];
const TYPES={sofa:{name:'Sofa',cat:'Seating',w:3,d:1.5},chair:{name:'Armchair',cat:'Seating',w:1.5,d:1.5},table:{name:'Coffee table',cat:'Tables',w:2,d:1.25},console:{name:'Sideboard',cat:'Storage',w:2.5,d:1},bed:{name:'Bed',cat:'Bedroom',w:2.5,d:3.5},rug:{name:'Woven rug',cat:'Decor',w:3.5,d:3},lamp:{name:'Floor lamp',cat:'Decor',w:.75,d:.75},plant:{name:'Leafy planter',cat:'Decor',w:.75,d:.75}};
const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=o=>JSON.parse(JSON.stringify(o)), key='wild-bloom-studio-v1';
let nextId=()=>globalThis.crypto?.randomUUID?.()||String(Date.now()+Math.random());
function makeItem(type,style,x,y){return {id:nextId(),type,style,x,y,rot:0};}
function fresh(name='Blossom sitting room',style='sakura'){return {id:nextId(),name,wall:style,floor:style,light:'day',items:[makeItem('rug',style,2,2.5),makeItem('sofa',style,2,.5),makeItem('table',style,2.5,3),makeItem('chair',style,.25,3),makeItem('console',style,5,.25),makeItem('plant',style,6.75,1.5),makeItem('lamp',style,5.75,2.25)]};}
let state={rooms:[fresh()],active:0};try{let s=JSON.parse(localStorage.getItem(key));if(s&&validState(s))state=s;}catch{}
let ghost=null;
let style='sakura',category='All',selected=null,pending=null,grid=false,undo=[],redo=[],drag=null;
const room=()=>state.rooms[state.active], palette=id=>STYLES.find(s=>s.id===id)||STYLES[0];
function validState(s){return s&&Array.isArray(s.rooms)&&s.rooms.length>0&&s.rooms.length<=30&&Number.isInteger(s.active)&&s.active>=0&&s.active<s.rooms.length&&s.rooms.every(r=>typeof r.name==='string'&&r.name.length<=80&&STYLES.some(p=>p.id===r.wall)&&STYLES.some(p=>p.id===r.floor)&&['day','golden','night'].includes(r.light)&&Array.isArray(r.items)&&r.items.length<=200&&r.items.every(i=>Object.hasOwn(TYPES,i.type)&&STYLES.some(p=>p.id===i.style)&&Number.isFinite(i.x)&&Number.isFinite(i.y)&&i.x>=0&&i.y>=0&&i.x<=8&&i.y<=8&&[0,1].includes(i.rot)&&typeof i.id==='string'&&(!i.fabric||/^#[0-9a-fA-F]{6}$/.test(i.fabric))&&i.x+dims(i)[0]<=8&&i.y+dims(i)[1]<=8));}
function save(){try{localStorage.setItem(key,JSON.stringify(state));$('saved').textContent='Saved on this device';}catch{$('saved').textContent='Storage full. Export your design.';}}
function checkpoint(){undo.push(JSON.stringify(state));if(undo.length>60)undo.shift();redo=[];}
function change(fn){checkpoint();fn();save();render();}
function history(from,to){if(!from.length)return;to.push(JSON.stringify(state));state=JSON.parse(from.pop());selected=null;pending=null;save();render();}
function dims(i){let t=TYPES[i.type];return i.rot?[t.d,t.w]:[t.w,t.d];}
function fits(i,items=room().items){let [w,d]=dims(i);if(i.x<0||i.y<0||i.x+w>8||i.y+d>8)return false;return i.type==='rug'||!items.some(j=>{if(j.id===i.id||j.type==='rug')return false;let [a,b]=dims(j);return i.x<j.x+a-.04&&i.x+w>j.x+.04&&i.y<j.y+b-.04&&i.y+d>j.y+.04;});}
function P(x,y,z=0){return [500+(x-y)*42,220+(x+y)*22-z];}
function poly(points,fill,stroke='#6e665338',extra=''){return `<polygon points="${points.map(p=>p.join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" ${extra.includes("stroke-width")?"":"stroke-width=\"1\""} stroke-linejoin="round" ${extra}/>`;}
function line(a,b,color,width=1){return `<path d="M${a.join(',')}L${b.join(',')}" fill="none" stroke="${color}" stroke-width="${width}"/>`;}
function tint(c,n){return '#'+c.slice(1).match(/../g).map(h=>Math.max(0,Math.min(255,parseInt(h,16)+n)).toString(16).padStart(2,'0')).join('');}
function rounded(points,fill,stroke='#6e665350',radius=6){
 const near=(a,b)=>{let d=Math.hypot(b[0]-a[0],b[1]-a[1]),t=Math.min(.35,radius/(d||1));return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];};
 let path='';for(let j=0;j<points.length;j++){let v=points[j],a=near(v,points[(j+points.length-1)%points.length]),b=near(v,points[(j+1)%points.length]);path+=(j?'L':'M')+a+'Q'+v+' '+b;}return `<path d="${path}Z" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
}
function blossom(p,r,color){let out='';for(let a=0;a<5;a++){let angle=a*Math.PI*2/5, x=p[0]+Math.cos(angle)*r*.6,y=p[1]+Math.sin(angle)*r*.6;out+=`<ellipse cx="${x}" cy="${y}" rx="${r*.63}" ry="${r*.4}" transform="rotate(${a*72} ${x} ${y})" fill="${color}"/>`;}return out+`<circle cx="${p[0]}" cy="${p[1]}" r="${r*.18}" fill="#ddbd78"/>`;}
function furniture(i,selection=false){let s={...palette(i.style),...(i.fabric?{fabric:i.fabric}:{})},t=TYPES[i.type],out='',w=t.w,d=t.d;
const point=(x,y,z=0)=>i.rot?P(i.x+y,i.y+w-x,z):P(i.x+x,i.y+y,z);
const box=(x,y,a,b,z,h,c)=>{out+=poly([point(x+a,y,z),point(x+a,y+b,z),point(x+a,y+b,z+h),point(x+a,y,z+h)],tint(c,-24));out+=poly([point(x,y+b,z),point(x+a,y+b,z),point(x+a,y+b,z+h),point(x,y+b,z+h)],tint(c,-10));out+=poly([point(x,y,z+h),point(x+a,y,z+h),point(x+a,y+b,z+h),point(x,y+b,z+h)],tint(c,14));};
const soft=(x,y,a,b,z,h,c,rad=6)=>{
 out+=rounded([point(x+a,y,z),point(x+a,y+b,z),point(x+a,y+b,z+h),point(x+a,y,z+h)],tint(c,-22),tint(c,-30),rad);
 out+=rounded([point(x,y+b,z),point(x+a,y+b,z),point(x+a,y+b,z+h),point(x,y+b,z+h)],tint(c,-8),tint(c,-28),rad);
 out+=rounded([point(x,y,z+h),point(x+a,y,z+h),point(x+a,y+b,z+h),point(x,y+b,z+h)],tint(c,14),tint(c,-10),rad);
};
const pillow=(x,y,z,c)=>{let p1=point(x,y,z),p2=point(x+.5,y,z+2),p3=point(x+.55,y,z+24),p4=point(x-.04,y,z+23);out+=rounded([p1,p2,p3,p4],c,tint(c,-25),8);out+=line(point(x+.07,y+.01,z+5),point(x+.43,y+.01,z+7),tint(c,24),1);};
const dot=(x,y,z,r,c)=>{let p=point(x,y,z);out+=`<circle cx="${p[0]}" cy="${p[1]}" r="${r}" fill="${c}" stroke="#66564244"/>`;};
const leg=(x,y,h=16)=>box(x,y,.12,.12,0,h,s.wood);
let [a,b]=dims(i);out+=poly([P(i.x+.1,i.y+.1),P(i.x+a+.15,i.y+.1),P(i.x+a+.15,i.y+b+.15),P(i.x+.1,i.y+b+.15)],'#44443813','none');
if(i.type==='rug'){box(0,0,w,d,0,2,s.fabric);out+=poly([point(.15,.15,3),point(w-.15,.15,3),point(w-.15,d-.15,3),point(.15,d-.15,3)],'none',s.trim,'stroke-width="3"');for(let k=.3;k<w;k+=.3){out+=line(point(k,0,3),point(k,-.12,3),s.trim,2);out+=line(point(k,d,3),point(k,d+.12,3),s.trim,2);}for(let k=.6;k<w;k+=.65){out+=poly([point(k,1,3),point(k+.25,1.5,3),point(k,2,3),point(k-.25,1.5,3)],s.accent);}}
if(i.type==='sofa'||i.type==='chair'){
 let low=s.id==='sakura',h=low?10:19,bh=s.id==='victorian'?55:s.id==='deco'?48:40;
 leg(.15,.15,h);leg(w-.25,.15,h);leg(.15,d-.25,h);leg(w-.25,d-.25,h);soft(0,0,w,d,h,11,s.wood,3);
 soft(.06,0,w-.12,.32,h+9,bh,s.fabric,12);
 if(s.id==='victorian'){
  for(let x=.35;x<w-.15;x+=.35)for(let z=h+25;z<h+bh;z+=13){out+=line(point(x-.17,.33,z-6),point(x+.17,.33,z+6),tint(s.fabric,-23),.8);out+=line(point(x+.17,.33,z-6),point(x-.17,.33,z+6),tint(s.fabric,-23),.8);dot(x,.34,z,1.7,s.accent);}
 }
 if(s.id==='deco')for(let x=.25;x<w-.1;x+=.25)out+=line(point(x,.33,h+19),point(x,.33,h+bh+3),s.accent,1.2);
 if(s.id==='boho')for(let x=.2;x<w;x+=.14)out+=line(point(x,.33,h+15),point(x,.33,h+bh),s.trim,.7);
 for(let x=.29;x<w-.29;x+=.81)soft(x,.35,Math.min(.77,w-.29-x),d-.42,h+12,14,s.fabric,7);
 pillow(.4,.48,h+24,s.accent);if(w>2)pillow(w-.95,.46,h+25,s.trim);
 soft(0,.12,.25,d-.12,h+9,s.id==='victorian'?34:27,s.fabric,9);soft(w-.25,.12,.25,d-.12,h+9,s.id==='victorian'?34:27,s.fabric,9);
 if(s.id==='sakura'||s.id==='mid')for(let y=.2;y<d;y+=.22){out+=line(point(w,.0+y,h+12),point(w,.0+y,h+31),s.wood,2);}
}
if(i.type==='table'){let h=s.id==='sakura'?18:30;leg(.15,.15,h);leg(w-.25,.15,h);leg(.15,d-.25,h);leg(w-.25,d-.25,h);soft(0,0,w,d,h,6,i.fabric||(s.id==='deco'?s.trim:s.wood),s.id==='mid'||s.id==='nordic'?22:7);box(.35,.3,.55,.5,h+6,4,s.accent);box(.4,.32,.55,.5,h+10,3,s.trim);dot(1.45,.65,h+10,7,s.fabric);dot(1.45,.65,h+13,5,s.trim);}
if(i.type==='console'){let h=s.id==='mid'?42:60;leg(.1,.1,14);leg(w-.2,.1,14);leg(.1,d-.2,14);leg(w-.2,d-.2,14);box(0,0,w,d,14,h,s.wood);box(-.05,-.03,w+.1,d+.06,h+14,4,s.id==='deco'?s.trim:s.wood);for(let x=.1;x<w-.1;x+=.8){box(x,d-.025,.7,.04,20,h-10,i.fabric||(s.id==='boho'?s.trim:s.wood));dot(x+.35,d+.035,h/2+15,2,s.accent);}box(.3,.2,.6,.4,h+18,5,s.fabric);box(.35,.2,.6,.4,h+23,4,s.trim);dot(1.9,.5,h+30,9,s.accent);}
if(i.type==='bed'){leg(.1,.1);leg(w-.2,.1);leg(.1,d-.2);leg(w-.2,d-.2);box(0,0,w,d,14,12,s.wood);box(0,0,w,.2,22,65,s.wood);soft(.1,.25,w-.2,d-.35,26,14,s.trim,8);soft(.1,1,w-.2,d-1.1,40,6,s.fabric,6);soft(.25,.4,.85,.6,40,9,s.trim,9);soft(1.4,.4,.85,.6,40,9,s.trim,9);box(.1,d-.7,w-.2,.45,46,2,s.accent);if(s.id==='victorian'){for(let x of [0,w-.12])for(let y of [0,d-.12]){box(x,y,.12,.12,0,140,s.wood);dot(x+.06,y+.06,143,4,s.accent);}box(0,0,w,.15,138,5,s.wood);box(0,0,.15,d,138,5,s.wood);box(w-.15,0,.15,d,138,5,s.wood);}}
if(i.type==='lamp'){
 let p=point(.375,.375,0);out+=`<ellipse cx="${p[0]}" cy="${p[1]}" rx="16" ry="7" fill="${s.wood}"/>`;
 out+=line(point(.375,.375,3),point(.375,.375,93),s.accent,3);
 let c=point(.375,.375,88);
 if(s.id==='sakura'||s.id==='boho'){
 out+=`<ellipse cx="${c[0]}" cy="${c[1]}" rx="21" ry="27" fill="${(i.fabric||s.trim)}" stroke="${s.wood}" stroke-width="1.2"/>`;
 for(let y=-18;y<=18;y+=6){let rx=21*Math.sqrt(1-y*y/729);out+=`<path d="M${c[0]-rx},${c[1]+y}q${rx},6 ${rx*2},0" fill="none" stroke="${s.wood}" stroke-opacity=".4" stroke-width=".8"/>`;}
 }else{
 out+=rounded([[c[0]-14,c[1]-22],[c[0]+14,c[1]-22],[c[0]+24,c[1]+13],[c[0]-24,c[1]+13]],(i.fabric||s.trim),s.wood,3);
 out+=`<ellipse cx="${c[0]}" cy="${c[1]+13}" rx="24" ry="5" fill="${tint((i.fabric||s.trim),-18)}"/>`;
 if(s.id==='deco')for(let k=-12;k<=12;k+=6)out+=line([c[0]+k,c[1]-19],[c[0]+k*1.5,c[1]+11],s.accent,1);
 }
}
if(i.type==='plant'){
 let p=point(.38,.38,0);out+=`<path d="M${p[0]-15},${p[1]-24}q15,-7 30,0l-4,22q-11,8 -22,0Z" fill="${s.fabric}" stroke="${tint(s.fabric,-28)}"/><ellipse cx="${p[0]}" cy="${p[1]-24}" rx="15" ry="5" fill="${s.wood}"/>`;
 out+=line(point(.38,.38,20),point(.38,.38,88),s.wood,2);
 for(let k=0;k<9;k++){let p=point(.38,.38,31+k*6),side=k%2?1:-1,dy=k%3*4;out+=`<path d="M${p}q${side*11},-${22+dy} ${side*31},-${17+dy}q${side*4},22 ${-side*31},${17+dy}" fill="${k%2?s.accent:tint(s.accent,16)}" stroke="#627c5966"/>`;out+=line(p,[p[0]+side*23,p[1]-12-dy],tint(s.accent,-20),.7);}
}
if(selection){out+=poly([P(i.x,i.y,3),P(i.x+a,i.y,3),P(i.x+a,i.y+b,3),P(i.x,i.y+b,3)],'none','#b3668a','stroke-width="3" stroke-dasharray="5 3"');}
return out;}
function roomArt(){let r=room(),s=palette(r.wall),f=palette(r.floor),out='';out+=poly([P(0,0),P(8,0),P(8,8),P(0,8)],f.floor);out+=poly([P(0,8),P(8,8),P(8,8,-16),P(0,8,-16)],tint(f.wood,5));out+=poly([P(8,0),P(8,8),P(8,8,-16),P(8,0,-16)],f.wood);
out+=poly([P(0,0),P(0,8),P(0,8,190),P(0,0,190)],tint(s.wall,-8));out+=poly([P(0,0),P(8,0),P(8,0,190),P(0,0,190)],s.wall);
for(let k=0;k<=8;k+=.5)out+=line(P(k,0),P(k,8),tint(f.floor,-24),.7);for(let x=0;x<8;x+=.5)for(let y=(x%1)*2;y<8;y+=2)out+=line(P(x,y),P(x+.5,y),tint(f.floor,-18),.6);
if(f.id==='deco')for(let x=0;x<8;x++)for(let y=0;y<8;y++)out+=poly([P(x,y,1),P(x+1,y,1),P(x+1,y+1,1),P(x,y+1,1)],(x+y)%2?f.wood:f.trim,'#8c897655');
if(f.id==='sakura')for(let x=0;x<8;x+=2)for(let y=0;y<8;y+=4){out+=poly([P(x+.04,y+.04,1),P(x+1.96,y+.04,1),P(x+1.96,y+3.96,1),P(x+.04,y+3.96,1)],'#d5c49c',f.wood);for(let z=.15;z<2;z+=.14)out+=line(P(x+z,y+.1,2),P(x+z,y+3.9,2),'#9b9c7440',.5);}
if(s.id==='deco')for(let x=.5;x<8;x+=.7){out+=poly([P(x-.28,0,100),P(x,0,156),P(x+.28,0,100)],'none',s.accent);}
if(s.id==='victorian')for(let x=.3;x<8;x+=.65)for(let z=95;z<175;z+=22){out+=poly([P(x,0,z-7),P(x+.1,0,z),P(x,0,z+7),P(x-.1,0,z)],s.trim,'none');}
for(let k=0;k<8;k+=1){out+=poly([P(k+.1,0,18),P(k+.9,0,18),P(k+.9,0,65),P(k+.1,0,65)],'none',s.trim);out+=poly([P(0,k+.1,18),P(0,k+.9,18),P(0,k+.9,65),P(0,k+.1,65)],'none',s.trim);}
for(let z of [8,72,180,190]){out+=line(P(0,8,z),P(0,0,z),s.trim,z===8?8:4);out+=line(P(0,0,z),P(8,0,z),s.trim,z===8?8:4);}
// A drawn window with blossom branches, fitted to the wall plane.
out+=poly([P(0,1.4,85),P(0,4.5,85),P(0,4.5,165),P(0,1.4,165)],r.light==='night'?'#7483a4':'#d4e6d9',s.wood,'stroke-width="5"');out+=line(P(0,1.6,87),P(0,4.1,154),'#977764',3);for(let k=0;k<15;k++){let p=P(0,1.6+(k*.19)%2.7,100+(k*19)%60);out+=blossom(p,7+k%4,k%2?'#e9b8c5':'#f7d8dd');}
for(let y of [2.4,3.5])out+=line(P(0,y,85),P(0,y,165),s.wood,3);out+=line(P(0,1.4,125),P(0,4.5,125),s.wood,3);
// Framed geometric art on the opposite wall.
out+=poly([P(4.5,0,100),P(6.5,0,100),P(6.5,0,155),P(4.5,0,155)],s.trim,s.wood,'stroke-width="4"');out+=poly([P(4.7,0,105),P(6.3,0,105),P(5.5,0,145)],s.fabric);out+=poly([P(5.6,0,105),P(6.3,0,105),P(6,0,132)],s.accent);
if(r.light!=='night')out+=poly([P(.1,1.5,3),P(.1,4.4,3),P(4.8,6.2,3),P(4.8,3.3,3)],r.light==='golden'?'#ffe5a745':'#fffbe62d','none');
if(grid)for(let k=0;k<=8;k+=.5){out+=line(P(k,0,2),P(k,8,2),'#fff8');out+=line(P(0,k,2),P(8,k,2),'#fff8');}
let list=[...r.items].sort((a,b)=>(a.type==='rug'?-100: a.x+a.y+dims(a)[0]+dims(a)[1])-(b.type==='rug'?-100:b.x+b.y+dims(b)[0]+dims(b)[1]));
for(let i of list)out+=`<g data-item="${esc(i.id)}" tabindex="0" role="button" aria-label="${palette(i.style).name} ${TYPES[i.type].name}">${furniture(i,i.id===selected)}</g>`;
return `<g ${r.light==='golden'?'style="filter:sepia(.22) saturate(1.1)"':r.light==='night'?'style="filter:brightness(.75) saturate(.75)"':''}>${out}</g>`;}
function renderScene(){
 let art=roomArt();if(pending&&ghost){let i={...pending,id:'preview',x:ghost.x,y:ghost.y,rot:pending.rot||0},[w,d]=dims(i),ok=fits(i);art+=`<g pointer-events="none" opacity=".66">${furniture(i)}${poly([P(i.x,i.y,4),P(i.x+w,i.y,4),P(i.x+w,i.y+d,4),P(i.x,i.y+d,4)],ok?'#79ab8733':'#d5777733',ok?'#477b58':'#b54444','stroke-width="3"')}</g>`;}$('scene').innerHTML=art;
}
function render(){let r=room();$('rooms').innerHTML=state.rooms.map((r,i)=>`<option value="${i}">${esc(r.name)}</option>`).join('');$('rooms').value=state.active;$('room-title').textContent=r.name;$('styles').innerHTML=STYLES.map(s=>`<button class="style ${s.id===style?'active':''}" data-style="${s.id}" aria-pressed="${s.id===style}"><span class="swatches">${[s.fabric,s.wood,s.accent].map(c=>`<i style="background:${c}"></i>`).join('')}</span>${s.name}<small>${s.era}</small></button>`).join('');$('story').textContent=palette(style).story;for(let field of ['wall','floor']){$(field).innerHTML=STYLES.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');$(field).value=r[field];}$('light').value=r.light;$('undo').disabled=!undo.length;$('redo').disabled=!redo.length;$('grid').setAttribute('aria-pressed',grid);$('collection-title').textContent=palette(style).name;$('categories').innerHTML=['All',...new Set(Object.values(TYPES).map(t=>t.cat))].map(c=>`<button data-cat="${c}" class="${c===category?'active':''}">${c}</button>`).join('');$('pieces').innerHTML=Object.entries(TYPES).filter(([k,t])=>category==='All'||t.cat===category).map(([type,t])=>`<button class="piece ${pending?.type===type?'pending':''}" data-type="${type}"><svg viewBox="330 50 340 330" aria-hidden="true">${furniture({type,style,x:0,y:0,rot:0})}</svg><strong>${t.name}</strong><small>${palette(style).name} · Place ＋</small></button>`).join('');renderScene();renderSelection();}
function renderSelection(){let i=room().items.find(i=>i.id===selected);$('selection').innerHTML=i?`<strong>${palette(i.style).name} ${TYPES[i.type].name}</strong><button data-action="rotate">↻ Rotate</button><button data-action="duplicate">Duplicate</button><button data-action="remove">Remove</button><button data-action="done">Done</button><div class="fabric-options" role="group" aria-label="Piece color"><span>Color</span>${['#d9a5b5','#9b6079','#4c8580','#bd714e','#b6af65','#c7d0ca'].map(c=>`<button data-fabric="${c}" aria-label="${({'#d9a5b5':'Blossom','#9b6079':'Plum','#4c8580':'Jade','#bd714e':'Terracotta','#b6af65':'Olive','#c7d0ca':'Cloud'})[c]} color" aria-pressed="${(i.fabric||palette(i.style).fabric)===c}" style="background:${c}"></button>`).join('')}<button data-action="original">Reset color</button></div>`:pending?'<strong>Preview on the floor, then tap to place.</strong><button data-action="rotate">↻ Rotate</button><button data-action="cancel">Cancel</button>':'Choose a piece to move, rotate or duplicate it.';}
function hint(s){$('hint').textContent=s;}
function floorPoint(e){let p=$('scene').createSVGPoint();p.x=e.clientX;p.y=e.clientY;p=p.matrixTransform($('scene').getScreenCTM().inverse());let a=(p.x-500)/42,b=(p.y-220)/22;return {x:(a+b)/2,y:(b-a)/2};}
const snap=n=>Math.round(n*4)/4;
$('scene').addEventListener('pointerdown',e=>{let id=e.target.closest('[data-item]')?.dataset.item;if(pending){if(room().items.length>=200){hint('This room has 200 pieces. Start a new room to keep designing.');return;}let p=floorPoint(e),i=makeItem(pending.type,pending.style,snap(p.x),snap(p.y));i.rot=pending.rot||0;if(pending.fabric)i.fabric=pending.fabric;if(!fits(i)){hint('That spot is occupied or outside the room. Try an open floor space.');return;}change(()=>{room().items.push(i);selected=i.id;pending=null;});hint('Placed. Drag to arrange, or rotate below.');return;}if(id){selected=id;let i=room().items.find(i=>i.id===id);drag={id,start:clone(i),p:floorPoint(e),before:JSON.stringify(state),moved:false};$('scene').setPointerCapture(e.pointerId);renderScene();renderSelection();}else{selected=null;renderScene();renderSelection();}});
$('scene').addEventListener('pointermove',e=>{if(pending){let p=floorPoint(e);ghost={x:snap(p.x),y:snap(p.y)};renderScene();return;}if(!drag)return;let p=floorPoint(e),i=room().items.find(i=>i.id===drag.id),candidate={...i,x:snap(drag.start.x+p.x-drag.p.x),y:snap(drag.start.y+p.y-drag.p.y)};if(fits(candidate)){i.x=candidate.x;i.y=candidate.y;drag.moved=true;renderScene();hint('Release to save this position.');}else hint('Keep this piece inside the room and clear of other furniture.');});
function finishDrag(cancel=false){if(!drag)return;if(cancel)state=JSON.parse(drag.before);else if(drag.moved&&JSON.stringify(state)!==drag.before){undo.push(drag.before);redo=[];save();}drag=null;render();hint('Select a piece below, then tap an open space in your room.');}
$('scene').addEventListener('pointerleave',()=>{if(pending){ghost=null;renderScene();}});
$('scene').addEventListener('pointerup',()=>finishDrag());$('scene').addEventListener('pointercancel',()=>finishDrag(true));
function act(action){let i=room().items.find(i=>i.id===selected);if(action==='cancel'||action==='done'){pending=null;ghost=null;selected=null;render();return;}if(action==='rotate'&&pending){pending.rot=1-(pending.rot||0);renderScene();return;}if(!i)return;if(action==='original')change(()=>delete i.fabric);if(action==='remove')change(()=>{room().items=room().items.filter(j=>j.id!==selected);selected=null;});if(action==='rotate'){let c={...i,rot:1-i.rot};if(fits(c))change(()=>i.rot=c.rot);else hint('Move this piece into a larger open space before rotating.');}if(action==='duplicate'){pending={type:i.type,style:i.style,rot:i.rot,...(i.fabric?{fabric:i.fabric}:{})};ghost=null;selected=null;render();hint('Tap an open floor space for the copy.');}}
$('selection').onclick=e=>{let color=e.target.closest('[data-fabric]')?.dataset.fabric;if(color){let i=room().items.find(i=>i.id===selected);if(i)change(()=>i.fabric=color);return;}let a=e.target.closest('[data-action]')?.dataset.action;if(a)act(a);};
$('styles').onclick=e=>{let s=e.target.closest('[data-style]')?.dataset.style;if(s){style=s;pending=null;render();}};
$('categories').onclick=e=>{let c=e.target.closest('[data-cat]')?.dataset.cat;if(c){category=c;render();}};
$('pieces').onclick=e=>{let type=e.target.closest('[data-type]')?.dataset.type;if(type){pending={type,style,rot:0};ghost=null;selected=null;render();hint('Tap an open floor space to place your '+TYPES[type].name.toLowerCase()+'.');$('scene').scrollIntoView({behavior:'smooth',block:'center'});}};
for(let f of ['wall','floor','light'])$(f).onchange=e=>change(()=>room()[f]=e.target.value);
$('rooms').onchange=e=>{state.active=Number(e.target.value);selected=null;pending=null;undo=[];redo=[];save();render();};
$('grid').onclick=()=>{grid=!grid;render();};$('undo').onclick=()=>history(undo,redo);$('redo').onclick=()=>history(redo,undo);
let naming='new';for(let a of ['new','rename'])$(a).onclick=()=>{naming=a;$('dialog-title').textContent=a==='new'?'A new room, a new possibility':'Name your room';$('room-name').value=a==='new'?'My '+palette(style).name:room().name;$('name-dialog').showModal();$('room-name').focus();};
$('name-dialog').addEventListener('close',()=>{if($('name-dialog').returnValue!=='save')return;let name=$('room-name').value.trim()||'My room';if(naming==='new'&&state.rooms.length>=30){hint('Your studio holds 30 rooms. Export your collection to keep a backup.');return;}change(()=>{if(naming==='new'){state.rooms.push({...fresh(name,style),items:[]});state.active=state.rooms.length-1;}else room().name=name;selected=null;pending=null;});});
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||$('name-dialog').open)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?history(redo,undo):history(undo,redo);return;}if(e.key==='Escape'){act('cancel');return;}if(e.key==='Enter'&&e.target.dataset.item){selected=e.target.dataset.item;renderSelection();renderScene();return;}if(e.key.toLowerCase()==='r'&&(selected||pending)){act('rotate');return;}if(!selected)return;if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();act('remove');}let moves={ArrowLeft:[-.25,0],ArrowRight:[.25,0],ArrowUp:[0,-.25],ArrowDown:[0,.25]};if(moves[e.key]){e.preventDefault();let i=room().items.find(i=>i.id===selected),[x,y]=moves[e.key],c={...i,x:i.x+x,y:i.y+y};if(fits(c))change(()=>Object.assign(i,c));}});
$('export').onclick=()=>{let url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='wild-bloom-rooms.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=async e=>{let file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw Error();let incoming=JSON.parse(await file.text());if(!validState(incoming)||state.rooms.length+incoming.rooms.length>30)throw Error();change(()=>{state.rooms.push(...incoming.rooms.map(r=>({...r,id:nextId(),items:r.items.map(i=>({...i,id:nextId()}))})));state.active=state.rooms.length-incoming.rooms.length;selected=null;});hint('Imported rooms added to your studio.');}catch{hint('Choose a Wild Bloom room export. Your studio can hold up to 30 rooms.');}e.target.value='';};
render();save();
