'use strict';
/* ============================================================
   NEON VAULT '84 — сервер изометрического co-op heist-шутера
   Авторитарная симуляция: LAN-мультиплеер (WebSocket), боты-
   напарники, ИИ охраны/полиции, стелс, дрели, заложники, волны.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

/* ---------------- HTTP: статика ---------------- */
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.jpg':'image/jpeg', '.png':'image/png', '.md':'text/markdown; charset=utf-8' };
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/public/index.html';
  else if (!url.startsWith('/concepts/') && !url.startsWith('/public/')) url = '/public' + url;
  const file = path.join(__dirname, url);
  if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });

/* ---------------- Утилиты ---------------- */
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const dist = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const rand = (a,b)=>a+Math.random()*(b-a);
const randi = (a,b)=>Math.floor(rand(a,b+1));
const choice = arr=>arr[Math.floor(Math.random()*arr.length)];
const angTo = (a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
function angDiff(a,b){ let d=(a-b)%(Math.PI*2); if(d>Math.PI)d-=Math.PI*2; if(d<-Math.PI)d+=Math.PI*2; return d; }
const TILE = { FLOOR:0, WALL:1, COVER:2, STREET:3, RESTRICT:4, VAULTDOOR:6 };

/* ---------------- Баланс/контент ---------------- */
const MASKS = {
  tiger:{ name:'ТИГР',  color:'#FF2E9A', desc:'+15% к урону',          dmg:1.15, speed:1.0,  hp:100, armor:50, interact:1.0,  detect:1.0 },
  wolf: { name:'ВОЛК',  color:'#00E5FF', desc:'+12% к скорости',       dmg:1.0,  speed:1.12, hp:100, armor:50, interact:1.0,  detect:1.0 },
  panda:{ name:'ПАНДА', color:'#B388FF', desc:'+30 HP и брони',        dmg:1.0,  speed:0.97, hp:130, armor:80, interact:1.0,  detect:1.05},
  shark:{ name:'АКУЛА', color:'#FFD319', desc:'стелс + скорость действий', dmg:1.0, speed:1.05, hp:100, armor:40, interact:1.35, detect:0.65},
};
const WEAPONS = {
  rifle:  { name:'Винтовка «VICE-15»', dmg:13, rof:7.5, mag:30, spread:0.035, reload:1.6, pellets:1, bs:30, auto:true },
  smg:    { name:'ПП «MIAMI-9»',      dmg:8,  rof:12,  mag:40, spread:0.075, reload:1.4, pellets:1, bs:28, auto:true },
  shotgun:{ name:'Дробовик «ГРОМ-12»',dmg:7,  rof:1.5, mag:6,  spread:0.15,  reload:2.2, pellets:6, bs:24, auto:true },
};
const ENEMY_TYPES = {
  cop:  { hp:40,  speed:2.5, dmg:6,  range:7,   rof:1.6, spread:0.14, name:'Полицейский' },
  swat: { hp:85,  speed:2.7, dmg:8,  range:8.5, rof:3.2, spread:0.10, name:'SWAT' },
  fbi:  { hp:65,  speed:3.2, dmg:9,  range:9,   rof:3.6, spread:0.07, name:'Агент FBI' },
  shield:{ hp:150,speed:2.0, dmg:7,  range:6,   rof:2.0, spread:0.12, name:'SWAT со щитом' },
  dozer:{ hp:950, speed:1.55,dmg:7,  range:5.2, rof:1.1, spread:0.16, pellets:5, name:'НЕОНОВЫЙ БЫК' },
};
const LOOT_TYPES = {
  money:  { name:'деньги',  value:60000,  slow:0.78, color:'#2EFF8B' },
  gold:   { name:'золото',  value:95000,  slow:0.62, color:'#FFD319' },
  jewelry:{ name:'украшения', value:40000, slow:0.9,  color:'#FF8AFF' },
  chips:  { name:'фишки казино', value:50000, slow:0.8, color:'#00E5FF' },
};
const BOT_NAMES = ['ДЖЕТ','МИРАЖ','КОБАЛЬТ','ФЛАМИНГО'];

/* ---------------- Карты ограблений (прямоугольная авторская разметка) ----------------
   walls/covers: [x,y,w,h,(type)] · loot: [x,y,type,count] · cams: [x,y,angle,sweep] */
const HEISTS = [
{
  id:'bank', name:'БАНК «VICE CITY BANK»', sub:'Классика: хранилище, дрель, 4 сумки минимум', w:34, h:24, required:4, vaultTime:60,
  street:[[0,20,34,4]], escape:{x:15,y:20,w:4,h:3},
  restrict:[[1,1,32,10],[3,12,28,2]],
  walls:[[0,19,3,1],[4,19,12,1],[18,19,12,1],[31,19,3,1],
         [1,11,7,1],[9,11,16,1],[26,11,7,1],
         [1,6,4,1],[6,6,10,1],[17,6,16,1],[10,1,1,5],[22,1,1,5]],
  covers:[[4,14,9,1,'counter'],[21,14,9,1,'counter'],[5,17,3,1,'desk'],[26,17,3,1,'desk'],
          [2,12,1,1,'plant'],[31,12,1,1,'plant'],[2,18,1,1,'plant'],[31,18,1,1,'plant'],
          [3,3,3,1,'desk'],[13,2,3,1,'desk'],[17,4,3,1,'desk'],[11,16,3,1,'desk'],[20,16,3,1,'desk']],
  playerSpawns:[[15,21],[16,22],[18,21],[19,22]],
  entries:[[2,21],[31,21],[16,22]],
  guards:[[8,16],[25,17],[14,8],[28,9]],
  civs:[[6,15],[11,17],[19,15],[23,18],[28,15],[15,13],[9,18],[30,17]],
  cams:[[16,18,Math.PI/2,0.8],[2,12,0,0.9],[31,7,Math.PI,0.7],[5,7,0,0.7]],
  panel:[1,1], vaultDoor:[27,6],
  safes:[[21,1,'money',25],[12,10,'money',20],[20,10,'money',20],[32,1,'gold',30],[1,13,'money',15],[32,13,'money',15]],
  loot:[[24,2,'money',1],[26,1,'money',1],[28,2,'money',1],[30,1,'money',1],[31,3,'money',1],[25,4,'gold',1],[29,4,'gold',1]],
  signs:[[9,19,'VICE CITY BANK','#FF2E9A'],[24,11,'ХРАНИЛИЩЕ →','#00E5FF'],[4,6,'SECURITY','#FFD319'],[13,11,'1984 · TRUST IN US','#FF8AFF']],
},
{
  id:'jewelry', name:'ЮВЕЛИРНЫЙ «Diamonds on Ocean»', sub:'Быстрый налёт: витрины, сейфы, 5 сумок', w:28, h:20, required:5, vaultTime:40,
  street:[[0,17,28,3]], escape:{x:12,y:17,w:4,h:2},
  restrict:[[1,1,26,7]],
  walls:[[0,16,4,1],[5,16,8,1],[15,16,8,1],[24,16,4,1],
         [1,8,5,1],[7,8,14,1],[22,8,5,1],
         [1,5,3,1],[5,5,4,1],[9,1,1,4],[17,1,1,4],[17,5,10,1]],
  covers:[[4,11,4,1,'case'],[10,13,4,1,'case'],[16,11,4,1,'case'],[22,13,3,1,'case'],[6,14,3,1,'case'],
          [2,10,1,1,'plant'],[25,10,1,1,'plant'],[3,2,3,1,'desk']],
  playerSpawns:[[12,18],[13,17],[15,18],[14,17]],
  entries:[[2,17],[25,17],[13,18]],
  guards:[[7,12],[20,14],[14,6]],
  civs:[[5,12],[12,11],[19,13],[24,12],[9,15],[21,9]],
  cams:[[13,15,Math.PI/2,0.8],[2,9,0,0.9],[25,6,Math.PI,0.7]],
  panel:[1,1], vaultDoor:[22,5],
  safes:[[8,1,'jewelry',20],[13,7,'jewelry',18],[26,1,'gold',25]],
  loot:[[5,11,'jewelry',2],[11,13,'jewelry',2],[17,11,'jewelry',2],[23,13,'jewelry',2],[19,2,'gold',1],[24,2,'gold',1],[21,3,'jewelry',1],[25,3,'jewelry',1]],
  signs:[[8,16,'Diamonds on Ocean','#00E5FF'],[19,8,'SECURITY','#FFD319'],[11,16,'-50% СЕГОДНЯ','#FF2E9A']],
},
{
  id:'casino', name:'КАЗИНО «NEON PALMS»', sub:'Большой куш: фишки, касса, хранилище. 6 сумок', w:36, h:24, required:6, vaultTime:70,
  street:[[0,21,36,3]], escape:{x:16,y:21,w:4,h:2},
  restrict:[[1,1,34,8]],
  walls:[[0,20,5,1],[6,20,11,1],[19,20,11,1],[31,20,5,1],
         [1,9,7,1],[9,9,18,1],[28,9,7,1],
         [13,1,1,4],[23,1,1,4],[13,5,11,1],
         [24,5,4,1],[29,5,6,1],[1,5,5,1],[7,5,6,1]],
  covers:[[4,12,4,2,'table'],[11,15,4,2,'table'],[20,12,4,2,'table'],[27,15,4,2,'table'],[15,17,5,1,'table'],
          [1,13,1,4,'slot'],[34,12,1,4,'slot'],[28,18,6,1,'counter'],[3,18,5,1,'counter'],
          [26,2,3,1,'desk'],[2,12,1,1,'plant'],[33,17,1,1,'plant']],
  playerSpawns:[[16,22],[17,21],[19,22],[18,21]],
  entries:[[2,21],[33,21],[17,22]],
  guards:[[8,14],[25,13],[17,17],[10,7],[30,7]],
  civs:[[5,14],[10,12],[13,16],[19,14],[22,17],[26,12],[30,16],[7,17],[24,19],[12,19],[32,13],[16,11]],
  cams:[[17,19,Math.PI/2,0.8],[3,10,0,0.9],[32,10,Math.PI,0.9],[18,7,Math.PI/2,0.7]],
  panel:[34,1], vaultDoor:[18,5],
  safes:[[1,1,'money',22],[22,1,'gold',30],[33,8,'chips',20]],
  loot:[[15,2,'money',1],[18,1,'money',1],[21,2,'money',1],[16,3,'gold',1],[20,3,'gold',1],
        [31,7,'chips',2],[3,2,'money',1],[8,2,'money',1],[30,3,'chips',1]],
  signs:[[10,20,'NEON PALMS CASINO','#FF2E9A'],[24,9,'JACKPOT $1M','#FFD319'],[5,9,'BAR · 24H','#00E5FF'],[16,9,'УДАЧИ!','#FF8AFF']],
},
];

/* ---------------- Построение сетки ---------------- */
function buildMap(def){
  const { w,h } = def;
  const grid = new Array(w*h).fill(TILE.FLOOR);
  const coverType = {};
  const set = (x,y,v)=>{ if(x>=0&&y>=0&&x<w&&y<h) grid[y*w+x]=v; };
  const rect = (r,v)=>{ for(let y=r[1];y<r[1]+r[3];y++) for(let x=r[0];x<r[0]+r[2];x++) set(x,y,v); };
  def.street.forEach(r=>rect(r,TILE.STREET));
  def.restrict.forEach(r=>rect(r,TILE.RESTRICT));
  for(let x=0;x<w;x++){ set(x,0,TILE.WALL); set(x,h-1,TILE.WALL); }
  for(let y=0;y<h;y++){ set(0,y,TILE.WALL); set(w-1,y,TILE.WALL); }
  def.walls.forEach(r=>rect(r,TILE.WALL));
  def.covers.forEach(r=>{ rect(r,TILE.COVER); for(let y=r[1];y<r[1]+r[3];y++)for(let x=r[0];x<r[0]+r[2];x++) coverType[x+','+y]=r[4]||'desk'; });
  set(def.vaultDoor[0], def.vaultDoor[1], TILE.VAULTDOOR);
  set(def.panel[0], def.panel[1], TILE.COVER); coverType[def.panel[0]+','+def.panel[1]]='panel';
  def.safes.forEach(s=>{ set(s[0],s[1],TILE.COVER); coverType[s[0]+','+s[1]]='safe'; });
  return { grid, coverType };
}

/* ---------------- Состояние игры ---------------- */
let nextClientId = 1, nextEntId = 1;
const clients = new Map(); // id -> {id, ws, name, mask, weapon}
let G = null; // текущее ограбление

function solidAt(G, tx, ty){
  if(tx<0||ty<0||tx>=G.def.w||ty>=G.def.h) return true;
  const t = G.grid[ty*G.def.w+tx];
  if(t===TILE.WALL||t===TILE.COVER) return true;
  if(t===TILE.VAULTDOOR && !G.vaultOpen) return true;
  return false;
}
function los(G, ax, ay, bx, by){
  const d = Math.hypot(bx-ax,by-ay), steps = Math.max(1,Math.ceil(d/0.2));
  for(let i=1;i<steps;i++){
    const x = ax+(bx-ax)*i/steps, y = ay+(by-ay)*i/steps;
    if(solidAt(G, Math.floor(x), Math.floor(y))) return false;
  }
  return true;
}
function moveEntity(G, e, dx, dy){
  const r = e.r || 0.32;
  let nx = e.x+dx;
  if(!solidAt(G,Math.floor(nx+Math.sign(dx)*r),Math.floor(e.y-r*0.7)) && !solidAt(G,Math.floor(nx+Math.sign(dx)*r),Math.floor(e.y+r*0.7))) e.x=nx;
  let ny = e.y+dy;
  if(!solidAt(G,Math.floor(e.x-r*0.7),Math.floor(ny+Math.sign(dy)*r)) && !solidAt(G,Math.floor(e.x+r*0.7),Math.floor(ny+Math.sign(dy)*r))) e.y=ny;
  e.x = clamp(e.x, 0.5, G.def.w-0.5); e.y = clamp(e.y, 0.5, G.def.h-0.5);
}
function nearestFloor(G, x, y){
  if(!solidAt(G,x,y)) return {x:x+0.5,y:y+0.5};
  for(let r=1;r<8;r++) for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++)
    if(!solidAt(G,x+dx,y+dy)) return {x:x+dx+0.5,y:y+dy+0.5};
  return {x:x+0.5,y:y+0.5};
}
function inRect(e, r){ return e.x>=r.x && e.x<r.x+r.w && e.y>=r.y && e.y<r.y+r.h; }
function tileAt(G,e){ return G.grid[Math.floor(e.y)*G.def.w+Math.floor(e.x)]; }

