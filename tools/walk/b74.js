const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA', geolocation: { latitude: 45.02, longitude: -79.3 }, permissions: ['geolocation'], acceptDownloads: true });
  const pg = await ctx.newPage(); const errs = []; let dialogs = 0; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(3200);
  const wait = (ms) => pg.waitForTimeout(ms);
  const tap = async (sel) => { const ok = await pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, sel); await wait(350); return ok; };
  const st = () => pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1') || '{}'));
  console.log('first-run path:', await pg.evaluate(() => [...document.querySelectorAll('#launch .stop:not(.end)')].map((s) => `${s.querySelector('input').checked ? '★' : '☆'} ${s.querySelector('b').textContent} (${s.querySelector('.muted').textContent})`).join(' | ')));
  // location: skip, and it asks again next launch; typed-in; GPS
  await pg.click('[data-act=plan]'); await pg.click('#l-go'); await wait(500); console.log('1. asks location:', await pg.textContent('#dlg-card h3')); await pg.screenshot({ path: 'loc74.png' });
  await tap('#dlg details summary'); await pg.fill('#loc-lat', '95'); await pg.fill('#loc-lon', '-80'); await tap('#loc-set'); console.log('   bad latitude →', (await pg.textContent('#toast')).slice(0, 50));
  await pg.fill('#loc-lat', '51.5'); await pg.fill('#loc-lon', '-0.12'); await tap('#loc-set'); console.log('   typed →', await pg.textContent('#dlg-card h3'), '|', await pg.textContent('#dlg-card p')); await tap('#loc-go'); await wait(800); await tap('#fb-next'); await wait(1500);
  let s = await st(); console.log('   stored:', s.site.lat, s.site.lon, s.site.source, '| on plan tab:', await pg.evaluate(() => document.querySelector('#tab-plan').classList.contains('on')));
  // backup → wipe → restore
  await tap('#pl-auto'); await wait(2500); await pg.fill('#pl-notes', 'Backup test note'); await tap('#pl-name'); await wait(300);
  await pg.click('nav#tabs button[data-tab=more]'); await wait(400); await tap('#tab-more [data-go=backup]'); await pg.screenshot({ path: 'bk74.png' });
  console.log('2. backup dialog:', (await pg.innerText('#dlg-card')).split('\n').filter(Boolean).slice(0, 3).join(' | '));
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }).catch(() => null), tap('#bk-save')]); let text = null;
  if (dl) { const p = await dl.path(); text = require('fs').readFileSync(p, 'utf8'); console.log('   file:', dl.suggestedFilename(), text.length, 'bytes'); } else console.log('   no download event');
  await wait(600); if (!text) text = await pg.evaluate(() => JSON.stringify({ app: 'skyward-pushto', v: 1, state: JSON.parse(localStorage.getItem('skyward-pushto-v1')) }));
  await pg.evaluate(() => localStorage.clear()); await pg.reload(); await wait(3200); s = await st(); console.log('   after wipe: plan items', s.plan ? s.plan.items.length : 0);
  await pg.evaluate(() => { document.querySelector('#gate').classList.add('hidden'); }); await pg.click('nav#tabs button[data-tab=more]'); await wait(400); await tap('#tab-more [data-go=backup]');
  await pg.fill('#bk-paste', 'not a backup'); await tap('#bk-restore'); await tap('#bk-restore'); console.log('   junk →', (await pg.textContent('#toast')).slice(0, 60));
  await pg.fill('#bk-paste', text); await tap('#bk-restore'); await tap('#bk-restore'); await wait(3500); s = await st();
  console.log('   restored: plan items', s.plan.items.length, '| notes:', s.plan.notes, '| site', s.site.lat, '| backedUp flag', !!s.backedUp);
  // in-app text dialogs
  await pg.evaluate(() => document.querySelector('#gate').classList.add('hidden')); await pg.click('nav#tabs button[data-tab=plan]'); await wait(2000);
  await tap('#pl-rename'); console.log('3. rename dialog:', await pg.textContent('#dlg-card h3'), '| value:', await pg.inputValue('#dlg-in')); await pg.fill('#dlg-in', 'Cottage weekend'); await pg.screenshot({ path: 'dlg74.png' }); await tap('#dlg-ok'); console.log('   →', await pg.textContent('#pl-name'));
  await tap('#pl-rename'); await tap('#dlg-no'); console.log('   cancel keeps:', await pg.textContent('#pl-name'));
  await tap('#pl-hz'); await wait(300); await pg.evaluate(() => document.querySelector('[data-idea=""]').scrollIntoView()); await tap('[data-idea=""]'); await pg.fill('#dlg-in', "Grandma's farm"); await pg.keyboard.press('Enter'); await wait(1500);
  s = await st(); console.log('4. place saved:', s.places.map((p) => p.name).join(', '), '| system dialogs used:', dialogs);
  console.log('5. tabs:', await pg.evaluate(() => [...document.querySelectorAll('nav#tabs span')].map((x) => x.textContent).join(' · ')));
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
