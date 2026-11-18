// Build 79: frames are lined up on their stars before stacking. Needs a fake camera video of a star field that WANDERS
// by several pixels from frame to frame:  node b79.js <shaky.y4m>   (docs/ served on :8765; run as CommonJS)
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + process.argv[2]] });
  const got = {};
  for (const q of ['', '&noalign']) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, timezoneId: 'America/Toronto', permissions: ['camera'] });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => console.log('ERR', e.message));
    await pg.clock.setFixedTime(new Date('2026-11-18T01:00:00-05:00'));
    await pg.addInitScript(() => { try { localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'no', mounting: 'top-sky', site: { lat: 43.55, lon: -80.25, source: 'entered manually' } })); } catch (e) {} });
    await pg.goto('http://localhost:8765/?sim' + q); await pg.waitForTimeout(3600);
    await pg.evaluate(() => { const sp = document.querySelector('#splash'); if (sp) sp.remove(); document.querySelector('#gate').classList.add('hidden'); });
    await pg.click('nav#tabs button[data-tab=more]'); await pg.waitForTimeout(300); await pg.click('#tab-more [data-go=camera]'); await pg.waitForTimeout(300);
    await pg.click('#cam-start'); await pg.waitForSelector('#cam-go', { timeout: 15000 }); await pg.waitForTimeout(1500);
    await pg.click('#cam-go'); await pg.waitForSelector('#cam-pic', { timeout: 90000 }); await pg.waitForTimeout(300);
    const rep = await pg.evaluate(() => document.querySelector('pre.camrep').textContent);
    console.log(q ? '--- frames added as they came' : '--- frames lined up'); console.log(rep.split('\n').filter((l) => /SOLVED|Matched|Light|Lining|Stars:/.test(l)).join('\n'));
    got[q || 'on'] = +(/Stars: (\d+) clear/.exec(rep) || [0, 0])[1];
    await ctx.close();
  }
  const ok = got.on >= got['&noalign'] + 8; console.log(ok ? 'ok   lined-up stack shows many more stars' : 'FAIL lining up did not help', JSON.stringify(got));
  await b.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
