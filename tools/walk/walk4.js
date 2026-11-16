const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto' }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('http://localhost:8765/?x=' + Date.now()); await pg.waitForTimeout(1200);
  // no simulator: Plan needs no sensors and must not show the sensor error
  await pg.click('[data-act=plan]'); await pg.click('#l-go'); await pg.waitForTimeout(4500);
  console.log('plan: gate hidden', !(await pg.isVisible('#gate')), '| plan shown', await pg.isVisible('#tab-plan'), '| pill:', await pg.textContent('#st-pill'));
  await pg.click('#pl-auto'); await pg.waitForTimeout(2500); console.log('plan items:', await pg.locator('#pl-list li').count());
  await pg.click('#pl-go'); await pg.waitForTimeout(4500);
  console.log('start observing without sensors -> gate shows the reason:', await pg.isVisible('#gate'), '|', (await pg.textContent('#gate-msg')).slice(0, 60));
  await pg.click('#gate-skip'); await pg.waitForTimeout(900);
  console.log('after continue: gate hidden', !(await pg.isVisible('#gate')), '| flowbar:', (await pg.textContent('#flowbar')).slice(0, 50));
  await pg.click('#fb-stop'); await pg.click('nav#tabs button[data-tab=find]'); await pg.waitForTimeout(600); console.log('find strip:', (await pg.textContent('#tab-find .strip')).slice(0, 40));
  await pg.click('#qs-start'); await pg.waitForTimeout(400); console.log('start strip reopens gate:', await pg.isVisible('#gate'));
  console.log('errors:', errs); await b.close();
})().catch((e) => { console.error('WALK FAILED', e.message.split('\n').slice(0, 5).join('\n')); process.exit(1); });
