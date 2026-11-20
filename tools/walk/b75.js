// Build 75: phone-position picker, and pointing with the phone across the tube / on the side.
const { chromium, devices } = require('playwright');
const OUT = process.argv[2] || '.';
(async () => {
  const b = await chromium.launch(); let fail = 0; const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) fail++; };
  for (const mount of ['side-sky', 'camera']) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, timezoneId: 'America/Toronto', locale: 'en-CA' });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
    await pg.clock.install({ time: new Date('2026-11-17T21:30:00-05:00') });
    await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, site: { lat: 43.55, lon: -80.25, source: 'entered manually' } })); } catch (e) {} });
    await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3500);
    const wait = (ms) => pg.clock.runFor(ms);
    await pg.evaluate(() => { const sp = document.querySelector('#splash'); if (sp) sp.remove(); }); await wait(300);
    await pg.addStyleTag({ content: '#toast{display:none!important}' });
    await pg.evaluate(() => { const h = document.querySelector('[data-step=horizon]'); if (h && !h.classList.contains('off')) h.click(); }); await wait(200);
    await pg.click('[data-act=observe]'); await wait(200); await pg.click('#l-go'); await wait(600);
    check(await pg.isVisible('#dq-other'), mount + ': dock question offers another position');
    await pg.click('#dq-other'); await wait(300);
    check((await pg.$$('#dockq .mnt')).length === 3, mount + ': three pictures');
    await pg.click(`#dockq .mnt[data-mount=${mount}]`); await wait(300);
    check(await pg.evaluate((m) => document.querySelector(`#dockq .mnt[data-mount=${m}]`).classList.contains('on'), mount), mount + ': picture is selected');
    if (mount === 'side-sky') await pg.screenshot({ path: OUT + '/b76-picker.png' });
    await pg.click('#dq-go'); await wait(1200); await pg.evaluate(() => document.querySelector('#gate-sim').click()); await wait(1500);
    check(await pg.evaluate((m) => JSON.parse(localStorage.getItem('skyward-pushto-v1')).mounting === m, mount), mount + ': saved');
    for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name').catch(() => null); if (!name) { check(false, mount + ': alignment star shown'); break; } await pg.evaluate((k) => window.simGoto(k), name); await wait(1700); await pg.click('#a-ok'); await wait(1000); }
    await pg.click('nav#tabs button[data-tab=find]'); await wait(800);
    const key = await pg.evaluate(() => { const l = [...document.querySelectorAll('#tab-find button, #tab-find li[data-k]')].find((x) => /^M45/.test(x.innerText)); if (l) { l.click(); return l.dataset.go || l.dataset.k; } return null; });
    await wait(900); await pg.evaluate((k) => window.simGoto(k, -8, 12), key); await wait(1500);
    const off = await pg.evaluate(() => document.querySelector('#tab-push').innerText);
    check(/left/.test(off) && /up/.test(off), mount + ': 12° east and 8° low reads turn left, tilt up');
    await pg.evaluate((k) => window.simGoto(k), key); await wait(2500);
    const on = await pg.evaluate(() => document.querySelector('#tab-push').innerText);
    check(/In the eyepiece/.test(on), mount + ': on target reads "In the eyepiece"');
    
    if (mount === 'side-sky') { await pg.click('nav#tabs button[data-tab=more]'); await wait(500); await pg.click('#tab-more [data-go=setup]'); await wait(600); await pg.evaluate(() => { const d = document.querySelector('#s-mount').closest('details'); d.open = true; d.scrollIntoView(); }); await wait(300); await pg.screenshot({ path: OUT + '/b75-setup.png' }); check((await pg.$$('#s-mount .mnt')).length === 3, 'setup shows the picker'); }
    await ctx.close();
  }
  await b.close(); console.log(fail ? `${fail} FAILED` : 'b75 walk passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
