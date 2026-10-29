'use strict';
// Wild Bloom Isles: the studio. State, saving, the three views (inside, whole house, outside) and every control.
const $=id=>document.getElementById(id),clone=o=>JSON.parse(JSON.stringify(o));
const KEY='wild-bloom-house-v2',OLD_KEY='wild-bloom-studio-v1',HEX=/^#[0-9a-fA-F]{6}$/,ART_RE=/^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const MAX_HOMES=10,MAX_ROOMS=16,MAX_ITEMS=200,MAX_YARD=300,MIN_SIZE=3,MAX_SIZE=12;
const uid=()=>globalThis.crypto?.randomUUID?.()||String(Date.now())+Math.random().toString(36).slice(2);
const VIEWS={room:'Inside',house:'Whole house',yard:'Outside',isle:'Island'};
const GUIDE_KEY='wild-bloom-guide-seen';

let lastTap={},selHome=null,state,style='sakura',category='room',selected=null,pending=null,ghost=null,grid=false,undo=[],redo=[],drag=null,frozen=null,flash=null,flashTimer=0,shelfKey='',idea='';

// ---------- making things ----------
function makeItem(type,st,x,y,rot=0){return {id:uid(),type,style:st,x,y,rot};}
function makeRoom(type,name,st,w,d,withPieces=true){let T=ROOM_TYPES[type];let r={id:uid(),name:name||T.name,type,w:w||T.w,d:d||T.d,px:0,py:0,wall:st,floor:st,light:'day',items:[]};
 if(withPieces)for(let [t,x,y,rot] of T.start){let i=makeItem(t,st,x,y,rot?1:0);if(fitsIn(i,r.items,{x0:0,y0:0,x1:r.w,y1:r.d},[]))r.items.push(i);}
 if(type==='living'&&!name)r.name='Blossom sitting room';return r;}
function freshHome(name='My house',st='sakura'){let r=makeRoom('living',st==='sakura'?'Blossom sitting room':'Living room',st);
 let h={id:uid(),name,rooms:[r],current:0,yard:{items:[]},ext:{siding:'#f3e6d4',roof:'#b8788b',door:'#4c8580',trim:'#fffaf0',grass:'#a9cf8e',yard:8,light:'day'}};
 for(let [t,x,y] of [['path',3.5,8.8],['path',3.5,10.1],['path',3.5,11.4],['flowerbed',5.2,8.4],['flowerbed',.8,8.4],['blossomtree',10,9.5],['tree',-4,2],['bush',9,3],['mailbox',5.2,12.3]]){let i=makeItem(t,st,x,y);if(fitsIn(i,h.yard.items,yardBounds(h),blocksOf(h)))h.yard.items.push(i);}
 return h;}
function uniqueName(base,taken){if(!taken.includes(base))return base;for(let k=2;;k++)if(!taken.includes(base+' '+k))return base+' '+k;}

// ---------- checking saved data ----------
const num=(n,lo,hi)=>Number.isFinite(n)&&n>=lo&&n<=hi;
function cleanItem(i,where){if(!i||!Object.hasOwn(TYPES,i.type))return null;let t=TYPES[i.type];if(where==='in'&&!['in','both'].includes(t.where))return null;if(where==='out'&&!['out','both'].includes(t.where))return null;if(where==='isle'&&t.where==='in')return null;
 if(!num(i.x,-200,200)||!num(i.y,-200,200))return null;let o={id:typeof i.id==='string'&&i.id.length<80?i.id:uid(),type:i.type,style:STYLES.some(s=>s.id===i.style)?i.style:'sakura',x:i.x,y:i.y,rot:i.rot?1:0};if(HEX.test(i.fabric||''))o.fabric=i.fabric;return o;}
function cleanRoom(r){if(!r||typeof r.name!=='string')return null;let o={id:typeof r.id==='string'?r.id:uid(),name:r.name.slice(0,40)||'Room',type:Object.hasOwn(ROOM_TYPES,r.type)?r.type:'living',
 w:Number.isInteger(r.w)&&num(r.w,MIN_SIZE,MAX_SIZE)?r.w:8,d:Number.isInteger(r.d)&&num(r.d,MIN_SIZE,MAX_SIZE)?r.d:8,px:Number.isInteger(r.px)&&num(r.px,0,200)?r.px:0,py:Number.isInteger(r.py)&&num(r.py,0,200)?r.py:0,
 wall:STYLES.some(s=>s.id===r.wall)?r.wall:'sakura',floor:STYLES.some(s=>s.id===r.floor)?r.floor:'sakura',light:['day','golden','night'].includes(r.light)?r.light:'day',items:[]};
 for(let k of ['wallPaint','floorPaint','paperInk','artBg'])if(HEX.test(r[k]||''))o[k]=r[k];
 if(WALLPAPERS.some(p=>p[0]===r.paper))o.paper=r.paper;if(FLOORS.some(p=>p[0]===r.floorPattern))o.floorPattern=r.floorPattern;
 if(typeof r.art==='string'&&r.art.length<700000&&ART_RE.test(r.art))o.art=r.art;
 for(let i of (Array.isArray(r.items)?r.items:[]).slice(0,MAX_ITEMS)){let c=cleanItem(i,'in');if(c&&fitsIn(c,o.items,{x0:0,y0:0,x1:o.w,y1:o.d},[]))o.items.push(c);}
 return o;}
function cleanHome(h){if(!h||!Array.isArray(h.rooms))return null;let rooms=[];for(let r of h.rooms.slice(0,MAX_ROOMS)){let c=cleanRoom(r);if(c&&!rooms.some(q=>overlap(c.px,c.py,c.w,c.d,q.px,q.py,q.w,q.d)))rooms.push(c);}if(!rooms.length)return null;
 let e=h.ext||{},o={id:typeof h.id==='string'?h.id:uid(),name:typeof h.name==='string'&&h.name.trim()?h.name.slice(0,40):'My house',rooms,current:Number.isInteger(h.current)&&h.current>=0&&h.current<rooms.length?h.current:0,yard:{items:[]},
 ext:{siding:HEX.test(e.siding||'')?e.siding:'#f3e6d4',roof:HEX.test(e.roof||'')?e.roof:'#b8788b',door:HEX.test(e.door||'')?e.door:'#4c8580',trim:HEX.test(e.trim||'')?e.trim:'#fffaf0',grass:HEX.test(e.grass||'')?e.grass:'#a9cf8e',yard:[5,8,11].includes(e.yard)?e.yard:8,light:['day','golden','night'].includes(e.light)?e.light:'day'}};
 for(let i of (Array.isArray(h.yard?.items)?h.yard.items:[]).slice(0,MAX_YARD)){let c=cleanItem(i,'out');if(c)o.yard.items.push(c);}
 if(Number.isInteger(h.at?.x)&&Number.isInteger(h.at?.y)&&num(h.at.x,-500,500)&&num(h.at.y,-500,500))o.at={x:h.at.x,y:h.at.y};
 return o;}
function cleanState(s){if(!s||!Array.isArray(s.homes))return null;let homes=s.homes.slice(0,MAX_HOMES).map(cleanHome).filter(Boolean);if(!homes.length)return null;
 return finalize({v:2,homes,active:Number.isInteger(s.active)&&s.active>=0&&s.active<homes.length?s.active:0,view:Object.hasOwn(VIEWS,s.view)?s.view:'room',isle:s.isle});}
function cleanIsle(i){i=i||{};let o={name:typeof i.name==='string'&&i.name.trim()?i.name.slice(0,40):'Wild Bloom Isle',items:[],size:[3,6,10].includes(i.size)?i.size:6,light:['day','golden','night'].includes(i.light)?i.light:'day'};
 for(let it of (Array.isArray(i.items)?i.items:[]).slice(0,MAX_YARD)){let c=cleanItem(it,'isle');if(c)o.items.push(c);}return o;}
function finalize(s){s.isle=cleanIsle(s.isle);layoutHomes(s);return s;}
// Give every home its own lot on the island, keeping spots that already work and finding new ones next to the neighbors.
const lotsTouch=(a,b,gap=1)=>a.x0<b.x1+gap&&a.x1+gap>b.x0&&a.y0<b.y1+gap&&a.y1+gap>b.y0;
function lotAt(h,at){let b=yardBounds(h);return {x0:at.x+b.x0,y0:at.y+b.y0,x1:at.x+b.x1,y1:at.y+b.y1};}
function layoutHomes(st){let placed=[];for(let h of st.homes){if(h.at&&!placed.some(q=>lotsTouch(lotRect(h),lotRect(q))));else h.at=findLot(h,placed);placed.push(h);}}
function findLot(h,placed){let b=yardBounds(h);if(!placed.length)return {x:-b.x0,y:-b.y0};let L=placed.map(lotRect),U={x0:Math.min(...L.map(l=>l.x0)),y0:Math.min(...L.map(l=>l.y0)),x1:Math.max(...L.map(l=>l.x1)),y1:Math.max(...L.map(l=>l.y1))},W=b.x1-b.x0,D=b.y1-b.y0,best=null;
 for(let x0=Math.floor(U.x0-W-3);x0<=U.x1+3;x0++)for(let y0=Math.floor(U.y0-D-3);y0<=U.y1+3;y0++){let r={x0,y0,x1:x0+W,y1:y0+D};if(L.some(l=>lotsTouch(r,l,1.5)))continue;let bw=Math.max(U.x1,r.x1)-Math.min(U.x0,r.x0),bh=Math.max(U.y1,r.y1)-Math.min(U.y0,r.y0),score=Math.max(bw,bh)**2+bw*bh*.2+Math.abs(x0-U.x0)*.01+Math.abs(y0-U.y0)*.02;if(!best||score<best.score)best={score,x:x0-b.x0,y:y0-b.y0};}
 return best?{x:Math.round(best.x),y:Math.round(best.y)}:{x:Math.round(U.x1+2-b.x0),y:Math.round(U.y0-b.y0)};}
