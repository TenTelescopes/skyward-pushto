const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-17T17:00:00-05:00') });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes', site: { lat: 43.55, lon: -80.25, elev: 330, source: 'entered manually' }, launch: { check: false, sky: false, align: true, horizon: false } })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3000);
  const wait = (ms) => pg.clock.runFor(ms);
  const tap = (sel) => pg.evaluate((s) => document.querySelector(s).dispatchEvent(new MouseEvent('click', { bubbles: true })), sel);
  await pg.click('[data-act=plan]'); await pg.click('#l-go'); await wait(2500); await tap('#pl-auto'); await wait(2500);
  const order = () => pg.evaluate(() => [...document.querySelectorAll('#pl-list .t1')].map((e) => e.textContent.trim().split(/\s/).slice(0, 2).join(' ').slice(0, 9)).join(' | '));
  const stored = () => pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1')).plan.items.map((x) => x.key.replace(/^\w+:/, '')).join(' | '));
  console.log('before :', await order());
  await tap('#pl-reorder'); await wait(400);
  const drag = async (from, to) => {
    const g = pg.locator('#pl-list [data-grip]').nth(from); await g.scrollIntoViewIfNeeded(); const a = await g.boundingBox();
    const t = await pg.locator('#pl-list li').nth(to).boundingBox();
    const x = a.x + a.width / 2, y1 = a.y + a.height / 2, y2 = t.y + t.height / 2 + (to > from ? 6 : -6);
    await pg.mouse.move(x, y1); await pg.mouse.down(); for (let i = 1; i <= 12; i++) { await pg.mouse.move(x, y1 + (y2 - y1) * i / 12); await wait(30); }
    if (from === 1 && to === 4) await pg.screenshot({ path: 'd73.png' });
    await pg.mouse.up(); await wait(400);
  };
  await drag(1, 4); console.log('1 → 4  :', await order()); console.log('stored :', await stored());
  await drag(5, 0); console.log('5 → 0  :', await order());
  await drag(2, 2); console.log('no move:', await order());
  // arrows and remove still work, and tapping a row in edit mode still opens it
  await tap('#pl-list [data-dn="0"]'); await wait(400); console.log('↓ on 0 :', await order());
  await tap('#pl-reorder'); await wait(400); console.log('grips hidden after Done:', await pg.locator('#pl-list [data-grip]').count() === 0);
  await pg.reload(); await pg.clock.runFor(3000); console.log('reload :', await stored());
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