/* A* по сетке */
function findPath(G, sx, sy, tx, ty){
  sx=Math.floor(sx); sy=Math.floor(sy); tx=Math.floor(tx); ty=Math.floor(ty);
  if(solidAt(G,tx,ty)){ const f=nearestFloor(G,tx,ty); tx=Math.floor(f.x); ty=Math.floor(f.y); }
  const W=G.def.w, key=(x,y)=>y*W+x;
  const open=new Map(), came=new Map(), gs=new Map();
  const h=(x,y)=>Math.abs(x-tx)+Math.abs(y-ty);
  gs.set(key(sx,sy),0); open.set(key(sx,sy),{x:sx,y:sy,f:h(sx,sy)});
  const closed=new Set();
  let guard=0;
  while(open.size && guard++<3000){
    let cur=null, ck=null;
    for(const [k,v] of open){ if(!cur||v.f<cur.f){cur=v;ck=k;} }
    open.delete(ck); closed.add(ck);
    if(cur.x===tx&&cur.y===ty){
      const path=[]; let k=ck, cx=cur.x, cy=cur.y;
      while(k!==undefined){ path.unshift({x:cx+0.5,y:cy+0.5}); const p=came.get(k); if(!p)break; cx=p.x; cy=p.y; k=key(cx,cy); if(cx===sx&&cy===sy){path.unshift({x:cx+0.5,y:cy+0.5});break;} }
      return path;
    }
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=cur.x+dx, ny=cur.y+dy, nk=key(nx,ny);
      if(closed.has(nk)||solidAt(G,nx,ny)) continue;
      const ng=(gs.get(ck)??1e9)+1;
      if(ng<(gs.get(nk)??1e9)){ gs.set(nk,ng); came.set(nk,{x:cur.x,y:cur.y}); open.set(nk,{x:nx,y:ny,f:ng+h(nx,ny)}); }
    }
  }
  return null;
}
/* Движение сущности вдоль пути; возвращает true по прибытии */
function followPath(G, e, dt, speed){
  if(!e.path || e.pathI>=e.path.length) return true;
  const t = e.path[e.pathI];
  const d = Math.hypot(t.x-e.x, t.y-e.y);
  if(d<0.15){ e.pathI++; return e.pathI>=e.path.length; }
  // пропускаем точки с прямой видимостью
  while(e.pathI+1<e.path.length && los(G,e.x,e.y,e.path[e.pathI+1].x,e.path[e.pathI+1].y)) e.pathI++;
  const tt = e.path[e.pathI];
  const a = Math.atan2(tt.y-e.y, tt.x-e.x);
  e.face = a;
  moveEntity(G, e, Math.cos(a)*speed*dt, Math.sin(a)*speed*dt);
  e.moving = true;
  return false;
}
function pathTo(G, e, tx, ty){ e.path = findPath(G, e.x, e.y, tx, ty); e.pathI = 0; }

