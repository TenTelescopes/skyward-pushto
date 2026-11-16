// For every cluster wider than the eyepiece field: is there a reasonably bright star near the middle of each preview?
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('http://localhost:8765/?x=' + Date.now()); await pg.waitForTimeout(1500);
  const out = await pg.evaluate(async () => {
    const { Sky } = await import('./js/astro.js'); const { drawEyepiece } = await import('./js/eyeview.js'); const { theme } = await import('./js/theme.js'); theme.shade = 1;
    const sky = new Sky(); sky.setSite(43.55, -80.25, 300); const date = new Date('2026-11-16T22:00:00-05:00');
    const cv = document.createElement('canvas'); cv.width = cv.height = 300; const c = cv.getContext('2d'); const rows = [];
    for (const [nm, sc] of [['150', { aperture: 150, fl: 750 }], ['200', { aperture: 200, fl: 800 }]]) for (const fl of [23, 10, 4]) {
      let n = 0, empty = [];
      for (const o of sky.objects) { if (!['OC', 'CN'].includes(o.t) || !o.maj) continue; const e = { name: fl + ' mm', fl, afov: 62 }, tf = 62 / (sc.fl / fl); if (o.maj / 60 <= tf) continue; n++;
        const tg = sky.altAzRaDec(o.ra, o.dec, date); drawEyepiece(cv, sky, o, tg, e, sc, { bright: 1, date });
        const d = c.getImageData(100, 100, 100, 100).data; let mx = 0; for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i]); if (mx < 150) empty.push(o.label); }
      rows.push(`${nm} / ${fl} mm: ${n} clusters wider than the field, ${empty.length} with no bright star near the middle${empty.length ? ' (' + empty.slice(0, 8).join(', ') + ')' : ''}`);
    }
    return rows;
  });
  console.log(out.join('\n')); console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