// Rooms saved before houses existed become the first house (or houses), side by side.
function migrateV1(old){if(!old||!Array.isArray(old.rooms)||!old.rooms.length)return null;let homes=[];
 for(let k=0;k<old.rooms.length;k+=MAX_ROOMS){let rooms=old.rooms.slice(k,k+MAX_ROOMS).map((r,j)=>({...r,type:(r.items||[]).some(i=>i.type==='bed')?'bedroom':'living',w:8,d:8,px:(j%3)*8,py:Math.floor(j/3)*8}));
  let h=cleanHome({name:homes.length?'My house '+(homes.length+1):'My house',rooms});if(!h)continue;let starter=freshHome('x');h.yard=starter.yard;h.yard.items=h.yard.items.filter(i=>fitsIn(i,[],yardBounds(h),blocksOf(h)));
  if(homes.length===0&&Number.isInteger(old.active)&&old.active<MAX_ROOMS&&old.active<h.rooms.length)h.current=old.active;homes.push(h);}
 return homes.length?finalize({v:2,homes,active:0,view:'room'}):null;}
function load(){try{let s=cleanState(JSON.parse(localStorage.getItem(KEY)));if(s)return s;}catch{}try{let s=migrateV1(JSON.parse(localStorage.getItem(OLD_KEY)));if(s)return s;}catch{}return finalize({v:2,homes:[freshHome()],active:0,view:'room'});}

// ---------- where things can go ----------
function overlap(ax,ay,aw,ad,bx,by,bw,bd,e=.04){return ax<bx+bw-e&&ax+aw>bx+e&&ay<by+bd-e&&ay+ad>by+e;}
function blocksOf(h){return h.rooms.map(r=>({x:r.px,y:r.py,w:r.w,d:r.d}));}
function fitsIn(i,items,b,blocks){let [w,d]=dims(i);if(i.x<b.x0-1e-9||i.y<b.y0-1e-9||i.x+w>b.x1+1e-9||i.y+d>b.y1+1e-9)return false;
 if(blocks.some(k=>overlap(i.x,i.y,w,d,k.x,k.y,k.w,k.d)))return false;if(TYPES[i.type].flat)return true;
 return !items.some(j=>{if(j.id===i.id||TYPES[j.type].flat)return false;let [a,c]=dims(j);return overlap(i.x,i.y,w,d,j.x,j.y,a,c);});}
const home=()=>state.homes[state.active],room=()=>home().rooms[home().current],view=()=>state.view;
function space(){let h=home();if(view()==='isle'){let sh=isleShape(state),g=guideSpot(sh);return {items:state.isle.items,b:{x0:sh.cx-sh.sx,y0:sh.cy-sh.sy,x1:sh.cx+sh.sx,y1:sh.cy+sh.sy},blocks:[...state.homes.map(q=>{let l=lotRect(q);return {x:l.x0,y:l.y0,w:l.x1-l.x0,d:l.y1-l.y0};}),{x:g.x,y:g.y,w:1.5,d:.8}],max:MAX_YARD,inside:i=>{let [w,d]=dims(i);return [[i.x,i.y],[i.x+w,i.y],[i.x,i.y+d],[i.x+w,i.y+d]].every(([x,y])=>onIsle(sh,x,y));}};}
 if(view()==='yard'){let b=frozen?.yard||yardPlaceBounds(h);return {items:h.yard.items,b,blocks:blocksOf(h),max:MAX_YARD};}let r=room();return {items:r.items,b:{x0:0,y0:0,x1:r.w,y1:r.d},blocks:[],max:MAX_ITEMS};}
// You can place things a little past the current edge of the yard; the yard grows to hold them.
function yardPlaceBounds(h){let b=houseBounds(h),m=(h.ext.yard||8)+2;return {x0:b.x0-m,y0:b.y0-m,x1:b.x1+m,y1:b.y1+m};}
const fits=(i,sp=space())=>fitsIn(i,sp.items,sp.b,sp.blocks)&&(!sp.inside||sp.inside(i));
function roomFree(h,k,px,py,w,d){return px>=0&&py>=0&&!h.rooms.some((q,j)=>j!==k&&overlap(px,py,w,d,q.px,q.py,q.w,q.d,0));}
// Keep the floor plan anchored at the top corner, moving the yard with it.
function normalize(h){let b=houseBounds(h),dx=-b.x0,dy=-b.y0;if(!dx&&!dy)return;for(let r of h.rooms){r.px+=dx;r.py+=dy;}for(let i of h.yard.items){i.x+=dx;i.y+=dy;}}

// ---------- saving and undo ----------
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));$('saved').textContent='Saved on this device';}catch{$('saved').textContent='Storage is full. Export your design to keep it.';}}
function checkpoint(){undo.push(JSON.stringify(state));if(undo.length>40)undo.shift();redo=[];}
function change(fn){checkpoint();fn();save();render();}
function history(from,to){if(!from.length)return;to.push(JSON.stringify(state));state=JSON.parse(from.pop());selected=null;pending=null;save();render();}

// ---------- hints ----------
function hint(msg,ms=3200){flash=msg;$('hint').textContent=msg;$('hint').classList.toggle('talk',/^🐮|^🐱/.test(msg));clearTimeout(flashTimer);flashTimer=setTimeout(()=>{flash=null;refreshHint();},ms);}
function baseHint(){let v=view();if(pending?.room)return `Tap an open spot on the plan to add your ${ROOM_TYPES[pending.type].name.toLowerCase()}.`;
 if(pending)return `Tap an open spot to place your ${TYPES[pending.type].name.toLowerCase()}.`;
 if(v==='isle'&&!pending){if(selHome!=null)return 'Drag the home to move it around the island. Double-tap to visit.';if(!selected)return 'Drag a home to arrange the village, or add village pieces from the shelf.';}
 if(v==='house')return selected!=null?'Drag the room to move it. Double-tap to go inside.':'Tap a room to move or resize it. Add rooms from the shelf.';
 if(selected)return 'Drag it anywhere. Spin, copy or recolor it below.';
 return v==='yard'?'Pick something from the shelf, then tap the yard to place it.':'Pick a piece from the shelf, then tap the floor to place it.';}
function refreshHint(){if(flash)return;$('hint').textContent=baseHint();$('hint').classList.remove('talk');}
function cowLine(i){let r=view()==='room'?room():null,pool=[...COW_LINES];
 if(i.type==='cat')return '🐱 '+CAT_LINES[Math.floor(Math.random()*CAT_LINES.length)];
if(view()==='isle')pool.push('Welcome to the island! I know every grain of sand here.','Did you know the lighthouse helps boats find our island?','I love living next to all your houses.');
 if(view()==='yard')pool.push('Moo! Grass for days. This is the best yard ever.','Can we get a pond? I would like to look at my reflection.','I could stand in this yard all day. I mean, I do.');
 if(r){let byType={kitchen:'Is there a snack in that fridge?',bathroom:'A cow in the bathroom? Moo-ve over, I want a bubble bath.',beauty:'Can I get my hooves painted? Something sparkly.',game:'I call next on the arcade game.',closet:'Do you have a hat in my size?',studio:'Will you paint my portrait? I have a good side.',bedroom:'This bed looks very napable.'};if(byType[r.type])pool.push(byType[r.type],byType[r.type]);
  if(!r.items.some(j=>['plant','flowers'].includes(j.type)))pool.push('Moo... a cow needs something green to look at.');if(r.light==='night')pool.push('The moon looks so pretty from here.');if(r.art)pool.push('Did you paint that picture? It is moo-tiful.');}
 pool=pool.filter(Boolean);return '🐮 '+pool[Math.floor(Math.random()*pool.length)];}

