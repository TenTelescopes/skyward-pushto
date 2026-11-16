const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-16T21:00:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(1000); await pg.screenshot({ path: 'K0.png' }); await pg.waitForTimeout(2000);
  await pg.uncheck('[data-step=check]'); await pg.uncheck('[data-step=align]'); await pg.check('[data-step=sky]');
  await pg.click('#l-go'); await pg.waitForTimeout(400); await pg.click('#gate-sim'); await pg.waitForTimeout(3200);
  await pg.screenshot({ path: 'K1.png' });
  await pg.click('#sq-less'); await pg.click('#sq-less'); await pg.waitForTimeout(200); await pg.screenshot({ path: 'K2.png' });
  for (let i = 0; i < 4; i++) await pg.click('#sq-more'); await pg.waitForTimeout(200); await pg.screenshot({ path: 'K3.png' });
  console.log('stars drawn', await pg.evaluate(() => document.querySelectorAll('#sq-svg circle').length), 'on', await pg.evaluate(() => document.querySelectorAll('#sq-svg circle.on').length));
  await pg.click('#sq-ok'); await pg.waitForTimeout(300); console.log(await pg.textContent('#skycheck-card h3'), '|', await pg.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage)[0])).skyq?.nelm));
  await pg.click('#sq-done'); await pg.waitForTimeout(500);
  console.log('errors', errs); await b.close();
  require('child_process').execSync(`python3 -c "
from PIL import Image
ims=[Image.open(x).convert('RGB') for x in ['K0.png','K2.png','K1.png','K3.png']]
out=Image.new('RGB',(sum(i.width for i in ims)+30,ims[0].height),(90,90,90)); x=0
for i in ims: out.paste(i,(x,0)); x+=i.width+10
out.resize((out.width//2,out.height//2)).save('sky31.png')"`);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
