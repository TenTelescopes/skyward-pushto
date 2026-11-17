const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  await pg.clock.install({ time: new Date('2026-11-17T17:00:00-05:00') });
  const h = new Array(72).fill(0); for (let i = 0; i < 72; i++) { const az = (i + 0.5) * 5; if (az > 30 && az < 110) h[i] = 35; else if (az >= 250 && az < 320) h[i] = 20; }
  await pg.addInitScript((h) => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes', site: { lat: 43.55, lon: -80.25, elev: 330, source: 'entered manually' }, horizon: { h, how: 'taps', when: 1, lat: 43.55, lon: -80.25 }, launch: { check: false, sky: false, align: true, horizon: false } })); } catch (e) {} }, h);
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3000);
  const wait = (ms) => pg.clock.runFor(ms);
  const tap = (sel) => pg.evaluate((s) => document.querySelector(s).dispatchEvent(new MouseEvent('click', { bubbles: true })), sel);
  await pg.click('[data-act=plan]'); await pg.click('#l-go'); await wait(2500);
  await tap('#pl-auto'); await wait(2500);
  console.log('plan:', await pg.evaluate(() => [...document.querySelectorAll('#pl-list .t1')].map((e) => e.textContent.trim().slice(0, 14)).join(' → ')));
  await tap('#pl-prev'); await wait(600);
  const card = () => pg.evaluate(() => document.querySelector('#rt-card').innerText.replace(/\n+/g, ' | ').slice(0, 230));
  console.log('summary:', await pg.evaluate(() => document.querySelector('.rtgrid + p').textContent));
  console.log('stop 1:', await card()); await pg.screenshot({ path: 'r1.png' });
  const seen = [];
  for (let i = 0; i < 40; i++) { await wait(1200); const t = await pg.evaluate(() => document.querySelector('#rt-card .muted').textContent + ' ' + document.querySelector('#rt-card .name').textContent); if (seen[seen.length - 1] !== t) seen.push(t); if (seen.length === 6 && !seen.shot) { seen.shot = 1; await wait(1500); await pg.screenshot({ path: 'r2.png' }); } if (/Play again/.test(await pg.textContent('#rt-play'))) break; }
  console.log('auto-play visited', seen.length, 'stops:\n  ' + seen.join('\n  '));
  console.log('at the end:', await pg.textContent('#rt-play'), '|', await card()); await pg.screenshot({ path: 'r3.png' });
  await tap('#rt-prevb'); await wait(300); console.log('prev →', (await card()).slice(0, 60), '| button', await pg.textContent('#rt-play'));
  await tap('#rt-back'); await wait(600); console.log('back on plan:', await pg.evaluate(() => document.querySelector('#tab-plan').classList.contains('on')));
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
