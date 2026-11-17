const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-16T21:00:00-05:00') });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3000);
  const wait = (ms) => pg.clock.runFor(ms);
  const tabTo = async (t) => { await pg.click(`nav#tabs button[data-tab=${t}]`); await wait(700); };
  await pg.uncheck('[data-step=check]').catch(() => {}); await pg.click('[data-act=explore]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await wait(600);
  if (await pg.isVisible('#gate-sim')) { await pg.click('#gate-sim'); await wait(1800); }
  await pg.click('#st-pill'); await wait(800);
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name').catch(() => null); if (!name) break; await pg.evaluate((n) => window.simGoto(n), name); await wait(1700); await pg.click('#a-ok'); await wait(1000); }
  await tabTo('find'); await pg.fill('#q', 'M45'); await wait(700); await pg.click('#flist li[data-k]'); await wait(1200);
  const deltas = () => pg.evaluate(() => [...document.querySelectorAll('#tab-push .guide .delta .val')].map((e) => e.textContent).join(' , '));
  const toast = async () => (await pg.textContent('#toast')).slice(0, 150);
  const t = await pg.evaluate(() => window.simGoto('M45')); await wait(2000); console.log('on M45:', await deltas());
  // (a) stray tap while pointing 20° lower
  await pg.evaluate(([a, z]) => window.simGoto({ alt: a - 20, az: z }), [t.alt, t.az]); await wait(2000);
  await pg.click('#b-sync'); await wait(300); console.log('(a) wrong height →', await toast());
  await pg.evaluate(() => window.simGoto('M45')); await wait(2000); console.log('    pointing unchanged:', await deltas());
  // (b) same height, 35° round to the side
  await pg.evaluate(([a, z]) => window.simGoto({ alt: a, az: z + 35 }), [t.alt, t.az]); await wait(2000);
  await pg.click('#b-sync'); await wait(300); console.log('(b) first tap →', await toast());
  await wait(9000); await pg.evaluate(() => window.simGoto('M45')); await wait(2000); console.log('    ignored it, pointing unchanged:', await deltas());
  await pg.evaluate(([a, z]) => window.simGoto({ alt: a, az: z + 35 }), [t.alt, t.az]); await wait(2000);
  await pg.click('#b-sync'); await wait(300); await pg.click('#b-sync'); await wait(400); console.log('    two taps →', await toast());
  await pg.evaluate(() => window.simGoto('M45')); await wait(2000); console.log('    pointing now skewed:', await deltas());
  // undo
  await pg.click('#st-pill'); await wait(800); console.log('undo button:', await pg.textContent('#unsync'));
  await pg.click('#unsync'); await wait(400); console.log('    →', await toast(), '| button now:', await pg.textContent('#unsync'), 'disabled', await pg.isDisabled('#unsync'));
  await tabTo('push'); await wait(1500); console.log('    after undo, on M45:', await deltas());
  // (c) a normal small sync still goes straight through
  await pg.evaluate(([a, z]) => window.simGoto({ alt: a + 0.3, az: z + 0.5 }), [t.alt, t.az]); await wait(2000);
  await pg.click('#b-sync'); await wait(300); console.log('(c) small correction →', await toast());
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
