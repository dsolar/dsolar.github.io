'use strict';
// Wild Bloom Isles: everything the studio knows about. Edit freely.
// Collections set the colors of walls, floors and pieces.
const STYLES=[
{id:'sakura',name:'Sakura House',era:'Japanese inspired',wall:'#f4e7dc',floor:'#d9bd92',wood:'#976d54',fabric:'#d9a5b5',accent:'#829a7b',trim:'#f8edd4',story:'Quiet timber, blossom pink, paper lanterns. A gentle place to begin.'},
{id:'victorian',name:'Rose Manor',era:'Victorian inspired',wall:'#ccd1ba',floor:'#956e51',wood:'#604936',fabric:'#9b6079',accent:'#c5a465',trim:'#eee0b9',story:'Tufted upholstery, carved posts and deep rose. A little storybook grandeur.'},
{id:'deco',name:'Golden Hour',era:'1920s Art Deco',wall:'#426761',floor:'#c9b89c',wood:'#263e3b',fabric:'#4c8580',accent:'#d5ae58',trim:'#eedeb1',story:'Stepped silhouettes, jewel tones and brass details. Dress the room for a golden evening.'},
{id:'mid',name:'Sunday Modern',era:'1950s–60s',wall:'#e9ddc4',floor:'#bc956d',wood:'#875438',fabric:'#bd714e',accent:'#b6af65',trim:'#f5e6c5',story:'Long low furniture, warm walnut and optimistic color. Put a record on.'},
{id:'boho',name:'Sunwoven',era:'1970s bohemian',wall:'#ecd4b9',floor:'#c5a77e',wood:'#af7d4f',fabric:'#d49163',accent:'#7c956a',trim:'#f7e5c1',story:'Woven details, terracotta and leafy corners. A sunlit room with a collected soul.'},
{id:'nordic',name:'Cloud & Oak',era:'Contemporary Nordic',wall:'#e6ebe5',floor:'#d9cbb3',wood:'#b9a17c',fabric:'#c7d0ca',accent:'#859bad',trim:'#fff6e6',story:'Pale oak, soft cushions and thoughtful simplicity. Leave space to breathe.'}
];

// The paint box: used for walls, floors, wallpaper, pieces and the outside of the house.
const PAINTS=[['Blossom','#d9a5b5'],['Plum','#9b6079'],['Berry','#c2456b'],['Coral','#ef8f7d'],['Terracotta','#bd714e'],['Sunshine','#f2cf63'],['Olive','#b6af65'],['Mint','#a8d5ba'],['Jade','#4c8580'],['Sky','#8fb6d8'],['Lavender','#b9a3d6'],['Cloud','#c7d0ca'],['Snow','#f7f4ee'],['Night','#3c4a6b']];

const WALLPAPERS=[['style','Collection'],['plain','Plain paint'],['stripes','Stripes'],['dots','Polka dots'],['blossoms','Blossoms'],['stars','Stars'],['hearts','Hearts'],['checks','Gingham']];
const FLOORS=[['style','Collection'],['planks','Wood planks'],['tile','Square tiles'],['checker','Checkerboard'],['tatami','Tatami mats'],['carpet','Soft carpet'],['stone','Stone']];

