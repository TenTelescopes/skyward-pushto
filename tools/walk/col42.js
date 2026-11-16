const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text()); });
  await pg.clock.install({ time: new Date('2026-11-16T23:45:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(3000);
  await pg.click('[data-act=explore]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await pg.waitForTimeout(400); await pg.click('#gate-sim'); await pg.waitForTimeout(1500);
  await pg.evaluate(() => window.simGoto('Alnilam')); await pg.waitForTimeout(2500); await pg.screenshot({ path: 'C1.png' });
  await pg.click('nav#tabs button[data-tab=plan]'); await pg.waitForTimeout(600);
  if (await pg.$('#pl-auto')) { } await pg.waitForTimeout(1500);
  const pick = async (re, file) => { const ok = await pg.evaluate((src) => { const r = new RegExp(src); const el = [...document.querySelectorAll('#tab-plan [data-info]')].find((x) => r.test(x.textContent)); if (el) el.click(); return !!el; }, re);
    await pg.waitForTimeout(900); if (ok) await pg.screenshot({ path: file }); console.log(re, ok); await pg.evaluate(() => document.querySelector('#sh-x') && document.querySelector('#sh-x').click()); await pg.waitForTimeout(300); };
  await pick('Almach', 'C2.png'); await pick('M42', 'C3.png');
  console.log('errors', errs); await b.close();
  require('child_process').execSync(`python3 -c "
from PIL import Image
import os
ims=[Image.open(x).convert('RGB') for x in ['C1.png','C2.png','C3.png'] if os.path.exists(x)]
out=Image.new('RGB',(sum(i.width for i in ims)+20,max(i.height for i in ims)),(90,90,90)); x=0
for i in ims: out.paste(i,(x,0)); x+=i.width+10
out.resize((out.width//2,out.height//2)).save('col42.png')"`);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exitCode = 1; });
