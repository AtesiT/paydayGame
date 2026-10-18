// Скриншотер 3D-клиента: настоящий Chromium (SwiftShader WebGL) + puppeteer-core.
// Запуск: node scripts/screenshot.js [heistId]   (bank | jewelry | casino)
// Требует: /tmp/chromium + стабы NSS в /tmp/stublibs (песочница), поднятый сервер на :3000.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const HEIST = process.argv[2] || 'bank';
const TAG = process.argv[3] || '3d';
const OUT = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/tmp/chromium',
    headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/stublibs' },
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--window-size=1280,720', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--mute-audio'
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) console.log(`[browser:${msg.type()}]`, msg.text().slice(0, 300)); });
  page.on('pageerror', err => console.log('[pageerror]', String(err).slice(0, 400)));

  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#startBtn:not([disabled])', { timeout: 30000 }).catch(() => {});
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, `${TAG}-lobby.png`) });
  console.log('shot: lobby');

  await page.type('#nameIn', '', { delay: 0 }).catch(() => {});
  await page.evaluate((h) => {
    const el = document.querySelector(`[data-heist="${h}"]`);
    if (el) el.click();
  }, HEIST);
  await page.click('#startBtn');

  await page.waitForFunction(() => window.__nv84 && window.__nv84.state && window.__nv84.frames > 20, { timeout: 120000 });
  await page.screenshot({ path: path.join(OUT, `${TAG}-${HEIST}-spawn.png`) });
  console.log('shot: spawn');

  // маска + стрельба (тревога -> боты оживают), затем камера в зал
  await page.mouse.move(640, 250);
  await page.evaluate(() => {
    if (document.activeElement) document.activeElement.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyG', bubbles: true }));
  });
  await sleep(600);
  await page.mouse.down();
  await sleep(700);
  await page.mouse.up();
  const spots = await page.evaluate(() => ({
    hall: { x: window.__nv84.map.w / 2, y: window.__nv84.map.h * 0.52, dist: 10.5 },
    vault: { x: window.__nv84.map.vaultDoor.x, y: window.__nv84.map.vaultDoor.y + 2.4, dist: 9.5 },
    close: { x: 7.5, y: window.__nv84.map.h * 0.6, dist: 7.4 }
  }));
  const waitFrames = async (n) => {
    const f0 = await page.evaluate(() => window.__nv84.frames);
    await page.waitForFunction((f, nn) => window.__nv84.frames > f + nn, { timeout: 90000 }, f0, n).catch(() => {});
  };
  await page.evaluate((c) => { window.__nv84.cam = c; }, spots.vault);
  await waitFrames(7);
  await page.screenshot({ path: path.join(OUT, `${TAG}-${HEIST}-later.png`) });
  console.log('shot: later (vault)');

  await page.evaluate((c) => { window.__nv84.cam = c; }, spots.hall);
  await waitFrames(7);
  await page.screenshot({ path: path.join(OUT, `${TAG}-${HEIST}-inside.png`) });
  console.log('shot: inside (hall)');

  // крупный план: камера на центроид команды по живому стейту
  const dynClose = await page.evaluate(() => {
    const s = window.__nv84.state;
    const hs = s.heisters.filter(h => !h.escaped);
    const cx = hs.reduce((a, h) => a + h.x, 0) / hs.length;
    const cy = hs.reduce((a, h) => a + h.y, 0) / hs.length;
    const c = { x: cx, y: cy, dist: 6.4 };
    window.__nv84.cam = c;
    return c;
  });
  console.log('dynamic close at', JSON.stringify(dynClose));
  await waitFrames(8);
  await page.screenshot({ path: path.join(OUT, `${TAG}-${HEIST}-close.png`) });
  console.log('shot: close (team)');

  const info = await page.evaluate(() => ({
    frames: window.__nv84.frames,
    state: window.__nv84.state ? { alarm: window.__nv84.state.alarm, enemies: window.__nv84.state.enemies.length } : null
  }));
  console.log('info:', JSON.stringify(info));
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
