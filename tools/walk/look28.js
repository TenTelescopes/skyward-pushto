const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.clock.install({ time: new Date('2026-11-16T20:30:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(900); await pg.screenshot({ path: 'L1-splash.png' });
  await pg.waitForTimeout(2200); await pg.screenshot({ path: 'L2-start.png' });
  await pg.click('[data-act=plan]'); await pg.waitForTimeout(300); await pg.screenshot({ path: 'L3-plan.png' });
  await pg.click('[data-act=observe]'); await pg.click('#l-shade'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const r = document.querySelector('#sh-range'); r.value = 0.5; r.dispatchEvent(new Event('input')); }); await pg.waitForTimeout(300); await pg.screenshot({ path: 'L4-half.png' });
  await pg.evaluate(() => { const r = document.querySelector('#sh-range'); r.value = 1; r.dispatchEvent(new Event('input')); }); await pg.waitForTimeout(300); await pg.screenshot({ path: 'L5-night.png' });
  await pg.evaluate(() => { const r = document.querySelector('#sh-range'); r.value = 0; r.dispatchEvent(new Event('input')); }); await pg.mouse.click(200, 600); await pg.waitForTimeout(200);
  for (const k of ['check', 'sky', 'align']) await pg.uncheck(`[data-step=${k}]`);
  await pg.click('#l-go'); await pg.waitForTimeout(400); await pg.click('#gate-sim'); await pg.waitForTimeout(2500); await pg.screenshot({ path: 'L6-find.png' });
  await pg.fill('#q', 'M31'); await pg.waitForTimeout(400); await pg.click('#flist li[data-k]'); await pg.waitForTimeout(1500); await pg.screenshot({ path: 'L7-push.png' });
  await pg.click('nav#tabs button[data-tab=more]'); await pg.waitForTimeout(500); await pg.screenshot({ path: 'L8-more.png' });
  console.log('errors:', errs); await b.close();
  const { execSync } = require('child_process');
  execSync(`python3 -c "
from PIL import Image
n=['L1-splash','L2-start','L3-plan','L4-half','L5-night','L6-find','L7-push','L8-more']
ims=[Image.open(x+'.png').convert('RGB') for x in n]
for part,(a,b_) in enumerate([(0,4),(4,8)]):
    sel=ims[a:b_]; w=sum(i.width for i in sel)+10*len(sel); out=Image.new('RGB',(w,sel[0].height),(90,90,90)); x=0
    for i in sel: out.paste(i,(x,0)); x+=i.width+10
    out.resize((int(out.width*0.5),int(out.height*0.5))).save('look28-%d.png'%part)
"`);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