/* ---------------- События/лог ---------------- */
function broadcast(obj){ const s=JSON.stringify(obj); for(const c of clients.values()) if(c.ws.readyState===1) c.ws.send(s); }
function ev(kind, msg, x, y){ broadcast({t:'ev', k:kind, msg:msg||'', x:x??null, y:y??null}); if(msg) console.log('  ·', msg); }

/* ---------------- Запуск ограбления ---------------- */
function startHeist(defId){
  const def = HEISTS.find(h=>h.id===defId) || HEISTS[0];
  const { grid, coverType } = buildMap(def);
  G = {
    def, grid, coverType, time:0, phase:'heist', alarm:false, vaultOpen:false,
    heisters:[], guards:[], civs:[], enemies:[], bullets:[], bags:[], drops:[],
    cams:[], lootPts:[], drills:[], secured:0, securedValue:0, kills:0, civKilled:0,
    pagersAnswered:0, camsDisabled:false, botMode:'auto', end:null,
    assault:{ state:'none', t:0, wave:0, spawnT:0, dozerSpawned:false },
    noise:[], maxDetect:0, anyMasked:false,
  };
  // грабители: люди + боты до 4
  const humans = [...clients.values()];
  const maskKeys = Object.keys(MASKS), weaponKeys = Object.keys(WEAPONS);
  for(let i=0;i<4;i++){
    const c = humans[i];
    const sp = nearestFloor(G, def.playerSpawns[i][0], def.playerSpawns[i][1]);
    const maskId = c ? (c.mask||maskKeys[i]) : maskKeys[i];
    const m = MASKS[maskId];
    const wpnId = c ? (c.weapon||'rifle') : choice(weaponKeys);
    const w = WEAPONS[wpnId];
    G.heisters.push({
      id: nextEntId++, name: c?c.name:BOT_NAMES[i], isBot:!c, ctrl: c?c.id:null, slot:i,
      mask:maskId, weapon:wpnId, x:sp.x, y:sp.y, r:0.32, face:-Math.PI/2, aim:-Math.PI/2,
      hp:m.hp, maxhp:m.hp, armor:m.armor, maxarmor:m.armor, lastDmg:-9,
      masked:false, maskT:0, downed:false, bleed:0, escaped:false, carry:null,
      mag:w.mag, reserve:w.mag*5, reloadT:0, fireCd:0, meleeCd:0, ties:4,
      crouch:false, sprint:false, moving:false, crime:false, ix:null, ixP:0,
      input:{mx:0,my:0,aimx:sp.x,aimy:sp.y-3,shoot:false,interact:false,sprint:false,crouch:false},
      bot:{ think:rand(0,0.3), path:null, pathI:0, goal:null, burst:0, burstCd:0, strafeDir:1, strafeT:0 },
    });
  }
  def.guards.forEach(p=>{ const s=nearestFloor(G,p[0],p[1]); G.guards.push({ id:nextEntId++, x:s.x,y:s.y,r:0.32,hp:35, face:rand(0,6.28), state:'patrol', path:null,pathI:0, repath:rand(0,2), detect:0, detectId:null, radio:0, fireCd:0, dead:false, pager:null, moving:false }); });
  def.civs.forEach(p=>{ const s=nearestFloor(G,p[0],p[1]); G.civs.push({ id:nextEntId++, x:s.x,y:s.y,r:0.3,hp:20, face:rand(0,6.28), state:'idle', downT:0, panicT:0, path:null,pathI:0, dead:false, moving:false, hue:randi(0,360) }); });
  def.cams.forEach(c=>G.cams.push({ id:nextEntId++, x:c[0]+0.5, y:c[1]+0.5, base:c[2], sweep:c[3], angle:c[2], t:rand(0,6), detect:0, detectId:null }));
  G.drills.push({ id:nextEntId++, kind:'vault', x:def.vaultDoor[0]+0.5, y:def.vaultDoor[1]+0.5, state:'idle', p:0, total:def.vaultTime, jams:[0.35,0.72] });
  def.safes.forEach(s=>G.drills.push({ id:nextEntId++, kind:'safe', x:s[0]+0.5, y:s[1]+0.5, lootType:s[2], state:'idle', p:0, total:s[3], jams:[0.55] }));
  def.loot.forEach(l=>G.lootPts.push({ id:nextEntId++, x:l[0]+0.5, y:l[1]+0.5, type:l[2], left:l[3] }));
  broadcast({ t:'heist', map:{ w:def.w, h:def.h, grid, coverType, escape:def.escape, signs:def.signs, name:def.name,
    entries:def.entries, panel:{x:def.panel[0]+0.5,y:def.panel[1]+0.5}, vaultDoor:{x:def.vaultDoor[0]+0.5,y:def.vaultDoor[1]+0.5}, required:def.required }});
  ev('info', '🎭 Ограбление началось: '+def.name+'. Вы в штатском — осмотритесь. G — надеть маску.');
  console.log('▶ Ограбление:', def.name, '| игроков:', humans.length, '| ботов:', 4-humans.length);
}

/* ---------------- Шум и тревога ---------------- */
function emitNoise(x,y,r,kind){ if(G) G.noise.push({x,y,r,kind}); }
function triggerAlarm(src){
  if(!G || G.alarm) return;
  G.alarm = true;
  G.assault = { state:'assault', t:55, wave:1, spawnT:1.2, dozerSpawned:false };
  for(const h of G.heisters) if(!h.masked && !h.escaped){ h.masked=true; }
  ev('alarm', '🚨 ТРЕВОГА! '+(src||'')+' Полиция уже едет — занимайте оборону!');
}
function isSuspicious(G,h){
  if(h.escaped||h.downed) return false;
  if(h.masked||h.carry||h.crime) return true;
  return tileAt(G,h)===TILE.RESTRICT;
}
function observerDetect(obs, range, fov, isCam){
  let best=null, bestRate=0;
  for(const h of G.heisters){
    if(h.escaped||h.downed) continue;
    const d = dist(obs,h);
    if(d>range) continue;
    if(Math.abs(angDiff(angTo(obs,h), isCam?obs.angle:obs.face)) > fov/2) continue;
    if(!los(G,obs.x,obs.y,h.x,h.y)) continue;
    let rate = 0;
    if(isSuspicious(G,h)){
      rate = 1.5*(1.35 - d/range);
      if(h.crouch) rate*=0.5;
      rate *= MASKS[h.mask].detect;
      if(h.isBot) rate*=0.55;
      if(!h.masked && tileAt(G,h)===TILE.RESTRICT && !h.crime) rate*=0.45; // в служебной зоне без маски — медленнее палят
    }
    // труп в поле зрения
    if(rate<=0){
      for(const g of G.guards) if(g.dead && dist(obs,g)<range && Math.abs(angDiff(angTo(obs,g), isCam?obs.angle:obs.face))<fov/2 && los(G,obs.x,obs.y,g.x,g.y)) rate=Math.max(rate,0.9);
    }
    if(rate>bestRate){ bestRate=rate; best=h.id; }
  }
  if(bestRate>0){ obs.detect=Math.min(1,obs.detect+bestRate*(1/30)); obs.detectId=best; }
  else obs.detect=Math.max(0,obs.detect-0.22*(1/30));
  return obs.detect;
}

