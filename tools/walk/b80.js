// Build 80: the native-camera path, exercised with a PRETEND plug-in (no iPhone involved).
// The pretend plug-in reads Chromium's fake camera and scales brightness with the exposure and gain it is asked for,
// so the app's exposure-from-the-sky logic, frame decoding, stacking and solving all run as they would in the iPhone app.
//   node b80.js <sky.y4m>      (docs/ served on :8765; run as CommonJS)
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + process.argv[2]] });
  let fail = 0; const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) fail++; };
  for (const sky of ['dark', 'bright']) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, timezoneId: 'America/Toronto', permissions: ['camera'] });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
    await pg.clock.setFixedTime(new Date('2026-11-18T01:00:00-05:00'));
    await pg.addInitScript((kind) => {
      try { localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'no', mounting: 'top-sky', site: { lat: 43.55, lon: -80.25, source: 'entered manually' } })); } catch (e) {}
      // The fake video was "shot" at REF seconds and gain 1. A dark sky is the video as it is; a bright sky adds a glow.
      const REF = kind === 'dark' ? 0.5 : 0.02, st = { t: 0.1, iso: 600, v: null, cv: null, calls: [] };
      const plug = {
        calls: st.calls,
        async open() { const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } }); st.v = document.createElement('video'); st.v.muted = true; st.v.srcObject = s; await st.v.play(); st.cv = document.createElement('canvas'); return { minExposure: 0.0001, maxExposure: 1, minISO: 50, maxISO: 1000, exposure: st.t, iso: st.iso, fieldOfView: 68, camera: 'Pretend Camera' }; },
        async setExposure({ seconds, iso }) { st.t = Math.min(1, Math.max(0.0001, seconds)); st.iso = Math.min(1000, Math.max(50, iso)); st.calls.push([st.t, st.iso]); return { exposure: st.t, iso: st.iso }; },
        async frame() {
          await new Promise((r) => setTimeout(r, Math.min(300, st.t * 1000)));
          const w = st.v.videoWidth, h = st.v.videoHeight; st.cv.width = w; st.cv.height = h; const cx = st.cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(st.v, 0, 0, w, h);
          const d = cx.getImageData(0, 0, w, h).data, gain = (st.t / REF) * (st.iso / 600); let out = '';
          const buf = new Uint8Array(w * h); for (let i = 0, j = 0; i < buf.length; i++, j += 4) buf[i] = Math.max(0, Math.min(255, d[j] * gain));
          for (let i = 0; i < buf.length; i += 32768) out += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
          return { width: w, height: h, exposure: st.t, iso: st.iso, data: btoa(out) };
        },
        async close() { if (st.v && st.v.srcObject) for (const t of st.v.srcObject.getTracks()) t.stop(); },
      };
      window.Capacitor = { isNativePlatform: () => true, Plugins: { SkyCam: plug } };
    }, sky);
    await pg.goto('http://localhost:8765/?sim'); await pg.waitForTimeout(3600);
    await pg.evaluate(() => { const sp = document.querySelector('#splash'); if (sp) sp.remove(); document.querySelector('#gate').classList.add('hidden'); });
    await pg.click('nav#tabs button[data-tab=more]'); await pg.waitForTimeout(300); await pg.click('#tab-more [data-go=camera]'); await pg.waitForTimeout(300);
    await pg.click('#cam-start'); await pg.waitForSelector('#cam-go', { timeout: 15000 }); await pg.waitForTimeout(1500);
    check(await pg.evaluate(() => document.querySelector('#cam-v').tagName === 'CANVAS' && document.querySelector('#cam-v').width > 0), sky + ': native preview is drawn into a canvas');
    await pg.click('#cam-go'); await pg.waitForSelector('#cam-pic', { timeout: 100000 }); await pg.waitForTimeout(300);
    const rep = await pg.evaluate(() => document.querySelector('pre.camrep').textContent), calls = await pg.evaluate(() => window.Capacitor.Plugins.SkyCam.calls);
    console.log(rep.split('\n').filter((l) => /SOLVED|Single-frame|Light collected|Sky:/.test(l)).map((l) => '      ' + l).join('\n'));
    const lastT = calls[calls.length - 1][0], level = +(/level ([\d.]+) of 765/.exec(rep) || [0, 0])[1];
    check(/SOLVED/.test(rep) && /Alnilam/.test(await pg.evaluate(() => document.querySelector('#tab-camera').innerText)), sky + ': solved through the native path');
    check(/set by the app/.test(rep), sky + ': report says the app set the exposure');
    check(level > 765 * 0.04 && level < 765 * 0.22, `${sky}: sky background brought into the working range (${level.toFixed(0)} of 765)`);
    if (sky === 'dark') check(lastT > 0.3, `dark sky → long frames (${lastT.toFixed(3)} s)`); else check(lastT < 0.08, `bright sky → short frames (${lastT.toFixed(3)} s)`);
    await ctx.close();
  }
  await b.close(); console.log(fail ? `${fail} FAILED` : 'b80 walk passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
