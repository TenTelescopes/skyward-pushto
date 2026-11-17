const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  await pg.clock.install({ time: new Date('2026-11-16T19:30:00-05:00') });
  await pg.addInitScript(() => { try { const s = JSON.parse(localStorage.getItem('skyward-pushto-v1') || 'null'); if (!s) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3000);
  const wait = (ms) => pg.clock.runFor(ms);
  const tabTo = async (t) => { await pg.click(`nav#tabs button[data-tab=${t}]`); await wait(700); };
  await pg.uncheck('[data-step=check]').catch(() => {}); await pg.click('[data-act=explore]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await wait(600);
  if (await pg.isVisible('#gate-sim')) { await pg.click('#gate-sim'); await wait(1800); }
  console.log('gate hidden', await pg.evaluate(() => document.querySelector('#gate').classList.contains('hidden')));
  // ---- blocked sky: taps
  await tabTo('more'); console.log('more item:', await pg.textContent('#tab-more [data-go=horizon]'));
  await pg.click('#tab-more [data-go=horizon]'); await wait(400);
  for (const k of [6, 6, 6, 7, 7]) { await pg.evaluate((k) => document.querySelector(`#tab-horizon [data-wedge="${k}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), k); await wait(150); }   // W -> very tall (50), NW -> tall (30)
  await pg.screenshot({ path: 'hz1.png' });
  console.log('summary:', await pg.evaluate(() => document.querySelector('#hz-box + p').textContent));
  console.log('stored W/NW/E:', await pg.evaluate(() => { const h = JSON.parse(localStorage.getItem('skyward-pushto-v1')); return h.horizon ? [h.horizon.h[54], h.horizon.h[63], h.horizon.h[18]] : null; }));
  // ---- game lobby (not aligned)
  await tabTo('game'); await pg.screenshot({ path: 'g1.png' });
  console.log('lobby: align card', await pg.isVisible('#g-align'), 'marathon disabled', await pg.isDisabled('#mm-go'));
  await pg.click('#g-align'); await wait(800);
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name').catch(() => null); if (!name) break; await pg.evaluate((n) => window.simGoto(n), name); await wait(1700); await pg.click('#a-ok'); await wait(1000); }
  await tabTo('game'); console.log('aligned: marathon enabled', !(await pg.isDisabled('#mm-go')));
  await pg.click('#mm-go'); await wait(1200); await pg.screenshot({ path: 'm1.png' });
  const info = () => pg.evaluate(() => ({ name: document.querySelector('#tab-game .target-h .name')?.textContent, why: document.querySelector('#tab-game .target-h + div')?.textContent, score: document.querySelector('.mscore')?.textContent, st: document.querySelector('#g-status')?.textContent }));
  let i1 = await info(); console.log('first target:', JSON.stringify(i1));
  const where = (n) => pg.evaluate((n) => { const r = window.simGoto(n); return r; }, n);
  // far away -> Got it needs a second tap
  await pg.click('#mm-got'); await wait(300); console.log('far tap toast:', await pg.textContent('#toast'));
  let seq = [];
  for (let i = 0; i < 6; i++) {
    const t = await info(); if (!t.name) break; const pos = await where(t.name); await wait(2200);
    const st = (await info()).st; await pg.click('#mm-got'); await wait(600);
    seq.push(`${t.name} (alt ${pos.alt.toFixed(0)} az ${pos.az.toFixed(0)}; ${t.why.split('·').pop().trim()}; "${st}")`);
  }
  console.log('sequence:\n  ' + seq.join('\n  '));
  console.log('after 6:', JSON.stringify(await info()));
  // skip
  const before = (await info()).name; await pg.click('#mm-skip'); await wait(500); console.log('skip:', before, '->', (await info()).name);
  await pg.screenshot({ path: 'm2.png' });
  // pause & resume
  await pg.click('#mm-pause'); await wait(400); console.log('lobby after pause:', await pg.textContent('#mm-go'), '|', await pg.evaluate(() => document.querySelector('.gamecard b')?.textContent));
  await pg.reload(); await pg.clock.runFor(3000);
  console.log('after reload, saved found:', await pg.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('skyward-pushto-v1')).marathon.found).length), 'log entries', await pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1')).log.length));
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