/* ---------------- Взаимодействие (E) ---------------- */
function findInteract(h){
  if(h.downed||h.escaped) return null;
  const near=(x,y,r)=>Math.hypot(h.x-x,h.y-y)<=r;
  // поднять своего
  for(const t of G.heisters) if(t!==h && t.downed && !t.custody && !t.escaped && near(t.x,t.y,1.5))
    return { key:'rev:'+t.id, label:'Поднять '+t.name, need:3.5, run:()=>{ t.downed=false; t.hp=Math.max(t.hp,t.maxhp*0.4); t.armor=t.maxarmor*0.5; ev('good','💉 '+t.name+' снова в строю!',t.x,t.y); } };
  // пейджер охранника
  if(h.masked) for(const g of G.guards) if(g.dead && g.pager==='ring' && near(g.x,g.y,1.5))
    return { key:'pag:'+g.id, label:'Ответить на пейджер', need:2, run:()=>{ g.pager='answered'; G.pagersAnswered++; ev('good','📟 Пейджер: «Всё спокойно» ('+G.pagersAnswered+'/4)',g.x,g.y); } };
  // дрели: установка/починка
  if(h.masked) for(const d of G.drills){
    if(d.state==='idle' && near(d.x,d.y,1.9)) return { key:'drill:'+d.id, label: d.kind==='vault'?'Установить дрель на хранилище':'Установить дрель на сейф', need:3, crime:true, run:()=>{ d.state='drilling'; ev('info','🔩 Дрель работает! '+(d.kind==='vault'?'Хранилище':'Сейф')+': ~'+d.total+' сек.',d.x,d.y); emitNoise(d.x,d.y,9,'drill'); } };
    if(d.state==='jammed' && near(d.x,d.y,1.9)) return { key:'fix:'+d.id, label:'Починить дрель', need:3, crime:true, run:()=>{ d.state='drilling'; ev('info','🔧 Дрель снова в деле!',d.x,d.y); } };
  }
  // панель камер
  const p = G.def.panel;
  if(h.masked && !G.camsDisabled && near(p[0]+0.5,p[1]+0.5,1.8))
    return { key:'panel', label:'Отключить камеры', need:4, crime:true, run:()=>{ G.camsDisabled=true; ev('good','📷 Камеры отключены!',p[0],p[1]); } };
  // паковать лут
  if(h.masked) for(const l of G.lootPts) if(l.left>0 && near(l.x,l.y,1.8))
    return { key:'loot:'+l.id, label:'Паковать: '+LOOT_TYPES[l.type].name, need:2, crime:true, run:()=>{ l.left--; spawnBag(l.x,l.y,l.type,h); } };
  // связать заложника
  if(h.masked && h.ties>0) for(const c of G.civs) if(!c.dead && c.state==='down' && near(c.x,c.y,1.4))
    return { key:'tie:'+c.id, label:'Связать заложника (стяжек: '+h.ties+')', need:1.5, run:()=>{ c.state='tied'; h.ties--; ev('info','🧎 Заложник связан. Полиция будет осторожнее.',c.x,c.y); } };
  // подобрать сумку
  if(h.masked && !h.carry) for(const b of G.bags) if(!b.carriedBy && near(b.x,b.y,1.2))
    return { key:'bag:'+b.id, label:'Взять сумку ('+LOOT_TYPES[b.type].name+')', need:0.35, run:()=>{ b.carriedBy=h.id; h.carry=b.id; } };
  return null;
}
function spawnBag(x,y,type,carrier){
  const b = { id:nextEntId++, x, y, type, value:LOOT_TYPES[type].value, carriedBy:null };
  if(carrier && !carrier.carry){ b.carriedBy=carrier.id; carrier.carry=b.id; }
  else { const f=nearestFloor(G,Math.floor(x),Math.floor(y)); b.x=f.x; b.y=f.y; }
  G.bags.push(b);
  ev('bag','💰 Сумка готова: '+LOOT_TYPES[type].name+' ($'+(b.value/1000)+'k). Несите к фургону!',x,y);
}

/* ---------------- Стрельба ---------------- */
function shoot(e, angle, dmg, speed, from, pellets, spread){
  for(let i=0;i<(pellets||1);i++){
    const a = angle + rand(-spread,spread);
    G.bullets.push({ id:nextEntId++, x:e.x+Math.cos(angle)*0.45, y:e.y+Math.sin(angle)*0.45, vx:Math.cos(a)*speed, vy:Math.sin(a)*speed, dmg, from, owner:e.id, life:1.4, trav:0 });
  }
}
function damageHeister(h, dmg){
  if(h.downed||h.escaped) return;
  h.lastDmg = G.time;
  if(h.armor>0){ const absorbed=Math.min(h.armor,dmg); h.armor-=absorbed; dmg-=absorbed; }
  h.hp -= dmg;
  if(h.hp<=0){ h.hp=0; h.downed=true; h.bleed=25; dropBag(h); ev('bad','🆘 '+h.name+' ранен и не может встать! Поднимите его (E)!',h.x,h.y); }
}
function dropBag(h){
  if(!h.carry) return;
  const b = G.bags.find(b=>b.id===h.carry);
  if(b){ b.carriedBy=null; b.x=h.x; b.y=h.y; }
  h.carry=null;
}
function killGuard(g, byId){
  g.dead=true; g.state='dead'; G.kills++;
  if(!G.alarm){ g.pager='ring'; g.pagerT=12; ev('pager','📟 Пейджер охранника пищит! Ответьте за 12 сек (E у тела)!',g.x,g.y); }
}
function killEnemy(e){
  G.kills++;
  if(Math.random()<0.35) G.drops.push({ id:nextEntId++, x:e.x, y:e.y, kind:'ammo', t:40 });
  if(e.type==='dozer') ev('good','🎉 НЕОНОВЫЙ БЫК повержен!',e.x,e.y);
}

