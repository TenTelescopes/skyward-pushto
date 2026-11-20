// Builds 80/83: the native-camera path, exercised with a PRETEND plug-in (no iPhone involved). Runs three times: dark sky
// and bright sky with RAW frames (16-bit linear), and a camera that offers no RAW (8-bit preview frames).
// The pretend plug-in reads Chromium's fake camera and scales brightness with the exposure and gain it is asked for,
// so the app's exposure-from-the-sky logic, frame decoding, stacking and solving all run as they would in the iPhone app.
//   node b80.js <sky.y4m>      (docs/ served on :8765; run as CommonJS)
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + process.argv[2]] });
  let fail = 0; const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) fail++; };
  for (const [sky, raw] of [['dark', true]]) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, timezoneId: 'America/Toronto', permissions: ['camera'] });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
    await pg.clock.setFixedTime(new Date('2026-11-18T01:00:00-05:00'));
    await pg.addInitScript(([kind, hasRaw]) => {
      try { localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'no', mounting: 'top-sky', site: { lat: 43.55, lon: -80.25, source: 'entered manually' } })); } catch (e) {}
      // The fake video was "shot" at REF seconds and gain 1. A dark sky is the video as it is; a bright sky adds a glow.
      const REF = kind === 'dark' ? 0.5 : 0.02, st = { t: 0.1, iso: 600, v: null, cv: null, calls: [] };
      const plug = {
        calls: st.calls,
        async open() { const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } }); st.v = document.createElement('video'); st.v.muted = true; st.v.srcObject = s; await st.v.play(); st.cv = document.createElement('canvas'); return { minExposure: 0.0001, maxExposure: 1, minISO: 50, maxISO: 1000, exposure: st.t, iso: st.iso, fieldOfView: 68, camera: 'Pretend Camera', raw: hasRaw }; },
        async setExposure({ seconds, iso }) { st.t = Math.min(1, Math.max(0.0001, seconds)); st.iso = Math.min(1000, Math.max(50, iso)); st.calls.push([st.t, st.iso]); return { exposure: st.t, iso: st.iso }; },
        async frame() {
          await new Promise((r) => setTimeout(r, Math.min(300, st.t * 1000)));
          const w = st.v.videoWidth, h = st.v.videoHeight; st.cv.width = w; st.cv.height = h; const cx = st.cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(st.v, 0, 0, w, h);
          const d = cx.getImageData(0, 0, w, h).data, gain = (st.t / REF) * (st.iso / 600); let out = '';
          const buf = new Uint8Array(w * h); for (let i = 0, j = 0; i < buf.length; i++, j += 4) buf[i] = Math.max(0, Math.min(255, d[j] * gain));
          for (let i = 0; i < buf.length; i += 32768) out += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
          return { width: w, height: h, exposure: st.t, iso: st.iso, data: btoa(out) };
        },
        async raw() {
          st.raws = (st.raws || 0) + 1; plug.raws = st.raws;
          await new Promise((r) => setTimeout(r, Math.min(300, st.t * 1000)));
          const w = st.v.videoWidth, h = st.v.videoHeight; st.cv.width = w; st.cv.height = h; const cx = st.cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(st.v, 0, 0, w, h);
          const d = cx.getImageData(0, 0, w, h).data, gain = (st.t / REF) * (st.iso / 600), u = new Uint8Array(w * h * 2);
          for (let i = 0, j = 0; i < w * h; i++, j += 4) { const v = Math.max(0, Math.min(65535, Math.round(d[j] / 255 * 65535 * gain))); u[2 * i] = v & 255; u[2 * i + 1] = v >> 8; }
          let out = ''; for (let i = 0; i < u.length; i += 32768) out += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
          return { width: w, height: h, bits: 16, linear: true, method: 'superpixel', black: 528, white: 4095, exposure: st.t, iso: st.iso, data: btoa(out) };
        },
        async close() { if (st.v && st.v.srcObject) for (const t of st.v.srcObject.getTracks()) t.stop(); },
      };
      window.Capacitor = { isNativePlatform: () => true, Plugins: { SkyCam: plug } };
    }, [sky, raw]);
    await pg.goto('http://localhost:8765/?sim'); await pg.waitForTimeout(3600);
    await pg.evaluate(() => { const sp = document.querySelector('#splash'); if (sp) sp.remove(); document.querySelector('#gate').classList.add('hidden'); });
    await pg.click('nav#tabs button[data-tab=more]'); await pg.waitForTimeout(300); await pg.click('#tab-more [data-go=camera]'); await pg.waitForTimeout(300);
    if (await pg.$('#cam-along')) { await pg.click('#cam-along'); await pg.waitForTimeout(300); }
    const txt = () => pg.evaluate(() => document.querySelector('#tab-camera').innerText);
    check(/Line up the camera, telescope and red-dot finder/.test(await txt()), 'offers lining up when the phone looks along the tube');
    await pg.click('#wiz-go'); await pg.waitForTimeout(200);
    check(/step 1 of 4/.test(await txt()), 'step 1: point at a bright star');
    await pg.click('#cam-start'); await pg.waitForSelector('#cam-go', { timeout: 15000 }); await pg.waitForTimeout(1500);
    await pg.click('#cam-go'); await pg.waitForSelector('#cam-pic', { timeout: 100000 }); await pg.waitForTimeout(300);
    let T = await txt(); const star = (/Get (\S+) in the eyepiece/.exec(T) || [])[1];
    check(!!star && /step 2 of 4/.test(T), `step 2: get ${star} in the eyepiece with the finder`);
    check(!/Line the camera up with the eyepiece by hand/.test(T), 'manual line-up hidden while lining up');
    await pg.click('#wiz-fin'); await pg.waitForTimeout(300); T = await txt();
    check(/step 3 of 4/.test(T) && /It’s centred/.test(await pg.textContent('#cam-go')), 'step 3: check centred, take the picture');
    await pg.click('#cam-go'); await pg.waitForFunction(() => /Camera lined up/.test(document.querySelector('#tab-camera').innerText), null, { timeout: 100000 });
    T = await txt(); console.log('      ' + (T.match(/Camera lined up[^\n]*/) || [''])[0]);
    check(/step 4 of 4|All three agree/.test(T), 'then step 4 (or done)');
    await pg.waitForTimeout(1500); const st = await pg.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('skyward-pushto-v1'))));
    check(st.includes('camBore') && st.includes('"finder"'), 'line-up and finder saved with the telescope profile');
    await ctx.close();
  }
  await b.close(); console.log(fail ? `${fail} FAILED` : 'b87 walk passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
