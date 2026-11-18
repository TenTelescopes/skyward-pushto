// Build 78: camera star finder inside the app. Needs a fake camera video of a known star field:
//   node b78.js <out-dir> <sky.y4m>      (the .y4m is a rendering of Orion, RA 83.8° Dec -1.2°, with a foreground)
// Run as CommonJS with the docs/ folder served on :8765.
const { chromium, devices } = require('playwright');
const OUT = process.argv[2] || '.', VIDEO = process.argv[3];
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + VIDEO] });
  let fail = 0; const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) fail++; };
  const open = async (seed) => {
    const ctx = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, timezoneId: 'America/Toronto', locale: 'en-CA', permissions: ['camera'] });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
    await pg.clock.setFixedTime(new Date('2026-11-18T01:00:00-05:00'));                // Orion is high in the south
    await pg.addInitScript((sd) => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify(sd)); } catch (e) {} }, seed);
    await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(3600);
    await pg.evaluate(() => { const sp = document.querySelector('#splash'); if (sp) sp.remove(); });
    await pg.addStyleTag({ content: '#toast{opacity:0!important}' });
    await pg.evaluate(() => { const h = document.querySelector('[data-step=horizon]'); if (h && !h.classList.contains('off')) h.click(); });
    await pg.click('[data-act=observe]'); await pg.click('#l-go'); await pg.waitForTimeout(500);
    await pg.evaluate(() => document.querySelector('#gate-sim').click()); await pg.waitForTimeout(1200);
    return { ctx, pg };
  };
  const fix = async (pg) => { await pg.evaluate(() => { const c = document.querySelector('#cam-pic'); if (c) c.remove(); }); await pg.click('#cam-go'); await pg.waitForSelector('#cam-pic', { timeout: 60000 }); await pg.waitForTimeout(300); return pg.evaluate(() => document.querySelector('#tab-camera .card:last-of-type').innerText); };
  const where = (t) => { const m = /Telescope: ([\d.]+)° up, \w+ \(([\d.]+)°\)/.exec(t); return m ? { alt: +m[1], az: +m[2] } : null; };
  const base = { v: 1, dock: 'no', site: { lat: 43.55, lon: -80.25, source: 'entered manually' } };

  { // 1. phone in the dock: the screen explains, offers the switch, and still recognises the sky
    const { ctx, pg } = await open({ ...base, mounting: 'top-sky' });
    await pg.evaluate(() => document.querySelector('#gate').classList.add('hidden'));
    await pg.click('nav#tabs button[data-tab=more]'); await pg.waitForTimeout(300);
    await pg.click('#tab-more [data-go=camera]'); await pg.waitForTimeout(300);
    check(await pg.isVisible('#cam-along'), 'docked phone: told the camera must look along the tube');
    await pg.click('#cam-start'); await pg.waitForSelector('#cam-go', { timeout: 15000 }); await pg.waitForTimeout(1500);
    const t = await fix(pg); check(/Found it: on Alnilam/.test(t), 'recognises the field: ' + t.split('\n')[0]); check(/Not used for pointing/.test(t), 'docked phone: fix is not used for pointing');
    await pg.click('nav#tabs button[data-tab=find]'); await pg.waitForTimeout(500);
    check(await pg.evaluate(() => { const v = document.querySelector('#cam-v'); return !v || !v.srcObject; }), 'camera closed on leaving the screen');
    await ctx.close();
  }
  let truth = null;
  { // 2. looking along, not aligned: the alignment screen offers the camera; first fix accepted, same spot refused as second
    const { ctx, pg } = await open({ ...base, mounting: 'camera' });      // default: two fixes needed
    check(await pg.isVisible('#a-cam'), 'alignment screen offers "Align with the camera"');
    await pg.click('#a-cam'); await pg.waitForTimeout(300);
    await pg.click('#cam-start'); await pg.waitForSelector('#cam-go', { timeout: 15000 }); await pg.waitForTimeout(1500);
    await pg.screenshot({ path: OUT + '/b78-live.png' });
    let t = await fix(pg); truth = where(t); check(!!truth, 'reports where the telescope points: ' + JSON.stringify(truth));
    check(/Not used: the camera puts the scope/.test(t), 'camera and tilt sensor disagree → not used');
    await pg.evaluate((p) => window.simGoto(p), truth); await pg.waitForTimeout(1500);
    t = await fix(pg); check(/First fix taken/.test(t), 'first fix accepted: ' + t.split('\n').slice(0, 3).join(' / '));
    t = await fix(pg); check(/too close to the first fix/.test(t), 'second fix at the same spot refused');
    await pg.screenshot({ path: OUT + '/b78-result.png', fullPage: true });
    // line the camera up with the eyepiece on the nearest star, then forget
    await pg.evaluate(() => { const d = [...document.querySelectorAll('#tab-camera details')].find((x) => /Line the camera up/.test(x.innerText)); d.open = true; });
    const star = await pg.evaluate(() => document.querySelector('#cam-star').selectedOptions[0].textContent); await pg.click('#cam-cal'); await pg.waitForTimeout(300);
    check(/Lined up on/.test(await pg.evaluate(() => document.querySelector('#tab-camera').innerText)), 'lined up with the eyepiece on ' + star);
    check(await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('skyward-pushto-v1')); return Object.values(s.profiles).some((p) => Array.isArray(p.camBore)); }), 'line-up saved with the telescope profile');
    await ctx.close();
  }
  { // 2b. one-fix alignment ("solve how the phone sits" switched off): a single camera fix aligns and the start-up path moves on
    const { ctx, pg } = await open({ ...base, mounting: 'camera', calibrate: false });
    await pg.click('#a-cam'); await pg.waitForTimeout(300); await pg.click('#cam-start'); await pg.waitForSelector('#cam-go', { timeout: 15000 }); await pg.waitForTimeout(1500);
    await pg.evaluate((p) => window.simGoto(p), truth); await pg.waitForTimeout(1500);
    await pg.click('#cam-go'); await pg.waitForFunction(() => !document.querySelector('#tab-camera').classList.contains('on'), null, { timeout: 60000 }); await pg.waitForTimeout(400);
    check(await pg.evaluate(() => document.querySelector('#tab-find').classList.contains('on') || document.querySelector('#tab-push').classList.contains('on')), 'one fix aligned the scope and moved on to choosing a target');
    await pg.evaluate(() => document.querySelector('#gate').classList.add('hidden')); await pg.click('nav#tabs button[data-tab=more]'); await pg.waitForTimeout(300);
    check(/Aligned on camera fix 1/.test(await pg.evaluate(() => document.querySelector('#tab-more').innerText)), 'More shows "Aligned on camera fix 1"');
    await ctx.close();
  }
  { // 3. aligned on two stars, heading then knocked 3° out: a camera fix puts it right
    const { ctx, pg } = await open({ ...base, mounting: 'camera' });
    for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name'); await pg.evaluate((k) => window.simGoto(k), name); await pg.waitForTimeout(1700); await pg.click('#a-ok'); await pg.waitForTimeout(900); }
    await pg.evaluate(() => document.querySelector('#gate').classList.add('hidden'));
    await pg.click('nav#tabs button[data-tab=more]'); await pg.waitForTimeout(300); await pg.click('#tab-more [data-go=camera]'); await pg.waitForTimeout(300);
    await pg.click('#cam-start'); await pg.waitForSelector('#cam-go', { timeout: 15000 }); await pg.waitForTimeout(1500);
    await pg.evaluate((p) => window.simGoto({ alt: p.alt, az: p.az + 3 }), truth); await pg.waitForTimeout(1500);   // the app now believes it is 3° east of the truth
    const t = await fix(pg); check(/Pointing synced to the camera/.test(t), 'aligned scope: fix used as a sync');
    const toast = await pg.textContent('#toast'); const m = /corrected ([\d.]+)(°|′)/.exec(toast || '');
    const corr = m ? (m[2] === '°' ? +m[1] : +m[1] / 60) : null;
    check(corr != null && Math.abs(corr - 3) < 0.4, `heading corrected by about 3° (${toast})`);
    await ctx.close();
  }
  await b.close(); console.log(fail ? `${fail} FAILED` : 'b78 walk passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
