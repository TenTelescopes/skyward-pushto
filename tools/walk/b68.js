const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(3000);
  const wait = (ms) => pg.waitForTimeout(ms);
  const sk = (az) => 10 + (az > 150 && az < 240 ? 25 : 0);
  const run = async (label, from, to, step) => {
    await pg.click('#l-hz'); await wait(400); await pg.evaluate(() => document.querySelector('#hz-trace').scrollIntoView()); await pg.click('#hz-trace'); await wait(2200);
    await pg.evaluate(([a, z]) => window.simGoto({ alt: a, az: z }), [sk(from), from]); await wait(1200); await pg.click('#hz-rec'); await wait(300);
    let auto = null;
    for (let az = from; az <= to; az += step) {
      await pg.evaluate(([a, z]) => window.simGoto({ alt: a, az: z % 360 }), [sk(az % 360), az]); await wait(110);
      if (!(await pg.$('#hz-live'))) { auto = az - from; break; }
    }
    if (auto == null) { await wait(1200); if (!(await pg.$('#hz-live'))) auto = to - from; }
    const s = await pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1')).horizon);
    console.log(`${label}: ${auto != null ? 'saved itself after ' + auto + '° of sweep' : 'still tracing'} | toast: ${(await pg.textContent('#toast')).slice(0, 60)} | S ${s ? s.h[36] : '-'} N ${s ? s.h[0] : '-'} | screen: ${await pg.textContent('#tab-horizon h2')}`);
    if (auto == null) { await pg.click('#hz-cancel'); await wait(300); }
    await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('skyward-pushto-v1')); delete s.horizon; localStorage.setItem('skyward-pushto-v1', JSON.stringify(s)); });
    await pg.reload(); await wait(3000);
  };
  await run('full circle from 40°', 40, 420, 3);
  await run('three quarters only', 0, 270, 3);
  await run('fast sweep that skips directions', 10, 380, 9);
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
