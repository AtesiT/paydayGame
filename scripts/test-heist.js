'use strict';
/* Глубокий тест: полный цикл ограбления ювелирного с ботами-напарниками. */
const WebSocket = require('ws');
const ws = new WebSocket(process.env.GAME_URL || 'ws://localhost:3000');
const send = o => ws.send(JSON.stringify(o));
const checks = [];
const check = (n, ok) => { if (!checks.find(c=>c[0]===n)) { checks.push([n,!!ok]); console.log(ok?'✅':'❌', n); } };

let state=null, map=null, stage='join', stageT=0, endMsg=null, sawCarry=false, sawDrilling=false;

ws.on('message', raw=>{
  const m=JSON.parse(raw);
  if(m.t==='welcome'){ send({t:'join',name:'ТЕСТ-2',mask:'tiger',weapon:'rifle'}); }
  else if(m.t==='heist' && stage==='join'){ check('подключение посреди ограбления: занял место бота', true); map=m.map; stage='toLobby'; }
  else if(m.t==='lobby' && stage==='join'){ check('подключение посреди ограбления (успело закончиться)', true); stage='start'; }
  else if(m.t==='backToLobby'){ check('хост сбросил ограбление в лобби', true); stage='start'; }
  else if(m.t==='heist' && stage==='starting'){ map=m.map; check('старт: ювелирный '+map.w+'×'+map.h, map.required===5); stage='mask'; stageT=0; }
  else if(m.t==='state'){ state=m;
    const me=m.heisters.find(h=>h.id===m.youId);
    if(me){ if(me.carry) sawCarry=true; }
    if(m.drills.some(d=>d.state==='drilling')) sawDrilling=true;
  }
  else if(m.t==='end'){ endMsg=m.end; }
});

/* BFS-навигация по клиентской копии карты */
function solid(tx,ty){ if(tx<0||ty<0||tx>=map.w||ty>=map.h) return true; const t=map.grid[ty*map.w+tx]; return t===1||t===2||(t===6&&!state.vaultOpen); }
function bfs(sx,sy,tx,ty){
  const W=map.w, key=(x,y)=>y*W+x, prev=new Map(), q=[[sx,sy]]; prev.set(key(sx,sy),null);
  while(q.length){ const [x,y]=q.shift(); if(x===tx&&y===ty) break;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=x+dx,ny=y+dy;
      if(!prev.has(key(nx,ny))&&!solid(nx,ny)){ prev.set(key(nx,ny),[x,y]); q.push([nx,ny]); } } }
  if(!prev.has(key(tx,ty))) return null;
  const path=[]; let cur=[tx,ty]; while(cur){ path.unshift({x:cur[0]+0.5,y:cur[1]+0.5}); cur=prev.get(key(cur[0],cur[1])); }
  return path;
}
function freeNear(tx,ty){ if(!solid(tx,ty)) return [tx,ty];
  for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[-1,1],[1,-1],[-1,-1]]) if(!solid(tx+dx,ty+dy)) return [tx+dx,ty+dy];
  return [tx,ty]; }
let path=null, pathGoal=null;
function moveToward(me, gx, gy, extra){
  const [fx,fy]=freeNear(Math.floor(gx),Math.floor(gy));
  if(!pathGoal || pathGoal[0]!==fx || pathGoal[1]!==fy || !path || !path.length){ path=bfs(Math.floor(me.x),Math.floor(me.y),fx,fy); pathGoal=[fx,fy]; }
  let wp = path && path.length>1 ? path[1] : {x:gx,y:gy};
  if(path && Math.hypot(me.x-wp.x,me.y-wp.y)<0.3){ path.shift(); wp=path[0]||{x:gx,y:gy}; }
  const dx=wp.x-me.x, dy=wp.y-me.y, l=Math.hypot(dx,dy)||1;
  // мировой вектор -> экранный (сервер: wx=mx+2my, wy=2my-mx)
  const mx=(dx/l-dy/l)/2*1.4, my=(dx/l+dy/l)/4*1.4;
  const foes=[...state.enemies, ...(state.alarm?state.guards.filter(g=>!g.dead):[])];
  let aimx=me.x+dx*3, aimy=me.y+dy*3, best=1e9;
  for(const f of foes){ const d=Math.hypot(f.x-me.x,f.y-me.y); if(d<best){best=d;aimx=f.x;aimy=f.y;} }
  send({t:'input', mx:Math.max(-1,Math.min(1,mx)), my:Math.max(-1,Math.min(1,my)), aimx, aimy,
        shoot:best<9, interact:!!(extra&&extra.interact), sprint:false, crouch:false});
  return Math.hypot(me.x-gx,me.y-gy);
}
function holdInteract(me){
  const foes=state.enemies; let aimx=me.x, aimy=me.y-4, best=1e9;
  for(const f of foes){ const d=Math.hypot(f.x-me.x,f.y-me.y); if(d<best){best=d;aimx=f.x;aimy=f.y;} }
  send({t:'input',mx:0,my:0,aimx,aimy,shoot:best<8,interact:true,sprint:false,crouch:false});
}

