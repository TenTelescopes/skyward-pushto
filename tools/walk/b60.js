const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-16T19:30:00-05:00') });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3000);
  const wait = (ms) => pg.clock.runFor(ms);
  const tabTo = async (t) => { await pg.click(`nav#tabs button[data-tab=${t}]`); await wait(700); };
  await pg.uncheck('[data-step=check]').catch(() => {}); await pg.click('[data-act=explore]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await wait(600);
  if (await pg.isVisible('#gate-sim')) { await pg.click('#gate-sim'); await wait(1800); }
  await pg.click('#st-pill'); await wait(800);
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name').catch(() => null); if (!name) break; await pg.evaluate((n) => window.simGoto(n), name); await wait(1700); await pg.click('#a-ok'); await wait(1000); }
  await tabTo('game'); console.log('toggle default on:', await pg.isChecked('#mm-sync'));
  await pg.click('#mm-go'); await wait(1200);
  const info = () => pg.evaluate(() => ({ name: document.querySelector('#tab-game .target-h .name')?.textContent, bar: document.querySelector('#tab-game .planbar')?.textContent || '', score: document.querySelector('.mscore')?.textContent, st: document.querySelector('#g-status')?.textContent, sync: !!document.querySelector('#mm-dosync') }));
  const log = [];
  for (let i = 0; i < 16; i++) {
    const t = await info(); if (!t.name) break;
    const nm = t.name.replace('★ ', ''); await pg.evaluate((n) => window.simGoto(n), nm); await wait(2000);
    if (i === 0) await pg.screenshot({ path: 's60.png' });
    const st = (await info()).st;
    if (t.sync) { await pg.click('#mm-dosync'); await wait(500); log.push(`SYNC ${t.name} — ${t.bar.slice(0, 70)} ["${st}"] toast: ${(await pg.textContent('#toast')).slice(0, 50)}`); }
    else { await pg.click('#mm-got'); await wait(500); log.push(`found ${t.name}`); }
  }
  console.log(log.join('\n')); console.log(JSON.stringify(await info()));
  // skip the star, then switch the feature off mid-game
  let t = await info(); let guard = 0;
  while (!t.sync && guard++ < 30) { await pg.evaluate((n) => window.simGoto(n), t.name); await wait(1800); await pg.click('#mm-got'); await wait(500); t = await info(); }
  console.log('next sync offer:', t.name, '|', t.bar.slice(0, 60));
  if (t.sync) { await pg.click('#mm-nosync'); await wait(400); const u = await info(); console.log('skipped star ->', u.name, 'sync step', u.sync); }
  await pg.click('#mm-synct'); await wait(400); console.log('toggle text:', await pg.textContent('#mm-synct'), '| stored', await pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1')).marSync));
  let offers = 0; for (let i = 0; i < 12; i++) { const v = await info(); if (!v.name) break; if (v.sync) offers++; await pg.evaluate((n) => window.simGoto(n), v.name.replace('★ ', '')); await wait(1800); await pg.click(v.sync ? '#mm-dosync' : '#mm-got'); await wait(400); }
  console.log('sync offers with the feature off:', offers, '|', (await info()).score);
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