// Every piece. w and d are its size on the floor (in squares), h is roughly how tall it draws.
// flat pieces (rugs, patios, paths) can sit under other pieces.
// where: 'in' = inside the house, 'out' = the yard, 'both' = anywhere.
const TYPES={
sofa:{name:'Sofa',cat:'Seating',w:3,d:1.5,h:80,where:'in'},
chair:{name:'Armchair',cat:'Seating',w:1.5,d:1.5,h:80,where:'in'},
ottoman:{name:'Round pouf',cat:'Seating',w:1,d:1,h:40,where:'in'},
table:{name:'Coffee table',cat:'Tables',w:2,d:1.25,h:50,where:'in'},
console:{name:'Sideboard',cat:'Storage',w:2.5,d:1,h:110,where:'in'},
bookshelf:{name:'Bookshelf',cat:'Storage',w:2,d:.75,h:135,where:'in'},
bed:{name:'Bed',cat:'Bedroom',w:2.5,d:3.5,h:90,where:'in'},
nightstand:{name:'Nightstand',cat:'Bedroom',w:.75,d:.75,h:75,where:'in'},
wardrobe:{name:'Wardrobe',cat:'Bedroom',w:2,d:1,h:165,where:'in'},
counter:{name:'Kitchen counter',cat:'Kitchen',w:2,d:1,h:75,where:'in'},
sink:{name:'Kitchen sink',cat:'Kitchen',w:1.5,d:1,h:80,where:'in'},
stove:{name:'Stove',cat:'Kitchen',w:1,d:1,h:70,where:'in'},
fridge:{name:'Fridge',cat:'Kitchen',w:1,d:1,h:140,where:'in'},
stool:{name:'Stool',cat:'Kitchen',w:.75,d:.75,h:45,where:'in'},
tub:{name:'Bathtub',cat:'Bath',w:2.5,d:1.25,h:55,where:'in'},
toilet:{name:'Toilet',cat:'Bath',w:.75,d:1,h:70,where:'in'},
vanity:{name:'Bathroom sink',cat:'Bath',w:1.5,d:.75,h:70,where:'in'},
mat:{name:'Bath mat',cat:'Bath',w:1.5,d:1,h:10,where:'in',flat:true},
arcade:{name:'Arcade game',cat:'Play',w:1,d:1,h:130,where:'in'},
gametable:{name:'Ping-pong table',cat:'Play',w:3,d:1.75,h:55,where:'in'},
beanbag:{name:'Beanbag',cat:'Play',w:1.25,d:1.25,h:45,where:'in'},
tv:{name:'TV stand',cat:'Play',w:2,d:.75,h:100,where:'in'},
rack:{name:'Clothes rack',cat:'Closet',w:2.5,d:.75,h:125,where:'in'},
shoes:{name:'Shoe shelf',cat:'Closet',w:1.5,d:.6,h:70,where:'in'},
mirror:{name:'Standing mirror',cat:'Closet',w:1,d:.5,h:115,where:'in'},
salon:{name:'Salon chair',cat:'Beauty',w:1,d:1,h:90,where:'in'},
dryer:{name:'Hair dryer chair',cat:'Beauty',w:1.25,d:1.25,h:125,where:'in'},
lightmirror:{name:'Vanity mirror',cat:'Beauty',w:1.5,d:.5,h:110,where:'in'},
nails:{name:'Nail table',cat:'Beauty',w:1.5,d:.75,h:55,where:'in'},
easel:{name:'Easel',cat:'Art',w:1,d:1,h:125,where:'in'},
painttable:{name:'Paint table',cat:'Art',w:2,d:1,h:65,where:'in'},
rug:{name:'Woven rug',cat:'Decor',w:3.5,d:3,h:10,where:'in',flat:true},
lamp:{name:'Floor lamp',cat:'Decor',w:.75,d:.75,h:115,where:'in'},
plant:{name:'Leafy planter',cat:'Decor',w:.75,d:.75,h:105,where:'both'},
flowers:{name:'Wild blooms',cat:'Decor',w:.75,d:.75,h:105,where:'both'},
cow:{name:'Cow',cat:'Friends',w:1.5,d:.8,h:75,where:'both'},
cat:{name:'Sleepy cat',cat:'Friends',w:.75,d:.75,h:35,where:'both'},
fence:{name:'Picket fence',cat:'Fences & paths',w:1,d:.25,h:55,where:'out'},
hedge:{name:'Hedge',cat:'Fences & paths',w:1,d:.6,h:45,where:'out'},
path:{name:'Stepping stones',cat:'Fences & paths',w:1,d:1,h:10,where:'out',flat:true},
mailbox:{name:'Mailbox',cat:'Fences & paths',w:.5,d:.5,h:60,where:'out'},
patio:{name:'Patio stones',cat:'Patio',w:2,d:2,h:10,where:'out',flat:true},
bench:{name:'Garden bench',cat:'Patio',w:2,d:.75,h:55,where:'out'},
picnic:{name:'Picnic table',cat:'Patio',w:2,d:2,h:50,where:'out'},
umbrella:{name:'Patio umbrella',cat:'Patio',w:1,d:1,h:125,where:'out'},
lamppost:{name:'Lamp post',cat:'Patio',w:.5,d:.5,h:130,where:'out'},
tree:{name:'Shade tree',cat:'Garden',w:1.5,d:1.5,h:170,where:'out'},
blossomtree:{name:'Blossom tree',cat:'Garden',w:1.5,d:1.5,h:170,where:'out'},
bush:{name:'Round bush',cat:'Garden',w:1,d:1,h:50,where:'out'},
flowerbed:{name:'Flower bed',cat:'Garden',w:2,d:1,h:40,where:'out'},
pond:{name:'Lily pond',cat:'Garden',w:3,d:2,h:20,where:'out'},
birdbath:{name:'Bird bath',cat:'Garden',w:.75,d:.75,h:55,where:'out'},
swing:{name:'Swing set',cat:'Play',w:3,d:1,h:125,where:'out'},
pool:{name:'Kiddie pool',cat:'Play',w:2,d:2,h:30,where:'out'},
palm:{name:'Palm tree',cat:'Beach',w:1,d:1,h:165,where:'out'},
sandcastle:{name:'Sandcastle',cat:'Beach',w:1,d:1,h:60,where:'out'},
campfire:{name:'Campfire',cat:'Beach',w:1,d:1,h:40,where:'out'},
fountain:{name:'Fountain',cat:'Village',w:2,d:2,h:75,where:'out'},
stall:{name:'Market stall',cat:'Village',w:2,d:1,h:105,where:'isle'},
lighthouse:{name:'Lighthouse',cat:'Village',w:1.5,d:1.5,h:200,where:'isle'},
dock:{name:'Wooden dock',cat:'Village',w:3,d:1.25,h:15,where:'isle',flat:true},
gazebo:{name:'Gazebo',cat:'Village',w:2.5,d:2.5,h:135,where:'isle'},
signpost:{name:'Signpost',cat:'Village',w:.5,d:.5,h:80,where:'isle'},
sailboat:{name:'Sailboat',cat:'Beach',w:2,d:1,h:120,where:'isle'}
};
const IN_CATS=['Seating','Tables','Storage','Bedroom','Kitchen','Bath','Play','Closet','Beauty','Art','Decor','Friends'];
const OUT_CATS=['Garden','Fences & paths','Patio','Play','Beach','Friends'];
const ISLE_CATS=['Village','Beach','Garden','Fences & paths','Patio','Play','Friends'];