/* ---------------- ИИ ботов-напарников ---------------- */
function botThink(h, dt){
  const b = h.bot, inp = h.input;
  inp.shoot=false; inp.interact=false;
  b.think -= dt;
  // целимся/стреляем по видимому врагу
  let foe=null, foeD=1e9;
  const foes = [...G.enemies, ...(G.alarm?G.guards.filter(g=>!g.dead):[])];
  for(const e of foes){ const d=dist(h,e); if(d<foeD && d<11 && los(G,h.x,h.y,e.x,e.y)){ foe=e; foeD=d; } }
  if(foe && h.masked){
    inp.aimx = foe.x; inp.aimy = foe.y;
    b.burstCd -= dt;
    if(b.burst>0){ inp.shoot=true; b.burst-=dt; if(b.burst<=0) b.burstCd=rand(0.4,1.1); }
    else if(b.burstCd<=0) b.burst=rand(0.4,0.9);
  }
  if(b.think>0 && b.goal){ moveBotToward(h, dt); if(b.goalAct==='interact' && Math.hypot(h.x-b.goal.x,h.y-b.goal.y)<1.7) inp.interact=true; if(h.mag===0) startReload(h); return; }
  b.think = 0.3;
  b.goal=null; b.goalAct=null;
  const humans = G.heisters.filter(t=>!t.isBot && !t.escaped);
  const leader = humans.sort((a,c)=>dist(h,a)-dist(h,c))[0] || G.heisters.find(t=>t!==h&&!t.escaped);
  // цель с проверкой достижимости: бот не должен упираться в стену закрытого хранилища
  const tryGoal=(x,y,act)=>{ const p=findPath(G,h.x,h.y,x,y); if(!p||!p.length) return false;
    b.goal={x,y}; b.goalAct=act||null; b.path=p; b.pathI=0; b.lastGoal={x,y}; return true; };
  const escC={ x:G.def.escape.x+G.def.escape.w/2, y:G.def.escape.y+G.def.escape.h/2 };
  // 1) поднять раненого
  const downed = G.heisters.filter(t=>t!==h&&t.downed&&!t.custody&&!t.escaped).sort((a,c)=>dist(h,a)-dist(h,c))[0];
  if(downed){ if(!tryGoal(downed.x,downed.y,'interact')){ b.goal={x:downed.x,y:downed.y}; b.goalAct='interact'; } }
  // 2) несу сумку — к фургону
  else if(h.carry) b.goal=escC;
  // 3) эвакуация активна — уходим (если ботам явно не приказано добирать лут)
  else if(G.secured>=G.def.required && G.botMode!=='loot') b.goal=escC;
  // 4) заклинившая дрель (если не жарко и она достижима)
  else if(!foe){ const d=G.drills.find(d=>d.state==='jammed'); if(d) tryGoal(d.x,d.y,'interact'); }
  // 5) таскать сумки: сначала готовые на полу, потом паковать ДОСТИЖИМЫЙ лут
  if(!b.goal && h.masked && (G.botMode==='loot' || (G.botMode==='auto' && G.vaultOpen))){
    for(const bg of G.bags.filter(bg=>!bg.carriedBy).sort((a,c)=>dist(h,a)-dist(h,c))) if(tryGoal(bg.x,bg.y,'interact')) break;
    if(!b.goal) for(const lp of G.lootPts.filter(l=>l.left>0).sort((a,c)=>dist(h,a)-dist(h,c))) if(tryGoal(lp.x,lp.y,'interact')) break;
    if(!b.goal && G.secured>=G.def.required) b.goal=escC; // достижимого лута не осталось — уходим
  }
  // 6) бой: держаться на дистанции от врага / идти к лидеру
  if(!b.goal){
    if(foe && foeD<3.2){ const a=angTo(foe,h); b.goal={x:h.x+Math.cos(a)*2.5,y:h.y+Math.sin(a)*2.5}; }
    else if(leader){ const off=[[1.2,0],[-1.2,0],[0,1.2],[0,-1.2]][h.slot]; b.goal={x:leader.x+off[0],y:leader.y+off[1]}; if(dist(h,leader)<1.6) b.goal={x:h.x,y:h.y}; }
  }
  // маска за лидером
  if(!h.masked && ((leader&&leader.masked)||G.alarm)) maskUp(h);
  inp.crouch = !G.alarm && leader ? leader.crouch : false;
  moveBotToward(h, dt);
  if(b.goalAct==='interact' && b.goal && Math.hypot(h.x-b.goal.x,h.y-b.goal.y)<1.7) inp.interact=true;
  // перезарядка
  if(h.mag===0) startReload(h);
}
function moveBotToward(h, dt){
  const b=h.bot, inp=h.input; inp.mx=0; inp.my=0;
  if(!b.goal) return;
  const d = Math.hypot(h.x-b.goal.x,h.y-b.goal.y);
  if(d<0.5) return;
  if(!b.path || b.pathI>=(b.path||[]).length || (b.lastGoal && Math.hypot(b.lastGoal.x-b.goal.x,b.lastGoal.y-b.goal.y)>1.5)){ b.path=findPath(G,h.x,h.y,b.goal.x,b.goal.y); b.pathI=0; b.lastGoal={...b.goal}; }
  // followPath двигает сущность с полями path/pathI/x/y — используем сам объект бота как носитель пути, но координаты у h:
  if(b.path && b.pathI<b.path.length){
    const t=b.path[b.pathI];
    if(Math.hypot(t.x-h.x,t.y-h.y)<0.2) b.pathI++;
    else { const a=Math.atan2(t.y-h.y,t.x-h.x); inp.mx=Math.cos(a); inp.my=Math.sin(a); inp.world=true; if(!inp.shoot){ inp.aimx=h.x+Math.cos(a)*3; inp.aimy=h.y+Math.sin(a)*3; } }
  } else { const a=Math.atan2(b.goal.y-h.y,b.goal.x-h.x); inp.mx=Math.cos(a); inp.my=Math.sin(a); inp.world=true; }
  inp.sprint = d>6 && G.alarm;
}
function maskUp(h){ if(!h.masked && h.maskT<=0){ h.maskT=0.7; } }
function startReload(h){ const w=WEAPONS[h.weapon]; if(h.reloadT<=0 && h.mag<w.mag && h.reserve>0) h.reloadT=w.reload; }

/* ---------------- Обновление грабителя ---------------- */
function updateHeister(h, dt){
  const inp=h.input, m=MASKS[h.mask], w=WEAPONS[h.weapon];
  if(h.escaped) return;
  if(h.maskT>0){ h.maskT-=dt; if(h.maskT<=0){ h.masked=true; G.anyMasked=true; ev('info','🎭 '+h.name+' надел маску «'+m.name+'»!',h.x,h.y); emitNoise(h.x,h.y,3,'mask'); } }
  if(h.downed){ if(!h.custody){ h.bleed-=dt; if(h.bleed<=0){ h.bleed=0; h.custody=true; ev('bad','⛓️ '+h.name+' взят под стражу!',h.x,h.y); } } return; }
  // реген брони и частичный реген HP вне боя
  if(G.time-h.lastDmg>4 && h.armor<h.maxarmor) h.armor=Math.min(h.maxarmor,h.armor+22*dt);
  if(G.time-h.lastDmg>8 && h.hp<h.maxhp*0.6) h.hp=Math.min(h.maxhp*0.6,h.hp+2.5*dt);
  // движение: input.mx/my — экранный вектор у человека, мировой у бота (inp.world)
  let wx=0, wy=0;
  if(inp.world){ wx=inp.mx; wy=inp.my; }
  else { wx=inp.mx + inp.my*2; wy=inp.my*2 - inp.mx; } // экранный вектор -> мировой (изометрия 2:1)
  const len=Math.hypot(wx,wy);
  h.crouch=!!inp.crouch; h.sprint=!!inp.sprint && len>0.1 && !h.crouch;
  let speed=3.4*m.speed;
  if(h.crouch) speed*=0.55; if(h.sprint) speed*=1.4;
  if(h.carry){ const b=G.bags.find(b=>b.id===h.carry); if(b) speed*=LOOT_TYPES[b.type].slow; }
  if(h.ixP>0) speed*=0.35;
  h.moving = len>0.1;
  if(len>0.1){ moveEntity(G,h,wx/len*speed*dt, wy/len*speed*dt); if(h.sprint) emitNoise(h.x,h.y,4,'run'); }
  h.aim = Math.atan2(inp.aimy-h.y, inp.aimx-h.x);
  h.face = h.aim;
  // сумка следует
  if(h.carry){ const b=G.bags.find(b=>b.id===h.carry); if(b){ b.x=h.x; b.y=h.y;
    if(inRect(h,G.def.escape)){ G.secured++; G.securedValue+=b.value; G.bags=G.bags.filter(x=>x.id!==b.id); h.carry=null;
      ev('good','🚐 Сумка в фургоне! +$'+(b.value/1000)+'k ('+G.secured+'/'+G.def.required+')',h.x,h.y); } } }
  // эвакуация
  if(G.secured>=G.def.required && !h.carry && inRect(h,G.def.escape)){ h.escaped=true; ev('good','🏃 '+h.name+' ушёл с деньгами!',h.x,h.y); return; }
  // подбор патронов
  for(const d of G.drops) if(d.kind==='ammo' && Math.hypot(h.x-d.x,h.y-d.y)<0.7){ h.reserve+=w.mag; d.t=0; ev('ammo','',h.x,h.y); }
  G.drops = G.drops.filter(d=>d.t>0);
  // взаимодействие
  const target = findInteract(h);
  h.ixPrompt = target?target.label:null;
  h.crime = !!(target && target.crime && inp.interact);
  if(inp.interact && target){
    if(h.ixKey!==target.key){ h.ixKey=target.key; h.ixP=0; }
    h.ixP += dt*m.interact/target.need;
    h.ix = { p:clamp(h.ixP,0,1), label:target.label };
    if(h.ixP>=1){ target.run(); h.ixP=0; h.ixKey=null; h.ix=null; }
  } else { h.ixP=Math.max(0,(h.ixP||0)-dt*3); if(h.ixP===0){h.ixKey=null;h.ix=null;} else if(h.ix) h.ix.p=h.ixP; }
  // перезарядка
  if(h.reloadT>0){ h.reloadT-=dt; if(h.reloadT<=0){ const take=Math.min(w.mag-h.mag,h.reserve); h.mag+=take; h.reserve-=take; } }
  h.fireCd-=dt; h.meleeCd-=dt;
  // стрельба
  if(inp.shoot){
    if(!h.masked){ maskUp(h); }
    else if(h.reloadT<=0){
      if(h.mag<=0){ startReload(h); }
      else if(h.fireCd<=0){
        h.fireCd = 1/w.rof; h.mag--;
        shoot(h, h.aim, w.dmg*m.dmg, w.bs, 'heister', w.pellets, w.spread*(h.sprint?1.8:1));
        emitNoise(h.x,h.y,13,'gunshot');
      }
    }
  }
}

