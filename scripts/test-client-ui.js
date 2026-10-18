'use strict';
/* Смок-тест клиентского JS: фейковый DOM/Canvas + настоящий игровой сервер. */
const fs = require('fs');
const vm = require('vm');
const WebSocket = require('ws');

let mainCtxCalls = 0;
function makeCtx(isMain){
  const target = {
    measureText: () => ({ width: 42 }),
    createRadialGradient: () => ({ addColorStop(){} }),
    createLinearGradient: () => ({ addColorStop(){} }),
    fillRect: () => { if (isMain) mainCtxCalls++; },
  };
  return new Proxy(target, {
    get(t, p){ if (p in t) return t[p]; if (typeof p === 'symbol') return undefined; return () => {}; },
    set(t, p, v){ t[p] = v; return true; },
  });
}
class El {
  constructor(id){ this.id=id||''; this.style={}; this.dataset={}; this.children=[]; this.value=''; this.textContent=''; this._html='';
    this.classList={ toggle(){}, add(){}, remove(){} }; this.width=0; this.height=0; this.disabled=false; }
  set innerHTML(v){ this._html=v; if(v==='') this.children=[]; }
  get innerHTML(){ return this._html; }
  get lastChild(){ return this.children[this.children.length-1] || { remove(){} }; }
  prepend(c){ c._parent=this; this.children.unshift(c); }
  appendChild(c){ c._parent=this; this.children.push(c); }
  remove(){ if(this._parent){ const i=this._parent.children.indexOf(this); if(i>=0) this._parent.children.splice(i,1); } }
  addEventListener(){}
  getContext(){ return this._ctx || (this._ctx = makeCtx(this.id==='game')); }
}
const els = new Map();
const documentStub = {
  getElementById: id => { if(!els.has(id)) els.set(id, new El(id)); return els.get(id); },
  createElement: () => new El(),
  querySelectorAll: () => [],
};
const listeners = {};
let rafCb = null, fakeWs = null;

class FakeWebSocket {
  constructor(url){ this.url=url; this.readyState=1; fakeWs=this; }
  send(data){ if (realWs && realWs.readyState===1) realWs.send(data); }
}
const sandbox = {
  console, setInterval, clearInterval, setTimeout, clearTimeout, Math, JSON, Object, Array, Map, Set, Date, Promise,
  innerWidth: 1280, innerHeight: 800,
  performance: { now: () => Date.now() },
  localStorage: { getItem: () => null, setItem(){} },
  location: { protocol: 'http:', host: 'localhost:3000' },
  document: documentStub,
  WebSocket: FakeWebSocket,
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  requestAnimationFrame: cb => { rafCb = cb; },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const html = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];

let realWs = null, errors = [], frames = 0, gotHeist = false, gotState = false;
try { vm.runInNewContext(code, sandbox, { filename: 'client.js' }); console.log('✅ клиентский скрипт загрузился без ошибок'); }
catch (e) { console.log('❌ ОШИБКА ЗАГРУЗКИ:', e.message); process.exit(1); }

realWs = new WebSocket(process.env.GAME_URL || 'ws://localhost:3000');
realWs.on('message', raw => {
  const data = raw.toString();
  const m = JSON.parse(data);
  if (m.t === 'heist') gotHeist = true;
  if (m.t === 'state') gotState = true;
  try { fakeWs.onmessage({ data }); }
  catch (e) { errors.push('onmessage(' + m.t + '): ' + e.message + '\n' + e.stack.split('\n')[1]); }
});

// качаем кадры рендера
const framePump = setInterval(() => {
  if (rafCb) { const cb = rafCb; rafCb = null;
    try { cb(); frames++; } catch (e) { errors.push('render: ' + e.message + '\n' + (e.stack.split('\n')[1]||'')); } }
}, 33);

// сценарий: кликнуть старт, надеть маску, пострелять мышью
setTimeout(() => {
  const btn = els.get('startBtn');
  try { btn.onclick && btn.onclick(); console.log('▶ кликнута кнопка «НА ДЕЛО»'); } catch(e){ errors.push('startBtn: '+e.message); }
}, 700);
setTimeout(() => {
  try {
    (listeners.keydown||[]).forEach(fn => fn({ code:'KeyG', target:{tagName:'BODY'}, preventDefault(){}, repeat:false }));
    (listeners.mousemove||[]).forEach(fn => fn({ clientX: 700, clientY: 300 }));
    (listeners.mousedown||[]).forEach(fn => fn({ button:0, target: els.get('game') }));
    console.log('⌨️ симулированы G (маска) + мышь + выстрел');
  } catch(e){ errors.push('input: '+e.message); }
}, 2500);

setTimeout(() => {
  clearInterval(framePump); realWs.close();
  const obj = els.get('objList'), team = els.get('team');
  const checks = [
    ['кадров отрендерено ('+frames+'), вызовов fillRect на главном канвасе: '+mainCtxCalls, frames > 30 && mainCtxCalls > 100],
    ['получены heist+state и прогнаны через клиент', gotHeist && gotState],
    ['HUD: цели отрисованы', obj && obj.innerHTML.includes('▸')],
    ['HUD: карточки команды отрисованы', team && team.innerHTML.includes('mate')],
    ['нет runtime-ошибок', errors.length === 0],
  ];
  let bad = 0;
  for (const [n, ok] of checks) { console.log(ok ? '✅' : '❌', n); if(!ok) bad++; }
  errors.slice(0,5).forEach(e => console.log('   🐞', e));
  console.log(bad ? '\n💥 UI-ТЕСТ ПРОВАЛЕН' : '\n🎉 UI-ТЕСТ ПРОЙДЕН: клиент рендерит и не падает');
  process.exit(bad ? 1 : 0);
}, 11000);
