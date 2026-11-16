// End-to-end: heading jumps. One the app knows about (it was in the background), one it doesn't (a knock).
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-14T21:30:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(1200);
  await pg.uncheck('[data-step=check]'); await pg.click('[data-act=observe]'); await pg.click('#l-go'); await pg.waitForTimeout(400); await pg.click('#gate-sim'); await pg.waitForTimeout(2000);
  await pg.evaluate(() => { window.sim.bend = 3; window.sim.noise = 0.01; window.__jump = 0; const f = window.sim._onRel.bind(window.sim); window.sim._onRel = (e) => f({ ...e, alpha: (e.alpha + window.__jump + 720) % 360 }); });
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name'); await pg.evaluate((n) => window.simGoto(n), name); await pg.waitForTimeout(1800); await pg.click('#a-ok'); await pg.waitForTimeout(900); }
  const target = async (label) => { await pg.click('nav#tabs button[data-tab=find]'); await pg.waitForTimeout(250); await pg.fill('#q', label); await pg.waitForTimeout(350); await pg.click('#flist li[data-k]'); await pg.waitForTimeout(500); };
  const errAt = async (label) => {
    await target(label); await pg.evaluate((n) => window.simGoto(n), label); await pg.waitForTimeout(1900);
    const t = await pg.evaluate(() => [...document.querySelectorAll('#pinfo span')].map((x) => x.textContent));
    const num = (s) => s.split('/').map((x) => parseFloat(x)); const [ta, tz] = num(t[1]), [sa, sz] = num(t[3]);
    const d2r = Math.PI / 180, sep = Math.acos(Math.min(1, Math.sin(ta * d2r) * Math.sin(sa * d2r) + Math.cos(ta * d2r) * Math.cos(sa * d2r) * Math.cos((tz - sz) * d2r))) / d2r;
    return { label, alt: ta, err: sep * 60, corr: t[7] };
  };
  const sync = async (l) => { await target(l); await pg.evaluate((n) => window.simGoto(n), l); await pg.waitForTimeout(1900); await pg.click('#b-sync'); await pg.waitForTimeout(600); return (await pg.textContent('#toast')).trim(); };
  const card = async () => { await pg.click('nav#tabs button[data-tab=more]'); await pg.waitForTimeout(300); await pg.evaluate(() => document.querySelector('#st-pill').click()); await pg.waitForTimeout(700);
    return pg.evaluate(() => ({ pill: document.querySelector('#st-pill').textContent.trim(), corr: document.querySelector('#dome-info p').textContent, verdict: document.querySelectorAll('#dome-info p')[1].textContent, kv: [...document.querySelectorAll('#dome-info .kv span')].map((x) => x.textContent).join(' | ') })); };
  const tests = ['M33', 'M34', 'M52', 'M103', 'M39', 'M45'];
  const mean = (a) => a.reduce((s, x) => s + x.err, 0) / a.length, show = (a) => `${mean(a).toFixed(0)}′ (${a.map((x) => x.label + ' ' + x.err.toFixed(0) + '′').join(', ')})`;
  const measure = async () => { const a = []; for (const l of tests) a.push(await errAt(l)); return a; };
  for (const l of ['Deneb', 'Altair', 'Polaris', 'Aldebaran', 'Alpheratz', 'Hamal']) await sync(l);
  console.log('1. after 2 alignment stars + 6 syncs\n  ', JSON.stringify(await card()));
  console.log('   error at fresh targets:', show(await measure()));

  // ---- the app goes to the background for 30 s and the gyro heading comes back 20° off
  await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.clock.fastForward(30000);
  await pg.evaluate(() => { window.__jump = 20; Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.waitForTimeout(800);
  console.log('2. back from 30 s in the background, heading now 20° off. Pill:', (await pg.textContent('#st-pill')).trim());
  console.log('   before re-sync, error:', show(await measure()));
  console.log('   sync:', await sync('Mirfak'));
  console.log('  ', JSON.stringify(await card()));
  console.log('   after ONE re-sync, error:', show(await measure()));

  // ---- a knock nobody saw: heading jumps another 5°, user carries on syncing
  await pg.evaluate(() => { window.__jump = 25; });
  console.log('3. unflagged 5° jump. sync:', await sync('Enif'));
  console.log('   after one sync, error:', show(await measure()));
  for (const l of ['Capella', 'Vega']) console.log('   sync:', await sync(l));
  console.log('  ', JSON.stringify(await card()));
  console.log('   after three syncs, error:', show(await measure()));
  await pg.evaluate(() => document.querySelector('#dome-corr').click()); await pg.waitForTimeout(400);
  console.log('   same with correction OFF:', show(await measure()));
  console.log('errors:', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