/* ---------------- Охрана / гражданские / камеры ---------------- */
function updateGuard(g, dt){
  if(g.dead){
    if(g.pager==='ring'){ g.pagerT-=dt; if(g.pagerT<=0){ g.pager='missed'; triggerAlarm('Диспетчер не дождался охранника!'); } }
    return;
  }
  g.moving=false;
  if(G.alarm){ // боевой режим
    combatAI(g, dt, { range:7, dmg:6, rof:1.8, spread:0.13, speed:2.5 });
    return;
  }
  const det = observerDetect(g, 9, 1.5, false);
  G.maxDetect = Math.max(G.maxDetect, det);
  if(det>=1){ g.radio+=dt; if(g.radio>0.7) triggerAlarm('Охранник вызвал полицию!'); return; } else g.radio=0;
  // реакция на шум
  for(const n of G.noise){ if(Math.hypot(g.x-n.x,g.y-n.y)<n.r && n.kind!=='run'){ g.state='investigate'; pathTo(G,g,n.x,n.y); } }
  g.repath-=dt;
  if(g.state==='patrol' && (!g.path || g.pathI>=g.path.length) && g.repath<=0){
    g.repath=rand(2,5);
    for(let i=0;i<8;i++){ const tx=randi(1,G.def.w-2), ty=randi(1,G.def.h-2); if(!solidAt(G,tx,ty) && Math.hypot(tx-g.x,ty-g.y)<14){ pathTo(G,g,tx+0.5,ty+0.5); break; } }
  }
  if(g.path && followPath(G,g,dt,1.7) && g.state==='investigate'){ g.state='patrol'; g.path=null; }
}
function updateCiv(c, dt){
  if(c.dead) return;
  c.moving=false;
  if(c.state==='tied') return;
  if(c.state==='down'){ c.downT-=dt; if(c.downT<=0 && !G.alarm) c.state='idle'; else if(c.downT<=0) c.state='flee'; return; }
  // свидетели
  let witness=false;
  if(!G.alarm){
    for(const h of G.heisters) if(!h.escaped && Math.hypot(c.x-h.x,c.y-h.y)<6 && los(G,c.x,c.y,h.x,h.y) && (h.masked||h.crime||h.carry)) witness=true;
    for(const g of G.guards) if(g.dead && Math.hypot(c.x-g.x,c.y-g.y)<5 && los(G,c.x,c.y,g.x,g.y)) witness=true;
    for(const n of G.noise) if(n.kind==='gunshot' && Math.hypot(c.x-n.x,c.y-n.y)<n.r) witness=true;
  }
  if(witness && c.state!=='flee'){ c.state='flee'; c.panicT=6; c.path=null; if(!G.alarm) ev('warn','😱 Гражданский что-то заметил и бежит звонить! Остановите его криком (F)!',c.x,c.y); }
  if(c.state==='flee'){
    c.panicT-=dt;
    if(!c.path || c.pathI>=c.path.length){ const e=choice(G.def.entries); pathTo(G,c,e[0]+0.5,e[1]+0.5); }
    const arrived = followPath(G,c,dt,2.7);
    if(arrived){ c.dead=true; c.escaped=true; if(!G.alarm) triggerAlarm('Гражданский добежал и вызвал полицию!'); }
    else if(c.panicT<=0 && !G.alarm){ triggerAlarm('Кто-то позвонил в 911!'); c.panicT=999; }
    return;
  }
  // праздное блуждание
  if(Math.random()<dt*0.05) c.face=rand(0,6.28);
  if(Math.random()<dt*0.1){ const tx=Math.floor(c.x+rand(-3,3)), ty=Math.floor(c.y+rand(-3,3)); if(!solidAt(G,tx,ty) && tileAt(G,{x:tx,y:ty})!==TILE.RESTRICT) pathTo(G,c,tx+0.5,ty+0.5); }
  if(c.path) followPath(G,c,dt,1.1);
}
function updateCam(cam, dt){
  cam.t += dt*0.45;
  cam.angle = cam.base + Math.sin(cam.t)*cam.sweep;
  if(G.camsDisabled || G.alarm){ cam.detect=0; return; }
  const det = observerDetect(cam, 10, 1.1, true);
  G.maxDetect = Math.max(G.maxDetect, det);
  if(det>=1) triggerAlarm('Камера наблюдения вас засекла!');
}

/* ---------------- Полиция: волны и бой ---------------- */
function spawnEnemy(){
  const wave = G.assault.wave;
  const hostages = G.civs.filter(c=>c.state==='tied').length;
  let type='cop';
  const roll=Math.random();
  if(wave>=2 && !G.assault.dozerSpawned && roll<0.1){ type='dozer'; G.assault.dozerSpawned=true; ev('bad','🐂 НЕОНОВЫЙ БЫК приближается! Сконцентрируйте огонь!'); }
  else if(wave>=3 && roll<0.22) type='shield';
  else if(roll<0.25+wave*0.06) type='fbi';
  else if(roll<0.6) type='swat';
  const st = ENEMY_TYPES[type];
  const e = choice(G.def.entries); const s = nearestFloor(G,e[0],e[1]);
  G.enemies.push({ id:nextEntId++, type, x:s.x+rand(-0.4,0.4), y:s.y+rand(-0.4,0.4), r:type==='dozer'?0.5:0.32,
    hp:st.hp, maxhp:st.hp, face:-Math.PI/2, path:null, pathI:0, repath:rand(0,0.5), fireCd:rand(0.3,1), burst:0, moving:false });
  return hostages;
}
function combatAI(e, dt, st){
  e.moving=false;
  // ближайший живой грабитель
  let tgt=null, td=1e9;
  for(const h of G.heisters){ if(h.escaped||h.downed) continue; const d=dist(e,h); if(d<td){td=d;tgt=h;} }
  if(!tgt) return;
  const see = td<14 && los(G,e.x,e.y,tgt.x,tgt.y);
  e.repath-=dt;
  if(see && td<=st.range){
    e.face = angTo(e,tgt);
    // лёгкий стрейф
    const sa = e.face+Math.PI/2;
    moveEntity(G,e,Math.cos(sa)*Math.sin(G.time*0.7+e.id)*0.5*dt, Math.sin(sa)*Math.sin(G.time*0.7+e.id)*0.5*dt);
    e.fireCd-=dt;
    if(e.burst>0){
      if(e.fireCd<=0){ e.fireCd=1/st.rof; e.burst--;
        const acc = st.spread*(tgt.crouch?1.5:1)*(tgt.sprint?1.5:1)*(0.7+td/12);
        shoot(e, e.face+rand(-acc,acc)*2, st.dmg, 26, 'enemy', st.pellets||1, acc); }
    } else if(e.fireCd<=-(0.5+Math.random())){ e.burst = e.type==='dozer'?2:randi(2,4); e.fireCd=0; }
  } else {
    if(e.repath<=0){ e.repath=0.6; pathTo(G,e,tgt.x,tgt.y); }
    if(e.path) followPath(G,e,dt,st.speed);
    // расталкивание
    for(const o of [...G.enemies,...G.guards]) if(o!==e && !o.dead){ const d=dist(e,o); if(d<0.6&&d>0){ moveEntity(G,e,(e.x-o.x)/d*dt,(e.y-o.y)/d*dt); } }
  }
}
function updateAssault(dt){
  const A=G.assault;
  if(!G.alarm) return;
  A.t-=dt;
  const cap = 9 + A.wave*2;
  const hostages = G.civs.filter(c=>c.state==='tied').length;
  if(A.state==='assault'){
    A.spawnT-=dt;
    if(A.spawnT<=0 && G.enemies.length<cap){ spawnEnemy(); A.spawnT=Math.max(1.2, 3.2-A.wave*0.3)*(1+hostages*0.18); }
    if(A.t<=0){ A.state='regroup'; A.t=16; ev('info','🌊 Штурм стихает… передышка ~15 сек. Собирайте патроны и сумки!'); }
  } else if(A.state==='regroup' && A.t<=0){
    A.state='assault'; A.wave++; A.t=50+A.wave*5; A.dozerSpawned=false; A.spawnT=0.5;
    ev('bad','🚔 ВОЛНА '+A.wave+'! Полиция усиливает натиск!');
  }
}

