const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-17T18:15:00-05:00') });
  // east blocked below 30°, south-east below 15°: Saturn / the Pleiades rising behind "trees"
  const h = new Array(72).fill(0); for (let i = 0; i < 72; i++) { const az = (i + 0.5) * 5; if (az > 40 && az < 115) h[i] = 30; else if (az >= 115 && az < 170) h[i] = 15; }
  await pg.addInitScript((h) => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes', site: { lat: 43.55, lon: -80.25, elev: 330, source: 'entered manually' }, horizon: { h, how: 'taps', when: 1, lat: 43.55, lon: -80.25 } })); } catch (e) {} }, h);
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3000);
  const wait = (ms) => pg.clock.runFor(ms);
  await pg.uncheck('[data-step=check]').catch(() => {}); await pg.click('[data-act=explore]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await wait(600);
  if (await pg.isVisible('#gate-sim')) { await pg.click('#gate-sim'); await wait(1800); }
  await pg.click('#st-pill'); await wait(800);
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name').catch(() => null); if (!name) break; await pg.evaluate((n) => window.simGoto(n), name); await wait(1700); await pg.click('#a-ok'); await wait(1000); }
  await pg.click('nav#tabs button[data-tab=push]'); await wait(800);
  const m45 = await pg.evaluate(() => window.simGoto('M45')); console.log('M45 at alt', m45.alt.toFixed(0), 'az', m45.az.toFixed(0));
  await pg.evaluate(([a, z]) => window.simGoto({ alt: 22, az: z }), [m45.alt, m45.az]); await wait(2500);
  for (let i = 0; i < 3; i++) { await pg.evaluate(() => document.querySelector('#z-out').click()); await wait(400); }
  await wait(1200); const cv = await pg.$('#reticle'); await cv.screenshot({ path: 'h66_on.png' });
  console.log('toggle:', await pg.textContent('#z-hz'));
  await pg.evaluate(() => document.querySelector('#z-hz').click()); await wait(1200); await cv.screenshot({ path: 'h66_off.png' });
  console.log('after tap:', await pg.textContent('#z-hz'), '| stored', await pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1')).hzShow), '| toast:', (await pg.textContent('#toast')).slice(0, 80));
  await pg.evaluate(() => document.querySelector('#z-hz').click()); await wait(500);
  // night mode look
  await pg.evaluate(() => document.querySelector('.shadebtn').click()); await wait(400);
  await pg.evaluate(() => { const r = document.querySelector('#shadepop input[type=range]'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(1500); await cv.screenshot({ path: 'h66_night.png' });
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
