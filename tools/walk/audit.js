const { chromium, devices } = require('playwright'); const fs = require('fs');
const OUT = 'audit/'; let N = 0; const dump = [];
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], timezoneId: 'America/Toronto', locale: 'en-CA', geolocation: { latitude: 43.55, longitude: -80.25 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('dialog', (d) => d.dismiss());
  await pg.clock.install({ time: new Date('2026-11-17T20:30:00-05:00') });
  await pg.goto('http://localhost:8765/?sim&x=' + Date.now()); await pg.clock.runFor(3200);
  const wait = (ms) => pg.clock.runFor(ms);
  const tap = async (sel) => { const ok = await pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, sel); await wait(450); return ok; };
  const snap = async (name, rootSel) => {
    N++; const id = String(N).padStart(2, '0') + '-' + name;
    const info = await pg.evaluate((rootSel) => {
      const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('.hidden'); };
      const roots = rootSel ? [document.querySelector(rootSel)] : [...document.querySelectorAll('section.tab.on, .overlay:not(.hidden), header, #flowbar:not(.hidden)')];
      const text = roots.filter(Boolean).map((r) => r.innerText).join('\n---\n');
      const small = [], tiny = [], clip = [];
      for (const r of roots.filter(Boolean)) {
        for (const e of r.querySelectorAll('button, a, select, input, [role=button], summary, label.stop')) { if (!vis(e)) continue; const q = e.getBoundingClientRect(); if (q.height < 40 || q.width < 40) small.push(`${(e.id ? '#' + e.id : e.className || e.tagName).toString().slice(0, 24)} "${(e.innerText || e.value || e.getAttribute('aria-label') || '').slice(0, 22)}" ${Math.round(q.width)}x${Math.round(q.height)}`); }
        for (const e of r.querySelectorAll('*')) { if (!vis(e) || !e.childNodes.length) continue; const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2); if (!own) continue; const fsz = parseFloat(getComputedStyle(e).fontSize); if (fsz < 12) tiny.push(`${fsz}px "${e.textContent.trim().slice(0, 30)}"`);
          if ((e.scrollWidth > e.clientWidth + 2) && getComputedStyle(e).overflow !== 'visible' && getComputedStyle(e).textOverflow === 'ellipsis') clip.push(`"${e.textContent.trim().slice(0, 40)}"`); }
      }
      const pageW = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      return { text, small: [...new Set(small)].slice(0, 14), tiny: [...new Set(tiny)].slice(0, 10), clip: [...new Set(clip)].slice(0, 10), pageW, scrollH: document.querySelector('main') ? document.querySelector('main').scrollHeight : 0 };
    }, rootSel);
    await pg.screenshot({ path: OUT + id + '.png' });
    dump.push(`\n\n################ ${id}  (page height ${info.scrollH}px${info.pageW ? ', SIDEWAYS SCROLL' : ''})\n${info.text}\n  [small targets] ${info.small.join(' ; ') || '-'}\n  [tiny text] ${info.tiny.join(' ; ') || '-'}\n  [truncated] ${info.clip.join(' ; ') || '-'}`);
  };
  const tabTo = async (t) => { await pg.click(`nav#tabs button[data-tab=${t}]`); await wait(800); };
  try {
    // ---- first run
    await snap('start-observe', '#gate'); for (const a of ['explore', 'game', 'plan']) { await pg.click(`[data-act=${a}]`); await wait(200); await snap('start-' + a, '#gate'); }
    await tap('#gate details.more summary'); await snap('start-how-it-works', '#gate');
    await tap('#l-shade'); await snap('shade-popover', '#shadepop'); await pg.mouse.click(10, 300); await wait(300);
    await pg.click('[data-act=observe]'); await wait(200); await pg.click('#l-go'); await wait(600); await snap('dock-question', '#dockq'); await tap('#dq-no'); await snap('dock-no', '#dockq'); await tap('#dq-go'); await wait(800);
    if (await pg.isVisible('#gate-sim')) { await snap('gate-sim-offer', '#gate'); await pg.click('#gate-sim'); await wait(1800); }
    await snap('flow-checkup-start'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 600)); await snap('flow-checkup-lower');
    await tap('#fb-next'); await wait(600); await snap('flow-blocked-sky'); await tap('#hz-trace'); await wait(2600); await snap('trace-hand'); await tap('#hz-rec'); await wait(1200); await snap('trace-countdown'); await wait(2500); await snap('trace-recording'); await tap('#hz-cancel');
    await tap('#fb-next'); await wait(800); await snap('flow-align-1');
    for (let i = 0; i < 2; i++) { const name = await pg.textContent('#tab-align .target-h .name').catch(() => null); if (!name) break; await pg.evaluate((n) => window.simGoto(n), name); await wait(1800); if (i === 0) await snap('align-on-star'); await pg.click('#a-ok'); await wait(1100); }
    await snap('after-align-landing'); await tabTo('push'); await snap('push-sky-view');
    await pg.click('#st-pill'); await wait(700); await snap('align-done-screen'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 900)); await snap('align-done-lower');
    // ---- find
    await tabTo('find'); await snap('find-top'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 500)); await snap('find-list');
    await pg.fill('#q', 'ring'); await wait(700); await snap('find-search'); await pg.fill('#q', ''); await wait(500);
    await pg.evaluate(() => document.querySelector('main').scrollTo(0, 0)); await tap('#flist li[data-k] .main, #flist li[data-k]'); await wait(900);
    if (await pg.isVisible('#sheet')) { await snap('object-sheet', '#sheet'); await pg.evaluate(() => { const c = document.querySelector('#sheet .card'); if (c) c.scrollTo(0, 700); }); await snap('object-sheet-lower', '#sheet'); await tap('#sh-go'); await wait(900); }
    await snap('push-target-far'); const nm = await pg.textContent('#tab-push .target-h .name').catch(() => null);
    if (nm) { await pg.evaluate((n) => window.simGoto(n), nm.trim()); await wait(2500); await snap('push-on-target'); }
    await pg.evaluate(() => document.querySelector('main').scrollTo(0, 700)); await snap('push-lower'); for (const s of await pg.$$('#tab-push details summary')) { await s.evaluate((e) => e.click()); } await wait(500); await snap('push-details-open'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 1500)); await snap('push-details-lower');
    await tap('#b-log'); await wait(600); await snap('log-dialog');
    for (const s of ['#lg-yes', '[data-seen=yes]', '#log-yes']) { if (await tap(s)) break; } await wait(600); await snap('after-log');
    // ---- plan
    await tabTo('plan'); await wait(2500); await snap('plan-empty'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 700)); await snap('plan-suggestions');
    await tap('#pl-edit'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 0)); await snap('plan-session-edit'); await tap('#pl-edit');
    await tap('#pl-auto'); await wait(2800); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 0)); await snap('plan-built-top'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 520)); await snap('plan-built-list'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 1300)); await snap('plan-built-lower');
    await tap('#pl-reorder'); await pg.evaluate(() => document.querySelector('#pl-list').scrollIntoView()); await snap('plan-edit-mode'); await tap('#pl-reorder');
    await tap('#pl-prev'); await wait(900); await snap('route-preview'); await wait(6000); await snap('route-preview-2'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 500)); await snap('route-preview-lower'); await tap('#rt-back'); await wait(600);
    await tap('#pl-go'); await wait(1200); await snap('plan-start-observing'); 
    // ---- game
    await tabTo('game'); await snap('play-lobby'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 600)); await snap('play-lobby-lower'); await tap('#tab-game details summary'); await snap('play-leaderboard-open');
    await tap('#mm-go'); await wait(1300); await snap('marathon-sync-star'); await tap('#mm-nosync'); await snap('marathon-target'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 700)); await snap('marathon-lower'); await tap('#mm-got'); await wait(300); await snap('marathon-got-far');
    await tap('#mm-end'); await tap('#mm-end'); await wait(600); await snap('marathon-summary'); await tap('#mm-back');
    await tap('#g-new'); await wait(1500); await snap('race-ready'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 700)); await snap('race-ready-lower');
    for (const s of ['#g-start', '#g-go']) { if (await tap(s)) break; } await wait(5000); await snap('race-playing'); for (const s of ['#g-quit', '#g-stop', '#g-end']) { if (await tap(s)) { await tap(s); break; } } await wait(700); await snap('race-after-quit');
    // ---- more
    await tabTo('more'); await snap('more-menu'); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 700)); await snap('more-menu-lower');
    const gos = await pg.evaluate(() => [...document.querySelectorAll('#tab-more [data-go]')].map((e) => e.dataset.go));
    for (const g of gos) {
      await tabTo('more'); await tap(`#tab-more [data-go="${g}"]`); await wait(900);
      if (g === 'sky') { await snap('sky-check', '#skycheck'); await tap('#sq-more'); await snap('sky-check-2', '#skycheck'); await tap('#sq-ok'); await wait(600); continue; }
      if (g === 'start') { await snap('start-again', '#gate'); await pg.evaluate(() => document.querySelector('#gate').classList.add('hidden')); continue; }
      await snap('more-' + g); let y = 750; for (let k = 0; k < 4; k++) { const h = await pg.evaluate(() => document.querySelector('main').scrollHeight); if (y > h - 300) break; await pg.evaluate((y) => document.querySelector('main').scrollTo(0, y), y); await snap(`more-${g}-p${k + 2}`); y += 750; }
      if (g === 'setup') { for (const s of await pg.$$('#tab-setup details summary')) await s.evaluate((e) => e.click()); await wait(400); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 0)); await snap('setup-all-open'); for (let k = 1; k < 6; k++) { await pg.evaluate((y) => document.querySelector('main').scrollTo(0, y), k * 750); await snap('setup-all-open-p' + (k + 1)); } }
    }
    // ---- night look
    await tabTo('push'); await tap('.shadebtn'); await pg.evaluate(() => { const r = document.querySelector('#shadepop input[type=range]'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(900); await pg.mouse.click(10, 500); await wait(300); await snap('night-push'); await tabTo('plan'); await wait(1500); await snap('night-plan'); await tabTo('find'); await snap('night-find');
  } catch (e) { dump.push('\n\n!!!! WALK STOPPED: ' + e.message.split('\n').slice(0, 5).join(' | ')); await pg.screenshot({ path: OUT + 'zz-stopped.png' }); }
  dump.push('\n\nPAGE ERRORS: ' + JSON.stringify(errs));
  fs.writeFileSync(OUT + 'text.txt', dump.join('')); console.log('screens', N, 'errors', errs.length, dump.filter((d) => /WALK STOPPED/.test(d)).join(''));
  await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
