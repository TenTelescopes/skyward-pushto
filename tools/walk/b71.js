const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-17T19:30:00-05:00') });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3000);
  const wait = (ms) => pg.clock.runFor(ms);
  const sk = (az) => 8 + (az > 150 && az < 240 ? 27 : 0);
  const sweep = async (from) => { for (let az = from; az <= from + 372; az += 3) { await pg.evaluate(([a, z]) => window.simGoto({ alt: a, az: z % 360 }), [sk(az % 360), az]); await wait(110); if (!(await pg.$('#hz-live'))) return az - from; } await wait(1200); return (await pg.$('#hz-live')) ? null : 372; };
  await pg.click('#l-hz'); await wait(400);
  console.log('before:', await pg.evaluate(() => [...document.querySelectorAll('#tab-horizon h3')].map((h) => h.textContent).join(' | ')), '| ring shown:', !!(await pg.$('.hzring')), '| tappable wedges:', await pg.evaluate(() => document.querySelectorAll('[data-wedge]').length));
  await pg.screenshot({ path: 'h71a.png' });
  await pg.evaluate(() => document.querySelector('#hz-trace').click()); await wait(2600);
  console.log('trace screen: mode toggle shown (not aligned):', !!(await pg.$('#hz-mode')), '| button:', await pg.textContent('#hz-rec')); await pg.screenshot({ path: 'h71b.png' });
  await pg.evaluate(([a, z]) => window.simGoto({ alt: a, az: z }), [sk(20), 20]); await wait(800);
  await pg.click('#hz-rec'); await wait(400); console.log('countdown:', await pg.textContent('#hz-live'), '|', await pg.textContent('#tab-horizon .actionbar'));
  await wait(1500); console.log('          ', await pg.textContent('#hz-live')); await wait(1600); console.log('recording:', await pg.textContent('#hz-live'));
  console.log('auto-saved after', await sweep(20), '° | toast:', (await pg.textContent('#toast')).slice(0, 40));
  let s = await pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1')).horizon); console.log('saved: by', s.by, '| S', s.h[38], 'N', s.h[1], 'E', s.h[18]);
  console.log('after:', await pg.evaluate(() => [...document.querySelectorAll('#tab-horizon h3')].map((h) => h.textContent).join(' | ')), '|', await pg.evaluate(() => document.querySelector('#hz-box + p').textContent));
  await pg.evaluate(() => document.querySelector('#tab-horizon h3').scrollIntoView()); await pg.screenshot({ path: 'h71c.png' });
  // aligned: telescope mode offered
  await pg.click('#st-pill'); await wait(800);
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name').catch(() => null); if (!name) break; await pg.evaluate((n) => window.simGoto(n), name); await wait(1700); await pg.click('#a-ok'); await wait(1000); }
  await pg.click('nav#tabs button[data-tab=more]'); await wait(400); await pg.click('#tab-more [data-go=horizon]'); await wait(300);
  await pg.evaluate(() => document.querySelector('#hz-trace').click()); await wait(600);
  console.log('aligned: toggle shown:', !!(await pg.$('#hz-mode')), '| default:', await pg.evaluate(() => document.querySelector('#hz-mode .on').textContent));
  await pg.click('[data-mode=scope]'); await wait(300); await pg.evaluate(([a, z]) => window.simGoto({ alt: a, az: z }), [sk(100), 100]); await wait(800); await pg.click('#hz-rec'); await wait(400);
  console.log('scope mode auto-saved after', await sweep(100), '°'); s = await pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1')).horizon); console.log('saved: by', s.by, 'rough', s.rough, '| S', s.h[38], 'N', s.h[1], '|', await pg.evaluate(() => document.querySelector('#hz-box + p').textContent));
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