const iv=setInterval(()=>{
  stageT+=0.05;
  if(stage==='toLobby'){ send({t:'toLobby'}); stage='waitLobby'; return; }
  if(stage==='start'){ send({t:'start',heist:'jewelry'}); stage='starting'; return; }
  if(!state||!map) return;
  const me=state.heisters.find(h=>h.id===state.youId);
  if(!me) return;
  if(endMsg){
    check('ограбление завершено, победа: '+endMsg.win+' · выплата $'+endMsg.payout.toLocaleString()+' · сумок: '+endMsg.secured, true);
    finish(); return;
  }
  if(me.custody){ console.log('⛓️ тест-игрок под стражей, ждём финал от ботов…'); if(stageT>180) finish(); return; }
  if(me.downed){ if(stageT>40){} return; } // ждём бота-спасателя

  if(stage==='mask'){ send({t:'act',a:'maskOrBag'}); send({t:'act',a:'bots'}); if(me.masked){ check('маска надета, ботам приказано таскать сумки', true); stage='drill'; stageT=0; path=null; } return; }
  if(stage==='drill'){
    const safe=state.drills.find(d=>d.kind==='safe'&&d.state!=='done');
    if(!safe||sawDrilling){ check('дрель установлена и пилит сейф', sawDrilling); stage='haul'; stageT=0; path=null; return; }
    const d=moveToward(me,safe.x,safe.y,{interact:true});
    if(d<1.8) holdInteract(me);
    if(stageT>60){ check('дрель установлена и пилит сейф', sawDrilling); stage='haul'; stageT=0; path=null; }
    return;
  }
  if(stage==='haul'){
    if(state.secured>=1) check('сумка вынесена в фургон (secured='+state.secured+')', true);
    if(state.secured>=state.required){ stage='escape'; stageT=0; path=null; console.log('🚐 минимум набран — эвакуация!'); return; }
    if(me.carry){ check('игрок упаковал и несёт сумку с лутом', true); const e=map.escape; moveToward(me,e.x+e.w/2,e.y+e.h/2); }
    else {
      const ground=state.bags.filter(b=>!b.carried)[0];
      const lp=state.loot.filter(l=>l.left>0).sort((a,b)=>Math.hypot(a.x-me.x,a.y-me.y)-Math.hypot(b.x-me.x,b.y-me.y))[0];
      const tgt = ground||lp;
      if(tgt){ const d=moveToward(me,tgt.x,tgt.y,{interact:true}); if(d<1.8) holdInteract(me); }
    }
    if(Math.random()<0.02) send({t:'act',a:'shout'});
    if(stageT>170){ console.log('⏱ лимит стадии haul'); finish(); }
    return;
  }
  if(stage==='escape'){
    const e=map.escape; moveToward(me,e.x+e.w/2,e.y+e.h/2);
    if(stageT>75){ console.log('⏱ эвакуация затянулась'); finish(); }
    return;
  }
},50);

function finish(){
  clearInterval(iv);
  check('видели сумку на спине грабителя', sawCarry);
  const failed=checks.filter(c=>!c[1]);
  console.log(failed.length?'\n💥 ПРОВАЛЕНО: '+failed.map(f=>f[0]).join('; '):'\n🎉 ГЛУБОКИЙ ТЕСТ ПРОЙДЕН ЦЕЛИКОМ');
  ws.close(); process.exit(failed.length?1:0);
}
setTimeout(()=>{ console.log('⏰ ОБЩИЙ ТАЙМАУТ'); finish(); }, 280000);