// Room types: their starting size, the pieces they start with, and their own shelf.
// Starting pieces are [type, x, y, turned?]. Pieces that don't fit are skipped.
const ROOM_TYPES={
living:{name:'Living room',icon:'🛋️',w:8,d:8,pieces:['sofa','chair','table','console','rug','lamp','plant','bookshelf','ottoman','flowers','tv'],
 start:[['rug',2,2.5],['sofa',2,.5],['table',2.5,3],['chair',.25,3],['console',5,.25],['plant',6.75,1.5],['lamp',5.75,2.25]]},
bedroom:{name:'Bedroom',icon:'🛏️',w:7,d:7,pieces:['bed','nightstand','wardrobe','console','rug','lamp','mirror','plant','ottoman','bookshelf'],
 start:[['rug',1.5,3.25],['bed',2,.25],['nightstand',1.1,.25],['nightstand',4.65,.25],['wardrobe',.2,4.2,1],['lamp',6,.4],['plant',6,5.9]]},
kitchen:{name:'Kitchen',icon:'🍳',w:7,d:6,pieces:['counter','sink','stove','fridge','table','stool','plant','flowers','rug'],
 start:[['fridge',.2,.2],['counter',1.2,.2],['sink',3.2,.2],['stove',4.7,.2],['table',2.5,3],['stool',2.6,4.4],['stool',3.65,4.4],['flowers',6,4.9]]},
bathroom:{name:'Bathroom',icon:'🛁',w:5,d:5,pieces:['tub','toilet','vanity','mat','plant','mirror','flowers'],
 start:[['tub',.2,.2],['toilet',3.1,.2],['vanity',.2,2.2,1],['mat',1.6,2.4],['plant',4,4]]},
game:{name:'Game room',icon:'🕹️',w:8,d:7,pieces:['arcade','gametable','beanbag','tv','sofa','rug','bookshelf','lamp'],
 start:[['rug',2.25,1.25],['tv',3,.2],['arcade',.2,.2],['arcade',6.8,.2],['beanbag',2.5,2],['beanbag',4.25,2],['gametable',2.5,4.6]]},
closet:{name:'Walk-in closet',icon:'👗',w:5,d:4,pieces:['rack','shoes','mirror','ottoman','rug','wardrobe','lightmirror'],
 start:[['rack',1.3,.2],['rack',.2,1.2,1],['shoes',3.3,1.4,1],['mirror',4.3,.2],['ottoman',2.1,2.1]]},
beauty:{name:'Beauty parlor',icon:'💅',w:7,d:6,pieces:['salon','dryer','lightmirror','nails','flowers','sofa','plant','ottoman'],
 start:[['lightmirror',.7,.2],['lightmirror',2.9,.2],['salon',.95,1],['salon',3.15,1],['dryer',5.4,.3],['nails',3.5,3.8],['ottoman',3.85,4.8],['flowers',6,5]]},
studio:{name:'Art studio',icon:'🎨',w:6,d:6,pieces:['easel','painttable','bookshelf','rug','stool','plant','lamp','ottoman'],
 start:[['rug',1,2.5],['bookshelf',.2,.2],['painttable',3.5,.2],['easel',2.2,2.1],['stool',2.3,3.4],['plant',5,5]]}
};