// ---------- drawing the scene ----------
function fitBox(x0,y0,x1,y1,pad=30){return `${r1(x0-pad)} ${r1(y0-pad)} ${r1(x1-x0+pad*2)} ${r1(y1-y0+pad*2)}`;}
function viewBoxFor(){let h=home(),v=view();
 if(v==='room'){let r=room(),span=Math.max(r.w+r.d,12),cx=500+(r.w-r.d)*21,W=span*42+170,top=220-200,bottom=220+(r.w+r.d)*22+24,H=Math.max(bottom-top+40,W*.76),cy=(top+bottom)/2;return `${r1(cx-W/2)} ${r1(cy-H/2)} ${r1(W)} ${r1(H)}`;}
 if(v==='house'){if(frozen?.house)return frozen.house;let b=houseBounds(h);return fitBox(P(b.x0-1.2,b.y1+1.2)[0],P(b.x0,b.y0)[1]-130,P(b.x1+1.2,b.y0-1.2)[0],P(b.x1+1.2,b.y1+1.2)[1],50);}
 if(v==='isle'){if(frozen?.isleBox)return frozen.isleBox;let sh=isleShape(state),pts=shapePoly(sh,sh.sx+5.5,sh.sy+5.5,-14,48),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),top=Math.min(...ys,...state.homes.map(q=>{let l=lotRect(q);return P(l.x0,l.y0)[1]-330;}));return fitBox(Math.min(...xs),top,Math.max(...xs),Math.max(...ys),10);}
 if(frozen?.yardBox)return frozen.yardBox;let b=yardBounds(h);return fitBox(P(b.x0,b.y1)[0],P(b.x0,b.y0)[1]-260,P(b.x1,b.y0)[0],P(b.x1,b.y1)[1]+20,30);}
function ghostItem(){if(!pending||pending.room||!ghost)return '';let i={...pending,id:'preview',x:ghost.x,y:ghost.y,rot:pending.rot||0},[w,d]=dims(i),ok=fits(i);return `<g pointer-events="none" opacity=".66">${furniture(i)}${poly([P(i.x,i.y,4),P(i.x+w,i.y,4),P(i.x+w,i.y+d,4),P(i.x,i.y+d,4)],ok?'#79ab8733':'#d5777733',ok?'#477b58':'#b54444','stroke-width="3"')}</g>`;}
function sceneArt(clean=false){let h=home(),v=view(),sel=clean?null:selected;
 if(v==='room')return roomArt(room(),{selected:sel,grid:grid&&!clean,ghost:clean?null:ghostItem});
 if(v==='yard')return yardArt(h,{selected:sel,grid:grid&&!clean,ghost:clean?null:ghostItem});
 if(v==='isle')return isleArt(state,{selected:sel,selectedHome:clean?null:selHome,ghost:clean?null:ghostItem});
 let g='';if(!clean&&pending?.room&&ghost){let ok=roomFree(h,-1,ghost.x,ghost.y,pending.w,pending.d),c=ok?'#477b58':'#b54444',p=[P(ghost.x,ghost.y,2),P(ghost.x+pending.w,ghost.y,2),P(ghost.x+pending.w,ghost.y+pending.d,2),P(ghost.x,ghost.y+pending.d,2)];g=`<g pointer-events="none">${poly(p,ok?'#79ab8740':'#d5777740',c,'stroke-width="3" stroke-dasharray="8 4"')}<text x="${P(ghost.x+pending.w/2,ghost.y+pending.d/2)[0]}" y="${P(ghost.x+pending.w/2,ghost.y+pending.d/2)[1]+5}" text-anchor="middle" font-family="Georgia" font-size="16" fill="${c}">${ROOM_TYPES[pending.type].icon} ${pending.w} × ${pending.d}</text></g>`;}
 return houseArt(h,{selected:clean?null:selected,ghost:g});}
function renderScene(){$('scene').setAttribute('viewBox',viewBoxFor());$('scene').innerHTML=sceneArt();let ext=home().ext,v=view();$('scene-wrap').className='scene-wrap view-'+v+(v==='yard'?' sky-'+ext.light:v==='isle'?' sea-'+state.isle.light:'');}

// ---------- the side panel ----------
function swatches(target,current,{reset=true,label=''}={}){return `<div class="paints" role="group" aria-label="${esc(label||'Colors')}">${PAINTS.map(([n,c])=>`<button class="paint" data-paint="${target}" data-color="${c}" style="--c:${c}" aria-label="${n}" title="${n}" aria-pressed="${current===c}"></button>`).join('')}<label class="paint any" title="Any color" style="--c:${current&&!PAINTS.some(p=>p[1]===current)?current:'#ffffff'}"><input type="color" data-paint="${target}" value="${current||'#ffffff'}" aria-label="Any color"></label>${reset?`<button class="mini" data-paint-reset="${target}">Reset</button>`:''}</div>`;}
function collectionsHtml(){return `<div class="section-label">01 / COLLECTIONS</div><div id="styles">${STYLES.map(s=>`<button class="style ${s.id===style?'active':''}" data-style="${s.id}" aria-pressed="${s.id===style}"><span class="swatches">${[s.fabric,s.wood,s.accent].map(c=>`<i style="background:${c}"></i>`).join('')}</span>${s.name}<small>${s.era}</small></button>`).join('')}</div><div class="collection-story">${palette(style).story}</div>`;}
function ideaHtml(n){return `<div class="section-label">${n} / NEED AN IDEA?</div><div class="idea">${idea?`<p>${esc(idea)}</p>`:''}<button data-act="idea">${idea?'Another idea':'Give me an idea'}</button></div>`;}
function sel(id,opts,cur,label){return `<label class="field">${label}<select id="${id}" aria-label="${label}">${opts.map(([v,n])=>`<option value="${v}" ${v===cur?'selected':''}>${n}</option>`).join('')}</select></label>`;}
function renderSide(){let v=view(),h=home(),out='';
 if(v==='room'){let r=room(),wall=r.wallPaint||palette(r.wall).wall;
  out+=collectionsHtml()+`<button class="wide" data-act="restyle">Make this whole room ${esc(palette(style).name)}</button>`;
  out+=`<div class="section-label" id="walls-section">02 / WALLS &amp; FLOORS</div>`+sel('wall',STYLES.map(s=>[s.id,s.name]),r.wall,'Walls')+swatches('wallPaint',r.wallPaint,{label:'Wall color'});
  out+=sel('paper',WALLPAPERS,r.paper||'style','Wallpaper');if(!['style','plain'].includes(r.paper||'style'))out+=`<div class="sub">Pattern color</div>`+swatches('paperInk',r.paperInk||wallInk(r,wall),{label:'Pattern color'});
  out+=sel('floor',STYLES.map(s=>[s.id,s.name]),r.floor,'Floor')+sel('floorPattern',FLOORS,r.floorPattern||'style','Floor pattern')+swatches('floorPaint',r.floorPaint,{label:'Floor color'});
  out+=sel('light',[['day','Soft daylight'],['golden','Golden hour'],['night','Moonlit evening']],r.light,'Light');
  out+=`<div class="section-label">03 / YOUR ART</div><p class="note">${r.art?'Your painting is hanging on the wall and on every easel in this room.':'Paint your own picture. It hangs on the wall and on any easel.'}</p><button class="wide primary" data-act="art">🎨 ${r.art?'Paint a new picture':'Paint wall art'}</button>`+ideaHtml('04');}
 if(v==='house'){out+=`<div class="section-label">01 / YOUR ROOMS</div><div class="room-list">${h.rooms.map((r,k)=>`<button class="room-row ${k===h.current?'active':''}" data-enter="${k}"><span>${ROOM_TYPES[r.type].icon}</span><b>${esc(r.name)}</b><small>${r.w} × ${r.d}</small></button>`).join('')}</div><p class="note">Add more rooms from the shelf. Rooms can be any size from ${MIN_SIZE} to ${MAX_SIZE} squares on a side.</p>`+collectionsHtml().replace('01 /','02 /')+ideaHtml('03');}
 if(v==='yard'){let e=h.ext;out+=`<div class="section-label">01 / THE HOUSE OUTSIDE</div><div class="sub">Walls</div>`+swatches('siding',e.siding,{reset:false,label:'House color'})+`<div class="sub">Roof</div>`+swatches('roof',e.roof,{reset:false,label:'Roof color'})+`<div class="sub">Front door and window boxes</div>`+swatches('door',e.door,{reset:false,label:'Door color'})+`<div class="sub">Window trim</div>`+swatches('trim',e.trim,{reset:false,label:'Trim color'})+`<div class="sub">Grass</div>`+swatches('grass',e.grass,{reset:false,label:'Grass color'});
  out+=sel('yardsize',[['5','Cozy yard'],['8','Roomy yard'],['11','Huge yard']],String(e.yard),'Yard size')+sel('light',[['day','Sunny day'],['golden','Golden hour'],['night','Starry night']],e.light,'Light');
  out+=collectionsHtml().replace('01 /','02 /')+ideaHtml('03');}
 if(v==='isle'){let is=state.isle;out+=`<div class="section-label">01 / YOUR ISLAND</div><div class="isle-name"><b>🏝️ ${esc(is.name)}</b><button class="mini" data-act="rename-isle">Rename</button></div><div class="room-list">${state.homes.map((x,k)=>`<button class="room-row ${k===selHome?'active':''}" data-visit="${k}"><span>🏠</span><b>${esc(x.name)}</b><small>${x.rooms.length} ${x.rooms.length===1?'room':'rooms'}</small></button>`).join('')}</div><button class="wide primary" data-act="new-home">＋ Build a new home</button><p class="note">Every home gets its own spot. Drag homes around to make your village.</p>`;
  out+=sel('islesize',[['3','Cozy island'],['6','Roomy island'],['10','Huge island']],String(is.size),'Island size')+sel('light',[['day','Sunny day'],['golden','Golden hour'],['night','Starry night']],is.light,'Light')+collectionsHtml().replace('01 /','02 /')+ideaHtml('03');}
 $('side-view').innerHTML=out;
 $('homes').innerHTML=state.homes.map((x,k)=>`<option value="${k}">${esc(x.name)}</option>`).join('');$('homes').value=state.active;}
