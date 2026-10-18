// UI-тест 3D-клиента в настоящем Chromium (WebGL/SwiftShader) через puppeteer-core.
// Требует запущенный сервер (npm start) и браузер: /tmp/chromium + /tmp/stublibs (песочница)
// либо CHROMIUM_PATH=/path/to/chrome. Без браузера тест пропускается (SKIP).
const fs = require('fs');

const CHROMIUM = process.env.CHROMIUM_PATH || '/tmp/chromium';
if (!fs.existsSync(CHROMIUM)) { console.log('SKIP: браузер не найден (' + CHROMIUM + ')'); process.exit(0); }
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { console.log('SKIP: puppeteer-core не установлен (npm i --no-save puppeteer-core)'); process.exit(0); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('UI-ТЕСТ: жёсткий таймаут 9 минут (SwiftShader слишком медленный)'); process.exit(1); }, 9 * 60 * 1000);
let failures = 0;
const check = (name, ok, extra) => { console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM, headless: process.env.CHROMIUM_PATH ? true : 'shell',
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/stublibs' },
    args: ['--no-sandbox', '--no-zygote', '--single-process', '--in-process-gpu',
           '--disable-dev-shm-usage', '--window-size=1280,720',
           '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio',
           '--js-flags=--max-old-space-size=2048']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(150000); // главный поток надолго занят компиляцией шейдеров в SwiftShader
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 60000 });
  await sleep(6000);
  const lobby = await page.evaluate(() => ({
    masks: document.getElementById('maskCards').children.length,
    heists: document.getElementById('heistCards').children.length,
    players: document.getElementById('playersList').children.length,
    gl: !!document.querySelector('#gl canvas'),
    fallback: getComputedStyle(document.getElementById('fallback')).display
  }));
  check('лобби: карточки масок построены', lobby.masks === 4, 'masks=' + lobby.masks);
  check('лобби: 3 ограбления', lobby.heists === 3, 'heists=' + lobby.heists);
  check('лобби: список команды (игрок+боты)', lobby.players >= 4, 'players=' + lobby.players);
  check('WebGL-канвас создан', lobby.gl && lobby.fallback === 'none');

  await page.waitForSelector('#startBtn:not([disabled])', { timeout: 30000 }).catch(() => {});
  await page.click('#startBtn');
  const ev = async (fn) => { try { return await page.evaluate(fn); } catch { return null; } };
  await page.mouse.move(640, 300).catch(() => {});
  // SwiftShader: главный поток надолго занят компиляцией шейдеров, CDP-запросы висят.
  // Один терпеливый цикл: периодически жмём G и ждём, пока в стейте появится маска.
  let masked = false;
  for (let i = 0; i < 14 && !masked; i++) {
    await page.keyboard.press('KeyG').catch(() => {});
    try {
      await page.waitForFunction(() => {
        const s = window.__nv84.state; if (!s) return false;
        const me = s.heisters.find(h => h.id === s.youId);
        return !!(me && me.masked);
      }, { timeout: 25000, polling: 1000 });
      masked = true;
    } catch { /* поток ещё занят — пробуем ещё */ }
  }
  check('ограбление стартовало, стейты идут, G — маска надевается', masked);
  if (!masked) { await browser.close(); console.log('\nUI-ТЕСТ: СТАРТ/МАСКА НЕ УДАЛИСЬ'); process.exit(1); }

  await page.mouse.down().catch(() => {});
  let shot = false;
  for (let i = 0; i < 25 && !shot; i++) {
    shot = await ev(() => {
      const s = window.__nv84.state; if (!s) return false;
      const me = s.heisters.find(h => h.id === s.youId);
      return s.bullets.length > 0 || (me && (me.mag < 30 || me.reserve < 150));
    });
    if (!shot) await sleep(700);
  }
  await page.mouse.up().catch(() => {});
  check('ЛКМ — стрельба работает (пули/патроны)', shot === true);

  const hud = await ev(() => ({
    ammo: document.getElementById('ammoVal').textContent,
    obj: document.getElementById('objList').textContent.length,
    money: document.getElementById('moneyVal').textContent
  })) || { ammo: '', obj: 0, money: '' };
  check('HUD: патроны/деньги/цели заполнены', /\d/.test(hud.ammo) && hud.obj > 3 && hud.money.includes('$'), JSON.stringify(hud));

  let rendered = true;
  try {
    await page.waitForFunction(() => window.__nv84.frames > 3, { timeout: 120000, polling: 3000 });
  } catch { rendered = false; }
  const frames = await ev(() => window.__nv84.frames);
  check('3D-кадры рендерятся (WebGL)', rendered, 'frames=' + frames);

  check('нет необработанных ошибок на странице', errors.length === 0, errors[0] || '');
  await browser.close();
  console.log(failures ? `\nUI-ТЕСТ: ${failures} ПРОВАЛОВ` : '\nUI-ТЕСТ ПРОЙДЕН ✔');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('UI-ТЕСТ УПАЛ:', e.message); process.exit(1); });
