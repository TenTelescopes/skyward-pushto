const { chromium, devices } = require('playwright'); const fs = require('fs');
const OUT = 'audit/'; let N = 70; const dump = [];
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('dialog', (d) => d.dismiss());
  await pg.clock.install({ time: new Date('2026-11-17T20:30:00-05:00') });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes', launch: { check: false, sky: false, align: false, horizon: false } })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3200);
  const wait = (ms) => pg.clock.runFor(ms);
  const tap = async (sel) => { const ok = await pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, sel); await wait(450); return ok; };
  const snap = async (name, rootSel) => {
    N++; const id = String(N).padStart(2, '0') + '-' + name;
    const info = await pg.evaluate((rootSel) => {
      const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('.hidden'); };
      const roots = rootSel ? [document.querySelector(rootSel)] : [...document.querySelectorAll('section.tab.on, .overlay:not(.hidden)')];
      const text = roots.filter(Boolean).map((r) => r.innerText).join('\n---\n'); const small = [];
      for (const r of roots.filter(Boolean)) for (const e of r.querySelectorAll('button, a, select, input, summary')) { if (!vis(e)) continue; const q = e.getBoundingClientRect(); if (q.height < 36 || q.width < 36) small.push(`${(e.id ? '#' + e.id : e.tagName)} "${(e.innerText || e.value || '').slice(0, 18)}" ${Math.round(q.width)}x${Math.round(q.height)}`); }
      return { text, small: [...new Set(small)].slice(0, 12), scrollH: document.querySelector('main').scrollHeight };
    }, rootSel);
    await pg.screenshot({ path: OUT + id + '.png' });
    dump.push(`\n\n################ ${id}  (page height ${info.scrollH}px)\n${info.text}\n  [very small targets] ${info.small.join(' ; ') || '-'}`);
  };
  const tabTo = async (t) => { await pg.click(`nav#tabs button[data-tab=${t}]`); await wait(800); };
  try {
    await pg.click('[data-act=explore]'); await pg.click('#l-go'); await wait(700); if (await pg.isVisible('#gate-sim')) { await pg.click('#gate-sim'); await wait(1800); }
    await snap('explore-unaligned-push');
    await tabTo('more'); await tap('#tab-more [data-go="sky"]'); await wait(500); await snap('sky-check', '#skycheck'); console.log('sq-ok closes:', await tap('#sq-ok'), await pg.evaluate(() => document.querySelector('#skycheck').classList.contains('hidden'))); await pg.evaluate(() => document.querySelector('#skycheck').classList.add('hidden'));
    await tabTo('more'); await tap('#tab-more [data-go="test"]'); await wait(800); await snap('tests'); for (let y = 750; y < 4000; y += 750) { const h = await pg.evaluate(() => document.querySelector('main').scrollHeight); if (y > h - 200) break; await pg.evaluate((y) => document.querySelector('main').scrollTo(0, y), y); await snap('tests-y' + y); }
    await tabTo('more'); await tap('#tab-more [data-go="setup"]'); await wait(800); await snap('setup'); 
    for (const s of await pg.$$('#tab-setup details summary')) await s.evaluate((e) => e.click()); await wait(400); await snap('setup-open');
    for (let y = 750; y < 6000; y += 750) { const h = await pg.evaluate(() => document.querySelector('main').scrollHeight); if (y > h - 200) break; await pg.evaluate((y) => document.querySelector('main').scrollTo(0, y), y); await pg.screenshot({ path: OUT + 'setup-y' + y + '.png' }); }
    await tabTo('find'); await tap('#flist li[data-k]'); await wait(900); await snap('find-tap-result');
    await tabTo('plan'); await wait(2500); await tap('#pl-sugg li .main, #pl-sugg li'); await wait(900); if (await pg.evaluate(() => { const s = document.querySelector('#sheet'); return s && !s.classList.contains('hidden'); })) { await snap('object-sheet', '#sheet'); await pg.evaluate(() => document.querySelector('#sheet .card').scrollTo(0, 600)); await snap('object-sheet-lower', '#sheet'); await tap('#sh-x, #sh-close, #sheet .x'); await pg.evaluate(() => document.querySelector('#sheet').classList.add('hidden')); }
    await tabTo('push'); await tap('.shadebtn'); await pg.evaluate(() => { const r = document.querySelector('#shadepop input[type=range]'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(900); await pg.mouse.click(10, 500); await wait(400);
    await snap('night-push'); await tabTo('plan'); await wait(2000); await snap('night-plan'); await tabTo('find'); await snap('night-find'); await tabTo('game'); await snap('night-play'); await tabTo('more'); await snap('night-more');
  } catch (e) { dump.push('\n\n!!!! WALK STOPPED: ' + e.message.split('\n').slice(0, 5).join(' | ')); }
  dump.push('\n\nPAGE ERRORS: ' + JSON.stringify(errs)); fs.writeFileSync(OUT + 'text2.txt', dump.join('')); console.log('screens', N - 70, 'errors', errs.length, dump.filter((d) => /WALK STOPPED/.test(d)).join('')); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