function renderHead(){let v=view(),h=home();$('view-eyebrow').textContent=v==='room'?`INSIDE ${h.name.toUpperCase()}`:v==='house'?'THE WHOLE HOUSE':v==='isle'?'THE ISLAND VILLAGE':'THE GREAT OUTDOORS';
 $('room-title').textContent=v==='room'?room().name:v==='house'?h.name:v==='isle'?state.isle.name:`Outside ${h.name}`;
 for(let b of document.querySelectorAll('[data-view]')){b.setAttribute('aria-selected',b.dataset.view===v);b.classList.toggle('active',b.dataset.view===v);}
 $('room-pick').hidden=v!=='room';$('rename-room').hidden=v!=='room';$('room-pick').innerHTML=h.rooms.map((r,k)=>`<option value="${k}">${ROOM_TYPES[r.type].icon} ${esc(r.name)}</option>`).join('');$('room-pick').value=h.current;
 $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;$('grid').setAttribute('aria-pressed',grid);$('grid').hidden=v==='house'||v==='isle';
 $('tips').textContent=v==='isle'?'Drag homes to arrange the village · Double-tap a home to visit · Tap Cow on the beach for help':v==='house'?'Drag rooms to arrange · Double-tap a room to go inside · Arrow keys move the selected room':'Drag to arrange · R to turn · Arrow keys to nudge · Delete to remove · Ctrl Z to undo · Everything saves on this device';}

// ---------- the shelf ----------
const thumbCache={};
function thumb(type){let k=type+style;if(thumbCache[k])return thumbCache[k];ART_CTX={art:null,bg:'#fffaf0',night:false};let t=TYPES[type],l=P(0,t.d)[0]-8,r=P(t.w,0)[0]+8,top=P(0,0)[1]-t.h-6,bot=P(t.w,t.d)[1]+12,side=Math.max(r-l,bot-top),cx=(l+r)/2,cy=(top+bot)/2;
 return thumbCache[k]=`<svg viewBox="${r1(cx-side/2)} ${r1(cy-side/2)} ${r1(side)} ${r1(side)}" aria-hidden="true">${furniture({type,style,x:0,y:0,rot:0})}</svg>`;}
function roomThumb(type){let k='room-'+type+style;if(thumbCache[k])return thumbCache[k];let r=makeRoom(type,'',style);r.id='thumb';let l=P(0,r.d)[0],rr=P(r.w,0)[0],top=P(0,0)[1]-70,bot=P(r.w,r.d)[1]+8,side=Math.max(rr-l,bot-top)+10,cx=(l+rr)/2,cy=(top+bot)/2;
 return thumbCache[k]=`<svg viewBox="${r1(cx-side/2)} ${r1(cy-side/2)} ${r1(side)} ${r1(side)}" aria-hidden="true">${roomArt(r,{simple:true})}</svg>`;}
function renderShelf(){let v=view(),key=[v,style,category,pending?.type||'',view()==='room'?room().type:''].join('|');
 if(v==='house'){$('shelf-eyebrow').textContent='ROOMS TO ADD';$('shelf-title').textContent='Build your house';$('categories').innerHTML='';
  if(shelfKey!==key)$('pieces').innerHTML=Object.entries(ROOM_TYPES).map(([k,t])=>`<button class="piece room-card ${pending?.type===k?'pending':''}" data-room-type="${k}">${roomThumb(k)}<strong>${t.icon} ${t.name}</strong><small>${t.w} × ${t.d} · Add ＋</small></button>`).join('');shelfKey=key;return;}
 let where=v==='isle'?['out','both','isle']:v==='yard'?['out','both']:['in','both'],cats=v==='isle'?ISLE_CATS:v==='yard'?OUT_CATS:IN_CATS,chips=v==='room'?[['room','This room'],['All','All'],...cats.map(c=>[c,c])]:[['All','All'],...cats.map(c=>[c,c])];
 if(!chips.some(c=>c[0]===category))category=chips[0][0];
 $('shelf-eyebrow').textContent=v==='isle'?'FOR THE VILLAGE':v==='yard'?'FOR THE YARD':'THE SHELF';$('shelf-title').textContent=palette(style).name;
 $('categories').innerHTML=chips.map(([c,n])=>`<button data-cat="${c}" class="${c===category?'active':''}">${n}</button>`).join('');
 if(shelfKey===key)return;shelfKey=key;
 let list=Object.entries(TYPES).filter(([k,t])=>where.includes(t.where));
 if(category==='room'){let want=[...ROOM_TYPES[room().type].pieces,'cow','cat'];list=want.map(k=>[k,TYPES[k]]);}else if(category!=='All')list=list.filter(([k,t])=>t.cat===category);
 $('pieces').innerHTML=list.map(([type,t])=>`<button class="piece ${pending?.type===type?'pending':''}" data-type="${type}">${thumb(type)}<strong>${t.name}</strong><small>Place ＋</small></button>`).join('');}

// ---------- the bar under the scene ----------
function sizer(label,axis,val){return `<span class="sizer"><span>${label}</span><button data-size="${axis}" data-delta="-1" aria-label="Smaller ${label}">−</button><b>${val}</b><button data-size="${axis}" data-delta="1" aria-label="Bigger ${label}">＋</button></span>`;}
function renderSelection(){let v=view(),h=home(),out='';
 if(pending?.room)out=`<strong>${ROOM_TYPES[pending.type].icon} New ${ROOM_TYPES[pending.type].name.toLowerCase()}</strong>${sizer('Width','w',pending.w)}${sizer('Depth','d',pending.d)}<button data-act="rotate">↻ Turn</button><button data-act="cancel">Cancel</button>`;
 else if(v==='house'&&selected!=null&&h.rooms[selected]){let r=h.rooms[selected];out=`<strong>${ROOM_TYPES[r.type].icon} ${esc(r.name)}</strong><button class="primary" data-act="enter">Go inside →</button>${sizer('Width','w',r.w)}${sizer('Depth','d',r.d)}<label class="inline">Room type<select id="room-type">${Object.entries(ROOM_TYPES).map(([k,t])=>`<option value="${k}" ${k===r.type?'selected':''}>${t.icon} ${t.name}</option>`).join('')}</select></label><button data-act="rename-room">Rename</button><button data-act="remove-room">Remove</button><button data-act="done">Done</button>`;}
 else if(v==='isle'&&selHome!=null&&state.homes[selHome]){let q=state.homes[selHome];out=`<strong>🏠 ${esc(q.name)}</strong><button class="primary" data-act="visit">Visit outside →</button><button data-act="visit-in">Go inside the house</button><button data-act="rename-home-sel">Rename</button>${state.homes.length>1?'<button data-act="remove-home">Remove home</button>':''}<button data-act="done">Done</button>`;}
 else if(pending)out=`<strong>Placing: ${TYPES[pending.type].name}</strong><button data-act="rotate">↻ Turn</button><button data-act="cancel">Cancel</button>`;
 else if(v!=='house'&&selected){let i=space().items.find(i=>i.id===selected);if(i){out=`<strong>${TYPES[i.type].name}</strong><button data-act="rotate">↻ Turn</button><button data-act="duplicate">Copy</button><button data-act="remove">Remove</button>${['cow','cat'].includes(i.type)?'<button data-act="talk">💬 Say hi</button>':''}<button data-act="done">Done</button><div class="color-row"><span>Color</span>${swatches('fabric',i.fabric||'',{label:'Piece color'}).replace('data-paint-reset="fabric"','data-act="original"')}</div>`;}}
 if(!out)out=`<span class="quiet">${v==='house'?`${h.rooms.length} ${h.rooms.length===1?'room':'rooms'} · Tap a room to arrange it, or pick a new one from the shelf.`:v==='isle'?`${state.homes.length} ${state.homes.length===1?'home':'homes'} on the island · Tap a home to visit it, or add village pieces from the shelf.`:v==='yard'?'Tap anything in the yard to move it, turn it or give it a new color.':'Tap any piece in your room to move it, turn it or give it a new color.'}</span>`;
 $('selection').innerHTML=out;}
