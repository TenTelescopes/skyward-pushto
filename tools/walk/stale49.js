// The user's case: 200 Visual, sensors off, the Pleiades page opened well after positions were last refreshed.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-16T15:40:00-05:00') });
  await pg.goto('http://localhost:8765/?x=' + Date.now()); await pg.waitForTimeout(2500);
  await pg.click('[data-act=plan]'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const k = 'skyward-pushto-v1', s = JSON.parse(localStorage.getItem(k)); s.active = 'sw200v'; localStorage.setItem(k, JSON.stringify(s)); });
  await pg.reload(); await pg.waitForTimeout(3000);
  await pg.click('[data-act=plan]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await pg.waitForTimeout(2500);
  await pg.clock.fastForward(13 * 60000); await pg.waitForTimeout(500);                       // thirteen minutes pass with the list on screen
  await pg.evaluate(() => { const el = [...document.querySelectorAll('#tab-plan [data-info]')].find((x) => /M45/.test(x.textContent)); el.click(); }); await pg.waitForTimeout(900);
  console.log(await pg.evaluate(() => [...document.querySelectorAll('#sh-eps canvas')].map((cv) => { const d = cv.getContext('2d').getImageData(100, 100, 100, 100).data; let mx = 0; for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i]); return cv.parentNode.querySelector('b').textContent + ': brightest pixel near the middle ' + mx; }).join(' | ')));
  await pg.screenshot({ path: 'stale49.png' }); console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
