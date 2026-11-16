const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-16T16:20:00-05:00') });
  await pg.goto('http://localhost:8765/?x=' + Date.now()); await pg.waitForTimeout(2500);
  await pg.click('[data-act=plan]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await pg.waitForTimeout(2500);
  const plan = () => pg.evaluate(() => [...document.querySelectorAll('#pl-list .t1')].map((x) => x.textContent.trim()).slice(0, 5).join(' | '));
  // by hand: add one target from its page
  await pg.evaluate(() => { const el = [...document.querySelectorAll('#tab-plan [data-info]')].find((x) => /M57/.test(x.textContent)); el.click(); }); await pg.waitForTimeout(600);
  await pg.click('#sh-plan'); await pg.waitForTimeout(400); await pg.click('#sh-x'); await pg.waitForTimeout(400);
  console.log('by hand:', await plan()); console.log('suggestion:', await pg.evaluate(() => (document.querySelector('#pl-open') || {}).innerText));
  await pg.screenshot({ path: 'open52.png' });
  await pg.click('#pl-openadd'); await pg.waitForTimeout(500); console.log('after Add it:', await plan(), '| suggestion still shown:', await pg.evaluate(() => !!document.querySelector('#pl-open')));
  // automatic
  await pg.click('#pl-auto'); await pg.waitForTimeout(300); await pg.click('#pl-auto').catch(() => {}); await pg.waitForTimeout(900);
  console.log('built for me:', await plan());
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
