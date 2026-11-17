const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(3000);
  const wait = (ms) => pg.waitForTimeout(ms);
  const tap = (sel) => pg.evaluate((s) => document.querySelector(s).dispatchEvent(new MouseEvent('click', { bubbles: true })), sel);
  const stops = () => pg.evaluate(() => [...document.querySelectorAll('#launch .stop:not(.end)')].map((s) => `${s.querySelector('input').checked ? '★' : s.classList.contains('na') ? '–' : '☆'} ${s.querySelector('b').textContent}: ${s.querySelector('.muted').textContent}`).join('\n   '));
  for (const act of ['observe', 'game', 'explore', 'plan']) { await pg.click(`[data-act=${act}]`); await wait(200); if (act === 'observe') await pg.screenshot({ path: 'l67.png' }); console.log(act + ':\n   ' + await stops()); }
  const h0 = await pg.evaluate(() => document.querySelector('#launch').getBoundingClientRect().height);
  // Open button does not toggle the star
  await pg.click('[data-act=explore]'); const before = await pg.isChecked('[data-step=horizon]'); await pg.click('#l-hz'); await wait(400);
  console.log('Open → screen:', await pg.textContent('#tab-horizon h2'), '| back:', await pg.textContent('#hz-back'), '| carry-on button present:', !!(await pg.$('#hz-next')));
  await pg.click('#hz-back'); await wait(400); console.log('star unchanged by Open:', before === await pg.isChecked('[data-step=horizon]'));
  // run the path: explore with sky off, blocked sky on
  await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await wait(800);
  if (await pg.isVisible('#gate-sim')) { await pg.click('#gate-sim'); await wait(1500); }
  console.log('flow step:', (await pg.textContent('#flowbar')).replace(/\s+/g, ' ').slice(0, 70), '| button:', await pg.textContent('#hz-next'), '| back button hidden:', !(await pg.$('#hz-back')));
  await pg.screenshot({ path: 'f67.png' });
  await tap('#tab-horizon [data-wedge="2"]'); await wait(200); await tap('#tab-horizon [data-wedge="2"]'); await wait(300); console.log('after marking:', await pg.textContent('#hz-next'));
  await tap('#hz-next'); await wait(1000); console.log('landed on tab:', await pg.evaluate(() => document.querySelector('section.tab.on').id), '| flow bar hidden:', await pg.evaluate(() => document.querySelector('#flowbar').classList.contains('hidden')));
  await pg.reload(); await wait(3000); await pg.click('[data-act=explore]'); await wait(200); console.log('next visit:\n   ' + await stops());
  await pg.check('[data-step=horizon]'); await wait(200); console.log('re-ticked:', await pg.isChecked('[data-step=horizon]'));
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