const PROMPTS=['A cozy reading nook for a rainy afternoon','A room where everything is pink','A castle bedroom fit for a princess cow','A tiny shop that sells only flowers','A beauty parlor for very fancy pets','A kitchen where you would bake birthday cakes','Mix two collections in one room','A moonlit room for a midnight party','Use every color of the rainbow','A room your grandma would love','A game room for a sleepover','A closet for someone who loves shoes','A garden party in the backyard','A bathroom fit for a mermaid','A house with five different wallpapers','A yard with a secret path to a pond','A room with only three pieces','A painter\'s studio with your own art on the wall','A picnic spot under the blossom trees','A house where the cow is the boss'];

const COW_LINES=['Moo! I only just learned to talk, and I already love this place.','Hi! It\'s me, Cow. Remember me from the island?','Moo-velous choice!','Is that pouf for me? Asking for a friend.','You have an eye for color, design boss.','This is the coziest barn I have ever seen.','Moo! Turn me around with the R key.','I think this needs more flowers. Cows love flowers.','Can we try the moonlit light? I like to stargaze.','Every room is better with a cow in it. That is science.','I would like to vote for more wallpaper.'];
const CAT_LINES=['Zzz... the cat is dreaming about this rug.','The cat opened one eye. It approves.','Purrr. Do not disturb.','The cat stretched, yawned, and went back to sleep.'];

