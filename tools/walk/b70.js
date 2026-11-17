const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA' });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes' })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(3000);
  console.log('path row:', await pg.evaluate(() => [...document.querySelectorAll('#launch .stop')].find((s) => /Blocked/.test(s.textContent)).innerText.replace(/\n/g, ' / ')));
  await pg.click('#l-hz'); await pg.waitForTimeout(400); await pg.evaluate(() => document.querySelector('#tab-horizon h3').scrollIntoView()); await pg.waitForTimeout(200); await pg.screenshot({ path: 'h70.png' });
  console.log('headings:', await pg.evaluate(() => [...document.querySelectorAll('#tab-horizon h3')].map((h) => h.textContent).join(' | ')));
  await pg.click('#hz-trace'); await pg.waitForTimeout(2300); console.log('trace opens:', await pg.textContent('#tab-horizon h2'));
  await pg.click('#hz-cancel'); await pg.waitForTimeout(300);
  await pg.evaluate(() => document.querySelector('#tab-horizon [data-wedge="2"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await pg.waitForTimeout(300);
  console.log('after a tap:', await pg.evaluate(() => [...document.querySelectorAll('#tab-horizon h3')].map((h) => h.textContent).join(' | ')), '| trace button:', await pg.textContent('#hz-trace'), '| clear enabled:', !(await pg.isDisabled('#hz-clear')));
  console.log('errors', errs); await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
