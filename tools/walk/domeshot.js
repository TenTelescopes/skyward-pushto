const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 780 }, timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-14T21:30:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(1200);
  await pg.uncheck('[data-step=check]'); await pg.click('[data-act=observe]'); await pg.waitForTimeout(400); await pg.click('#gate-sim'); await pg.waitForTimeout(2000);
  await pg.evaluate(() => { window.sim.bend = 3; window.sim.noise = 0.01; });
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name'); await pg.evaluate((n) => window.simGoto(n), name); await pg.waitForTimeout(1800); await pg.click('#a-ok'); await pg.waitForTimeout(900); }
  const target = async (label) => { await pg.click('nav#tabs button[data-tab=find]'); await pg.waitForTimeout(250); await pg.fill('#q', label); await pg.waitForTimeout(350); await pg.click('#flist li[data-k]'); await pg.waitForTimeout(500); };
  // with only the 2 alignment stars: correction should say it is waiting
  await pg.click('#st-pill'); await pg.waitForTimeout(600); console.log('2 points:', (await pg.textContent('#dome-info p')).slice(0, 150));
  const sy = async (L) => { for (const l of L) { await target(l); await pg.evaluate((n) => window.simGoto(n), l); await pg.waitForTimeout(1900); await pg.click('#b-sync'); await pg.waitForTimeout(500); } };
  await sy(['Deneb', 'Polaris']);
  await target('M33'); await pg.evaluate(() => window.simGoto('M33')); await pg.waitForTimeout(1900);
  console.log('4 points, push numbers:', (await pg.evaluate(() => [...document.querySelectorAll('#pinfo span')].map((x) => x.textContent))).slice(4).join(' | '));
  await pg.click('#st-pill'); await pg.waitForTimeout(600); console.log('4 points:', (await pg.textContent('#dome-info p')).slice(0, 200));
  await sy(['Aldebaran', 'Hamal', 'Altair']);
  await target('M33'); await pg.evaluate(() => window.simGoto('M33')); await pg.waitForTimeout(1900);
  console.log('push numbers:', (await pg.evaluate(() => [...document.querySelectorAll('#pinfo span')].map((x) => x.textContent))).slice(4).join(' | '));
  await pg.click('#st-pill'); await pg.waitForTimeout(700);
  await pg.evaluate(() => { document.querySelector('#dome').scrollIntoView({ block: 'start' }); document.querySelector('main').scrollTop -= 50; }); await pg.waitForTimeout(400);
  await pg.screenshot({ path: process.argv[2] });
  await pg.evaluate(() => { document.querySelector('#dome-corr').scrollIntoView({ block: 'start' }); document.querySelector('main').scrollTop -= 20; }); await pg.waitForTimeout(300);
  await pg.screenshot({ path: process.argv[3] });
  console.log('errors:', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 5).join('\n')); process.exit(1); });
