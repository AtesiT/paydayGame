'use strict';
/* Честная отрисовка игрового мира в PNG через @napi-rs/canvas (Skia) + живой сервер + BFS-навигация. */
const fs = require('fs');
const vm = require('vm');
const WebSocket = require('ws');
const { createCanvas } = require('@napi-rs/canvas');

const PREFIX = process.argv[2] || 'shot';
const OUT = __dirname + '/../screenshots';
fs.mkdirSync(OUT, { recursive: true });

const gameCanvas = createCanvas(1280, 720);
const mmCanvas = createCanvas(208, 152);

class El {
  constructor(id){ this.id=id||''; this.style={}; this.dataset={}; this.children=[]; this.value=''; this.textContent=''; this._html='';
    this.classList={ toggle(){}, add(){}, remove(){} }; this.disabled=false;
    if(id==='game') this._cv=gameCanvas; if(id==='minimap') this._cv=mmCanvas; }
  set width(v){ if(this._cv) this._cv.width=v; this._w=v; } get width(){ return this._cv?this._cv.width:(this._w||0); }
  set height(v){ if(this._cv) this._cv.height=v; this._h=v; } get height(){ return this._cv?this._cv.height:(this._h||0); }
  set innerHTML(v){ this._html=v; if(v==='') this.children=[]; } get innerHTML(){ return this._html; }
  get lastChild(){ return this.children[this.children.length-1] || { remove(){} }; }
  prepend(c){ c._parent=this; this.children.unshift(c); }
  appendChild(c){ c._parent=this; this.children.push(c); }
  remove(){ if(this._parent){ const i=this._parent.children.indexOf(this); if(i>=0) this._parent.children.splice(i,1); } }
  addEventListener(){}
  getContext(){ return this._cv ? this._cv.getContext('2d') : new Proxy({}, { get:(t,p)=> (p==='measureText' ? ()=>({width:42}) : ()=>{}), set:()=>true }); }
}
const els = new Map();
const listeners = {};
let rafCb = null, fakeWs = null, realWs = null;
let gState = null, gMap = null;

class FakeWebSocket { constructor(){ this.readyState=1; fakeWs=this; } send(d){ if(realWs&&realWs.readyState===1) realWs.send(d); } }
const sandbox = {
  console, setInterval, clearInterval, setTimeout, clearTimeout, Math, JSON, Object, Array, Map, Set, Date, Promise,
  innerWidth: 1280, innerHeight: 720,
  performance: { now: () => Date.now() },
  localStorage: { getItem: () => null, setItem(){} },
  location: { protocol: 'http:', host: 'localhost:3000' },
  document: { getElementById: id => { if(!els.has(id)) els.set(id, new El(id)); return els.get(id); },
              createElement: () => new El(), querySelectorAll: () => [] },
  WebSocket: FakeWebSocket,
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  requestAnimationFrame: cb => { rafCb = cb; },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;

const html = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], sandbox, { filename:'client.js' });
console.log('клиент загружен');

realWs = new WebSocket(process.env.GAME_URL || 'ws://localhost:3000');
realWs.on('message', raw => {
  const data = raw.toString();
  try { const m = JSON.parse(data); if (m.t==='state') gState=m; if (m.t==='heist') gMap=m.map; } catch {}
  try { fakeWs.onmessage({ data }); } catch(e){ console.log('🐞 onmessage:', e.message); }
});

let frames = 0;
const pump = setInterval(() => { if (rafCb) { const cb = rafCb; rafCb = null; try { cb(); frames++; } catch(e){ console.log('🐞 render:', e.message, (e.stack.split('\n')[1]||'')); } } }, 33);

