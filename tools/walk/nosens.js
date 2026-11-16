const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-14T19:58:00-05:00') });
  await pg.goto('http://localhost:8765/?x=' + Date.now()); await pg.waitForTimeout(1200);
  for (const k of ['check', 'sky', 'align']) await pg.uncheck(`[data-step=${k}]`);
  await pg.click('[data-act=explore]'); await pg.waitForTimeout(3500);
  console.log('gate:', await pg.evaluate(() => ({ hidden: document.querySelector('#gate').classList.contains('hidden'), msg: document.querySelector('#gate-msg').innerText, skip: !document.querySelector('#gate-skip').classList.contains('hidden') })));
  await pg.screenshot({ path: 'nosens-gate.png' });
  await pg.evaluate(() => document.querySelector('#gate-skip').click()); await pg.waitForTimeout(1500);
  console.log('push:', await pg.evaluate(() => document.querySelector('#tab-push').innerText.slice(0, 300)), '| pill:', await pg.textContent('#st-pill'));
  await pg.screenshot({ path: 'nosens-push.png' });
  console.log('errors:', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
