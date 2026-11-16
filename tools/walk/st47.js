const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text()); });
  await pg.clock.install({ time: new Date('2026-11-16T19:00:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(3000);
  await pg.click('[data-act=plan]'); await pg.uncheck('[data-step=sky]').catch(() => {}); await pg.click('#l-go'); await pg.waitForTimeout(2500);
  const pick = async (re, file) => {
    const ok = await pg.evaluate((src) => { const r = new RegExp(src); const el = [...document.querySelectorAll('#tab-plan [data-info]')].find((x) => r.test(x.textContent)); if (el) el.click(); return !!el; }, re);
    await pg.waitForTimeout(900); if (ok) await pg.screenshot({ path: file }); console.log(re, ok, ok ? await pg.evaluate(() => [...document.querySelectorAll('#sh-eps figcaption')].map((f) => f.textContent).join(' | ')) : '');
    await pg.evaluate(() => document.querySelector('#sh-x') && document.querySelector('#sh-x').click()); await pg.waitForTimeout(300);
  };
  console.log('doubles offered:', await pg.evaluate(() => [...document.querySelectorAll('#tab-plan [data-info]')].filter((x) => /binary|multiple|Double star/i.test(x.textContent)).map((x) => x.querySelector('.t1').textContent + ' — ' + x.querySelector('.t2').textContent).slice(0, 10).join('\n  ')));
  await pick('Albireo', 'E1.png'); await pick('Castor', 'E2.png'); await pick('M45', 'E3.png'); await pick('Almach', 'E4.png');
  console.log('errors', errs); await b.close();
  require('child_process').execSync(`python3 -c "
from PIL import Image
ims=[Image.open(x).convert('RGB').crop((0,640,1170,1250)) for x in ['E1.png','E2.png','E3.png','E4.png']]
out=Image.new('RGB',(sum(i.width for i in ims)+10,ims[0].height),(90,90,90)); x=0
for i in ims: out.paste(i,(x,0)); x+=i.width+10
out.resize((out.width//2,out.height//2)).save('eps40.png')"`);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exitCode = 1; });