/* ---------------- Главный тик ---------------- */
function tick(dt){
  if(!G || G.phase!=='heist') return;
  G.time+=dt; G.maxDetect=0;
  for(const h of G.heisters) if(h.isBot && !h.escaped && !h.downed) botThink(h,dt);
  for(const h of G.heisters) updateHeister(h,dt);
  for(const g of G.guards) updateGuard(g,dt);
  for(const c of G.civs) updateCiv(c,dt);
  for(const cam of G.cams) updateCam(cam,dt);
  updateAssault(dt);
  for(const e of G.enemies) combatAI(e,dt,ENEMY_TYPES[e.type]);
  // дрели
  for(const d of G.drills){
    if(d.state==='drilling'){
      d.p += dt/d.total;
      if(Math.random()<dt*0.5) emitNoise(d.x,d.y,8,'drill');
      const jam = d.jams.find(j=>Math.abs(d.p-j)<dt/d.total);
      if(jam!==undefined){ d.jams=d.jams.filter(j=>j!==jam); d.state='jammed'; ev('warn','⚠️ Дрель заклинило! Кто-нибудь, почините её (E)!',d.x,d.y); }
      if(d.p>=1){ d.state='done'; d.p=1;
        if(d.kind==='vault'){ G.vaultOpen=true; ev('good','💥 ХРАНИЛИЩЕ ОТКРЫТО! Гребите всё!',d.x,d.y); }
        else { spawnBag(d.x,d.y,d.lootType,null); ev('good','🔓 Сейф вскрыт!',d.x,d.y); }
      }
    }
  }
  // пули
  const deadBullets=new Set();
  for(const b of G.bullets){
    b.life-=dt; if(b.life<=0){ deadBullets.add(b.id); continue; }
    const steps=3;
    for(let s=0;s<steps && !deadBullets.has(b.id);s++){
      b.x+=b.vx*dt/steps; b.y+=b.vy*dt/steps; b.trav=(b.trav||0)+Math.hypot(b.vx,b.vy)*dt/steps;
      const bt=G.grid[Math.floor(b.y)*G.def.w+Math.floor(b.x)];
      // первые 0.85 тайла пуля пролетает над НИЗКИМИ укрытиями — можно стрелять из-за стойки
      if(solidAt(G,Math.floor(b.x),Math.floor(b.y)) && !(b.trav<0.85 && bt===TILE.COVER)){ deadBullets.add(b.id); break; }
      if(b.from==='heister'){
        for(const e of [...G.enemies]) if(Math.hypot(b.x-e.x,b.y-e.y)<(e.r+0.08)){
          let dmg=b.dmg;
          if(e.type==='shield' && Math.abs(angDiff(Math.atan2(b.vy,b.vx), e.face))>2.2) dmg*=0.25; // спереди щит держит
          e.hp-=dmg; deadBullets.add(b.id);
          if(e.hp<=0){ killEnemy(e); G.enemies=G.enemies.filter(x=>x!==e); }
          break;
        }
        if(deadBullets.has(b.id)) break;
        for(const g of G.guards) if(!g.dead && Math.hypot(b.x-g.x,b.y-g.y)<0.4){ g.hp-=b.dmg; deadBullets.add(b.id); if(g.hp<=0) killGuard(g,b.owner); else if(!G.alarm){ g.detect=Math.max(g.detect,0.85); } break; }
        if(deadBullets.has(b.id)) break;
        for(const c of G.civs) if(!c.dead && Math.hypot(b.x-c.x,b.y-c.y)<0.38){ c.hp-=b.dmg; deadBullets.add(b.id);
          if(c.hp<=0 && !c.dead){ c.dead=true; G.civKilled++; ev('bad','💸 Гражданский убит! Чистильщики: −$5,000 из выплаты.',c.x,c.y); if(!G.alarm) emitNoise(c.x,c.y,10,'gunshot'); } break; }
      } else {
        for(const h of G.heisters) if(!h.downed && !h.escaped && Math.hypot(b.x-h.x,b.y-h.y)<0.4){ damageHeister(h,b.dmg); deadBullets.add(b.id); break; }
      }
    }
  }
  G.bullets = G.bullets.filter(b=>!deadBullets.has(b.id));
  for(const d of G.drops) d.t-=dt;
  G.drops = G.drops.filter(d=>d.t>0);
  G.noise.length=0;
  // конец игры
  const active = G.heisters.filter(h=>!h.escaped && !h.custody);
  if(active.length===0 && !G.end){
    endHeist(G.heisters.some(h=>h.escaped));
  } else if(active.length>0 && active.every(h=>h.downed) && !G.end){
    // все оставшиеся лежат одновременно — 4 секунды и конец
    G.allDownT=(G.allDownT||0)+dt; if(G.allDownT>4) endHeist(G.heisters.some(h=>h.escaped));
  } else G.allDownT=0;
}
function endHeist(win){
  if(G.end) return;
  const stealthBonus = win && !G.alarm ? Math.round(G.securedValue*0.25) : 0;
  const civPenalty = G.civKilled*5000;
  const payout = win ? Math.max(0, G.securedValue + stealthBonus - civPenalty) : 0;
  G.end = { win, payout, secured:G.secured, value:G.securedValue, stealthBonus, civPenalty, kills:G.kills, time:Math.round(G.time), alarm:G.alarm, civKilled:G.civKilled,
            escaped:G.heisters.filter(h=>h.escaped).length };
  G.phase='ended';
  broadcast({ t:'end', end:G.end });
  ev(win?'good':'bad', win?'🏆 Ограбление удалось! Выплата: $'+payout.toLocaleString():'🚓 Провал! Команда в наручниках…');
  console.log('■ Конец ограбления. Победа:', win, 'Выплата:', payout);
}

/* ---------------- Снапшот для клиентов ---------------- */
function objectives(){
  const o=[];
  const vault = G.drills[0];
  if(!G.vaultOpen){
    if(vault.state==='idle') o.push('🔩 Установите дрель на дверь хранилища (E)');
    else if(vault.state==='drilling') o.push('🔩 Дрель пилит хранилище: '+Math.round(vault.p*100)+'% — защищайте её!');
    else if(vault.state==='jammed') o.push('⚠️ Дрель заклинило — почините (E)!');
  }
  if(G.secured<G.def.required) o.push('💰 Сумки в фургоне: '+G.secured+' / '+G.def.required);
  else o.push('🚐 ЭВАКУАЦИЯ! Вся команда — в фургон!');
  if(!G.alarm && !G.camsDisabled) o.push('📷 Опционально: отключите камеры в комнате охраны');
  if(!G.anyMasked && !G.alarm) o.unshift('👀 Разведка: вы в штатском. G — надеть маску и начать дело');
  return o;
}
function snapshot(forClient){
  const you = G.heisters.find(h=>h.ctrl===forClient.id);
  return {
    t:'state', time:G.time, alarm:G.alarm, vaultOpen:G.vaultOpen, camsDisabled:G.camsDisabled,
    detect:G.maxDetect, secured:G.secured, securedValue:G.securedValue, required:G.def.required,
    assault:{ state:G.assault.state, wave:G.assault.wave, t:Math.ceil(G.assault.t) },
    objectives:objectives(), botMode:G.botMode, youId: you?you.id:null, ended:!!G.end,
    heisters:G.heisters.map(h=>({ id:h.id,name:h.name,isBot:h.isBot,mask:h.mask,weapon:h.weapon,x:+h.x.toFixed(2),y:+h.y.toFixed(2),face:+h.face.toFixed(2),
      hp:Math.ceil(h.hp),maxhp:h.maxhp,armor:Math.ceil(h.armor),maxarmor:h.maxarmor,masked:h.masked,downed:h.downed,custody:!!h.custody,bleed:Math.ceil(h.bleed),
      escaped:h.escaped,carry:h.carry?((G.bags.find(b=>b.id===h.carry)||{}).type):null,crouch:h.crouch,moving:h.moving,
      mag:h.mag,reserve:h.reserve,reload:h.reloadT>0,ties:h.ties,ix:h.ix,prompt:(you&&h.id===you.id)?h.ixPrompt:null })),
    guards:G.guards.map(g=>({ id:g.id,x:+g.x.toFixed(2),y:+g.y.toFixed(2),face:+g.face.toFixed(2),dead:g.dead,detect:+g.detect.toFixed(2),pager:g.pager,pagerT:g.pagerT?Math.ceil(g.pagerT):0,moving:g.moving })),
    civs:G.civs.filter(c=>!c.escaped).map(c=>({ id:c.id,x:+c.x.toFixed(2),y:+c.y.toFixed(2),face:+c.face.toFixed(2),state:c.state,dead:c.dead,hue:c.hue,moving:c.moving })),
    enemies:G.enemies.map(e=>({ id:e.id,type:e.type,x:+e.x.toFixed(2),y:+e.y.toFixed(2),face:+e.face.toFixed(2),hp:Math.ceil(e.hp),maxhp:e.maxhp,moving:e.moving })),
    cams:G.cams.map(c=>({ id:c.id,x:c.x,y:c.y,angle:+c.angle.toFixed(2),detect:+c.detect.toFixed(2),off:G.camsDisabled })),
    drills:G.drills.map(d=>({ id:d.id,kind:d.kind,x:d.x,y:d.y,state:d.state,p:+d.p.toFixed(3) })),
    loot:G.lootPts.map(l=>({ id:l.id,x:l.x,y:l.y,type:l.type,left:l.left })),
    bags:G.bags.map(b=>({ id:b.id,x:+b.x.toFixed(2),y:+b.y.toFixed(2),type:b.type,carried:!!b.carriedBy })),
    drops:G.drops.map(d=>({ id:d.id,x:d.x,y:d.y,kind:d.kind })),
    bullets:G.bullets.map(b=>({ id:b.id,x:+b.x.toFixed(2),y:+b.y.toFixed(2),vx:+b.vx.toFixed(1),vy:+b.vy.toFixed(1),from:b.from })),
  };
}