function render(){renderSide();renderHead();renderShelf();renderScene();renderSelection();refreshHint();}

// ---------- pointer work ----------
function floorPoint(e){let s=$('scene'),p=s.createSVGPoint();p.x=e.clientX;p.y=e.clientY;p=p.matrixTransform(s.getScreenCTM().inverse());let a=(p.x-500)/42,b=(p.y-220)/22;return {x:(a+b)/2,y:(b-a)/2};}
const snap=n=>Math.round(n*4)/4;
function itemAt(p){if(!pending||pending.room)return null;let i={...pending,x:0,y:0,rot:pending.rot||0},[w,d]=dims(i);return {x:snap(p.x-w/2),y:snap(p.y-d/2)};}
function freeze(){let v=view();frozen={house:v==='house'?viewBoxFor():null,yardBox:v==='yard'?viewBoxFor():null,yard:v==='yard'?yardPlaceBounds(home()):null,isleBox:v==='isle'?viewBoxFor():null};}
$('scene').addEventListener('pointerdown',e=>{let v=view(),h=home();
 if(v==='house'){
  if(pending?.room){if(h.rooms.length>=MAX_ROOMS){hint(`A house can hold ${MAX_ROOMS} rooms. Start a new home to keep building.`);return;}let p=floorPoint(e),x=Math.round(p.x-pending.w/2),y=Math.round(p.y-pending.d/2);
   if(h.rooms.some(q=>overlap(x,y,pending.w,pending.d,q.px,q.py,q.w,q.d,0))){hint('That spot overlaps another room. Try an open space.');return;}
   change(()=>{let t=ROOM_TYPES[pending.type],r=makeRoom(pending.type,uniqueName(t.name,h.rooms.map(q=>q.name)),style,pending.w,pending.d);r.px=x;r.py=y;
    if(x<0||y<0){let dx=Math.max(0,-x),dy=Math.max(0,-y);for(let q of h.rooms){q.px+=dx;q.py+=dy;}for(let i of h.yard.items){i.x+=dx;i.y+=dy;}r.px+=dx;r.py+=dy;}
    h.rooms.push(r);normalize(h);selected=h.rooms.length-1;pending=null;ghost=null;});hint(`Your new ${ROOM_TYPES[h.rooms[selected].type].name.toLowerCase()} is ready. Double-tap it to go inside!`,4500);return;}
  let k=e.target.closest('[data-room]')?.dataset.room;if(k!=null){k=Number(k);let now=Date.now();if(lastTap.k===k&&now-lastTap.t<420){lastTap={};enterRoom(k);return;}lastTap={k,t:now};selected=k;freeze();drag={room:k,start:{x:h.rooms[k].px,y:h.rooms[k].py},p:floorPoint(e),before:JSON.stringify(state),moved:false};$('scene').setPointerCapture(e.pointerId);renderScene();renderSelection();refreshHint();}
  else{selected=null;renderScene();renderSelection();refreshHint();}return;}
 if(v==='isle'){if(e.target.closest('[data-guide]')){openGuide();return;}
  let hk=pending?null:e.target.closest('[data-home]')?.dataset.home;if(hk!=null){hk=Number(hk);let now=Date.now();if(lastTap.home===hk&&now-lastTap.t<420){lastTap={};visitHome(hk,'yard');return;}lastTap={home:hk,t:now};selHome=hk;selected=null;freeze();drag={home:hk,start:{...state.homes[hk].at},p:floorPoint(e),before:JSON.stringify(state),moved:false};$('scene').setPointerCapture(e.pointerId);renderScene();renderSelection();renderSide();refreshHint();return;}
  if(selHome!=null){selHome=null;renderSide();}}
 let id=e.target.closest('[data-item]')?.dataset.item,sp=space();
 if(pending){if(sp.items.length>=sp.max){hint(`That's ${sp.max} pieces, the most this space can hold.`);return;}let at=itemAt(floorPoint(e)),i=makeItem(pending.type,pending.style,at.x,at.y,pending.rot||0);if(pending.fabric)i.fabric=pending.fabric;
  if(!fits(i)){hint(v==='isle'?'Keep it on the island and out of the yards. Try open grass or sand.':v==='yard'?'That spot is taken, or it is part of the house. Try open grass.':'That spot is taken or outside the room. Try an open floor space.');return;}
  change(()=>{sp.items.push(i);selected=i.id;pending=null;ghost=null;});hint(['cow','cat'].includes(i.type)?cowLine(i):'Placed! Drag it to fine-tune, or turn it below.');return;}
 if(id){selected=id;let i=sp.items.find(i=>i.id===id);if(v==='yard'||v==='isle')freeze();drag={id,start:clone(i),p:floorPoint(e),before:JSON.stringify(state),moved:false};$('scene').setPointerCapture(e.pointerId);renderScene();renderSelection();refreshHint();}
 else{selected=null;renderScene();renderSelection();refreshHint();}});
$('scene').addEventListener('pointermove',e=>{let v=view();
 if(pending&&!drag){let p=floorPoint(e);ghost=pending.room?{x:Math.round(p.x-pending.w/2),y:Math.round(p.y-pending.d/2)}:itemAt(p);renderScene();return;}
 if(!drag)return;let p=floorPoint(e),h=home();
 if(drag.home!=null){let q=state.homes[drag.home],x=drag.start.x+Math.round(p.x-drag.p.x),y=drag.start.y+Math.round(p.y-drag.p.y);if(x===q.at.x&&y===q.at.y)return;let L=lotAt(q,{x,y});if(state.homes.some((o,j)=>j!==drag.home&&lotsTouch(L,lotRect(o))))return;q.at={x,y};drag.moved=true;renderScene();return;}
 if(drag.room!=null){let r=h.rooms[drag.room],x=drag.start.x+Math.round(p.x-drag.p.x),y=drag.start.y+Math.round(p.y-drag.p.y);if((x!==r.px||y!==r.py)&&x>=-20&&y>=-20&&!h.rooms.some((q,j)=>j!==drag.room&&overlap(x,y,r.w,r.d,q.px,q.py,q.w,q.d,0))){r.px=x;r.py=y;drag.moved=true;renderScene();}return;}
 let sp=space(),i=sp.items.find(i=>i.id===drag.id),c={...i,x:snap(drag.start.x+p.x-drag.p.x),y:snap(drag.start.y+p.y-drag.p.y)};
 if(c.x===i.x&&c.y===i.y)return;if(fits(c,sp)){i.x=c.x;i.y=c.y;drag.moved=true;renderScene();}else if(!flash)hint(v==='isle'?'Keep it on the island and out of the yards.':v==='yard'?'Keep it on the grass and off the house.':'Keep it inside the room and clear of other pieces.',1400);});
function finishDrag(cancel=false){if(!drag)return;let d=drag;drag=null;
 if(cancel)state=JSON.parse(d.before);else if(d.moved){if(d.room!=null)normalize(home());if(JSON.stringify(state)!==d.before){undo.push(d.before);if(undo.length>40)undo.shift();redo=[];save();}}
 frozen=null;render();if(!d.moved&&d.id){let i=space().items.find(i=>i.id===d.id);if(i&&['cow','cat'].includes(i.type))hint(cowLine(i),5200);}}
$('scene').addEventListener('pointerup',()=>finishDrag());$('scene').addEventListener('pointercancel',()=>finishDrag(true));
$('scene').addEventListener('pointerleave',()=>{if(pending&&!drag){ghost=null;renderScene();}});
$('scene').addEventListener('dblclick',e=>{if(view()!=='house')return;let k=e.target.closest('[data-room]')?.dataset.room;if(k!=null)enterRoom(Number(k));});
function enterRoom(k){let h=home();h.current=k;state.view='room';selected=null;pending=null;ghost=null;category='room';shelfKey='';save();render();}
function visitHome(k,v){state.active=k;selHome=null;undo=[];redo=[];state.view=v;selected=null;pending=null;ghost=null;drag=null;frozen=null;category='All';shelfKey='';save();render();}
function setView(v){if(v===view())return;if(v==='isle')layoutHomes(state);selHome=null;state.view=v;selected=null;pending=null;ghost=null;drag=null;frozen=null;category=v==='room'?'room':'All';shelfKey='';save();render();}

// ---------- actions ----------
function resize(axis,delta){let h=home();
 if(pending?.room){let n=pending[axis]+delta;if(n<MIN_SIZE||n>MAX_SIZE)return;pending[axis]=n;renderSelection();renderScene();refreshHint();return;}
 let r=h.rooms[selected];if(!r)return;let w=axis==='w'?r.w+delta:r.w,d=axis==='d'?r.d+delta:r.d;
 if(w<MIN_SIZE||d<MIN_SIZE){hint(`Rooms are at least ${MIN_SIZE} squares on a side.`);return;}if(w>MAX_SIZE||d>MAX_SIZE){hint(`Rooms can be up to ${MAX_SIZE} squares on a side.`);return;}
 if(!roomFree(h,selected,r.px,r.py,w,d)){hint('Another room is in the way. Move this room first.');return;}
 if(r.items.some(i=>{let [a,b]=dims(i);return i.x+a>w+1e-9||i.y+b>d+1e-9;})){hint('Some furniture is in the way. Move it toward the back corner first.');return;}
 change(()=>{r.w=w;r.d=d;});}
