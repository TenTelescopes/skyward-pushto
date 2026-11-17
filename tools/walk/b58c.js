const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-16T19:30:00-05:00') });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3000);
  const wait = (ms) => pg.clock.runFor(ms);
  const tabTo = async (t) => { await pg.click(`nav#tabs button[data-tab=${t}]`); await wait(700); };
  await pg.screenshot({ path: 'l58.png' });
  await pg.uncheck('[data-step=check]').catch(() => {}); await pg.click('[data-act=explore]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await wait(600);
  if (await pg.isVisible('#gate-sim')) { await pg.click('#gate-sim'); await wait(1800); }
  await pg.click('#st-pill'); await wait(800);
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name').catch(() => null); if (!name) break; await pg.evaluate((n) => window.simGoto(n), name); await wait(1700); await pg.click('#a-ok'); await wait(1000); }
  await tabTo('game'); await pg.screenshot({ path: 'g2.png', fullPage: false });
  await pg.click('#mm-go'); await wait(1200);
  const info = () => pg.evaluate(() => ({ name: document.querySelector('#tab-game .target-h .name')?.textContent, why: document.querySelector('#tab-game .target-h + div')?.textContent, score: document.querySelector('.mscore')?.textContent }));
  const seq = [];
  for (let i = 0; i < 3; i++) { const t = await info(); if (!t.name) break; const pos = await pg.evaluate((n) => window.simGoto(n), t.name); await wait(2000); seq.push(`${t.name} alt ${pos.alt.toFixed(0)} az ${pos.az.toFixed(0)} — ${t.why.split('·').pop().trim()}`); await pg.click('#mm-got'); await wait(500); }
  console.log('open sky, 19:30 order:\n  ' + seq.join('\n  ')); console.log(JSON.stringify(await info()));
  // jump 3 hours: missed objects
  await pg.clock.fastForward('03:00:00'); await wait(1500); console.log('3 h later:', JSON.stringify(await info()));
  await pg.click('#mm-end'); await wait(200); await pg.click('#mm-end'); await wait(600); await pg.screenshot({ path: 'm3.png' });
  console.log('done:', await pg.textContent('#tab-game h2'), '|', (await pg.textContent('#tab-game p')).slice(0, 120));
  await pg.click('#mm-back'); await wait(400); console.log('lobby:', await pg.textContent('#mm-go'), '|', await pg.evaluate(() => [...document.querySelectorAll('.gamecard')][0].innerText.replace(/\n+/g, ' / ').slice(0, 300)));
  // race still works
  await pg.click('#g-new'); await wait(1500); console.log('race ready:', await pg.textContent('#tab-game h2'));
  await pg.click('#g-back'); await wait(300);
  // setup renders (focuser picker), more, plan
  await tabTo('more'); await pg.click('#tab-more [data-go=setup]'); await wait(500); console.log('setup focuser picker:', await pg.evaluate(() => !!document.querySelector('.focpick') + ' ' + (document.querySelector('#s-foclab')?.textContent || '')));
  await pg.evaluate(() => document.querySelector('[data-foc="0"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await wait(200); console.log('after tap Top:', await pg.textContent('#s-foclab'));
  await pg.evaluate(() => document.querySelector('[data-foc="90"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await pg.screenshot({ path: 'setup58.png' });
  await tabTo('plan'); await wait(3000); await tabTo('find'); await wait(500); await tabTo('push'); await wait(800);
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
