// Проверка модалки настроек графики: открыть, переключить пресет, чекбоксы, убедиться в сохранении
const puppeteer = require('puppeteer-core');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/tmp/chromium', headless: 'shell',
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/stublibs' },
    args: ['--no-sandbox','--no-zygote','--single-process','--in-process-gpu','--disable-dev-shm-usage',
      '--window-size=1280,720','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.setDefaultTimeout(120000);
  let errors = 0;
  page.on('pageerror', e => { errors++; console.log('[pageerror]', String(e).slice(0, 300)); });
  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#gfxBtn', { timeout: 30000 });
  await sleep(1500);
  await page.click('#gfxBtn');
  await sleep(600);
  await page.screenshot({ path: path.join('/home/user/paydayGame/screenshots', 'v4a-settings.png') });
  console.log('shot: settings modal');
  // пресет «Низкое»
  await page.select('#gfxPreset', 'low');
  await sleep(400);
  let st = await page.evaluate(() => ({
    saved: localStorage.getItem('nv84-gfx'),
    shadows: document.getElementById('gfxShadows').checked,
    bloom: document.getElementById('gfxBloom').checked,
    eff: window.__nv84.gfx,
  }));
  console.log('low preset:', JSON.stringify(st));
  // чекбокс FPS -> свои настройки
  await page.click('#gfxFps');
  await sleep(300);
  st = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('nv84-gfx')),
    fpsVisible: document.getElementById('fps').style.display,
  }));
  console.log('fps on:', JSON.stringify(st));
  // ползунок разрешения 60%
  await page.evaluate(() => { const r = document.getElementById('gfxRes'); r.value = 60; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(300);
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('nv84-gfx')).resScale);
  console.log('resScale saved:', st);
  // вернуть авто и закрыть
  await page.select('#gfxPreset', 'auto');
  await page.click('#gfxClose');
  await sleep(400);
  const open = await page.evaluate(() => document.getElementById('gfxModal').classList.contains('open'));
  console.log('modal closed:', !open, '| pageerrors:', errors);
  await browser.close();
  console.log(errors === 0 ? 'GFX TEST PASS' : 'GFX TEST FAIL');
})().catch(e => { console.error('GFX TEST CRASH:', e.message); process.exit(1); });