function act(a){let v=view(),h=home();
 if(a==='cancel'||a==='done'){pending=null;ghost=null;selected=null;selHome=null;render();return;}
 if(a==='guide'){openGuide();return;}
 if(a==='rename-isle'){openName('isle');return;}
 if(a==='new-home'){$('new-home').click();return;}
 if(v==='isle'&&selHome!=null&&['visit','visit-in','rename-home-sel','remove-home'].includes(a)){let k=selHome,q=state.homes[k];
  if(a==='visit')visitHome(k,'yard');if(a==='visit-in')visitHome(k,'house');if(a==='rename-home-sel')openName('home-sel');
  if(a==='remove-home'){if(state.homes.length===1){hint('The island needs at least one home.');return;}change(()=>{state.homes.splice(k,1);if(state.active>=state.homes.length)state.active=state.homes.length-1;else if(state.active>k)state.active--;selHome=null;});hint(`${q.name} was taken off the island. Undo brings it back.`,4200);}
  return;}
 if(a==='idea'){let next;do next=PROMPTS[Math.floor(Math.random()*PROMPTS.length)];while(next===idea&&PROMPTS.length>1);idea=next;renderSide();return;}
 if(a==='art'){openArt();return;}
 if(a==='restyle'){let r=room();change(()=>{r.wall=style;r.floor=style;delete r.wallPaint;delete r.floorPaint;delete r.paper;delete r.paperInk;delete r.floorPattern;for(let i of r.items){i.style=style;delete i.fabric;}});hint(`Ta-da! Your whole room is ${palette(style).name} now.`);return;}
 if(a==='rotate'&&pending?.room){[pending.w,pending.d]=[pending.d,pending.w];renderSelection();renderScene();return;}
 if(v==='house'){let r=h.rooms[selected];if(!r)return;
  if(a==='enter')enterRoom(selected);
  if(a==='rename-room')openName('room');
  if(a==='remove-room'){if(h.rooms.length===1){hint('A house needs at least one room.');return;}let name=r.name;change(()=>{h.rooms.splice(selected,1);if(h.current>=h.rooms.length)h.current=h.rooms.length-1;else if(h.current>selected)h.current--;normalize(h);selected=null;});hint(`${name} was removed. Undo brings it back.`,4000);}
  return;}
 if(a==='rotate'&&pending){pending.rot=1-(pending.rot||0);renderScene();return;}
 let sp=space(),i=sp.items.find(i=>i.id===selected);if(!i)return;
 if(a==='talk'){hint(cowLine(i),5200);return;}
 if(a==='original')change(()=>delete i.fabric);
 if(a==='remove')change(()=>{let k=sp.items.findIndex(j=>j.id===selected);sp.items.splice(k,1);selected=null;});
 if(a==='rotate'){let c={...i,rot:1-i.rot};if(fits(c))change(()=>i.rot=c.rot);else hint('Move it into a bigger open space before turning it.');}
 if(a==='duplicate'){pending={type:i.type,style:i.style,rot:i.rot,...(i.fabric?{fabric:i.fabric}:{})};ghost=null;selected=null;render();hint('Tap an open spot for the copy.');}}
function setPaint(target,color){let v=view(),h=home();
 if(target==='fabric'){let i=space().items.find(i=>i.id===selected);if(i)change(()=>i.fabric=color);return;}
 if(['siding','roof','door','trim','grass'].includes(target)){change(()=>h.ext[target]=color);return;}
 let r=room();change(()=>{if(color)r[target]=color;else delete r[target];if(target==='paperInk'&&!color)delete r.paperInk;});}
document.addEventListener('click',e=>{let el=e.target.closest('[data-paint],[data-paint-reset],[data-act],[data-style],[data-cat],[data-type],[data-room-type],[data-enter],[data-view],[data-size],[data-visit]');if(!el||el.tagName==='INPUT')return;let d=el.dataset;
 if(d.paintReset){setPaint(d.paintReset,'');return;}
 if(d.paint&&d.color){setPaint(d.paint,d.color);return;}
 if(d.size){resize(d.size,Number(d.delta));return;}
 if(d.act){act(d.act);return;}
 if(d.view){setView(d.view);return;}
 if(d.enter!=null){enterRoom(Number(d.enter));return;}
 if(d.visit!=null){visitHome(Number(d.visit),'yard');return;}
 if(d.style){style=d.style;if(pending&&!pending.room)pending.style=style;render();return;}
 if(d.cat){category=d.cat;render();return;}
 if(d.type){if(pending?.type===d.type){pending=null;render();return;}pending={type:d.type,style,rot:0};ghost=null;selected=null;render();if(window.innerWidth<1100)$('scene').scrollIntoView({behavior:'smooth',block:'center'});return;}
 if(d.roomType){let t=ROOM_TYPES[d.roomType];pending={room:true,type:d.roomType,w:t.w,d:t.d};ghost=null;selected=null;render();if(window.innerWidth<1100)$('scene').scrollIntoView({behavior:'smooth',block:'center'});}});
document.addEventListener('change',e=>{let t=e.target,h=home();
 if(t.matches('input[type=color][data-paint]')){setPaint(t.dataset.paint,t.value);return;}
 if(t.id==='homes'){state.active=Number(t.value);selected=null;pending=null;undo=[];redo=[];shelfKey='';save();render();return;}
 if(t.id==='room-pick'){h.current=Number(t.value);selected=null;pending=null;category='room';shelfKey='';save();render();return;}
 if(t.id==='room-type'){let r=h.rooms[selected];if(r)change(()=>r.type=t.value);return;}
 if(t.id==='yardsize'){change(()=>{h.ext.yard=Number(t.value);layoutHomes(state);});return;}
 if(t.id==='islesize'){change(()=>state.isle.size=Number(t.value));return;}
 if(t.id==='light'){if(view()==='isle')change(()=>state.isle.light=t.value);else if(view()==='yard')change(()=>h.ext.light=t.value);else change(()=>room().light=t.value);return;}
 if(t.id==='wall'){change(()=>{room().wall=t.value;delete room().wallPaint;});return;}
 if(t.id==='floor'){change(()=>{room().floor=t.value;delete room().floorPaint;});return;}
 if(t.id==='paper'){change(()=>{if(t.value==='style')delete room().paper;else room().paper=t.value;});return;}
 if(t.id==='floorPattern'){change(()=>{if(t.value==='style')delete room().floorPattern;else room().floorPattern=t.value;});return;}});
$('undo').onclick=()=>history(undo,redo);$('redo').onclick=()=>history(redo,undo);$('grid').onclick=()=>{grid=!grid;render();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('guide').hidden){closeGuide();return;}if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||document.querySelector('dialog[open]'))return;
 if(e.key==='?'){openGuide();return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?history(redo,undo):history(undo,redo);return;}
 if(e.key==='Escape'){act('cancel');return;}
 let v=view(),h=home();
 if(e.key==='Enter'&&e.target.dataset?.item){selected=e.target.dataset.item;renderSelection();renderScene();return;}
 if(e.key==='Enter'&&e.target.dataset?.room!=null){enterRoom(Number(e.target.dataset.room));return;}
 let moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
 if(v==='isle'&&selHome!=null&&moves[e.key]){e.preventDefault();let q=state.homes[selHome],[x,y]=moves[e.key],at={x:q.at.x+x,y:q.at.y+y},L=lotAt(q,at);if(state.homes.some((o,j)=>j!==selHome&&lotsTouch(L,lotRect(o))))return;change(()=>q.at=at);return;}
 if(v==='house'){if(selected==null||!moves[e.key])return;e.preventDefault();let r=h.rooms[selected],[x,y]=moves[e.key];if(h.rooms.some((q,j)=>j!==selected&&overlap(r.px+x,r.py+y,r.w,r.d,q.px,q.py,q.w,q.d,0)))return;change(()=>{r.px+=x;r.py+=y;if(r.px<0||r.py<0){let dx=Math.max(0,-r.px),dy=Math.max(0,-r.py);for(let q of h.rooms){q.px+=dx;q.py+=dy;}for(let i of h.yard.items){i.x+=dx;i.y+=dy;}}normalize(h);});return;}
 if(e.key.toLowerCase()==='r'&&(selected||pending)){act('rotate');return;}if(!selected)return;
 if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();act('remove');return;}
 if(moves[e.key]){e.preventDefault();let sp=space(),i=sp.items.find(i=>i.id===selected),[x,y]=moves[e.key],c={...i,x:i.x+x*.25,y:i.y+y*.25};if(fits(c,sp))change(()=>Object.assign(i,c));}});
