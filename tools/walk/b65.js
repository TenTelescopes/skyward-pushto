const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  let answer = null; pg.on('dialog', (d) => d.accept(answer == null ? undefined : answer));
  await pg.clock.install({ time: new Date('2026-11-17T16:00:00-05:00') });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes', site: { lat: 43.55, lon: -80.25, elev: 330, source: 'entered manually' } })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3000);
  const wait = (ms) => pg.clock.runFor(ms);
  const st = () => pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1')));
  const tap = (sel) => pg.evaluate((s) => document.querySelector(s).dispatchEvent(new MouseEvent('click', { bubbles: true })), sel);
  const toast = async () => (await pg.textContent('#toast')).slice(0, 110);
  // ---- places
  await pg.click('#l-hz'); await wait(400);
  for (const k of [6, 6]) { await tap(`#tab-horizon [data-wedge="${k}"]`); await wait(150); }       // mark W 30° before any place exists
  await tap('[data-idea="Backyard"]'); await wait(1400); console.log('1.', await toast()); await pg.screenshot({ path: 'pl1.png' });
  await tap('#plc-add'); await wait(200); await tap('[data-idea="Front yard"]'); await wait(1400); console.log('2.', await toast());
  for (const k of [2]) { await tap(`#tab-horizon [data-wedge="${k}"]`); await wait(150); }            // front yard: E 15°
  answer = 'Algonquin trip'; await tap('#plc-add'); await wait(200); await tap('[data-idea=""]'); await wait(1400); console.log('3.', await toast()); answer = null;
  let s = await st(); console.log('   places:', s.places.map((p) => `${p.name} [W ${p.horizon ? p.horizon.h[54] : '-'}, E ${p.horizon ? p.horizon.h[18] : '-'}]`).join(' | '), '| current:', s.places.find((p) => p.id === s.placeId).name);
  await tap(`[data-place="${s.places[0].id}"]`); await wait(1400); s = await st(); console.log('4. switched to', s.places.find((p) => p.id === s.placeId).name, '→ live horizon W', s.horizon && s.horizon.h[54], 'E', s.horizon && s.horizon.h[18], '| site source:', s.site.source);
  await tap(`[data-place="${s.places[1].id}"]`); await wait(1400); s = await st(); console.log('   switched to', s.places.find((p) => p.id === s.placeId).name, '→ W', s.horizon.h[54], 'E', s.horizon.h[18]);
  await pg.screenshot({ path: 'pl2.png' });
  await pg.click('#hz-back'); await wait(500); console.log('5. start screen line:', (await pg.innerText('#l-hz')).replace(/\n/g, ' / '));
  // ---- plans
  await pg.click('[data-act=plan]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await wait(2500);
  console.log('6. empty plan title:', await pg.textContent('#pl-name'), '| New plan disabled', await pg.isDisabled('#pl-new'), '| My plans disabled', await pg.isDisabled('#pl-mine'));
  await tap('#pl-auto'); await wait(2500); console.log('   built:', (await toast()));
  await pg.fill('#pl-notes', 'Clear and cold. Double Cluster was the favourite.'); await tap('#pl-name'); await wait(600);
  await pg.screenshot({ path: 'pl3.png' });
  await tap('#pl-new'); await wait(1500); console.log('7.', await toast()); console.log('   new title:', await pg.textContent('#pl-name'), '| My plans:', await pg.textContent('#pl-mine'));
  // second plan on another date, renamed
  await tap('#pl-edit'); await wait(300); await pg.fill('#pl-date', '2026-11-21'); await pg.dispatchEvent('#pl-date', 'change'); await wait(2500);
  console.log('8. date changed → title:', await pg.textContent('#pl-name'));
  await tap('#pl-auto'); await wait(2500); answer = 'Star party with the kids'; await tap('#pl-rename'); await wait(500); answer = null; console.log('   renamed:', await pg.textContent('#pl-name'));
  await tap('#pl-new'); await wait(1500); await tap('#pl-mine'); await wait(500); await pg.screenshot({ path: 'pl4.png' });
  console.log('9. my plans:', await pg.evaluate(() => [...document.querySelectorAll('#pl-saved li .grow')].map((l) => l.innerText.replace(/\n/g, ' — ')).join(' || ')));
  s = await st(); const first = s.plans[s.plans.length - 1];
  await tap(`[data-open="${first.id}"]`); await wait(1500); console.log('10.', await toast(), '| notes kept:', (await pg.inputValue('#pl-notes')).slice(0, 40), '| targets', await pg.evaluate(() => document.querySelectorAll('#pl-list li').length));
  await pg.fill('#pl-notes', (await pg.inputValue('#pl-notes')) + '\nNext time: bring the 4 mm.'); await tap('#pl-name'); await wait(500);
  await pg.reload(); await pg.clock.runFor(3000); s = await st();
  console.log('11. after reload: current =', s.plan.notes.split('\n').length, 'note lines,', s.plan.items.length, 'items; kept plans', s.plans.length, '(' + s.plans.map((p) => p.name || 'auto').join(', ') + ')');
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
