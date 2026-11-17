const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
  await pg.clock.install({ time: new Date('2026-11-16T19:30:00-05:00') });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3000);
  const wait = (ms) => pg.clock.runFor(ms);
  const tabTo = async (t) => { await pg.click(`nav#tabs button[data-tab=${t}]`); await wait(700); };
  await pg.uncheck('[data-step=check]').catch(() => {}); await pg.click('[data-act=explore]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await wait(600);
  if (await pg.isVisible('#gate-sim')) { await pg.click('#gate-sim'); await wait(1800); }
  // trace before alignment -> rough (sim has a compass?)
  await tabTo('more'); await pg.click('#tab-more [data-go=horizon]'); await wait(300);
  await pg.click('#hz-trace'); await wait(500);
  console.log('unaligned trace:', await pg.evaluate(() => document.querySelector('#tab-horizon h2').textContent + ' | ' + (document.querySelector('#tab-horizon .muted b')?.textContent || 'no rough note')), '| toast:', await pg.textContent('#toast'));
  if (await pg.isVisible('#hz-cancel')) await pg.click('#hz-cancel');
  // align, then trace with the scope
  await pg.click('#st-pill'); await wait(800);
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name').catch(() => null); if (!name) break; await pg.evaluate((n) => window.simGoto(n), name); await wait(1700); await pg.click('#a-ok'); await wait(1000); }
  await tabTo('more'); await pg.click('#tab-more [data-go=horizon]'); await wait(300); await pg.click('#hz-trace'); await wait(400); await pg.click('#hz-rec'); await wait(200);
  const sk = (az) => 8 + 30 * Math.max(0, Math.cos((az - 270) * Math.PI / 180)) ** 2;     // tall trees to the west
  for (let az = 0; az < 360; az += 4) { await pg.evaluate(([a, z]) => window.simGoto({ alt: a, az: z }), [sk(az), az]); await wait(260); if (az === 200) await pg.screenshot({ path: 'hz2.png' }); }
  console.log('live:', await pg.textContent('#hz-live'));
  await pg.click('#hz-done'); await wait(500); await pg.screenshot({ path: 'hz3.png' });
  const got = await pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1')).horizon);
  const errsSky = [0, 90, 180, 270, 315].map((az) => `${az}: ${got.h[Math.floor(az / 5)]} (true ${sk(az + 2.5).toFixed(1)})`);
  console.log('traced:', got.how, 'rough', got.rough, errsSky.join(' | '));
  console.log('summary:', await pg.evaluate(() => document.querySelector('#hz-box + p').textContent));
  // chart shading: look west on Push with a target low in the west
  await tabTo('find'); await pg.fill('#q', 'M11'); await wait(600); 
  console.log('find row M11:', (await pg.evaluate(() => document.querySelector('#flist li[data-k]')?.innerText || '')).replace(/\n/g, ' / ').slice(0, 160));
  await pg.click('#flist li[data-k]'); await wait(1500);
  await pg.evaluate(() => window.simGoto({ alt: 25, az: 262 })); await wait(3000); await pg.screenshot({ path: 'hz4.png' });
  console.log('push rate line:', (await pg.evaluate(() => document.querySelector('#tab-push')?.innerText || '')).split('\n').filter((l) => /Not now|behind|Behind|Visible|Obvious/.test(l)).slice(0, 3).join(' / '));
  // plan suggestions exclude blocked
  await tabTo('plan'); await wait(3000);
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