for(let b of document.querySelectorAll('[data-view]'))b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;let k=Object.keys(VIEWS),n=k[(k.indexOf(view())+(e.key==='ArrowRight'?1:2))%3];setView(n);document.querySelector(`[data-view="${n}"]`).focus();});

// ---------- names ----------
let naming='';
function openName(kind){naming=kind;let h=home();$('dialog-title').textContent=kind==='new-home'?'A new home, a new possibility':kind==='home'||kind==='home-sel'?'Name your home':kind==='isle'?'Name your island':'Name this room';$('room-name').value=kind==='new-home'?uniqueName('My new house',state.homes.map(x=>x.name)):kind==='home'?h.name:kind==='home-sel'?state.homes[selHome].name:kind==='isle'?state.isle.name:h.rooms[view()==='house'?selected:h.current].name;$('name-dialog').showModal();$('room-name').select();}
$('new-home').onclick=()=>{if(state.homes.length>=MAX_HOMES){hint(`The studio holds ${MAX_HOMES} homes. Export them to keep a backup.`);return;}openName('new-home');};
$('rename-home').onclick=()=>openName('home');$('rename-room').onclick=()=>openName('room');
$('name-dialog').addEventListener('close',()=>{if($('name-dialog').returnValue!=='save')return;let name=$('room-name').value.trim().slice(0,40)||'My house',h=home();
 change(()=>{if(naming==='new-home'){state.homes.push(freshHome(name,style));layoutHomes(state);state.active=state.homes.length-1;state.view=view()==='isle'?'isle':'room';selected=null;selHome=view()==='isle'?state.active:null;pending=null;}else if(naming==='home')h.name=name;else if(naming==='home-sel'){if(state.homes[selHome])state.homes[selHome].name=name;}else if(naming==='isle')state.isle.name=name.trim()?name:'Wild Bloom Isle';else{let k=view()==='house'?selected:h.current;if(h.rooms[k])h.rooms[k].name=name;}});
 if(naming==='new-home'){undo=[];redo=[];shelfKey='';hint('Your new home has its very own spot on the island!',4200);}});

// ---------- painting wall art ----------
const art={tool:'brush',size:10,color:'#c2456b',bg:'#fffaf0',hue:0,undo:[],last:null};
const TOOLS=[['brush','🖌️ Brush'],['rainbow','🌈 Rainbow'],['blossom','🌸 Blossom'],['heart','💗 Heart'],['star','⭐ Star'],['eraser','🧽 Eraser']];
const actx=()=>$('art-canvas').getContext('2d');
function renderArtTools(){$('art-tools').innerHTML=TOOLS.map(([k,n])=>`<button type="button" data-tool="${k}" aria-pressed="${art.tool===k}">${n}</button>`).join('');
 $('art-sizes').innerHTML=[[5,'Thin'],[10,'Medium'],[20,'Thick']].map(([s,n])=>`<button type="button" data-brush="${s}" aria-pressed="${art.size===s}"><i style="width:${s/1.6+4}px;height:${s/1.6+4}px"></i>${n}</button>`).join('');
 $('art-colors').innerHTML=[...PAINTS,['Ink','#2d2a28'],['Grass','#6f9a5c']].map(([n,c])=>`<button type="button" class="paint" data-ink="${c}" style="--c:${c}" title="${n}" aria-label="${n}" aria-pressed="${art.color===c}"></button>`).join('')+`<label class="paint any" title="Any color" style="--c:${art.color}"><input type="color" id="art-any" value="${art.color}" aria-label="Any color"></label>`;}
function openArt(){let c=$('art-canvas'),ctx=actx(),r=room();ctx.clearRect(0,0,c.width,c.height);art.bg=r.artBg||'#fffaf0';c.style.background=art.bg;art.undo=[];
 if(r.art){let img=new Image();img.onload=()=>ctx.drawImage(img,0,0,c.width,c.height);img.src=r.art;}renderArtTools();$('art-dialog').showModal();}
function artPoint(e){let c=$('art-canvas'),b=c.getBoundingClientRect();return [(e.clientX-b.left)*c.width/b.width,(e.clientY-b.top)*c.height/b.height];}
function artSnapshot(){let c=$('art-canvas');art.undo.push({img:actx().getImageData(0,0,c.width,c.height),bg:art.bg});if(art.undo.length>30)art.undo.shift();}
function stamp(ctx,[x,y],kind,size,color){ctx.save();ctx.translate(x,y);ctx.fillStyle=color;let r=size*1.4+8;
 if(kind==='blossom'){for(let k=0;k<5;k++){ctx.save();ctx.rotate(k*Math.PI*2/5);ctx.beginPath();ctx.ellipse(0,-r*.55,r*.38,r*.55,0,0,Math.PI*2);ctx.fill();ctx.restore();}ctx.fillStyle='#f2cf63';ctx.beginPath();ctx.arc(0,0,r*.22,0,Math.PI*2);ctx.fill();}
 if(kind==='heart'){ctx.beginPath();ctx.moveTo(0,r*.9);ctx.bezierCurveTo(-r*1.3,0,-r*.9,-r*.9,0,-r*.35);ctx.bezierCurveTo(r*.9,-r*.9,r*1.3,0,0,r*.9);ctx.fill();}
 if(kind==='star'){ctx.beginPath();for(let k=0;k<10;k++){let a=-Math.PI/2+k*Math.PI/5,rr=k%2?r*.45:r;ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr);}ctx.closePath();ctx.fill();}
 ctx.restore();}
function strokeTo(p){let ctx=actx();ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=art.size;
 if(art.tool==='eraser'){ctx.globalCompositeOperation='destination-out';ctx.lineWidth=art.size*2;}ctx.strokeStyle=art.tool==='rainbow'?`hsl(${art.hue},80%,62%)`:art.color;art.hue=(art.hue+7)%360;
 ctx.beginPath();ctx.moveTo(...art.last);ctx.lineTo(...p);ctx.stroke();ctx.restore();art.last=p;}
$('art-canvas').addEventListener('pointerdown',e=>{e.preventDefault();artSnapshot();let p=artPoint(e);
 if(['blossom','heart','star'].includes(art.tool)){stamp(actx(),p,art.tool,art.size,art.color);return;}
 $('art-canvas').setPointerCapture(e.pointerId);art.last=[p[0]-.1,p[1]];strokeTo(p);});
$('art-canvas').addEventListener('pointermove',e=>{if(!art.last)return;for(let ev of (e.getCoalescedEvents?.()||[e]))strokeTo(artPoint(ev));});
for(let ev of ['pointerup','pointercancel'])$('art-canvas').addEventListener(ev,()=>art.last=null);
$('art-dialog').addEventListener('click',e=>{let b=e.target.closest('button');if(!b)return;let d=b.dataset,c=$('art-canvas');
 if(d.tool){art.tool=d.tool;renderArtTools();}if(d.brush){art.size=Number(d.brush);renderArtTools();}if(d.ink){art.color=d.ink;if(art.tool==='eraser'||art.tool==='rainbow')art.tool='brush';renderArtTools();}
 if(d.art==='bg'){artSnapshot();art.bg=art.color;c.style.background=art.bg;}
 if(d.art==='undo'){let s=art.undo.pop();if(s){actx().putImageData(s.img,0,0);art.bg=s.bg;c.style.background=art.bg;}}
 if(d.art==='clear'){artSnapshot();actx().clearRect(0,0,c.width,c.height);}});
$('art-dialog').addEventListener('input',e=>{if(e.target.id==='art-any'){art.color=e.target.value;e.target.parentElement.style.setProperty('--c',art.color);if(art.tool==='eraser'||art.tool==='rainbow')art.tool='brush';}});
$('art-dialog').addEventListener('close',()=>{let v=$('art-dialog').returnValue,r=room();
 if(v==='hang'){let url=$('art-canvas').toDataURL('image/png');if(url.length>700000){hint('That painting is too detailed to save. Try clearing a little.');return;}change(()=>{r.art=url;r.artBg=art.bg;});hint('Your painting is hanging on the wall. Beautiful!',4000);}
 if(v==='remove'&&r.art){change(()=>{delete r.art;delete r.artBg;});hint('The painting is down. Paint a new one any time.');}});

// ---------- export, import and pictures ----------
$('export').onclick=()=>{let url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='wild-bloom-homes.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=async e=>{let file=e.target.files[0];if(!file)return;try{if(file.size>12000000)throw Error();let raw=JSON.parse(await file.text()),incoming=cleanState(raw)||migrateV1(raw);if(!incoming)throw Error();
 if(state.homes.length+incoming.homes.length>MAX_HOMES)throw Error('full');change(()=>{state.homes.push(...incoming.homes.map(h=>({...h,id:uid(),at:undefined})));layoutHomes(state);state.active=state.homes.length-incoming.homes.length;state.view='house';selected=null;});hint('Imported homes added to your studio.');}
 catch(err){hint(err.message==='full'?`The studio holds ${MAX_HOMES} homes. Remove one or start fresh to import more.`:'Choose a Wild Bloom export file.');}e.target.value='';};
