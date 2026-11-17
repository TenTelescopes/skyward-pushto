const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  const wait = (ms) => pg.waitForTimeout(ms);
  const vis = (s) => pg.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden'); }, s);
  const sens = () => pg.evaluate(() => !!window.sim);
  // 1. From the start screen, sensors never started (sim URL so the desktop has "sensors")
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await wait(3000);
  await pg.screenshot({ path: 'l59.png' });
  console.log('start link:', (await pg.innerText('#l-hz')).replace(/\n/g, ' / '));
  await pg.click('#l-hz'); await wait(400);
  console.log('opened from start: gate hidden', !(await vis('#gate')), '| back label:', await pg.textContent('#hz-back'), '| sensors running', await sens());
  await pg.evaluate(() => document.querySelector('#hz-trace').scrollIntoView()); await pg.click('#hz-trace'); await wait(2500);
  console.log('after Trace: sensors running', await sens(), '| screen:', await pg.textContent('#tab-horizon h2'), '| rough note:', !!(await pg.$('#tab-horizon .muted b')), '| live:', await pg.textContent('#hz-live'));
  await pg.screenshot({ path: 't59.png' }); await pg.evaluate(() => window.simGoto({ alt: 12, az: 0 })); await wait(1500); await pg.click('#hz-rec'); await wait(300);
  for (let az = 0; az < 360; az += 6) { await pg.evaluate(([a, z]) => window.simGoto({ alt: a, az: z }), [12 + (az > 150 && az < 240 ? 25 : 0), az]); await wait(130); }
  console.log('live:', await pg.textContent('#hz-live'));
  await pg.click('#hz-done'); await wait(500);
  console.log('saved:', await pg.evaluate(() => { const h = JSON.parse(localStorage.getItem('skyward-pushto-v1')).horizon; return [h.how, 'rough ' + h.rough, 'S ' + h.h[36], 'N ' + h.h[0]].join(', '); }));
  await pg.click('#hz-back'); await wait(400); console.log('back -> start screen visible', await vis('#gate'), '|', (await pg.innerText('#l-hz')).replace(/\n/g, ' / '));
  // 2. From Plan
  await pg.click('[data-act=plan]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await wait(2500);
  console.log('plan row:', (await pg.innerText('.hzrow')).replace(/\n/g, ' / ')); await pg.screenshot({ path: 'p59.png' });
  await pg.click('#pl-hz'); await wait(400); console.log('from plan, back label:', await pg.textContent('#hz-back'));
  await pg.click('#hz-back'); await wait(1500); console.log('back on plan:', await pg.evaluate(() => document.querySelector('#tab-plan').classList.contains('on')));
  // 3. From Push (sky view, then with a target)
  await pg.click('nav#tabs button[data-tab=push]'); await wait(1000);
  console.log('push sky view button:', await pg.textContent('#p-hz')); await pg.click('#p-hz'); await wait(300); console.log('from push, back label:', await pg.textContent('#hz-back')); await pg.click('#hz-back'); await wait(600);
  await pg.click('nav#tabs button[data-tab=find]'); await wait(500); await pg.fill('#q', 'M31'); await wait(600); await pg.click('#flist li[data-k]'); await wait(1200);
  console.log('push with target has button:', await pg.evaluate(() => !!document.querySelector('#tab-push #p-hz')));
  await pg.evaluate(() => document.querySelector('#p-hz').click()); await wait(300); console.log('opened:', await pg.textContent('#tab-horizon h2'));
  // 4. More still works
  await pg.click('nav#tabs button[data-tab=more]'); await wait(400); await pg.click('#tab-more [data-go=horizon]'); await wait(300); console.log('from more, back label:', await pg.textContent('#hz-back'));
  console.log('errors', errs); await b.close();
  // 5. No sim: a desktop with no sensors -> clear explanation, not a dead button
  const b2 = await chromium.launch(); const c2 = await b2.newContext({ ...devices['iPhone 13'] }); const p2 = await c2.newPage(); const e2 = []; p2.on('pageerror', (e) => e2.push(e.message));
  await p2.addInitScript(() => { try { localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  await p2.goto('http://localhost:8765/?x=' + Date.now()); await p2.waitForTimeout(3000); await p2.click('#l-hz'); await p2.waitForTimeout(300);
  await p2.evaluate(() => document.querySelector('#hz-trace').scrollIntoView()); await p2.click('#hz-trace'); await p2.waitForTimeout(4500);
  console.log('no sensors: gate shown', await p2.evaluate(() => !document.querySelector('#gate').classList.contains('hidden')), '| msg:', (await p2.innerText('#gate-msg')).slice(0, 110), '| errors', e2);
  await b2.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
