// Secondary flows: tune-up with phone check, sky check, start screen from More, plan edit, filters, resume plan.
const { chromium, devices } = require('playwright');
const out = process.argv[2];
const shot = async (pg, name) => { await pg.waitForTimeout(400); await pg.screenshot({ path: `${out}/${name}.png` }); };
const tabTo = async (pg, t, wait = 700) => { await pg.click(`nav#tabs button[data-tab=${t}]`); await pg.waitForTimeout(wait); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.clock.install({ time: new Date('2026-11-14T21:30:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.waitForTimeout(1200);
  // full tune-up: phone check + sky check + align -> observe
  await pg.check('[data-step=sky]'); await pg.waitForTimeout(200);
  console.log('chains:', (await pg.locator('.chain').allTextContents()).join(' | '));
  await pg.click('[data-act=observe]'); await pg.click('#l-go'); await pg.waitForTimeout(500); await pg.click('#gate-sim'); await pg.waitForTimeout(3200);
  console.log('flowbar 1:', await pg.textContent('#flowbar')); await shot(pg, 'f1-check');
  await pg.click('#fb-next'); await pg.waitForTimeout(700);
  console.log('skycheck visible:', await pg.isVisible('#skycheck')); await shot(pg, 'f2-skycheck');
  await pg.click('.sq-a >> nth=3'); await pg.waitForTimeout(300); await shot(pg, 'f3-skyresult'); await pg.click('#sq-done'); await pg.waitForTimeout(700);
  console.log('flowbar 3:', await pg.textContent('#flowbar'), '| align shown:', await pg.isVisible('#tab-align'));
  for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name'); await pg.evaluate((n) => window.simGoto(n), name); await pg.waitForTimeout(1700); await pg.click('#a-ok'); await pg.waitForTimeout(900); }
  console.log('after align -> find shown:', await pg.isVisible('#tab-find'), '| flowbar hidden:', !(await pg.isVisible('#flowbar')), '| pill:', await pg.textContent('#st-pill'));
  await shot(pg, 'f4-find-ready');
  // filters
  await pg.click('#tab-find [data-unseen]'); await pg.waitForTimeout(400);
  await pg.click('#tab-find [data-cat=PL]'); await pg.waitForTimeout(500); await shot(pg, 'f5-planets');
  await pg.click('#tab-find [data-cat=ST]'); await pg.waitForTimeout(500); await shot(pg, 'f6-stars');
  await pg.click('#tab-find [data-cat=DS]'); await pg.waitForTimeout(500); await shot(pg, 'f7-doubles');
  await pg.click('#tab-find [data-cat=M]'); await pg.waitForTimeout(400);
  // plan: build, edit mode, reorder, remove; sheet add
  await tabTo(pg, 'plan', 2200); await pg.click('#pl-auto'); await pg.waitForTimeout(2200);
  const before = await pg.locator('#pl-list .t1').allTextContents();
  await pg.click('#pl-reorder'); await pg.waitForTimeout(400); await shot(pg, 'f8-plan-edit');
  await pg.click('#pl-list [data-dn="0"]'); await pg.waitForTimeout(400); await pg.click('#pl-list [data-rm="0"]'); await pg.waitForTimeout(400);
  const after = await pg.locator('#pl-list .t1').allTextContents();
  console.log('plan before:', before.length, before.slice(0, 3).join(','), '| after:', after.length, after.slice(0, 3).join(','));
  await pg.click('#pl-reorder'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const li = [...document.querySelectorAll('#pl-list li')].find((x) => !x.textContent.includes('★')); li.querySelector('[data-goplan]').click(); }); await pg.waitForTimeout(400); await shot(pg, 'f9-plan-sheet'); await pg.click('#sh-plan'); await pg.waitForTimeout(500);
  console.log('sheet plan button now:', await pg.textContent('#sh-plan')); await pg.click('#sh-x');
  // reload: resume plan from the start screen (alignment is lost on reload by design)
  await pg.waitForTimeout(600); await pg.reload(); await pg.waitForTimeout(1500); await shot(pg, 'f10-launch-resume');
  console.log('resume button:', await pg.textContent('#l-resume').catch(() => 'MISSING'));
  await pg.uncheck('[data-step=align]'); await pg.waitForTimeout(200); await pg.uncheck('[data-step=sky]'); await pg.waitForTimeout(200); await pg.click('#l-resume'); await pg.waitForTimeout(500); await pg.click('#gate-sim'); await pg.waitForTimeout(2500);
  console.log('resumed on push:', await pg.isVisible('#tab-push'), '| planbar:', (await pg.textContent('.planbar').catch(() => 'none')).slice(0, 80)); await shot(pg, 'f11-resumed');
  // start screen from More, sky check from More
  await tabTo(pg, 'more'); await pg.click('#tab-more [data-go=start]'); await pg.waitForTimeout(500); console.log('gate reopened:', await pg.isVisible('#gate'));
  await pg.click('[data-act=plan]'); await pg.click('#l-go'); await pg.waitForTimeout(1500); console.log('plan shown without restarting sensors:', await pg.isVisible('#tab-plan'));
  await tabTo(pg, 'more'); await pg.click('#m-snd [data-snd=guide]'); await pg.waitForTimeout(300); console.log('sound mode on:', await pg.textContent('#m-snd .on'));
  await pg.click('#st-scope'); await pg.waitForTimeout(400); console.log('scope name opens setup:', await pg.isVisible('#tab-setup'));
  await pg.evaluate(() => { const d = [...document.querySelectorAll('#tab-setup details')]; d.forEach((x) => { x.open = true; }); document.querySelector('main').scrollTop = 900; }); await shot(pg, 'f12-setup-adv');
  console.log('errors:', errs.slice(0, 10)); await b.close();
})().catch((e) => { console.error('WALK FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