const shot = name => { fs.writeFileSync(`${OUT}/${PREFIX}-${name}.png`, gameCanvas.toBuffer('image/png')); console.log('📸', name, 'кадр', frames); };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const fire = (type, ev) => (listeners[type]||[]).forEach(fn => fn(ev));
const pressed = new Set();
function setKeys(codes){
  for (const c of [...pressed]) if (!codes.includes(c)) { fire('keyup', {code:c, target:{tagName:'BODY'}, preventDefault(){}}); pressed.delete(c); }
  for (const c of codes) if (!pressed.has(c)) { fire('keydown', {code:c, target:{tagName:'BODY'}, preventDefault(){}, repeat:false}); pressed.add(c); }
}
/* BFS + руление клавишами: экранный вектор -> мировой (сервер: wx=mx+2my, wy=2my-mx) */
function solid(tx,ty){ if(!gMap||tx<0||ty<0||tx>=gMap.w||ty>=gMap.h) return true; const t=gMap.grid[ty*gMap.w+tx]; return t===1||t===2||t===6; }
function bfs(sx,sy,tx,ty){
  const W=gMap.w, key=(x,y)=>y*W+x, prev=new Map(), q=[[sx,sy]]; prev.set(key(sx,sy),null);
  while(q.length){ const [x,y]=q.shift(); if(x===tx&&y===ty) break;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=x+dx,ny=y+dy;
      if(!prev.has(key(nx,ny))&&!solid(nx,ny)){ prev.set(key(nx,ny),[x,y]); q.push([nx,ny]); } } }
  if(!prev.has(key(tx,ty))) return null;
  const path=[]; let cur=[tx,ty]; while(cur){ path.unshift({x:cur[0]+0.5,y:cur[1]+0.5}); cur=prev.get(key(cur[0],cur[1])); }
  return path;
}
const COMBOS = [ [[],0,0], [['KeyW'],-2,-2], [['KeyS'],2,2], [['KeyA'],-1,1], [['KeyD'],1,-1],
  [['KeyW','KeyA'],-3,-1], [['KeyW','KeyD'],-1,-3], [['KeyS','KeyA'],1,3], [['KeyS','KeyD'],3,1] ];
async function driveTo(gx, gy, timeoutMs){
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const me = gState && gState.heisters.find(h => h.id === gState.youId);
    if (!me) { await sleep(100); continue; }
    if (Math.hypot(me.x-gx, me.y-gy) < 0.9) break;
    const path = bfs(Math.floor(me.x), Math.floor(me.y), Math.floor(gx), Math.floor(gy));
    const wp = path && path.length > 1 ? path[Math.min(2, path.length-1)] : {x:gx, y:gy};
    const dx = wp.x - me.x, dy = wp.y - me.y;
    let best = COMBOS[0], bestDot = -1e9;
    for (const c of COMBOS) { const dot = dx*c[1] + dy*c[2]; if (dot > bestDot) { bestDot = dot; best = c; } }
    setKeys(best[0]);
    await sleep(90);
  }
  setKeys([]);
}

(async () => {
  await sleep(800);
  els.get('startBtn').onclick && els.get('startBtn').onclick();
  await sleep(2200); shot('1-casing');
  fire('keydown', {code:'KeyG', target:{tagName:'BODY'}, preventDefault(){}, repeat:false});
  fire('keyup', {code:'KeyG', target:{tagName:'BODY'}, preventDefault(){}});
  await sleep(900);
  fire('mousemove', { clientX: 700, clientY: 250 });
  await driveTo(16.5, 15.5, 14000);
  await sleep(400); shot('2-lobby');
  await driveTo(26.5, 8.5, 16000);
  // дрель на хранилище: держать E рядом с дверью (27.5,6.5)
  await driveTo(27.5, 7.6, 6000);
  fire('keydown', {code:'KeyE', target:{tagName:'BODY'}, preventDefault(){}, repeat:false});
  await sleep(3600);
  fire('keyup', {code:'KeyE', target:{tagName:'BODY'}, preventDefault(){}});
  await sleep(600); shot('3-vault-drill');
  // loud: стрельба и отход в зал
  fire('mousedown', { button:0, target: els.get('game') });
  await sleep(700); fire('mouseup', { button:0 });
  await driveTo(19.5, 14.5, 12000);
  await sleep(2500);
  fire('mousedown', { button:0, target: els.get('game') });
  await sleep(450); shot('4-loud');
  fire('mouseup', { button:0 });
  clearInterval(pump); realWs.close();
  console.log('готово');
  process.exit(0);
})().catch(e => { console.error('💥', e); process.exit(1); });