async function savePicture(){let vb=viewBoxFor().split(' ').map(Number),v=view(),h=home(),title=v==='room'?room().name:v==='house'?h.name:v==='isle'?state.isle.name:`Outside ${h.name}`,cap=Math.max(70,vb[2]/9);
 let bg=v==='isle'?`<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${state.isle.light==='night'?'#1f2d4a':'#bfe3ea'}"/><stop offset="1" stop-color="${state.isle.light==='night'?'#2c4a66':'#7fc3d3'}"/></linearGradient>`:v==='yard'?`<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${h.ext.light==='night'?'#2f3b5c':'#d6ebf3'}"/><stop offset="1" stop-color="${h.ext.light==='night'?'#5a6380':'#f4f7ea'}"/></linearGradient>`:`<radialGradient id="bg" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#fffdf8"/><stop offset="1" stop-color="#eaece1"/></radialGradient>`;
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb[0]} ${vb[1]} ${vb[2]} ${vb[3]+cap}" width="${vb[2]}" height="${vb[3]+cap}"><defs>${bg}</defs><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]+cap}" fill="url(#bg)"/>${sceneArt(true)}<text x="${vb[0]+vb[2]/2}" y="${vb[1]+vb[3]+cap*.42}" text-anchor="middle" font-family="Georgia,serif" font-size="${r1(cap*.36)}" fill="${(v==='yard'&&h.ext.light==='night')||(v==='isle'&&state.isle.light==='night')?'#fffaf0':'#37483f'}">${esc(title)}</text><text x="${vb[0]+vb[2]/2}" y="${vb[1]+vb[3]+cap*.74}" text-anchor="middle" font-family="Arial" letter-spacing="${r1(cap*.03)}" font-size="${r1(cap*.13)}" fill="${(v==='yard'&&h.ext.light==='night')||(v==='isle'&&state.isle.light==='night')?'#e6e9ef':'#4f6b62'}">✿ DESIGNED IN WILD BLOOM ISLES</text></svg>`;
 try{let img=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));img.src=url;await img.decode();let scale=Math.min(2.4,3200/vb[2]),c=document.createElement('canvas');c.width=Math.round(vb[2]*scale);c.height=Math.round((vb[3]+cap)*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
  c.toBlob(b=>{let a=document.createElement('a'),u=URL.createObjectURL(b);a.href=u;a.download=(title.replace(/[^\w ]+/g,'').trim()||'wild-bloom')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);hint('Picture saved! Look for it in your downloads.');},'image/png');}
 catch{hint('The picture could not be made in this browser. Try a screenshot instead.');}}
$('picture').onclick=savePicture;


// ---------- Cow, the island guide ----------
const COW_FACE=`<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="#fbeff2"/><path d="M19,19q-3,-8 3,-10M45,19q3,-8 -3,-10" stroke="#e8d3a0" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="13" cy="26" rx="8" ry="4.5" transform="rotate(-25 13 26)" fill="#fbf8f1" stroke="#c9b8a8"/><ellipse cx="51" cy="26" rx="8" ry="4.5" transform="rotate(25 51 26)" fill="#fbf8f1" stroke="#c9b8a8"/><ellipse cx="32" cy="32" rx="17" ry="18" fill="#fbf8f1" stroke="#c9b8a8"/><ellipse cx="25" cy="23" rx="6" ry="4.5" fill="#d9b48c"/><ellipse cx="32" cy="43" rx="13" ry="8.5" fill="#f5bfc8" stroke="#d99aa6"/><circle cx="27.5" cy="43" r="1.8" fill="#9c5f6a"/><circle cx="36.5" cy="43" r="1.8" fill="#9c5f6a"/><circle cx="25.5" cy="31" r="2.6" fill="#2d2a28"/><circle cx="38.5" cy="31" r="2.6" fill="#2d2a28"/><circle cx="26.3" cy="30.2" r=".9" fill="#fff"/><circle cx="39.3" cy="30.2" r=".9" fill="#fff"/><ellipse cx="19.5" cy="37" rx="3" ry="2" fill="#f2a7b5"/><ellipse cx="44.5" cy="37" rx="3" ry="2" fill="#f2a7b5"/></svg>`;
let guideLog=[],guideView='',guideAll=false;
function greeting(){let v=view(),h=home();return v==='room'?`Moo! We're inside ${room().name}. Want to add furniture, change the wallpaper or paint a picture?`:v==='house'?`This is all of ${h.name}! You can add rooms here and make them any size you like.`:v==='yard'?`Ahh, fresh air! Let's make the outside of ${h.name} beautiful.`:`Welcome to ${state.isle.name}! Every home you build lives here with me. What should we make?`;}
function cowSay(text,act){guideLog.push({who:'cow',text,act});if(guideLog.length>10)guideLog.splice(0,guideLog.length-10);}
function openGuide(){let first=!guideLog.length;if(first){let seen=false;try{seen=!!localStorage.getItem(GUIDE_KEY);localStorage.setItem(GUIDE_KEY,'1');}catch{}if(!seen)cowSay(`Hi! It's me, Cow. I only just learned to talk, and now I get to be your guide! We live on an island, and every home you build gets its own spot.`,'isle');}
 if(guideView!==view()){cowSay(greeting());guideView=view();}$('guide').hidden=false;$('ask-cow').hidden=true;renderGuide();if(matchMedia('(pointer:fine)').matches)$('guide-q').focus();}
function closeGuide(){$('guide').hidden=true;$('ask-cow').hidden=false;}
function matchGuide(q){let t=' '+q.toLowerCase().replace(/[^a-z0-9 ']/g,' ').replace(/\s+/g,' ')+' ',best=null,top=0;for(let f of GUIDE){if(f.q.toLowerCase()===q.toLowerCase())return f;let score=0;for(let k of f.keys)if(t.includes(k.includes(' ')?k:' '+k))score+=k.length>5||k.includes(' ')?2:1;if(f.views.includes(view()))score+=score?.5:0;if(score>top){top=score;best=f;}}return best;}
function answer(f){if(f.act==='idea'){idea=PROMPTS[Math.floor(Math.random()*PROMPTS.length)];cowSay(`Ooh, how about this: ${idea.charAt(0).toLowerCase()+idea.slice(1)}! I put it on the left too, under Need an idea.`);renderSide();return;}cowSay(f.a,f.act&&!(f.act===view())?f.act:null);}
function ask(q){q=q.trim();if(!q)return;guideLog.push({who:'kid',text:q});let f=matchGuide(q);if(f)answer(f);else cowSay(`Moo... I'm not sure about that one yet. Try asking a different way, or tap one of the questions below!`);renderGuide();}
const ACT_LABEL={room:'Take me inside',house:'Show me the whole house',yard:'Take me outside',isle:'Show me the island',finishes:'Show me',art:'Open the easel',newhome:'Build a new home'};
function doGuide(a){let small=window.innerWidth<700;
 if(['room','house','yard','isle'].includes(a))setView(a);
 if(a==='finishes'){setView('room');setTimeout(()=>$('walls-section')?.scrollIntoView({behavior:'smooth',block:'start'}),50);}
 if(a==='art'){setView('room');closeGuide();openArt();return;}
 if(a==='newhome'){closeGuide();openName('new-home');return;}
 if(small)closeGuide();else{cowSay(greeting());guideView=view();renderGuide();}}
function renderGuide(){$('guide-chat').innerHTML=guideLog.map(m=>`<div class="bubble ${m.who}">${esc(m.text)}${m.act?`<button class="show" data-guide-act="${m.act}">${ACT_LABEL[m.act]} →</button>`:''}</div>`).join('');$('guide-chat').scrollTop=1e6;
 let list=guideAll?GUIDE:GUIDE.filter(f=>f.views.includes(view())).slice(0,6);$('guide-chips').innerHTML=list.map(f=>`<button data-guide-q="${esc(f.q)}">${esc(f.q)}</button>`).join('')+`<button class="more" data-guide-more="1">${guideAll?'Fewer questions':'More questions…'}</button>`;}
$('ask-cow').innerHTML=COW_FACE+'<span>Ask Cow</span>';$('guide-face').innerHTML=COW_FACE;
$('ask-cow').onclick=()=>openGuide();$('guide-close').onclick=closeGuide;
$('guide-form').onsubmit=e=>{e.preventDefault();ask($('guide-q').value);$('guide-q').value='';};
$('guide').addEventListener('click',e=>{let b=e.target.closest('button');if(!b)return;if(b.dataset.guideQ){ask(b.dataset.guideQ);}if(b.dataset.guideAct)doGuide(b.dataset.guideAct);if(b.dataset.guideMore){guideAll=!guideAll;renderGuide();}});

// ---------- start ----------
state=load();style=room().wall;if(state.view==='room')category='room';
render();save();
try{if(!localStorage.getItem(GUIDE_KEY))setTimeout(openGuide,600);}catch{}
