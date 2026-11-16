// Audit: draw every target in every eyepiece and list the ones where nothing shows near the middle.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('http://localhost:8765/?x=' + Date.now()); await pg.waitForTimeout(1500);
  const out = await pg.evaluate(async () => {
    const { Sky } = await import('./js/astro.js'); const { drawEyepiece } = await import('./js/eyeview.js'); const { theme } = await import('./js/theme.js');
    theme.shade = 1;
    const sky = new Sky(); sky.setSite(43.55, -80.25, 300);
    const scopes = { '150': { aperture: 150, fl: 750 }, '200': { aperture: 203, fl: 812 } }, eps = [23, 10, 4].map((fl) => ({ name: fl + ' mm', fl, afov: 62 }));
    const cv = document.createElement('canvas'); cv.width = cv.height = 300; const c = cv.getContext('2d');
    const date = new Date('2026-11-16T22:00:00-05:00'), res = [], byType = {};
    for (const o of sky.objects) {
      if ((o.key.startsWith('st:') && !o.show) || o.twin) continue;
      const tg = o.planet ? sky.altAz(o, date) : sky.altAzRaDec(o.ra, o.dec, date);
      const t = o.planet ? 'PL' : o.key.startsWith('ds:') || (o.key.startsWith('st:') && o.pairs) ? 'DS' : o.key.startsWith('st:') ? 'ST' : o.t;
      const ink = [];
      for (const e of eps) {
        try { drawEyepiece(cv, sky, o.pairs && o.key.startsWith('st:') ? { ...o, t: 'DS' } : o, tg, e, scopes['150'], { bright: 1, date }); } catch (err) { ink.push(-1); continue; }
        const d = c.getImageData(60, 60, 180, 180).data; let n = 0;
        for (let y = 0; y < 180; y++) for (let x = 0; x < 180; x++) { if ((x - 90) ** 2 + (y - 90) ** 2 > 80 * 80) continue; if (d[(y * 180 + x) * 4] > 45) n++; }
        ink.push(n);
      }
      (byType[t] ||= { n: 0, blankAll: 0, blankSome: 0, err: 0 }); byType[t].n++;
      if (ink.includes(-1)) byType[t].err++;
      if (ink.every((v) => v >= 0 && v < 4)) { byType[t].blankAll++; res.push(`${t} ${o.label}${o.name ? ' (' + o.name + ')' : ''} size ${o.maj ?? '-'} mag ${o.mag ?? '-'}`); }
      else if (ink.some((v) => v >= 0 && v < 4)) byType[t].blankSome++;
    }
    return { byType, blank: res };
  });
  console.log(JSON.stringify(out.byType)); console.log('blank in every eyepiece:', out.blank.length); console.log(out.blank.join(' | ')); console.log('errors', errs);
  await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exitCode = 1; });
