// Walk every screen of the redesigned app at iPhone size. Usage: node walk2.js <outdir> [day] [standalone]
const { chromium, devices } = require('playwright');
const out = process.argv[2], DAY = process.argv.includes('day'), TALL = process.argv.includes('tall');
const shot = async (pg, name) => { await pg.waitForTimeout(400); await pg.screenshot({ path: `${out}/${name}.png` }); };
const scrollMain = (pg, y) => pg.evaluate((yy) => { document.querySelector('main').scrollTop = yy; }, y);
const tabTo = async (pg, t, wait = 700) => { await pg.click(`nav#tabs button[data-tab=${t}]`); await pg.waitForTimeout(wait); };
(async () => {
  const b = await chromium.launch();
  const dev = { ...devices['iPhone 13'] }; if (TALL) dev.viewport = { width: 390, height: 780 };
  const ctx = await b.newContext({ ...dev, timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.clock.install({ time: new Date(process.env.WHEN || '2026-11-14T21:30:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(1200);
  if (DAY) await pg.evaluate(() => document.querySelector('#hb-day').click());
  await shot(pg, '01-launch');
  // untick the phone check so the flow is: align -> observe
  await pg.uncheck('[data-step=check]'); await pg.waitForTimeout(200);
  await pg.click('[data-act=explore]'); await pg.click('#l-go'); await pg.waitForTimeout(600);
  await pg.click('#gate-sim'); await pg.waitForTimeout(1800);
  await shot(pg, '02-skyview');
  await tabTo(pg, 'find'); await shot(pg, '10-find'); await scrollMain(pg, 520); await shot(pg, '11-find-list'); await scrollMain(pg, 0);
  await tabTo(pg, 'plan', 2500); await shot(pg, '20-plan-empty'); await scrollMain(pg, 430); await shot(pg, '21-plan-sugg');
  await pg.click('#pl-sugg [data-info]'); await pg.waitForTimeout(500); await shot(pg, '22-sheet'); await pg.click('#sh-x');
  await scrollMain(pg, 0); await pg.click('#pl-auto'); await pg.waitForTimeout(2500); await shot(pg, '23-plan-built'); await scrollMain(pg, 520); await shot(pg, '24-plan-built2'); await scrollMain(pg, 0);
  await pg.click('#pl-edit'); await pg.waitForTimeout(400); await shot(pg, '25-plan-edit'); await pg.click('#pl-edit');
  await tabTo(pg, 'game'); await shot(pg, '30-game');
  await tabTo(pg, 'more'); await shot(pg, '40-more'); await scrollMain(pg, 400); await shot(pg, '41-more2'); await scrollMain(pg, 0);
  await pg.click('#tab-more [data-go=log]'); await pg.waitForTimeout(500); await shot(pg, '42-log-empty');
  await pg.click('#tab-log [data-back]'); await pg.waitForTimeout(300);
  await pg.click('#tab-more [data-go=setup]'); await pg.waitForTimeout(500); await shot(pg, '43-setup');
  await pg.click('#tab-setup [data-back]'); await pg.waitForTimeout(300);
  await pg.click('#tab-more [data-go=test]'); await pg.waitForTimeout(500); await shot(pg, '44-tests');
  // target, unaligned
  await tabTo(pg, 'find'); await pg.fill('#q', 'M31'); await pg.waitForTimeout(500); await pg.click('#flist li[data-k]'); await pg.waitForTimeout(1500);
  await shot(pg, '50-push-unaligned');
  // align via the status pill
  await pg.click('#st-pill'); await pg.waitForTimeout(800); await shot(pg, '60-align');
  for (let i = 0; i < 2; i++) {
    const name = await pg.textContent('#tab-align .target-h .name').catch(() => null); if (!name) break;
    await pg.evaluate((n) => window.simGoto(n), name); await pg.waitForTimeout(1700);
    if (i === 0) await shot(pg, '61-align-onstar');
    await pg.click('#a-ok'); await pg.waitForTimeout(1000);
  }
  await shot(pg, '70-push-aligned-far');
  await pg.evaluate(() => window.simGoto('M31', 1.2, 2.5)); await pg.waitForTimeout(2600); await shot(pg, '71-push-near');
  await pg.evaluate(() => window.simGoto('M31')); await pg.waitForTimeout(2600); await shot(pg, '72-push-ontarget');
  const h = await pg.evaluate(() => document.querySelector('main').scrollHeight); console.log('push height', h);
  await scrollMain(pg, 480); await shot(pg, '73-push-eyepiece'); await scrollMain(pg, 1100); await shot(pg, '74-push-bottom'); await scrollMain(pg, 0);
  await pg.click('#pstat [data-seen=yes]'); await pg.waitForTimeout(900); await shot(pg, '75-push-logged');
  await pg.click('#b-log'); await pg.waitForTimeout(300); await shot(pg, '76-push-logchooser'); await pg.click('#b-logx');
  // plan: start observing
  await tabTo(pg, 'plan', 2000); await pg.click('#pl-go'); await pg.waitForTimeout(1500); await shot(pg, '80-plan-push');
  await tabTo(pg, 'more'); await pg.click('#tab-more [data-go=log]'); await pg.waitForTimeout(500); await shot(pg, '81-log');
  await pg.click('#tab-log [data-back]'); await pg.click('#tab-more [data-go=align]'); await pg.waitForTimeout(600); await shot(pg, '82-align-done');
  await tabTo(pg, 'game'); await pg.click('#g-new'); await pg.waitForTimeout(900); await shot(pg, '83-game-ready');
  await pg.evaluate(() => { document.querySelector('main').scrollTop = 9999; }); await pg.click('#g-start'); await pg.waitForTimeout(4200); await shot(pg, '84-game-play');
  await tabTo(pg, 'find'); await pg.fill('#q', ''); await pg.waitForTimeout(400); await shot(pg, '85-find-aligned');
  console.log('errors:', errs.slice(0, 10)); await b.close();
})().catch((e) => { console.error('WALK FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
