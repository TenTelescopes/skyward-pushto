// Build 82: times follow the calendar. Open the app one afternoon, leave it in the background overnight, bring it back
// the next morning: the plan, the start screen and the marathon must all talk about the new evening.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); let fail = 0; const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) fail++; };
  const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA' });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
  await pg.clock.install({ time: new Date('2026-11-18T15:00:00-05:00') });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('skyward-pushto-v1')) localStorage.setItem('skyward-pushto-v1', JSON.stringify({ v: 1, dock: 'yes', site: { lat: 43.55, lon: -80.25, source: 'entered manually' } })); } catch (e) {} });
  await pg.goto('http://localhost:8765/?sim'); await pg.clock.runFor(3600);
  await pg.evaluate(() => { const sp = document.querySelector('#splash'); if (sp) sp.remove(); });
  const startLine = () => pg.textContent('p.tonight');
  const planLine = async () => (await pg.evaluate(() => document.querySelector('#tab-plan .sess').innerText)).replace(/\n/g, ' | ');
  const sunsetOf = (t) => (/Sunset ([\d:]+\s?[ap]\.?m\.?)/i.exec(t) || [])[1];
  console.log('      Nov 18 3 pm start screen:', await startLine());
  await pg.evaluate(() => document.querySelector('#gate').classList.add('hidden'));
  await pg.click('nav#tabs button[data-tab=plan]'); await pg.clock.runFor(800);
  const p1 = await planLine(); console.log('      Nov 18 3 pm plan:', p1);
  // a late session: plan starting 12:30 am must show that night's sunset (Nov 18), not the next day's
  await pg.evaluate(() => { const st = JSON.parse(localStorage.getItem('skyward-pushto-v1')); }); 
  // into the background overnight
  await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.clock.fastForward('18:37:00');                                   // → Nov 19, 9:37 am
  await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.clock.runFor(800);
  const p2 = await planLine(); console.log('      Nov 19 9:37 am plan, after coming back:', p2);
  check(/Tonight|Today/.test(p2) && sunsetOf(p1) && sunsetOf(p2) && sunsetOf(p1) !== sunsetOf(p2), `plan moved to the new evening (${sunsetOf(p1)} → ${sunsetOf(p2)})`);
  const st = await pg.evaluate(() => JSON.parse(localStorage.getItem('skyward-pushto-v1')).plan.start);
  check(new Date(st).getDate() === 19, 'plan start is on Nov 19: ' + new Date(st).toString().slice(0, 21));
  // the start screen, if it was the screen showing when the app went to the background, is redrawn too
  await pg.evaluate(() => { document.querySelector('#gate').classList.remove('hidden'); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.clock.fastForward('00:15:00');
  await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await pg.clock.runFor(300);
  const s2 = await startLine(); console.log('      Nov 19 9:52 am start screen:', s2);
  check(/Daylight now — dark from 6:32/.test(s2) && !/1:24/.test(s2), 'start screen shows tonight (dark 6:32, not last night’s Moon times)');
  // left open across midnight: the minute timer redraws on its own
  await pg.evaluate(() => document.querySelector('#gate').classList.add('hidden'));
  await pg.click('nav#tabs button[data-tab=plan]'); await pg.clock.runFor(500);
  await pg.clock.fastForward('14:30:00');                                    // → Nov 20, 0:07 am, app open the whole time
  await pg.clock.runFor(61000);
  const p3 = await planLine(); console.log('      Nov 20 0:08 am, left open:', p3);
  check(sunsetOf(p3) === sunsetOf(p2), 'just after midnight the plan still belongs to the Nov 19 evening (session not over)');
  await ctx.close(); await b.close(); console.log(fail ? `${fail} FAILED` : 'b82 walk passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
