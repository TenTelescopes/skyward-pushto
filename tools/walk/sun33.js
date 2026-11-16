const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-16T12:10:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(3000);
  for (const k of ['sky']) await pg.uncheck(`[data-step=${k}]`).catch(() => {});
  await pg.click('[data-act=explore]'); await pg.click('#l-go'); await pg.waitForTimeout(400); await pg.click('#gate-sim'); await pg.waitForTimeout(1500);
  const sun = await pg.evaluate(() => { const o = window.simGoto({ alt: 20, az: 170 }); return o; });
  await pg.waitForTimeout(2500); await pg.screenshot({ path: 'U1.png' });
  await pg.click('#z-in').catch(() => {}); await pg.click('#z-in').catch(() => {}); await pg.click('#z-in').catch(() => {}); await pg.waitForTimeout(1500); await pg.screenshot({ path: 'U2.png' });
  console.log('errors', errs); await b.close();
  require('child_process').execSync(`python3 -c "
from PIL import Image
ims=[Image.open(x).convert('RGB') for x in ['U1.png','U2.png']]
out=Image.new('RGB',(sum(i.width for i in ims)+10,ims[0].height),(90,90,90)); x=0
for i in ims: out.paste(i,(x,0)); x+=i.width+10
out.resize((out.width//2,out.height//2)).save('sun33.png')"`);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