// Cow, the island guide. keys are words a kid might type; act is what "Show me" does.
const GUIDE=[
{q:'How do I put furniture in a room?',keys:['furniture','put','place','add a piece','sofa','bed','shelf','chair','table','lamp','decorate'],views:['room'],a:'Pick something from the shelf, then tap an open spot on the floor. A green outline means it fits! Red means something is in the way.',act:'room'},
{q:'How do I move or turn things?',keys:['move','drag','turn','rotate','spin','around','push'],views:['room','yard','isle'],a:'Tap a piece and drag it where you want. Press Turn, or the R key, to spin it around.'},
{q:'How do I change a color?',keys:['color','colour','recolor','pink','purple','blue','green'],views:['room','yard','isle'],a:'Tap the piece, then tap any color dot under the picture. The rainbow dot lets you pick ANY color in the whole world.'},
{q:'How do I change the wallpaper and floor?',keys:['wallpaper','wall','walls','paint the wall','wall color','floor','floors','floor color','pattern','carpet','tile','stripes','hearts','dots'],views:['room'],a:'Inside a room, look at Walls & Floors on the left. Pick a wallpaper, a pattern color, a floor and a floor color. Mix them however you like!',act:'finishes'},
{q:'How do I paint my own picture?',keys:['paint','picture','art','draw','easel','drawing','painting'],views:['room'],a:'Press Paint wall art. Draw with the brushes and stamps, then press Hang it on the wall. Your painting shows up on every easel in that room too!',act:'art'},
{q:'How do I add a new room?',keys:['room','kitchen','bathroom','bedroom','closet','beauty','parlor','game room','studio','add room','new room'],views:['house','room'],a:'Tap Whole house, pick a room from the shelf, then tap an empty spot next to your house. Moo-gic!',act:'house'},
{q:'How do I make a room bigger?',keys:['bigger','smaller','size','resize','wider','longer','huge','tiny'],views:['house'],a:'In Whole house, tap a room. Then use the Width and Depth + and − buttons under the plan.',act:'house'},
{q:'How do I go inside a room?',keys:['inside','enter','go in','walk in','open room'],views:['house'],a:'Double-tap a room in Whole house, or tap its name in the room list on the left.',act:'house'},
{q:'How do I decorate outside?',keys:['outside','yard','garden','fence','patio','tree','pool','roof','door','house color','grass'],views:['yard','house'],a:'Tap Outside. Paint the house, roof and front door on the left, then add fences, trees, patios and a pool from the shelf.',act:'yard'},
{q:'What is the island?',keys:['island','village','town','neighbor','neighbour','beach','ocean','sea','isle'],views:['isle','yard','house','room'],a:'Every home you build lives on our island village! Tap Island to see them all together, then add a lighthouse, a market stall or a sailboat.',act:'isle'},
{q:'How do I build another house?',keys:['another house','new house','new home','build a house','second house','more houses'],views:['isle','yard','house'],a:'Press New home. Your new house gets its very own spot on the island, right next to the neighbors.',act:'newhome'},
{q:'How do I move houses on the island?',keys:['move house','arrange','where the house','island layout','swap'],views:['isle'],a:'On the Island, drag a house by its yard to a new spot. Double-tap a house to go visit it.',act:'isle'},
{q:'Can I make it nighttime?',keys:['light','night','dark','sunset','golden','moon','stars','evening','day'],views:['room','yard','isle'],a:'Yes! Use the Light menu on the left. Moonlit evening makes the lamps glow, and starry night lights up every window.'},
{q:'Oops! How do I undo?',keys:['undo','oops','mistake','back','wrong','uh oh','accident'],views:['room','house','yard','isle'],a:'Press Undo at the top. You can undo lots and lots of steps, so don\'t worry.'},
{q:'How do I delete something?',keys:['delete','remove','trash','get rid','throw away','erase'],views:['room','yard','isle'],a:'Tap it, then press Remove. Changed your mind? Press Undo and it comes right back.'},
{q:'How do I save my design?',keys:['save','keep','photo','download','print','show','share'],views:['room','house','yard','isle'],a:'Everything saves on this device all by itself. To keep a picture to print or show someone, press Save picture at the top.'},
{q:'Can you give me an idea?',keys:['idea','bored','what should','help me think','inspire','suggest'],views:['room','house','yard','isle'],a:'',act:'idea'},
{q:'Who are you?',keys:['who','your name','cow','talk','friend','hello','hi '],views:['isle','room','house','yard'],a:'I\'m Cow! I only just learned to talk, so now I can\'t stop. I live on the island, I love flowers and cozy rugs, and I love helping you design.'}
];
