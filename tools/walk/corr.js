// End-to-end check of sky correction in the simulator: a bent sensor response, align, sync around the sky, then measure.
const { chromium, devices } = require('playwright');
const BEND = +(process.env.BEND || 3);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-14T21:30:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(1200);
  await pg.uncheck('[data-step=check]'); await pg.click('[data-act=observe]'); await pg.click('#l-go'); await pg.waitForTimeout(400); await pg.click('#gate-sim'); await pg.waitForTimeout(2000);
  await pg.evaluate((v) => { window.sim.bend = v; window.sim.noise = 0.01; }, BEND);
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name'); await pg.evaluate((n) => window.simGoto(n), name); await pg.waitForTimeout(1800); await pg.click('#a-ok'); await pg.waitForTimeout(900); }
  const target = async (label) => { await pg.click('nav#tabs button[data-tab=find]'); await pg.waitForTimeout(250); await pg.fill('#q', label); await pg.waitForTimeout(350); await pg.click('#flist li[data-k]'); await pg.waitForTimeout(500); };
  const errAt = async (label) => {
    await target(label); await pg.evaluate((n) => window.simGoto(n), label); await pg.waitForTimeout(1900);
    const t = await pg.evaluate(() => [...document.querySelectorAll('#pinfo span')].map((x) => x.textContent));
    const num = (s) => s.split('/').map((x) => parseFloat(x)); const [ta, tz] = num(t[1]), [sa, sz] = num(t[3]);
    const d2r = Math.PI / 180, sep = Math.acos(Math.min(1, Math.sin(ta * d2r) * Math.sin(sa * d2r) + Math.cos(ta * d2r) * Math.cos(sa * d2r) * Math.cos((tz - sz) * d2r))) / d2r;
    return { label, alt: ta, err: sep * 60, corr: t[7] };
  };
  const tests = ['M31', 'M45', 'M57', 'M15', 'M33', 'M34', 'M52', 'M39', 'M2', 'M103'];
  const mean = (a) => a.reduce((s, x) => s + x.err, 0) / a.length;
  const base = []; for (const l of tests) base.push(await errAt(l));
  console.log(`bend ${BEND}°. After a 2-star alignment only:   mean error ${mean(base).toFixed(0)}′  (worst ${Math.max(...base.map((x) => x.err)).toFixed(0)}′)`);
  for (const l of ['Deneb', 'Altair', 'Polaris', 'Aldebaran', 'Alpheratz', 'Hamal', 'Mirfak', 'Enif']) { await target(l); await pg.evaluate((n) => window.simGoto(n), l); await pg.waitForTimeout(1900); await pg.click('#b-sync'); await pg.waitForTimeout(500); }
  const on = []; for (const l of tests) on.push(await errAt(l));
  await pg.click('#st-pill'); await pg.waitForTimeout(700);
  console.log('dome card:', (await pg.textContent('#dome-info p')).slice(0, 170));
  await pg.screenshot({ path: process.argv[2] || '/dev/null' }).catch(() => {});
  await pg.evaluate(() => { document.querySelector('#dome-corr').click(); }); await pg.waitForTimeout(500);
  const off = []; for (const l of tests) off.push(await errAt(l));
  console.log(`After 8 more syncs, correction OFF: mean error ${mean(off).toFixed(0)}′  (worst ${Math.max(...off.map((x) => x.err)).toFixed(0)}′)`);
  console.log(`After 8 more syncs, correction ON:  mean error ${mean(on).toFixed(0)}′  (worst ${Math.max(...on.map((x) => x.err)).toFixed(0)}′)`);
  console.log(on.map((x, i) => `${x.label}@${x.alt.toFixed(0)}°: ${off[i].err.toFixed(0)}′→${x.err.toFixed(0)}′`).join('  '));
  console.log('errors:', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 5).join('\n')); process.exit(1); });
