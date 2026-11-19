// Build 84: hot pixels are learned from use. Three fake-camera videos of different parts of the sky, all carrying the
// same three small sensor defects; after fixes on all three the defects are known and no longer reported as stars.
//   node b84.js <orion.y4m> <cas.y4m> <cyg.y4m>      (docs/ served on :8765; run as CommonJS)
const { chromium, devices } = require('playwright');
const os = require('os'), fs = require('fs'), path = require('path');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b84-')); let fail = 0; const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) fail++; };
  const HOT = [[220, 90], [700, 160], [1050, 300]];
  const run = async (video, first) => {
    const ctx = await chromium.launchPersistentContext(dir, { ...devices['iPhone 13'], permissions: ['camera'], args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + video] });
    const pg = ctx.pages()[0] || await ctx.newPage(); pg.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
    if (first) await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'no', mounting: 'top-sky', site: { lat: 43.55, lon: -80.25, source: 'entered manually' } })); } catch (e) {} });
    await pg.goto('http://localhost:8765/?sim'); await pg.waitForTimeout(3600);
    await pg.evaluate(() => { const sp = document.querySelector('#splash'); if (sp) sp.remove(); document.querySelector('#gate').classList.add('hidden'); });
    await pg.click('nav#tabs button[data-tab=more]'); await pg.waitForTimeout(300); await pg.click('#tab-more [data-go=camera]'); await pg.waitForTimeout(300);
    await pg.click('#cam-start'); await pg.waitForSelector('#cam-go', { timeout: 15000 }); await pg.waitForTimeout(1500);
    await pg.click('#cam-go'); await pg.waitForSelector('#cam-pic', { timeout: 60000 }); await pg.waitForTimeout(300);
    const rep = await pg.evaluate(() => document.querySelector('pre.camrep').textContent);
    const res = await pg.evaluate((H) => { const st = JSON.parse(localStorage.getItem('skyward-pushto-v1')), hp = st.hotPix && st.hotPix.w; return { hot: hp ? hp.list.filter((e) => e.hot).map((e) => [Math.round(e.x), Math.round(e.y)]) : [] }; }, HOT);
    const line = rep.split('\n').filter((l) => /SOLVED|NOT SOLVED|Hot pixels|Stars:/.test(l)).join(' / ');
    await ctx.close(); return { rep, line, ...res };
  };
  const vids = process.argv.slice(2, 5), names = ['Orion', 'Cassiopeia', 'Cygnus'];
  for (let k = 0; k < 3; k++) { const r = await run(vids[k], k === 0); console.log(`      ${names[k]}: ${r.line}`); check(/SOLVED/.test(r.rep) && !/NOT SOLVED/.test(r.rep), `${names[k]} solved`); if (k < 2) check(r.hot.length === 0, `${names[k]}: nothing marked hot yet`); else check(r.hot.length === 3 && HOT.every(([x, y]) => r.hot.some(([a, b]) => Math.abs(a - x - 0.5) < 2 && Math.abs(b - y - 0.5) < 2)), `after three parts of the sky, the three defects are known: ${JSON.stringify(r.hot)}`); }
  const r = await run(vids[0], false); console.log(`      Orion again: ${r.line}`);
  check(/Hot pixels: 3 known and ignored/.test(r.rep), 'next fix ignores the three known hot pixels');
  fs.rmSync(dir, { recursive: true, force: true }); console.log(fail ? `${fail} FAILED` : 'b84 walk passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
