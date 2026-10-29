'use strict';
// Wild Bloom Isles: the drawing. Everything is isometric SVG built from simple shapes.
// P(x,y,z) turns a spot on the floor (x,y in squares) and a height (z) into a point on screen.
let OX=0,OY=0,ART_CTX={art:null,bg:'#fffaf0',night:false};
const r1=n=>Math.round(n*10)/10;
function P(x,y,z=0){x+=OX;y+=OY;return [r1(500+(x-y)*42),r1(220+(x+y)*22-z)];}
function withOffset(x,y,fn){let a=OX,b=OY;OX=x;OY=y;try{return fn();}finally{OX=a;OY=b;}}
const palette=id=>STYLES.find(s=>s.id===id)||STYLES[0];
const ART_W=516,ART_H=300;
function dims(i){let t=TYPES[i.type];return i.rot?[t.d,t.w]:[t.w,t.d];}
function poly(points,fill,stroke='#6e665338',extra=''){return `<polygon points="${points.map(p=>p.join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" ${extra.includes('stroke-width')?'':'stroke-width="1"'} stroke-linejoin="round" ${extra}/>`;}
function line(a,b,color,width=1,extra=''){return `<path d="M${a.join(',')}L${b.join(',')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" ${extra}/>`;}
function tint(c,n){return '#'+c.slice(1,7).match(/../g).map(h=>Math.max(0,Math.min(255,parseInt(h,16)+n)).toString(16).padStart(2,'0')).join('');}
function lum(c){let [r,g,b]=c.slice(1,7).match(/../g).map(h=>parseInt(h,16));return .299*r+.587*g+.114*b;}
function rounded(points,fill,stroke='#6e665350',radius=6){
 const near=(a,b)=>{let d=Math.hypot(b[0]-a[0],b[1]-a[1]),t=Math.min(.35,radius/(d||1));return [r1(a[0]+(b[0]-a[0])*t),r1(a[1]+(b[1]-a[1])*t)];};
 let path='';for(let j=0;j<points.length;j++){let v=points[j],a=near(v,points[(j+points.length-1)%points.length]),b=near(v,points[(j+1)%points.length]);path+=(j?'L':'M')+a+'Q'+v+' '+b;}return `<path d="${path}Z" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
}
function blossom(p,r,color,center='#ddbd78'){let out='';for(let a=0;a<5;a++){let angle=a*Math.PI*2/5,x=r1(p[0]+Math.cos(angle)*r*.6),y=r1(p[1]+Math.sin(angle)*r*.6);out+=`<ellipse cx="${x}" cy="${y}" rx="${r1(r*.63)}" ry="${r1(r*.4)}" transform="rotate(${a*72} ${x} ${y})" fill="${color}"/>`;}return out+`<circle cx="${p[0]}" cy="${p[1]}" r="${r1(r*.18)}" fill="${center}"/>`;}
function star(p,r,color){let pts=[];for(let k=0;k<10;k++){let a=-Math.PI/2+k*Math.PI/5,rr=k%2?r*.45:r;pts.push([r1(p[0]+Math.cos(a)*rr),r1(p[1]+Math.sin(a)*rr)]);}return poly(pts,color,'none');}
function heart(p,s,color){let [x,y]=p;return `<path d="M${x} ${r1(y+s*.9)}C${r1(x-s*1.3)} ${y} ${r1(x-s*.9)} ${r1(y-s*.9)} ${x} ${r1(y-s*.35)}C${r1(x+s*.9)} ${r1(y-s*.9)} ${r1(x+s*1.3)} ${y} ${x} ${r1(y+s*.9)}Z" fill="${color}"/>`;}
// An image laid onto a flat plane: p0 is its top-left corner, px its top-right, py its bottom-left.
function planeImage(href,p0,px,py,W,H){return `<image href="${href}" width="${W}" height="${H}" preserveAspectRatio="none" transform="matrix(${[(px[0]-p0[0])/W,(px[1]-p0[1])/W,(py[0]-p0[0])/H,(py[1]-p0[1])/H,p0[0],p0[1]].map(n=>Math.round(n*1e4)/1e4).join(' ')})"/>`;}
function defaultPainting(pt,x0,x1,z0,z1,s){let X=t=>x0+(x1-x0)*t,Z=t=>z0+(z1-z0)*t;return poly([pt(X(.1),Z(.1)),pt(X(.9),Z(.1)),pt(X(.5),Z(.85))],s.fabric)+poly([pt(X(.55),Z(.1)),pt(X(.9),Z(.1)),pt(X(.75),Z(.6))],s.accent);}

function furniture(i,selection=false){let s={...palette(i.style),...(i.fabric?{fabric:i.fabric}:{})},t=TYPES[i.type],out='',w=t.w,d=t.d,ty=i.type;
const point=(x,y,z=0)=>i.rot?P(i.x+y,i.y+w-x,z):P(i.x+x,i.y+y,z);
// A box has two visible sides. When a piece is turned, its left side faces you instead of its right.
const box=(x,y,a,b,z,h,c)=>{let sx=i.rot?x:x+a;out+=poly([point(sx,y,z),point(sx,y+b,z),point(sx,y+b,z+h),point(sx,y,z+h)],tint(c,i.rot?-10:-24));out+=poly([point(x,y+b,z),point(x+a,y+b,z),point(x+a,y+b,z+h),point(x,y+b,z+h)],tint(c,i.rot?-24:-10));out+=poly([point(x,y,z+h),point(x+a,y,z+h),point(x+a,y+b,z+h),point(x,y+b,z+h)],tint(c,14));};
const block=box;
const soft=(x,y,a,b,z,h,c,rad=6)=>{
 let sx=i.rot?x:x+a;out+=rounded([point(sx,y,z),point(sx,y+b,z),point(sx,y+b,z+h),point(sx,y,z+h)],tint(c,i.rot?-8:-22),tint(c,-30),rad);
 out+=rounded([point(x,y+b,z),point(x+a,y+b,z),point(x+a,y+b,z+h),point(x,y+b,z+h)],tint(c,i.rot?-22:-8),tint(c,-28),rad);
 out+=rounded([point(x,y,z+h),point(x+a,y,z+h),point(x+a,y+b,z+h),point(x,y+b,z+h)],tint(c,14),tint(c,-10),rad);
};
const pillow=(x,y,z,c)=>{let p1=point(x,y,z),p2=point(x+.5,y,z+2),p3=point(x+.55,y,z+24),p4=point(x-.04,y,z+23);out+=rounded([p1,p2,p3,p4],c,tint(c,-25),8);out+=line(point(x+.07,y+.01,z+5),point(x+.43,y+.01,z+7),tint(c,24),1);};
const dot=(x,y,z,r,c,stroke='#66564244')=>{let p=point(x,y,z);out+=`<circle cx="${p[0]}" cy="${p[1]}" r="${r}" fill="${c}" stroke="${stroke}"/>`;};
const leg=(x,y,h=16)=>box(x,y,.12,.12,0,h,s.wood);
// A round thing (pouf, pot, pool): r is its radius in squares.
const drum=(cx,cy,z,r,h,c)=>{let p=point(cx,cy,z),q=point(cx,cy,z+h),rx=r1(r*59.4),ry=r1(r*31.1);out+=`<ellipse cx="${p[0]}" cy="${p[1]}" rx="${rx}" ry="${ry}" fill="${tint(c,-24)}" stroke="${tint(c,-34)}" stroke-width=".8"/><rect x="${r1(p[0]-rx)}" y="${q[1]}" width="${r1(rx*2)}" height="${r1(p[1]-q[1])}" fill="${tint(c,-12)}"/><ellipse cx="${q[0]}" cy="${q[1]}" rx="${rx}" ry="${ry}" fill="${tint(c,12)}" stroke="${tint(c,-20)}" stroke-width=".8"/>`;};
const ell=(x,y,z,rx,ry,c,extra='')=>{let p=point(x,y,z);out+=`<ellipse cx="${p[0]}" cy="${p[1]}" rx="${rx}" ry="${ry}" fill="${c}" ${extra}/>`;};
const front=(x,a,z,h,c,y=d)=>block(x,y-.02,a,.04,z,h,c);
const legs=(h,inset=.12)=>{leg(inset,inset,h);leg(w-inset-.12,inset,h);leg(inset,d-inset-.12,h);leg(w-inset-.12,d-inset-.12,h);};
const leaves=(x,y,z,n,c,size=1)=>{for(let k=0;k<n;k++){let p=point(x,y,z+k*6*size),side=k%2?1:-1,dy=k%3*4*size;out+=`<path d="M${p}q${r1(side*11*size)},-${r1((22+dy)*size)} ${r1(side*31*size)},-${r1((17+dy)*size)}q${r1(side*4*size)},${r1(22*size)} ${r1(-side*31*size)},${r1((17+dy)*size)}" fill="${k%2?c:tint(c,16)}" stroke="#627c5966"/>`;}};
const flowersAt=(x,y,z,cols,n=7,spread=1)=>{let base=point(x,y,z),offs=[[-18,-30],[0,-40],[17,-32],[-9,-20],[10,-22],[-25,-14],[24,-16]];for(let k=0;k<n;k++){let [dx,dy]=offs[k%7],tip=[r1(base[0]+dx*spread),r1(base[1]+dy*spread)];out+=line(base,tip,'#6f8f5e',1.3);}for(let k=0;k<n;k++){let [dx,dy]=offs[k%7];out+=blossom([r1(base[0]+dx*spread),r1(base[1]+dy*spread)],7*spread+(k%2),cols[k%cols.length]);}};
let [a,b]=dims(i);if(!t.flat)out+=poly([P(i.x+.1,i.y+.1),P(i.x+a+.15,i.y+.1),P(i.x+a+.15,i.y+b+.15),P(i.x+.1,i.y+b+.15)],'#44443813','none');
const cream='#f7f4ee',metal='#c3c8cc',dark='#2b3040',bloomCols=[s.fabric,'#f7d8dd','#f2cf63',tint(s.fabric,28),'#ef8f7d'];

if(ty==='rug'){box(0,0,w,d,0,2,s.fabric);out+=poly([point(.15,.15,3),point(w-.15,.15,3),point(w-.15,d-.15,3),point(.15,d-.15,3)],'none',s.trim,'stroke-width="3"');for(let k=.3;k<w;k+=.3){out+=line(point(k,0,3),point(k,-.12,3),s.trim,2);out+=line(point(k,d,3),point(k,d+.12,3),s.trim,2);}for(let k=.6;k<w;k+=.65){out+=poly([point(k,1,3),point(k+.25,1.5,3),point(k,2,3),point(k-.25,1.5,3)],s.accent);}}
if(ty==='sofa'||ty==='chair'){
 let low=s.id==='sakura',h=low?10:19,bh=s.id==='victorian'?55:s.id==='deco'?48:40;
 leg(.15,.15,h);leg(w-.25,.15,h);leg(.15,d-.25,h);leg(w-.25,d-.25,h);soft(0,0,w,d,h,11,s.wood,3);
 soft(.06,0,w-.12,.32,h+9,bh,s.fabric,12);
 if(s.id==='victorian'){for(let x=.35;x<w-.15;x+=.35)for(let z=h+25;z<h+bh;z+=13){out+=line(point(x-.17,.33,z-6),point(x+.17,.33,z+6),tint(s.fabric,-23),.8);out+=line(point(x+.17,.33,z-6),point(x-.17,.33,z+6),tint(s.fabric,-23),.8);dot(x,.34,z,1.7,s.accent);}}
 if(s.id==='deco')for(let x=.25;x<w-.1;x+=.25)out+=line(point(x,.33,h+19),point(x,.33,h+bh+3),s.accent,1.2);
 if(s.id==='boho')for(let x=.2;x<w;x+=.14)out+=line(point(x,.33,h+15),point(x,.33,h+bh),s.trim,.7);
 for(let x=.29;x<w-.29;x+=.81)soft(x,.35,Math.min(.77,w-.29-x),d-.42,h+12,14,s.fabric,7);
 pillow(.4,.48,h+24,s.accent);if(w>2)pillow(w-.95,.46,h+25,s.trim);
 soft(0,.12,.25,d-.12,h+9,s.id==='victorian'?34:27,s.fabric,9);soft(w-.25,.12,.25,d-.12,h+9,s.id==='victorian'?34:27,s.fabric,9);
 if(s.id==='sakura'||s.id==='mid')for(let y=.2;y<d;y+=.22){out+=line(point(w,y,h+12),point(w,y,h+31),s.wood,2);}
}
if(ty==='table'){let h=s.id==='sakura'?18:30;legs(h,.15);soft(0,0,w,d,h,6,i.fabric||(s.id==='deco'?s.trim:s.wood),s.id==='mid'||s.id==='nordic'?22:7);box(.35,.3,.55,.5,h+6,4,s.accent);box(.4,.32,.55,.5,h+10,3,s.trim);dot(1.45,.65,h+10,7,s.fabric);dot(1.45,.65,h+13,5,s.trim);}
if(ty==='console'){let h=s.id==='mid'?42:60;legs(14,.1);box(0,0,w,d,14,h,s.wood);box(-.05,-.03,w+.1,d+.06,h+14,4,s.id==='deco'?s.trim:s.wood);for(let x=.1;x<w-.1;x+=.8){box(x,d-.025,.7,.04,20,h-10,i.fabric||(s.id==='boho'?s.trim:s.wood));dot(x+.35,d+.035,h/2+15,2,s.accent);}box(.3,.2,.6,.4,h+18,5,s.fabric);box(.35,.2,.6,.4,h+23,4,s.trim);dot(1.9,.5,h+30,9,s.accent);}
if(ty==='bed'){leg(.1,.1);leg(w-.2,.1);leg(.1,d-.2);leg(w-.2,d-.2);box(0,0,w,d,14,12,s.wood);box(0,0,w,.2,22,65,s.wood);soft(.1,.25,w-.2,d-.35,26,14,s.trim,8);soft(.1,1,w-.2,d-1.1,40,6,s.fabric,6);soft(.25,.4,.85,.6,40,9,s.trim,9);soft(1.4,.4,.85,.6,40,9,s.trim,9);box(.1,d-.7,w-.2,.45,46,2,s.accent);if(s.id==='victorian'){for(let x of [0,w-.12])for(let y of [0,d-.12]){box(x,y,.12,.12,0,140,s.wood);dot(x+.06,y+.06,143,4,s.accent);}box(0,0,w,.15,138,5,s.wood);box(0,0,.15,d,138,5,s.wood);box(w-.15,0,.15,d,138,5,s.wood);}}
if(ty==='lamp'){
 let p=point(.375,.375,0);out+=`<ellipse cx="${p[0]}" cy="${p[1]}" rx="16" ry="7" fill="${s.wood}"/>`;
 out+=line(point(.375,.375,3),point(.375,.375,93),s.accent,3);
 let c=point(.375,.375,88);
 if(ART_CTX.night)out+=`<circle cx="${c[0]}" cy="${c[1]}" r="48" fill="#ffe7a3" opacity=".35"/>`;
 if(s.id==='sakura'||s.id==='boho'){
  out+=`<ellipse cx="${c[0]}" cy="${c[1]}" rx="21" ry="27" fill="${i.fabric||s.trim}" stroke="${s.wood}" stroke-width="1.2"/>`;
  for(let y=-18;y<=18;y+=6){let rx=r1(21*Math.sqrt(1-y*y/729));out+=`<path d="M${r1(c[0]-rx)},${c[1]+y}q${rx},6 ${r1(rx*2)},0" fill="none" stroke="${s.wood}" stroke-opacity=".4" stroke-width=".8"/>`;}
 }else{
  out+=rounded([[c[0]-14,c[1]-22],[c[0]+14,c[1]-22],[c[0]+24,c[1]+13],[c[0]-24,c[1]+13]],i.fabric||s.trim,s.wood,3);
  out+=`<ellipse cx="${c[0]}" cy="${c[1]+13}" rx="24" ry="5" fill="${tint(i.fabric||s.trim,-18)}"/>`;
  if(s.id==='deco')for(let k=-12;k<=12;k+=6)out+=line([c[0]+k,c[1]-19],[c[0]+k*1.5,c[1]+11],s.accent,1);
 }
}
if(ty==='plant'){let p=point(.38,.38,0);out+=`<path d="M${p[0]-15},${p[1]-24}q15,-7 30,0l-4,22q-11,8 -22,0Z" fill="${s.fabric}" stroke="${tint(s.fabric,-28)}"/><ellipse cx="${p[0]}" cy="${p[1]-24}" rx="15" ry="5" fill="${s.wood}"/>`;out+=line(point(.38,.38,20),point(.38,.38,88),s.wood,2);leaves(.38,.38,31,9,s.accent);}
if(ty==='ottoman'){drum(.5,.5,0,.36,6,s.wood);drum(.5,.5,6,.42,24,s.fabric);ell(.5,.5,30,22,11,'none',`stroke="${s.trim}" stroke-width="2"`);dot(.5,.5,30,2.5,s.accent);if(s.id==='victorian')for(let k=0;k<6;k++){let a=k*Math.PI/3;dot(.5+Math.cos(a)*.22,.5+Math.sin(a)*.22,30,1.6,s.accent);}}
if(ty==='flowers'){drum(.375,.375,0,.22,34,s.wood);drum(.375,.375,34,.3,4,s.id==='deco'?s.trim:s.wood);drum(.375,.375,38,.12,20,i.fabric?s.trim:s.fabric);leaves(.375,.375,52,4,'#7f9f6c',.55);flowersAt(.375,.375,58,i.fabric?[i.fabric,tint(i.fabric,30),'#f2cf63']:bloomCols);}
if(ty==='bookshelf'){let wood=i.fabric||s.wood;block(0,0,w,d,0,112,wood);let books=[s.fabric,s.accent,s.trim,tint(s.fabric,-30),tint(s.accent,25),'#8fb6d8','#f2cf63'],widths=[.14,.1,.18,.12,.16,.1,.2,.13],hts=[24,20,27,22,25,19];let n=0;for(let z of [8,42,76]){front(0,w,z-4,4,tint(wood,10));let x=.1;while(x<w-.2){let bw=widths[n%widths.length],bh=hts[n%hts.length];if(n%9!==4)front(x,bw,z,bh,books[n%books.length],d+.02);x+=bw+.02;n++;}}drum(1.6,.35,112,.11,12,s.fabric);leaves(1.6,.35,124,3,s.accent,.5);box(.3,.2,.5,.35,112,5,s.trim);box(.32,.2,.5,.35,117,4,s.accent);}
if(ty==='nightstand'){legs(10,.06);block(0,0,w,d,10,30,s.wood);front(.08,w-.16,15,12,tint(s.wood,12));dot(.375,d+.03,21,2,s.accent);let c=point(.375,.375,40);out+=line(c,point(.375,.375,60),s.accent,2);out+=rounded([[c[0]-8,c[1]-30],[c[0]+8,c[1]-30],[c[0]+13,c[1]-16],[c[0]-13,c[1]-16]],i.fabric||s.trim,s.wood,2);if(ART_CTX.night)out+=`<circle cx="${c[0]}" cy="${c[1]-22}" r="26" fill="#ffe7a3" opacity=".35"/>`;}
if(ty==='wardrobe'){let c=i.fabric||s.wood;block(0,0,w,d,4,150,c);box(-.04,-.03,w+.08,d+.06,154,6,s.id==='deco'?s.trim:tint(c,8));front(.08,w/2-.12,12,134,tint(c,10));front(w/2+.04,w/2-.12,12,134,tint(c,10));dot(w/2-.1,d+.03,80,2.5,s.accent);dot(w/2+.1,d+.03,80,2.5,s.accent);if(s.id==='victorian'||s.id==='deco')for(let x of [.3,w/2+.25])front(x,w/2-.55,30,96,tint(c,2),d+.03);}
if(ty==='counter'||ty==='sink'){let cab=i.fabric||(s.id==='deco'?s.fabric:tint(s.trim,-14)),top=s.id==='deco'?'#2f3a3a':'#efe8dc';block(0,0,w,d,0,52,cab);box(-.03,-.03,w+.06,d+.06,52,5,top);let n=Math.round(w/.95);for(let k=0;k<n;k++){let dw=(w-.12)/n;front(.06+k*dw+.03,dw-.06,6,40,tint(cab,8));dot(.06+k*dw+dw/2,d+.04,40,1.8,s.id==='deco'?s.accent:metal);}
 if(ty==='sink'){out+=poly([point(.35,.22,57.5),point(w-.35,.22,57.5),point(w-.35,d-.25,57.5),point(.35,d-.25,57.5)],'#c9d5d8',tint(top,-30));out+=line(point(w/2,.12,57),point(w/2,.12,80),metal,3);out+=line(point(w/2,.12,80),point(w/2,.38,77),metal,3);}
 else{dot(.5,.5,60,6,'#ef8f7d');dot(.62,.42,62,5,'#f2cf63');dot(.45,.35,63,5,'#a8d5ba');box(1.3,.25,.3,.3,57,22,s.fabric);box(1.3,.25,.3,.3,79,3,s.trim);}}
if(ty==='stove'){let body=i.fabric||cream;block(0,0,w,d,0,52,body);box(-.02,-.02,w+.04,d+.04,52,4,'#3b3e44');for(let [x,y] of [[.27,.27],[.73,.27],[.27,.73],[.73,.73]])ell(x,y,56.5,9,4.6,'#2a2c31',`stroke="${ART_CTX.night?'#ef8f7d':'#5c5f66'}" stroke-width="1.5"`);front(.12,.76,8,34,tint(body,-6));front(.25,.5,15,20,'#3b3e44',d+.02);out+=line(point(.2,d+.05,40),point(.8,d+.05,40),metal,2.5);box(0,0,w,.12,56,14,tint(body,-4));}
if(ty==='fridge'){let body=i.fabric||'#eef1ee';block(0,0,w,d,0,130,body);out+=line(point(0,d+.01,88),point(w,d+.01,88),tint(body,-40),1.5);front(.82,.06,92,30,metal,d+.02);front(.82,.06,40,40,metal,d+.02);dot(.25,d+.03,110,3,'#ef8f7d');dot(.45,d+.03,104,3,'#f2cf63');dot(.3,d+.03,60,3,s.fabric);dot(.55,d+.03,66,3.5,'#8fb6d8');}
if(ty==='stool'){for(let [x,y] of [[.15,.15],[.53,.15],[.15,.53],[.53,.53]])box(x,y,.07,.07,0,34,s.wood);box(.15,.15,.45,.45,14,2,s.wood);drum(.375,.375,34,.3,6,s.fabric);}
if(ty==='tub'){let body=i.fabric||cream;for(let [x,y] of [[.2,.2],[w-.3,.2],[.2,d-.3],[w-.3,d-.3]])dot(x,y,3,3.5,s.accent);soft(0,0,w,d,6,38,body,14);out+=rounded([point(.18,.18,44.5),point(w-.18,.18,44.5),point(w-.18,d-.18,44.5),point(.18,d-.18,44.5)],'#a8d4e6','#7fb3c8',14);for(let [x,y,r] of [[.7,.5,6],[.95,.42,4],[1.2,.62,5],[1.6,.55,6],[1.85,.75,4]])dot(x,y,46,r,'#ffffffdd','#b6d6e2');out+=line(point(.15,d/2,44),point(.15,d/2,64),metal,3);out+=line(point(.15,d/2,64),point(.35,d/2,62),metal,3);}
if(ty==='toilet'){let body=i.fabric||cream;block(.1,0,.55,.3,26,36,body);box(.08,-.02,.59,.34,62,4,tint(body,6));drum(.375,.62,0,.2,26,body);ell(.375,.62,26.5,15,8,tint(body,10),`stroke="${tint(body,-30)}"`);ell(.375,.62,27,9,4.5,'#cfe3ea');dot(.5,.3,52,2,metal);}
if(ty==='vanity'){let cab=i.fabric||s.wood;block(0,0,w,d,0,44,cab);box(-.03,-.03,w+.06,d+.06,44,4,cream);ell(w/2,d/2,48.5,15,7,'#dfe9ec',`stroke="${tint(cream,-30)}"`);out+=line(point(w/2,.1,48),point(w/2,.1,64),metal,3);out+=line(point(w/2,.1,64),point(w/2,.26,62),metal,3);front(.1,w/2-.15,6,32,tint(cab,10));front(w/2+.05,w/2-.15,6,32,tint(cab,10));dot(w/2-.12,d+.03,24,1.8,s.accent);dot(w/2+.12,d+.03,24,1.8,s.accent);}
if(ty==='mat'){let c=i.fabric||s.accent;soft(0,0,w,d,0,3,c,10);for(let x=.25;x<w-.1;x+=.25)out+=line(point(x,.12,3.5),point(x,d-.12,3.5),tint(c,22),2);}
if(ty==='arcade'){let c=i.fabric||'#6c4ea3';block(0,0,w,d,0,118,c);box(0,-.02,w,d+.04,118,6,tint(c,-20));front(.1,.8,70,38,dark,d+.03);for(let k=0;k<6;k++)dot(.2+k*.12,d+.06,90+((k*7)%3)*6,2.2,['#f2cf63','#ef8f7d','#a8d5ba','#8fb6d8','#f7d8dd','#c2456b'][k],'none');box(.05,d-.25,.9,.35,54,10,tint(c,-12));dot(.3,d-.05,64,3.5,'#c2456b');dot(.6,d-.05,64,2.5,'#f2cf63');dot(.75,d-.05,64,2.5,'#8fb6d8');front(.1,.8,108,9,'#f2cf63',d+.04);}
if(ty==='gametable'){legs(34,.2);box(0,0,w,d,34,5,s.wood);let green=i.fabric||'#3f8c6e';out+=poly([point(.08,.08,39.5),point(w-.08,.08,39.5),point(w-.08,d-.08,39.5),point(.08,d-.08,39.5)],green,'#ffffff','stroke-width="2"');out+=line(point(.12,d/2,40),point(w-.12,d/2,40),'#ffffffaa',1);box(w/2-.02,0,.04,d,40,9,'#f7f4eedd');dot(.7,.5,40,5,'#c2456b');dot(w-.7,d-.5,40,5,dark);dot(1,1.1,46,2.5,'#ffffff');}
if(ty==='beanbag'){let c=i.fabric||s.fabric,p=point(.62,.62,0);out+=`<ellipse cx="${p[0]}" cy="${p[1]-10}" rx="36" ry="18" fill="${tint(c,-18)}"/><path d="M${p[0]-34},${p[1]-12}q2,-30 30,-34q32,-2 38,26q-36,18 -68,8Z" fill="${c}" stroke="${tint(c,-30)}"/><ellipse cx="${p[0]+2}" cy="${p[1]-22}" rx="15" ry="7" fill="${tint(c,-14)}"/><path d="M${p[0]-20},${p[1]-36}q10,-4 18,0" stroke="${tint(c,24)}" fill="none" stroke-width="2"/>`;}
if(ty==='tv'){legs(8,.1);block(0,0,w,d,8,30,s.wood);front(.12,w/2-.17,13,20,tint(s.wood,12));front(w/2+.05,w/2-.17,13,20,tint(s.wood,12));box(.85,.25,.3,.2,38,6,dark);block(.2,.28,1.6,.06,44,50,dark);front(.27,1.46,49,40,ART_CTX.night?'#8fb6d8':'#4d6f96',.36);out+=line(point(.4,.37,80),point(.9,.37,65),'#ffffff55',3);}
if(ty==='rack'){let m=s.id==='deco'?s.accent:metal;box(0,0,w,d,0,5,s.wood);box(.05,.32,.08,.08,5,105,m);box(w-.13,.32,.08,.08,5,105,m);out+=line(point(.09,.36,108),point(w-.09,.36,108),m,3);let cols=[s.fabric,s.accent,'#f2cf63','#8fb6d8','#c2456b','#b9a3d6','#a8d5ba',s.trim];let k=0;for(let x=.3;x<w-.2;x+=.27,k++){let p=point(x,.36,106),c=i.fabric&&k%2?i.fabric:cols[k%cols.length],len=k%3===1?56:40;out+=`<path d="M${p[0]},${p[1]}l-4,6h8z" fill="none" stroke="${m}"/><path d="M${p[0]-9},${p[1]+6}h18l${k%3===1?6:3},${len}h-${k%3===1?30:24}z" fill="${c}" stroke="${tint(c,-30)}"/>`;}}
if(ty==='shoes'){let c=i.fabric||s.wood;block(0,0,w,d,0,60,c);let cols=['#c2456b','#f2cf63','#8fb6d8',s.fabric,'#3c4a6b','#ef8f7d','#a8d5ba',s.accent];let k=0;for(let z of [4,24,44]){front(0,w,z-2,2,tint(c,12),d+.01);for(let x=.08;x<w-.2;x+=.36,k++){let col=cols[k%cols.length];front(x,.13,z,9,col,d+.03);front(x+.15,.13,z,9,col,d+.03);}}}
if(ty==='mirror'){let c=i.fabric||s.wood,p=point(.5,.25,0),m=point(.5,.25,70);out+=line(point(.2,.4,0),m,c,3)+line(point(.8,.4,0),m,c,3)+line(point(.5,.05,0),m,c,3);out+=`<ellipse cx="${m[0]}" cy="${m[1]}" rx="17" ry="36" fill="#dfecf0" stroke="${c}" stroke-width="5"/><path d="M${m[0]-6},${m[1]-18}q-4,14 2,30" stroke="#ffffffcc" stroke-width="3" fill="none"/>`;}
if(ty==='lightmirror'){let c=i.fabric||s.trim;block(0,0,w,d,0,40,s.wood);box(-.02,-.02,w+.04,d+.04,40,3,c);block(.15,.05,w-.3,.06,43,60,c);out+=poly([point(.25,.12,48),point(w-.25,.12,48),point(w-.25,.12,98),point(.25,.12,98)],'#dfecf0',tint(c,-30));out+=line(point(.4,.12,90),point(.6,.12,60),'#ffffffaa',3);for(let x=.25;x<=w-.24;x+=(w-.5)/4)dot(x,.14,101,3,'#ffe7a3','#d6b45c');for(let z=55;z<98;z+=14){dot(.2,.14,z,2.6,'#ffe7a3','#d6b45c');dot(w-.2,.14,z,2.6,'#ffe7a3','#d6b45c');}dot(.4,.3,45,3,'#c2456b');dot(.55,.3,45,2.5,'#b9a3d6');}
if(ty==='salon'||ty==='dryer'){let c=i.fabric||s.fabric,cx=w/2;drum(cx,cx,0,.32,4,metal);drum(cx,cx,4,.07,20,metal);soft(.1,.1,w-.2,w-.2,24,11,c,8);soft(.12,.04,w-.24,.2,30,44,c,10);soft(.05,.15,.16,w-.25,28,22,c,6);soft(w-.21,.15,.16,w-.25,28,22,c,6);
 if(ty==='dryer'){out+=line(point(cx,.1,74),point(cx,.12,96),metal,3);let h=point(cx,.32,108);out+=`<ellipse cx="${h[0]}" cy="${h[1]}" rx="27" ry="20" fill="${cream}" stroke="${tint(cream,-40)}"/><ellipse cx="${h[0]+2}" cy="${h[1]+8}" rx="19" ry="8" fill="${tint(cream,-25)}"/><circle cx="${h[0]-14}" cy="${h[1]-8}" r="2.5" fill="${s.accent}"/>`;}}
if(ty==='nails'){legs(30,.08);box(0,0,w,d,30,5,i.fabric||s.trim);let cols=['#c2456b','#ef8f7d','#b9a3d6','#f2cf63','#a8d5ba'];cols.forEach((c,k)=>{box(.2+k*.17,.2,.09,.09,35,8,c);box(.215+k*.17,.215,.06,.06,43,5,dark);});ell(1.1,.5,35.5,11,5,'#f7f4ee',`stroke="${tint(s.trim,-30)}"`);dot(1.1,.5,36,2,'#c2456b');}
if(ty==='easel'){let c=i.fabric||s.wood,top=point(.5,.45,120);out+=line(point(.12,.8,0),top,c,3.5)+line(point(.88,.8,0),top,c,3.5)+line(point(.5,.1,0),top,tint(c,-15),3);box(.08,.52,.84,.1,44,5,c);
 let x0=.1,x1=.9,y=.56,z0=50,z1=108;out+=poly([point(x0-.03,y,z0-3),point(x1+.03,y,z0-3),point(x1+.03,y,z1+3),point(x0-.03,y,z1+3)],cream,tint(cream,-40));
 if(ART_CTX.art){out+=poly([point(x0,y+.01,z0),point(x1,y+.01,z0),point(x1,y+.01,z1),point(x0,y+.01,z1)],ART_CTX.bg,'none');out+=planeImage(ART_CTX.art,point(x0,y+.01,z1),point(x1,y+.01,z1),point(x0,y+.01,z0),ART_W,ART_H);}
 else out+=defaultPainting((x,z)=>point(x,y+.01,z),x0,x1,z0,z1,s);}
if(ty==='painttable'){legs(32,.1);box(0,0,w,d,32,5,i.fabric||s.wood);let cols=['#c2456b','#f2cf63','#8fb6d8','#a8d5ba','#b9a3d6'];cols.forEach((c,k)=>{drum(.3+k*.26,.3,37,.08,9,'#f7f4ee');ell(.3+k*.26,.3,46,4.6,2.4,c);});ell(1.3,.7,37.5,22,10,'#e8cfa4',`stroke="#b89a6c"`);cols.forEach((c,k)=>dot(1.15+k*.07,.62+(k%2)*.12,38,2.6,c,'none'));drum(1.75,.3,37,.09,14,s.accent);for(let k=0;k<3;k++)out+=line(point(1.75,.3,48),point(1.7+k*.05,.24,68),k?s.wood:'#c2456b',1.6);}
if(ty==='cow'){let c=point(w/2,d/2,0),spot=i.fabric||'#d9b48c',f=i.rot?-1:1;out+=`<g transform="translate(${c[0]} ${c[1]}) scale(${f} 1)"><ellipse cx="0" cy="2" rx="40" ry="9" fill="#44443818"/>`+[[-26,1],[-15,0],[12,1],[21,0]].map(([x,k])=>`<rect x="${x}" y="-24" width="7" height="24" rx="3" fill="${k?'#efe9de':'#fbf8f1'}" stroke="#8a7d7066"/><rect x="${x}" y="-5" width="7" height="5" rx="2" fill="#6b5a52"/>`).join('')+`<path d="M-35,-42q-13,6 -9,22" fill="none" stroke="#8a7d70" stroke-width="2"/><circle cx="-44" cy="-20" r="3.5" fill="${spot}"/><rect x="-37" y="-55" width="64" height="35" rx="17" fill="#fbf8f1" stroke="#8a7d7088"/><ellipse cx="-19" cy="-42" rx="9" ry="7" fill="${spot}"/><ellipse cx="5" cy="-48" rx="7" ry="5" fill="${spot}"/><ellipse cx="-4" cy="-32" rx="5" ry="4" fill="${spot}"/><ellipse cx="-6" cy="-20" rx="6" ry="3.2" fill="#f2b8c2"/><path d="M25,-66q-2,-7 3,-9M42,-66q2,-7 -3,-9" stroke="#e8d3a0" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="21" cy="-62" rx="8" ry="3.8" transform="rotate(-25 21 -62)" fill="#fbf8f1" stroke="#8a7d7066"/><ellipse cx="47" cy="-61" rx="8" ry="3.8" transform="rotate(25 47 -61)" fill="#fbf8f1" stroke="#8a7d7066"/><ellipse cx="34" cy="-53" rx="14" ry="15" fill="#fbf8f1" stroke="#8a7d7088"/><ellipse cx="29" cy="-61" rx="5" ry="3.6" fill="${spot}"/><ellipse cx="36" cy="-42" rx="12" ry="8" fill="#f5bfc8" stroke="#c98d9866"/><circle cx="32" cy="-42" r="1.7" fill="#9c5f6a"/><circle cx="40" cy="-42" r="1.7" fill="#9c5f6a"/><circle cx="29" cy="-54" r="2.3" fill="#2d2a28"/><circle cx="40" cy="-54" r="2.3" fill="#2d2a28"/><circle cx="29.8" cy="-54.8" r=".8" fill="#fff"/><circle cx="40.8" cy="-54.8" r=".8" fill="#fff"/><ellipse cx="24" cy="-47" rx="3" ry="2" fill="#f2a7b5"/><ellipse cx="46" cy="-47" rx="3" ry="2" fill="#f2a7b5"/><circle cx="25" cy="-34" r="3.6" fill="#e2b44d" stroke="#a9832f"/></g>`;}
if(ty==='cat'){let c=point(.375,.375,0),fur=i.fabric||'#e5a15e';out+=`<ellipse cx="${c[0]}" cy="${c[1]-4}" rx="24" ry="10" fill="${s.fabric}" stroke="${tint(s.fabric,-25)}"/><path d="M${c[0]+14},${c[1]-10}q14,-2 10,-12" stroke="${fur}" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="${c[0]+2}" cy="${c[1]-14}" rx="16" ry="10" fill="${fur}" stroke="${tint(fur,-35)}"/><path d="M${c[0]-6},${c[1]-14}q8,6 18,-2" stroke="${tint(fur,-30)}" fill="none"/><circle cx="${c[0]-11}" cy="${c[1]-19}" r="8" fill="${fur}" stroke="${tint(fur,-35)}"/><path d="M${c[0]-18},${c[1]-24}l1,-8l6,5zM${c[0]-8},${c[1]-26}l4,-7l3,7z" fill="${fur}" stroke="${tint(fur,-35)}"/><path d="M${c[0]-15},${c[1]-19}q2,2 4,0M${c[0]-9},${c[1]-19}q2,2 4,0" stroke="#3a2e28" fill="none" stroke-width="1.1"/><text x="${c[0]-2}" y="${c[1]-34}" font-size="9" font-family="Georgia" fill="#8a8577">z</text><text x="${c[0]+5}" y="${c[1]-42}" font-size="7" font-family="Georgia" fill="#8a8577">z</text>`;}
if(ty==='fence'){let c=i.fabric||'#fffaf0';block(0,.1,w,.05,12,4,tint(c,-10));block(0,.1,w,.05,30,4,tint(c,-10));for(let x=.04;x<w-.1;x+=.24){block(x,.15,.14,.06,0,42,c);out+=poly([point(x,.21,42),point(x+.14,.21,42),point(x+.07,.21,50)],tint(c,-10));}}
if(ty==='hedge'){let c=i.fabric||'#6f9a5c';box(.04,.06,w-.08,d-.12,0,28,c);for(let k=0;k<4;k++){let p=point(.14+k*.24,d/2,30);out+=`<circle cx="${p[0]}" cy="${p[1]}" r="11" fill="${tint(c,k%2?6:-4)}" stroke="${tint(c,-26)}" stroke-width=".8"/>`;}for(let k=0;k<6;k++)dot(.12+k*.15,d-.05,10+(k%3)*7,2.2,tint(c,22),'none');}
if(ty==='path'){let c=i.fabric||'#d2cbbd';for(let [x,y,rx,ry] of [[.3,.32,14,7],[.72,.64,13,6.5],[.28,.78,9,4.5]]){ell(x,y,1,rx,ry,tint(c,-30));ell(x,y,2.5,rx,ry,c,`stroke="${tint(c,-28)}"`);}}
if(ty==='patio'){let c=i.fabric||'#d8cfbf';for(let [x,y,k] of [[0,0,0],[1,0,1],[0,1,2],[1,1,0]])out+=poly([point(x+.04,y+.04,2),point(x+.96,y+.04,2),point(x+.96,y+.96,2),point(x+.04,y+.96,2)],tint(c,[0,-8,6][k]),tint(c,-30));box(0,0,w,d,0,1.5,tint(c,-20));}
if(ty==='bench'){let c=i.fabric||s.wood;for(let x of [.12,w-.24])for(let y of [.12,d-.24])box(x,y,.12,.12,0,20,tint(c,-20));for(let y of [.1,.32,.54])box(.02,y,w-.04,.16,20,4,c);for(let z of [34,46])block(.02,.04,w-.04,.08,z,7,c);box(.12,.04,.12,.08,20,36,tint(c,-20));box(w-.24,.04,.12,.08,20,36,tint(c,-20));}
if(ty==='picnic'){let c=s.wood;for(let x of [.2,w-.32])for(let y of [.55,1.33])box(x,y,.12,.12,0,30,tint(c,-14));box(0,.08,w,.32,16,3,c);box(0,1.6,w,.32,16,3,c);for(let x of [.2,w-.32])for(let y of [.12,1.64])box(x,y,.1,.1,0,16,tint(c,-14));box(0,.5,w,1,30,4,c);let cloth=i.fabric||'#e46b6b';out+=poly([point(.1,.55,34.5),point(w-.1,.55,34.5),point(w-.1,1.45,34.5),point(.1,1.45,34.5)],cloth,tint(cloth,-25));for(let x=.3;x<w-.1;x+=.3)out+=line(point(x,.55,35),point(x,1.45,35),'#ffffff88',4);for(let y=.7;y<1.45;y+=.3)out+=line(point(.1,y,35),point(w-.1,y,35),'#ffffff88',4);dot(.8,.9,40,7,'#f2cf63');dot(1.3,1.1,38,5,'#ef8f7d');}
if(ty==='umbrella'){let c=i.fabric||s.fabric,top=point(.5,.5,118);out+=line(point(.5,.5,0),top,'#8a8577',2.5);drum(.5,.5,0,.18,4,'#8a8577');let rx=46,ry=23,cy=top[1]+16,wedges=[];for(let k=0;k<8;k++){let a1=k*Math.PI/4,a2=(k+1)*Math.PI/4;wedges.push([Math.sin((a1+a2)/2),`<path d="M${top[0]},${top[1]-6}L${r1(top[0]+Math.cos(a1)*rx)},${r1(cy+Math.sin(a1)*ry)}L${r1(top[0]+Math.cos(a2)*rx)},${r1(cy+Math.sin(a2)*ry)}Z" fill="${k%2?c:'#fffaf0'}" stroke="${tint(c,-30)}" stroke-width=".8"/>`]);}out+=wedges.sort((p,q)=>p[0]-q[0]).map(w=>w[1]).join('');}
if(ty==='lamppost'){drum(.25,.25,0,.14,6,'#3a3f46');out+=line(point(.25,.25,6),point(.25,.25,112),'#3a3f46',3);let p=point(.25,.25,112);if(ART_CTX.night)out+=`<circle cx="${p[0]}" cy="${p[1]-8}" r="40" fill="#ffe7a3" opacity=".4"/>`;out+=`<path d="M${p[0]-8},${p[1]}h16l-3,-16h-10z" fill="${ART_CTX.night?'#ffe7a3':'#fdf3cf'}" stroke="#3a3f46" stroke-width="1.5"/><path d="M${p[0]-10},${p[1]-16}h20l-10,-7z" fill="#3a3f46"/>`;}
if(ty==='tree'||ty==='blossomtree'){drum(.75,.75,0,.13,64,'#8a6446');let c=point(.75,.75,100),greens=ty==='tree'?['#5f8f52','#76a564','#8cba74']:['#e9b8c5','#f3cfd8','#dc9fb1'];for(let [dx,dy,r,k] of [[-24,8,26,0],[22,10,26,0],[0,-18,30,1],[-14,-4,24,2],[14,-2,25,1],[0,16,24,2]])out+=`<circle cx="${c[0]+dx}" cy="${c[1]+dy}" r="${r}" fill="${greens[k]}" stroke="${tint(greens[0],-25)}" stroke-width=".8"/>`;if(ty==='blossomtree')for(let k=0;k<9;k++)out+=blossom([c[0]-30+((k*29)%60),c[1]-26+((k*17)%50)],5,k%2?'#fff4f6':'#cf7f97');else for(let k=0;k<5;k++)out+=`<circle cx="${c[0]-20+k*10}" cy="${c[1]-8+((k*13)%20)}" r="3" fill="#c2456b"/>`;}
if(ty==='bush'){let c=point(.5,.5,22),g=i.fabric||'#6f9a5c';for(let [dx,dy,r] of [[-12,4,15],[12,4,15],[0,-6,17]])out+=`<circle cx="${c[0]+dx}" cy="${c[1]+dy}" r="${r}" fill="${tint(g,dy<0?14:0)}" stroke="${tint(g,-28)}"/>`;}
if(ty==='flowerbed'){box(0,0,w,d,0,10,'#d2cbbd');out+=poly([point(.08,.08,10.5),point(w-.08,.08,10.5),point(w-.08,d-.08,10.5),point(.08,d-.08,10.5)],'#8b6a4e');let cols=i.fabric?[i.fabric,tint(i.fabric,30),'#fff4f6']:['#c2456b','#f2cf63','#f7d8dd','#b9a3d6','#ef8f7d'];let k=0;for(let x=.3;x<w-.1;x+=.4)for(let y=.3;y<d-.1;y+=.4,k++){let p=point(x,y,10);out+=line(p,[p[0],p[1]-14],'#6f8f5e',1.4);out+=blossom([p[0],p[1]-15],6,cols[k%cols.length]);}}
if(ty==='pond'){let c=point(w/2,d/2,0);out+=`<ellipse cx="${c[0]}" cy="${c[1]+3}" rx="100" ry="50" fill="#b3ab9b"/><ellipse cx="${c[0]}" cy="${c[1]}" rx="98" ry="48" fill="#d2cbbd" stroke="#a49c8b"/><ellipse cx="${c[0]}" cy="${c[1]+2}" rx="84" ry="40" fill="${i.fabric||'#8cc3d6'}" stroke="#6ea2b7"/>`;for(let [dx,dy] of [[-40,-6],[24,14],[44,-10]])out+=`<path d="M${c[0]+dx},${c[1]+dy}m-11,0a11,6 0 1,0 22,0a11,6 0 1,0 -22,0" fill="#7eaa6a"/>`;out+=blossom([c[0]-40,c[1]-9],6,'#f7d8dd')+`<ellipse cx="${c[0]+4}" cy="${c[1]+4}" rx="9" ry="5" fill="#f2cf63"/><circle cx="${c[0]+10}" cy="${c[1]-3}" r="5" fill="#f2cf63"/><path d="M${c[0]+14},${c[1]-3}l5,1l-5,2z" fill="#ef8f7d"/><circle cx="${c[0]+11}" cy="${c[1]-4}" r="1" fill="#2d2a28"/>`;}
if(ty==='birdbath'){let c=i.fabric||'#cfc8ba';drum(.375,.375,0,.18,6,c);drum(.375,.375,6,.07,34,c);drum(.375,.375,40,.32,6,c);ell(.375,.375,46.5,15,7.5,'#a9dbe9');let p=point(.5,.3,47);out+=`<ellipse cx="${p[0]}" cy="${p[1]-4}" rx="6" ry="4" fill="#8fb6d8"/><circle cx="${p[0]+5}" cy="${p[1]-8}" r="3.4" fill="#8fb6d8"/><path d="M${p[0]+8},${p[1]-8}l3,1l-3,1z" fill="#f2cf63"/>`;}
if(ty==='swing'){let c=i.fabric||s.fabric,frame='#7d8a95';for(let x of [.15,w-.15]){out+=line(point(x,.05,0),point(x,.5,118),frame,4)+line(point(x,.95,0),point(x,.5,118),frame,4);}out+=line(point(.15,.5,118),point(w-.15,.5,118),frame,5);for(let x of [w*.33,w*.67]){out+=line(point(x-.18,.5,116),point(x-.18,.5,30),'#8a8577',1.2)+line(point(x+.18,.5,116),point(x+.18,.5,30),'#8a8577',1.2);box(x-.22,.38,.44,.24,28,4,c);}}
if(ty==='pool'){let c=i.fabric||'#8fb6d8';drum(1,1,0,.86,16,c);ell(1,1,16.5,44,23,'#bfe6ef',`stroke="${tint(c,20)}" stroke-width="3"`);let p=point(1.2,.9,17);out+=`<ellipse cx="${p[0]}" cy="${p[1]-3}" rx="8" ry="5" fill="#f2cf63"/><circle cx="${p[0]+6}" cy="${p[1]-9}" r="4.5" fill="#f2cf63"/><path d="M${p[0]+10},${p[1]-9}l4,1l-4,2z" fill="#ef8f7d"/><circle cx="${p[0]+7}" cy="${p[1]-10}" r="1" fill="#2d2a28"/>`;}
if(ty==='mailbox'){let c=i.fabric||'#4c8580';box(.2,.2,.1,.1,0,40,s.wood);box(.08,.12,.34,.26,40,14,c);let p=point(.08,.25,62);ell(.25,.25,54,12,6,tint(c,14));box(.42,.2,.03,.08,46,18,'#c2456b');}
if(selection){out+=poly([P(i.x,i.y,3),P(i.x+a,i.y,3),P(i.x+a,i.y+b,3),P(i.x,i.y+b,3)],'none','#b3668a','stroke-width="3" stroke-dasharray="5 3"');}
return out;}

// A painter's sort: things further back are drawn first. Works for any mix of boxes on the floor.
function depthSort(list){let n=list.length,before=list.map(()=>[]),deg=new Array(n).fill(0),e=1e-6;
 for(let p=0;p<n;p++)for(let q=p+1;q<n;q++){let A=list[p],B=list[q],ab=A.x1<=B.x0+e||A.y1<=B.y0+e,ba=B.x1<=A.x0+e||B.y1<=A.y0+e;if(ab&&!ba){before[p].push(q);deg[q]++;}else if(ba&&!ab){before[q].push(p);deg[p]++;}}
 let key=k=>list[k].x0+list[k].y0+list[k].x1+list[k].y1,ready=[],out=[];for(let k=0;k<n;k++)if(!deg[k])ready.push(k);
 while(out.length<n){if(!ready.length){let k=[...Array(n).keys()].filter(k=>deg[k]>0&&!out.includes(k)).sort((a,b)=>key(a)-key(b))[0];deg[k]=0;ready.push(k);}ready.sort((a,b)=>key(a)-key(b));let k=ready.shift();out.push(k);deg[k]=-1;for(let q of before[k])if(deg[q]>0&&--deg[q]===0)ready.push(q);}
 return out.map(k=>list[k]);}
function itemBox(i){let [w,d]=dims(i);return {x0:i.x,y0:i.y,x1:i.x+w,y1:i.y+d,item:i};}
function itemsArt(items,{selected=null,interactive=true}={}){let flat=items.filter(i=>TYPES[i.type].flat),solid=items.filter(i=>!TYPES[i.type].flat);let out='';
 const g=i=>interactive?`<g data-item="${esc(i.id)}" tabindex="0" role="button" aria-label="${esc(TYPES[i.type].name)}">${furniture(i,i.id===selected)}</g>`:furniture(i);
 for(let i of flat)out+=g(i);for(let b of depthSort(solid.map(itemBox)))out+=g(b.item);return out;}

function wallInk(r,wall){return r.paperInk||(lum(wall)<120?tint(wall,60):tint(wall,-40));}
function floorArt(r,w,d){let f=palette(r.floor),base=r.floorPaint||f.floor,pat=r.floorPattern||'style',out=poly([P(0,0),P(w,0),P(w,d),P(0,d)],base);
 out+=poly([P(0,d),P(w,d),P(w,d,-16),P(0,d,-16)],tint(f.wood,5));out+=poly([P(w,0),P(w,d),P(w,d,-16),P(w,0,-16)],f.wood);
 const planks=()=>{for(let k=0;k<=w;k+=.5)out+=line(P(k,0),P(k,d),tint(base,-24),.7);for(let x=0;x<w;x+=.5)for(let y=(x%1)*2;y<d;y+=2)out+=line(P(x,y),P(x+.5,y),tint(base,-18),.6);};
 const checker=(c1,c2)=>{for(let x=0;x<w;x++)for(let y=0;y<d;y++)out+=poly([P(x,y,1),P(x+1,y,1),P(x+1,y+1,1),P(x,y+1,1)],(x+y)%2?c1:c2,'#8c897655');};
 const tatami=(fill)=>{for(let x=0;x<w;x+=2)for(let y=0;y<d;y+=4){let x1=Math.min(x+2,w),y1=Math.min(y+4,d);out+=poly([P(x+.04,y+.04,1),P(x1-.04,y+.04,1),P(x1-.04,y1-.04,1),P(x+.04,y1-.04,1)],fill,f.wood);for(let z=.15;z<x1-x;z+=.14)out+=line(P(x+z,y+.1,2),P(x+z,y1-.1,2),'#9b9c7440',.5);}};
 if(pat==='style'){planks();if(f.id==='deco')checker(r.floorPaint?tint(base,-35):f.wood,r.floorPaint?base:f.trim);if(f.id==='sakura')tatami(r.floorPaint?tint(base,-6):'#d5c49c');}
 if(pat==='planks')planks();
 if(pat==='checker')checker(tint(base,-38),base);
 if(pat==='tatami')tatami(tint(base,-4));
 if(pat==='tile')for(let x=0;x<w;x++)for(let y=0;y<d;y++)out+=poly([P(x+.03,y+.03,1),P(x+.97,y+.03,1),P(x+.97,y+.97,1),P(x+.03,y+.97,1)],(x+y)%2?tint(base,7):base,tint(base,-26));
 if(pat==='carpet'){out+=poly([P(.2,.2,1),P(w-.2,.2,1),P(w-.2,d-.2,1),P(.2,d-.2,1)],'none',tint(base,-16),'stroke-width="2"');for(let x=.35;x<w;x+=.6)for(let y=.35;y<d;y+=.6){let p=P(x+((y*7)%3)*.1,y,1);out+=`<circle cx="${p[0]}" cy="${p[1]}" r="1" fill="${tint(base,-14)}"/>`;}}
 if(pat==='stone')for(let y=0;y<d;y++){let off=(y%2)*.5;for(let x=-off;x<w;x+=1){let x0=Math.max(0,x),x1=Math.min(w,x+1);out+=poly([P(x0+.04,y+.04,1),P(x1-.04,y+.04,1),P(x1-.04,y+.96,1),P(x0+.04,y+.96,1)],tint(base,((Math.round(x*2)*7+y*13)%3-1)*9),tint(base,-30));}}
 return out;}
function wallsArt(r,w,d,H,simple){let s=palette(r.wall),wall=r.wallPaint||s.wall,out='',paper=r.paper||'style',ink=wallInk(r,wall);
 out+=poly([P(0,0),P(0,d),P(0,d,H),P(0,0,H)],tint(wall,-8));out+=poly([P(0,0),P(w,0),P(w,0,H),P(0,0,H)],wall);
 let z0=simple?12:76,z1=simple?H-6:176;
 const motif=(p,k)=>paper==='dots'?`<circle cx="${p[0]}" cy="${p[1]}" r="${simple?2.2:3}" fill="${ink}"/>`:paper==='blossoms'?blossom(p,simple?4:5.5,ink,tint(ink,-30)):paper==='stars'?star(p,simple?4:5.5,ink):paper==='hearts'?heart(p,simple?3.4:4.6,ink):'';
 if(paper==='style'&&!simple){if(s.id==='deco')for(let x=.5;x<w;x+=.7)out+=poly([P(x-.28,0,100),P(x,0,156),P(x+.28,0,100)],'none',s.accent);if(s.id==='victorian')for(let x=.3;x<w;x+=.65)for(let z=95;z<175;z+=22)out+=poly([P(x,0,z-7),P(x+.1,0,z),P(x,0,z+7),P(x-.1,0,z)],s.trim,'none');}
 if(paper==='stripes'||paper==='checks'){let op=paper==='checks'?.3:.45;for(let k=0;k<w;k+=.5)out+=poly([P(k,0,z0),P(Math.min(k+.25,w),0,z0),P(Math.min(k+.25,w),0,z1),P(k,0,z1)],ink,'none',`opacity="${op}"`);for(let k=0;k<d;k+=.5)out+=poly([P(0,k,z0),P(0,Math.min(k+.25,d),z0),P(0,Math.min(k+.25,d),z1),P(0,k,z1)],ink,'none',`opacity="${op}"`);
  if(paper==='checks'){let step=simple?12:22;for(let z=z0;z<z1-step/2;z+=step){out+=poly([P(0,0,z),P(w,0,z),P(w,0,z+step/2),P(0,0,z+step/2)],ink,'none','opacity=".3"');out+=poly([P(0,0,z),P(0,d,z),P(0,d,z+step/2),P(0,0,z+step/2)],ink,'none','opacity=".3"');}}}
 if(['dots','blossoms','stars','hearts'].includes(paper)){let step=simple?16:24,row=0;for(let z=z0+step*.5;z<z1-4;z+=step,row++){let off=row%2?.375:0;for(let x=.4+off;x<w-.15;x+=.75)out+=motif(P(x,0,z),row);for(let y=.4+off;y<d-.15;y+=.75)out+=motif(P(0,y,z),row);}}
 if(!simple){for(let k=0;k<w;k+=1)out+=poly([P(k+.1,0,18),P(Math.min(k+.9,w-.05),0,18),P(Math.min(k+.9,w-.05),0,65),P(k+.1,0,65)],'none',s.trim);for(let k=0;k<d;k+=1)out+=poly([P(0,k+.1,18),P(0,Math.min(k+.9,d-.05),18),P(0,Math.min(k+.9,d-.05),65),P(0,k+.1,65)],'none',s.trim);
  for(let z of [8,72,180,190]){out+=line(P(0,d,z),P(0,0,z),s.trim,z===8?8:4);out+=line(P(0,0,z),P(w,0,z),s.trim,z===8?8:4);}}
 else{out+=line(P(0,d,5),P(0,0,5),s.trim,5)+line(P(0,0,5),P(w,0,5),s.trim,5);out+=poly([P(0,d,H),P(0,0,H),P(w,0,H),P(w,-.12,H),P(-.12,-.12,H),P(-.12,d,H)],s.trim,tint(s.trim,-30));}
 return out;}
function roomArt(r,o={}){let w=r.w,d=r.d,simple=!!o.simple,H=simple?62:190,s=palette(r.wall),out='';
 ART_CTX={art:r.art||null,bg:r.artBg||'#fffaf0',night:r.light==='night'&&!simple};
 out+=floorArt(r,w,d)+wallsArt(r,w,d,H,simple);
 if(!simple){
  if(d>=3){let y0=Math.min(1.4,d*.2),y1=Math.min(y0+3.1,d-.6),wood=s.wood;out+=poly([P(0,y0,85),P(0,y1,85),P(0,y1,165),P(0,y0,165)],r.light==='night'?'#7483a4':'#d4e6d9',wood,'stroke-width="5"');if(r.light==='night'){let m=P(0,y0+(y1-y0)*.7,148);out+=`<circle cx="${m[0]}" cy="${m[1]}" r="7" fill="#fff8dc"/>`;}
   out+=line(P(0,y0+.2,87),P(0,y1-.4,154),'#977764',3);for(let k=0;k<15;k++){let p=P(0,y0+.2+(k*.19)%(y1-y0-.4),100+(k*19)%60);out+=blossom(p,7+k%4,k%2?'#e9b8c5':'#f7d8dd');}
   for(let t of [1/3,2/3])out+=line(P(0,y0+(y1-y0)*t,85),P(0,y0+(y1-y0)*t,165),wood,3);out+=line(P(0,y0,125),P(0,y1,125),wood,3);
   if(r.light!=='night'){let L=Math.min(4.7,w-.3);out+=poly([P(.1,y0+.1,3),P(.1,y1-.1,3),P(L,Math.min(d,y1+L*.38),3),P(L,Math.min(d,y0+L*.38),3)],r.light==='golden'?'#ffe5a745':'#fffbe62d','none');}}
  if(w>=3){let aw=Math.min(2,w-1.2),x0=w>=7?w-3.5:(w-aw)/2,x1=x0+aw,z0=100,z1=155;out+=poly([P(x0,0,z0),P(x1,0,z0),P(x1,0,z1),P(x0,0,z1)],s.trim,s.wood,'stroke-width="4"');
   if(r.art){let ix0=x0+.1,ix1=x1-.1,iz0=z0+4,iz1=z1-4;out+=poly([P(ix0,0,iz0),P(ix1,0,iz0),P(ix1,0,iz1),P(ix0,0,iz1)],r.artBg||'#fffaf0','none');out+=planeImage(r.art,P(ix0,0,iz1),P(ix1,0,iz1),P(ix0,0,iz0),ART_W,ART_H);}
   else out+=defaultPainting((x,z)=>P(x,0,z),x0+.2,x1-.2,z0+5,z1-10,s);}
 }
 if(o.grid)for(let k=0;k<=Math.max(w,d);k+=.5){if(k<=w)out+=line(P(k,0,2),P(k,d,2),'#ffffff88');if(k<=d)out+=line(P(0,k,2),P(w,k,2),'#ffffff88');}
 out+=itemsArt(r.items,{selected:o.selected,interactive:!simple});
 if(o.ghost)out+=o.ghost();
 if(simple)return out;
 return `<g ${r.light==='golden'?'style="filter:sepia(.22) saturate(1.1)"':r.light==='night'?'style="filter:brightness(.75) saturate(.75)"':''}>${out}</g>`;}

function houseBounds(h){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(let r of h.rooms){x0=Math.min(x0,r.px);y0=Math.min(y0,r.py);x1=Math.max(x1,r.px+r.w);y1=Math.max(y1,r.py+r.d);}return {x0,y0,x1,y1};}
function houseArt(h,o={}){let out='',b=houseBounds(h);
 out+=poly([P(b.x0-1.2,b.y0-1.2),P(b.x1+1.2,b.y0-1.2),P(b.x1+1.2,b.y1+1.2),P(b.x0-1.2,b.y1+1.2)],'#e7eadc','#d5d9c6');
 let order=depthSort(h.rooms.map((r,k)=>({x0:r.px,y0:r.py,x1:r.px+r.w,y1:r.py+r.d,k})));
 for(let {k} of order){let r=h.rooms[k];out+=`<g data-room="${k}" role="button" tabindex="0" aria-label="${esc(r.name)}">`+withOffset(r.px,r.py,()=>{let s=roomArt(r,{simple:true});if(o.selected===k)s+=poly([P(0,0,3),P(r.w,0,3),P(r.w,r.d,3),P(0,r.d,3)],'#b3668a22','#b3668a','stroke-width="4" stroke-dasharray="7 4"');return s;})+'</g>';}
 for(let {k} of order){let r=h.rooms[k],c=withOffset(r.px,r.py,()=>P(r.w/2,r.d/2,96)),label=`${ROOM_TYPES[r.type].icon} ${r.name}`,wd=Math.min(230,label.length*7.4+26);out+=`<g pointer-events="none"><rect x="${r1(c[0]-wd/2)}" y="${c[1]-14}" width="${r1(wd)}" height="28" rx="14" fill="#fffdf8ee" stroke="${o.selected===k?'#b3668a':'#d9dccd'}" stroke-width="${o.selected===k?2:1}"/><text x="${c[0]}" y="${c[1]+5}" text-anchor="middle" font-family="Georgia,serif" font-size="13" fill="#37483f">${esc(label.length>30?label.slice(0,29)+'…':label)}</text></g>`;}
 if(o.ghost)out+=o.ghost;
 return out;}

// The outside of the house: walls, windows, a door and a roof for every room.
function exteriorBlock(r,h,frontRoom){let x0=r.px,y0=r.py,x1=x0+r.w,y1=y0+r.d,H=150,ext=h.ext,sid=ext.siding,roof=ext.roof,trim=ext.trim||'#fffaf0',night=ext.light==='night',out='';
 const covered=(x,y)=>h.rooms.some(q=>q!==r&&x>q.px&&x<q.px+q.w&&y>q.py&&y<q.py+q.d);
 out+=poly([P(x1,y0),P(x1,y1),P(x1,y1,H),P(x1,y0,H)],tint(sid,-22));out+=poly([P(x0,y1),P(x1,y1),P(x1,y1,H),P(x0,y1,H)],tint(sid,-6));
 for(let z=14;z<H;z+=14){out+=line(P(x1,y0,z),P(x1,y1,z),tint(sid,-38),.6);out+=line(P(x0,y1,z),P(x1,y1,z),tint(sid,-26),.6);}
 out+=line(P(x0,y1,4),P(x1,y1,4),tint(sid,-45),7)+line(P(x1,y0,4),P(x1,y1,4),tint(sid,-55),7);
 let glass=night?'#ffe7a3':'#cfe3ea';
 const win=(pt,u0,u1)=>{out+=poly([pt(u0-.08,58),pt(u1+.08,58),pt(u1+.08,128),pt(u0-.08,128)],trim,tint(trim,-40));out+=poly([pt(u0,64),pt(u1,64),pt(u1,122),pt(u0,122)],glass,tint(trim,-50));out+=line(pt((u0+u1)/2,64),pt((u0+u1)/2,122),trim,3)+line(pt(u0,93),pt(u1,93),trim,3);
  out+=poly([pt(u0-.12,50),pt(u1+.12,50),pt(u1+.12,58),pt(u0-.12,58)],tint(ext.door,-10),tint(ext.door,-40));for(let k=0;k<4;k++){let p=pt(u0+(u1-u0)*(k+.5)/4,58);out+=blossom([p[0],p[1]-2],5,['#c2456b','#f2cf63','#f7d8dd','#ef8f7d'][k]);}};
 let door=null;if(r===frontRoom){let c=x0+r.w/2;door=[c-.55,c+.55];}
 for(let u=x0+.9;u<=x1-1.3;u+=2.4){let u1=u+1.1;if(door&&u<door[1]+.2&&u1>door[0]-.2)continue;if(covered((u+u1)/2,y1+.5))continue;win((x,z)=>P(x,y1,z),u,u1);}
 for(let u=y0+.9;u<=y1-1.3;u+=2.4){let u1=u+1.1;if(covered(x1+.5,(u+u1)/2))continue;win((y,z)=>P(x1,y,z),u,u1);}
 if(door){let [d0,d1]=door,pt=(x,z)=>P(x,y1,z);out+=poly([P(d0-.3,y1,0),P(d1+.3,y1,0),P(d1+.3,y1+.7,0),P(d0-.3,y1+.7,0)],'#d2cbbd','#a49c8b')+poly([P(d0-.3,y1+.7,0),P(d1+.3,y1+.7,0),P(d1+.3,y1+.7,-6),P(d0-.3,y1+.7,-6)],'#b3ab9b');
  out+=poly([pt(d0-.1,0),pt(d1+.1,0),pt(d1+.1,112),pt(d0-.1,112)],trim,tint(trim,-40))+poly([pt(d0,0),pt(d1,0),pt(d1,104),pt(d0,104)],ext.door,tint(ext.door,-35));out+=poly([pt(d0+.15,60),pt(d1-.15,60),pt(d1-.15,92),pt(d0+.15,92)],tint(ext.door,14),tint(ext.door,-30))+poly([pt(d0+.15,14),pt(d1-.15,14),pt(d1-.15,50),pt(d0+.15,50)],tint(ext.door,14),tint(ext.door,-30));let k=pt(d1-.18,52);out+=`<circle cx="${k[0]}" cy="${k[1]}" r="3" fill="#e2b44d" stroke="#a9832f"/>`;let l=pt(d1+.32,96);out+=`<rect x="${l[0]-4}" y="${l[1]-10}" width="8" height="12" rx="2" fill="${night?'#ffe7a3':'#fdf3cf'}" stroke="#3a3f46"/>`;if(night)out+=`<circle cx="${l[0]}" cy="${l[1]-4}" r="24" fill="#ffe7a3" opacity=".35"/>`;}
 // Roof: a gable along the room's longer side.
 let ov=.35,rh=Math.min(r.w,r.d)*8+22,along=r.w>=r.d,shade=tint(roof,-26);
 if(along){let ym=(y0+y1)/2;out+=poly([P(x0-ov,y0-ov,H),P(x1+ov,y0-ov,H),P(x1+ov,ym,H+rh),P(x0-ov,ym,H+rh)],shade);out+=poly([P(x1,y0,H),P(x1,y1,H),P(x1,ym,H+rh)],tint(sid,-22));out+=poly([P(x1+.02,y0+.4,H+4),P(x1+.02,y1-.4,H+4),P(x1+.02,ym,H+rh-8)],'none',trim,'stroke-width="3"');out+=poly([P(x0-ov,ym,H+rh),P(x1+ov,ym,H+rh),P(x1+ov,y1+ov,H),P(x0-ov,y1+ov,H)],roof,tint(roof,-35));for(let t=.2;t<1;t+=.2)out+=line(P(x0-ov,ym+(y1+ov-ym)*t,H+rh*(1-t)),P(x1+ov,ym+(y1+ov-ym)*t,H+rh*(1-t)),tint(roof,-22),1);out+=line(P(x0-ov,ym,H+rh),P(x1+ov,ym,H+rh),tint(roof,-40),3);}
 else{let xm=(x0+x1)/2;out+=poly([P(x0-ov,y0-ov,H),P(xm,y0-ov,H+rh),P(xm,y1+ov,H+rh),P(x0-ov,y1+ov,H)],shade);out+=poly([P(x0,y1,H),P(x1,y1,H),P(xm,y1,H+rh)],tint(sid,-6));out+=poly([P(x0+.4,y1+.02,H+4),P(x1-.4,y1+.02,H+4),P(xm,y1+.02,H+rh-8)],'none',trim,'stroke-width="3"');out+=poly([P(xm,y0-ov,H+rh),P(x1+ov,y0-ov,H),P(x1+ov,y1+ov,H),P(xm,y1+ov,H+rh)],roof,tint(roof,-35));for(let t=.2;t<1;t+=.2)out+=line(P(xm+(x1+ov-xm)*t,y0-ov,H+rh*(1-t)),P(xm+(x1+ov-xm)*t,y1+ov,H+rh*(1-t)),tint(roof,-22),1);out+=line(P(xm,y0-ov,H+rh),P(xm,y1+ov,H+rh),tint(roof,-40),3);}
 if(r===h.rooms.reduce((m,q)=>q.w*q.d>m.w*m.d?q:m,h.rooms[0])){let cx=x0+r.w*.25,cy=y0+r.d*.25,base=along?H+rh*((cy-y0)/((y1-y0)/2)):H+rh*((cx-x0)/((x1-x0)/2));base=Math.max(H,Math.min(H+rh,base));out+=(()=>{let s='',c='#a8695a';s+=poly([P(cx+.5,cy,base),P(cx+.5,cy+.5,base),P(cx+.5,cy+.5,H+rh+30),P(cx+.5,cy,H+rh+30)],tint(c,-20))+poly([P(cx,cy+.5,base),P(cx+.5,cy+.5,base),P(cx+.5,cy+.5,H+rh+30),P(cx,cy+.5,H+rh+30)],c)+poly([P(cx-.05,cy-.05,H+rh+30),P(cx+.55,cy-.05,H+rh+30),P(cx+.55,cy+.55,H+rh+30),P(cx-.05,cy+.55,H+rh+30)],tint(c,20));return s;})();}
 return out;}
function yardBounds(h){let b=houseBounds(h),m=h.ext.yard||8,out={x0:b.x0-m,y0:b.y0-m,x1:b.x1+m,y1:b.y1+m};for(let i of h.yard.items){let [w,d]=dims(i);out.x0=Math.min(out.x0,i.x-.5);out.y0=Math.min(out.y0,i.y-.5);out.x1=Math.max(out.x1,i.x+w+.5);out.y1=Math.max(out.y1,i.y+d+.5);}return out;}
function yardArt(h,o={}){let b=yardBounds(h),ext=h.ext,g=ext.grass||'#a9cf8e',out='';
 ART_CTX={art:null,bg:'#fffaf0',night:ext.light==='night'};
 out+=poly([P(b.x0,b.y0),P(b.x1,b.y0),P(b.x1,b.y1),P(b.x0,b.y1)],g);
 for(let x=Math.ceil(b.x0/2)*2;x<b.x1;x+=4)out+=poly([P(x,b.y0),P(Math.min(x+2,b.x1),b.y0),P(Math.min(x+2,b.x1),b.y1),P(x,b.y1)],tint(g,8),'none');
 out+=poly([P(b.x0,b.y1),P(b.x1,b.y1),P(b.x1,b.y1,-20),P(b.x0,b.y1,-20)],'#9c7d5a')+poly([P(b.x1,b.y0),P(b.x1,b.y1),P(b.x1,b.y1,-20),P(b.x1,b.y0,-20)],'#86694a');
 out+=line(P(b.x0,b.y1,-.5),P(b.x1,b.y1,-.5),tint(g,-30),3)+line(P(b.x1,b.y0,-.5),P(b.x1,b.y1,-.5),tint(g,-30),3);
 for(let k=0;k<40;k++){let x=b.x0+((k*7.31)%(b.x1-b.x0)),y=b.y0+((k*4.17)%(b.y1-b.y0));if(h.rooms.some(r=>x>r.px-.3&&x<r.px+r.w+.3&&y>r.py-.3&&y<r.py+r.d+.3))continue;let p=P(x,y);out+=`<path d="M${p[0]-3},${p[1]}l1,-5M${p[0]},${p[1]}l0,-6M${p[0]+3},${p[1]}l-1,-5" stroke="${tint(g,-28)}" stroke-width="1"/>`;}
 if(o.grid)for(let x=Math.ceil(b.x0);x<=b.x1;x++)out+=line(P(x,b.y0,1),P(x,b.y1,1),'#ffffff66');
 if(o.grid)for(let y=Math.ceil(b.y0);y<=b.y1;y++)out+=line(P(b.x0,y,1),P(b.x1,y,1),'#ffffff66');
 let front=h.rooms.reduce((m,r)=>(r.py+r.d)*100+r.px+r.w>(m.py+m.d)*100+m.px+m.w?r:m,h.rooms[0]);
 for(let r of h.rooms)out+=poly([P(r.px-.15,r.py-.15),P(r.px+r.w+.4,r.py-.15),P(r.px+r.w+.4,r.py+r.d+.4),P(r.px-.15,r.py+r.d+.4)],'#44443822','none');
 let flat=h.yard.items.filter(i=>TYPES[i.type].flat);for(let i of flat)out+=`<g data-item="${esc(i.id)}" tabindex="0" role="button" aria-label="${esc(TYPES[i.type].name)}">${furniture(i,i.id===o.selected)}</g>`;
 let list=[...h.rooms.map(r=>({x0:r.px,y0:r.py,x1:r.px+r.w,y1:r.py+r.d,room:r})),...h.yard.items.filter(i=>!TYPES[i.type].flat).map(itemBox)];
 for(let e of depthSort(list))out+=e.room?exteriorBlock(e.room,h,front):`<g data-item="${esc(e.item.id)}" tabindex="0" role="button" aria-label="${esc(TYPES[e.item.type].name)}">${furniture(e.item,e.item.id===o.selected)}</g>`;
 if(o.ghost)out+=o.ghost();
 return `<g ${ext.light==='golden'?'style="filter:sepia(.25) saturate(1.15)"':ext.light==='night'?'style="filter:brightness(.62) saturate(.7) hue-rotate(10deg)"':''}>${out}</g>`;}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