/* ---------------- Действия игрока ---------------- */
function playerAction(h, a){
  if(!h || h.downed || h.escaped) return;
  if(a==='maskOrBag'){ if(!h.masked) maskUp(h); else if(h.carry) dropBag(h); }
  else if(a==='reload') startReload(h);
  else if(a==='melee'){
    if(h.meleeCd>0||!h.masked) return; h.meleeCd=0.6;
    const tx=h.x+Math.cos(h.aim)*0.9, ty=h.y+Math.sin(h.aim)*0.9;
    for(const g of G.guards) if(!g.dead && Math.hypot(tx-g.x,ty-g.y)<0.8){ g.hp-=70; if(g.hp<=0) killGuard(g,h.id); emitNoise(h.x,h.y,2.5,'melee'); return; }
    for(const e of [...G.enemies]) if(Math.hypot(tx-e.x,ty-e.y)<0.9){ e.hp-=55; if(e.hp<=0){ killEnemy(e); G.enemies=G.enemies.filter(x=>x!==e);} return; }
    for(const c of G.civs) if(!c.dead && Math.hypot(tx-c.x,ty-c.y)<0.8){ c.state='down'; c.downT=10; return; }
  }
  else if(a==='shout'){
    if(!h.masked) return;
    emitNoise(h.x,h.y,5,'shout');
    let n=0;
    for(const c of G.civs) if(!c.dead && c.state!=='tied' && Math.hypot(c.x-h.x,c.y-h.y)<4.2 && los(G,h.x,h.y,c.x,c.y)){ c.state='down'; c.downT=9; c.path=null; n++; }
    if(n) ev('info','📢 «ВСЕМ ЛЕЖАТЬ!» — на полу: '+n,h.x,h.y);
  }
  else if(a==='bots'){ G.botMode = G.botMode==='loot' ? 'auto' : 'loot'; ev('info', G.botMode==='loot'?'🤖 Ботам приказано: ТАСКАТЬ СУМКИ!':'🤖 Боты в автоматическом режиме (следуют за командой)'); }
}

/* ---------------- WebSocket / лобби ---------------- */
function sendLobby(){
  const list=[...clients.values()].map(c=>({ id:c.id, name:c.name, mask:c.mask, weapon:c.weapon }));
  broadcast({ t:'lobby', players:list, hostId:list.length?list[0].id:null, heists:HEISTS.map(h=>({id:h.id,name:h.name,sub:h.sub})), inHeist:!!G&&G.phase==='heist' });
}
wss.on('connection', ws=>{
  const id = nextClientId++;
  const client = { id, ws, name:'Грабитель-'+id, mask:['tiger','wolf','panda','shark'][(id-1)%4], weapon:'rifle' };
  clients.set(id, client);
  ws.send(JSON.stringify({ t:'welcome', id, masks:MASKS, weapons:Object.fromEntries(Object.entries(WEAPONS).map(([k,v])=>[k,{name:v.name}])) }));
  // подключение посреди ограбления — занять бота
  if(G && G.phase==='heist'){
    const bot = G.heisters.find(h=>h.isBot && !h.escaped);
    if(bot){ bot.isBot=false; bot.ctrl=id; bot.name=client.name; client.mask=bot.mask; client.weapon=bot.weapon;
      ws.send(JSON.stringify({ t:'heist', map:{ w:G.def.w,h:G.def.h,grid:G.grid,coverType:G.coverType,escape:G.def.escape,signs:G.def.signs,name:G.def.name,
        entries:G.def.entries, panel:{x:G.def.panel[0]+0.5,y:G.def.panel[1]+0.5}, vaultDoor:{x:G.def.vaultDoor[0]+0.5,y:G.def.vaultDoor[1]+0.5}, required:G.def.required }}));
      ev('info','🎮 '+client.name+' присоединился к ограблению!'); }
  }
  sendLobby();
  ws.on('message', raw=>{
    let m; try{ m=JSON.parse(raw); }catch{ return; }
    if(m.t==='join'){ client.name=String(m.name||client.name).slice(0,16); if(MASKS[m.mask])client.mask=m.mask; if(WEAPONS[m.weapon])client.weapon=m.weapon;
      const h=G&&G.heisters.find(h=>h.ctrl===id); if(h) h.name=client.name; sendLobby(); }
    else if(m.t==='start'){ const first=[...clients.values()][0]; if(first&&first.id===id && (!G||G.phase!=='heist')) startHeist(m.heist); }
    else if(m.t==='toLobby'){ const first=[...clients.values()][0]; if(first&&first.id===id){ G=null; broadcast({t:'backToLobby'}); sendLobby(); } }
    else if(m.t==='input' && G && G.phase==='heist'){
      const h=G.heisters.find(h=>h.ctrl===id); if(!h) return;
      h.input.mx=clamp(+m.mx||0,-1,1); h.input.my=clamp(+m.my||0,-1,1);
      h.input.aimx=+m.aimx||0; h.input.aimy=+m.aimy||0;
      h.input.shoot=!!m.shoot; h.input.interact=!!m.interact; h.input.sprint=!!m.sprint; h.input.crouch=!!m.crouch; h.input.world=false;
    }
    else if(m.t==='act' && G && G.phase==='heist'){ const h=G.heisters.find(h=>h.ctrl===id); playerAction(h, m.a); }
  });
  ws.on('close', ()=>{
    clients.delete(id);
    if(G){ const h=G.heisters.find(h=>h.ctrl===id); if(h){ h.isBot=true; h.ctrl=null; h.name=BOT_NAMES[h.slot]; h.input.shoot=false; h.input.interact=false; ev('info','🤖 Игрок вышел — его грабителя ведёт бот '+h.name); } }
    sendLobby();
  });
});

/* ---------------- Цикл ---------------- */
const DT = 1/30;
let snapCounter = 0;
setInterval(()=>{
  tick(DT);
  if(G && (G.phase==='heist'||G.phase==='ended') && ++snapCounter%2===0){
    for(const c of clients.values()) if(c.ws.readyState===1) c.ws.send(JSON.stringify(snapshot(c)));
  }
}, 1000*DT);

server.listen(PORT, '0.0.0.0', ()=>{
  const nets = os.networkInterfaces();
  const ips = Object.values(nets).flat().filter(n=>n.family==='IPv4'&&!n.internal).map(n=>n.address);
  console.log('\n🌴 NEON VAULT \'84 запущен!');
  console.log('   Локально:  http://localhost:'+PORT);
  ips.forEach(ip=>console.log('   По LAN:    http://'+ip+':'+PORT+'   ← этот адрес дай друзьям в той же сети'));
  console.log('   До 4 игроков, пустые слоты — боты-напарники.\n');
});
