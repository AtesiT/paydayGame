'use strict';
/* Автотест: подключается к серверу, играет ~30 секунд, проверяет системы. */
const WebSocket = require('ws');
const URL = process.env.GAME_URL || 'ws://localhost:3000';
const ws = new WebSocket(URL);
const send = o => ws.send(JSON.stringify(o));
const checks = [];
const check = (name, ok) => { checks.push([name, !!ok]); console.log((ok ? '✅' : '❌'), name); };

let phase = 'connect', state = null, map = null, meId = null;
let startPos = null, movedDist = 0, sawBullets = false, sawMasked = false, sawAlarm = false, sawEnemies = false,
    mag0 = null, magDropped = false, events = 0, states = 0, botMoved = false, botStart = null;
const T0 = Date.now();
const el = () => (Date.now() - T0) / 1000;

ws.on('open', () => console.log('🔌 подключился'));
ws.on('message', raw => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') { check('welcome + маски/оружие', m.masks && m.weapons); send({ t:'join', name:'ТЕСТ-БОТ', mask:'wolf', weapon:'smg' }); }
  else if (m.t === 'lobby' && phase === 'connect') { phase = 'starting'; check('лобби: 3 ограбления', m.heists.length === 3); send({ t:'start', heist:'bank' }); }
  else if (m.t === 'heist') { map = m.map; phase = 'play'; check('карта банка '+map.w+'×'+map.h, map.grid.length === map.w * map.h); }
  else if (m.t === 'ev') { events++; }
  else if (m.t === 'state') {
    state = m; states++; meId = m.youId;
    const me = m.heisters.find(h => h.id === meId);
    if (!me) return;
    if (!startPos) { startPos = { x: me.x, y: me.y }; mag0 = me.mag; const bot = m.heisters.find(h => h.isBot); if (bot) botStart = { x: bot.x, y: bot.y }; }
    movedDist = Math.hypot(me.x - startPos.x, me.y - startPos.y);
    if (botStart) { const bot = m.heisters.find(h => h.isBot); if (bot && Math.hypot(bot.x - botStart.x, bot.y - botStart.y) > 0.8) botMoved = true; }
    if (me.masked) sawMasked = true;
    if (me.mag < mag0) magDropped = true;
    if (m.bullets.length) sawBullets = true;
    if (m.alarm) sawAlarm = true;
    if (m.enemies.length) sawEnemies = true;
  }
});

// сценарий игры
const iv = setInterval(() => {
  if (!state) return;
  const me = state.heisters.find(h => h.id === meId);
  if (!me) return;
  const t = el();
  if (t < 1) return;
  if (t < 2) { send({ t:'act', a:'maskOrBag' }); return; }                 // надеть маску
  if (t < 7) { // идти вверх по экрану (к входу в банк) и стрелять
    send({ t:'input', mx:0, my:-1, aimx:me.x, aimy:me.y-5, shoot:t>4, interact:false, sprint:true, crouch:false });
    return;
  }
  if (t < 26) { // хаотичная игра: кружение + стрельба по ближайшему врагу/охраннику
    const foes = [...state.enemies, ...state.guards.filter(g=>!g.dead)];
    let aimx = me.x + Math.cos(t) * 5, aimy = me.y + Math.sin(t) * 5;
    let best = 1e9; for (const f of foes) { const d = Math.hypot(f.x-me.x, f.y-me.y); if (d < best) { best = d; aimx = f.x; aimy = f.y; } }
    send({ t:'input', mx:Math.round(Math.cos(t*0.7)), my:Math.round(Math.sin(t*0.7)), aimx, aimy, shoot:true, interact:t%3<0.4, sprint:false, crouch:false });
    if (Math.random() < 0.05) send({ t:'act', a:'reload' });
    if (Math.random() < 0.03) send({ t:'act', a:'shout' });
    return;
  }
  clearInterval(iv);
  check('снапшоты состояния приходят ('+states+')', states > 100);
  check('команда: 4 грабителя (1 игрок + 3 бота)', state.heisters.length === 4 && state.heisters.filter(h=>h.isBot).length === 3);
  check('игрок двигался (дист. '+movedDist.toFixed(1)+')', movedDist > 1);
  check('боты-напарники двигаются', botMoved);
  check('маска наделась', sawMasked);
  check('стрельба: пули летели и магазин тратился', sawBullets && magDropped);
  check('тревога сработала (loud)', sawAlarm);
  check('полиция прибыла волнами', sawEnemies);
  check('событий получено: '+events, events > 2);
  check('цели (objectives) не пусты', state.objectives && state.objectives.length > 0);
  const failed = checks.filter(c=>!c[1]);
  console.log(failed.length ? '\n💥 ПРОВАЛЕНО: '+failed.map(f=>f[0]).join('; ') : '\n🎉 ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
  ws.close(); process.exit(failed.length ? 1 : 0);
}, 50);

setTimeout(() => { console.log('⏰ ТАЙМАУТ'); process.exit(2); }, 45000);
