// Build 27 checks: the sky view always shows a sky. No compass: assumed south, compass-point buttons, drag to turn. No sensors: drag to look around.
const { chromium, devices } = require('playwright');
const shot = (pg, n) => pg.screenshot({ path: `g27-${n}.png` });
(async () => {
  const b = await chromium.launch(); const out = [];
  const open = async (sim) => {
    const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
    const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', (e) => pg.errs.push(e.message));
    await pg.clock.install({ time: new Date('2026-11-14T19:58:00-05:00') });
    await pg.goto('http://localhost:8765/?' + (sim ? 'sim&' : '') + 'x=' + Date.now()); await pg.waitForTimeout(1200);
    for (const k of ['check', 'sky', 'align']) await pg.uncheck(`[data-step=${k}]`);
    return pg;
  };
  const state = (pg) => pg.evaluate(() => ({ pstat: (document.querySelector('#pstat') || {}).innerText, where: (document.querySelector('#whereami') || {}).innerText, turn: (document.querySelector('#d-az') || {}).innerText, tilt: (document.querySelector('#d-alt') || {}).innerText }));
  const ink = (pg) => pg.evaluate(() => { const cv = document.querySelector('#reticle'), d = cv.getContext('2d').getImageData(0, 130, cv.width, cv.height - 130).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 60) n++; return n; });
  const drag = async (pg, dx, dy) => { const r = await pg.evaluate(() => { const b = document.querySelector('#reticle').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await pg.mouse.move(r.x, r.y); await pg.mouse.down(); for (let i = 1; i <= 8; i++) await pg.mouse.move(r.x + dx * i / 8, r.y + dy * i / 8); await pg.mouse.up(); await pg.waitForTimeout(500); };

  // ---- A. sensors, no compass
  let pg = await open(true);
  await pg.click('[data-act=explore]'); await pg.click('#l-go'); await pg.waitForTimeout(400); await pg.click('#gate-sim'); await pg.waitForTimeout(500);
  await pg.evaluate(() => { window.sim._onAbs = () => {}; window.sim.compassOffsetSamples = []; window.sim.beta = 40; window.sim.alpha = 200; }); await pg.waitForTimeout(2000);
  console.log('A1 no compass, sky view:', JSON.stringify(await state(pg)), 'ink', await ink(pg)); await shot(pg, 'A1');
  await pg.click('.dirs [data-dir="270"]'); await pg.waitForTimeout(900);
  console.log('A2 after tapping W:', JSON.stringify(await state(pg)), '| toast:', (await pg.textContent('#toast')).trim()); await shot(pg, 'A2');
  await drag(pg, 80, 0); console.log('A3 after dragging right 80px:', JSON.stringify(await state(pg)));
  await pg.evaluate(() => { window.sim.alpha += 90; }); await pg.waitForTimeout(1800);
  console.log('A4 after turning the phone 90°:', JSON.stringify(await state(pg)));
  await pg.click('#sv-find'); await pg.waitForTimeout(300); await pg.fill('#q', 'M31'); await pg.waitForTimeout(400); await pg.click('#flist li[data-k]'); await pg.waitForTimeout(1500);
  console.log('A5 target, direction set by hand:', JSON.stringify(await state(pg))); await shot(pg, 'A5');
  console.log('errors:', pg.errs); await pg.context().close();

  // ---- B. sensors, no compass, straight to a target (direction never given)
  pg = await open(true);
  await pg.click('[data-act=observe]'); await pg.click('#l-go'); await pg.waitForTimeout(400); await pg.click('#gate-sim'); await pg.waitForTimeout(500);
  await pg.evaluate(() => { window.sim._onAbs = () => {}; window.sim.compassOffsetSamples = []; window.sim.beta = 40; }); await pg.waitForTimeout(1200);
  await pg.fill('#q', 'M31'); await pg.waitForTimeout(400); await pg.click('#flist li[data-k]'); await pg.waitForTimeout(1500);
  console.log('B1 target, no compass, no direction:', JSON.stringify(await state(pg)), 'ink', await ink(pg)); await shot(pg, 'B1');
  // compass comes alive (phone lowered): should switch to the compass guess by itself
  await pg.evaluate(() => { delete window.sim._onAbs; }); await pg.waitForTimeout(1500);
  console.log('B2 compass now reading:', JSON.stringify(await state(pg)));
  console.log('errors:', pg.errs); await pg.context().close();

  // ---- C. no sensor data at all
  pg = await open(false);
  await pg.click('[data-act=explore]'); await pg.click('#l-go'); await pg.waitForTimeout(3500);
  await pg.evaluate(() => document.querySelector('#gate-skip').click()); await pg.waitForTimeout(6000);
  console.log('C1 no sensors, sky view:', JSON.stringify(await state(pg)), 'ink', await ink(pg), '| pill:', (await pg.textContent('#st-pill')).trim()); await shot(pg, 'C1');
  await drag(pg, -120, 60); console.log('C2 after dragging left and down:', JSON.stringify(await state(pg))); await shot(pg, 'C2');
  await pg.click('#sv-find'); await pg.waitForTimeout(300); await pg.fill('#q', 'M45'); await pg.waitForTimeout(400); await pg.click('#flist li[data-k]'); await pg.waitForTimeout(1500);
  console.log('C3 target, no sensors:', JSON.stringify(await state(pg)), 'ink', await ink(pg)); await shot(pg, 'C3');
  await pg.click('#ps-sens'); await pg.waitForTimeout(500); console.log('C4 Turn on -> start screen shown:', await pg.evaluate(() => !document.querySelector('#gate').classList.contains('hidden')));
  console.log('errors:', pg.errs); await pg.context().close();

  // ---- D. compass present (unchanged path)
  pg = await open(true);
  await pg.click('[data-act=explore]'); await pg.click('#l-go'); await pg.waitForTimeout(400); await pg.click('#gate-sim'); await pg.waitForTimeout(2500);
  console.log('D1 compass, sky view:', JSON.stringify(await state(pg)), 'ink', await ink(pg)); await shot(pg, 'D1');
  console.log('errors:', pg.errs);
  await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
