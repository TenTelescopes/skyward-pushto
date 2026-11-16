const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('http://localhost:8765/?x=' + Date.now()); await pg.waitForTimeout(1000);
  await pg.screenshot({ path: 'spl55.png' });
  console.log('img loaded', await pg.evaluate(() => { const i = document.querySelector('.spl-scope'); return [i.complete, i.naturalWidth, Math.round(i.getBoundingClientRect().width)]; }));
  await pg.waitForTimeout(2000);
  const vis = (s) => pg.evaluate((s) => !document.querySelector(s).classList.contains('hidden'), s);
  const dock = () => pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1') || '{}').dock);
  // plan: no question
  await pg.click('[data-act=plan]'); await pg.click('#l-go'); await pg.waitForTimeout(800);
  console.log('plan asks?', await vis('#dockq'), 'gate hidden', !(await vis('#gate')));
  await pg.reload(); await pg.waitForTimeout(3000);
  await pg.click('[data-act=observe]'); await pg.click('#l-go'); await pg.waitForTimeout(500);
  console.log('observe asks?', await vis('#dockq')); await pg.screenshot({ path: 'dq1.png' });
  await pg.click('#dq-no'); await pg.waitForTimeout(300); await pg.screenshot({ path: 'dq2.png' });
  await pg.click('#dq-back'); await pg.click('#dq-no'); await pg.click('#dq-go'); await pg.waitForTimeout(1500);
  console.log('after No: dock =', await dock(), 'question gone', !(await vis('#dockq')), 'gate msg:', (await pg.textContent('#gate-msg')).slice(0, 80), 'gate visible', await vis('#gate'));
  await pg.reload(); await pg.waitForTimeout(3000);
  await pg.click('[data-act=observe]'); await pg.click('#l-go'); await pg.waitForTimeout(500);
  console.log('second time asks?', await vis('#dockq'));
  await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('skyward-pushto-v1')); delete s.dock; localStorage.setItem('skyward-pushto-v1', JSON.stringify(s)); });
  await pg.reload(); await pg.waitForTimeout(3000);
  await pg.click('[data-act=game]'); await pg.click('#l-go'); await pg.waitForTimeout(400); await pg.click('#dq-yes'); await pg.waitForTimeout(800);
  console.log('game Yes: dock =', await dock());
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
