import { PointingModel, MOUNTINGS, eulerForMounting, fitAlignment, guidance, tangentOffset, mulMV, altAzFromVec, norm, wrap180, wrap360, sepDeg, D2R, R2D } from './model.js';
import { emptyHorizon, hasHorizon, limitAt, blocked, setWedge, wedgeLevel, wedgeHeight, newTrace, traceAdd, traceFinish, traceCoverage, summary as horizonSummary, WEDGES, LEVELS as HZ_LEVELS, BINS as HZ_BINS } from './horizon.js';
import { marathonList, pick as marathonPick, nightOf, syncStarFor } from './marathon.js';
import { nearPlaces, uniqueName, relocate, planAutoName, coordText, PLACE_IDEAS } from './places.js';
import { Sky, typeLabel, compassName, LINES } from './astro.js';
import { Sensors, SimSensors } from './sensors.js';
import { Recorder, analyzeStillness, analyzeRepeat, analyzeReversal, analyzeAccuracy, fmt, toCSV } from './tests.js';
import { fitConsistency, pairConsistency, outliers, verdict as domeVerdict, drawDome, correctionTable, splitJumps } from './dome.js';
import { constellationAt, conName, altAzToJ2000 } from './locate.js';
import { whereWords, recogniseWords, pickStars, checkAltitude, checkPair, chooseWaypoint } from './assist.js';
import { drawEyepiece, newtonianMatrix } from './eyeview.js';
import { theme, tint, applyShade, starTint } from './theme.js';
import { LEVELS, planTargets, routePlan, nextDarkNight, interest, pickScore, varied, autoPlan, kindOf, openingSync } from './plan.js';
import { seenKeys, lastEntry, logStats, MILESTONES, newlyAchieved, logCSV } from './log.js';
import { sound, initSound, cue, tickInterval } from './sound.js';
import { blurbFor, doubleNature, NATURE_LABEL, NATURE_NOTE, STAR_CLASS } from '../data/blurbs.js';
import { rate, describe, DOTS, LEVEL_NAMES, DEFAULT_NELM, tooWide } from './vis.js';
import { DAYLIGHT, STYLES, PENALTY, pickTargets, routeOrder, pathLength, tokenFor, buildTokenIndex, encodeChallenge, decodeChallenge, challengeId, encodeResult, decodeResult, points, rank, fmtTime, dwell } from './game.js';
import { submitScore, fetchBoard, flushQueue } from './wixscores.js';
import qrcode from '../vendor/qrcode.mjs';
import { analyzeSwing, analyzeAltSweep, analyzeHorizonTurn, gradeCheck, guessModel, GRADE } from './check.js';
import { SkyCamera, NativeSkyCamera, drawResult, reportText, hms as raHms } from './camera.js';
import { project as projectStar } from './solve.js';
import { FIELD as STAR_FIELD } from '../data/catalog.js';

// ---------------------------------------------------------------- persistence
const KEY = 'skyward-pushto-v1';
const capCache = {};
function cap(name) {
  const C = window.Capacitor; if (!C || !(C.isNativePlatform && C.isNativePlatform())) return null;
  if (!(name in capCache)) capCache[name] = (C.Plugins && C.Plugins[name]) || (C.registerPlugin ? C.registerPlugin(name) : null);
  return capCache[name];
}
async function loadState() {
  try { const P = cap('Preferences'); if (P) { const r = await P.get({ key: KEY }); if (r && r.value) return JSON.parse(r.value); } } catch (e) { /* fall through */ }
  try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = JSON.stringify(state);
    try { localStorage.setItem(KEY, s); } catch (e) { /* storage unavailable */ }
    try { const P = cap('Preferences'); if (P) P.set({ key: KEY, value: s }); } catch (e) { /* ignore */ }
  }, 300);
}

// ---------------------------------------------------------------- defaults (from the Skyward repos)
const DEFAULT_PROFILES = {
  sw150c: { name: 'Skyward 150 Compact', aperture: 150, fl: 750,
    source: 'D150F750 primary — Skyward 150 Compact Sourcing Guide (Jan 2026)', focuser: 90,
    eyepieces: [{ name: '23 mm', fl: 23, afov: 62, verified: false }, { name: '10 mm', fl: 10, afov: 62, verified: false }, { name: '4 mm', fl: 4, afov: 62, verified: false }], cal: null },
  sw200v: { name: 'Skyward 200 Visual', aperture: 200, fl: 800,
    source: '200 mm f/4 primary, 800 mm focal length (confirmed by Ten Telescopes). Edit if your mirror is marked differently.', focuser: 90,
    eyepieces: [{ name: '23 mm', fl: 23, afov: 62, verified: false }, { name: '10 mm', fl: 10, afov: 62, verified: false }, { name: '4 mm', fl: 4, afov: 62, verified: false }], cal: null },
};
const DEFAULTS = {
  v: 1, profiles: DEFAULT_PROFILES, active: 'sw150c', mounting: 'top-sky', mode: 'gyro', compassCorr: 0,
  site: { lat: 43.65, lon: -79.38, elev: 100, source: 'default (Toronto) — set your location' },
  smooth: 0.6, minAlt: 10, bright: 1, ep: 0, useRate: false, catFilter: 'M', upOnly: true, sort: 'best',
  history: [], target: null, log: [], sound: 'chime', skyCorr: true,
  launch: { check: false, sky: false, align: true },
};
let state;

// ---------------------------------------------------------------- runtime
const sky = new Sky();
let sensors = null;
const model = new PointingModel();
const buf = []; // [{t, R}]
let align = { obs: [], fit: null, syncs: [], confirm: [] };
let tab = 'find';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const profile = () => state.profiles[state.active];
const eyepiece = () => profile().eyepieces[Math.min(state.ep, profile().eyepieces.length - 1)];
const tfov = (ep = eyepiece(), p = profile()) => ep.afov * ep.fl / p.fl; // degrees
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); t.onclick = () => t.classList.add('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms); }
// Icons are drawn, not typed: several arrow and sun characters turn into colour emoji on iPhones, which ruins a red screen.
const svg = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  moon: svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
  full: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  prev: svg('<path d="m15 5-7 7 7 7"/>'), next: svg('<path d="m9 5 7 7-7 7"/>'),
};
const L_ARR = '◀︎', R_ARR = '▶︎', WARN = '⚠︎';   // forced to text style
const isMessier = (o) => !!(o.cats && o.cats.some((c) => /^M\d/.test(c)));
/** "Galaxy", "Double star", "Moon" — the kind of thing, in plain words. */
const kindLabel = (o) => { const n = doubleNature(o); return n ? (NATURE_LABEL[n] || 'Double star') : o.id === 'Moon' ? 'Moon' : o.key.startsWith('st:') ? 'Star' : typeLabel(o.t); };
const sizeText = (o) => (o.maj ? (o.maj >= 60 ? `${(o.maj / 60).toFixed(1)}°` : `${o.maj.toFixed(o.maj < 3 ? 1 : 0)}′`) : (o.sep ? `${o.sep}″ apart` : ''));
/** For doubles in lists that don't otherwise say what a thing is: " Binary star", " Optical double"… */
const kindTag = (o) => (doubleNature(o) ? ` <span class="cname">${esc(kindLabel(o))}</span>` : '');
/** Label with the common name: "M31 Andromeda Galaxy". */
const nameHTML = (o) => `${esc(o.label)}${o.name ? ` <span class="cname">${esc(o.name)}</span>` : ''}`;

function applyModelSettings() {
  model.setMounting(state.mounting);
  const c = profile().cal; model.p = c ? c.p : 0; model.q = c ? c.q : 0;
  model.useRate = state.useRate;
  applyTheme();
}
/** Screen brightness factor: the brightness setting at full Night, easing to full brightness toward Day. */
const vis = () => 1 + ((state.bright ?? 1) - 1) * (state.shade ?? 1);
/** One fader for the whole look: state.shade 0 = Day (evening-sky blues), 1 = Night (red on black). */
function applyTheme() {
  const t = Math.max(0, Math.min(1, state.shade ?? 0));
  state.day = t < 0.5;
  const r = document.documentElement;
  r.dataset.theme = state.day ? 'day' : 'night';
  r.style.setProperty('--k', vis());
  const bar = applyShade(t, state.bright ?? 1);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bar);
  document.querySelectorAll('.shadebtn').forEach((b) => { b.innerHTML = t < 0.5 ? ICON.sun : ICON.moon; b.title = 'Day / Night'; });
  eyeT = 0;
}
function setShade(t, quiet) {
  state.shade = t; save(); applyTheme();
  if (!quiet) { if (tab === 'setup') renderSetup(); if (tab === 'more') renderMore(); }
}
function toggleDay() { setShade(state.day ? 1 : 0); }
/** The Day ↔ Night fader, opened from the sun/moon button on every screen. */
function openShade() {
  let pop = $('#shadepop');
  if (pop) { pop.remove(); return; }
  pop = document.createElement('div'); pop.id = 'shadepop';
  pop.innerHTML = `<div class="shrow"><button class="shend" data-v="0" aria-label="Day">${ICON.sun}</button>
      <input id="sh-range" type="range" min="0" max="1" step="0.01" value="${state.shade ?? 0}" aria-label="Day to Night">
      <button class="shend" data-v="1" aria-label="Night">${ICON.moon}</button></div>
    <div class="shcap"><span>Day</span><span id="sh-note"></span><span>Night</span></div>`;
  document.body.appendChild(pop);
  const note = () => { const t = state.shade ?? 0; $('#sh-note').textContent = t > 0.97 ? 'red only — keeps your night vision' : t < 0.03 ? 'easy to read' : 'in between'; };
  note();
  $('#sh-range').oninput = (e) => { setShade(parseFloat(e.target.value), true); note(); };
  pop.querySelectorAll('.shend').forEach((b) => b.onclick = () => { setShade(+b.dataset.v, true); $('#sh-range').value = b.dataset.v; note(); });
  const close = (e) => { if (!pop.contains(e.target) && !e.target.closest('.shadebtn')) { pop.remove(); document.removeEventListener('pointerdown', close, true); if (tab === 'setup') renderSetup(); if (tab === 'more') renderMore(); } };
  document.addEventListener('pointerdown', close, true);
}
const IS_STANDALONE = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true || !!window.Capacitor;
function canFullscreen() { const el = document.documentElement; return !!(el.requestFullscreen || el.webkitRequestFullscreen); }
function toggleFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  if (canFullscreen() && !IS_IOS) { (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' })?.catch?.(() => fullscreenHelp()); return; }
  fullscreenHelp();
}
function fullscreenHelp() {
  const box = $('#fs-help'); box.classList.remove('hidden');
  box.querySelector('.fs-body').innerHTML = IS_IOS
    ? `<p>iPhone Safari can't hide its own bars for a web page. Install the app on your Home Screen instead — it then opens <b>full screen</b>, works offline and keeps your settings:</p>
       <ol><li>Open this page in <b>Safari</b>.</li><li>Tap <b>Share</b> (the square with the arrow up) — on newer iOS it's under the <b>···</b> button.</li><li>Choose <b>Add to Home Screen</b> and make sure <b>Open as Web App</b> is on, then tap <b>Add</b>.</li><li>Open <b>Skyward</b> from the Home Screen and tap Start sensors → <b>Allow</b>.</li></ol>
       <p class="muted small">The Home Screen app asks for motion access separately from Safari, once.</p>`
    : `<p>This browser won't go full screen from here. In Chrome, open the <b>⋮</b> menu → <b>Add to Home screen</b> (or <b>Install app</b>), then open Skyward from the home screen — it runs full screen.</p>`;
}

function onSensor(s) {
  buf.push({ t: performance.now(), R: s.R });
  const keep = Math.max(2000, state.smooth * 1000 + 200);
  while (buf.length && performance.now() - buf[0].t > keep) buf.shift();
}
/** Average rotation over the last `sec` seconds, re-orthonormalised. */
function avgR(sec) {
  const now = performance.now(); const s = buf.filter((b) => now - b.t <= sec * 1000);
  if (!s.length) return null;
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const b of s) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += b.R[i][j];
  const c0 = norm([M[0][0], M[1][0], M[2][0]]); let c1 = [M[0][1], M[1][1], M[2][1]];
  const d = c0[0] * c1[0] + c0[1] * c1[1] + c0[2] * c1[2]; c1 = norm([c1[0] - d * c0[0], c1[1] - d * c0[1], c1[2] - d * c0[2]]);
  const c2 = [c0[1] * c1[2] - c0[2] * c1[1], c0[2] * c1[0] - c0[0] * c1[2], c0[0] * c1[1] - c0[1] * c1[0]];
  return [[c0[0], c1[0], c2[0]], [c0[1], c1[1], c2[1]], [c0[2], c1[2], c2[2]]];
}
/** Azimuth offset currently in use, or null if the active mode isn't ready. */
function azOffset() {
  if (state.mode === 'compass') { const co = sensors && sensors.compassOffset(); return co == null ? null : co + state.compassCorr; }
  return align.fit ? model.thetaAt() : null;
}
/** Current telescope pointing. */
function pointing() {
  if (!sensors || !sensors.fresh()) return null;
  const R = avgR(state.smooth) || sensors.R; const raw = altAzFromVec(mulMV(R, model.axis()));
  const off = azOffset();
  const out = { raw, alt: raw.alt, az: off == null ? null : wrap360(raw.az + off), ready: off != null };
  // Sky correction: what every confirmed object has taught us about this phone on this telescope tonight
  // (see correctionTable in dome.js). The last Sync or alignment star still sets the heading and stays exact.
  const T = out.ready ? skyTable() : null;
  if (T) {
    const now = Date.now(), s = lastSet();
    const c = T.point(R, now, { tSet: s ? s.t : model.t0, drift: model.thetaAt(now) - model.theta, anchor: T.anchorFor(s, now) });
    out.corr = sepDeg(out.alt, out.az, c.alt, c.az); out.alt = c.alt; out.az = c.az;
  }
  return out;
}
/** The confirmed object that last set the heading (a Sync or an alignment star; test stars don't). */
function lastSet() { const P = align.confirm; for (let i = P.length - 1; i >= 0; i--) if (P[i].kind !== 'test') return P[i]; return null; }
/** The correction built from the confirmed objects; rebuilt only when they, the phone tilt or the eyepiece change. */
let corrCache = { sig: '', T: null };
function skyTableAll() {
  if (state.mode !== 'gyro' || !align.fit) return null;
  const P = align.confirm, last = P[P.length - 1];
  const sig = `${P.length}|${last ? last.t : 0}|${model.p}|${model.q}|${Math.round(tfov() * 600)}|${state.calibrate}`;
  if (corrCache.sig !== sig) corrCache = { sig, T: correctionTable(P, model.d0, { p: model.p, q: model.q }, { r: tfov() * 60 / 2, calibrate: state.calibrate !== false }) };
  return corrCache.T;
}
/** ...and only handed to the arrows when it is switched on and has shown, on the objects so far, that it helps. */
function skyTable() { if (state.skyCorr === false) return null; const T = skyTableAll(); return T && T.check.helps ? T : null; }
/**
 * Before alignment: altitude from gravity (real) + azimuth from the phone's compass (rough). Null without a compass.
 * Marked guess:true so every screen can label it "Not aligned — best guess".
 */
function guessPointing() {
  if (!sensors || !sensors.fresh()) return null;
  const co = sensors.compassOffset(); if (co == null) return null;
  const R = avgR(state.smooth) || sensors.R; const raw = altAzFromVec(mulMV(R, model.axis()));
  return { raw, alt: raw.alt, az: wrap360(raw.az + co + (state.compassCorr || 0)), ready: true, guess: true, src: 'compass' };
}
/**
 * When the app can't know which way the scope points, the Push chart is steered by hand, so there is always a sky to look at:
 *  - no sensor data at all: drag the chart to look around (hand.alt / hand.az);
 *  - sensors but no compass and no alignment: the sky still turns with the phone, and hand.off supplies the direction —
 *    south is assumed until the user drags the chart sideways or taps a compass point (hand.set).
 */
const hand = { alt: 40, az: 180, off: null, set: false };
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
let sensorT0 = 0;                                   // when the sensors were last started (a short grace before calling them "off")
/** Best guess for the Push chart: the compass if there is one, otherwise the hand-set direction. Null only without sensor data. */
function roughPointing() {
  const g = guessPointing(); if (g) return g;
  if (!sensors || !sensors.fresh()) return null;
  const R = avgR(state.smooth) || sensors.R; const raw = altAzFromVec(mulMV(R, model.axis()));
  if (hand.off == null) hand.off = wrap180(180 - raw.az);
  return { raw, alt: raw.alt, az: wrap360(raw.az + hand.off), ready: true, guess: true, src: hand.set ? 'hand' : 'assumed' };
}
/** What a drag on the Push chart does right now: 'pan' (no sensor data), 'turn' (sensors, but no compass and no alignment) or null. */
function steerMode() {
  if (state.mode === 'compass') return null;
  const cur = pointing();
  if (!cur) return targetObj() ? null : 'pan';
  if (cur.ready || sensors.compassOffset() != null) return null;
  return !targetObj() || hand.set ? 'turn' : null;
}
const sensorsWaiting = () => !!sensors && performance.now() - sensorT0 < 3000;
const SENS_BTN = '<button class="mini primary" id="ps-sens">Turn on</button>';
const bindSensBtn = (el) => { const b = $('#ps-sens', el); if (b) b.onclick = () => { renderLaunch(); $('#gate').classList.remove('hidden'); }; };
/** Measured compass uncertainty (arcmin) from the Phone check, or null if never measured. */
function guessUncertainty() { const ph = state.phonePerf; return ph && ph.compassNoise != null ? Math.hypot(ph.compassNoise, ph.compassSwing || 0) : null; }

// ---------------------------------------------------------------- tabs
// Five tabs; Align, Log, Tests and Setup live under More.
const PARENT = { align: 'more', log: 'more', test: 'more', setup: 'more', horizon: 'more', route: 'plan', camera: 'more' };
const scrollPos = {}; let pendingScroll = null;
function showTab(t) {
  const m = $('main'); if (tab && m) scrollPos[tab] = m.scrollTop;
  if (PARENT[t] && tab && !PARENT[tab]) backTo = tab;       // remember where a sub-screen was opened from
  if (tab === 'camera' && t !== 'camera') closeCamera();     // never leave the camera running behind another screen
  tab = t; const top = PARENT[t] || t;
  document.querySelectorAll('nav#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === top));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + t));
  ({ plan: renderPlan, find: renderFind, push: renderPush, align: renderAlign, game: renderGame, test: renderTest, setup: renderSetup, more: renderMore, log: renderLog, horizon: renderHorizon, route: renderRoute, camera: renderCamera })[t]();
  // Lists reopen where you left them; every other screen starts at the top.
  pendingScroll = (t === 'find' || t === 'plan') && scrollPos[t] ? { t, y: scrollPos[t] } : null;
  m.scrollTop = pendingScroll ? pendingScroll.y : 0;
}
function restoreScroll() { if (pendingScroll && pendingScroll.t === tab) { $('main').scrollTop = pendingScroll.y; pendingScroll = null; } }
let backTo = 'more';                               // the main tab a sub-screen was opened from
const BACK = '<button class="back" data-back>‹ Back</button>';
function bindBack(el) { const b = $('[data-back]', el); if (!b) return; if (flow && flow.i >= 0 && flow.i < flow.steps.length) { b.remove(); return; } b.onclick = () => showTab(backTo); }
const dlg = () => $('#dlg'), dlgCard = () => $('#dlg-card');
function closeDlg() { dlg().classList.add('hidden'); dlgCard().innerHTML = ''; }
/** Ask for a line of text in the app's own style. Resolves to the text, or null if cancelled. */
function askText(title, value = '', { hint = '', ok = 'OK', placeholder = '', max = 60 } = {}) {
  return new Promise((resolve) => {
    dlgCard().innerHTML = `<h3 style="margin-top:0">${esc(title)}</h3>${hint ? `<p class="muted small">${esc(hint)}</p>` : ''}
      <input id="dlg-in" class="dlgin" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${max}" autocomplete="off" autocapitalize="sentences">
      <div class="btnrow"><button id="dlg-ok" class="primary">${esc(ok)}</button><button id="dlg-no">Cancel</button></div>`;
    dlg().classList.remove('hidden');
    const inp = $('#dlg-in'), done = (v) => { closeDlg(); resolve(v); };
    setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) { /* not focusable yet */ } }, 50);
    $('#dlg-ok').onclick = () => done(inp.value); $('#dlg-no').onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); };
  });
}
/** Everything the app has saved on this phone, as one file the user can keep. */
function backupText() { return JSON.stringify({ app: 'skyward-pushto', v: 1, saved: new Date().toISOString(), state }); }
async function backupData() {
  const text = backupText(), d = new Date(), name = `skyward-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  try { const f = new File([text], name, { type: 'application/json' }); if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Skyward Push-To backup' }); state.backedUp = Date.now(); save(); return true; } } catch (e) { if (e && e.name === 'AbortError') return false; }
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); state.backedUp = Date.now(); save(); toast(`Saved as ${name}`, 4000); return true; } catch (e) { toast('Could not save a file here. Use Copy instead.', 4000); return false; }
}
function restoreData(text) {
  let d; try { d = JSON.parse(text); } catch (e) { toast('That is not a Skyward backup (it could not be read).', 4500); return false; }
  if (!d || d.app !== 'skyward-pushto' || !d.state || typeof d.state !== 'object') { toast('That is not a Skyward backup.', 4000); return false; }
  try { localStorage.setItem(KEY, JSON.stringify(d.state)); } catch (e) { toast('This phone would not store it.', 4000); return false; }
  location.reload(); return true;
}
function openBackup() {
  const n = { log: (state.log || []).length, plans: (state.plans || []).length + (state.plan && state.plan.items && state.plan.items.length ? 1 : 0), places: (state.places || []).length };
  dlgCard().innerHTML = `<h3 style="margin-top:0">Back up or restore</h3>
    <p class="small">Your log, plans, places and settings live only on this phone. A backup is one small file you keep somewhere safe.</p>
    <p class="muted small">On this phone now: ${n.log} log entr${n.log === 1 ? 'y' : 'ies'}, ${n.plans} plan${n.plans === 1 ? '' : 's'}, ${n.places} saved place${n.places === 1 ? '' : 's'}.${state.backedUp ? ` Last backup: ${shortDate(state.backedUp)}.` : ' Never backed up.'}</p>
    <div class="btnrow"><button id="bk-save" class="primary">Save a backup file</button><button id="bk-copy">Copy as text</button></div>
    <h3>Restore</h3>
    <p class="muted small">Restoring replaces everything on this phone with what is in the backup.</p>
    <div class="btnrow"><label class="btnlike">Choose a backup file<input id="bk-file" type="file" accept="application/json,.json,text/plain" hidden></label></div>
    <textarea id="bk-paste" class="dlgin" rows="2" placeholder="…or paste backup text here"></textarea>
    <div class="btnrow"><button id="bk-restore">Restore from the pasted text</button><button id="bk-close">Close</button></div>`;
  dlg().classList.remove('hidden');
  $('#bk-save').onclick = async () => { if (await backupData()) openBackup(); };
  $('#bk-copy').onclick = async () => { try { await navigator.clipboard.writeText(backupText()); state.backedUp = Date.now(); save(); toast('Backup copied. Paste it into a note or an email to yourself.', 4500); } catch (e) { $('#bk-paste').value = backupText(); toast('Copy was blocked. The text is in the box: select it all and copy.', 5000); } };
  $('#bk-file').onchange = async (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const t = await f.text(); $('#bk-paste').value = t; toast('File loaded. Tap Restore to replace what is on this phone.', 4500); };
  $('#bk-restore').onclick = () => { const t = $('#bk-paste').value.trim(); if (!t) return toast('Choose a file or paste the text first.'); if (!confirmTwice('bk-restore')) return; restoreData(t); };
  $('#bk-close').onclick = closeDlg;
}
/** The app cannot work without knowing where you are: every position in the sky depends on it. Asked before the first activity. */
let locAsked = false;
function askLocation(dest) {
  const show = () => {
    const ok = siteKnown();
    dlgCard().innerHTML = ok ? `<h3 style="margin-top:0">✓ Location set</h3><p>${coordText(state.site.lat, state.site.lon)}</p><div class="btnrow"><button id="loc-go" class="primary">Carry on</button></div>`
      : `<h3 style="margin-top:0">Where are you observing from?</h3>
        <p class="small">The app works out where everything is in the sky from your location. Without it, it assumes Toronto, and stars can be shown in the wrong place.</p>
        <div class="btnrow"><button id="loc-gps" class="primary big">Use this phone's location</button></div>
        <details class="more"><summary>Type it in instead</summary>
          <label class="row"><span>Latitude (°N)</span><input id="loc-lat" inputmode="decimal" placeholder="43.55"></label>
          <label class="row"><span>Longitude (°E, west is −)</span><input id="loc-lon" inputmode="decimal" placeholder="-80.25"></label>
          <div class="btnrow"><button id="loc-set">Use these</button></div></details>
        <div class="btnrow"><button id="loc-skip">Not now (use Toronto)</button></div>
        <p class="muted small" style="margin-bottom:0">It stays on this phone. GPS works with no cell signal.</p>`;
    dlg().classList.remove('hidden');
    if (ok) { $('#loc-go').onclick = () => { closeDlg(); launch(dest); }; return; }
    $('#loc-gps').onclick = async () => { $('#loc-gps').textContent = 'Finding you…'; getGPS(); const t0 = Date.now(); while (!siteKnown() && Date.now() - t0 < 32000 && !dlg().classList.contains('hidden')) await new Promise((r) => setTimeout(r, 250)); if (!dlg().classList.contains('hidden')) show(); };
    $('#loc-set').onclick = () => { const la = parseFloat($('#loc-lat').value), lo = parseFloat($('#loc-lon').value); if (!(Math.abs(la) <= 90) || !(Math.abs(lo) <= 180)) return toast('Latitude is between −90 and 90, longitude between −180 and 180.', 4000);
      state.site = { lat: la, lon: lo, elev: state.site.elev || 0, source: 'entered manually' }; sky.setSite(la, lo, state.site.elev); planRows = null; rateCache.clear(); siteMoved(); save(); renderLaunch(); show(); };
    $('#loc-skip').onclick = () => { locAsked = true; closeDlg(); launch(dest); };
  };
  show();
}

// ---------------------------------------------------------------- PLAN
// state.plan = { id, start: ISO, hours, items: [{ key, sync? }], done: { key: true }, notes, name, nameSet, placeName }  (the one being worked on)
// state.plans = the other plans, kept automatically (newest first). Nothing is ever thrown away unless the user deletes it.
const plansList = () => state.plans || (state.plans = []);
const newPlanObj = () => ({ id: 'p' + Date.now().toString(36), start: null, hours: state.plan ? state.plan.hours || 2 : 2, items: [], done: {}, notes: '', placeName: null });
const planWhere = (P) => P.placeName || placeLabel() || (/^default/.test(state.site.source || '') ? '' : coordText(state.site.lat, state.site.lon));
const planTitle = (P) => (P.nameSet && P.name ? P.name : planAutoName(new Date(P.start || Date.now()), planWhere(P)));
const planWorthKeeping = (P) => !!P && (P.items.length > 0 || !!(P.notes || '').trim());
function stashPlan() {
  const P = state.plan; if (!planWorthKeeping(P)) return false;
  if (!P.placeName) P.placeName = planWhere(P) || null;
  P.kept = Date.now(); plansList().unshift(P); if (plansList().length > 60) plansList().length = 60; return true;
}
function startNewPlan() { const kept = stashPlan(); state.plan = newPlanObj(); state.plan.start = defaultStart().toISOString(); planRows = null; save(); return kept; }
function openSavedPlan(id) {
  const i = plansList().findIndex((p) => p.id === id); if (i < 0) return;
  const [P] = plansList().splice(i, 1); stashPlan(); state.plan = P; planRows = null; save();
}
let planRows = null, planLevel = 'all', planSort = 'top', planLimit = 15, planEdit = false, planReorder = false, planMine = false;
const hm = (d) => (d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—');
const pad = (n) => String(n).padStart(2, '0');
const dateVal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeVal = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const objByKey = (k) => sky.objects.find((o) => o.key === k);
function planState() {
  if (!state.plan) state.plan = newPlanObj();
  if (!state.plan.id) state.plan.id = 'p' + Date.now().toString(36);
  if (!state.plan.start) state.plan.start = defaultStart().toISOString();
  return state.plan;
}
function defaultStart() {
  const now = new Date(), n = sky.nightAt(now), dark = n.astro || n.naut || n.set;
  if (dark && now < dark) return dark;
  if (n.rise && now > n.rise) { const t = sky.night(now), d2 = t.astro || t.naut || t.set; if (d2 && now < d2) return d2; }      // daytime: tonight
  const r = new Date(Math.ceil(now.getTime() / 900000) * 900000);
  return r;
}
const planList = () => (state.plan ? state.plan.items : []);
function markDone(key, v) { if (!state.plan) return; state.plan.done = state.plan.done || {}; if (v) state.plan.done[key] = true; else delete state.plan.done[key]; save(); }
function planBar(o) {
  const P = planList(), i = P.findIndex((x) => x.key === o.key); if (i < 0) return '';
  const it = P[i], nxt = P[i + 1] && objByKey(P[i + 1].key);
  return `<div class="planbar">${it.sync ? `<b>Sync star.</b> Centre ${esc(o.label)}, tap <b>It’s centred — sync</b>, then the arrow. ` : ''}Plan ${i + 1} of ${P.length}${nxt ? ` · next: <b>${esc(nxt.label)}</b>` : ' · last one'}</div>`;
}
function dayLabel(d) {
  const now = new Date(), a = new Date(now.getFullYear(), now.getMonth(), now.getDate()), b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((b - a) / 864e5);
  return diff === 0 ? (d.getHours() < 16 ? 'Today' : 'Tonight') : diff === 1 && d.getHours() < 6 ? 'Tonight' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
function renderPlan() {
  const el = $('#tab-plan'), P = planState();
  { const pn = sky.nightAt(new Date(P.start)), over = pn.rise ? Date.now() > pn.rise.getTime() : new Date(P.start).getTime() + P.hours * 3600000 < Date.now() - 2 * 3600000;
    if (over) { P.start = defaultStart().toISOString(); planRows = null; save(); } }   // that night is over: plan for the next one
  const start = new Date(P.start), end = new Date(start.getTime() + P.hours * 3600000), n = sky.nightAt(start);
  const moonTxt = `${Math.round(n.moonFrac * 100)}% lit${n.moonRise ? ', rises ' + hm(n.moonRise) : ''}${n.moonSet ? ', sets ' + hm(n.moonSet) : ''}`;
  const T = P.items.filter((x) => !x.sync), nSync = P.items.length - T.length, nDone = T.filter((x) => P.done && P.done[x.key]).length;
  const skyName = state.skyq ? state.skyq.label : 'Suburban sky (a guess)';
  // A plan put together by hand has no sync star at the front: suggest one.
  const firstObj = P.items.length && !P.items[0].sync ? objByKey(P.items[0].key) : null;
  let openStar = null; try { openStar = firstObj ? openingSync(sky, firstObj, start) : null; } catch (e) { /* no site yet */ }
  el.innerHTML = `<h2>Plan a session</h2>
    <div class="card">
      <div class="sess"><div><b>${dayLabel(start)} · ${hm(start)} – ${hm(end)}</b>
        <div class="muted small">${esc(skyName)} · Moon ${moonTxt}</div>
        <div class="muted small">Sunset ${hm(n.set)} · fully dark ${hm(n.astro)} – ${hm(n.astroAm)}${n.set && start < n.set ? ' · <b>you start before sunset</b>' : ''}</div></div>
        <button id="pl-edit" class="mini">${planEdit ? 'Done' : 'Change'}</button></div>
      <div class="sess hzrow"><div class="muted small">${placeLabel() ? hzLine() : `Blocked sky: ${hzLine()}`}</div><button id="pl-hz" class="mini">${horizonNow() ? 'Change' : 'Trace it'}</button></div>
      <div id="pl-form" class="${planEdit ? '' : 'hidden'}" style="margin-top:8px">
        <div class="btnrow"><button id="pl-dark" class="mini">Start at full dark (${hm(n.astro || n.naut)})</button><button id="pl-now" class="mini">Start now</button></div>
        <label class="row"><span>Date</span><input id="pl-date" type="date" value="${dateVal(start)}"></label>
        <label class="row"><span>Going out at</span><input id="pl-time" type="time" step="900" value="${timeVal(start)}"></label>
        <label class="row"><span>Staying out</span><select id="pl-hours">${[1, 1.5, 2, 3, 4, 6, 8].map((h) => `<option value="${h}" ${+P.hours === h ? 'selected' : ''}>${h} hour${h > 1 ? 's' : ''}</option>`).join('')}</select></label>
        <label class="row"><span>Your sky</span><select id="pl-skysel">${SKY_PICKS.map(([m, l]) => `<option value="${m}" ${Math.abs(skyNelm() - m) < 0.26 ? 'selected' : ''}>${l}</option>`).join('')}${SKY_PICKS.some(([m]) => Math.abs(skyNelm() - m) < 0.26) ? '' : `<option selected>${esc(state.skyq.label)}</option>`}</select></label>
        <div class="btnrow"><button id="pl-skyq" class="mini">Measure it: Little Dipper check (30 s)</button></div>
      </div>
    </div>
    ${planWorthKeeping(P) ? '' : plansList().length ? `<div class="btnrow"><button id="pl-mine" class="mini">${planMine ? 'Hide my plans' : 'My plans'} (${plansList().length})</button></div>` : ''}
    <div class="card plancard ${planWorthKeeping(P) || planMine ? '' : 'hidden'}">
      <div class="sess ${planWorthKeeping(P) ? '' : 'hidden'}"><div><b id="pl-name">${esc(planTitle(P))}</b><div class="muted small">${planWorthKeeping(P) ? 'Kept automatically' : 'Nothing in it yet'}${P.nameSet ? '' : ' · named from the date and place'}</div></div><button id="pl-rename" class="mini">Rename</button></div>
      <textarea id="pl-notes" class="${planWorthKeeping(P) ? '' : 'hidden'}" rows="2" placeholder="Notes: the sky, who came, what to try next time…">${esc(P.notes || '')}</textarea>
      ${planWorthKeeping(P) ? `<div class="btnrow"><button id="pl-new" class="mini">New plan</button><button id="pl-mine" class="mini" ${plansList().length ? '' : 'disabled'}>${planMine ? 'Hide' : 'My plans'} (${plansList().length})</button></div>` : ''}
      ${planMine && plansList().length ? `<ul class="list" id="pl-saved">${plansList().map((S) => { const t = S.items.filter((x) => !x.sync), d = t.filter((x) => S.done && S.done[x.key]).length, note = (S.notes || '').trim().split('\n')[0];
        return `<li><div class="grow"><b>${esc(planTitle(S))}</b><div class="muted small">${t.length} target${t.length === 1 ? '' : 's'}${d ? ` · ${d} done` : ''}${note ? ` · ${esc(note.slice(0, 60))}${note.length > 60 ? '…' : ''}` : ''}</div></div><button class="mini" data-open="${S.id}">Open</button><button class="mini" data-del="${S.id}" id="pl-del-${S.id}">Delete</button></li>`; }).join('')}</ul>` : ''}
    </div>
    ${P.items.length ? `<div class="sech"><h3>Your plan <span class="muted small">${T.length} target${T.length === 1 ? '' : 's'}${nSync ? ` + ${nSync} sync star${nSync === 1 ? '' : 's'}` : ''}${nDone ? ` · ${nDone} done` : ''}</span></h3><button id="pl-reorder" class="mini">${planReorder ? 'Done' : 'Edit'}</button></div>
      ${openStar ? `<div class="planbar" id="pl-open">Start with a sync star: <b>★ ${esc(openStar.o.label)}</b>, ${openStar.dist.toFixed(0)}° from ${esc((objByKey(P.items[0].key) || {}).label || 'your first target')}. Centring it first makes the arrows accurate from the start. <button id="pl-openadd" class="mini primary">Add it</button></div>` : ''}
      <ul class="list" id="pl-list">${P.items.map((it, i) => planItemHTML(it, i)).join('')}</ul>
      <div class="btnrow"><button id="pl-go" class="primary">Start observing</button><button id="pl-route">Best order + sync stars</button></div>
      <div class="btnrow"><button id="pl-prev">▶ Preview the route</button></div>
      <div class="chips wrap"><button id="pl-bytime">Order by time</button><button id="pl-nosync" ${nSync ? '' : 'disabled'}>Remove sync stars</button><button id="pl-auto">Rebuild for me</button><button id="pl-clear">Clear</button></div>
      <p class="muted small">"Best order" keeps pushes short and adds a bright star before each long jump. Centre that star and tap Sync, so the pointing is freshly corrected right where you're about to look.</p>`
    : `<div class="card" style="text-align:center"><b>No plan yet</b><p class="muted small" style="margin:4px 0 10px">Let the app pick a varied tour for this session, or add your own from the suggestions below with <b>+</b>.</p><button id="pl-auto" class="primary big">Build a plan for me</button></div>`}
    <div class="sech"><h3>Suggestions <span class="muted small">for this session</span></h3></div>
    <div class="chips" id="pl-lv">${[['all', 'All'], ['0', '●●● Obvious'], ['1', '●●○ Visible'], ['2', '●○○ Challenging']].map(([k, l]) => `<button data-lv="${k}" class="${planLevel === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="chips" id="pl-sort">${[['top', 'Top picks'], ['time', 'Looks best'], ['alt', 'Highest'], ['name', 'Catalog #']].map(([k, l]) => `<button data-s="${k}" class="${planSort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <ul class="list" id="pl-sugg"><li class="muted">Working it out…</li></ul>`;
  $('#pl-hz').onclick = () => openHorizon('plan');
  $('#pl-notes').oninput = (e) => { P.notes = e.target.value; save(); };
  $('#pl-notes').onchange = () => { const y = $('main').scrollTop; renderPlan(); $('main').scrollTop = y; };
  $('#pl-rename').onclick = async () => { const auto = planAutoName(new Date(P.start), planWhere(P)), n = await askText('Name this plan', planTitle(P), { hint: 'Leave it as it is to keep the automatic name.' }); if (n == null) return;
    if (!n.trim() || n.trim() === auto) { P.nameSet = false; delete P.name; } else { P.name = n.trim().slice(0, 60); P.nameSet = true; } save(); renderPlan(); };
  if ($('#pl-new')) $('#pl-new').onclick = () => { const name = planTitle(P); startNewPlan(); planMine = false; renderPlan(); $('main').scrollTop = 0; toast(`"${name}" is kept under My plans. Fresh plan started.`, 4000); };
  if ($('#pl-mine')) $('#pl-mine').onclick = () => { planMine = !planMine; const y = $('main').scrollTop; renderPlan(); $('main').scrollTop = y; };
  el.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => { openSavedPlan(b.dataset.open); planMine = false; renderPlan(); $('main').scrollTop = 0; toast(`Opened "${planTitle(state.plan)}"`); });
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { if (!confirmTwice(b.id)) return; state.plans = plansList().filter((p) => p.id !== b.dataset.del); save(); const y = $('main').scrollTop; renderPlan(); $('main').scrollTop = y; });
  const keepScroll = (f) => { const y = $('main').scrollTop; f(); $('main').scrollTop = y; };
  const setStart = (d) => { P.start = d.toISOString(); planRows = null; save(); renderPlan(); };
  const fromInputs = () => { const [y, m, d] = $('#pl-date').value.split('-').map(Number), [hh, mm] = $('#pl-time').value.split(':').map(Number); if (y && hh != null) setStart(new Date(y, m - 1, d, hh, mm || 0)); };
  $('#pl-edit').onclick = () => { planEdit = !planEdit; renderPlan(); };
  $('#pl-skyq').onclick = () => openSkyCheck();
  $('#pl-skysel').onchange = (e) => { const m = +e.target.value; if (!m) return; const [label] = skyLabel(m); state.skyq = { nelm: m, label, when: Date.now(), src: 'pick' }; planRows = null; save(); renderPlan(); };
  $('#pl-date').onchange = fromInputs; $('#pl-time').onchange = fromInputs;
  $('#pl-hours').onchange = (e) => { P.hours = +e.target.value; planRows = null; save(); renderPlan(); };
  $('#pl-dark').onclick = () => setStart(n.astro || n.naut || start);
  $('#pl-now').onclick = () => setStart(new Date(Math.ceil(Date.now() / 900000) * 900000));
  el.querySelectorAll('#pl-lv [data-lv]').forEach((b) => b.onclick = () => keepScroll(() => { planLevel = b.dataset.lv; planLimit = 15; renderPlan(); }));
  el.querySelectorAll('#pl-sort [data-s]').forEach((b) => b.onclick = () => keepScroll(() => { planSort = b.dataset.s; renderPlan(); }));
  const applyRoute = (rows) => {
    const { steps, notUp } = routePlan(sky, rows, { start, hours: P.hours, minAlt: 20 });
    P.items = steps.map((x) => (x.kind === 'sync' ? { key: x.o.key, sync: true } : { key: x.o.key })).concat(notUp.map((r) => ({ key: r.key })));
    save(); return { nSync: steps.filter((x) => x.kind === 'sync').length, notUp: notUp.length };
  };
  $('#pl-auto').onclick = () => {
    if (P.items.length && !confirmTwice('pl-auto')) return;
    const pick = autoPlan(computePlanRows(), { hours: +P.hours });
    if (!pick.length) return toast('Nothing suitable in that session — try a later start, or a longer stay.', 4000);
    P.done = {}; const r = applyRoute(pick); renderPlan(); $('main').scrollTop = 0;
    toast(`Plan built: ${pick.length} targets${r.nSync ? ` and ${r.nSync} sync star${r.nSync === 1 ? '' : 's'}` : ''}. Reorder or remove anything you like.`, 4500);
  };
  bindPlanList();
  if ($('#pl-openadd')) $('#pl-openadd').onclick = () => keepScroll(() => { P.items.unshift({ key: openStar.o.key, sync: true }); save(); renderPlan(); toast(`${openStar.o.label} added as your opening sync star`, 2500); });
  if ($('#pl-reorder')) $('#pl-reorder').onclick = () => keepScroll(() => { planReorder = !planReorder; renderPlan(); });
  if ($('#pl-route')) {
    $('#pl-prev').onclick = () => { route = null; showTab('route'); };
    $('#pl-go').onclick = () => {
      const pp = planProgress(), next = (pp && pp.next) || P.items[0];
      if (!sensors || !sensors.fresh()) return launch('resume');     // start the sensors (and any ticked tune-up steps) first
      state.target = next.key; save(); showTab('push');
    };
    $('#pl-route').onclick = () => keepScroll(() => {
      const rows = P.items.filter((x) => !x.sync).map((x) => rowFor(x.key)).filter(Boolean);
      const missing = P.items.filter((x) => !x.sync && !rowFor(x.key));
      const r = applyRoute(rows); P.items = P.items.concat(missing); save(); renderPlan();
      toast(`${r.nSync} sync star${r.nSync === 1 ? '' : 's'} added${r.notUp + missing.length ? ` · ${r.notUp + missing.length} not well placed in this session (left at the end)` : ''}`, 3500);
    });
    $('#pl-bytime').onclick = () => keepScroll(() => { P.items = P.items.filter((x) => !x.sync).sort((a, b) => ((rowFor(a.key) || {}).best || 0) - ((rowFor(b.key) || {}).best || 0)); save(); renderPlan(); });
    $('#pl-nosync').onclick = () => keepScroll(() => { P.items = P.items.filter((x) => !x.sync); save(); renderPlan(); });
    $('#pl-clear').onclick = () => { if (!confirmTwice('pl-clear')) return; P.items = []; P.done = {}; save(); renderPlan(); };
  }
  setTimeout(fillPlanSuggestions, 30);   // let the screen paint first
}
function computePlanRows() {
  const P = planState();
  const sig = [P.start, P.hours, profile().name, profile().aperture, profile().eyepieces.map((e) => e.fl).join(), skyNelm(), hzSig()].join('|');
  if (sig !== planSig) { planRows = null; planSig = sig; }
  if (!planRows) { planDarkNight = (() => { try { return nextDarkNight(sky, new Date(P.start)); } catch (e) { return null; } })(); }
  if (!planRows) planRows = planTargets(sky, { start: new Date(P.start), hours: +P.hours, scope: profile(), nelm: skyNelm(), minAlt: 20, horizon: horizonNow() });
  return planRows;
}
/** The blocked-sky map for this spot (null when nothing is marked). */
function horizonNow() { return hasHorizon(state.horizon) ? state.horizon : null; }
const hzSig = () => (state.horizon ? state.horizon.when || 1 : 0);
function skyNelm() { return state.skyq ? state.skyq.nelm : DEFAULT_NELM; }
let planDarkNight = null, planSig = '';
const rowFor = (key) => computePlanRows().find((r) => r.key === key) || null;
/** When each plan item will be reached: targets spread evenly through the session, a sync star just before its target. */
function planSchedule() {
  const P = planState(), start = new Date(P.start).getTime(), span = P.hours * 3600000, n = P.items.filter((x) => !x.sync).length || 1, out = new Map(); let k = 0;
  for (const it of P.items) { out.set(it.key + (it.sync ? '|s' : ''), new Date(start + span * Math.min(1, (k + 0.5) / n))); if (!it.sync) k++; }
  return out;
}
let planWhen = null;
function planItemHTML(it, i) {
  const o = objByKey(it.key); if (!o) return '';
  if (i === 0 || !planWhen) planWhen = planSchedule();
  const tAt = planWhen.get(it.key + (it.sync ? '|s' : '')) || new Date(state.plan.start), pAt = sky.altAz(o, tAt);
  const r = it.sync ? null : rowFor(it.key), done = state.plan.done && state.plan.done[it.key], last = i === state.plan.items.length - 1;
  const info = it.sync ? '<div class="t2">Sync star — centre it, tap Sync, carry on</div>'
    : r ? `<div class="t2"><span class="dots lv${r.level}">${DOTS[r.level]}</span> about ${hm(tAt)} · ${pAt.alt.toFixed(0)}° ${compassName(pAt.az)}${r.ep ? ' · ' + esc(r.ep.name) : ''}</div>${planReorder ? '' : `<div class="t2">${esc(r.desc)}</div>`}`
    : '<div class="t2">Not well placed in this session</div>';
  return `<li class="${done ? 'done' : ''}"><span class="muted small" style="width:16px;text-align:right">${i + 1}</span>
    <div class="main" data-goplan="${esc(it.key)}"><div class="t1">${it.sync ? '★ ' : ''}${nameHTML(o)}${kindTag(o)}${done ? ' <span class="seen">✓</span>' : ''}</div>${info}</div>
    ${planReorder ? `<button class="ibtn" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="ibtn" data-dn="${i}" ${last ? 'disabled' : ''} aria-label="Move down">↓</button><button class="ibtn" data-rm="${i}" aria-label="Remove from plan">✕</button><span class="grip" data-grip="${i}" role="button" aria-label="Drag to reorder">≡</span>` : `<span class="muted" aria-hidden="true">›</span>`}</li>`;
}
function bindPlanList() {
  const P = state.plan, ul = $('#pl-list'); if (!ul) return;
  const redo = () => { const y = $('main').scrollTop; save(); renderPlan(); $('main').scrollTop = y; };
  const mv = (i, j) => { const a = P.items; [a[i], a[j]] = [a[j], a[i]]; redo(); };
  ul.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => mv(+b.dataset.up, +b.dataset.up - 1));
  ul.querySelectorAll('[data-dn]').forEach((b) => b.onclick = () => mv(+b.dataset.dn, +b.dataset.dn + 1));
  ul.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { P.items.splice(+b.dataset.rm, 1); redo(); });
  // Drag a row by its grip. The row follows the finger and the others slide aside; letting go saves the new order.
  // Nothing is moved in the page until the drop (rows are only shifted visually), so the touch is never interrupted.
  ul.querySelectorAll('[data-grip]').forEach((g) => {
    g.onpointerdown = (e) => {
      e.preventDefault(); const li = g.closest('li'), sc = $('main'); if (!li || ul.classList.contains('sorting')) return;
      const rows = [...ul.children], from = rows.indexOf(li), tops = rows.map((r) => r.offsetTop), hs = rows.map((r) => r.offsetHeight), H = hs[from];
      const y0 = e.clientY, scroll0 = sc.scrollTop; let lastY = y0, to = from, raf = 0;
      li.classList.add('dragging'); ul.classList.add('sorting');
      const place = () => {
        const dy = lastY - y0 + (sc.scrollTop - scroll0); li.style.transform = `translateY(${dy}px)`;
        const mid = tops[from] + H / 2 + dy;                                   // where the middle of the dragged row is now
        to = from;
        for (let i = from + 1; i < rows.length; i++) if (mid > tops[i] + hs[i] / 2) to = i;
        for (let i = from - 1; i >= 0; i--) if (mid < tops[i] + hs[i] / 2) to = i;
        rows.forEach((r, i) => { if (r === li) return; r.style.transform = i > from && i <= to ? `translateY(${-H}px)` : i < from && i >= to ? `translateY(${H}px)` : ''; });
      };
      const edge = () => {                                                     // near the top or bottom of the screen: scroll the list
        const r = sc.getBoundingClientRect(), pad = 70; let v = 0;
        if (lastY < r.top + pad) v = -Math.ceil((r.top + pad - lastY) / 6); else if (lastY > r.bottom - pad) v = Math.ceil((lastY - (r.bottom - pad)) / 6);
        if (v) { sc.scrollTop += v; place(); }
        raf = requestAnimationFrame(edge);
      };
      const move = (ev) => { if (ev.pointerId !== e.pointerId) return; ev.preventDefault(); lastY = ev.clientY; place(); };
      const end = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        cancelAnimationFrame(raf); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
        rows.forEach((r) => { r.style.transform = ''; }); li.classList.remove('dragging'); ul.classList.remove('sorting');
        if (ev.type === 'pointerup' && to !== from) { const [it] = P.items.splice(from, 1); P.items.splice(to, 0, it); if (navigator.vibrate) navigator.vibrate(15); redo(); }
      };
      window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
      raf = requestAnimationFrame(edge);
    };
  });
}
function fillPlanSuggestions() {
  const ul = $('#pl-sugg'); if (!ul) return;
  const P = state.plan, inPlan = new Set(P.items.map((x) => x.key)), seen = seenSet();
  const all = computePlanRows(), end = new Date(P.start).getTime() + P.hours * 3600000, begin = new Date(P.start).getTime();
  let L = planLevel === 'all' ? all : all.filter((r) => r.level === +planLevel);
  const by = { top: (a, b) => pickScore(b.o, b, b.alt) - pickScore(a.o, a, a.alt), time: (a, b) => a.best - b.best || a.level - b.level, alt: (a, b) => b.alt - a.alt, name: (a, b) => catNum(a.o) - catNum(b.o) }[planSort];
  L = L.slice().sort(by);
  const counts = [0, 1, 2].map((l) => all.filter((r) => r.level === l).length);
  $('#pl-lv').querySelectorAll('[data-lv]').forEach((b) => { if (b.dataset.lv !== 'all') b.textContent = `${DOTS[+b.dataset.lv]} ${LEVELS[+b.dataset.lv]} (${counts[+b.dataset.lv]})`; });
  const when = (r) => (r.to.getTime() < end - 30 * 60000 ? ` · go early, low by ${hm(r.to)}` : r.from.getTime() > begin + 30 * 60000 ? ` · up from ${hm(r.from)}` : '');
  ul.innerHTML = L.slice(0, planLimit).map((r) => `<li class="wrap"><div class="main" data-info="${esc(r.key)}"><div class="t1">${nameHTML(r.o)}${kindTag(r.o)}${seen.has(r.key) ? ' <span class="seen">✓</span>' : ''}</div>
      <div class="t2">${esc(r.desc)}${r.cause === 'moon' && planDarkNight ? ` — better from ${planDarkNight.toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</div>
      <div class="t2"><span class="dots lv${r.level}">${DOTS[r.level]}</span> ${hm(r.best)} · ${r.alt.toFixed(0)}° ${compassName(r.az)}${r.ep ? ' · ' + esc(r.ep.name) : ''}${when(r)}</div></div>
      <button class="ibtn ${inPlan.has(r.key) ? '' : 'primary'}" data-add="${esc(r.key)}" aria-label="${inPlan.has(r.key) ? 'Remove from plan' : 'Add to plan'}">${inPlan.has(r.key) ? '✓' : '+'}</button></li>`).join('')
    + (L.length > planLimit ? `<li><button id="pl-more" style="width:100%">Show more (${L.length - planLimit})</button></li>` : '')
    + (!L.length ? '<li class="muted">Nothing at this level during your session.</li>' : '');
  ul.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => {
    const k = b.dataset.add, i = P.items.findIndex((x) => x.key === k);
    if (i >= 0) P.items.splice(i, 1); else P.items.push({ key: k });
    save(); const y = $('main').scrollTop, h0 = $('#pl-sugg').offsetTop; renderPlan(); fillPlanSuggestions(); $('main').scrollTop = y + ($('#pl-sugg').offsetTop - h0);
  });
  ul.querySelectorAll('[data-info]').forEach((d) => d.onclick = () => { const k = d.dataset.info; openObject(k, { row: rowFor(k), keys: [...ul.querySelectorAll('[data-info]')].map((x) => x.dataset.info), rowFor }); });
  const more = $('#pl-more'); if (more) more.onclick = () => { planLimit += 60; fillPlanSuggestions(); };
  restoreScroll();
}

// ---------------------------------------------------------------- FIND
const CATS = [['M', 'Messier'], ['C', 'Caldwell'], ['H400', 'Herschel 400'], ['DS', 'RASC doubles'], ['AS', 'Asterisms'], ['PL', 'Planets & Moon'], ['ST', 'Bright stars'], ['ALL', 'All']];
let findQ = '', findLimit = 150, lastSkyUpdate = 0;
function inCat(o, c) {
  if (c === 'ALL') return true;
  if (c === 'M') return o.cats && o.cats.some((x) => /^M\d/.test(x));
  if (c === 'C') return o.cats && o.cats.some((x) => /^C\d/.test(x));
  if (c === 'H400') return o.cats && o.cats.includes('H400');
  if (c === 'DS') return o.t === 'DS' && o.key.startsWith('ds:');
  if (c === 'PL') return !!o.planet;
  if (c === 'ST') return o.key.startsWith('st:');
  if (c === 'AS') return o.key.startsWith('as:');
}
function catNum(o) {
  const m = o.cats && o.cats.find((x) => /^M\d/.test(x)); if (m && state.catFilter !== 'C') return +m.slice(1);
  const c = o.cats && o.cats.find((x) => /^C\d/.test(x)); if (c) return 200 + +c.slice(1);
  const n = /(\d+)/.exec(o.id); return 1000 + (n ? +n[1] : 0);
}
function refreshSky(force) { if (force || Date.now() - lastSkyUpdate > 20000) { sky.updateAll(); lastSkyUpdate = Date.now(); } }
// ---------------------------------------------------------------- QUICK START: tested → located → aligned → pointing
function lastCheck() { return state.history.slice().reverse().find((h) => h.test === 'check' && h.result && h.result.graded); }
function siteKnown() { return /^(GPS|entered)/.test(state.site.source || ''); }
function alignedNow() { return !!align.fit && align.obs.length >= alignNeeded(); }
/** Only what still needs doing, one slim line each. Nothing at all when everything is ready. */
function readinessHTML() {
  const rows = [], st = pointState();
  if (st === 'off' || st === 'nodata') rows.push(`<div class="strip warn"><span><b>Motion sensors are off.</b></span><button id="qs-start" class="mini primary">Start</button></div>`);
  else if (st === 'unaligned') rows.push(`<div class="strip warn"><span><b>Not aligned</b> — arrows are a rough guess.</span><button id="qs-align" class="mini primary">Align</button></div>`);
  else if (st === 'resync') rows.push(`<div class="strip warn"><span><b>Sync recommended.</b> Centre a bright star and tap Sync.</span><button id="qs-align" class="mini">Align</button></div>`);
  if (!siteKnown()) rows.push(`<div class="strip"><span>Location not set — using Toronto.</span><button id="qs-gps" class="mini primary">Use GPS</button></div>`);
  if (!lastCheck() && !state.skipCheck) rows.push(`<div class="strip"><span>Phone check-up not done yet (4 min, optional).</span><button id="qs-check" class="mini">Run it</button><button id="qs-skip" class="mini" aria-label="Dismiss">✕</button></div>`);
  return rows.join('');
}
/** The best things up right now for this scope and sky: famous, well above the visibility limit, comfortably high, and varied. */
function tonightPicks(n = 8) {
  const sun = sky.sunAlt(), names = new Set();
  const c = sky.objects.filter((o) => o.alt > 20 && (!o.key.startsWith('st:') || o.show) && !o.twin).map((o) => ({ o, r: rateNow(o) }))
    .filter((x) => x.r && x.r.level <= 1 && (sun < -2 || sunSep(x.o) >= SUN_KEEP))
    .map((x) => ({ ...x, s: pickScore(x.o, x.r, x.o.alt) })).sort((a, b) => b.s - a.s)
    .filter((x) => { if (!x.o.name) return true; if (names.has(x.o.name)) return false; names.add(x.o.name); return true; });
  return varied(c, n, 2);
}
function picksHTML() {
  const sun = sky.sunAlt(), P = tonightPicks();
  return `<div class="sech"><h3>${sun > 0 ? 'Visible in daylight' : sun > -12 ? 'Good in twilight' : 'Best right now'} <span class="muted small">for your ${profile().aperture} mm</span></h3><button id="qs-explore" class="mini">Sky view</button></div>
    ${P.length ? `<div class="picks">${P.map(({ o, r }) => `<button data-go="${esc(o.key)}"><b>${esc(o.label)}</b><span>${esc(o.name || kindLabel(o))}</span><span class="dots lv${r.level}">${DOTS[r.level]} · ${o.alt.toFixed(0)}° ${compassName(o.az)}</span></button>`).join('')}</div>`
      : '<p class="muted small">Nothing is well placed right now — try the Plan tab for later tonight.</p>'}`;
}
function bindQuickStart(el) {
  const on = (id, f) => { const b = $('#' + id, el); if (b) b.onclick = f; };
  on('qs-start', () => { renderLaunch(); $('#gate').classList.remove('hidden'); });
  on('qs-check', () => { showTab('test'); startTest('check'); });
  on('qs-skip', () => { state.skipCheck = true; save(); renderFind(); });
  on('qs-gps', () => getGPS());
  on('qs-align', () => showTab('align'));
  on('qs-explore', () => { state.target = null; save(); showTab('push'); });
  el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { state.target = b.dataset.go; save(); showTab('push'); });
}

function renderFind() {
  refreshSky(true);
  const el = $('#tab-find');
  el.innerHTML = `${readinessHTML()}${picksHTML()}
    <input id="q" type="search" placeholder="Search: M13, Ring, Andromeda, Albireo…" value="${esc(findQ)}" autocomplete="off" autocorrect="off" spellcheck="false">
    <div class="chips">${CATS.map(([k, l]) => `<button data-cat="${k}" class="${state.catFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="chips">
      ${[['best', 'Best now'], ['cat', 'Catalog #'], ['alt', 'Highest'], ['mag', 'Brightest']].map(([k, l]) => `<button data-sort="${k}" class="${state.sort === k ? 'on' : ''}">${l}</button>`).join('')}
      <button data-up class="${state.upOnly ? 'on' : ''}">Up now</button>
      <button data-unseen class="${state.unseenOnly ? 'on' : ''}">Not seen yet</button>
    </div>
    <details class="more keybox"><summary>What the dots and numbers mean</summary>
      <p class="muted small"><span class="dots lv0">●●●</span> obvious · <span class="dots lv1">●●○</span> visible · <span class="dots lv2">●○○</span> challenging · <span class="dots lv3">○○○</span> not tonight. That is for your telescope, your sky and right now.</p>
      <p class="muted small"><b>mag</b> is brightness: smaller is brighter, and each step of 1 is about 2.5 times. <b>′</b> is an arcminute, a sixtieth of a degree (the Moon is 30′ wide). <b>″</b> is an arcsecond, a sixtieth of that. The last figure is how high it is now and in which direction.</p></details>
    <div id="sunwarn" class="muted small"></div>
    <ul class="list" id="flist"></ul>`;
  bindQuickStart(el);
  $('#q').addEventListener('input', (e) => { findQ = e.target.value; findLimit = 150; fillFind(); });
  el.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { state.catFilter = b.dataset.cat; save(); renderFind(); });
  $('[data-up]', el).onclick = () => { state.upOnly = !state.upOnly; save(); renderFind(); };
  $('[data-unseen]', el).onclick = () => { state.unseenOnly = !state.unseenOnly; save(); renderFind(); };
  el.querySelectorAll('[data-sort]').forEach((b) => b.onclick = () => { state.sort = b.dataset.sort; save(); renderFind(); });
  fillFind();
}
function filtered() {
  const q = findQ.trim().toLowerCase().replace(/\s+/g, ' ');
  let L = sky.objects.filter((o) => q ? true : inCat(o, state.catFilter));
  if (q) {
    const qn = q.replace(/\s/g, '');
    L = L.filter((o) => [o.label, o.id, o.sub, o.name, o.bayer, o.alt_id, o.con, ...(o.cats || [])].some((s) => s && (String(s).toLowerCase().includes(q) || String(s).toLowerCase().replace(/\s/g, '') === qn)));
  } else {
    if (state.upOnly) L = L.filter((o) => o.alt > state.minAlt);
    if (state.unseenOnly) { const seen = seenSet(); L = L.filter((o) => !seen.has(o.key)); }
  }
  // "Best now": what the visibility model rates highest, famous things first within a rating; anything not up sinks to the bottom.
  const best = (o) => { if (!(o.alt > 0)) return 900 - o.alt; const r = rateNow(o); return r ? r.level * 100 - pickScore(o, r, o.alt) : 350 - interest(o); };
  const k = { best, cat: (o) => catNum(o), alt: (o) => -o.alt, mag: (o) => o.mag ?? 99 }[state.sort] || best;
  const rank = (o) => { if (!q) return 0; const n = [o.label, o.id, o.name].filter(Boolean).map((x) => String(x).toLowerCase());
    return n.some((x) => x === q || x.replace(/\s/g, '') === q.replace(/\s/g, '')) ? 0 : n.some((x) => x.startsWith(q)) ? 1 : 2; };
  const key = new Map(L.map((o) => [o, k(o)]));
  return L.sort((a, b) => rank(a) - rank(b) || key.get(a) - key.get(b));
}
/** Tonight's rating for an object at its current position (conditions cached for 30 s, results per object). */
let nowCond = { t: 0 }, rateSig = '';
const rateCache = new Map();
function rateNow(o) {
  const p = profile(), sig = `${state.active}|${p.aperture}|${p.fl}|${p.eyepieces.map((e) => e.fl).join()}|${skyNelm()}|${hzSig()}`;
  if (Date.now() - nowCond.t > 30000 || sig !== rateSig) { nowCond = { t: Date.now(), sun: sky.sunAlt(), m: sky.moonInfo() }; rateSig = sig; rateCache.clear(); }
  if (rateCache.has(o.key)) return rateCache.get(o.key);
  const c = nowCond, sepM = c.m.alt > 0 ? sepDeg(o.alt, o.az, c.m.alt, c.m.az) : 180;
  if (o.alt > 0 && blocked(horizonNow(), o.alt, o.az)) { const b = { level: 3, margin: -9, ep: null, cause: 'blocked' }; rateCache.set(o.key, b); return b; }
  const r = rate(o, { alt: o.alt, sunAlt: c.sun, moonAlt: c.m.alt, moonFrac: c.m.frac, moonSep: sepM, nelm: skyNelm() }, p);
  rateCache.set(o.key, r); return r;
}
function findRow(o, seen) {
  const up = o.alt > 0, r = up ? rateNow(o) : null, mag = o.mag != null ? 'mag ' + (+o.mag).toFixed(1) : '';
  const line2 = (o.key.startsWith('st:') ? [kindLabel(o), mag, o.sub] : [kindLabel(o), mag, sizeText(o), fullCon(o.con)]).filter(Boolean).join(' · ');
  return `<li data-k="${esc(o.key)}" class="${state.target === o.key ? 'sel' : ''} ${o.alt < state.minAlt ? 'below' : ''}">
    <div class="main"><div class="t1">${nameHTML(o)}${seen.has(o.key) ? ' <span class="seen">✓</span>' : ''}</div><div class="t2">${esc(line2)}</div></div>
    <div class="r">${r ? `<div class="dots lv${r.level}">${DOTS[r.level]}</div>` : ''}<div class="num">${up ? `${o.alt.toFixed(0)}° ${compassName(o.az)}` : 'not up'}</div></div></li>`;
}
function fillFind() {
  const L = filtered(); const ul = $('#flist'); if (!ul) return;
  const sun = sky.sunAlt(), sw = $('#sunwarn');
  if (sun > 0) sw.innerHTML = `<b>Daylight</b> (Sun ${sun.toFixed(0)}° up): only the Moon, Venus, Jupiter, Saturn and perhaps Mars show in the scope — nothing else on this list. <b>Never point near the Sun.</b>`;
  else sw.textContent = sun > -6 ? `Twilight (Sun ${(-sun).toFixed(0)}° down): the Moon and bright planets now, then the brightest stars. Deep-sky objects need full dark.`
    : sun > -12 ? `Twilight (Sun ${(-sun).toFixed(0)}° down): planets and bright stars and doubles. Faint galaxies and nebulae need the Sun 18° down.`
    : sun > -18 ? `Almost dark (Sun ${(-sun).toFixed(0)}° down): faint galaxies and nebulae improve until the Sun is 18° down.` : '';
  const seen = seenSet();
  ul.innerHTML = L.slice(0, findLimit).map((o) => findRow(o, seen)).join('')
    + (L.length > findLimit ? `<li><button id="more" style="width:100%">Show more (${L.length - findLimit})</button></li>` : '')
    + (!L.length ? `<li class="muted">${findQ.trim() ? 'Nothing matches that search.' : `Nothing here${state.upOnly ? ' is above ' + state.minAlt + '° right now' : ''}${state.unseenOnly ? (state.upOnly ? ' that you haven\'t already seen' : ' that you haven\'t seen') : ''}. Try turning off a filter.`}</li>` : '');
  ul.querySelectorAll('li[data-k]').forEach((li) => li.onclick = () => { state.target = li.dataset.k; save(); showTab('push'); });
  const m = $('#more'); if (m) m.onclick = () => { findLimit += 200; fillFind(); };
  restoreScroll();
}
const rateTag = (r) => (r ? `<span class="dots lv${r.level}">${DOTS[r.level]}</span>` : '');

// ---------------------------------------------------------------- PUSH
const SUN_KEEP = 20;   // degrees: warn when a target is this close to the Sun
function sunSep(o) { const S = sky.sunAltAz(); return sepDeg(o.alt, o.az, S.alt, S.az); }
const targetObj = () => sky.objects.find((o) => o.key === state.target);
const HZ_TOGGLE = () => (horizonNow() ? `<button id="z-hz" class="${state.hzShow === false ? '' : 'on'}" title="Show or hide the hatching over sky you marked as blocked">${state.hzShow === false ? 'Blocked sky: hidden' : 'Blocked sky: shown'}</button>` : '');
const ZOOM_ROW = () => `<div class="btnrow zoom"><button id="z-out" aria-label="Zoom out">−</button><button id="z-in" aria-label="Zoom in">+</button><button id="z-ep" title="Tap to cycle eyepieces">${esc(eyepiece().name)}</button><button id="z-auto">Fit</button>${HZ_TOGGLE()}</div>`;
function renderPush() {
  const el = $('#tab-push'); const o = targetObj();
  pstatKey = null; rateT = 0;
  if (!o) {
    el.innerHTML = `<div class="target-h"><span class="name">Sky view</span><span class="muted">no target</span></div>
      <div class="pstat" id="pstat"></div>
      <canvas id="reticle" class="chart big" width="800" height="800"></canvas>
      <div id="whereami" class="whereami"></div>
      ${ZOOM_ROW()}
      <div class="btnrow"><button id="p-hz" class="mini">${placeLabel() ? hzLine() : `Blocked sky: ${hzLine()}`}</button></div>
      <p class="muted small">The chart follows the scope.${state.mounting === 'top-sky' ? ' In your hand, point the top edge of the phone at the sky, like a TV remote.' : ''} When it says you're near something, tap the name to read about it.</p>
      <div class="actionbar"><button id="sv-find" class="primary">Pick a target</button>${align.fit || state.mode === 'compass' ? '' : '<button id="sv-align">Align</button>'}</div>`;
    chartCentre = 'scope'; if (zoom == null) zoom = 30;
    bindChartControls();
    $('#sv-find').onclick = () => showTab('find');
    $('#p-hz').onclick = () => openHorizon('push');
    if ($('#sv-align')) $('#sv-align').onclick = () => showTab('align');
    return;
  }
  const eps = profile().eyepieces, blurb = blurbFor(o), isPlanSync = planList().some((x) => x.key === o.key && x.sync);
  const via = state.waypoint && state.waypoint.via === o.key;
  const loggable = !via && !isPlanSync && (!o.key.startsWith('st:') || o.show);
  el.innerHTML = `
    ${via ? `<div class="planbar">Check star on the way to <b>${esc((sky.objects.find((x) => x.key === state.waypoint.then) || {}).label || '')}</b> — centre it, then tap Sync.</div>` : ''}
    ${planBar(o)}
    <div class="target-h"><span class="name">${esc(o.label)}</span>${o.name ? `<span class="cname">${esc(o.name)}</span>` : ''}${o.name && o.name.toLowerCase().includes(kindLabel(o).toLowerCase()) ? '' : `<span class="muted">${esc(kindLabel(o))}</span>`}</div>
    <div class="rateline" id="p-rate">${rateLineHTML(o, sky.altAz(o))}</div>
    ${sky.sunAlt() > -2 && sunSep(o) < SUN_KEEP ? `<div class="card bad" style="border-color:var(--hi)">${WARN} ${esc(o.label)} is only ${sunSep(o).toFixed(0)}° from the Sun. Don't sweep toward the Sun — a moment of sunlight through the scope or finder can blind you. Keep the cap on the finder and approach from the side away from the Sun.</div>` : ''}
    <div class="guide">
      <div class="delta" id="d-az"><div class="lab">Turn</div><div class="val">—</div><div class="dir"></div></div>
      <div class="delta" id="d-alt"><div class="lab">Tilt</div><div class="val">—</div><div class="dir"></div></div>
    </div>
    <div class="pstat" id="pstat"></div>
    <div id="waypt"></div>
    <canvas id="reticle" class="chart" width="800" height="800"></canvas>
    <div id="whereami" class="whereami"></div>
    ${ZOOM_ROW()}
    <h3>In the eyepiece</h3>
    <div class="chips" id="ep-chips">${eps.map((e, i) => `<button data-ep="${i}" class="${i === state.ep ? 'on' : ''}">${esc(e.name)} · ${(profile().fl / e.fl).toFixed(0)}×</button>`).join('')}</div>
    <canvas id="eyeview" class="eyeview" width="640" height="640"></canvas>
    <p id="eyenote" class="muted small" style="text-align:center"></p>
    ${blurb ? `<p class="blurb">${esc(blurb)}</p>` : ''}
    ${doubleNature(o) ? `<p class="small">${esc(NATURE_NOTE[doubleNature(o)])}</p>` : ''}
    <details class="more"><summary>View options</summary>
      <div class="btnrow"><button id="z-ctr">${chartCentre === 'scope' ? 'Chart follows: scope' : 'Chart follows: target'}</button><button id="z-wide">Wide (30°)</button><button id="z-lock" class="${state.zoomLock ? 'on' : ''}">${state.zoomLock ? 'Zoom locked' : 'Lock zoom'}</button>${HZ_TOGGLE()}</div>
      <label class="row"><span>Draw the eyepiece view the way your Newtonian shows it</span><input type="checkbox" id="rot180" ${state.rot180 ? 'checked' : ''}></label>
      <p class="muted small" id="eyedim"></p>
      <p class="muted small">Eyepiece view computed for a focuser on the ${({ '-90': 'left side', '-45': 'upper left', 0: 'top', 45: 'upper right', 90: 'right side' })[profile().focuser ?? 90]} (standing behind the scope, tube level), with your head upright; tilting your head turns the view with it. <b>↑Z</b> points toward the zenith, N and E are celestial north and east.</p>
      <p class="muted small">The chart above is drawn as you see the sky standing behind the scope (up = toward the zenith). Pinch it, or use − and +, to zoom out until you recognise the star pattern. The circle is your eyepiece's true field; the chart zooms out by itself while you move unless you lock the zoom.</p>
    </details>
    <details class="more"><summary>Numbers</summary>
      <p class="muted small">${esc(o.sub || '')}${o.con ? ' · ' + esc(fullCon(o.con)) : ''}${o.mag != null ? ' · mag ' + (+o.mag).toFixed(1) : ''}${o.mnote ? ' · ' + esc(o.mnote) : ''}</p>
      ${o.pairs ? `<p class="muted small">${o.pairs.map((p) => `${p.c}: ${p.sep}″ apart, PA ${p.pa}° (mags ${p.mags})`).join(' · ')}</p>` : ''}
      ${o.ra != null && o.dec != null ? `<p class="muted small">RA ${raText(o.ra)} · Dec ${decText(o.dec)} (J2000)${o.maj ? ` · size ${o.maj >= 60 ? (o.maj / 60).toFixed(1) + '°' : o.maj + '′'}` : ''}</p>` : ''}
      <div class="kv" id="pinfo"></div>
    </details>
    <div class="btnrow"><button id="b-info">About ${esc(o.label)}</button><button id="b-free">Sky view</button><button id="p-hz">Blocked sky</button></div>
    <div class="actionbar" id="p-actions"></div>`;
  el.querySelectorAll('[data-ep]').forEach((b) => b.onclick = () => { state.ep = +b.dataset.ep; save(); renderPush(); });
  $('#rot180').onchange = (e) => { state.rot180 = e.target.checked; save(); eyeT = 0; };
  eyeT = 0;
  const step = (d) => {
    const P = planList(), i = P.findIndex((x) => x.key === state.target);
    if (i >= 0) { if (d > 0) markDone(state.target, true); const n = P[i + d]; if (n) { state.target = n.key; save(); renderPush(); $('main').scrollTop = 0; } else toast(d > 0 ? 'That was the last target in your plan' : 'Start of your plan'); return; }
    const L = filtered(); const j = L.findIndex((x) => x.key === state.target); const m = L[(j + d + L.length) % L.length]; if (m) { state.target = m.key; save(); renderPush(); $('main').scrollTop = 0; }
  };
  const bar = $('#p-actions');
  const mainBar = () => {
    const seen = seenSet().has(o.key);
    bar.innerHTML = `<button class="ibtn" id="b-prev" aria-label="Previous target">${ICON.prev}</button><button id="b-sync" class="primary wide named" aria-label="${esc(o.label)}: centred, sync"><span class="bn">${esc(o.label)}${o.name && o.name.length <= 14 ? ` <i>${esc(o.name)}</i>` : ''}</span><span class="bs">It’s centred — sync</span></button>${loggable ? `<button id="b-log">${seen ? 'Seen ✓' : 'Log'}</button>` : ''}<button class="ibtn" id="b-next" aria-label="Next target">${ICON.next}</button>`;
    $('#b-sync').onclick = () => doSync(o);
    $('#b-prev').onclick = () => step(-1); $('#b-next').onclick = () => step(1);
    if ($('#b-log')) $('#b-log').onclick = () => {
      bar.innerHTML = `<button data-seen="yes" class="primary">Saw it ✓</button><button data-seen="maybe">Not sure</button><button data-seen="no">No</button><button class="ibtn" id="b-logx" aria-label="Cancel">✕</button>`;
      bar.querySelectorAll('[data-seen]').forEach((b) => b.onclick = () => { logObservation(o, b.dataset.seen); pstatKey = null; mainBar(); });
      $('#b-logx').onclick = mainBar;
    };
  };
  mainBar(); pushBar = mainBar;
  $('#b-free').onclick = () => { state.target = null; save(); renderPush(); };
  $('#p-hz').onclick = () => openHorizon('push');
  $('#b-info').onclick = () => openObject(o.key);
  $('#whereami').onclick = (e) => { const a = e.target.closest('[data-near]'); if (a) openObject(a.dataset.near); };
  bindChartControls();
}
let pushBar = null;
function rateLineHTML(o, tgt) {
  const r = o.alt > 0 ? rateNow(o) : null;
  const high = tgt && tgt.alt > 80 ? '<div class="muted small">Nearly overhead — awkward to aim a Dobsonian there. Easier later.</div>' : '';
  if (!r) return high;
  if (r.level >= 3) return `${rateTag(r)} <b>${esc(describe(o, r))}</b>`;
  return `${rateTag(r)} <b>${LEVEL_NAMES[r.level]}</b>${r.ep ? ` · best with the ${esc(r.ep.name)}` : ''}<div class="muted small">${esc(describe(o, r))}</div>${high}`;
}
/** Status line under the arrows. Rebuilt only when its state changes, so its buttons stay tappable. */
let pstatKey = null, rateT = 0, tickT = 0, onState = { key: null, on: false, since: 0 };
function setPstat(key, html, bind) { if (pstatKey === key) return; pstatKey = key; const el = $('#pstat'); if (!el) return; el.innerHTML = html; if (bind) bind(el); }
const bindAlignBtn = (el) => { const b = $('#ps-align', el); if (b) b.onclick = () => showTab('align'); };
function setDelta(el, d, axis, ok, approx) {
  const v = el.querySelector('.val'), dir = el.querySelector('.dir');
  if (d == null) { if (v.textContent !== '—') v.textContent = '—'; dir.textContent = ''; el.classList.remove('ok'); return; }
  const pos = d >= 0, word = axis === 'az' ? (pos ? 'right' : 'left') : (pos ? 'up' : 'down'), num = (approx ? '≈' : '') + fmtDelta(d);
  const val = ok ? '✓' : axis === 'az' ? (pos ? `${num} ${R_ARR}` : `${L_ARR} ${num}`) : `${pos ? '▲' : '▼'} ${num}`;
  if (v.textContent !== val) v.textContent = val;
  const dt = ok ? `${num} ${word}` : `${word}${approx ? ' (guess)' : ''}`;
  if (dir.textContent !== dt) dir.textContent = dt;
  el.classList.toggle('ok', !!ok);
}
function onTargetHTML(o, wide, U, loggable) {
  if (wide) return `<div class="ontarget"><b>Close</b><div class="small">Within about ±${fmt.am(U)} — more than this eyepiece shows. Sweep gently around, or drop to a lower power. Sync on a nearby bright star to tighten it up.</div></div>`;
  const last = lastEntry(state.log, o.key), recent = last && last.seen === 'yes' && Date.now() - last.t < 6 * 3600000;
  if (!loggable) return `<div class="ontarget"><b>✓ In the eyepiece</b><div class="small">Centre it, then tap <b>It’s centred — sync</b>.</div></div>`;
  if (recent) return `<div class="ontarget"><b>✓ In the eyepiece</b><div class="small">Logged ✓ — tap the arrow for the next one.</div></div>`;
  return `<div class="ontarget"><b>✓ In the eyepiece</b> — take a look
    <div class="seenrow"><span>See it?</span><button data-seen="yes" class="primary">Saw it ✓</button><button data-seen="maybe">Not sure</button><button data-seen="no">No</button></div></div>`;
}
let wpT = 0, wpDismissed = null, eyeT = 0;
function updateEyeview(o, tgt) {
  const cv = $('#eyeview'); if (!cv || Date.now() - eyeT < 1000) return; eyeT = Date.now();
  const ep = eyepiece(), p = profile();
  const longest = p.eyepieces.reduce((a, e) => (e.fl > a.fl ? e : a), p.eyepieces[0]);
  const fz = p.focuser ?? 90;
  const matrix = state.rot180 ? newtonianMatrix(tgt, fz) : null;
  const r = drawEyepiece(cv, sky, o.pairs && o.key.startsWith('st:') ? { ...o, t: 'DS' } : o, tgt, ep, p, { matrix, bright: vis(), refExit: p.aperture / (p.fl / longest.fl) });
  const exit = p.aperture / r.mag;
  $('#eyenote').innerHTML = `${esc(ep.name)} · ${r.mag.toFixed(0)}× · ${r.tfov >= 1 ? r.tfov.toFixed(1) + '°' : (r.tfov * 60).toFixed(0) + '′'} across${r.mag > 2 * p.aperture ? ' · <b>more power than this scope can use</b>' : ''}${r.note ? '<br>' + esc(r.note) : ''}`;
  const dim = r.rel < 0.999 ? `Nebulae, galaxies and the sky background are <b>${(1 / r.rel).toFixed(r.rel > 0.1 ? 1 : 0)}× dimmer</b> at this power than in the ${esc(longest.name)}; stars stay as bright, so faint stars can be easier to see. Dimming is drawn on a compressed scale.`
    : 'This is your brightest view of nebulae and galaxies; higher powers dim them, but not stars.';
  const d = $('#eyedim'); if (d) d.innerHTML = `${dim} Exit pupil ${exit.toFixed(1)} mm. Stars are drawn to magnitude 8 (your scope shows fainter); real faint galaxies look dimmer than any screen.${ep.verified ? '' : ` Field size assumes a ${ep.afov}° apparent field — check it in Setup.`}`;
}
function updateWaypoint(o, tgt, cur) {
  const box = $('#waypt'); if (!box || Date.now() - wpT < 2000) return; wpT = Date.now();
  const clear = () => { if (box.innerHTML) { box.innerHTML = ''; delete box.dataset.w; } };
  const last = align.syncs[align.syncs.length - 1];
  if (state.mode !== 'gyro' || !last || !last.pos || (state.waypoint && state.waypoint.via === o.key) || wpDismissed === o.key || o.key.startsWith('st:')) return clear();
  if (cur && sepDeg(cur.alt, cur.az, tgt.alt, tgt.az) < 10) return clear();          // nearly there: no point detouring now
  const ph = state.phonePerf, r = tfov() * 60 / 2;
  const errAt = ph ? (d) => Math.hypot(ph.noise || 0, (ph.per90 || 0) * d / 90, align.fit ? align.fit.rms * 60 : 0) : null;
  const errNow = pointingUncertainty(tgt);
  const cands = sky.objects.filter((x) => (x.key.startsWith('st:') || (x.planet && x.id !== 'Moon')) && x.key !== o.key).map((x) => ({ key: x.key, label: x.label, alt: x.alt, az: x.az, mag: x.mag }));
  const w = chooseWaypoint(tgt, last.pos, cands, errAt, r, errNow);
  if (!w) return clear();
  if (box.dataset.w === w.key) return; box.dataset.w = w.key;
  box.innerHTML = `<div class="strip"><span><b>Long push (${w.distFromLast.toFixed(0)}°).</b> Sync on <b>${esc(w.label)}</b> on the way${w.errAfter != null && errNow != null ? ` — error drops from ±${fmt.am(errNow)} to about ±${fmt.am(w.errAfter)}` : ' for a tighter landing'}.</span><button id="wp-go" class="mini primary">Go</button><button id="wp-no" class="mini" aria-label="Dismiss">✕</button></div>`;
  $('#wp-go').onclick = () => { state.waypoint = { via: w.key, then: o.key }; state.target = w.key; save(); renderPush(); };
  $('#wp-no').onclick = () => { wpDismissed = o.key; clear(); };
}
function updateSkyView() {
  const cur = pointing();
  if (!cur) {                                        // no sensor data: still a sky to look at, steered by dragging
    if (sensorsWaiting()) setPstat('wait', 'Waiting for sensors…');
    else setPstat('sv-off', `<b>Sensors are off</b> — drag the chart to look around. ${SENS_BTN}`, bindSensBtn);
    const at = { alt: hand.alt, az: hand.az, ready: true };
    trackMotion(null); updateWhere(at);
    drawReticle(null, at, { label: '' }, { noTarget: true, banner: ['SENSORS OFF', 'Drag the chart to look around'] });
    return;
  }
  const live = cur.ready ? cur : roughPointing();
  if (!live.guess) { setPstat('sv', '<span id="ps-far"></span>'); const f = $('#ps-far'); if (f) f.textContent = `${cur.alt.toFixed(0)}° up, facing ${compassName(cur.az)}`; }
  else if (live.src === 'compass') setPstat('sv-guess', '');
  else setPstat('sv-nocomp', `<b>No compass.</b> Tap the way the scope points, or drag the chart.<div class="dirs">${DIRS.map((d, i) => `<button data-dir="${i * 45}">${d}</button>`).join('')}</div>`,
    (el) => el.querySelectorAll('[data-dir]').forEach((bt) => bt.onclick = () => {
      const g = roughPointing(); if (!g) return;
      hand.off = wrap180(+bt.dataset.dir - g.raw.az); hand.set = true; toast(`Direction set — scope pointing ${bt.textContent}`);
    }));
  trackMotion(live); updateWhere(live);
  drawReticle(cur, { alt: live.alt, az: live.az }, { label: '' }, { noTarget: true });
}
function updatePush() {
  const o = targetObj();
  if (!o) { if ($('#reticle')) updateSkyView(); return; }
  const azEl = $('#d-az'), altEl = $('#d-alt'); if (!azEl) return;
  const tgt = sky.altAz(o), cur = pointing(), now = performance.now();
  updateEyeview(o, tgt);
  if (now - rateT > 5000) { rateT = now; const rl = $('#p-rate'); if (rl) rl.innerHTML = rateLineHTML(o, tgt); }
  if (!cur) {                                        // no sensor data: show where the target sits in the sky
    setDelta(azEl, null); setDelta(altEl, null);
    if (sensorsWaiting()) setPstat('wait', 'Waiting for sensors…');
    else setPstat('off', `<b>Sensors are off</b> — the chart shows the sky around ${esc(o.label)}. ${SENS_BTN}`, bindSensBtn);
    drawReticle(null, tgt, o, { banner: ['SENSORS OFF', `The sky around ${o.label}`] }); return;
  }
  if (!cur.ready) {                                 // no alignment yet: altitude is real, azimuth is a best guess
    const gp = roughPointing(), ALIGN = '<button class="mini primary" id="ps-align">Align</button>';
    setDelta(altEl, tgt.alt - cur.alt, 'alt', false);
    if (gp.src === 'assumed') {                      // no compass and no direction given: don't invent a turn arrow
      setDelta(azEl, null); setPstat('noaz', `<b>Not aligned</b>, and no compass reading — the tilt arrow is real; align to get the turn. ${ALIGN}`, bindAlignBtn);
      drawReticle(null, tgt, o, { banner: ['NOT ALIGNED', `No compass reading — the sky around ${o.label}`] }); return;
    }
    setDelta(azEl, guidance(gp, tgt).dAz, 'az', false, true);
    if (gp.src === 'hand') setPstat('guess-hand', `<b>Not aligned</b> — the turn arrow uses the direction you set by hand. ${ALIGN}`, bindAlignBtn);
    else setPstat('guess', `<b>Not aligned</b> — the turn arrow is a rough compass guess. ${ALIGN}`, bindAlignBtn);
    drawReticle(cur, tgt, o); return;
  }
  trackMotion(cur); updateWhere(cur);
  updateWaypoint(o, tgt, cur);
  const g = guidance(cur, tgt), half = tfov() / 2;
  setDelta(azEl, g.dAz, 'az', Math.abs(g.dAz * Math.cos(tgt.alt * D2R)) < half);
  setDelta(altEl, g.dAlt, 'alt', Math.abs(g.dAlt) < half);
  const U = pointingUncertainty(tgt), wide = U != null && U / 60 > half, reach = Math.max(half, U ? U / 60 : 0);
  // On target: inside the eyepiece field (or the phone's uncertainty, if that is wider), with a little hysteresis so it doesn't flicker.
  if (onState.key !== o.key) onState = { key: o.key, on: false, since: 0 };
  const inside = tgt.alt > 0 && g.sep < (onState.on ? reach * 1.15 : reach);
  if (!inside) { onState.on = false; onState.since = 0; }
  else if (!onState.on) {                           // must settle in the field for a moment: sweeping past doesn't count
    if (!onState.since) onState.since = now;
    if (now - onState.since > 500 && !motion.moving) { onState.on = true; cue.onTarget(); if (navigator.vibrate) navigator.vibrate([60, 40, 60]); }
  }
  const loggable = !!$('#b-log') || !!$('#b-logx');
  if (tgt.alt < 0) setPstat('below', `${esc(o.label)} is below the horizon right now.`);
  else if (onState.on) setPstat(`${wide ? 'onwide' : 'on'}:${(state.log || []).length}`, onTargetHTML(o, wide, U, loggable), (el) => el.querySelectorAll('[data-seen]').forEach((b) => b.onclick = () => { logObservation(o, b.dataset.seen); pstatKey = null; if (pushBar) pushBar(); }));
  else { setPstat('far', '<span id="ps-far"></span>'); const f = $('#ps-far'); if (f) { const t = `${fmtDelta(g.sep)} to go`; if (f.textContent !== t) f.textContent = t; } }
  if (sound.mode === 'guide' && !onState.on && tgt.alt > 0) { const iv = tickInterval(g.sep, half); if (iv && now - tickT > iv) { tickT = now; cue.tick(1 - Math.min(1, g.sep / 25)); } }
  const info = $('#pinfo');
  if (info) info.innerHTML = `<span>Target height / direction</span><span>${tgt.alt.toFixed(1)}° / ${tgt.az.toFixed(1)}°</span>
    <span>Scope height / direction</span><span>${cur.alt.toFixed(1)}° / ${cur.az.toFixed(1)}°</span>
    <span>Since last sync</span><span>${lastSyncAge()}</span>
    <span>Sky correction here</span><span>${cur.corr != null ? fmt.am(cur.corr * 60) : skyCorrShort()}</span>
    <span>Pointing uncertainty</span><span>${U == null ? (state.phonePerf ? '—' : 'run the phone check-up') : '±' + fmt.am(U)}</span>`;
  drawReticle(cur, tgt, o);
}
const fmtDelta = (d) => { const a = Math.abs(d); return a >= 10 ? a.toFixed(0) + '°' : a >= 1 ? a.toFixed(1) + '°' : (a * 60).toFixed(0) + '′'; };
function lastSyncAge() { const s = align.syncs[align.syncs.length - 1]; if (!s) return '—'; const m = (Date.now() - s.t) / 60000; return m < 1 ? '<1 min' : m.toFixed(0) + ' min'; }

// Zoom state for the chart: null = automatic, otherwise radius in degrees. Centre on the scope or on the target.
let zoom = null, chartCentre = 'scope';
const ZMIN = 0.25, ZMAX = 60;
let minView = ZMIN, dispView = 0, minViewGuess = false;
// Slew detection from the pointing itself: smoothed angular speed, "moving" above 1.5°/s, "settled" after 0.8 s below 0.4°/s.
const motion = { prev: null, t: 0, v: 0, moving: false, stillSince: 0 };
function trackMotion(cur) {
  const now = performance.now();
  if (!cur || !cur.ready) { motion.prev = null; motion.moving = false; return; }
  if (motion.prev) {
    const dt = Math.max(0.016, (now - motion.t) / 1000), v = sepDeg(motion.prev.alt, motion.prev.az, cur.alt, cur.az) / dt;
    motion.v = motion.v * 0.7 + v * 0.3;
    if (motion.v > 1.5) { motion.moving = true; motion.stillSince = 0; }
    else if (motion.v < 0.4) { if (!motion.stillSince) motion.stillSince = now; if (now - motion.stillSince > 800) motion.moving = false; }
  }
  motion.prev = { alt: cur.alt, az: cur.az }; motion.t = now;
}
// "You're in Cygnus · Northern Cross · near Albireo" — refreshed 4× a second, flashes when the constellation changes.
let whereT = 0, whereCon = null;
function updateWhere(cur) {
  const box = $('#whereami'); if (!box || performance.now() - whereT < 250) return; whereT = performance.now();
  if (!cur || !cur.ready) { box.textContent = ''; return; }
  const eq = altAzToJ2000(sky, cur.alt, cur.az); const con = constellationAt(eq.ra, eq.dec);
  let ast = null, near = null;
  for (const o of sky.objects) {
    if (o.alt == null) continue;
    const d = sepDeg(cur.alt, cur.az, o.alt, o.az);
    if (o.t === 'AS' && o.maj && d <= o.maj / 120 && (!ast || o.maj < ast.maj)) ast = o;
    const named = o.key.startsWith('st:') || o.planet || (o.cats && o.cats.some((c) => /^M\d/.test(c)));
    if (named && d < 3 && (!near || d < near.d)) near = { o, d };
  }
  const parts = [`In <b>${esc(conName(con))}</b>`];
  if (ast) parts.push(esc(ast.label));
  if (near) parts.push(`<a data-near="${esc(near.o.key)}">${near.d < 0.15 ? `on ${esc(near.o.label)}` : `near ${esc(near.o.label)} (${near.d.toFixed(1)}°)`}</a>`);
  const html = parts.join(' · '); if (box.innerHTML !== html) box.innerHTML = html;
  if (con !== whereCon) { if (whereCon) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); } whereCon = con; }
}
function setZoom(z) { zoom = z == null ? null : Math.min(ZMAX, Math.max(minView, z)); }

/**
 * Estimated pointing uncertainty (arcmin, ~1σ) at a target, built only from measured numbers:
 * jitter (Phone check) ⊕ gyro drift × time since last sync ⊕ slew error × distance from the last sync ⊕ alignment fit RMS.
 * Null when there is no Phone check yet or no alignment — then nothing is limited.
 */
function pointingUncertainty(tgt, at = Date.now()) {
  const ph = state.phonePerf; if (!ph) return null;
  if (state.mode === 'compass') return ph.compassNoise == null ? null : Math.hypot(ph.compassNoise, ph.compassSwing || 0);
  const last = align.syncs[align.syncs.length - 1]; if (!last) return null;
  const mins = Math.max(0, (at - last.t) / 60000);
  const rate = Math.abs(model.rate || ph.drift || 0) * 60;              // arcmin per minute (live measurement preferred)
  const dist = last.pos && tgt ? sepDeg(last.pos.alt, last.pos.az, tgt.alt, tgt.az) : 90;
  return Math.hypot(ph.noise || 0, rate * mins, (ph.per90 || 0) * dist / 90, (align.fit ? align.fit.rms * 60 : 0));
}
/** Uncertainty right after a sync, for a 45° push — what an eyepiece can realistically be paired with. */
function baseUncertainty() {
  const ph = state.phonePerf; if (!ph) return null;
  if (state.mode === 'compass') return ph.compassNoise == null ? null : Math.hypot(ph.compassNoise, ph.compassSwing || 0);
  return Math.hypot(ph.noise || 0, (ph.per90 || 0) / 2);
}
function autoRadius(cur, tgt) {
  const half = tfov() / 2;
  if (!cur || chartCentre === 'target') return Math.max(half * 4, 5);
  return Math.min(45, Math.max(half * 3, sepDeg(cur.alt, cur.az, tgt.alt, tgt.az) * 1.3));
}
/** Eyepiece button: each tap moves to the next eyepiece in the cycle (Setup > Eyepieces, "Cycle" ticks) and zooms the chart to its field. */
function cycleEyepiece() {
  const eps = profile().eyepieces;
  const inCycle = eps.map((e, i) => i).filter((i) => eps[i].cycle !== false);
  const ring = inCycle.length ? inCycle : eps.map((e, i) => i);
  const cur = Math.min(state.ep, eps.length - 1);
  const pos = ring.indexOf(cur);
  state.ep = ring[(pos + 1) % ring.length]; save();
  const ep = eyepiece(), want = tfov() * 0.9;
  setZoom(want);
  const b = $('#z-ep'); if (b) b.textContent = ep.name;
  document.querySelectorAll('#ep-chips [data-ep]').forEach((c) => c.classList.toggle('on', +c.dataset.ep === state.ep));
  eyeT = 0;
  toast(`${ep.name} · ${(profile().fl / ep.fl).toFixed(0)}× · ${(tfov(ep) * 60).toFixed(0)}′ field${zoom > want + 1e-6 ? (minViewGuess ? ' — chart stays wide until you align' : ' — chart limited by phone accuracy') : ''}`);
}
function bindChartControls() {
  const cv = $('#reticle'); if (!cv) return;
  const on = (id, f) => { const b = $('#' + id); if (b) b.onclick = f; };
  on('z-in', () => setZoom((zoom ?? cv._lastView) / 1.6));
  on('z-out', () => setZoom((zoom ?? cv._lastView) * 1.6));
  on('z-auto', () => { setZoom(null); toast('Zoom fits the distance to the target'); });
  on('z-hz', () => { state.hzShow = state.hzShow === false; save(); const b = $('#z-hz'); b.classList.toggle('on', state.hzShow); b.textContent = state.hzShow ? 'Blocked sky: shown' : 'Blocked sky: hidden'; toast(state.hzShow ? 'Hatching on: sky hidden from this spot is marked. Targets behind it stay off your suggestions.' : 'Hatching off. Targets behind your blocked sky still stay off your suggestions.', 4500); });
  on('z-lock', () => { state.zoomLock = !state.zoomLock; save(); const b = $('#z-lock'); b.classList.toggle('on', state.zoomLock); b.textContent = state.zoomLock ? 'Zoom locked' : 'Lock zoom'; toast(state.zoomLock ? 'Zoom locked — it won\'t zoom out while you move' : 'Zoom unlocked — zooms out while you move'); });
  on('z-ep', cycleEyepiece);
  on('z-wide', () => setZoom(30));
  on('z-ctr', () => { chartCentre = chartCentre === 'scope' ? 'target' : 'scope'; $('#z-ctr').textContent = chartCentre === 'scope' ? 'Chart follows: scope' : 'Chart follows: target'; });
  if (!targetObj()) $('#whereami').onclick = (e) => { const a = e.target.closest('[data-near]'); if (a) openObject(a.dataset.near); };
  // pinch to zoom
  let d0 = 0, z0 = 0;
  const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  // one finger (or the mouse) steers the chart by hand when the app can't know the direction — see steerMode()
  let last = null;
  const steer = (x, y) => {
    const m = last && steerMode(); if (!m) { last = null; return false; }
    const k = (cv._lastView || 30) / (0.46 * cv.getBoundingClientRect().width);        // degrees per screen pixel
    const dx = (x - last.x) * k, dy = (y - last.y) * k; last = { x, y };
    if (m === 'pan') { hand.alt = Math.max(0, Math.min(89, hand.alt + dy)); hand.az = wrap360(hand.az - dx / Math.max(0.25, Math.cos(hand.alt * D2R))); }
    else { const g = roughPointing(); hand.off = wrap180((hand.off || 0) - dx / Math.max(0.25, Math.cos((g ? g.alt : 0) * D2R))); hand.set = true; }
    return true;
  };
  cv.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { d0 = dist(e); z0 = zoom ?? cv._lastView; last = null; e.preventDefault(); }
    else if (e.touches.length === 1 && steerMode()) last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: false });
  cv.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && d0) { setZoom(z0 * d0 / dist(e)); e.preventDefault(); }
    else if (e.touches.length === 1 && steer(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault();
  }, { passive: false });
  cv.addEventListener('touchend', () => { d0 = 0; last = null; });
  cv.addEventListener('mousedown', (e) => { if (steerMode()) last = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('mousemove', (e) => { if (e.buttons & 1) steer(e.clientX, e.clientY); else last = null; });
  cv.addEventListener('wheel', (e) => { setZoom((zoom ?? cv._lastView) * Math.exp(e.deltaY * 0.002)); e.preventDefault(); }, { passive: false });
}

/** Sky hidden from this spot: a see-through hatched band, so what is behind the trees can still be seen on the chart. */
const raText = (deg) => { const h = ((deg % 360) + 360) % 360 / 15, hh = Math.floor(h), mm = (h - hh) * 60; return `${hh}h ${mm.toFixed(1)}m`; };
const decText = (deg) => { const s = deg < 0 ? '−' : '+', a = Math.abs(deg), d = Math.floor(a), mi = Math.round((a - d) * 60); return `${s}${mi === 60 ? d + 1 : d}° ${String(mi === 60 ? 0 : mi).padStart(2, '0')}′`; };
/** "87° away", "4.2° away": whole degrees until it gets close. */
const degAway = (d) => (d >= 10 ? d.toFixed(0) : d.toFixed(1)) + '°';
function hzFill(c, top, bot, col) {
  const path = () => { c.beginPath(); c.moveTo(top[0].x, top[0].y); for (const p of top) c.lineTo(p.x, p.y); for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i].x, bot[i].y); c.closePath(); };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of top.concat(bot)) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const W = c.canvas.width, H = c.canvas.height; x0 = Math.max(-20, x0); y0 = Math.max(-20, y0); x1 = Math.min(W + 20, x1); y1 = Math.min(H + 20, y1);
  c.save(); path(); c.clip();
  c.fillStyle = col(150, 80, 50, 0.09); c.fillRect(x0, y0, x1 - x0, y1 - y0);
  const gap = Math.max(14, W / 50), h = y1 - y0;
  c.beginPath(); for (let x = x0 - h; x <= x1; x += gap) { c.moveTo(x, y1); c.lineTo(x + h, y0); }
  c.strokeStyle = col(175, 95, 60, 0.46); c.lineWidth = Math.max(1.5, W / 420); c.stroke();
  c.restore();
  c.beginPath(); c.moveTo(top[0].x, top[0].y); for (const p of top) c.lineTo(p.x, p.y); c.strokeStyle = col(175, 95, 60, 0.75); c.lineWidth = 2; c.stroke();
}
function drawReticle(cur, tgt, o, opt = {}) {
  const cv = opt.canvas || $('#reticle'); if (!cv) return; const c = cv.getContext('2d'); const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, Rpx = W * 0.46;
  const k = vis(); const col = (r, g = 0, b = 0, a = 1) => tint(r, g, b, a, k);
  c.clearRect(0, 0, W, H);
  let guess = false, src = null;
  // No azimuth yet: a best guess. The Push chart falls back on a hand-set direction; the other charts only trust a compass.
  if (cur && !cur.ready) { const gp = opt.canvas ? guessPointing() : roughPointing(); if (gp) { cur = gp; guess = true; src = gp.src; } else cur = null; }
  const centre = opt.centre === 'target' || chartCentre === 'target' || !cur ? tgt : cur;     // nothing known about the scope: the sky around the target
  const half = tfov() / 2;
  const U = guess ? (src === 'compass' ? guessUncertainty() : null) : cur ? pointingUncertainty(tgt) : null;   // arcmin
  minViewGuess = !!guess;
  minView = guess ? Math.max(5, U ? 3 * U / 60 : 0) : U ? Math.max(ZMIN, Math.min(ZMAX, 3 * U / 60)) : ZMIN;   // a guess never zooms in past 5°     // never zoom tighter than ~3× what the phone can know
  let view = opt.view ?? zoom ?? (!cur && !opt.canvas ? 25 : autoRadius(cur, tgt)); let limited = !opt.view && view < minView; if (limited) view = minView;
  if (!opt.view) {                                                   // zoom out while slewing (unless locked), ease back when settled
    if (motion.moving && !state.zoomLock) { view = Math.max(view, Math.min(50, Math.max(20, motion.v * 8))); limited = false; }
    dispView = dispView ? Math.exp(Math.log(dispView) + (Math.log(view) - Math.log(dispView)) * 0.18) : view;
    if (Math.abs(Math.log(dispView / view)) < 0.01) dispView = view;
    view = dispView;
  }
  cv._lastView = view; const s = Rpx / view; // px per degree
  const proj = (p) => { const t = tangentOffset(centre, p); if (!t) return null; return { x: cx + t.x * s, y: cy - t.y * s, r: Math.hypot(t.x, t.y) }; };
  c.save(); c.beginPath(); c.arc(cx, cy, Rpx + 2, 0, 7); c.clip();

  // horizon
  c.strokeStyle = col(110, 25, 0); c.lineWidth = 2; c.setLineDash([10, 8]); c.beginPath(); let pen = false;
  for (let d = -Math.min(179, view * 2.5); d <= Math.min(179, view * 2.5); d += Math.max(0.05, view / 40)) {
    const q = proj({ alt: 0, az: wrap360(centre.az + d) }); if (!q || q.r > view * 1.6) { pen = false; continue; }
    if (pen) c.lineTo(q.x, q.y); else { c.moveTo(q.x, q.y); pen = true; }
  }
  c.stroke(); c.setLineDash([]);
  // blocked sky (trees, roofs) as marked by the observer
  const HZ = state.hzShow === false ? null : horizonNow();
  if (HZ) {
    const top = [], bot = [], span = Math.min(179, view * 2.5), stepD = Math.max(0.5, view / 30);
    for (let d = -span; d <= span; d += stepD) {
      const az = wrap360(centre.az + d), lim = Math.min(88, limitAt(HZ, az));
      const a = proj({ alt: lim, az }), b = proj({ alt: 0, az });
      if (!a || !b || (a.r > view * 2.2 && b.r > view * 2.2)) { if (top.length > 1) hzFill(c, top, bot, col); top.length = 0; bot.length = 0; continue; }
      top.push(a); bot.push(b);
    }
    if (top.length > 1) hzFill(c, top, bot, col);
  }

  // star field + constellation figures
  const magLim = view <= 2 ? 8 : Math.max(4, 8 - 3.06 * Math.log10(view / 2)); // ~8 at eyepiece/finder scale, ~4.4 at 30°
  const field = sky.fieldNear(centre.alt, centre.az, view * 1.5, magLim);
  const P = new Map(); for (const [i, v] of field) { const q = proj(v); if (q) P.set(i, { ...q, mag: v.mag }); }
  if (view > 4) {
    c.strokeStyle = col(85, 10, 0); c.lineWidth = 2; c.beginPath();
    const cen = {};
    for (const [con, seg] of LINES) for (let j = 0; j < seg.length; j += 2) {
      const a = P.get(seg[j]), b = P.get(seg[j + 1]); if (!a || !b) continue;
      c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      if (a.r < view) { (cen[con] ||= [0, 0, 0]); cen[con][0] += a.x; cen[con][1] += a.y; cen[con][2]++; }
    }
    c.stroke();
    if (view > 8) { c.fillStyle = col(120, 20, 0); c.font = 'italic 22px system-ui'; c.textAlign = 'center';
      for (const [con, [x, y, n]] of Object.entries(cen)) if (n >= 2) c.fillText(con, x / n, y / n + 30); }
  }
  for (const [, q] of P) {
    if (q.mag > magLim) continue;
    const r = Math.max(1.6, (magLim + 1.2 - q.mag) * 2.1);
    c.fillStyle = col(Math.min(255, 140 + (magLim - q.mag) * 25), 20, 10); c.beginPath(); c.arc(q.x, q.y, r, 0, 7); c.fill();
  }

  // catalog objects, asterisms, named stars
  c.font = '20px system-ui'; c.textAlign = 'left';
  for (const n of sky.objects) {
    if (n === o || n.alt == null || n.alt < -2 || Math.abs(n.alt - centre.alt) > view * 1.2) continue;
    const q = proj(n); if (!q || q.r > view) continue;
    const star = n.key.startsWith('st:'), aster = n.t === 'AS';
    if (star && n.mag != null && n.mag <= magLim) {                    // named stars in their own colour (toward Day; red at Night)
      const sc = starTint(STAR_CLASS[n.id], 1, k);
      if (sc) { c.fillStyle = sc; c.beginPath(); c.arc(q.x, q.y, Math.max(1.6, (magLim + 1.2 - n.mag) * 2.1) + 0.6, 0, 7); c.fill(); }
    }
    if (aster) {
      const rr = n.maj ? Math.max(8, n.maj / 120 * s) : 10;
      if (rr > Rpx * 1.5 || rr < 6 || view > 20) continue;
      c.strokeStyle = col(150, 40, 0); c.lineWidth = 2; c.setLineDash([6, 6]); c.beginPath(); c.arc(q.x, q.y, rr, 0, 7); c.stroke(); c.setLineDash([]);
      c.fillStyle = col(170, 50, 10); c.fillText(n.label, q.x + Math.min(rr, 40) + 4, q.y - 4); continue;
    }
    if (!star && !n.planet && view > 25 && !(n.cats && n.cats.some((x) => /^M\d/.test(x)))) continue;
    if (!star && !n.planet) { c.strokeStyle = col(160, 20, 0); c.lineWidth = 2; const rr = n.maj ? Math.max(5, n.maj / 120 * s) : 5; c.beginPath(); c.arc(q.x, q.y, rr, 0, 7); c.stroke(); }
    if (n.planet) { c.fillStyle = col(255, 90, 40); c.beginPath(); c.arc(q.x, q.y, 7, 0, 7); c.fill(); }
    const show = (star && (view < 30 || (n.mag ?? 9) < 1.5)) || n.planet || view < 12 || (view < 30 && n.cats && n.cats.some((x) => /^M\d/.test(x)));
    if (show) { c.fillStyle = col(star || n.planet ? 210 : 150, 30, 10); c.fillText(n.label, q.x + 9, q.y - 7); }
  }
  let sunNote = null;                                // its warning is drawn last, on top of the scope marker
  // The Sun: big and impossible to miss whenever it is above the horizon, with the one rule that matters.
  try {
    const sunP = sky.sunAltAz(), sq = sunP.alt > -1 ? proj(sunP) : null;
    if (sq && sq.r < view * 1.5) {
      const R0 = Math.max(46, 0.27 * s), g = c.createRadialGradient(sq.x, sq.y, R0 * 0.5, sq.x, sq.y, R0 * 2.6);
      g.addColorStop(0, col(255, 200, 90, 0.55)); g.addColorStop(1, col(255, 200, 90, 0));
      c.fillStyle = g; c.beginPath(); c.arc(sq.x, sq.y, R0 * 2.6, 0, 7); c.fill();
      c.strokeStyle = col(255, 210, 100); c.lineWidth = 5; c.lineCap = 'round'; c.beginPath();
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; c.moveTo(sq.x + Math.cos(a) * R0 * 1.25, sq.y + Math.sin(a) * R0 * 1.25); c.lineTo(sq.x + Math.cos(a) * R0 * 1.6, sq.y + Math.sin(a) * R0 * 1.6); }
      c.stroke(); c.lineCap = 'butt';
      c.fillStyle = col(255, 215, 110); c.beginPath(); c.arc(sq.x, sq.y, R0, 0, 7); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.85)'; c.textAlign = 'center'; c.font = 'bold 30px system-ui'; c.fillText('SUN', sq.x, sq.y + 11);
      sunNote = () => { c.textAlign = 'center'; c.font = 'bold 22px system-ui'; const wl = ['Never point here unless you have', 'secured a solar filter to the scope'], ww = Math.max(...wl.map((t) => c.measureText(t).width)), wy = sq.y + R0 * 1.6 + 8;
      const wx = Math.max(ww / 2 + 14, Math.min(W - ww / 2 - 14, sq.x));                 // keep the warning on the chart when the Sun is near the edge
      c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(wx - ww / 2 - 8, wy, ww + 16, 58);
      c.fillStyle = col(255, 215, 110); wl.forEach((t, i) => c.fillText(t, wx, wy + 23 + i * 26)); c.textAlign = 'left'; };
      c.textAlign = 'left';
    }
  } catch (e) { /* no site yet */ }
  c.restore();

  // frame, scale, eyepiece field (centred on the scope), scope marker when centred on target
  c.strokeStyle = col(70); c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, Rpx, 0, 7); c.stroke();
  c.fillStyle = col(130); c.font = '24px system-ui'; c.textAlign = 'left';
  c.fillText(`${view >= 2 ? view.toFixed(view < 10 ? 1 : 0) + '°' : (view * 60).toFixed(0) + '′'} radius · stars to mag ${magLim.toFixed(1)}${zoom == null ? ' · auto' : ''}`, 12, 30);
  if (limited && !guess) { c.fillStyle = col(200, 40, 15); c.fillText(`Zoom limited by phone accuracy (±${fmt.am(U)})`, 12, H - 16); }
  // Unmistakable label whenever the chart is not showing a known pointing: a best guess, or no pointing at all.
  const banner = opt.noBanner ? null : guess ? ['NOT ALIGNED — BEST GUESS MODE',
    src === 'hand' ? 'Direction set by hand — no compass reading' : src === 'assumed' ? 'No compass reading — assuming you started out facing south'
      : U ? `Direction from the phone's compass (measured ±${fmt.am(U)})` : 'Direction is a rough compass guess'] : opt.banner || null;
  if (banner) {
    const fit = (txt, px, weight = '') => { c.font = `${weight} ${px}px system-ui`; const w = c.measureText(txt).width; if (w > W - 40) c.font = `${weight} ${Math.floor(px * (W - 40) / w)}px system-ui`; };
    c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(0, 44, W, 74);
    c.fillStyle = col(255, 70, 30); c.textAlign = 'center'; fit(banner[0], 34, 'bold'); c.fillText(banner[0], cx, 82);
    const sub = banner[1];
    c.fillStyle = col(200, 40, 15); fit(sub, 21); c.fillText(sub, cx, 108);
    c.textAlign = 'left'; c.font = '24px system-ui';
  }
  const scope = cur ? proj(cur) : null;
  if (scope && guess) { c.setLineDash([4, 10]); }
  if (scope && U) { c.strokeStyle = col(200, 40, 15); c.lineWidth = 2; c.setLineDash([8, 8]); c.beginPath(); c.arc(scope.x, scope.y, U / 60 * s, 0, 7); c.stroke(); c.setLineDash([]); }
  if (scope) {
    c.strokeStyle = col(230, 50, 25); c.lineWidth = 3; if (guess) c.setLineDash([10, 8]); c.beginPath(); c.arc(scope.x, scope.y, Math.max(5, half * s), 0, 7); c.stroke(); c.setLineDash([]);
    if (guess) { c.fillStyle = col(230, 50, 25); c.font = 'bold 22px system-ui'; c.textAlign = 'center'; c.fillText(opt.noBanner ? 'Best guess (compass)' : 'Best guess', scope.x, scope.y + Math.max(28, half * s + 26)); c.textAlign = 'left'; }
    const L = Math.max(14, half * s * 0.35); c.beginPath(); c.moveTo(scope.x - L, scope.y); c.lineTo(scope.x + L, scope.y); c.moveTo(scope.x, scope.y - L); c.lineTo(scope.x, scope.y + L); c.stroke();
  }

  if (sunNote) sunNote();
  if (opt.noTarget) return;
  // target
  const tq = proj(tgt); let x, y, inside = !!tq && tq.r <= view;
  if (inside) { x = tq.x; y = tq.y; }
  else { const g = guidance(centre, tgt); const ang = Math.atan2(g.dAlt, g.dAz * Math.cos(centre.alt * D2R)); x = cx + Math.cos(ang) * Rpx; y = cy - Math.sin(ang) * Rpx; }
  c.strokeStyle = col(255, 60, 30); c.fillStyle = col(255, 60, 30); c.lineWidth = 4;
  const sz = o.maj ? Math.max(10, (o.maj / 60) * s / 2) : 12;
  if (inside) { c.beginPath(); c.arc(x, y, sz, 0, 7); c.stroke(); }
  else { const a = Math.atan2(cy - y, x - cx); c.save(); c.translate(x, y); c.rotate(-a); c.beginPath(); c.moveTo(0, 0); c.lineTo(-30, -16); c.lineTo(-30, 16); c.closePath(); c.fill(); c.restore(); }
  c.font = 'bold 26px system-ui';
  if (inside) { c.textAlign = 'left'; c.fillText(o.label, Math.min(x + sz + 12, W - c.measureText(o.label).width - 8), y + 8); }
  else { c.textAlign = 'center'; const hw = c.measureText(o.label).width / 2 + 8; c.fillText(o.label, Math.min(W - hw, Math.max(hw, x)), y > cy ? y - 30 : y + 44); }
}

// ---------------------------------------------------------------- ALIGN + SYNC
function makeObs(o) {
  const R = o.R || avgR(1.0); if (!R) return null; const truth = o.fix || sky.altAz(o);      // a camera fix brings its own position
  return { key: o.key, label: o.label, R, alt: truth.alt, az: truth.az, t: Date.now(), ep: align.epoch || 0 };
}
function refit() {
  const c = profile().cal;
  const prior = c ? { p: c.p, q: c.q } : { p: 0, q: 0 };
  if (!align.obs.length) { align.fit = null; return; }
  const solveAxis = align.obs.length >= 2 && state.calibrate;
  align.fit = fitAlignment(align.obs, model.d0, prior, { thetaOnly: !solveAxis, priorWeight: c ? 0.05 : 0.002 });
  model.theta = align.fit.theta; model.p = align.fit.p; model.q = align.fit.q; model.t0 = Date.now(); align.suspect = false;
  const lo = align.obs[align.obs.length - 1];
  align.syncs.push({ t: Date.now(), theta: model.theta, kind: 'align', pos: { alt: lo.alt, az: lo.az }, ep: align.epoch || 0 });
}
let syncArm = { key: null, until: 0 };
/** Take back the last Sync: heading, drift estimate and what it taught the sky correction. */
function undoSync() {
  const u = align.undo; if (!u) return false;
  model.theta = u.theta; model.t0 = u.t0; model.rate = u.rate; align.fit = u.fit; align.syncs.length = u.nS; align.confirm.length = u.nC; align.undo = null;
  toast(`Sync on ${u.label} undone`); return true;
}
function doSync(o) {
  const ob = makeObs(o); if (!ob) return toast('No sensor data');
  if (state.mode === 'compass') {
    const co = sensors.compassOffset(); if (co == null) return toast('No compass reading');
    const raw = altAzFromVec(mulMV(ob.R, model.axis()));
    state.compassCorr = wrap180(ob.az - raw.az - co); save(); return toast(`Compass correction set to ${state.compassCorr.toFixed(2)}°`);
  }
  // Guard against a stray tap. Height comes from gravity and does not drift, so if the scope's tilt is nowhere near the
  // object's height it cannot be centred, whatever the heading says. That one is refused outright.
  const here = pointing(), meas = here ? here.alt : altAzFromVec(mulMV(ob.R, model.axis())).alt;
  const dAlt = meas - ob.alt, altTol = align.fit ? 4 : 10;
  if (Math.abs(dAlt) > altTol) { cue.miss(); toast(o.fix ? `Not synced. The camera puts the scope ${Math.abs(dAlt).toFixed(0)}° ${dAlt > 0 ? 'lower' : 'higher'} than the tilt sensor does. Check the phone is set to “Looking along” and has not slipped. Nothing was changed.` : `Not synced. The scope is tilted ${Math.abs(dAlt).toFixed(0)}° ${dAlt > 0 ? 'above' : 'below'} ${o.label}, so it can't be centred on it. Nothing was changed.`, 6000); return false; }
  const f = fitAlignment([ob], model.d0, { p: model.p, q: model.q }, { thetaOnly: true });
  const prev = align.syncs[align.syncs.length - 1];
  const seenBefore = skyTable() ? pointing() : null;       // with sky correction on, report the error of what the arrows actually showed
  const before = align.fit ? (seenBefore && seenBefore.ready ? wrap180(ob.az - seenBefore.az) : wrap180(f.theta - model.thetaAt())) : null;
  // A big sideways correction can be real (the heading jumps if the app was put away), so that one asks for a second tap.
  const swing = before == null ? 0 : Math.abs(before) * Math.cos(ob.alt * D2R);
  if (swing > 15 && !o.fix && !align.suspect && !(syncArm.key === o.key && Date.now() < syncArm.until)) {
    syncArm = { key: o.key, until: Date.now() + 8000 }; cue.miss();
    toast(`That would swing the pointing by ${swing.toFixed(0)}°. If ${o.label} really is centred, tap again. If it was a slip, do nothing.`, 7000); return false;
  }
  syncArm = { key: null, until: 0 };
  align.undo = { theta: model.theta, t0: model.t0, rate: model.rate, fit: align.fit, nS: align.syncs.length, nC: align.confirm.length, label: o.label, t: Date.now() };
  model.theta = f.theta; model.t0 = Date.now(); align.suspect = false; cue.sync();
  if (!align.fit) align.fit = { theta: f.theta, p: model.p, q: model.q, rms: f.rms, resid: [f.rms], solvedAxis: false };
  // Drift is only measured between two syncs with no interruption in between (a heading jump is not drift).
  if (prev && (prev.ep || 0) === (align.epoch || 0) && Date.now() - prev.t > 120000) { model.rate = wrap180(f.theta - prev.theta) / ((Date.now() - prev.t) / 60000); }
  align.syncs.push({ t: Date.now(), theta: f.theta, kind: 'sync', key: o.key, correction: before, pos: { alt: ob.alt, az: ob.az }, ep: align.epoch || 0 });
  align.confirm.push({ ...ob, kind: 'sync' });
  const msg = before == null ? `Synced on ${o.label}` : (Math.abs(before) * 60 < 0.5 ? `Synced on ${o.label}: alignment still spot on` : `Synced on ${o.label}: corrected ${Math.abs(before) < 1 ? Math.abs(before * 60).toFixed(0) + '′' : Math.abs(before).toFixed(2) + '°'}`);
  if (state.waypoint && state.waypoint.via === o.key) {
    const then = sky.objects.find((x) => x.key === state.waypoint.then); state.waypoint = null;
    if (then) { state.target = then.key; save(); const U = pointingUncertainty(sky.altAz(then)); toast(`${msg}. Now push to ${then.label}${U ? ` — estimated error ±${fmt.am(U)}` : ''}`, 4500); renderPush(); return true; }
  }
  toast(msg); return true;
}
const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
let assist = { skip: new Set(), pending: null };
function alignCands() {
  return sky.objects.filter((o) => (o.key.startsWith('st:') || (o.planet && o.id !== 'Moon')) && o.alt > 15 && o.alt < 80 && (o.mag ?? 9) < 2.6);
}
function alignNeeded() { return profile().cal || !state.calibrate ? 1 : 2; }
function suggestedStar() {
  const first = align.obs.length ? sky.objects.find((x) => x.key === align.obs[0].key) : null;
  const L = pickStars(alignCands().filter((s) => !assist.skip.has(s.key) && !align.obs.some((o) => o.key === s.key)), first && { ...first, alt: first.alt, az: first.az });
  return L[0] || pickStars(alignCands().filter((s) => !align.obs.some((o) => o.key === s.key)))[0] || null;
}
function starHelp(s) {
  let brighter = null;
  if (!s.planet) { brighter = 0; for (const [, v] of sky.fieldNear(s.alt, s.az, 20, s.mag ?? 2)) if (v.mag < (s.mag ?? 2) - 0.05) brighter++; }
  return recogniseWords(s, sky.stars, brighter);
}
function renderAlign() {
  refreshSky(true);
  const el = $('#tab-align'); const c = profile().cal; const f = align.fit;
  const need = alignNeeded(), done = align.obs.length;
  const s = done < need ? suggestedStar() : null;
  let assistHTML;
  if (assist.pending) {
    assistHTML = `<div class="card verdict v-poor"><div class="vbig" style="font-size:22px">Is that ${esc(assist.pending.ob.label)}?</div><p>${esc(assist.pending.msg)}</p>
      <div class="btnrow"><button id="a-retry" class="primary">Try again</button><button id="a-force">It is — use it</button></div></div>`;
  } else if (s) {
    assistHTML = `<div class="muted small">Step ${done + 1} of ${need}${need === 2 && done === 0 ? ' · two stars teach the app how the phone sits on the tube' : ''}</div>
      <div class="target-h" style="margin:2px 0"><span class="name">${esc(s.label)}</span><span class="muted">${s.planet ? 'a planet' : 'a bright star'}</span></div>
      <p style="margin:2px 0">${esc(cap1(starHelp(s)))}. Look ${esc(whereWords(s.alt, s.az))}.</p>
      <p class="infield" id="a-live"></p>
      <canvas id="a-chart" class="chart" width="600" height="600"></canvas>
      <p class="muted small">Get it in the red-dot finder first, then centre it in the eyepiece and tap <b>It's centred</b>. Not sure it's the right star? Tap <b>Different star</b>.</p>`;
  } else if (done >= need) {
    assistHTML = `<div class="card"><b>✓ Aligned on ${align.obs.map((o) => esc(o.label)).join(' and ')}.</b>
      ${f.solvedAxis && !c ? '<div class="btnrow"><button id="savecal2">Remember how the phone sits — next time one star is enough</button></div>' : ''}<p class="muted small">Tap Sync on anything you centre to keep it accurate. Before a long push, the app suggests a star to check on the way.</p>
      <div class="btnrow"><button id="a-find" class="primary">Pick a target</button></div></div>`;
  } else assistHTML = '<p class="muted">No bright stars above 15° right now.</p>';
  el.innerHTML = `${BACK}
    <h2>Star alignment</h2>
    ${state.mounting === 'camera' && state.mode !== 'compass' ? '<div class="card"><b>Your phone looks along the tube</b><p class="muted small" style="margin:4px 0 8px">The camera can do this for you: no star to find or centre.</p><button id="a-cam" class="primary">Align with the camera</button></div>' : ''}
    ${state.mode === 'compass' ? `<p class="muted">Compass mode is on: azimuth comes from the magnetometer. Star alignment below uses the gyro instead and is usually more accurate — switch in Setup.</p>` : ''}
    ${assistHTML}
    <details class="more" id="a-tools" ${state.alignTools ? 'open' : ''}><summary>Details and tools</summary>
    ${done ? `<p class="muted small">How well each star fits the alignment${f ? ` (overall ${fmt.am(f.rms * 60)}; ′ is a sixtieth of a degree)` : ''}. Tap ✕ to drop one.</p><table class="res"><tr><th>Star</th><th>Height</th><th>Off by</th><th></th></tr>${align.obs.map((o, i) => `<tr><td>${esc(o.label)}</td><td>${o.alt.toFixed(0)}°</td><td>${f ? fmt.am(f.resid[i] * 60) : ''}</td><td><button data-del="${i}">✕</button></td></tr>`).join('')}</table>` : ''}
    ${align.confirm.length ? `<div class="card"><h3 style="margin-top:0">Sky consistency</h3>
      <canvas id="dome" width="700" height="720" style="width:100%;max-width:360px;display:block;margin:0 auto;background:var(--chart);border-radius:10px"></canvas>
      <div class="chips" style="justify-content:center">${[1, 10, 30].map((m) => `<button data-mag="${m}" class="${domeMag === m ? 'on' : ''}">errors ×${m}</button>`).join('')}<button id="dome-red" class="${state.domeRed ? 'on' : ''}">Red only</button></div>
      <div id="dome-info"></div></div>` : ''}
    <div class="btnrow"><button id="clr">Start over</button><button id="unsync" ${align.undo ? '' : 'disabled'}>${align.undo ? `Undo sync on ${esc(align.undo.label)}` : 'Undo last sync'}</button><button id="savecal" ${f && f.solvedAxis ? '' : 'disabled'}>Save tilt to ${esc(profile().name)}</button></div>
    <details class="more"><summary>Alignment details</summary>
    <div class="card kv">
      <span>Saved mount tilt</span><span>${c ? `${Math.hypot(c.p, c.q).toFixed(2)}° · ${c.n} stars` : 'none yet'}</span>
      <span>Since last sync</span><span>${lastSyncAge()}</span>
      <span>Measured gyro drift</span><span>${model.rate ? fmt.rate(model.rate) : 'needs 2 syncs ≥2 min apart'}</span>
    </div>
    <label class="row"><span>Work out how the phone sits on the tube (needs 2+ stars)</span><input type="checkbox" id="cal" ${state.calibrate ? 'checked' : ''}></label>
    </details>
    <details class="more"><summary>Choose any star yourself</summary>
    <ul class="list">${alignCands().sort((a, b) => (a.mag ?? 9) - (b.mag ?? 9)).map((o) => `<li data-k="${esc(o.key)}"><div class="main"><div class="t1">${esc(o.label)}</div><div class="t2">${esc(o.sub || '')}</div></div><div class="r num">mag ${(+o.mag).toFixed(1)}</div><div class="r num" style="min-width:64px">${o.alt.toFixed(0)}° ${compassName(o.az)}</div></li>`).join('')}</ul></details>
    </details>
    ${s && !assist.pending ? '<div class="actionbar"><button id="a-ok" class="primary wide">It\'s centred</button><button id="a-skip">Different star</button></div>' : ''}`;
  bindBack(el);
  $('#a-tools').ontoggle = (e) => { state.alignTools = e.target.open; save(); };
  if ($('#a-find')) $('#a-find').onclick = () => showTab('find');
  if ($('#a-cam')) $('#a-cam').onclick = () => showTab('camera');
  const addStar = (o, force) => {
    const ob = makeObs(o); if (!ob) return toast('No sensor data yet');
    if (!force) {
      const raw = altAzFromVec(mulMV(ob.R, model.axis()));
      const ca = checkAltitude(raw.alt, ob.alt, c ? 2.5 : 3.5);
      if (!ca.ok) { assist.pending = { ob, o, msg: `The scope is at ${raw.alt.toFixed(0)}° altitude, but ${o.label} is at ${ob.alt.toFixed(0)}° right now — ${Math.abs(ca.diff).toFixed(0)}° ${ca.diff < 0 ? 'lower' : 'higher'} than expected. It may be a different star.` }; return renderAlign(); }
      if (align.obs.length) {
        const p0 = align.obs[0], r0 = altAzFromVec(mulMV(p0.R, model.axis()));
        const cp = checkPair(r0, raw, { alt: p0.alt, az: p0.az }, { alt: ob.alt, az: ob.az });
        if (!cp.ok) { assist.pending = { ob, o, msg: `The scope moved ${cp.measured.toFixed(0)}° from ${p0.label}, but ${o.label} is ${cp.expected.toFixed(0)}° from it. One of the two may be the wrong star.` }; return renderAlign(); }
      }
    }
    assist.pending = null; align.obs.push(ob); align.confirm.push({ ...ob, kind: 'align' }); refit();
    if (align.obs.length === alignNeeded()) {
      cue.onTarget(); toast(`Aligned on ${align.obs.map((x) => x.label).join(' and ')}`, 3000);
      if (!flowStepDone('align')) showTab(state.target ? 'push' : 'find');
      return;
    }
    toast(`Added ${o.label}`); renderAlign();
  };
  if ($('#a-ok')) $('#a-ok').onclick = () => addStar(s);
  if ($('#a-skip')) $('#a-skip').onclick = () => { assist.skip.add(s.key); renderAlign(); };
  if ($('#a-retry')) $('#a-retry').onclick = () => { assist.pending = null; renderAlign(); };
  if ($('#a-force')) $('#a-force').onclick = () => { const p = assist.pending; addStar(p.o, true); };
  $('#cal').onchange = (e) => { state.calibrate = e.target.checked; save(); refit(); renderAlign(); };
  $('#unsync').onclick = () => { if (undoSync()) renderAlign(); };
  $('#clr').onclick = () => { align = { obs: [], fit: null, syncs: [], confirm: [] }; model.rate = 0; assist = { skip: new Set(), pending: null }; renderAlign(); };
  const saveTilt = () => { profile().cal = { p: model.p, q: model.q, n: align.obs.length, rms: f.rms, date: Date.now() }; save(); toast('Saved. Next session, one star is enough.'); renderAlign(); };
  $('#savecal').onclick = saveTilt; if ($('#savecal2')) $('#savecal2').onclick = saveTilt;
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); align.obs.splice(+b.dataset.del, 1); refit(); renderAlign(); });
  el.querySelectorAll('li[data-k]').forEach((li) => li.onclick = () => addStar(sky.objects.find((x) => x.key === li.dataset.k)));
  el.querySelectorAll('[data-mag]').forEach((b) => b.onclick = () => { domeMag = +b.dataset.mag; renderAlign(); });
  if ($('#dome-red')) $('#dome-red').onclick = () => { state.domeRed = !state.domeRed; save(); renderAlign(); };
  renderDome();
  updateAlign();
}
let domeMag = 10;
/** Where sky correction stands, in a sentence (dome card) and in a word or two (Push > Numbers). */
function skyCorrText() {
  if (state.skyCorr === false) return 'Off. The arrows use only your last Sync and the phone tilt found at alignment.';
  const T = skyTableAll(), n = align.confirm.length, ck = T && T.check;
  if (!T) return n < 3 ? `Learning. It needs 6 confirmed objects that agree with each other — you have ${n}. Every Sync adds one; spread them around the sky.`
    : 'Waiting. The confirmed objects disagree with each other too much to learn from — see below.';
  const left = T.dropped ? `, ${T.dropped} left out because ${T.dropped === 1 ? 'it disagrees' : 'they disagree'} with the rest` : '';
  if (ck.short) return `Learning. It needs 6 confirmed objects that agree with each other — you have ${T.n}${left}. Every Sync adds one; spread them around the sky.`;
  if (ck.n < 2) return 'Learning. It needs another Sync or two before it can check itself.';
  const trial = `Replayed over your last ${ck.n} objects, the miss on arrival goes from ${fmt.am(ck.raw)} to ${fmt.am(ck.fixed)}`;
  if (!ck.helps) return `Standing by. ${trial} — no clear gain, so the arrows are left alone.`;
  const cur = pointing();
  return `In use. ${trial}. ${T.n} objects in the table${left}${cur && cur.corr != null ? `; where the scope points now the arrows are shifted by ${fmt.am(cur.corr * 60)}` : ''}.`;
}
function skyCorrShort() {
  if (state.skyCorr === false) return 'off';
  const T = skyTableAll(); if (!T) return align.confirm.length < 3 ? 'learning (needs 6 Syncs)' : 'waiting';
  return T.check.short ? `learning (${T.n} of 6)` : T.check.n < 2 ? 'learning' : T.check.helps ? '—' : 'standing by';
}
function renderDome() {
  const cv = $('#dome'); if (!cv) return;
  const P = align.confirm, r = tfov() * 60 / 2;
  const c = profile().cal, prior = c ? { p: c.p, q: c.q } : { p: model.p, q: model.q };
  // Heading jumps (the app was in the background, the phone was knocked) get their own offset, as in the correction.
  const eps = splitJumps(P, model.d0, prior, { calibrate: state.calibrate, r });
  const fit = fitConsistency(P, model.d0, prior, { calibrate: state.calibrate, epochs: eps });
  const pc = fit ? pairConsistency(P, model.d0, fit.p, fit.q, eps) : { pairs: [], worst: null };
  const out = outliers(fit, r); const v = domeVerdict(fit, pc, r);
  drawDome(cv, P, fit, { mag: domeMag, bright: vis(), outliers: out, r, redOnly: !!state.domeRed });
  const box = $('#dome-info');
  box.innerHTML = `<label class="row"><span>Sky correction <span class="muted small">— learn from every Sync</span></span><input type="checkbox" id="dome-corr" ${state.skyCorr === false ? '' : 'checked'}></label>
    <p class="small" style="margin:4px 0 8px">${skyCorrText()}</p>
    <p class="${v.level === 'bad' ? 'bad' : ''}" style="margin:6px 0">${esc(v.text)}</p>
    <div class="kv small"><span>Confirmed objects</span><span>${P.length}</span>
      <span>Leftover error (RMS / worst)</span><span>${fit && P.length > 1 ? `${fmt.am(fit.rms)} / ${fmt.am(fit.max)}` : '—'}</span>
      <span>Worst pair-distance mismatch</span><span>${pc.worst != null ? fmt.am(pc.worst) : '—'}</span>
      <span>Removed as expected</span><span>${fit ? `offset${fit.epochs > 1 ? `, ${fit.epochs - 1} heading jump${fit.epochs > 2 ? 's' : ''}` : ''}${fit.useAxis ? ', phone tilt' : ''}${fit.useRate ? `, drift ${fmt.rate(fit.rate)}` : ''}` : '—'}</span></div>
    ${out.map((i) => `<p class="small"><b>${esc(P[i].label)}</b> disagrees with the others by ${fmt.am(fit.resid[i].err)} — probably the wrong star or a bumped scope. <button data-drop="${i}">Remove it</button></p>`).join('')}
    <p class="muted small">Looking up: north at top, east on the left. White is the true sky; the coloured mesh is how the sensors see it after removing the offset, phone tilt and drift — green perfect, blue good, yellow fair, red poor (compared with your eyepiece field). Dots are confirmed objects, arrows point to where the sensors put them. With Sky correction in use, the arrows on the Observe screen are shifted to cancel this map. Colours cost some night vision; use Red only at the eyepiece.</p>`;
  $('#dome-corr').onchange = (e) => { state.skyCorr = e.target.checked; save(); renderDome(); toast(state.skyCorr ? 'Sky correction on' : 'Sky correction off'); };
  box.querySelectorAll('[data-drop]').forEach((b) => b.onclick = () => {
    const pt = P[+b.dataset.drop]; align.confirm.splice(+b.dataset.drop, 1);
    const k = align.obs.findIndex((o) => o.t === pt.t && o.key === pt.key); if (k >= 0) { align.obs.splice(k, 1); refit(); }
    renderAlign();
  });
}
function updateAlign() {
  const live = $('#a-live'); if (!live) return;
  const s = suggestedStar(); if (!s) return;
  const tgt = sky.altAz(s); const cur = pointing();
  if (!cur) { live.textContent = 'Waiting for sensors…'; }
  else if (!cur.ready) {               // altitude is known before alignment
    const d = tgt.alt - cur.alt;
    const gp = guessPointing(), gd = gp ? guidance(gp, tgt) : null;
    const azTxt = gd ? (Math.abs(gd.dAz) < 3 ? 'direction looks about right (compass guess)' : `swing ≈${Math.abs(gd.dAz).toFixed(0)}° ${gd.dAz > 0 ? 'right' : 'left'} (compass guess)`) : `swing to the ${compassName(tgt.az)}`;
    live.textContent = Math.abs(d) < 1.5 ? `Height is right (${cur.alt.toFixed(0)}°) — ${azTxt}` : `${d > 0 ? 'Raise' : 'Lower'} about ${Math.abs(d).toFixed(0)}° · ${azTxt}`;
  } else {
    const g = guidance(cur, tgt);
    live.textContent = g.sep < 1 ? 'Should be in the finder — centre it' : `${fmtDelta(g.dAz)} ${g.dAz > 0 ? 'right' : 'left'}, ${fmtDelta(g.dAlt)} ${g.dAlt > 0 ? 'up' : 'down'}`;
  }
  drawReticle(cur, tgt, s, { canvas: $('#a-chart'), view: 25, centre: 'target', noBanner: true });
}

// ---------------------------------------------------------------- GAME
const APP_VERSION = '0.3';
let game = null; // {phase, code, ch, targets[], style, i, t0, splits[], penalty, hints, dw, manual, ...}
const playable = (o) => { sky.updateAll(); return o.alt >= 20; };

function drawQR(cv, text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), quiet = 3, size = cv.width, cell = Math.floor(size / (n + 2 * quiet)), off = Math.floor((size - cell * n) / 2);
  const c = cv.getContext('2d'); c.fillStyle = '#ff5a3c'; c.fillRect(0, 0, size, size); c.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect(off + k * cell, off + r * cell, cell, cell);
}
async function loadScript(src) { if (window.jsQR) return; await new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('QR reader failed to load')); document.head.appendChild(s); }); }
/** Scan a QR code with the camera; resolves with its text, or a pasted code, or null if cancelled. */
async function scanCode() {
  const ov = $('#scanner'), video = $('#scan-video'), msg = $('#scan-msg');
  ov.classList.remove('hidden'); msg.textContent = 'Starting camera…';
  let stream = null, done = false;
  const finish = (v) => { done = true; if (stream) stream.getTracks().forEach((t) => t.stop()); ov.classList.add('hidden'); return v; };
  return new Promise(async (resolve) => {
    $('#scan-cancel').onclick = () => resolve(finish(null));
    $('#scan-paste').onclick = async () => { const v = await askText('Paste the Skyward code', '', { max: 4000, ok: 'Join' }); resolve(finish(v && v.trim() ? v.trim() : null)); };
    try {
      await loadScript('vendor/jsQR.js');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play(); msg.textContent = 'Point the camera at the other phone\'s code.';
      const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        if (done) return;
        if (video.videoWidth) {
          cv.width = video.videoWidth; cv.height = video.videoHeight; ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, cv.width, cv.height);
          const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
          if (r && /^SKY[GR]\d/.test(r.data)) { if (navigator.vibrate) navigator.vibrate(60); return resolve(finish(r.data)); }
        }
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { msg.textContent = `Camera unavailable (${e.message}). Use Paste instead.`; }
  });
}

function newGame(style) {
  sky.updateAll();
  const cur = pointing();
  const ceiling = state.history.slice().reverse().find((h) => h.test === 'check' && h.result && h.result.ceiling)?.result.ceiling;
  // Only things the visibility model rates Obvious or Visible right now: a race is no fun against a target you can't see.
  const fair = sky.objects.filter((o) => { const r = o.alt > 0 ? rateNow(o) : null; return !r || r.level <= 1; });
  const T = pickTargets(fair, { aperture: profile().aperture, sunAlt: sky.sunAlt(), maxAlt: Math.min(80, ceiling || 80) });
  if (T.length < 3) return toast(sky.sunAlt() > -6 ? 'Too bright — wait until the sky is darker.' : 'Not enough suitable targets above 25° right now.', 4000);
  const route = routeOrder(T, cur && cur.ready ? cur : null);
  const code = encodeChallenge({ style, tokens: route.map(tokenFor), host: state.player || '' });
  loadChallenge(code);
}
function loadChallenge(code) {
  let ch; try { ch = decodeChallenge(code); } catch (e) { return toast(e.message, 4000); }
  const idx = buildTokenIndex(sky.objects); sky.updateAll();
  const targets = ch.tokens.map((t) => idx.get(t)).filter(Boolean);
  const missing = ch.tokens.length - targets.length;
  game = { phase: 'ready', code, ch, style: ch.style, targets, missing, splits: [], penalty: 0, hints: 0, manual: 0, i: 0 };
  renderGame();
}
function startGame() {
  game.play = game.targets.filter((o) => playable(o));        // targets not up at this site are left out, without penalty
  if (!game.play.length) return toast('None of these targets are above 20° here right now.');
  game.phase = 'count'; game.countEnd = Date.now() + 3000; game.i = 0; game.splits = []; game.penalty = 0; game.hints = 0; game.manual = 0; game.dw = {};
  renderGame();
}
function foundRadius(o) {
  const half = tfov() / 2, U = pointingUncertainty(sky.altAz(o));
  return Math.min(half * 1.2, Math.max(half * 0.5, U ? 1.5 * U / 60 : 0));
}
function nextTarget(found, how) {
  const now = Date.now();
  game.splits[game.i] = found ? (now - (game.legStart || game.t0)) / 1000 : null;
  if (how === 'skip') game.penalty += PENALTY.skip;
  if (how === 'manual') game.manual++;
  if (navigator.vibrate) navigator.vibrate(found ? [80, 60, 80] : 200);
  if (found) cue.onTarget(); else cue.miss();
  const o = game.play[game.i];
  if (found) toast(`Found ${o.label} in ${fmtTime(game.splits[game.i])}`, 1800);
  game.i++; game.legStart = now; game.dw = {}; game.hintUntil = 0;
  if (game.i >= game.play.length) finishGame(); else renderGame();
}
function finishGame() {
  const elapsed = (Date.now() - game.t0) / 1000;
  const found = game.splits.filter((v) => v != null).length;
  game.result = { challenge: game.ch.id, player: state.player || 'Player', style: game.style, found, targets: game.play.length,
    totalSec: elapsed + game.penalty, penaltySec: game.penalty, splits: game.splits, sensorConfirmed: game.manual === 0 };
  game.phase = 'done';
  (state.gameResults ||= {});
  (state.gameResults[game.ch.id] ||= []).push({ ...game.result, mine: true, when: Date.now() });
  save(); renderGame();
}
function scoreRow(r) {
  return { title: r.player, challenge: r.challenge, style: r.style, found: r.found, targets: r.targets, totalSec: Math.round(r.totalSec * 10) / 10,
    penaltySec: r.penaltySec, points: points(r), splits: { s: r.splits }, scope: profile().name, phone: state.phone || '',
    siteName: state.siteName || '', latBand: Math.round(state.site.lat), sensorConfirmed: !!r.sensorConfirmed, appVersion: APP_VERSION, playedAt: Date.now() };
}

function renderGame() {
  const el = $('#tab-game');
  if (mar) return renderMar(el);
  if (!game || game.phase === 'lobby') return renderLobby(el);
  if (game.phase === 'ready') return renderReady(el);
  if (game.phase === 'count' || game.phase === 'play') return renderPlay(el);
  if (game.phase === 'done') return renderDone(el);
}
function renderLobby(el) {
  const aligned = state.mode === 'gyro' ? !!align.fit : true;
  const sel = state.gameStyle || 'push';
  const M = state.marathon, tonight = nightOf(sky).id, mine = M && M.night === tonight ? M : null, nFound = mine ? Object.keys(mine.found).length : 0;
  const best = state.marathonBest;
  el.innerHTML = `<h2>Play</h2>
    ${aligned ? '' : `<div class="card"><b>Align first.</b> <span class="small">Both games use the arrows, so the app needs to know where the scope points.</span><div class="btnrow"><button id="g-align">Go to Align</button></div></div>`}
    <div class="card gamecard"><h3>Messier Marathon</h3>
      <p class="small">How many Messier objects can you bag tonight? The app picks the order: whatever is about to set comes first, then the shortest hop. No clock, one point each.</p>
      ${mine ? `<p class="small"><b>${mine.over ? 'Tonight' : 'In progress'}: ${nFound} found.</b></p>` : ''}
      ${best ? `<p class="muted small">Your best night: ${best.found} of ${best.possible} possible · ${shortDate(best.when)}</p>` : ''}
      <label class="row"><span>Sync stars before long hops <span class="muted small">(a bright star to centre first, so the arrows land closer)</span></span><input type="checkbox" id="mm-sync" ${state.marSync !== false ? 'checked' : ''}></label>
      <div class="btnrow"><button id="mm-go" class="primary big" ${aligned ? '' : 'disabled'}>${mine && !mine.over ? 'Carry on' : mine ? 'Start again tonight' : 'Start the marathon'}</button></div></div>
    <div class="card gamecard"><h3>Race</h3>
      <p class="small">The 10 best targets for your sky right now, a short route, and a stopwatch. Friends at the same site can scan your code and race the same 10.</p>
      <label class="row"><span>How you find them</span><select id="g-style">${Object.entries(STYLES).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
      <p class="muted small" id="g-styledesc">${esc(STYLES[sel].desc)}</p>
      <div class="btnrow"><button id="g-new" class="primary" ${aligned ? '' : 'disabled'}>New race</button><button id="g-scan">Join: scan</button><button id="g-paste">Join: paste</button></div>
      <details class="more"><summary>Leaderboard and your name</summary>
        <label class="field"><span>Your name on the leaderboard</span><input id="g-name" value="${esc(state.player || '')}" placeholder="e.g. Bryan" maxlength="24"></label>
        <label class="field"><span>Observing site <span class="muted small">(optional)</span></span><input id="g-site" value="${esc(state.siteName || '')}" placeholder="e.g. Torrance Barrens" maxlength="40"></label>
        <div class="btnrow"><button id="g-board">Show leaderboard</button></div>
        <div id="g-boardbox"></div></details></div>`;
  $('#g-name').onchange = (e) => { state.player = e.target.value.trim(); save(); };
  $('#g-site').onchange = (e) => { state.siteName = e.target.value.trim(); save(); };
  $('#g-style').onchange = (e) => { state.gameStyle = e.target.value; save(); $('#g-styledesc').textContent = STYLES[state.gameStyle].desc; };
  if ($('#g-align')) $('#g-align').onclick = () => showTab('align');
  $('#mm-sync').onchange = (e) => { state.marSync = e.target.checked; save(); };
  $('#mm-go').onclick = () => {
    if (mine && mine.over && !confirmTwice('mm-go')) return;
    startMarathon(!(mine && !mine.over));
  };
  $('#g-new').onclick = () => newGame(state.gameStyle || 'push');
  $('#g-scan').onclick = async () => { const c = await scanCode(); if (c) (c.startsWith('SKYR') ? addFriendResult(c) : loadChallenge(c)); };
  $('#g-paste').onclick = async () => { const c = await askText('Paste a Skyward race code', '', { max: 4000, ok: 'Join' }); if (c && c.trim()) loadChallenge(c.trim()); };
  $('#g-board').onclick = () => showBoard($('#g-boardbox'), { style: state.gameStyle || 'push' });
}

// ---------------------------------------------------------------- MESSIER MARATHON
// state.marathon = { night, start, found: {key: ms}, tap: [keys counted without the sensors agreeing], later: {key: ms}, over }
let mar = null;   // { rows, sig, cur: row, why, upNext, dw, armed }
function marRows() {
  const M = state.marathon, N = nightOf(sky, new Date(M.start));
  const end = N.nautAm || N.rise || new Date(M.start + 10 * 3600000);
  const sig = [M.start, state.active, profile().aperture, skyNelm(), hzSig(), state.site.lat, state.site.lon].join('|');
  if (!mar.rows || mar.sig !== sig) { mar.rows = marathonList(sky, { start: new Date(M.start), end, scope: profile(), nelm: skyNelm(), horizon: horizonNow() }); mar.sig = sig; }
  return mar.rows;
}
function startMarathon(fresh) {
  if (fresh || !state.marathon) state.marathon = { night: nightOf(sky).id, start: Date.now(), found: {}, tap: [], later: {}, over: false };
  game = null; mar = { rows: null, sig: '', cur: null, dw: {} };
  save(); marPick(); renderGame(); $('main').scrollTop = 0;
}
function marPick() {
  const M = state.marathon, rows = marRows(), c = pointing();
  const p = marathonPick(sky, rows, { now: new Date(), done: new Set(Object.keys(M.found)), later: new Map(Object.entries(M.later)), cur: c && c.ready ? c : null, horizon: horizonNow() });
  mar.p = p; mar.cur = p.next; mar.dw = {}; mar.armed = 0; mar.pinged = false;
  mar.hop = p.next && c && c.ready ? (() => { const t = sky.altAz(p.next.o); return sepDeg(c.alt, c.az, t.alt, t.az); })() : null;
  mar.sync = null;
  if (p.next && state.marSync !== false && mar.noSync !== p.next.key) {
    // Where the pointing is freshest: the last thing synced or aligned on (its place in the sky now), else where the scope is.
    const ls = align.syncs[align.syncs.length - 1], lo = ls && ls.key ? objByKey(ls.key) : null;
    const from = lo ? sky.altAz(lo) : ls && ls.pos ? ls.pos : align.obs.length ? (() => { const a = objByKey(align.obs[align.obs.length - 1].key); return a ? sky.altAz(a) : null; })() : null;
    try { mar.sync = from ? syncStarFor(sky, p.next.o, { from, horizon: horizonNow() }) : null; } catch (e) { mar.sync = null; }
  }
  if (!p.next && !p.waiting) finishMarathon();
  return p;
}
function marFound(how) {
  const M = state.marathon, r = mar.cur; if (!r) return;
  M.found[r.key] = Date.now(); if (how === 'tap') M.tap.push(r.key);
  if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
  logObservation(r.o, 'yes');
  marPick(); renderGame();
}
function finishMarathon() {
  const M = state.marathon; if (!M) return;
  M.over = true; M.ended = Date.now();
  const found = Object.keys(M.found).length, possible = marRows().length;
  if (found && (!state.marathonBest || found > state.marathonBest.found)) state.marathonBest = { found, possible, when: Date.now() };
  save(); mar.done = true; renderGame(); $('main').scrollTop = 0;
}
function renderMar(el) {
  const M = state.marathon, rows = marRows(), found = Object.keys(M.found).length;
  if (mar.done) {
    const byKey = new Map(rows.map((r) => [r.key, r])), got = Object.entries(M.found).sort((a, b) => a[1] - b[1]);
    const missed = rows.filter((r) => !M.found[r.key]);
    el.innerHTML = `<h2>${found} of ${rows.length} possible tonight</h2>
      <p class="muted small">Messier Marathon · ${shortDate(M.start)}${M.tap.length ? ` · ${M.tap.length} counted on your word (the sensors disagreed)` : found ? ' · every find agreed with the sensors' : ''}${state.marathonBest && state.marathonBest.found === found && found ? ' · your best night so far' : ''}</p>
      ${got.length ? `<table class="res"><tr><th>#</th><th>Found</th><th>At</th></tr>${got.map(([k, t], i) => `<tr><td>${i + 1}</td><td>${esc((byKey.get(k) || { o: objByKey(k) || { label: k } }).o.label)}</td><td>${hm(new Date(t))}</td></tr>`).join('')}</table>` : '<p>Nothing found this time. Clouds happen.</p>'}
      ${missed.length && found ? `<details class="more"><summary>${missed.length} not found</summary><p class="muted small">${missed.map((r) => esc(r.o.label)).join(', ')}</p></details>` : missed.length ? `<p class="muted small">${missed.length} were in reach tonight. They will be back.</p>` : ''}
      <div class="btnrow"><button id="mm-back" class="primary">Done</button></div>`;
    $('#mm-back').onclick = () => { mar = null; renderGame(); };
    return;
  }
  const p = mar.p, r = mar.cur;
  const score = `<div class="mscore"><b>${found}</b> found<span class="muted"> · ${p.left} still possible${p.missed ? ` · ${p.missed} missed` : ''}</span></div>`;
  const foot = `<div class="btnrow"><button id="mm-pause">Pause</button><button id="mm-synct">Sync stars: ${state.marSync !== false ? 'on' : 'off'}</button><button id="mm-end">Finish the night</button></div>`;
  if (!r) {
    const w = p.waiting;
    el.innerHTML = `<h2>Messier Marathon</h2>${score}
      <div class="card"><b>Nothing in reach right now.</b><p class="small">${w ? `Next up: <b>${esc(w.o.label)}</b>, from about ${hm(w.from)}${sky.sunAlt() > -6 ? ' — once the sky is dark enough' : ''}.` : ''}</p></div>${foot}`;
  } else if (mar.sync) {
    const s = mar.sync.o;
    el.innerHTML = `${score}
      <div class="planbar">Sync star on the way to <b>${esc(r.o.label)}</b> (a ${mar.sync.hop.toFixed(0)}° hop). Centre the star, tap Sync, and the last ${mar.sync.dist.toFixed(0)}° will land closer.</div>
      <div class="target-h" style="justify-content:center;margin-top:6px"><span class="name">★ ${esc(s.label)}</span><span class="muted">bright star · mag ${(+s.mag).toFixed(1)}</span></div>
      <div class="guide" id="g-deltas">
        <div class="delta" id="gd-az"><div class="lab">Turn</div><div class="val">—</div><div class="dir"></div></div>
        <div class="delta" id="gd-alt"><div class="lab">Tilt</div><div class="val">—</div><div class="dir"></div></div></div>
      <div class="infield" id="g-status"></div>
      <canvas id="g-chart" class="chart" width="800" height="800"></canvas>
      ${foot}
      <div class="actionbar"><button id="mm-dosync" class="primary">It’s centred — sync</button><button id="mm-nosync">Skip the star</button></div>`;
    $('#mm-dosync').onclick = () => { if (doSync(s) === false) return; mar.sync = null; mar.dw = {}; renderGame(); };
    $('#mm-nosync').onclick = () => { mar.noSync = r.key; mar.sync = null; mar.dw = {}; renderGame(); };
  } else {
    const o = r.o, why = mar.p.why === 'setting' ? `Going soon — about ${p.minsLeft} min left` : mar.p.why === 'skipped' ? 'One you skipped — try again?' : mar.hop != null && mar.hop < 30 ? 'Shortest hop from here' : 'Next on the route';
    el.innerHTML = `${score}
      <div class="target-h" style="justify-content:center;margin-top:6px"><span class="name">${esc(o.label)}</span><span class="muted">${esc(typeLabel(o.t))}${o.mag != null ? ' · mag ' + (+o.mag).toFixed(1) : ''}</span></div>
      <div class="muted small" style="text-align:center">${o.name ? esc(o.name) + ' · ' : ''}${esc(why)}</div>
      <div class="guide" id="g-deltas">
        <div class="delta" id="gd-az"><div class="lab">Turn</div><div class="val">—</div><div class="dir"></div></div>
        <div class="delta" id="gd-alt"><div class="lab">Tilt</div><div class="val">—</div><div class="dir"></div></div></div>
      <div class="infield" id="g-status"></div>
      <canvas id="g-chart" class="chart" width="800" height="800"></canvas>
      ${p.upNext.length ? `<p class="muted small" style="text-align:center">Up next: ${p.upNext.slice(0, 4).map((x) => esc(x.o.label)).join(' · ')}</p>` : ''}
      ${foot}
      <div class="actionbar"><button id="mm-got" class="primary">Got it</button><button id="mm-skip">Skip for now</button></div>`;
    $('#mm-skip').onclick = () => { M.later[r.key] = Date.now() + 20 * 60000; save(); cue.miss(); marPick(); renderGame(); };
    $('#mm-got').onclick = () => {
      const cur = pointing();
      if (cur && cur.ready) {
        const t = sky.altAz(o), d = sepDeg(cur.alt, cur.az, t.alt, t.az), R = foundRadius(o);
        if (d <= 3 * R) return marFound('auto');
        if (Date.now() < mar.armed) return marFound('tap');
        mar.armed = Date.now() + 6000; cue.miss(); return toast(`The sensors put you ${degAway(d)} away. If you really can see it, tap Got it again.`, 5000);
      }
      if (Date.now() < mar.armed) return marFound('tap');
      mar.armed = Date.now() + 6000; toast('No pointing data. Tap Got it again to count it anyway.', 5000);
    };
  }
  $('#mm-pause').onclick = () => { mar = null; renderGame(); };
  $('#mm-synct').onclick = () => { state.marSync = state.marSync === false; save(); toast(state.marSync ? 'Sync stars on: you will be offered a bright star before long hops.' : 'Sync stars off: straight from one Messier object to the next.', 3500); marPick(); renderGame(); };
  $('#mm-end').onclick = () => { if (confirmTwice('mm-end')) finishMarathon(); };
}
let marT = 0;
function updateMar() {
  if (!mar || mar.done) return;
  const now = Date.now(), r = mar.cur;
  if (!r) { if (now - marT > 20000) { marT = now; const p = marPick(); if (mar && (p.next || !p.waiting)) renderGame(); } return; }
  if (r.to.getTime() <= now) { toast(`${r.o.label} has gone — on to the next`, 3000); marPick(); renderGame(); return; }
  const o = mar.sync ? mar.sync.o : r.o, tgt = sky.altAz(o), cur = pointing(), st = $('#g-status'); if (!st) return;
  if (!mar.sync && blocked(horizonNow(), tgt.alt, tgt.az)) { toast(`${o.label} has slipped behind your blocked sky`, 3000); state.marathon.later[r.key] = now + 20 * 60000; marPick(); renderGame(); return; }
  if (!cur || !cur.ready) { st.textContent = 'Waiting for sensors / alignment…'; drawReticle(null, tgt, o, { canvas: $('#g-chart'), view: 6, centre: 'target' }); return; }
  const gd = guidance(cur, tgt), R = foundRadius(o), half = tfov() / 2;
  setDelta($('#gd-az'), gd.dAz, 'az', Math.abs(gd.dAz * Math.cos(tgt.alt * D2R)) < half); setDelta($('#gd-alt'), gd.dAlt, 'alt', Math.abs(gd.dAlt) < half);
  const on = dwell(mar.dw, gd.sep, R, now, 1500);
  if (on && !mar.pinged) { mar.pinged = true; cue.onTarget(); if (navigator.vibrate) navigator.vibrate(80); }
  if (gd.sep > 3 * R) mar.pinged = false;
  st.textContent = gd.sep <= R ? (mar.sync ? 'On the star — centre it in the eyepiece, then tap Sync' : 'On target — look in the eyepiece, then tap Got it') : `${degAway(gd.sep)} away`;
  drawReticle(cur, tgt, o, { canvas: $('#g-chart') });
}

// ---------------------------------------------------------------- ROUTE PREVIEW
// A run-through of the plan before going out: alignment stars, then each stop in order, traced across a whole-sky map
// with the blocked sky hatched, and what each stop looks like in the finding eyepiece and the recommended one.
let route = null;   // { stops: [{ o, kind: 'align'|'sync'|'target', t: Date, alt, az, hop, blocked, ep }], i, f, playing, t0 }
function routeStops() {
  const P = planState(), start = new Date(P.start), end = new Date(start.getTime() + P.hours * 3600000), HZ = horizonNow(), stops = [];
  const at = (o, t, kind, extra = {}) => { const p = sky.altAz(o, t); stops.push({ o, kind, t, alt: p.alt, az: p.az, blocked: p.alt <= 0 || blocked(HZ, p.alt, p.az), ...extra }); };
  // the stars the Align screen would offer at the start of the session (not shown once you are aligned)
  if (!alignedNow()) try {
    const cands = sky.objects.filter((o) => (o.key.startsWith('st:') || (o.planet && o.id !== 'Moon')) && (o.mag ?? 9) < 2.6)
      .map((o) => { const p = sky.altAz(o, start); return { ...o, alt: p.alt, az: p.az, src: o }; }).filter((s) => !blocked(HZ, s.alt, s.az, 2));
    const a1 = pickStars(cands)[0], a2 = a1 && alignNeeded() > 1 ? pickStars(cands, a1)[0] : null;
    for (const a of [a1, a2]) if (a) at(a.src, start, 'align');
  } catch (e) { console.error(e); }
  const when = planSchedule();
  for (const it of P.items) {
    const o = objByKey(it.key); if (!o) continue; const t = when.get(it.key + (it.sync ? '|s' : '')) || start;
    if (it.sync) at(o, t, 'sync'); else { const r = rowFor(it.key); at(o, t, 'target', { ep: r && r.ep ? r.ep : null, row: r }); }
  }
  stops.forEach((s, i) => { s.hop = i ? sepDeg(stops[i - 1].alt, stops[i - 1].az, s.alt, s.az) : null; });
  return stops;
}
const ROUTE_HOLD = 3600, ROUTE_MOVE = 1100;     // ms looking at a stop, ms travelling to the next
function renderRoute() {
  const el = $('#tab-route'), P = planState();
  if (!route) route = { stops: routeStops(), i: 0, f: 1, playing: true, t0: performance.now() };
  const S = route.stops;
  if (!S.length) { el.innerHTML = `<button class="back" id="rt-back">‹ Plan</button><h2>Route preview</h2><p>Add some targets to the plan first.</p>`; $('#rt-back').onclick = () => showTab('plan'); return; }
  const bad = S.filter((s) => s.blocked && s.kind === 'target');
  el.innerHTML = `<button class="back" id="rt-back">‹ Plan</button><h2>Route preview</h2>
    <p class="muted small" style="margin:-6px 0 4px">${esc(planTitle(P))} · whole sky: rim = horizon, middle = overhead${horizonNow() ? ', hatched = blocked' : ''}</p>
    <div class="rtgrid"><canvas id="rt-map" class="chart rtmap" width="800" height="800"></canvas><div id="rt-views" class="rtviews"></div></div>
    <p class="small" style="text-align:center;margin:4px 0">${bad.length ? `<b>${bad.length} stop${bad.length === 1 ? ' is' : 's are'} hidden at the planned time:</b> ${bad.map((s) => esc(s.o.label)).join(', ')}` : horizonNow() ? 'The route stays clear of your blocked sky.' : 'No blocked sky marked for this spot.'}</p>
    <div class="card" id="rt-card"></div>
    <div class="actionbar"><button id="rt-prevb" class="nav" aria-label="Previous stop">‹</button><button id="rt-play" class="primary wide"></button><button id="rt-nextb" class="nav" aria-label="Next stop">›</button></div>`;
  $('#rt-back').onclick = () => showTab('plan');
  const go = (i) => { route.i = Math.max(0, Math.min(S.length - 1, i)); route.f = 0; route.t0 = performance.now(); routeCard(); };
  $('#rt-prevb').onclick = () => { route.playing = false; go(route.i - 1); route.f = 1; routeCard(); };
  $('#rt-nextb').onclick = () => { route.playing = false; go(route.i + 1); };
  $('#rt-play').onclick = () => { if (!route.playing && route.i >= S.length - 1) go(0); route.playing = !route.playing; route.t0 = performance.now() - (route.f >= 1 ? ROUTE_MOVE : 0); routeCard(); };
  routeCard(); drawRouteMap();
}
/** The card under the map: what this stop is and what it looks like in the eyepiece. */
function routeCard() {
  const box = $('#rt-card'); if (!box || !route) return;
  const S = route.stops, s = S[route.i], o = s.o, p = profile();
  const eps = p.eyepieces.slice().sort((a, b) => b.fl - a.fl), wide = eps[0], best = s.kind === 'target' && s.ep ? (p.eyepieces.find((e) => e.fl === s.ep.fl) || s.ep) : null;
  const views = s.kind !== 'target' ? [[wide, 'Centre it']] : best && best.fl !== wide.fl ? [[wide, 'Find it'], [best, 'Then look']] : [[wide, 'Find it and look']];
  const what = s.kind === 'align' ? 'Alignment star' : s.kind === 'sync' ? 'Sync star' : esc(typeLabel(o.t));
  const mag = (e) => Math.round(p.fl / e.fl);
  box.innerHTML = `<div class="muted small">Stop ${route.i + 1} of ${S.length} · ${what} · about ${hm(s.t)}</div>
    <div class="target-h" style="margin:2px 0"><span class="name">${s.kind === 'target' ? '' : '★ '}${esc(o.label)}</span>${o.name && o.name !== o.label ? `<span class="muted">${esc(o.name)}</span>` : ''}</div>
    <div class="small">${s.alt.toFixed(0)}° up in the ${compassName(s.az)}${s.hop != null ? ` · a ${s.hop.toFixed(0)}° push from ${esc(S[route.i - 1].o.label)}` : ' · the first thing you point at'}${s.blocked ? ' · <b>behind your blocked sky at this time</b>' : ''}</div>
    ${s.kind === 'align' ? '<div class="muted small">Centre it and confirm. Two stars teach the app how the phone sits on the tube.</div>' : s.kind === 'sync' ? '<div class="muted small">Centre it and tap Sync, so the next pushes land closer.</div>' : s.row && s.row.desc ? `<div class="muted small">${esc(s.row.desc)}</div>` : ''}`;
  const vb = $('#rt-views');
  vb.innerHTML = views.map(([e, cap], j) => `<figure><canvas width="240" height="240" data-j="${j}"></canvas><figcaption><b>${cap}</b><br>${esc(e.name)} · ${mag(e)}×</figcaption></figure>`).join('<div class="rtarrow" aria-hidden="true">↓</div>');
  vb.querySelectorAll('canvas').forEach((cv) => {
    try {
      const e = views[+cv.dataset.j][0], tg = sky.altAz(o, s.t);
      drawEyepiece(cv, sky, o.pairs && o.key.startsWith('st:') ? { ...o, t: 'DS' } : o, tg, e, p, { matrix: state.rot180 ? newtonianMatrix(tg, p.focuser ?? 90) : null, bright: vis(), refExit: p.aperture / (p.fl / wide.fl), thumb: true, date: s.t });
    } catch (err) { console.error(err); }
  });
  const b = $('#rt-play'); if (b) b.textContent = route.playing ? 'Pause' : route.i >= S.length - 1 ? 'Play again' : 'Play';
  $('#rt-prevb').disabled = route.i === 0; $('#rt-nextb').disabled = route.i >= S.length - 1;
}
function updateRoute() {
  if (!route || !route.stops.length || !$('#rt-map')) return;
  const now = performance.now(), dt = now - route.t0;
  if (route.i === 0) route.f = 1; else route.f = Math.min(1, dt / ROUTE_MOVE);
  if (route.playing && dt > (route.i === 0 ? 0 : ROUTE_MOVE) + ROUTE_HOLD) {
    if (route.i < route.stops.length - 1) { route.i++; route.f = 0; route.t0 = now; routeCard(); }
    else { route.playing = false; routeCard(); }
  }
  drawRouteMap();
}
function drawRouteMap() {
  const cv = $('#rt-map'); if (!cv || !route) return;
  const c = cv.getContext('2d'), W = cv.width, C = W / 2, R = W * 0.44, k = vis(), col = (r, g, b, a = 1) => tint(r, g, b, a, k);
  const S = route.stops, cur = S[route.i], HZ = horizonNow();
  const xy = (alt, az) => { const r = R * (90 - Math.max(0, alt)) / 90; return [C + r * Math.sin(az * D2R), C - r * Math.cos(az * D2R)]; };
  c.clearRect(0, 0, W, W);
  c.beginPath(); c.arc(C, C, R, 0, 7); c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--chart').trim() || '#05060f'; c.fill(); c.strokeStyle = col(170, 180, 230, 0.7); c.lineWidth = 2; c.stroke();
  c.strokeStyle = col(120, 130, 190, 0.22); c.lineWidth = 1; for (const a of [30, 60]) { c.beginPath(); c.arc(C, C, R * (90 - a) / 90, 0, 7); c.stroke(); }
  c.fillStyle = col(170, 180, 230, 0.85); c.font = `${W / 28}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const [t, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) { const r = R + W * 0.035; c.fillText(t, C + r * Math.sin(az * D2R), C - r * Math.cos(az * D2R)); }
  // blocked sky: the band between the rim and how high things reach in each direction
  if (HZ) {
    c.save(); c.beginPath(); c.arc(C, C, R, 0, 7);
    for (let az = 360; az >= 0; az -= 2) { const [x, y] = xy(Math.min(89, limitAt(HZ, az)), az); if (az === 360) c.moveTo(x, y); else c.lineTo(x, y); }
    c.closePath(); c.clip('evenodd');
    c.fillStyle = col(150, 80, 50, 0.10); c.fillRect(0, 0, W, W);
    c.beginPath(); for (let x = -W; x < W; x += W / 46) { c.moveTo(x, W); c.lineTo(x + W, 0); } c.strokeStyle = col(175, 95, 60, 0.5); c.lineWidth = 2; c.stroke();
    c.restore();
    c.beginPath(); for (let az = 0; az <= 360; az += 2) { const [x, y] = xy(Math.min(89, limitAt(HZ, az)), az); if (!az) c.moveTo(x, y); else c.lineTo(x, y); } c.strokeStyle = col(175, 95, 60, 0.8); c.lineWidth = 2; c.stroke();
  }
  // the bright stars, placed for the moment of this stop, so the sky turns as the session goes on
  for (const o of sky.objects) {
    if (!o.key.startsWith('st:') || (o.mag ?? 9) > 2.9) continue;
    const p = sky.altAz(o, cur.t); if (p.alt < 1) continue; const [x, y] = xy(p.alt, p.az);
    c.beginPath(); c.arc(x, y, Math.max(1.6, 5.2 - o.mag * 1.25), 0, 7); c.fillStyle = col(215, 222, 255, 0.5); c.fill();
  }
  const pts = S.map((s) => xy(s.alt, s.az));
  // the path: still to come (faint, dashed), then already travelled (bright)
  c.lineJoin = 'round'; c.setLineDash([8, 9]); c.strokeStyle = col(200, 205, 240, 0.35); c.lineWidth = 2;
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); c.setLineDash([]);
  const here = route.i === 0 ? pts[0] : [pts[route.i - 1][0] + (pts[route.i][0] - pts[route.i - 1][0]) * ease(route.f), pts[route.i - 1][1] + (pts[route.i][1] - pts[route.i - 1][1]) * ease(route.f)];
  c.strokeStyle = col(255, 205, 110, 0.95); c.lineWidth = 4; c.beginPath();
  for (let i = 0; i < route.i; i++) { const [x, y] = pts[i]; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
  if (route.i > 0) c.lineTo(here[0], here[1]); c.stroke();
  // the stops
  c.font = `600 ${W / 36}px system-ui, sans-serif`;
  S.forEach((s, i) => {
    const [x, y] = pts[i], done = i < route.i || (i === route.i && route.f >= 1), r = s.kind === 'target' ? W / 62 : W / 80;
    c.beginPath(); c.arc(x, y, r, 0, 7);
    c.fillStyle = s.blocked ? col(230, 90, 70, done ? 1 : 0.6) : done ? col(255, 205, 110, 1) : col(200, 205, 240, 0.55); c.fill();
    if (s.kind !== 'target') { c.strokeStyle = col(255, 255, 255, 0.9); c.lineWidth = 2; c.stroke(); }
    if (i === route.i && route.f >= 1) { c.beginPath(); c.arc(x, y, r + W / 70, 0, 7); c.strokeStyle = col(255, 205, 110, 0.9); c.lineWidth = 3; c.stroke(); }
    if (i === route.i || i === route.i - 1) { c.fillStyle = col(240, 242, 255, 0.95); c.textAlign = x > C ? 'right' : 'left'; c.fillText((s.kind === 'target' ? '' : '★ ') + s.o.label, x + (x > C ? -1 : 1) * (r + W / 80), y - W / 60); }
  });
  // the telescope on its way
  if (route.f < 1 && route.i > 0) { c.beginPath(); c.arc(here[0], here[1], W / 55, 0, 7); c.fillStyle = col(255, 230, 160, 1); c.fill(); }
}
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// ---------------------------------------------------------------- BLOCKED SKY
let hzTrace = null;   // { T, rough, t }
function hzRingSVG(H, T) {
  const C = 130, r0 = 34, r1 = 112, pt = (r, az) => [C + r * Math.sin(az * D2R), C - r * Math.cos(az * D2R)];
  const arc = (k) => { const a0 = k * 45 - 22.5, a1 = k * 45 + 22.5, [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r1} ${r1} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}A${r0} ${r0} 0 0 0 ${x3.toFixed(1)} ${y3.toFixed(1)}Z`; };
  const rad = (alt) => r1 - (r1 - r0) * Math.min(90, Math.max(0, alt)) / 90;       // horizon at the rim, overhead at the middle
  const outline = (h) => h.map((v, i) => pt(rad(v), (i + 0.5) * 360 / HZ_BINS).map((x) => x.toFixed(1)).join(',')).join(' ');
  const wedges = WEDGES.map((w, k) => { const lv = wedgeLevel(H, k), hgt = wedgeHeight(H, k), [tx, ty] = pt(r1 + 12, k * 45), [lx, ly] = pt((r0 + r1) / 2, k * 45);
    return `<g class="hz-w lv${lv}" aria-label="${w}: ${HZ_LEVELS[lv].name}"><path d="${arc(k)}"/><text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" class="hz-v">${hgt < 1 ? '' : hgt >= 89 ? '✕' : Math.round(hgt) + '°'}</text><text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle" class="hz-l">${w}</text></g>`; }).join('');
  const traced = T ? T.n.map((n, i) => (n ? `<circle cx="${pt(rad(T.sum[i] / n), (i + 0.5) * 360 / HZ_BINS)[0].toFixed(1)}" cy="${pt(rad(T.sum[i] / n), (i + 0.5) * 360 / HZ_BINS)[1].toFixed(1)}" r="2.6" class="hz-dot"/>` : '')).join('') : '';
  return `<svg viewBox="0 0 260 260" class="hzring">${wedges}${H.how === 'trace' && !T ? `<polygon points="${outline(H.h)}" class="hz-line"/>` : ''}${traced}<circle cx="${C}" cy="${C}" r="${r0 - 4}" class="hz-me"/><text x="${C}" y="${C + 4}" text-anchor="middle" class="hz-l">you</text><g id="hz-ptr"></g></svg>`;
}
// ---- saved places: a spot and its blocked-sky map.  state.places = [{ id, name, lat, lon, elev, horizon }], state.placeId
const places = () => state.places || (state.places = []);
const curPlace = () => places().find((p) => p.id === state.placeId) || null;
const placeLabel = () => { const p = curPlace(); return p ? p.name : null; };
/** Every change to the blocked-sky map goes through here, so the place you are at keeps its own copy. */
function setHorizon(H) { state.horizon = H; const p = curPlace(); if (p) p.horizon = H; planRows = null; rateCache.clear(); save(); }
function usePlace(id) {
  const p = places().find((x) => x.id === id); if (!p) return;
  state.placeId = p.id; state.horizon = p.horizon || null;
  state.site = { lat: p.lat, lon: p.lon, elev: p.elev || 0, source: `saved place: ${p.name}` };
  sky.setSite(p.lat, p.lon, p.elev || 0); planRows = null; rateCache.clear(); save();
}
function addPlace(name) {
  const cur = curPlace();
  const p = { id: 'pl' + Date.now().toString(36), name: uniqueName(places().map((x) => x.name), name), lat: state.site.lat, lon: state.site.lon, elev: state.site.elev || 0,
    horizon: cur ? null : (state.horizon || null) };              // from another place: start clear; from an unsaved spot: keep what was just marked
  places().push(p); state.placeId = p.id; state.horizon = p.horizon; planRows = null; rateCache.clear(); save(); return p;
}
/** The observer's position changed: stay at the saved place, switch to the one that is here, or leave. */
function siteMoved() {
  const r = relocate(places(), state.placeId, state.site.lat, state.site.lon), had = curPlace();
  if (r.why === 'stay') { if (had) { had.lat = state.site.lat; had.lon = state.site.lon; had.elev = state.site.elev || 0; } return; }
  if (r.why === 'switch') { const p = places().find((x) => x.id === r.id); state.placeId = p.id; state.horizon = p.horizon || null; setTimeout(() => toast(`You're at ${p.name}. Using its blocked sky.`, 4000), 1200); }
  else {
    if (had) { state.placeId = null; state.horizon = null; }
    if (r.why === 'choose') setTimeout(() => toast(`${r.choices.length} of your saved places are here. Pick one under Blocked sky.`, 5000), 1200);
  }
  planRows = null; rateCache.clear();
}
let hzFrom = 'more', plcAdding = false;
const hzInFlow = () => hzFrom === 'flow' && flow && flow.steps[flow.i] === 'horizon';
const HZ_BACK = () => (hzInFlow() ? '' : `<button class="back" id="hz-back">‹ ${{ more: 'More', plan: 'Plan', push: 'Observe', start: 'Start screen' }[hzFrom] || 'More'}</button>`);
const hzDone = () => { state.launch.horizon = false; save(); flowStepDone('horizon'); };
/** Open Blocked sky from anywhere; its back button returns to where you came from. */
function openHorizon(from = 'more') { hzFrom = from; $('#gate').classList.add('hidden'); showTab('horizon'); }
function hzBindBack() { const b = $('#hz-back'); if (b) b.onclick = () => { hzTrace = null; if (hzFrom === 'start') { renderLaunch(); $('#gate').classList.remove('hidden'); } else showTab(hzFrom); }; }
const hzLine = () => (placeLabel() ? `${esc(placeLabel())}: ` : '') + (horizonNow() ? esc(horizonSummary(state.horizon)).replace(/^B/, placeLabel() ? 'b' : 'B') : 'none marked');
const SIM_URL = new URLSearchParams(location.search).has('sim');
/** Where the phone's top edge points when it is held in the hand like a spyglass: height from gravity, direction from the compass. */
function handPointing() {
  if (!sensors || !sensors.fresh()) return null;
  const co = sensors.compassOffset(); if (co == null) return null;
  const R = avgR(state.smooth) || sensors.R, raw = altAzFromVec(mulMV(R, [0, 1, 0]));
  return { alt: raw.alt, az: wrap360(raw.az + co + (state.compassCorr || 0)), ready: true };
}
/** Start a skyline trace, switching the motion sensors on first if they are off (the tap is the permission gesture iOS needs). */
async function beginTrace() {
  if (!sensors || !sensors.fresh()) {
    toast('Starting the motion sensors…', 2000);
    const ok = await startSensors(SIM_URL && !(sensors && sensors.started));
    if (!ok) return;                                              // the start screen is showing the reason and the fix
    const t0 = Date.now(); while (!sensors.fresh() && Date.now() - t0 < 2500) await new Promise((r) => setTimeout(r, 100));
    if (!sensors.fresh()) return;                                 // no data: startSensors puts the explanation up
  }
  const p = pointing(), aligned = !!(p && p.ready);
  if (!aligned) { const t0 = Date.now(); while (!handPointing() && Date.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 100)); }
  if (!aligned && !handPointing()) return toast('The phone is not giving a compass reading, so the app cannot tell directions. Wave it in a figure of eight and try again, or star-align first and trace with the telescope.', 7000);
  // In the hand is the default: it needs no telescope and no alignment. On the telescope is offered once star-aligned.
  hzTrace = { T: newTrace(), mode: 'hand', canScope: aligned, t: 0 };
  if (tab !== 'horizon') showTab('horizon'); else renderHorizon();
}
/** Save the trace. `auto` = the sweep came full circle and the app is finishing it for the user. */
function hzSaveTrace(auto) {
  if (!hzTrace) return;
  if (traceCoverage(hzTrace.T) < 0.2) return toast('Sweep further round first — at least a fifth of the circle.');
  const part = traceCoverage(hzTrace.T) < 0.95;
  setHorizon({ ...traceFinish(hzTrace.T, state.horizon), lat: state.site.lat, lon: state.site.lon, when: Date.now(), rough: hzTrace.mode === 'hand', by: hzTrace.mode });
  hzTrace = null; renderHorizon(); $('main').scrollTop = 0;
  if (auto) { cue.logged(); if (navigator.vibrate) navigator.vibrate([80, 60, 80]); }
  toast(auto ? 'Full circle — skyline saved.' : part ? 'Saved. Directions you did not sweep were filled in from their neighbours.' : 'Saved.', 5000);
}
function renderHorizon() {
  const el = $('#tab-horizon'), H = state.horizon || emptyHorizon();
  if (hzTrace) {
    const hand = hzTrace.mode === 'hand', waiting = hzTrace.recAt && !hzTrace.rec;
    el.innerHTML = `${HZ_BACK()}<h2>Trace the skyline</h2>
      ${hzTrace.canScope && !hzTrace.rec && !waiting ? `<div class="seg" id="hz-mode"><button data-mode="hand" class="${hand ? 'on' : ''}">Phone in my hand</button><button data-mode="scope" class="${hand ? '' : 'on'}">Phone on the telescope</button></div>` : ''}
      ${hand ? `<ol class="how"><li><b>Hold the phone flat like a spyglass</b>: screen up, bottom edge near your eye, top edge pointing away from you.</li>
          <li><b>Sight along it at the top of the trees and roofs.</b></li>
          <li><b>Tap Start, then turn your whole body slowly once around</b>, keeping the phone on the line where the sky starts. Where the view is open, follow the true horizon.</li></ol>
        <p class="muted small">It buzzes and saves itself when you come full circle. Heights are good to a degree or two. Directions come from the phone's compass, so stand clear of cars and metal; expect them within several degrees.</p>`
    : `<p class="small">Put the scope on the top of the trees or roofs and tap Start. Then <b>sweep slowly all the way round</b>, keeping it on the line where the sky starts. Where the view is open, follow the true horizon. It saves itself when you come full circle.</p>
        <p class="muted small">Star-aligned: directions are as good as the pointing.</p>`}
      <div id="hz-box">${hzRingSVG(H, hzTrace.T)}</div>
      <div class="infield" id="hz-live">Waiting for the sensors…</div>
      <div class="btnrow"><button id="hz-cancel">Cancel</button></div>
      <div class="actionbar">${hzTrace.rec ? '<button id="hz-done" class="primary">Save what I have</button>' : waiting ? '<button class="primary" disabled>Get ready…</button>' : `<button id="hz-rec" class="primary">${hand ? 'Start' : 'Scope is on the skyline — start'}</button>`}</div>`;
    el.querySelectorAll('[data-mode]').forEach((b2) => b2.onclick = () => { hzTrace.mode = b2.dataset.mode; renderHorizon(); });
    // In the hand you cannot see the screen while sighting, so give three seconds to raise the phone before recording.
    if ($('#hz-rec')) $('#hz-rec').onclick = () => { if (hzTrace.mode === 'hand') { hzTrace.recAt = Date.now() + 3000; hzTrace.beep = 3; } else { hzTrace.rec = true; hzTrace.T = newTrace(); } renderHorizon(); };
    $('#hz-cancel').onclick = () => { hzTrace = null; renderHorizon(); };
    if ($('#hz-done')) $('#hz-done').onclick = () => hzSaveTrace(false);
    hzBindBack(); return;
  }
  const PL = curPlace();
  const moved = hasHorizon(H) && H.lat != null && (Math.abs(H.lat - state.site.lat) > 0.02 || Math.abs(H.lon - state.site.lon) > 0.03);
  el.innerHTML = `${HZ_BACK()}<h2>Blocked sky</h2>
    <p class="small">Tell the app where trees, buildings or hills hide the sky. It shades those parts on the chart and stops suggesting targets behind them.</p>
    <h3>One slow turn</h3>
    <p class="muted small">Hold the phone like a spyglass, sight along it at the tops of the trees and roofs, and turn once around. No telescope needed, so you can do it when you scout a spot. It saves itself when you come full circle.${sensors && sensors.fresh() ? '' : ' The button switches the motion sensors on.'}</p>
    <div class="btnrow"><button id="hz-trace" class="primary big">${hasHorizon(H) ? 'Trace the skyline again' : 'Trace the skyline'}</button></div>
    ${hasHorizon(H) ? `<h3>Your blocked sky</h3>
      <div id="hz-box">${hzRingSVG(H, null)}</div>
      <p class="muted small" style="text-align:center">${esc(horizonSummary(H))}${H.how === 'trace' ? (H.by === 'scope' || (!H.by && !H.rough) ? ' · traced with the telescope' : ' · traced by hand') : ''}. The rim is the horizon, the middle is overhead.</p>
      <div class="btnrow"><button id="hz-clear">Clear it</button></div>` : '<p class="muted small" style="text-align:center">Nothing marked yet, so the whole sky counts as open.</p>'}
    <h3>This place</h3>
    <div class="card placecard">
      ${PL ? `<div class="sess"><div><b>${esc(PL.name)}</b><div class="muted small">${coordText(PL.lat, PL.lon)} · changes here are saved to this place</div></div><button id="plc-rename" class="mini">Rename</button></div>`
        : `<b>${places().length ? 'No saved place selected' : 'Save this spot'}</b><div class="muted small">${places().length ? 'Pick one below, or save where you are now as a new place.' : 'Give it a name and its blocked sky is remembered. Add more later: front yard, cottage, park.'}</div>`}
      ${places().length ? `<div class="chips wrap" id="plc-list">${places().map((p) => `<button data-place="${p.id}" class="${PL && p.id === PL.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}<button id="plc-add">＋ New place</button></div>` : ''}
      ${!places().length || plcAdding ? `<div class="muted small" style="margin-top:6px">${places().length ? 'Name the new place (it uses your current location' + (PL ? ' and starts with a clear sky' : '') + '):' : 'Tap a name:'}</div>
        <div class="chips wrap" id="plc-ideas">${PLACE_IDEAS.filter((n) => !places().some((p) => p.name.toLowerCase() === n.toLowerCase())).map((n) => `<button data-idea="${n}">${n}</button>`).join('')}<button data-idea="">Other name…</button></div>` : ''}
      ${PL ? `<div class="btnrow"><button id="plc-del" class="mini">Delete this place</button></div>` : ''}
    </div>
    ${moved && !PL ? '<div class="card"><b>This map was made somewhere else.</b> <span class="small">Clear it or redo it for where you are now.</span></div>' : ''}
    <label class="row"><span>Show on star maps <span class="muted small">(see-through hatching, so you can still see what is behind it)</span></span><input type="checkbox" id="hz-show" ${state.hzShow === false ? '' : 'checked'}></label>
    ${hzInFlow() ? `<div class="actionbar"><button id="hz-next" class="primary">${hasHorizon(H) ? 'Done — carry on' : 'Nothing in the way — carry on'}</button></div>` : ''}`;
  $('#hz-trace').onclick = beginTrace;
  if ($('#hz-next')) $('#hz-next').onclick = hzDone;
  $('#hz-show').onchange = (e) => { state.hzShow = e.target.checked; save(); };
  el.querySelectorAll('[data-place]').forEach((b) => b.onclick = () => { plcAdding = false; usePlace(b.dataset.place); renderHorizon(); toast(`Now at ${curPlace().name}`); });
  if ($('#plc-add')) $('#plc-add').onclick = () => { plcAdding = !plcAdding; renderHorizon(); };
  el.querySelectorAll('[data-idea]').forEach((b) => b.onclick = async () => {
    let name = b.dataset.idea;
    if (!name) { name = await askText('Name this place', '', { placeholder: 'e.g. Grandma\'s farm', max: 30, ok: 'Save' }); if (!name || !name.trim()) return; }
    const kept = !curPlace() && horizonNow(); const p = addPlace(name.trim().slice(0, 30)); plcAdding = false; renderHorizon();
    toast(kept ? `Saved as ${p.name}, with the blocked sky you marked.` : `${p.name} saved. Trace its skyline below.`, 4000);
  });
  if ($('#plc-rename')) $('#plc-rename').onclick = async () => { const p = curPlace(), n = await askText('Rename this place', p.name, { max: 30 }); if (!n || !n.trim()) return; p.name = uniqueName(places().filter((x) => x !== p).map((x) => x.name), n.trim().slice(0, 30)); save(); renderHorizon(); };
  if ($('#plc-del')) $('#plc-del').onclick = () => { if (!confirmTwice('plc-del')) return; const p = curPlace(); state.places = places().filter((x) => x !== p); state.placeId = null; save(); renderHorizon(); toast(`${p.name} deleted. Its blocked sky is still shown until you clear it or pick another place.`, 5000); };
  if ($('#hz-clear')) $('#hz-clear').onclick = () => { if (!confirmTwice('hz-clear')) return; setHorizon(null); renderHorizon(); };
  hzBindBack();
}
function updateHorizon() {
  if (!hzTrace) return;
  let p = hzTrace.mode === 'hand' ? handPointing() : pointing(); if (p && !p.ready) p = null;
  const live = $('#hz-live'); if (!live) return;
  if (hzTrace.recAt && !hzTrace.rec) {
    const left = Math.ceil((hzTrace.recAt - Date.now()) / 1000);
    if (left <= 0) { hzTrace.rec = true; hzTrace.T = newTrace(); cue.go(); if (navigator.vibrate) navigator.vibrate(120); renderHorizon(); return; }
    if (left < hzTrace.beep + 1 && left <= hzTrace.beep) { hzTrace.beep = left - 1; cue.tick(); }
    live.textContent = `Raise the phone to the skyline… ${left}`; return;
  }
  if (!p) { live.textContent = 'Waiting for the sensors…'; return; }
  if (hzTrace.rec && p.alt > -8 && p.alt < 88) {
    traceAdd(hzTrace.T, p.alt, p.az); if (hzTrace.az0 == null) { hzTrace.az0 = p.az; hzTrace.turn = 0; }
    else hzTrace.turn += ((p.az - hzTrace.azL + 540) % 360) - 180;          // how far round they have actually turned
    hzTrace.azL = p.az;
  }
  const now = Date.now(); if (now - hzTrace.t < 300) return; hzTrace.t = now;
  const cov = traceCoverage(hzTrace.T);
  // Come full circle (every direction swept, or all but a sliver and back at the starting direction): finish it for them.
  if (hzTrace.rec && (cov >= 1 || (cov >= 0.97 && Math.abs(((p.az - hzTrace.az0 + 540) % 360) - 180) < 8) || (cov >= 0.6 && Math.abs(hzTrace.turn || 0) >= 355))) {
    if (!hzTrace.full) hzTrace.full = now;                         // a short beat, so the last direction gets more than one reading
    else if (now - hzTrace.full >= 600) return hzSaveTrace(true);
  } else hzTrace.full = 0;
  live.textContent = `${Math.max(0, p.alt).toFixed(0)}° up, facing ${compassName(p.az)}` + (hzTrace.rec ? ` · ${Math.round(cov * 100)}% of the way round${cov >= 0.9 ? ' — nearly there, it saves itself when you close the circle' : ''}` : ' · not recording yet');
  $('#hz-box').innerHTML = hzRingSVG(state.horizon || emptyHorizon(), hzTrace.T);
  const C = 130, r = 112 - 78 * Math.min(90, Math.max(0, p.alt)) / 90;
  $('#hz-ptr').innerHTML = `<circle cx="${(C + r * Math.sin(p.az * D2R)).toFixed(1)}" cy="${(C - r * Math.cos(p.az * D2R)).toFixed(1)}" r="6" class="hz-now"/>`;
}

function renderReady(el) {
  const g = game, len = pathLength(g.targets);
  el.innerHTML = `<h2>${esc(STYLES[g.style].name)} <span class="muted" style="font-size:15px;font-weight:400">· code ${esc(g.ch.id)}</span></h2>
    <p class="muted small">${g.ch.host ? 'Set by ' + esc(g.ch.host) + ' · ' : ''}set up ${shortDate(g.ch.created)} · about ${len.toFixed(0)}° of pushing in all${g.missing ? ` · ${g.missing} target(s) not in this app version` : ''}</p>
    <ol class="small">${g.targets.map((o) => `<li>${esc(o.label)} <span class="muted">${esc(typeLabel(o.t))}${o.mag != null ? ', mag ' + (+o.mag).toFixed(1) : ''} · ${o.alt.toFixed(0)}° ${compassName(o.az)}</span>${o.alt < 20 ? ' <b>— not up here, will be left out</b>' : ''}</li>`).join('')}</ol>
    <div class="card" style="text-align:center"><b>Same site? Others scan this to play the same 10.</b>
      <canvas id="g-qr" width="520" height="520" style="width:70%;max-width:260px;display:block;margin:8px auto;border-radius:8px"></canvas>
      <div class="btnrow"><button id="g-copy">Copy / share code</button></div></div>
    <div class="btnrow"><button id="g-back">Back</button></div>
    <div class="actionbar"><button id="g-start" class="primary">Start — 3, 2, 1…</button></div>`;
  drawQR($('#g-qr'), g.code);
  $('#g-copy').onclick = () => exportText(`Skyward challenge ${g.ch.id}`, g.code);
  $('#g-start').onclick = startGame;
  $('#g-back').onclick = () => { game = null; renderGame(); };
}
function renderPlay(el) {
  const g = game, o = g.play[g.i];
  el.innerHTML = `<div class="gtimer mono" id="g-timer">0:00.0</div>
    <div class="muted small" style="text-align:center">Target ${Math.min(g.i + 1, g.play.length)} of ${g.play.length} · ${esc(STYLES[g.style].name)}${g.penalty ? ` · +${g.penalty} s penalties` : ''}</div>
    <div class="target-h" style="justify-content:center;margin-top:6px"><span class="name">${esc(o.label)}</span><span class="muted">${esc(typeLabel(o.t))}${o.mag != null ? ' · mag ' + (+o.mag).toFixed(1) : ''}</span></div>
    <div class="muted small" style="text-align:center">${esc(o.sub || '')}${o.con ? ' · ' + esc(o.con) : ''}</div>
    <div class="guide ${g.style === 'push' ? '' : 'hidden'}" id="g-deltas">
      <div class="delta" id="gd-az"><div class="lab">Turn</div><div class="val">—</div><div class="dir"></div></div>
      <div class="delta" id="gd-alt"><div class="lab">Tilt</div><div class="val">—</div><div class="dir"></div></div></div>
    <div class="infield" id="g-status"></div>
    <canvas id="g-chart" class="chart" width="800" height="800"></canvas>
    <div class="btnrow"><button id="g-quit">Quit game</button></div>
    <div class="actionbar">${g.style === 'hybrid' ? `<button id="g-hint">Hint +${PENALTY.hint} s</button>` : ''}<button id="g-found" class="primary">Found it</button><button id="g-skip">Skip +${PENALTY.skip} s</button></div>`;
  if ($('#g-hint')) $('#g-hint').onclick = () => { g.penalty += PENALTY.hint; g.hints++; g.hintUntil = Date.now() + 10000; };
  $('#g-skip').onclick = () => nextTarget(false, 'skip');
  $('#g-found').onclick = () => {
    const cur = pointing(); if (!cur || !cur.ready) return toast('No pointing data');
    const t = sky.altAz(o), d = sepDeg(cur.alt, cur.az, t.alt, t.az), R = foundRadius(o);
    if (d <= 3 * R) nextTarget(true, d <= R ? 'auto' : 'manual'); else { cue.miss(); toast(`The sensors put you ${degAway(d)} away — keep looking`); }
  };
  $('#g-quit').onclick = () => { if (confirmTwice('g-quit')) { game = null; renderGame(); } };
}
function updateGame() {
  if (mar) return updateMar();
  const g = game; if (!g) return;
  if (g.phase === 'count') {
    const left = Math.ceil((g.countEnd - Date.now()) / 1000);
    const tm = $('#g-timer'); if (tm) tm.textContent = left > 0 ? String(left) : 'Go!';
    if (left !== g.lastCount && left > 0) { g.lastCount = left; cue.count(); }
    if (Date.now() >= g.countEnd) { g.phase = 'play'; g.t0 = Date.now(); g.legStart = g.t0; cue.go(); renderGame(); }
    return;
  }
  if (g.phase !== 'play') return;
  const tm = $('#g-timer'); if (tm) { const e = (Date.now() - g.t0) / 1000 + g.penalty; tm.textContent = `${Math.floor(e / 60)}:${String(Math.floor(e % 60)).padStart(2, '0')}.${Math.floor((e * 10) % 10)}`; }
  const o = g.play[g.i]; const tgt = sky.altAz(o); const cur = pointing();
  const showArrows = g.style === 'push' || Date.now() < (g.hintUntil || 0);
  $('#g-deltas').classList.toggle('hidden', !showArrows);
  const st = $('#g-status');
  if (!cur || !cur.ready) { st.textContent = 'Waiting for sensors / alignment…'; drawReticle(null, tgt, o, { canvas: $('#g-chart'), view: 6, centre: 'target' }); return; }
  const gd = guidance(cur, tgt), R = foundRadius(o);
  if (showArrows) {
    const half = tfov() / 2;
    setDelta($('#gd-az'), gd.dAz, 'az', Math.abs(gd.dAz * Math.cos(tgt.alt * D2R)) < half); setDelta($('#gd-alt'), gd.dAlt, 'alt', Math.abs(gd.dAlt) < half);
  }
  const done = dwell(g.dw, gd.sep, R, Date.now(), 2000);
  st.textContent = g.dw.since != null ? `On target — hold steady ${Math.max(0, 2 - (Date.now() - g.dw.since) / 1000).toFixed(1)} s` : (showArrows ? `${degAway(gd.sep)} away` : 'Find it from the chart');
  // Push race: chart follows the scope. Star-hop: chart is a finder chart around the target with no scope marker.
  if (g.style === 'push' || showArrows) drawReticle(cur, tgt, o, { canvas: $('#g-chart') });
  else drawReticle(null, tgt, o, { canvas: $('#g-chart'), view: Math.max(4, tfov() * 3), centre: 'target' });
  if (done) nextTarget(true, 'auto');
}
function addFriendResult(code) {
  let r; try { r = decodeResult(code); } catch (e) { return toast(e.message, 4000); }
  (state.gameResults ||= {}); const L = (state.gameResults[r.challenge] ||= []);
  if (!L.some((x) => x.player === r.player && x.totalSec === r.totalSec)) L.push({ ...r, when: Date.now() });
  save(); toast(`Added ${r.player}: ${r.found}/${r.targets} in ${fmtTime(r.totalSec)}`); if (game && game.phase === 'done') renderGame();
}
function renderDone(el) {
  const g = game, r = g.result, code = encodeResult(r);
  const local = rank(state.gameResults[g.ch.id] || []);
  el.innerHTML = `<h2>${r.found} of ${r.targets} in ${fmtTime(r.totalSec)}</h2>
    <p class="muted small">${esc(STYLES[g.style].name)} · challenge ${esc(g.ch.id)}${r.penaltySec ? ` · includes ${r.penaltySec} s penalties` : ''}${r.sensorConfirmed ? ' · every find sensor-confirmed' : ` · ${g.manual} find(s) confirmed by tap`}</p>
    <table class="res"><tr><th>#</th><th>Target</th><th>Time</th></tr>${g.play.map((o, i) => `<tr><td>${i + 1}</td><td>${esc(o.label)}</td><td>${g.splits[i] == null ? 'skipped' : fmtTime(g.splits[i])}</td></tr>`).join('')}</table>
    <h3>This challenge, here</h3>
    <table class="res"><tr><th>Player</th><th>Found</th><th>Time</th></tr>${local.map((x) => `<tr><td>${esc(x.player)}${x.mine ? ' (you)' : ''}</td><td>${x.found}/${x.targets}</td><td>${fmtTime(x.totalSec)}</td></tr>`).join('')}</table>
    <div class="card" style="text-align:center"><b>Show this to friends to add your result to their table.</b>
      <canvas id="g-rqr" width="520" height="520" style="width:70%;max-width:260px;display:block;margin:8px auto;border-radius:8px"></canvas>
      <div class="btnrow"><button id="g-rscan">Scan a friend's result</button><button id="g-rcopy">Copy my result</button></div></div>
    <div class="card"><b>Ten Telescopes leaderboard</b>
      <p class="muted small">Shares your name, score, scope, phone model${state.siteName ? ', site name' : ''} and latitude to the nearest degree — never your exact location.</p>
      <div class="btnrow"><button id="g-submit" class="primary" ${g.submitted ? 'disabled' : ''}>${g.submitted ? 'Submitted' : 'Submit score'}</button><button id="g-rboard">Show leaderboard</button></div>
      <div id="g-boardbox"></div></div>
    <div class="btnrow"><button id="g-again">Play again</button><button id="g-lobby">Done</button></div>`;
  drawQR($('#g-rqr'), code);
  $('#g-rscan').onclick = async () => { const c = await scanCode(); if (c) addFriendResult(c); };
  $('#g-rcopy').onclick = () => exportText('Skyward result', code);
  $('#g-submit').onclick = async () => {
    const row = scoreRow(r); const b = $('#g-submit'); b.disabled = true; b.textContent = 'Sending…';
    try { await submitScore(row, state); g.submitted = true; save(); b.textContent = 'Submitted'; toast('Score posted to the Ten Telescopes leaderboard'); showBoard($('#g-boardbox'), { challenge: g.ch.id }); }
    catch (e) {
      (state.pendingScores ||= []).push(row); g.submitted = true; save();
      b.textContent = 'Queued'; toast(navigator.onLine === false ? 'No signal — your score will be sent next time the app is online.' : `Couldn't post yet (${e.message}). Queued; it will retry.`, 5000);
    }
  };
  $('#g-rboard').onclick = () => showBoard($('#g-boardbox'), { challenge: g.ch.id });
  $('#g-again').onclick = () => loadChallenge(g.code);
  $('#g-lobby').onclick = () => { game = null; renderGame(); };
}
async function showBoard(box, q) {
  box.innerHTML = '<p class="muted small">Loading…</p>';
  try {
    const rows = await fetchBoard(q, state); save();
    box.innerHTML = rows.length ? `<table class="res"><tr><th>#</th><th>Player</th><th>Found</th><th>Time</th><th>Scope</th></tr>${rows.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.title)}${x.siteName ? `<br><span class="muted">${esc(x.siteName)}</span>` : ''}</td><td>${x.found}/${x.targets}</td><td>${fmtTime(x.totalSec)}</td><td class="small">${esc((x.scope || '').replace('Skyward ', ''))}</td></tr>`).join('')}</table>`
      : '<p class="muted small">No scores yet — be the first.</p>';
  } catch (e) { box.innerHTML = `<p class="small">Couldn't reach the leaderboard (${esc(e.message)}). It needs a signal; local results above still work offline.</p>`; }
}

// ---------------------------------------------------------------- TEST
let test = null; // {kind, rec, ...}
const TESTS = {
  check: { name: 'Phone check-up (4 min, no stars)', desc: 'Run this first on any new phone. Grades the phone in its mount against your eyepiece field: gyro present, tilt consistency, jitter, drift, behaviour from horizon to zenith, and full turns at the horizon.' },
  still: { name: 'Precision & drift', desc: 'Leave the scope untouched. Measures sensor noise (precision) and how fast readings wander (drift) for the gyro and the compass.' },
  repeat: { name: 'Repeatability', desc: 'Centre the same target several times, moving the scope well away in between. Shows how consistently the app reads the same spot.' },
  level: { name: 'Level bias (reversal)', desc: 'Phone flat on a table, then turned 180°. Separates the accelerometer\'s own bias from the table\'s tilt, with no reference needed.' },
  sky: { name: 'Sky accuracy', desc: 'Centre several known stars around the sky. Compares the sensors (and your alignment) against computed positions.' },
};
function renderTest() {
  const el = $('#tab-test');
  if (test) return renderTestRun();
  el.innerHTML = `${BACK}<h2>Phone check-up and sensor tests</h2>
    <p class="muted small">Run these on the scope with the phone in its dock unless the test says otherwise. Results are saved below and can be exported.</p>
    ${Object.entries(TESTS).map(([k, t]) => `<div class="card"><h3 style="margin-top:0">${t.name}</h3><p class="muted small">${t.desc}</p><button data-run="${k}" class="primary">Run</button></div>`).join('')}
    <h2>History</h2>
    ${state.history.length ? `<ul class="list">${state.history.slice().reverse().map((h, i) => `<li data-h="${state.history.length - 1 - i}"><div class="main"><div class="t1">${esc(TESTS[h.test]?.name || h.test)}</div><div class="t2">${new Date(h.when).toLocaleString()} · ${esc(h.scope)}${h.phone ? ' · ' + esc(h.phone) : ''}</div></div><div class="r small">${esc(h.summary || '')}</div></li>`).join('')}</ul>
    <div class="btnrow"><button id="exp-csv">Export CSV</button><button id="exp-json">Export JSON</button><button id="clr-h">Clear</button></div>` : '<p class="muted">No results yet.</p>'}
    <textarea id="exp-box" class="hidden" readonly></textarea>`;
  bindBack(el);
  el.querySelectorAll('[data-run]').forEach((b) => b.onclick = () => startTest(b.dataset.run));
  el.querySelectorAll('li[data-h]').forEach((li) => li.onclick = () => { const h = state.history[+li.dataset.h]; test = { kind: h.test, done: true, result: h.result, view: true, when: h.when }; renderTestRun(); });
  const ex = async (txt, name) => exportText(name, txt);
  if ($('#exp-csv')) { $('#exp-csv').onclick = () => ex(toCSV(state.history), 'skyward-sensor-tests.csv'); $('#exp-json').onclick = () => ex(JSON.stringify(state.history, null, 1), 'skyward-sensor-tests.json'); $('#clr-h').onclick = () => { if (confirmTwice('clr-h')) { state.history = []; save(); renderTest(); } }; }
}
function confirmTwice(id) { const b = $('#' + id); if (b.dataset.arm) return true; const label = b.textContent; b.dataset.arm = 1; b.textContent = 'Tap again to confirm'; setTimeout(() => { if (b.isConnected) { delete b.dataset.arm; b.textContent = label; } }, 3000); return false; }
async function exportText(name, text, box = $('#exp-box')) {
  if (navigator.share) { try { await navigator.share({ title: name, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); } catch (e) { /* fall back to the text box */ }
  if (box) { box.value = text; box.classList.remove('hidden'); box.focus(); box.select(); }
}
function startTest(kind) {
  if (!sensors || !sensors.fresh()) return toast('The motion sensors are off — tap the status at the top to start them');
  test = { kind, rec: new Recorder(sensors, model), marks: [], readings: [], dur: 60, armed: true, away: true };
  if (kind === 'check') Object.assign(test, { step: 'info', phone: state.phone || guessModel(), epIdx: state.ep, dur: 60 });
  test.rec.start(); renderTestRun();
}
function finishTest(result, summary) {
  if (test.rec) test.rec.stop();
  test.done = true; test.result = result;
  state.history.push({ test: test.kind, when: Date.now(), scope: profile().name, mounting: state.mounting, mode: state.mode, device: navigator.userAgent, phone: state.phone || guessModel(), result, summary });
  if (state.history.length > 300) state.history.shift();
  save(); renderTestRun();
}
function renderTestRun() {
  const el = $('#tab-test'); const T = TESTS[test.kind];
  const head = `<h2>${T.name}</h2>`;
  const back = `<div class="btnrow"><button id="t-back">${test.done ? 'Done' : 'Cancel'}</button></div>`;
  if (test.done) { el.innerHTML = head + resultHTML(test.kind, test.result) + back; }
  else if (test.kind === 'check') { renderCheckStep(el, head, back); }
  else if (test.kind === 'still') {
    el.innerHTML = head + `<p>Point the scope anywhere comfortable, let go, and don't touch it or the tripod.</p>
      <label class="row"><span>Duration</span><select id="t-dur">${[30, 60, 120, 300].map((s) => `<option value="${s}" ${s === test.dur ? 'selected' : ''}>${s < 60 ? s + ' s' : s / 60 + ' min'}</option>`).join('')}</select></label>
      <div class="bar"><div id="t-bar"></div></div><p id="t-live" class="muted small mono"></p>
      <div class="btnrow"><button id="t-go" class="primary">${test.running ? 'Recording…' : 'Start recording'}</button></div>` + back;
    $('#t-dur').onchange = (e) => test.dur = +e.target.value;
    $('#t-go').onclick = () => { if (test.running) return; test.running = true; test.rec.start(); test.tEnd = performance.now() + test.dur * 1000; $('#t-go').textContent = 'Recording…'; };
  } else if (test.kind === 'repeat') {
    const o = targetObj();
    el.innerHTML = head + `<label class="row"><span>Target</span><select id="t-tgt"><option value="land">Fixed land target (distant pole, tower light)</option>${o ? `<option value="sky" ${test.sky ? 'selected' : ''}>${esc(o.label)} (tracks sky motion)</option>` : ''}</select></label>
      <p>1. Centre the target and tap <b>Mark</b>. 2. Swing the scope at least 15° away. 3. Bring it back, re-centre, Mark again. Aim for 5–10 marks.</p>
      <p id="t-live" class="muted"></p>
      <div class="btnrow"><button id="t-mark" class="primary">Mark</button><button id="t-fin" ${test.marks.length >= 3 ? '' : 'disabled'}>Finish (${test.marks.length})</button></div>` + back;
    $('#t-tgt').onchange = (e) => { test.sky = e.target.value === 'sky'; test.marks = []; renderTestRun(); };
    $('#t-mark').onclick = () => {
      if (!test.away) return toast('Move at least 15° away and come back first');
      const m = test.rec.lastMean(1); if (!m) return;
      if (test.sky) m.truth = sky.altAz(targetObj());
      test.marks.push(m); test.away = false; test.lastMark = m; renderTestRun();
    };
    $('#t-fin').onclick = () => { const r = analyzeRepeat(test.marks); finishTest(r, `${fmt.am(Math.hypot(r.altStd, r.azStd))} σ`); };
  } else if (test.kind === 'level') {
    const n = test.readings.length;
    el.innerHTML = head + `<p class="muted small">Take the phone out of the mount for this one.</p>
      <p>${n % 2 === 0 ? `<b>Position A:</b> lay the phone flat on a firm table, against a straight edge (a book) so you can return it to the same spot.` : `<b>Position B:</b> rotate the phone 180° flat on the table, back against the same edge.`}</p>
      <p>Don't touch it while recording (2 s). Repeat A/B three times for a repeatability estimate.</p>
      <p id="t-live" class="muted small mono"></p>
      <div class="btnrow"><button id="t-rec" class="primary">Record ${n % 2 === 0 ? 'A' : 'B'} (${Math.floor(n / 2) + 1})</button><button id="t-fin" ${n >= 2 && n % 2 === 0 ? '' : 'disabled'}>Finish</button></div>` + back;
    $('#t-rec').onclick = () => {
      const btn = $('#t-rec'); btn.disabled = true; btn.textContent = 'Hold still…';
      setTimeout(() => {
        const now = (performance.now() - test.rec.t0) / 1000; const s = test.rec.samples.filter((x) => now - x.t <= 2 && x.euler);
        if (s.length < 5) { toast('Not enough samples'); return renderTestRun(); }
        test.readings.push({ beta: s.reduce((a, x) => a + x.euler[1], 0) / s.length, gamma: s.reduce((a, x) => a + x.euler[2], 0) / s.length });
        renderTestRun();
      }, 2100);
    };
    $('#t-fin').onclick = () => { const r = analyzeReversal(test.readings); finishTest(r, `bias ${fmt.am(r.pitchBias)} / ${fmt.am(r.rollBias)}`); };
  } else if (test.kind === 'sky') {
    refreshSky(true);
    const cands = sky.objects.filter((o) => (o.key.startsWith('st:') || (o.planet && o.id !== 'Moon')) && o.alt > 12 && o.alt < 82 && (o.mag ?? 9) < 3).sort((a, b) => a.az - b.az);
    el.innerHTML = head + `<p>Centre a star from the list in the eyepiece, then tap it. Spread them around the horizon and at different heights — at least 4 for the compass curve.</p>
      ${test.marks.length ? `<table class="res"><tr><th>Star</th><th>Az</th><th>Alt err</th><th>Compass err</th><th>Model err</th></tr>${test.marks.map((m) => `<tr><td>${esc(m.label)}</td><td>${m.truth.az.toFixed(0)}°</td><td>${fmt.am((m.alt - m.truth.alt) * 60)}</td><td>${m.caz == null ? '—' : fmt.deg(wrap180(m.caz - m.truth.az), 1)}</td><td>${m.model ? fmt.am(sepDeg(m.model.alt, m.model.az, m.truth.alt, m.truth.az) * 60) : '—'}</td></tr>`).join('')}</table>` : ''}
      <div class="btnrow"><button id="t-fin" ${test.marks.length >= 2 ? '' : 'disabled'}>Finish (${test.marks.length})</button></div>
      <ul class="list">${cands.map((o) => `<li data-k="${esc(o.key)}"><div class="main"><div class="t1">${esc(o.label)}</div></div><div class="r num">mag ${(+o.mag).toFixed(1)}</div><div class="r num" style="min-width:70px">${o.alt.toFixed(0)}° ${compassName(o.az)}</div></li>`).join('')}</ul>` + back;
    el.querySelectorAll('li[data-k]').forEach((li) => li.onclick = () => {
      const o = sky.objects.find((x) => x.key === li.dataset.k); const m = test.rec.lastMean(1); if (!m) return;
      m.truth = sky.altAz(o); m.label = o.label;
      { const R = avgR(1); if (R) align.confirm.push({ key: o.key, label: o.label, R, alt: m.truth.alt, az: m.truth.az, t: Date.now(), kind: 'test', ep: align.epoch || 0 }); }
      if (state.mode === 'gyro' && align.fit) m.model = { alt: m.alt, az: wrap360(m.az + model.thetaAt()) };
      test.marks.push(m); renderTestRun();
    });
    $('#t-fin').onclick = () => { const r = analyzeAccuracy(test.marks); finishTest(r, `alt ${fmt.am(r.altErrMean)}${r.compassErrMean != null ? ' · compass ' + fmt.deg(r.compassErrMean, 1) : ''}${r.modelRms != null ? ' · model ' + fmt.am(r.modelRms) : ''}`); };
  }
  $('#t-back').onclick = () => { const finished = test.done && !test.view, kind = test.kind; if (test.rec) test.rec.stop(); test = null; if (finished && kind === 'check' && flowStepDone('check')) return; renderTest(); };
}
function updateTest() {
  if (!test || test.done || tab !== 'test') return;
  if (test.kind === 'check') return updateCheck();
  const live = $('#t-live'); const m = test.rec.lastMean(0.5);
  if (test.kind === 'still' && test.running) {
    const left = (test.tEnd - performance.now()) / 1000; $('#t-bar').style.width = `${100 * (1 - left / test.dur)}%`;
    if (m) live.textContent = `alt ${m.alt.toFixed(3)}°  az ${m.az.toFixed(3)}°  ${test.rec.samples.length} samples`;
    if (left <= 0) { const r = analyzeStillness(test.rec.samples); test.running = false; if (!r) { toast('Too few samples'); test.rec.start(); return; } finishTest(r, `σ ${fmt.am(r.altNoise)} / ${fmt.am(r.azNoise)} · drift ${fmt.rate(r.azDrift)}`); }
  }
  if (test.kind === 'repeat' && m) {
    if (test.lastMark && !test.away) { const d = sepDeg(m.alt, m.az, test.lastMark.alt, test.lastMark.az); if (d > 15) { test.away = true; } live.textContent = test.away ? 'Good — now return to the target and Mark.' : `Moved ${d.toFixed(1)}° — keep going (15° needed)`; }
    else live.textContent = test.marks.length ? 'Return to the target and Mark.' : 'Centre the target and Mark.';
  }
  if (test.kind === 'level' && test.rec.samples.length) { const e = test.rec.samples[test.rec.samples.length - 1].euler; if (e) live.textContent = `pitch ${e[1].toFixed(2)}°  roll ${e[2].toFixed(2)}°`; }
}
// ---------------------------------------------------------------- PHONE CHECK wizard
const CHECK_STEPS = ['info', 'level', 'still', 'sweep', 'swing'];
function checkProgress() { const i = CHECK_STEPS.indexOf(test.step); return i > 0 ? `<p class="muted small">Step ${i} of 4</p>` : ''; }
function nextCheckStep() {
  const i = CHECK_STEPS.indexOf(test.step);
  if (i < CHECK_STEPS.length - 1) { test.step = CHECK_STEPS[i + 1]; test.rec.start(); test.running = false; test.marks = []; test.turnAcc = 0; test.lastIdx = 0; renderTestRun(); }
  else finishCheck();
}
function finishCheck() {
  const ep = profile().eyepieces[test.epIdx] || eyepiece();
  const r = tfov(ep) * 60 / 2;
  const sensorsInfo = { gyro: sensors.hasGyro(), rateHz: sensors.rateHz, compass: !!sensors.hasCompass };
  test.sweep = test.sweepSamples ? analyzeAltSweep(test.sweepSamples, r, !!test.levelled) : null;
  test.turns = (test.turnSamples || []).map(analyzeHorizonTurn);
  const g = gradeCheck({ sensors: sensorsInfo, reversal: test.reversal, still: test.still, swing: test.swing, sweep: test.sweep, turns: test.turns }, r);
  const val = (k) => (g.metrics.find((m) => m.key === k) || {}).value;
  const result = { phone: test.phone, eyepiece: ep.name, fieldRadius: +r.toFixed(1), verdict: g.verdict, graded: g,
    noise: test.still ? Math.hypot(test.still.altNoise, test.still.azNoise) : null, driftDegPerMin: test.still ? test.still.azDrift : null,
    swingPerTurn: test.swing ? test.swing.worst : null, tiltRepeat: test.reversal && test.reversal.pairs.length > 1 ? Math.max(test.reversal.pitchBiasStd, test.reversal.rollBiasStd) : null,
    rateHz: sensorsInfo.rateHz, gyro: String(sensorsInfo.gyro), compassMode: g.compass, ceiling: test.sweep ? test.sweep.ceiling : null, altDynamic: test.turns && test.turns[0] && !test.turns[0].incomplete ? test.turns[0].altDynamic : null,
    raw: { reversal: test.reversal, still: test.still, swing: test.swing, sweep: test.sweep && { ...test.sweep }, turns: test.turns } };
  state.phonePerf = { phone: test.phone, when: Date.now(), noise: result.noise, drift: test.still ? test.still.azDrift : null, per90: test.swing ? test.swing.per90 : null,
    compassNoise: test.still ? test.still.compassNoise : null, compassSwing: test.swing ? test.swing.compassWorst : null };
  finishTest(result, `${({ solid: 'Solid', usable: 'Usable', poor: 'Poor', unsuitable: 'Not suitable', incomplete: 'Incomplete' })[g.verdict]}${val('noise') ? ' · jitter ' + val('noise') : ''}`);
}
function renderCheckStep(el, head, back) {
  const skip = `<button id="c-skip">Skip this step</button>`;
  if (test.step === 'info') {
    const gy = sensors.hasGyro();
    el.innerHTML = head + `<p>Four short steps, no stars needed — do it outdoors in daylight or at dusk. You'll need a table, the scope set up with the phone in its dock, and a distant landmark low on the horizon.</p>
      <p class="muted small">At the end you get a plain verdict: how far to trust the arrows on this phone.</p>
      <details class="more"><summary>Options and sensor details</summary>
      <label class="row"><span>Phone make and model <span class="muted small">(for your records)</span></span><input id="c-phone" value="${esc(test.phone)}" placeholder="e.g. Pixel 8, iPhone 13"></label>
      <label class="row"><span>Judge it against this eyepiece</span><select id="c-ep">${profile().eyepieces.map((e, i) => `<option value="${i}" ${i === test.epIdx ? 'selected' : ''}>${esc(e.name)} — ${(tfov(e) * 60).toFixed(0)}′ field</option>`).join('')}</select></label>
      <div class="card kv"><span>Gyroscope</span><span id="c-gyro">${gy === true ? 'present' : gy === false ? '<span class="bad">not found</span>' : 'checking…'}</span>
        <span>Update rate</span><span id="c-rate">${sensors.rateHz ? sensors.rateHz.toFixed(0) + ' Hz' : '…'}</span>
        <span>Compass</span><span id="c-comp">${sensors.hasCompass ? (sensors.compassSource || 'present') : 'checking…'}</span></div></details>
      <div class="btnrow"><button id="c-go" class="primary">Start</button></div>` + back;
    $('#c-phone').onchange = (e) => { test.phone = e.target.value.trim(); state.phone = test.phone; save(); };
    $('#c-ep').onchange = (e) => { test.epIdx = +e.target.value; };
    $('#c-go').onclick = () => { test.phone = $('#c-phone').value.trim(); state.phone = test.phone; save(); nextCheckStep(); };
  } else if (test.step === 'level') {
    const n = test.readings.length;
    const steps = [['A', 'Flat on the table, one end against a book or straight edge'], ['B', 'Turn it around 180° — the other end against the same edge'],
      ['A', 'Back to the first way round, same spot (repeat)'], ['B', 'Turned around again (repeat)']];
    el.innerHTML = head + checkProgress() + `<h3>Tilt sensor</h3>
      <p>Take the phone out of the mount. You'll record <b>four times, alternating A, B, A, B</b>. The second A and B are deliberate repeats: they show whether the sensor gives the same answer twice.</p>
      <ol class="steps">${steps.map(([pos, txt], i) => `<li class="${i < n ? 'done' : i === n ? 'now' : ''}"><b>${i < n ? '✓' : i + 1}. Position ${pos}</b> — ${txt}${i < n ? ` <span class="muted mono">(${test.readings[i].beta.toFixed(2)}°, ${test.readings[i].gamma.toFixed(2)}°)</span>` : ''}</li>`).join('')}</ol>
      <p class="muted small">Hands off while it records — 2 seconds.</p>
      <p class="muted small"><b>Camera bump?</b> It doesn't matter that the phone sits tilted, only that it sits the same way each time. If it rocks, put its case on, or let it settle onto the same corner every time before you record.</p>
      <div class="bar"><div id="t-bar"></div></div>
      <p id="t-live" class="muted small mono"></p>
      <div class="btnrow"><button id="t-rec" class="primary big">Record ${n + 1} of 4 — position ${steps[n][0]}${n >= 2 ? ' (repeat)' : ''}</button></div>
      <div class="btnrow">${skip}</div>` + back;
    $('#t-rec').onclick = () => {
      const btn = $('#t-rec'); btn.disabled = true; test.recEnd = performance.now() + 2000;
      setTimeout(() => {
        test.recEnd = 0;
        const now = (performance.now() - test.rec.t0) / 1000; const sm = test.rec.samples.filter((x) => now - x.t <= 2 && x.euler);
        if (sm.length < 5) { toast('The phone sent no sensor readings — check motion access is allowed, then try again', 5000); return renderTestRun(); }
        const b = sm.map((x) => x.euler[1]), g = sm.map((x) => x.euler[2]);
        if (Math.max(...b) - Math.min(...b) > 0.5 || Math.max(...g) - Math.min(...g) > 0.5) { toast('The phone moved while recording — let go of it and record again', 4000); return renderTestRun(); }
        test.readings.push({ beta: b.reduce((a, v) => a + v, 0) / b.length, gamma: g.reduce((a, v) => a + v, 0) / g.length });
        if (navigator.vibrate) navigator.vibrate(60);
        if (test.readings.length >= 4) { toast('Tilt sensor done ✓', 1500); test.reversal = analyzeReversal(test.readings); nextCheckStep(); }
        else { toast(`Recording ${test.readings.length} of 4 saved ✓ — now position ${steps[test.readings.length][0]}`, 2500); renderTestRun(); }
      }, 2050);
    };
  } else if (test.step === 'still') {
    el.innerHTML = head + checkProgress() + `<h3>Jitter & drift</h3>
      <p>Put the phone in its dock. Point the scope anywhere comfortable (not straight up), then let go of the scope and the tripod completely.</p>
      <div class="bar"><div id="t-bar"></div></div><p id="t-live" class="muted small mono"></p>
      <div class="btnrow"><button id="t-go" class="primary">${test.running ? 'Recording — hands off…' : 'Start 60 s recording'}</button>${skip}</div>` + back;
    $('#t-go').onclick = () => { if (test.running) return; test.running = true; test.rec.start(); test.tEnd = performance.now() + 60000; $('#t-go').textContent = 'Recording — hands off…'; };
  } else if (test.step === 'sweep') {
    const started = test.sweepStart != null;
    el.innerHTML = head + checkProgress() + `<h3>Horizon to zenith</h3>
      <p>${started ? 'Now raise the scope <b>slowly and steadily all the way to straight up</b> (about 10–15 s). Move only up — hold the rocker box so the base doesn\'t turn. Tap <b>Mark top</b> when it\'s vertical.'
        : 'Lower the scope to the horizon (as low as it goes). Hold the base still from here on — this step only moves the altitude axis.'}</p>
      ${started ? '' : `<label class="row"><span>Tube is confirmed horizontal using a level <span class="muted small">(optional — measures the phone's altitude zero)</span></span><input type="checkbox" id="c-lev" ${test.levelled ? 'checked' : ''}></label>`}
      <p id="t-live" class="muted mono"></p>
      <div class="btnrow"><button id="t-mark" class="primary">${started ? 'Mark top' : 'Mark start'}</button>${skip}</div>` + back;
    const lv = $('#c-lev'); if (lv) lv.onchange = (e) => { test.levelled = e.target.checked; };
    $('#t-mark').onclick = () => {
      const S = test.rec.samples;
      if (!started) { test.sweepStart = Math.max(0, S.length - 15); return renderTestRun(); }
      const seg = S.slice(test.sweepStart);
      if (!seg.length || Math.max(...seg.map((x) => x.alt)) < 75) return toast('Keep going — raise it all the way to straight up');
      test.sweepSamples = seg; nextCheckStep();
    };
  } else if (test.step === 'swing') {
    const n = test.marks.length;
    const msg = n === 0 ? 'Lower the scope to <b>just above the horizon</b> and centre a fixed landmark — a distant pole, chimney or tower light — in the eyepiece (or red-dot finder). Then tap <b>Mark start</b>.'
      : n === 1 ? 'Keeping the tube low, swing the scope <b>one full turn clockwise</b> at a steady pace (about 20–30 s), come back to the landmark, centre it exactly, and tap <b>Mark</b>.'
      : 'Now <b>one full turn counter-clockwise</b>, tube still low, back to the landmark, centre it, and tap <b>Mark</b>.';
    el.innerHTML = head + checkProgress() + `<h3>Full turns at the horizon</h3><p>${msg}</p>
      <p id="t-live" class="muted"></p>
      <div class="btnrow"><button id="t-mark" class="primary">${n === 0 ? 'Mark start' : 'Mark'}</button>${skip}</div>` + back;
    $('#t-mark').onclick = () => {
      if (n > 0 && Math.abs(test.turnAcc) < 300) return toast(`Only ${Math.abs(test.turnAcc).toFixed(0)}° turned — go all the way round`);
      const m = test.rec.lastMean(1); if (!m) return;
      m.turned = test.turnAcc; test.marks.push(m); test.turnAcc = 0;
      const S = test.rec.samples; if (n > 0) (test.turnSamples ||= []).push(S.slice(test.segStart)); test.segStart = S.length;
      if (test.marks.length >= 3) { test.swing = analyzeSwing(test.marks); nextCheckStep(); } else renderTestRun();
    };
  }
  const sk = $('#c-skip'); if (sk) sk.onclick = () => nextCheckStep();
}
function updateCheck() {
  const live = $('#t-live');
  if (test.step === 'info') {
    const gy = sensors.hasGyro(); const g = $('#c-gyro'); if (g) g.innerHTML = gy === true ? 'present' : gy === false ? '<span class="bad">not found</span>' : 'checking…';
    const r = $('#c-rate'); if (r) r.textContent = sensors.rateHz ? sensors.rateHz.toFixed(0) + ' Hz' : '…';
    const c = $('#c-comp'); if (c) c.textContent = sensors.hasCompass ? (sensors.compassSource || 'present') : 'none detected';
  }
  if (test.step === 'level' && live) {
    const e = test.rec.samples.length ? test.rec.samples[test.rec.samples.length - 1].euler : null;
    if (test.recEnd) { const left = Math.max(0, (test.recEnd - performance.now()) / 1000); const bar = $('#t-bar'); if (bar) bar.style.width = `${100 * (1 - left / 2)}%`; const btn = $('#t-rec'); if (btn) btn.textContent = `Recording… ${left.toFixed(1)} s — hands off`; }
    live.textContent = e ? `live: pitch ${e[1].toFixed(2)}°  roll ${e[2].toFixed(2)}°` : 'waiting for sensor readings…';
  }
  if (test.step === 'still' && test.running) {
    const left = (test.tEnd - performance.now()) / 1000; const bar = $('#t-bar'); if (bar) bar.style.width = `${100 * Math.min(1, 1 - left / 60)}%`;
    if (live) live.textContent = `${Math.max(0, left).toFixed(0)} s left · ${test.rec.samples.length} samples`;
    if (left <= 0) { test.running = false; test.still = analyzeStillness(test.rec.samples); if (!test.still) { toast('Too few samples — try again'); return renderTestRun(); } nextCheckStep(); }
  }
  if (test.step === 'sweep' && live) { const x = test.rec.samples[test.rec.samples.length - 1]; if (x) live.textContent = `altitude ${x.alt.toFixed(1)}°`; }
  if (test.step === 'swing') {
    const S = test.rec.samples; let i = Math.max(1, test.lastIdx || 1);
    for (; i < S.length; i++) test.turnAcc += wrap180(S[i].az - S[i - 1].az);
    test.lastIdx = S.length;
    if (live && test.marks.length) live.textContent = `Turned ${Math.abs(test.turnAcc).toFixed(0)}° ${test.turnAcc >= 0 ? 'clockwise' : 'counter-clockwise'}${Math.abs(test.turnAcc) >= 300 ? ' — now re-centre the landmark' : ''}`;
  }
}
function checkResultHTML(r) {
  const g = r.graded; if (!g) return '<p>No result.</p>';
  const V = { solid: 'SOLID', usable: 'USABLE', poor: 'POOR', unsuitable: 'NOT SUITABLE', incomplete: 'INCOMPLETE' }[g.verdict];
  return `<div class="card verdict v-${g.verdict}"><div class="vbig">${V}</div><div>${esc(g.summary)}</div>
      <div class="muted small">${esc(r.phone || 'Unnamed phone')} · graded against ${esc(r.eyepiece)} (field radius ${fmt.am(r.fieldRadius)})</div></div>
    <table class="res"><tr><th>Check</th><th>Measured</th><th>Grade</th></tr>
      ${g.metrics.map((m) => `<tr><td>${esc(m.name)}${m.critical ? '' : ' <span class="muted">(info)</span>'}</td><td>${esc(m.value)}</td><td class="${m.grade === 'poor' || m.grade === 'fail' ? 'bad' : ''}">${GRADE[m.grade]}</td></tr>`).join('')}
    </table>
    ${g.advice.length ? `<h3>What this means</h3><ul class="small">${g.advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${r.noise != null ? `<p class="small">Narrowest eyepiece field this phone can support right after a sync: about <b>${fmt.am(2 * Math.hypot(r.noise, (r.swingPerTurn || 0) / 8))}</b> across. The chart won't zoom tighter than its accuracy.</p>` : ''}
    ${g.compass ? `<p class="small">Compass mode on this phone: <b>${({ good: 'workable', ok: 'marginal', poor: 'not recommended' })[g.compass]}</b>. Gyro + star alignment is graded above.</p>` : ''}
    <p class="muted small">Each grade compares a measurement with your eyepiece's field. The cut-offs are design choices that haven't been checked against many real phones yet; the raw numbers are saved with the result (Export) so they can be tuned.</p>`;
}

function resultHTML(kind, r) {
  if (!r) return '<p>No result.</p>';
  if (kind === 'check') return checkResultHTML(r);
  const kv = (rows) => `<div class="card kv">${rows.filter(Boolean).map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('')}</div>`;
  if (kind === 'still') return kv([
    ['Duration · samples', `${r.duration.toFixed(0)} s · ${r.n} (${r.rateHz.toFixed(0)} Hz)`],
    ['Altitude noise (1σ)', fmt.am(r.altNoise)], ['Azimuth noise, gyro (1σ, on sky)', fmt.am(r.azNoise)],
    ['Altitude peak-to-peak', fmt.am(r.altPP)], ['Azimuth peak-to-peak', fmt.am(r.azPP)],
    ['Altitude drift', fmt.rate(r.altDrift)], ['Azimuth drift, gyro', fmt.rate(r.azDrift)],
    r.compassNoise != null && ['Compass noise (1σ)', fmt.am(r.compassNoise)], r.compassDrift != null && ['Compass drift', fmt.rate(r.compassDrift)],
  ]) + `<p class="muted small">Compare noise against your eyepiece field (${(tfov() * 60).toFixed(0)}′ with the ${esc(eyepiece().name)}). Gyro drift is what periodic re-syncs correct.</p>`;
  if (kind === 'repeat') return kv([
    ['Marks', `${r.n} over ${r.span.toFixed(1)} min`], ['Target', r.sky ? 'sky object (sky motion removed)' : 'fixed land target'],
    ['Altitude repeatability (1σ)', fmt.am(r.altStd)], ['Azimuth repeatability, gyro (1σ)', fmt.am(r.azStd)],
    ['Worst single return', fmt.am(r.maxDev)], r.azTrend != null && ['Azimuth trend across marks', fmt.rate(r.azTrend)],
    r.compassStd != null && ['Compass repeatability (1σ)', fmt.am(r.compassStd)], r.compassMeanError != null && ['Compass mean error vs true', fmt.deg(r.compassMeanError, 2)],
  ]);
  if (kind === 'level') return kv([
    ['Pitch bias (phone length axis)', fmt.am(r.pitchBias) + (r.pairs.length > 1 ? ` ± ${fmt.am(r.pitchBiasStd)}` : '')],
    ['Roll bias (phone width axis)', fmt.am(r.rollBias) + (r.pairs.length > 1 ? ` ± ${fmt.am(r.rollBiasStd)}` : '')],
    ['Table tilt (pitch / roll)', `${fmt.deg(r.surfPitch)} / ${fmt.deg(r.surfRoll)}`], ['A/B pairs', r.pairs.length],
  ]) + `<p class="muted small">Pitch bias adds directly to altitude readings. A 2-star alignment with tilt solving absorbs it, together with how the phone sits in the mount.</p>`;
  if (kind === 'sky') {
    let h = kv([
      ['Stars', r.n], [`Altitude error${profile().cal ? ' (after saved mount tilt)' : ', sensor + mount'} (mean ± 1σ)`, `${fmt.am(r.altErrMean)} ± ${fmt.am(r.altErrStd)}`],
      r.altScale != null && ['Altitude error trend', `${(r.altScale * 60).toFixed(2)}′ per degree of altitude`],
      r.compassErrMean != null && ['Compass error (mean ± 1σ)', `${fmt.deg(r.compassErrMean, 2)} ± ${fmt.deg(r.compassErrStd, 2)}`],
      r.deviation && ['Compass deviation vs azimuth', `${fmt.deg(r.deviation.amplitude, 2)} amplitude, peak at az ${r.deviation.phase.toFixed(0)}°`],
      r.modelRms != null && ['Aligned push-to error (RMS)', fmt.am(r.modelRms)], r.modelMax != null && ['Aligned push-to error (worst)', fmt.am(r.modelMax)],
    ]);
    if (r.compassErrMean != null) h += `<p class="muted small">The constant part of the compass error includes your local magnetic declination. A large deviation amplitude means something magnetic near the phone (steel screws, the D-cell counterweights) is bending the reading.</p><div class="btnrow"><button id="apply-cc">Use ${fmt.deg(-r.compassErrMean, 2)} as compass correction</button></div>`;
    setTimeout(() => { const b = $('#apply-cc'); if (b) b.onclick = () => { state.compassCorr = -r.compassErrMean; save(); toast('Compass correction saved'); }; });
    return h;
  }
  return '';
}

// ---------------------------------------------------------------- SETUP
const FOC = [[-90, 'Left side'], [-45, 'Upper left'], [0, 'Top'], [45, 'Upper right'], [90, 'Right side']];
function renderSetup() {
  const el = $('#tab-setup'); const p = profile();
  el.innerHTML = `${BACK}
    <h2>Telescope</h2>
    <label class="row"><span>Scope</span><select id="s-prof">${Object.entries(state.profiles).map(([k, v]) => `<option value="${k}" ${k === state.active ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
    <label class="row"><span>Focal length (mm)</span><input id="s-fl" type="number" inputmode="decimal" value="${p.fl}"></label>
    <label class="row"><span>Aperture (mm)</span><input id="s-ap" type="number" inputmode="decimal" value="${p.aperture}"></label>
    <div class="focpick"><div><b>Where is the focuser?</b><p class="muted small" style="margin:4px 0 0">Stand behind the telescope with the tube level, looking the way it points. Tap where the focuser sticks out. On a Skyward it is on the right.</p><p id="s-foclab" style="margin:8px 0 0"></p></div>
      <svg viewBox="0 0 160 112" role="group" aria-label="Focuser position"><circle cx="80" cy="70" r="30" class="fp-tube"/><circle cx="80" cy="70" r="20" class="fp-mirror"/><text x="80" y="74" text-anchor="middle" class="fp-t">tube</text>
      ${FOC.map(([v, l]) => { const s = Math.sin(v * D2R), c = Math.cos(v * D2R); return `<g data-foc="${v}" class="fp-opt${(p.focuser ?? 90) === v ? ' on' : ''}" role="button" aria-label="${l}"><line x1="${(80 + 30 * s).toFixed(1)}" y1="${(70 - 30 * c).toFixed(1)}" x2="${(80 + 44 * s).toFixed(1)}" y2="${(70 - 44 * c).toFixed(1)}"/><circle cx="${(80 + 52 * s).toFixed(1)}" cy="${(70 - 52 * c).toFixed(1)}" r="11"/></g>`; }).join('')}</svg></div>
    <p class="muted small">${esc(p.source || '')}</p>
    <h3>Eyepieces</h3>
    <p class="muted small">Focal length is printed on the eyepiece. Apparent field is the maker's figure for how wide the view looks (often 50°–70°). The app works out how much sky each one shows.</p>
    <table class="res"><tr><th>Name</th><th>Focal mm</th><th>Apparent field °</th><th>Shows</th><th>In use</th><th></th></tr>
      ${p.eyepieces.map((e, i) => `<tr><td><input data-epn="${i}" value="${esc(e.name)}"></td><td><input data-epf="${i}" type="number" value="${e.fl}" style="width:60px"></td><td><input data-epa="${i}" type="number" value="${e.afov}" style="width:60px"></td><td>${(tfov(e) * 60).toFixed(0)}′</td><td style="text-align:center"><input type="checkbox" data-epc="${i}" ${e.cycle !== false ? 'checked' : ''}></td><td><button data-epd="${i}">✕</button></td></tr>`).join('')}
    </table>
    <div class="btnrow"><button id="ep-add">Add eyepiece</button></div>
    <p class="muted small">The eyepiece button on the Observe screen cycles through the ticked eyepieces in this order. Add your own, untick ones you don't carry, or delete them. </p>
    <details class="more"><summary>Measure an eyepiece's field yourself (advanced)</summary>
    <p class="muted small">Time a star near the celestial equator drifting right across the field with the scope still.</p>
    <label class="row"><span>Drift time (s)</span><input id="drift-s" type="number" inputmode="decimal" placeholder="e.g. 140"></label>
    <label class="row"><span>Star declination (°)</span><input id="drift-d" type="number" inputmode="decimal" placeholder="e.g. 0"></label>
    <div class="btnrow"><button id="drift-go">Set the apparent field of the selected eyepiece</button></div></details>

    <details class="more"><summary>Phone mount and sensors (advanced)</summary>
    <label class="row"><span>Phone dock</span><select id="s-dock"><option value="yes" ${state.dock !== 'no' ? 'selected' : ''}>Yes, on a bridge mount</option><option value="no" ${state.dock === 'no' ? 'selected' : ''}>No, strapped to the tube</option></select></label>
    <div class="row" style="display:block"><span>Phone position</span><div id="s-mount">${mountPickerHTML()}</div></div>
    <label class="row"><span>Azimuth source</span><select id="s-mode"><option value="gyro" ${state.mode === 'gyro' ? 'selected' : ''}>Gyro + star alignment (recommended)</option><option value="compass" ${state.mode === 'compass' ? 'selected' : ''}>Compass (no alignment)</option></select></label>
    <label class="row"><span>Compass correction, true − magnetic (°)</span><input id="s-cc" type="number" inputmode="decimal" step="0.1" value="${(+state.compassCorr).toFixed(2)}"></label>
    <label class="row"><span>Apply measured gyro drift between syncs</span><input type="checkbox" id="s-rate" ${state.useRate ? 'checked' : ''}></label>
    <label class="row"><span>Smoothing (s)</span><select id="s-smooth">${[0.2, 0.4, 0.6, 1, 1.5, 2].map((v) => `<option ${v === state.smooth ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="btnrow"><button id="s-clrcal" ${p.cal ? '' : 'disabled'}>Forget saved mount tilt for ${esc(p.name)}</button></div>
    </details>

    <h2>Location</h2>
    <label class="row"><span>Latitude (°N)</span><input id="s-lat" type="number" inputmode="decimal" step="0.0001" value="${state.site.lat}"></label>
    <label class="row"><span>Longitude (°E, west is −)</span><input id="s-lon" type="number" inputmode="decimal" step="0.0001" value="${state.site.lon}"></label>
    <label class="row"><span>Elevation (m)</span><input id="s-el" type="number" inputmode="decimal" value="${state.site.elev}"></label>
    <p class="muted small">Source: ${esc(state.site.source)}. GPS works with no cell signal.</p>
    <div class="btnrow"><button id="s-gps">Use GPS</button></div>

    <h2>Display</h2>
    <label class="row"><span>Day look <span class="muted small">(off = Night, red only; the sun/moon button fades between them)</span></span><input id="s-day" type="checkbox" ${state.day ? 'checked' : ''}></label>
    <label class="row"><span>Screen brightness</span><input id="s-br" type="range" min="0.25" max="1" step="0.05" value="${state.bright}"></label>
    <label class="row"><span>Lowest altitude to list (°)</span><input id="s-min" type="number" value="${state.minAlt}"></label>
    <p class="muted small">Keep screen awake: ${awakeText()}. Sounds are under More.</p>

    <h2>About</h2>
    <p class="small">Skyward Push-To for Ten Telescopes' Skyward 150 Compact and Skyward 200 Visual.</p>
    <p class="muted small">Sky positions: Astronomy Engine © Don Cross (MIT). Deep-sky positions, sizes and magnitudes: OpenNGC © Mattia Verga (CC BY-SA 4.0). Caldwell, Herschel 400, RASC double-star and bright-star selections compiled from the PiFinder project's catalog files. Star field: Hipparcos main catalogue (ESA 1997). Constellation figures: Stellarium modern sky culture. Named asterisms: Saguaro Astronomy Club asterism list v3.2. Telescope specs from the TenTelescopes Skyward150 and Skyward200 repositories (CC BY-NC 4.0).</p>
    <p class="muted small mono" id="s-diag"></p>`;
  bindBack(el);
  const num = (id) => parseFloat($(id).value);
  $('#s-prof').onchange = (e) => { state.active = e.target.value; state.ep = 0; align = { obs: [], fit: null, syncs: [], confirm: [] }; applyModelSettings(); save(); renderSetup(); };
  $('#s-fl').onchange = () => { p.fl = num('#s-fl') || p.fl; save(); renderSetup(); };
  $('#s-ap').onchange = () => { p.aperture = num('#s-ap') || p.aperture; save(); };
  const focLab = () => { $('#s-foclab').innerHTML = 'Selected: <b>' + (FOC.find(([v]) => v === (p.focuser ?? 90)) || FOC[4])[1] + '</b>'; };
  focLab();
  el.querySelectorAll('[data-foc]').forEach((g) => g.onclick = () => { p.focuser = +g.dataset.foc; save(); el.querySelectorAll('[data-foc]').forEach((x) => x.classList.toggle('on', x === g)); focLab(); });
  el.querySelectorAll('[data-epn]').forEach((i) => i.onchange = () => { p.eyepieces[+i.dataset.epn].name = i.value; save(); });
  el.querySelectorAll('[data-epf]').forEach((i) => i.onchange = () => { p.eyepieces[+i.dataset.epf].fl = parseFloat(i.value) || 10; save(); renderSetup(); });
  el.querySelectorAll('[data-epa]').forEach((i) => i.onchange = () => { const e = p.eyepieces[+i.dataset.epa]; e.afov = parseFloat(i.value) || 50; e.verified = true; save(); renderSetup(); });
  el.querySelectorAll('[data-epd]').forEach((b) => b.onclick = () => { if (p.eyepieces.length > 1) { p.eyepieces.splice(+b.dataset.epd, 1); state.ep = 0; save(); renderSetup(); } });
  el.querySelectorAll('[data-epc]').forEach((i) => i.onchange = () => { p.eyepieces[+i.dataset.epc].cycle = i.checked; save(); });
  $('#ep-add').onclick = () => { p.eyepieces.push({ name: 'New eyepiece', fl: 10, afov: 52, verified: false }); save(); renderSetup(); };
  $('#drift-go').onclick = () => {
    const t = num('#drift-s'), d = num('#drift-d') || 0; if (!(t > 0)) return toast('Enter the drift time in seconds');
    const tf = t * 15.041 * Math.cos(d * D2R) / 3600; // true field, degrees (sidereal rate 15.041″/s)
    const e = eyepiece(); e.afov = +(tf * p.fl / e.fl).toFixed(1); e.verified = true; save(); toast(`True field ${(tf * 60).toFixed(1)}′ → AFOV ${e.afov}°`); renderSetup();
  };
  $('#s-dock').onchange = (e) => { state.dock = e.target.value; save(); };
  wireMountPicker($('#s-mount'), (ch) => { if (ch) toast(`Phone position: ${MOUNTINGS[state.mounting].where.toLowerCase()} — align again`); renderSetup(); const d = $('#s-mount').closest('details'); if (d) d.open = true; });
  $('#s-mode').onchange = (e) => { state.mode = e.target.value; save(); };
  $('#s-cc').onchange = () => { state.compassCorr = num('#s-cc') || 0; save(); };
  $('#s-rate').onchange = (e) => { state.useRate = e.target.checked; model.useRate = state.useRate; save(); };
  $('#s-smooth').onchange = (e) => { state.smooth = parseFloat(e.target.value); save(); };
  $('#s-clrcal').onclick = () => { p.cal = null; applyModelSettings(); save(); renderSetup(); };
  const site = () => { state.site = { lat: num('#s-lat'), lon: num('#s-lon'), elev: num('#s-el') || 0, source: 'entered manually' }; sky.setSite(state.site.lat, state.site.lon, state.site.elev); siteMoved(); save(); };
  ['#s-lat', '#s-lon', '#s-el'].forEach((id) => $(id).onchange = site);
  $('#s-gps').onclick = getGPS;
  $('#s-day').onchange = (e) => setShade(e.target.checked ? 0 : 1, true);
  $('#s-br').oninput = (e) => { state.bright = parseFloat(e.target.value); applyModelSettings(); save(); };
  $('#s-min').onchange = () => { state.minAlt = num('#s-min') || 0; save(); };
}
async function getGPS() {
  toast('Getting GPS fix…', 8000);
  const done = (lat, lon, elev, acc) => {
    state.site = { lat: +lat.toFixed(5), lon: +lon.toFixed(5), elev: Math.round(elev || state.site.elev || 0), source: `GPS ±${Math.round(acc)} m, ${new Date().toLocaleString()}` };
    sky.setSite(state.site.lat, state.site.lon, state.site.elev); planRows = null; rateCache.clear(); siteMoved(); save(); toast('Location set'); if (tab === 'setup') renderSetup(); if (tab === 'find') renderFind(); if (!$('#gate').classList.contains('hidden')) renderLaunch();
  };
  try {
    const G = cap('Geolocation');
    if (G) { await G.requestPermissions?.(); const p = await G.getCurrentPosition({ enableHighAccuracy: true, timeout: 30000 }); return done(p.coords.latitude, p.coords.longitude, p.coords.altitude, p.coords.accuracy); }
  } catch (e) { /* fall back to web API */ }
  if (!navigator.geolocation) return toast('No location service on this device');
  navigator.geolocation.getCurrentPosition((p) => done(p.coords.latitude, p.coords.longitude, p.coords.altitude, p.coords.accuracy), (e) => toast('Location failed: ' + e.message), { enableHighAccuracy: true, timeout: 30000, maximumAge: 600000 });
}

// ---------------------------------------------------------------- status + loop
function syncAgo() { const x = align.syncs[align.syncs.length - 1]; if (!x) return ''; const m = (Date.now() - x.t) / 60000; return m < 1 ? 'synced just now' : m < 90 ? `synced ${m.toFixed(0)} min ago` : `synced ${(m / 60).toFixed(1)} h ago`; }
/** One word for where pointing stands; drives the header pill. */
function pointState() {
  if (!sensors) return 'off'; if (!sensors.fresh()) return 'nodata';
  if (state.mode === 'compass') return 'compass';
  if (!align.fit) return 'unaligned';
  return align.suspect ? 'resync' : 'aligned';
}
function updateStatus() {
  const short = profile().name.replace(/^Skyward\s+/, ''), sc = $('#st-scope'); if (sc.textContent !== short) sc.textContent = short;
  const st = pointState();
  const txt = { off: 'Sensors off — tap', nodata: 'No sensor data — tap', compass: 'Compass mode', unaligned: 'Not aligned — tap',
    resync: 'Re-sync on a star', aligned: cap1(syncAgo()) }[st];
  const pill = $('#st-pill'); if (pill.textContent !== txt) pill.textContent = txt; if (pill.dataset.st !== st) pill.dataset.st = st;
  const d = $('#s-diag'); if (d && sensors) d.textContent = `${sensors.constructor === SimSensors ? 'SIMULATED · ' : ''}${sensors.rateHz.toFixed(0)} Hz · compass: ${sensors.compassSource || 'none'}${sensors.compassAccuracy != null ? ' ±' + sensors.compassAccuracy + '°' : ''}`;
}

// ---------------------------------------------------------------- keep the screen awake; notice when the app was put away
let wakeLock = null, awake = 'unknown', hiddenAt = 0;
// Times on screen (sunset, darkness, what is up) are worked out when a screen is drawn. A phone keeps the app open in
// the background for days, so redraw when it comes back after a while or the date has changed, and once a minute
// check whether the day has turned while it sat open.
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
let shownDay = dayKey();
function refreshForTime() {
  shownDay = dayKey(); planRows = null; rateCache.clear();
  if (!$('#gate').classList.contains('hidden')) renderLaunch();
  if (['plan', 'find', 'game', 'more'].includes(tab) && !(planEdit || planReorder)) showTab(tab);
}
setInterval(() => { if (document.visibilityState === 'visible' && dayKey() !== shownDay) refreshForTime(); }, 60000);
async function keepAwake() {
  try { const K = cap('KeepAwake'); if (K) { await K.keepAwake(); awake = 'on'; return; } } catch (e) { /* fall through to the web API */ }
  if (!('wakeLock' in navigator)) { awake = 'unsupported'; return; }
  try {
    if (document.visibilityState !== 'visible' || (wakeLock && !wakeLock.released)) return;
    wakeLock = await navigator.wakeLock.request('screen'); awake = 'on';
    wakeLock.addEventListener('release', () => { awake = 'released'; });
  } catch (e) { awake = 'failed'; }
}
const awakeText = () => ({ on: 'on while the app is open', released: 'on while the app is open', unknown: 'starts when you tap an activity',
  unsupported: "not supported by this browser — set your phone's Auto-Lock to Never while observing", failed: "couldn't be turned on here — set your phone's Auto-Lock to Never while observing" })[awake];
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  if (sensors) keepAwake();
  const away = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0; hiddenAt = 0;
  if (away > 600 || dayKey() !== shownDay) refreshForTime();
  if (away > 20 && align.fit && state.mode === 'gyro') {
    align.suspect = true; align.epoch = (align.epoch || 0) + 1;      // the heading may have jumped: objects from now on get their own offset
    toast('Welcome back. The phone may have lost track while the screen was off — centre a bright star and tap Sync before trusting the arrows.', 7000);
  }
});

// ---------------------------------------------------------------- OBSERVING LOG
let seenCache = null;
const seenSet = () => (seenCache ||= seenKeys(state.log));
const fullCon = (c) => (c ? conName(String(c).toUpperCase()) : '');
const RESULT = { yes: 'Seen', maybe: 'Not sure', no: 'Not seen' };
const shortDate = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
function logObservation(o, seen) {
  const before = logStats(state.log, sky.objects);
  (state.log ||= []).push({ key: o.key, label: o.label, t: Date.now(), seen, scope: profile().name, ep: eyepiece().name, sky: state.skyq ? state.skyq.label : '' });
  if (state.log.length > 5000) state.log.shift();
  seenCache = null;
  if (seen === 'yes') markDone(o.key, true);
  save();
  if (seen !== 'yes') { toast(seen === 'maybe' ? `Noted: not sure about ${o.label}. Worth another try on a darker night.` : `Noted: no luck with ${o.label} this time.`, 3200); return; }
  const after = logStats(state.log, sky.objects), fresh = newlyAchieved(before, after);
  if (fresh.length) { cue.milestone(); toast(`★ Milestone: ${fresh[fresh.length - 1].name}`, 4500); }
  else { cue.logged(); toast(isMessier(o) && !before.total ? `Logged ${o.label} ✓` : isMessier(o) ? `Logged ${o.label} ✓ — Messier ${after.messier} of ${after.messierTotal}` : `Logged ${o.label} ✓ — ${after.total} objects seen`, 3200); }
}
let logLimit = 60;
function renderLog() {
  const el = $('#tab-log'), log = state.log || [], st = logStats(log, sky.objects);
  const entries = log.map((e, i) => ({ e, i })).reverse();
  const pct = (a, b) => (b ? Math.min(100, 100 * a / b) : 0);
  el.innerHTML = `${BACK}<h2>Observing log</h2>
    ${log.length ? '' : '<p class="muted">Nothing logged yet. When a target is in the eyepiece, tap <b>Log</b> on the Observe screen. Your Messier count and milestones build up here.</p>'}
    <div class="stats"><div><b>${st.total}</b>object${st.total === 1 ? '' : 's'} seen</div><div><b>${st.messier}</b>of ${st.messierTotal} Messier</div><div><b>${st.nights}</b>night${st.nights === 1 ? '' : 's'} out</div></div>
    <div class="prog"><div class="lab"><span>Messier catalogue</span><span>${st.messier} / ${st.messierTotal}</span></div><div class="bar"><div style="width:${pct(st.messier, st.messierTotal)}%"></div></div></div>
    <div class="prog"><div class="lab"><span>Planets</span><span>${st.types.PL} / ${st.planetTotal}</span></div><div class="bar"><div style="width:${pct(st.types.PL, st.planetTotal)}%"></div></div></div>
    <p class="muted small">Galaxies ${st.types.GX} · Globular clusters ${st.types.GC} · Open clusters ${st.types.OC} · Nebulae ${st.types.NEB} · Double stars ${st.types.DS}${st.moon ? ' · the Moon' : ''}</p>
    <h3>Milestones</h3>
    <div class="badges">${MILESTONES.map((m) => { const h = Math.min(m.need, m.have(st)), got = h >= m.need; return `<div class="badge ${got ? 'got' : ''}"><b>${got ? '★ ' : ''}${esc(m.name)}</b>${esc(m.what)}${got ? '' : ` — ${m.need - h} to go`}</div>`; }).join('')}</div>
    ${entries.length ? `<h3>Entries</h3>
      <ul class="list">${entries.slice(0, logLimit).map(({ e, i }) => { const o = objByKey(e.key); return `<li><div class="main" data-lk="${esc(e.key)}"><div class="t1">${o ? nameHTML(o) : esc(e.label)}</div>
        <div class="t2">${shortDate(e.t)} · ${RESULT[e.seen] || esc(e.seen)} · ${esc((e.scope || '').replace(/^Skyward\s+/, ''))}${e.ep ? ' · ' + esc(e.ep) : ''}</div></div><button class="ibtn" data-ldel="${i}" aria-label="Delete entry">✕</button></li>`; }).join('')}</ul>
      ${entries.length > logLimit ? `<div class="btnrow"><button id="lg-more">Show more (${entries.length - logLimit})</button></div>` : ''}
      <div class="btnrow"><button id="lg-exp">Share / export</button><button id="lg-clr">Clear log</button></div><textarea id="lg-box" class="hidden" readonly></textarea>` : ''}`;
  bindBack(el);
  el.querySelectorAll('[data-lk]').forEach((d) => d.onclick = () => openObject(d.dataset.lk));
  el.querySelectorAll('[data-ldel]').forEach((b) => b.onclick = () => { state.log.splice(+b.dataset.ldel, 1); seenCache = null; save(); renderLog(); });
  if ($('#lg-more')) $('#lg-more').onclick = () => { logLimit += 100; renderLog(); };
  if ($('#lg-exp')) {
    $('#lg-exp').onclick = () => exportText('skyward-observing-log.csv', logCSV(state.log, sky.objects), $('#lg-box'));
    $('#lg-clr').onclick = () => { if (confirmTwice('lg-clr')) { state.log = []; seenCache = null; save(); renderLog(); } };
  }
}

// ---------------------------------------------------------------- OBJECT SHEET: what it is, how it looks tonight, what to do with it
function closeSheet() { $('#sheet').classList.add('hidden'); }
let sheetStep = null;                               // steps the open target page through the list it came from
function openObject(key, opt = {}) {
  const o = objByKey(key); if (!o) return;
  refreshSky(false);
  const box = $('#sheet'), card = $('#sheet-card');
  const row = opt.row || null, r = row || (o.alt > 0 ? rateNow(o) : null);
  const blurb = blurbFor(o), last = lastEntry(state.log, key), seen = seenSet().has(key);
  const inPlan = planList().some((x) => x.key === key && !x.sync), isTarget = !o.key.startsWith('st:') || o.show;
  // Opened from a list: step through that list with the arrows or a sideways swipe.
  const keys = opt.keys && opt.keys.length > 1 ? opt.keys : null, at = keys ? keys.indexOf(key) : -1, nav = at >= 0 ? { i: at, n: keys.length } : null;
  sheetStep = nav ? (d) => { const k = keys[at + d]; if (k) openObject(k, { ...opt, row: opt.rowFor ? opt.rowFor(k) : null }); } : null;
  card.innerHTML = `<div class="sheet-h"><div><div class="target-h"><span class="name">${esc(o.label)}</span>${o.name ? `<span class="cname">${esc(o.name)}</span>` : ''}</div>
      <div class="muted small">${esc(kindLabel(o))}${o.con ? ' in ' + esc(fullCon(o.con)) : ''}${o.key.startsWith('dso:') && o.label !== o.id ? ' · ' + esc(o.id) : ''}</div></div>
      <button class="ibtn" id="sh-x" aria-label="Close">✕</button></div>
    ${nav ? `<div class="shnav"><button id="sh-prev" aria-label="Previous target" ${nav.i === 0 ? 'disabled' : ''}>${ICON.prev}</button><span>${nav.i + 1} of ${nav.n} · swipe for the next</span><button id="sh-next" aria-label="Next target" ${nav.i === nav.n - 1 ? 'disabled' : ''}>${ICON.next}</button></div>` : ''}
    ${r ? `<p class="rateline"><span class="dots lv${r.level}">${DOTS[r.level]}</span> <b>${LEVEL_NAMES[r.level]}</b> ${row ? 'at its best in your session' : 'right now'} — ${esc(row ? row.desc : describe(o, r))}</p>` : (o.alt <= 0 ? '<p class="rateline muted">Below the horizon right now.</p>' : '')}
    ${blurb ? `<p class="blurb">${esc(blurb)}</p>` : ''}
    ${doubleNature(o) ? `<p class="small">${esc(NATURE_NOTE[doubleNature(o)])}</p>` : ''}
    ${tooWide(o, profile()) && o.t === 'AS' ? `<p class="small"><b>A naked-eye pattern.</b> At ${(o.maj / 60).toFixed(0)}° across it is far bigger than any eyepiece field, so there is no eyepiece view. Use Push to it and the sky chart to find it, then look up.</p>` : isTarget && o.alt != null ? `<div class="eprow" id="sh-eps">${profile().eyepieces.map((e, i) => ({ e, i })).sort((a, b) => b.e.fl - a.e.fl).map(({ e, i }) => `<figure><canvas width="300" height="300" data-epi="${i}"></canvas><figcaption><b>${esc(e.name)}</b><span>${(profile().fl / e.fl).toFixed(0)}×<span id="sh-epn${i}"></span></span></figcaption></figure>`).join('')}</div>
      <p class="muted small hidden" id="sh-more" style="text-align:right;margin:0">swipe for more ›</p>
      <p class="muted small" id="sh-epcap" style="text-align:center;margin-top:2px">In each of your eyepieces, to scale. Brightness is not to scale. Add or change eyepieces in Setup.</p>` : ''}
    <div class="kv">
      ${row ? `<span>Looks best at</span><span>${hm(row.best)} · ${row.alt.toFixed(0)}° ${compassName(row.az)}</span>` : ''}
      <span>Right now</span><span>${o.alt > 0 ? `${o.alt.toFixed(0)}° up, ${compassName(o.az)}` : 'below the horizon'}</span>
      ${r && r.ep ? `<span>Best eyepiece</span><span>${esc(r.ep.name)} (${(profile().fl / r.ep.fl).toFixed(0)}×)</span>` : ''}
      ${o.mag != null ? `<span>Brightness</span><span>magnitude ${(+o.mag).toFixed(1)}</span>` : ''}
      ${sizeText(o) ? `<span>${o.maj ? 'Size' : 'Pair'}</span><span>${sizeText(o)}</span>` : ''}
      <span>Your log</span><span>${seen ? 'Seen ✓' : last ? RESULT[last.seen] : 'Not logged yet'}${last ? ' · ' + shortDate(last.t) : ''}</span>
    </div>
    <div class="btnrow"><button id="sh-go" class="primary">Push to it</button>${isTarget ? `<button id="sh-plan">${inPlan ? '✓ In plan — remove' : '+ Add to plan'}</button>` : ''}</div>
    ${isTarget ? `<div class="btnrow"><button id="sh-seen">${seen ? 'Log it again ✓' : 'Log as seen ✓'}</button></div>` : '<p class="muted small">A bright star for aligning and syncing.</p>'}`;
  box.classList.remove('hidden'); card.scrollTop = 0;
  { const row = $('#sh-eps'), more = $('#sh-more'); if (row && more && row.scrollWidth > row.clientWidth + 4) { more.classList.remove('hidden'); row.addEventListener('scroll', () => more.classList.add('hidden'), { once: true, passive: true }); } }
  // one small preview per eyepiece
  card.querySelectorAll('#sh-eps canvas').forEach((cv) => {
    try {
      // Work the position out for this instant. The list's stored position can be minutes old, and the sky turns a
      // quarter of a degree a minute: enough to slide a high-power field right off the target's own stars.
      const p = profile(), e = p.eyepieces[+cv.dataset.epi], now = new Date(), tg = sky.altAz(o, now);
      const longest = p.eyepieces.reduce((a, x) => (x.fl > a.fl ? x : a), p.eyepieces[0]);
      const res = drawEyepiece(cv, sky, o.pairs && o.key.startsWith('st:') ? { ...o, t: 'DS' } : o, tg, e, p, { matrix: state.rot180 ? newtonianMatrix(tg, p.focuser ?? 90) : null, bright: vis(), refExit: p.aperture / (p.fl / longest.fl), thumb: true, date: now });
      const n = $('#sh-epn' + cv.dataset.epi); if (n && res) n.textContent = ` · ${res.tfov >= 1 ? res.tfov.toFixed(1) + '°' : (res.tfov * 60).toFixed(0) + '′'}`;
      if (res && res.widened) { const cap = $('#sh-epcap'); if (cap) cap.textContent = 'In each of your eyepieces. Close pairs are drawn a little wider than scale, so a split the eye would see is not lost in the small picture.'; }
      if (res && res.enlarged) { const cap = $('#sh-epcap'); if (cap) cap.textContent = `In each of your eyepieces. The planet is drawn ${res.enlarged}× larger than scale so you can see its shape. In the real eyepiece it looks smaller than this, but sharp.`; }
    } catch (err) { console.error(err); }
  });
  box.onclick = (e) => { if (e.target === box) closeSheet(); };
  $('#sh-x').onclick = closeSheet;
  if (nav) { $('#sh-prev').onclick = () => sheetStep(-1); $('#sh-next').onclick = () => sheetStep(1); }
  if (!card._swipe) {                                // one listener for the life of the page; it calls whatever list is current
    card._swipe = true; let t0 = null;
    card.addEventListener('touchstart', (e) => { const row = e.target.closest('.eprow'); t0 = e.touches.length === 1 && !(row && row.scrollWidth > row.clientWidth + 4) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    card.addEventListener('touchend', (e) => { if (!t0 || !sheetStep) return; const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y; t0 = null; if (Math.abs(dx) > 55 && Math.abs(dx) > 2 * Math.abs(dy)) sheetStep(dx < 0 ? 1 : -1); }, { passive: true });
  }
  $('#sh-go').onclick = () => { closeSheet(); state.target = key; save(); showTab('push'); };
  if ($('#sh-plan')) $('#sh-plan').onclick = () => {
    const P = planState(), i = P.items.findIndex((x) => x.key === key && !x.sync);
    if (i >= 0) P.items.splice(i, 1); else P.items.push({ key });
    save(); toast(i >= 0 ? `${o.label} removed from your plan` : `${o.label} added to your plan`, 1800);
    if (tab === 'plan') { const y = $('main').scrollTop; renderPlan(); $('main').scrollTop = y; }
    openObject(key, opt);
  };
  if ($('#sh-seen')) $('#sh-seen').onclick = () => { logObservation(o, 'yes'); if (tab === 'log') renderLog(); if (tab === 'find') fillFind(); openObject(key, opt); };
}

// ---------------------------------------------------------------- MORE
function renderMore() {
  const el = $('#tab-more'), chk = lastCheck(), st = logStats(state.log, sky.objects);
  const V = { solid: 'Solid', usable: 'Usable', poor: 'Poor', unsuitable: 'Not suitable', incomplete: 'Incomplete' };
  const item = (id, title, sub) => `<button class="act" data-go="${id}"><b>${title}</b><span class="muted small">${sub}</span></button>`;
  el.innerHTML = `<h2>More</h2>
    ${item('align', 'Star alignment', state.mode === 'compass' ? 'Compass mode — no alignment needed' : alignedNow() ? `Aligned on ${align.obs.map((o) => esc(o.label)).join(' and ')} · ${syncAgo()}` : 'Not aligned yet — two minutes, and the app shows you which stars')}
    ${item('log', 'Observing log', st.total ? `${st.total} object${st.total === 1 ? '' : 's'} seen · Messier ${st.messier} of ${st.messierTotal}` : 'Nothing logged yet — your Messier count and milestones live here')}
    ${item('sky', 'Sky darkness check', state.skyq ? `${esc(state.skyq.label)} · ${shortDate(state.skyq.when)}` : '30 seconds — tunes the visibility ratings to your sky')}
    ${item('horizon', 'Blocked sky', horizonNow() ? esc(horizonSummary(state.horizon)) : 'Mark trees and buildings so the app never sends you behind them')}
    ${item('test', 'Phone check-up and sensor tests', chk ? `This phone: ${V[chk.result.verdict] || esc(chk.result.verdict)} · ${shortDate(chk.when)}` : 'Find out how accurate this phone can be — 4 minutes')}
    ${item('setup', 'Setup', `${esc(profile().name)} · eyepieces, location, phone mount`)}
    ${item('camera', 'Camera star finder', state.mounting === 'camera' ? (profile().camBore ? 'Finds where the telescope points from the stars · lined up with the eyepiece' : 'Finds where the telescope points from the stars — no star to centre') : 'Works out where the phone’s camera is pointing from the stars')}
    ${item('backup', 'Back up or restore', state.backedUp ? `Last backup ${shortDate(state.backedUp)} · your log, plans and places` : 'Keep a copy of your log, plans and places — they live only on this phone')}
    ${item('start', 'Start screen', 'Choose what to do, and how it works')}
    <h3>Quick settings</h3>
    <label class="row"><span>Screen brightness</span><input id="m-br" type="range" min="0.25" max="1" step="0.05" value="${state.bright}" ${state.day ? 'disabled' : ''}></label>
    <label class="row"><span>Day look <span class="muted small">(switch off for the red Night look; the sun button at the top fades between the two)</span></span><input id="m-day" type="checkbox" ${state.day ? 'checked' : ''}></label>
    <div style="padding:10px 0 4px">Sounds</div>
    <div class="seg" id="m-snd">${[['off', 'Off'], ['chime', 'Chime'], ['guide', 'Chime + ticks']].map(([k, l]) => `<button data-snd="${k}" class="${state.sound === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="muted small">Chime: a tone when the target enters your eyepiece's field. Ticks get faster as you close in, so you can watch the sky instead of the phone. On an iPhone the silent switch may mute both.</p>
    <p class="muted small">Keep screen awake: ${awakeText()}.</p>
    <p class="muted small" style="text-align:center;margin-top:14px">Skyward Push-To · ${esc(($('#build') || {}).textContent || '')} · credits are in Setup</p>`;
  el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => {
    const k = b.dataset.go;
    if (k === 'sky') openSkyCheck(); else if (k === 'backup') openBackup(); else if (k === 'horizon') openHorizon('more'); else if (k === 'start') { renderLaunch(); $('#gate').classList.remove('hidden'); } else showTab(k);
  });
  $('#m-br').oninput = (e) => { state.bright = parseFloat(e.target.value); applyTheme(); save(); };
  $('#m-day').onchange = (e) => setShade(e.target.checked ? 0 : 1);
  el.querySelectorAll('[data-snd]').forEach((b) => b.onclick = () => { state.sound = b.dataset.snd; sound.mode = state.sound; save(); initSound(); cue.test(); renderMore(); });
}

let lastFrame = 0;
function loop(ts) {
  if (ts - lastFrame > 66) {
    lastFrame = ts; refreshSky(false);
    try { updateStatus(); if (tab === 'push') updatePush(); if (tab === 'align') updateAlign(); if (tab === 'game') updateGame(); if (tab === 'horizon') updateHorizon(); if (tab === 'route') updateRoute(ts); updateTest(); } catch (e) { console.error(e); }
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- LAUNCH: pick an activity, tick the warm-up steps
const ACTIVITIES = [
  ['observe', 'Observe', 'Follow the arrows to targets', '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'],
  ['explore', 'Explore', 'Wander the sky, no set-up', '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 16l.6 1.9 1.9.6-1.9.6L19 21l-.6-1.9-1.9-.6 1.9-.6z"/>'],
  ['game', 'Play', 'Messier Marathon or a timed race', '<circle cx="12" cy="14" r="7"/><path d="M12 14v-4M10 3h4M12 3v4M18.5 7.5 20 6"/>'],
  ['plan', 'Plan', 'Pick targets for a night out', '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L6.8 5M3.5 12l1.2 1.2L6.8 11M3.5 18l1.2 1.2L6.8 17"/>'],
];
const STEP_INFO = {
  check: ['Phone check-up', 'optional, 4 min, once per phone — how far to trust the arrows'],
  sky: ['Sky darkness check', '30 s — count Little Dipper stars'],
  horizon: ['Blocked sky', 'one slow turn with the phone, once per place'],
  align: ['Star alignment', '2 min — point at two bright stars'],
};
/** The stops that make sense on the way to each activity. Planning and exploring need no phone check-up. */
const PATH = { observe: ['check', 'sky', 'horizon', 'align'], game: ['check', 'horizon', 'align'], explore: ['sky', 'horizon'], plan: ['sky', 'horizon'], resume: ['check', 'sky', 'horizon', 'align'] };
/** Is a stop switched on? Blocked sky starts on until this spot has a map, then stays off unless the user ticks it. */
const stepOn = (k) => (k === 'horizon' ? (state.launch.horizon ?? (!horizonNow() && !curPlace())) : !!state.launch[k]);
const GO = { observe: 'Start observing', explore: 'Start exploring', game: 'Start the game', plan: 'Start planning' };
let flow = null;   // { steps: [..], i, dest, started, quiet }
const stepsFor = (dest) => (PATH[dest] || []).filter((k) => stepOn(k) && !(k === 'align' && alignedNow()));
/** "Dark from 6:32 PM · Moon 27% lit, sets 8:58 PM · Saturn and Jupiter are up" */
function tonightLine() {
  try {
    const now = new Date(), sun = sky.sunAlt(now), n = sky.nightAt(now);
    const dark = n.astro || n.naut, m = sky.moonInfo(now);
    const when = sun > -18 && dark && now < dark ? `${sun > 0 ? 'Daylight now — dark' : 'Getting dark — fully dark'} from ${hm(dark)}`
      : sun <= -18 ? `Dark now${n.astroAm ? ', until ' + hm(n.astroAm) : ''}` : sun > 0 ? 'Daylight' : 'Twilight';
    const moon = `Moon ${Math.round(m.frac * 100)}% lit${m.alt > 0 ? (n.moonSet && n.moonSet > now ? ', sets ' + hm(n.moonSet) : ', up') : (n.moonRise && n.moonRise > now ? ', rises ' + hm(n.moonRise) : ', down')}`;
    const at = dark && now < dark ? dark : now;
    const up = ['Venus', 'Jupiter', 'Saturn', 'Mars'].filter((p) => { const o = sky.objects.find((x) => x.key === 'pl:' + p); return o && sky.altAz(o, at).alt > 15; });
    return [when, moon, up.length ? `${up.join(' and ')} ${up.length > 1 ? 'are' : 'is'} up` : ''].filter(Boolean).join(' · ') + (siteKnown() ? '' : ' · worked out for Toronto until you set your location');
  } catch (e) { return ''; }
}
function planProgress() {
  const P = state.plan; if (!P || !P.items.length) return null;
  if (new Date(P.start).getTime() + P.hours * 3600000 < Date.now() - 6 * 3600000) return null;      // that session is long over
  const T = P.items.filter((x) => !x.sync), done = T.filter((x) => P.done && P.done[x.key]).length;
  const next = P.items.find((x) => !(P.done && P.done[x.key]));
  return { total: T.length, done, next: done < T.length ? next : null };
}
function renderLaunch() {
  const L = state.launch, chk = lastCheck(), sq = state.skyq, pp = planProgress();
  const V = { solid: 'solid', usable: 'usable', poor: 'poor', unsuitable: 'not suitable', incomplete: 'incomplete' };
  const status = {
    check: chk ? `done — ${V[chk.result.verdict] || chk.result.verdict}` : STEP_INFO.check[1],
    sky: sq ? `last: ${sq.label.toLowerCase()}` : STEP_INFO.sky[1],
    align: alignedNow() ? 'already aligned' : STEP_INFO.align[1],
    horizon: horizonNow() || placeLabel() ? hzLine() : STEP_INFO.horizon[1],
  };
  const act = ACTIVITIES.some((x) => x[0] === state.launchAct) ? state.launchAct : 'observe', stops = PATH[act];
  $('#launch').innerHTML = `<div class="lhead"><h1>Skyward <span>Push-To</span></h1><button class="hbtn shadebtn" id="l-shade" aria-label="Day or night look"></button></div>
    <p class="tonight">${esc(tonightLine())}</p>
    ${pp && pp.next ? `<button id="l-resume" class="primary" style="width:100%;margin:6px 0 2px">Carry on with your plan — ${pp.done} of ${pp.total} done</button>` : ''}
    <h3 class="lq">What are we up to?</h3>
    <div class="lgrid">${ACTIVITIES.map(([k, t, sub, ic]) => `<button class="act${k === act ? ' on' : ''}" data-act="${k}"><svg class="ic" viewBox="0 0 24 24">${ic}</svg><b>${t}</b><span class="muted">${sub}</span></button>`).join('')}</div>
    <div class="path">
      <div class="pnote">Your path — tap a star to skip a stop</div>
      ${['check', 'sky', 'horizon', 'align'].map((k) => (stops.includes(k)
    ? `<label class="stop"><input type="checkbox" data-step="${k}" ${stepOn(k) ? 'checked' : ''}><span><b>${STEP_INFO[k][0]}</b><span class="muted">${k === 'horizon' ? (stepOn(k) || horizonNow() || placeLabel() ? status[k] : 'skipped') : esc(stepOn(k) ? status[k] : k === 'check' && !chk ? 'optional — 4 min, shows how far to trust the arrows' : 'skipped')}</span></span>${k === 'horizon' ? '<button id="l-hz" class="mini" type="button">Open</button>' : ''}</label>`
    : `<div class="stop na"><input type="checkbox" disabled aria-hidden="true"><span><b>${STEP_INFO[k][0]}</b><span class="muted">not needed for this</span></span></div>`)).join('')}
      <div class="stop end"><span class="dest"></span><button id="l-go" class="primary">${GO[act]}</button></div>
    </div>
    <details class="more"><summary>How it works</summary>
      <ol class="how"><li><b>Clip the phone into its dock</b> — screen up, top of the phone toward the sky end of the tube.</li>
      <li><b>Align on two bright stars.</b> The app tells you which ones and where to look.</li>
      <li><b>Pick a target and follow the arrows.</b> A chime tells you when it should be in the eyepiece.</li>
      <li><b>Tap Sync whenever you centre something.</b> It keeps the pointing accurate all night.</li></ol>
      <p class="muted small">Works offline. Add it to your Home Screen for a full-screen app.</p></details>`;
  $('#launch').querySelectorAll('[data-step]').forEach((c) => c.onchange = () => { state.launch[c.dataset.step] = c.checked; save(); renderLaunch(); });
  $('#launch').querySelectorAll('[data-act]').forEach((b) => b.onclick = () => { const g = $('#gate'), y = g.scrollTop; state.launchAct = b.dataset.act; save(); renderLaunch(); g.scrollTop = y; });
  $('#l-go').onclick = () => launch(act);
  $('#l-hz').onclick = (e) => { e.preventDefault(); e.stopPropagation(); openHorizon('start'); };
  $('#l-shade').onclick = (e) => { e.stopPropagation(); openShade(); };
  if ($('#l-resume')) $('#l-resume').onclick = () => launch('resume');
  applyTheme();
}
// ---------------------------------------------------------------- camera star finder
// The phone's camera photographs the sky, the app recognises the stars, and that tells it where the telescope points —
// no star to pick, find or centre. Only meaningful for pointing when the phone is mounted looking along the tube.
let skyCam = null, camLast = null, camNote = '';
function closeCamera() { if (skyCam) skyCam.close(); skyCam = null; }
// In the iPhone app the camera goes through the native plug-in, which can set the exposure; on the web it is the browser's camera.
const nativeCam = () => cap('SkyCam');
const camBore = () => profile().camBore || [0, 0, 1];          // where the telescope points in the camera's picture (a ray; [0,0,1] = dead centre)
/** Sky direction (J2000, then alt/az now) of the telescope under a solution. */
function camTruth(sol) {
  const b = camBore(), R = sol.R, v = [R[0] * b[0] + R[1] * b[1] + R[2] * b[2], R[3] * b[0] + R[4] * b[1] + R[5] * b[2], R[6] * b[0] + R[7] * b[1] + R[8] * b[2]];
  const ra = (Math.atan2(v[1], v[0]) * R2D + 360) % 360, dec = Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D;
  return { ra, dec, ...sky.altAzRaDec(ra, dec) };
}
/** Use a camera solution for pointing: the first two fixes align the scope, later ones are syncs. Returns a sentence. */
function applyCameraFix(sol, refR) {
  if (state.mounting !== 'camera') return 'Not used for pointing: the phone position is not set to “Looking along the tube”.';
  if (!sensors || !sensors.fresh()) return 'Not used for pointing: the motion sensors are not running. Start them from the start screen.';
  const t = camTruth(sol), o = { key: 'cam:' + Date.now(), label: 'the camera', fix: { alt: t.alt, az: t.az }, R: refR || null };    // refR: the phone's attitude when the solved frame was taken
  if (state.mode === 'compass' || alignedNow()) return doSync(o) === false ? 'The camera fix was refused (see the message).' : 'Pointing synced to the camera.';
  const ob = makeObs(o); if (!ob) return 'Not used for pointing: no sensor data yet.';
  const raw = altAzFromVec(mulMV(ob.R, model.axis()));
  if (Math.abs(raw.alt - ob.alt) > 8) return `Not used: the camera puts the scope at ${ob.alt.toFixed(0)}° up, the tilt sensor says ${raw.alt.toFixed(0)}°. Check the phone is looking along the tube.`;
  if (align.obs.length && sepDeg(align.obs[0].alt, align.obs[0].az, ob.alt, ob.az) < 20) return 'That is too close to the first fix to align on. Swing the telescope to a different part of the sky (a quarter turn is ideal) and take another.';
  ob.label = `camera fix ${align.obs.length + 1}`; align.obs.push(ob); align.confirm.push({ ...ob, kind: 'align' }); refit();
  if (align.obs.length >= alignNeeded()) { cue.onTarget(); flowStepDone('align'); return 'Aligned from the camera. Pick a target and follow the arrows.'; }
  cue.sync(); return 'First fix taken. Now swing the telescope to a different part of the sky (a quarter turn is ideal) and take another.';
}
function renderCamera() {
  const el = $('#tab-camera'), along = state.mounting === 'camera', on = skyCam && skyCam.on, cal = profile().camBore;
  const r = camLast, sol = r && r.sol;
  let resultHTML = '';
  if (r) {
    const near = sol ? brightestNamedNear(sol) : null, t = sol ? camTruth(sol) : null;
    resultHTML = `<div class="card">
      <b class="${sol ? '' : 'warn'}" style="font-size:19px">${sol ? `Found it: ${near ? (near.d < 1.5 ? `on ${esc(near.name)}` : `${near.d.toFixed(0)}° from ${esc(near.name)}`) : `RA ${raHms(t.ra)}, Dec ${t.dec.toFixed(1)}°`}` : (r.an.stars.length < 5 ? 'Not enough stars to tell where this is' : 'Could not match these stars to the star map')}</b>
      ${sol ? `<p class="small" style="margin:4px 0">Telescope: ${t.alt.toFixed(1)}° up, ${compassName(t.az)} (${t.az.toFixed(1)}°). Recognised ${sol.n} of the ${sol.of} brightest stars.</p>` : ''}
      ${camNote ? `<p class="small" style="margin:4px 0"><b>${esc(camNote)}</b></p>` : ''}
      <p class="muted small" style="margin:4px 0">Sky ${r.plan.sky}, ${(r.an.mask.fraction * 100).toFixed(0)}% of the picture used. ${r.collected.toFixed(1)} s of light in ${r.N} frame${r.N === 1 ? '' : 's'}: ${esc(r.plan.why)}${r.plan.capped ? ' (stopped at the limit)' : ''}.${r.reg && (r.reg.moved || r.reg.rejected) ? ` The picture was moving: ${r.reg.moved} frame${r.reg.moved === 1 ? '' : 's'} lined up, ${r.reg.rejected} left out.` : ''}${r.an.mask.level > 765 * 0.5 ? ' This looks like daylight or a lit room, so it means nothing here.' : r.an.mask.fraction < 0.15 ? ' Hardly any of this is sky: aim away from trees and buildings.' : ''}</p>
      <canvas id="cam-pic" class="campic"></canvas>
      <p class="muted small" style="margin:4px 0">Grey stripes were ignored. Green circles are stars it recognised, yellow ones it did not. The green mark is where the telescope points.</p>
      ${sol && along ? `<details class="more"><summary>Line the camera up with the eyepiece ${cal ? '✓' : '(recommended once)'}</summary>
        <p class="muted small">The camera and the telescope never point in exactly the same direction. Centre a bright star in the eyepiece, take a fix, then say which star it was. From then on the green mark sits where the eyepiece looks.</p>
        ${camStars(sol).length ? `<label class="row"><span>Star in the eyepiece</span><select id="cam-star">${camStars(sol).map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('')}</select></label>
        <div class="btnrow"><button id="cam-cal">This star is centred in my eyepiece</button>${cal ? '<button id="cam-uncal">Forget</button>' : ''}</div>` : '<p class="muted small">No bright named star in this picture. Point at one, centre it in the eyepiece and take another fix.</p>'}
      </details>` : ''}
      <details class="more"><summary>Technical report</summary><div class="btnrow"><button id="cam-copy">Copy report</button></div><pre class="camrep">${esc(reportText(r, $('#build') ? $('#build').textContent : ''))}</pre></details>
    </div>`;
  }
  el.innerHTML = `${BACK}
    <h2>Camera star finder</h2>
    <p class="muted">The camera photographs the sky and the app recognises the stars, so it knows where the telescope points without you finding or centring anything.${nativeCam() ? '' : ' <span class="small">In a web browser the phone chooses the exposure; the iPhone app sets it for the sky.</span>'}</p>
    ${along ? '' : `<div class="card"><b>The camera has to look along the tube</b><p class="muted small" style="margin:4px 0 8px">In the dock on top of the tube, the camera faces the telescope and sees nothing. To use the camera for pointing, mount the phone at the back with its camera facing the sky end, then choose that position.</p><div class="btnrow"><button id="cam-along">Set phone position to “Looking along the tube”</button></div><p class="muted small" style="margin-bottom:0">Without that you can still hold the phone up to the sky and see what it recognises.</p></div>`}
    ${on ? `<div class="camstage">${skyCam.isNative ? '<canvas id="cam-v"></canvas>' : '<video id="cam-v" playsinline muted autoplay></video>'}<canvas id="cam-ov"></canvas></div>
      <p class="muted small" style="margin:4px 0">Grey stripes: not sky, ignored. Keep the phone still.</p>
      <div class="hzbar"><i id="cam-bar" style="width:0"></i></div>
      <p id="cam-status" class="small" style="min-height:1.4em">${along ? (alignedNow() ? 'Aligned. A fix here re-syncs the pointing.' : `Not aligned yet: ${align.obs.length ? 'one more fix, in a different part of the sky' : 'two fixes in different parts of the sky will do it'}.`) : ''}</p>
      <div class="actionbar"><button id="cam-go" class="primary wide">Find where I’m pointing</button><button id="cam-stop">Close camera</button></div>`
      : `<div class="btnrow"><button id="cam-start" class="primary">Start the camera</button></div><p id="cam-status" class="small"></p>`}
    ${resultHTML}`;
  bindBack(el);
  if ($('#cam-along')) $('#cam-along').onclick = () => { setMounting('camera'); toast('Phone position: looking along the tube'); renderCamera(); };
  if ($('#cam-start')) $('#cam-start').onclick = async () => {
    $('#cam-status').textContent = 'Opening the camera…';
    renderCameraLive(); if (!skyCam || !skyCam.on) return;
  };
  if (on) attachCamera();
  if ($('#cam-stop')) $('#cam-stop').onclick = () => { closeCamera(); renderCamera(); };
  if ($('#cam-go')) $('#cam-go').onclick = cameraFind;
  if (r && $('#cam-pic')) drawResult($('#cam-pic'), r, camBore());
  if ($('#cam-copy')) $('#cam-copy').onclick = async () => { try { await navigator.clipboard.writeText(reportText(r, $('#build').textContent)); toast('Report copied'); } catch (e) { toast('Could not copy; select the text instead'); } };
  if ($('#cam-cal')) $('#cam-cal').onclick = () => {
    const st = camStars(sol)[+$('#cam-star').value]; if (!st) return;
    const x = (st.x - r.w / 2) / sol.f, y = (st.y - r.h / 2) / sol.f, l = Math.hypot(x, y, 1), off = Math.atan(Math.hypot(x, y)) * R2D;
    if (off > 12) return toast(`${st.name} is ${off.toFixed(0)}° from the middle of the picture. That is too far to be the star in the eyepiece. Nothing was changed.`, 6000);
    profile().camBore = [x / l, y / l, 1 / l]; save(); camNote = `Lined up on ${st.name}: the eyepiece looks ${off.toFixed(1)}° from the middle of the camera's picture.`; toast('Camera lined up with the eyepiece'); renderCamera();
  };
  if ($('#cam-uncal')) $('#cam-uncal').onclick = () => { delete profile().camBore; save(); camNote = 'Line-up forgotten: the middle of the picture is used.'; renderCamera(); };
}
/** Bright named stars inside a solved picture, nearest the telescope mark first. */
function camStars(sol) {
  if (!camLast) return []; const { w, h } = camLast, b = camBore(), bx = w / 2 + sol.f * b[0] / b[2], by = h / 2 + sol.f * b[1] / b[2], out = [];
  for (const o of sky.objects) {
    if (!o.key.startsWith('st:') || (o.mag ?? 9) > 3.2 || o.ra == null) continue;
    const p = projectStar(sol, w, h, o.ra, o.dec); if (!p || p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
    out.push({ name: o.label, x: p.x, y: p.y, d: Math.hypot(p.x - bx, p.y - by) });
  }
  return out.sort((a, c) => a.d - c.d).slice(0, 12);
}
function brightestNamedNear(sol) {
  const t = camTruth(sol); let best = null;
  for (const o of sky.objects) { if (!o.key.startsWith('st:') || (o.mag ?? 9) > 2.6 || o.ra == null) continue; const d = sepDeg(t.dec, t.ra, o.dec, o.ra); if (!best || d < best.d) best = { d, name: o.label }; }
  return best;
}
async function renderCameraLive() {
  try {
    const plug = nativeCam();
    if (plug) skyCam = new NativeSkyCamera(plug, null, null);
    else { const holder = document.createElement('video'); holder.playsInline = true; holder.muted = true; skyCam = new SkyCamera(holder, null); }
    await skyCam.open();
  } catch (e) { skyCam = null; const st = $('#cam-status'); if (st) st.textContent = 'Could not open the camera: ' + (e.message || e.name) + '. Check that camera access is allowed.'; return; }
  renderCamera();
}
// The video element lives in the page, which is redrawn; move the running stream onto the fresh element each time.
function attachCamera() {
  const v = $('#cam-v'), ov = $('#cam-ov'); if (!v || !skyCam) return;
  if (skyCam.v !== v) { if (!skyCam.isNative) { v.srcObject = skyCam.stream; v.play().catch(() => {}); } skyCam.v = v; }
  skyCam.ov = ov;
}
async function cameraFind() {
  if (!skyCam || !skyCam.on) return; const go = $('#cam-go'); if (go) go.disabled = true;
  const here = pointing(), prior = here && here.ready && alignedNow() ? { ...altAzToJ2000(sky, here.alt, here.az), radius: 25 } : null;
  try {
    let refR = null;
    // The picture scale learned from an earlier fix with this camera (kept per picture size); none the first time.
    const camKey = () => skyCam && skyCam.v ? `${skyCam.isNative ? 'n' : 'w'}` : 'w', known = (state.camScale || {})[camKey()];
    const r = await skyCam.find({ FIELD: STAR_FIELD, prior, scale: known ? { f: known.f, tol: 0.05, from: 'an earlier fix', w: known.w, h: known.h } : null, onReference: () => { refR = avgR(0.3) || (sensors && sensors.R) || null; }, align: !/[?&]noalign/.test(location.search), status: (t) => { const s = $('#cam-status'); if (s) s.textContent = t; }, progress: (f) => { const b = $('#cam-bar'); if (b) b.style.width = `${f * 100}%`; } });
    if (!r) return;
    camLast = r; camNote = r.sol ? applyCameraFix(r.sol, refR) : '';
    if (r.sol && r.sol.confidence === 'high') { state.camScale = { ...(state.camScale || {}), [camKey()]: { f: r.sol.f, w: r.w, h: r.h } }; save(); }
  } catch (e) { toast('Camera: ' + (e.message || e), 6000); }
  if (tab === 'camera') { renderCamera(); const c = $('#cam-pic'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

// ---- Phone position picker: a small picture of each way the phone can sit on the tube ----
const MOUNT_OFFERED = ['top-sky', 'side-sky', 'camera'];
function mountSVG(k) {
  const tube = '<rect x="30" y="10" width="36" height="96" rx="5" class="mt-tube"/><path d="M30 20h36" class="mt-rim"/><text x="48" y="7" class="mt-lab">sky end ★</text><text x="48" y="117" class="mt-lab">mirror end</text>';
  const side = k.startsWith('side'), top = k.startsWith('top');
  const foc = side ? '<circle cx="48" cy="29" r="6.5" class="mt-foc"/><circle cx="48" cy="29" r="3" class="mt-foc"/>' : '<rect x="66" y="23" width="10" height="11" rx="1.5" class="mt-foc"/>';
  let ph = '';
  if (top || side) {
    const up = k.endsWith('sky');
    ph = `<rect x="37" y="42" width="22" height="44" rx="3.5" class="mt-ph"/><rect x="39" y="${up ? 47 : 44.5}" width="18" height="36.5" rx="1.5" class="mt-scr"/><rect x="44" y="${up ? 43.6 : 82.6}" width="8" height="1.8" rx=".9" class="mt-ear"/><text x="48" y="${up ? 54.5 : 79}" class="mt-top">top</text>`;
  } else if (k.startsWith('across')) {
    const right = k === 'across-left';     // left edge to the sky end means the phone's top edge points to the right in this picture
    ph = `<rect x="26" y="53" width="44" height="22" rx="3.5" class="mt-ph"/><rect x="${right ? 28.5 : 31}" y="55" width="36.5" height="18" rx="1.5" class="mt-scr"/><rect x="${right ? 66.6 : 27.6}" y="60" width="1.8" height="8" rx=".9" class="mt-ear"/><text x="${right ? 58 : 38}" y="66.5" class="mt-top">top</text>`;
  } else {
    ph = '<rect x="28" y="92" width="40" height="5" rx="2" class="mt-ph"/><circle cx="48" cy="88" r="2.6" class="mt-ear"/><path d="M48 80V40m-5 7 5-7 5 7" class="mt-arrow"/>';
  }
  return `<svg viewBox="0 0 96 120" aria-hidden="true">${tube}${k === 'camera' ? '' : foc}${ph}</svg>`;
}
function mountPickerHTML() {
  // Only the three likely positions are offered; one chosen in an older build stays visible so nobody is stranded.
  const offered = Object.entries(MOUNTINGS).filter(([k]) => MOUNT_OFFERED.includes(k) || k === state.mounting);
  return `<div class="mnt-grid">${offered.map(([k, v]) => `<button class="mnt${k === state.mounting ? ' on' : ''}" data-mount="${k}" aria-pressed="${k === state.mounting}" aria-label="${esc(v.label)}">${mountSVG(k)}<b>${esc(v.where)}</b><span>${esc(v.edge)}</span></button>`).join('')}</div>
    <p class="muted small">Looking at the tube with the sky end at the top. The little bar and the word “top” mark the phone's top edge. ${state.mounting.startsWith('side') ? 'On the side, the round focuser is facing you.' : ''}</p>`;
}
function setMounting(k) {
  if (!MOUNTINGS[k] || k === state.mounting) return false;
  state.mounting = k;
  for (const pr of Object.values(state.profiles)) delete pr.cal;      // a remembered tilt belongs to the old position
  applyModelSettings(); align = { obs: [], fit: null, syncs: [], confirm: [] }; save(); return true;
}
function wireMountPicker(root, after) {
  root.querySelectorAll('.mnt').forEach((b) => { b.onclick = () => { const ch = setMounting(b.dataset.mount); after(ch); }; });
}
// Asked once, the first time someone heads for the telescope: the pointing depends on how the phone sits on the tube.
function askDock(dest) {
  const el = $('#dockq'), card = $('#dockq-card');
  const done = (v) => { state.dock = v; save(); el.classList.add('hidden'); launch(dest); };   // still inside the tap, so iOS will allow the motion prompt
  const ask = () => {
    card.innerHTML = `<h3 style="margin-top:0">One quick question</h3>
      <p><b>Does your telescope have a phone dock?</b></p>
      <p class="muted small">The dock holds your phone square to the tube. It sits on a bridge mount made for your telescope.</p>
      <div class="btnrow"><button id="dq-yes" class="primary">Yes</button><button id="dq-no">Not yet</button></div>
      <div class="btnrow"><button id="dq-other">My phone sits another way</button></div>
      <p class="muted small" style="margin-bottom:0">You can change this later in Setup.</p>`;
    $('#dq-yes').onclick = () => { setMounting('top-sky'); done('yes'); };
    $('#dq-no').onclick = none;
    $('#dq-other').onclick = other;
  };
  const none = () => {
    card.innerHTML = `<h3 style="margin-top:0">No dock? You can still try it</h3>
      <ol class="how"><li><b>Lay the phone flat on top of the tube</b>, screen up.</li>
      <li><b>Point the top of the phone at the sky end</b>, lined up with the tube as straight as you can.</li>
      <li><b>Strap it down firmly</b> — elastic bands work. It must not shift when you push the scope.</li></ol>
      <p class="muted small">Expect rougher pointing than with a dock. A phone that is crooked or slips will send you to the wrong spot, and you will need to Sync more often.</p>
      <div class="btnrow"><button id="dq-go" class="primary">Carry on</button><button id="dq-back">Back</button></div>
      <div class="btnrow"><button id="dq-other2">On the side of the tube instead</button></div>`;
    $('#dq-go').onclick = () => { setMounting('top-sky'); done('no'); };
    $('#dq-back').onclick = ask;
    $('#dq-other2').onclick = other;
  };
  const other = () => {
    card.innerHTML = `<h3 style="margin-top:0">How does your phone sit?</h3>
      <p class="muted small">Tap the picture that matches. It has to be held firmly and lined up with the tube as squarely as you can; the two alignment stars take care of the last few degrees.</p>
      ${mountPickerHTML()}
      <div class="btnrow"><button id="dq-go" class="primary">Carry on</button><button id="dq-back">Back</button></div>`;
    wireMountPicker(card, () => other());
    $('#dq-go').onclick = () => done(state.mounting === 'top-sky' ? 'yes' : 'no');
    $('#dq-back').onclick = ask;
  };
  ask(); el.classList.remove('hidden');
}
function launch(dest) {
  if (!siteKnown() && !locAsked) { askLocation(dest); return; }
  if (dest !== 'plan' && dest !== 'explore' && !state.dock) { askDock(dest); return; }
  initSound();                                    // audio can only start from a tap
  state.seenIntro = true;
  if (!state.launch.check && !lastCheck()) state.skipCheck = true;   // chose not to test: don't nag about it later
  save();
  flow = { steps: stepsFor(dest === 'resume' ? 'observe' : dest), i: -1, dest, started: false, quiet: dest === 'plan' };
  $('#gate-msg').innerHTML = '';
  // Planning needs no sensors, so it doesn't ask for motion access; "Start observing" asks later, when it's needed.
  if (dest === 'plan' || (sensors && sensors.fresh())) { $('#gate').classList.add('hidden'); if (sensors) keepAwake(); flowNext(); return; }
  startSensors(false);   // the tap is the user gesture iOS needs for motion permission
}
function flowGo() { if (flow) { flow.started = false; flowNext(); } }
function flowNext() {
  if (!flow) return;
  flow.started = true; flow.i++;
  $('#skycheck').classList.add('hidden');
  if (flow.i >= flow.steps.length) { const d = flow.dest; flow = null; renderFlowBar(); goActivity(d); return; }
  const k = flow.steps[flow.i];
  renderFlowBar();
  if (k === 'check') { showTab('test'); startTest('check'); }
  else if (k === 'sky') openSkyCheck();
  else if (k === 'horizon') openHorizon('flow');
  else if (k === 'align') showTab('align');
}
let nightNudged = false;
/** Once a session: heading out under a dark sky in the Day look? Point at the fader. */
function nightNudge() {
  try { if (!nightNudged && (state.shade ?? 0) < 0.5 && sky.sunAlt(new Date()) < -8) { nightNudged = true; setTimeout(() => toast('It is dark out — tap the sun at the top and slide to Night to keep your night vision.', 5000), 1500); } } catch (e) { /* no site yet */ }
}
function goActivity(d) {
  if (d !== 'plan') nightNudge();
  if (d === 'explore') { state.target = null; save(); showTab('push'); }
  else if (d === 'plan') showTab('plan');
  else if (d === 'game') showTab('game');
  else if (d === 'resume') { const pp = planProgress(); if (pp && pp.next) { state.target = pp.next.key; save(); showTab('push'); } else showTab('plan'); }
  else showTab('find');
}
/** The current tune-up step finished on its own (aligned, check done): move on without making the user find the bar. */
function flowStepDone(k) { if (flow && flow.steps[flow.i] === k) { if (k === 'check') { state.launch.check = false; save(); } flowNext(); return true; } return false; }
function renderFlowBar() {
  const bar = $('#flowbar');
  if (!flow || flow.i < 0 || flow.i >= flow.steps.length) { bar.classList.add('hidden'); return; }
  const k = flow.steps[flow.i], nextName = flow.i + 1 < flow.steps.length ? STEP_INFO[flow.steps[flow.i + 1]][0] : flow.dest === 'resume' ? 'Your plan' : ACTIVITIES.find((a) => a[0] === flow.dest)[1];
  bar.innerHTML = `<span>Step ${flow.i + 1} of ${flow.steps.length}: <b>${STEP_INFO[k][0]}</b></span><button id="fb-next" class="mini">Skip → ${esc(nextName)}</button><button id="fb-stop" class="mini" aria-label="Skip the rest">✕</button>`;
  bar.classList.remove('hidden');
  $('#fb-next').onclick = () => { if (k === 'check') { state.launch.check = false; save(); } flowNext(); };
  $('#fb-stop').onclick = () => { flow = null; renderFlowBar(); };
}

// Little Dipper sky check: the faintest Little Dipper stars you can see ≈ naked-eye limiting magnitude.
const UMI = [['Polaris', 37.95, 89.26, 1.98], ['Yildun', 263.05, 86.59, 4.35], ['ε', 251.49, 82.04, 4.21], ['ζ', 236.01, 77.79, 4.32],
  ['η', 244.38, 75.76, 4.95], ['Pherkad', 230.18, 71.83, 3.00], ['Kochab', 222.68, 74.16, 2.08]];
const SKY_PICKS = [[3.5, 'City'], [4.5, 'Bright suburbs'], [5.0, 'Suburbs'], [5.6, 'Edge of town'], [6.2, 'Rural'], [6.7, 'Dark site']];
// [naked-eye limit saved, faintest star drawn as visible, title, caption]
const SKY_LEVELS = [
  [2.8, 2.6, 'Two stars', 'Only Polaris and Kochab'],
  [3.5, 3.2, 'Three stars', 'Polaris, Kochab and Pherkad'],
  [4.3, 4.4, 'Most of the dipper', 'The handle and bowl, with a gap or two'],
  [5.0, 5.0, 'The whole dipper', 'All seven stars'],
  [5.7, 5.8, 'The dipper and more', 'All seven, with faint stars around them'],
];
function skyLabel(m) {
  return m < 3.5 ? ['Bright city sky', 'Moon, planets, bright clusters and double stars. Galaxies will be very hard.']
    : m < 4.5 ? ['Bright suburban sky', 'Planets, clusters, globulars, small planetary nebulae and the brightest galaxies.']
    : m < 5.3 ? ['Suburban sky', 'Most clusters and nebulae, and the brighter galaxies.']
    : m < 6 ? ['Rural sky', 'Most of the Messier list, including faint galaxies.']
    : ['Dark sky', 'Faint galaxies and large nebulae — a great night.'];
}
function openSkyCheck() {
  const box = $('#skycheck'), card = $('#skycheck-card'); box.classList.remove('hidden');
  if (state.site.lat < 5) {
    card.innerHTML = `<h3 style="margin-top:0">Sky darkness check</h3><p>The Little Dipper isn't visible from the southern hemisphere, so this check isn't available here yet.</p><button id="sq-skip" class="primary" style="width:100%">Continue</button>`;
    $('#sq-skip').onclick = () => (flow ? flowNext() : box.classList.add('hidden')); return;
  }
  // The Little Dipper as it hangs right now, plus the fainter stars around it (to mag 6) from the star field.
  const P = UMI.map(([n, ra, dec, m]) => ({ n, m, ...sky.altAzRaDec(ra, dec) }));
  const mid = { alt: (Math.max(...P.map((p) => p.alt)) + Math.min(...P.map((p) => p.alt))) / 2, az: P[5].az };
  const flat = (p) => { const t = tangentOffset(mid, p); return t ? { ...p, x: t.x, y: -t.y } : null; };
  const xy = P.map(flat), xs = xy.map((p) => p.x), ys = xy.map((p) => p.y), cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1, sc = 200 / span;
  const pt = (p) => [150 + (p.x - cx) * sc, 150 + (p.y - cy) * sc];
  let extra = [];
  try {
    extra = [...sky.fieldNear(mid.alt, mid.az, span, 6.0)].map(([, v]) => (v.mag <= 6 ? flat({ m: v.mag, alt: v.alt, az: v.az }) : null)).filter(Boolean)
      .filter((q) => { const [x, y] = pt(q); return x > 8 && x < 292 && y > 8 && y < 270 && !xy.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 0.4); });
  } catch (e) { /* the dipper alone still works */ }
  const lines = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]];
  const sun = sky.sunAlt();
  let lv = Math.max(0, SKY_LEVELS.findIndex((L) => state.skyq && Math.abs(L[0] - state.skyq.nelm) < 0.05)); if (!state.skyq) lv = 2;
  const rad = (m) => Math.max(1.6, (6.6 - m) * 1.35);
  const chart = () => {
    const lim = SKY_LEVELS[lv][1], dot = (p, named) => { const [x, y] = pt(p), on = p.m <= lim; return `<circle class="${on ? 'on' : 'off'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad(p.m).toFixed(1)}"/>${named && p.m < 3.2 ? `<text class="${on ? '' : 'off'}" x="${(x + 10).toFixed(1)}" y="${(y + 4).toFixed(1)}">${p.n}</text>` : ''}`; };
    return `${lines.map(([i, j]) => { const [x1, y1] = pt(xy[i]), [x2, y2] = pt(xy[j]); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; }).join('')}
      ${extra.map((p) => dot(p, false)).join('')}${xy.map((p) => dot(p, true)).join('')}
      <text x="150" y="292" text-anchor="middle" class="muted">as it hangs now · up is overhead · bright = you can see it</text>`;
  };
  card.innerHTML = `<h3 style="margin-top:0">Sky darkness check</h3>
    <p class="small">Face north and find the Little Dipper hanging from <b>Polaris</b>, ${P[0].alt.toFixed(0)}° up. Give your eyes 10 minutes away from screens and lights. Then flip through the pictures until one matches what you see.${sun > -12 ? ' <b>It isn\'t fully dark yet</b>, so this will read brighter than your real sky.' : ''}</p>
    <svg viewBox="0 0 300 300" class="umi" id="sq-svg"></svg>
    <div class="sqnav"><button id="sq-less" aria-label="Fewer stars">${ICON.prev}</button>
      <div class="sqmid"><b id="sq-title"></b><span id="sq-cap" class="muted small"></span><span class="sqdots" id="sq-dots"></span></div>
      <button id="sq-more" aria-label="More stars">${ICON.next}</button></div>
    <button id="sq-ok" class="primary" style="width:100%;margin-top:8px">That's my sky — OK</button>
    <button id="sq-skip" style="width:100%;margin-top:6px">Can't see it (cloud, trees, not dark) — skip</button>`;
  const show = () => {
    $('#sq-svg').innerHTML = chart(); $('#sq-title').textContent = SKY_LEVELS[lv][2]; $('#sq-cap').textContent = SKY_LEVELS[lv][3];
    $('#sq-dots').innerHTML = SKY_LEVELS.map((_, i) => `<i class="${i === lv ? 'on' : ''}"></i>`).join('');
    $('#sq-less').disabled = lv === 0; $('#sq-more').disabled = lv === SKY_LEVELS.length - 1;
  };
  $('#sq-less').onclick = () => { lv = Math.max(0, lv - 1); show(); };
  $('#sq-more').onclick = () => { lv = Math.min(SKY_LEVELS.length - 1, lv + 1); show(); };
  let sx = null; const svg = $('#sq-svg');                              // swipe the picture as well
  svg.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  svg.addEventListener('touchend', (e) => { if (sx == null) return; const d = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(d) > 30) { lv = Math.max(0, Math.min(SKY_LEVELS.length - 1, lv + (d < 0 ? 1 : -1))); show(); } });
  show();
  $('#sq-ok').onclick = () => {
    const m = SKY_LEVELS[lv][0], [label, means] = skyLabel(m);
    state.skyq = { nelm: m, label, when: Date.now(), lat: state.site.lat, lon: state.site.lon, twilight: sun > -12 }; planRows = null; save(); if (tab === 'plan') renderPlan();
    card.innerHTML = `<h3 style="margin-top:0">${label}</h3><p>Faintest stars you can see: about magnitude ${m.toFixed(1)}.</p><p class="small">${means}</p>
      <button id="sq-done" class="primary" style="width:100%">${flow ? 'Continue' : 'Done'}</button>`;
    $('#sq-done').onclick = () => { if (flow) return flowNext(); box.classList.add('hidden'); rateCache.clear(); if (tab === 'more') renderMore(); if (tab === 'find') renderFind(); };
  };
  $('#sq-skip').onclick = () => (flow ? flowNext() : box.classList.add('hidden'));
}

async function startSensors(sim) {
  const msg = $('#gate-msg');
  try {
    // Reuse sensors that are already listening: starting a second set would feed every reading in twice.
    if (sim || !(sensors && sensors.constructor === Sensors && sensors.started)) {
      sensors = sim ? new SimSensors() : new Sensors();
      await sensors.start(); sensors.on(onSensor); sensorT0 = performance.now();
    }
    if (sim) {
      window.sim = sensors; // arrow keys move the simulated scope: ←/→ azimuth, ↑/↓ altitude (Shift = fine)
      // Test hook (simulator only): point the simulated scope at an object or at alt/az.
      window.simGoto = (k, dAlt = 0, dAz = 0) => { const o = typeof k === 'string' ? sky.objects.find((x) => x.key === k || x.label === k) : null; const t = o ? sky.altAz(o) : k; if (!t) return null; const e = eulerForMounting(state.mounting, t.alt + dAlt, wrap360(sensors.trueOffset - (t.az + dAz))); sensors.alpha = e.alpha; sensors.beta = e.beta; sensors.gamma = e.gamma; return { alt: t.alt, az: t.az }; };
      window.addEventListener('keydown', (e) => {
        const st = e.shiftKey ? 0.1 : 1;
        if (e.key === 'ArrowLeft') sensors.alpha += st; else if (e.key === 'ArrowRight') sensors.alpha -= st;
        else if (e.key === 'ArrowUp') sensors.beta = Math.min(89, sensors.beta + st); else if (e.key === 'ArrowDown') sensors.beta = Math.max(-10, sensors.beta - st);
      });
    }
    $('#gate').classList.add('hidden');
    initSound(); keepAwake();
    if (!sim && !siteKnown()) getGPS();
    if (tab === 'find') renderFind();
    if (flow && !flow.started) { flow.started = true; const t0 = Date.now(); const w = () => (sensors.fresh() || Date.now() - t0 > 2500 ? flowGo() : setTimeout(w, 100)); w(); }
    const quiet = !!(flow && flow.quiet); setTimeout(() => { if (!sensors.fresh() && !quiet) gateProblem('nodata'); }, 3000);
    return true;
  } catch (e) {
    if (flow && flow.quiet) { $('#gate').classList.add('hidden'); flowNext(); toast('Motion sensors not started — fine for planning. Tap the status bar later to start them.', 4500); return false; }
    gateProblem(/denied/i.test(e.message) ? 'denied' : 'error', e.message); return false;
  }
}
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** Show a clear, specific reason and fix on the start screen — never leave the user stuck there. */
function gateProblem(kind, detail = '') {
  $('#gate').classList.remove('hidden');
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  const fix = {
    denied: IS_IOS
      ? `<b>Your iPhone has blocked motion access for this app.</b> iOS won't ask again by itself. To reset it:<ol>
         ${standalone ? '<li>Press and hold the Skyward icon on your home screen → <b>Remove App</b> → Delete from Home Screen.</li><li>Open <b>Safari</b> → Settings app → <b>Apps → Safari → Advanced → Website Data</b> → swipe <b>github.io</b> → Delete.</li><li>In Safari open tentelescopes.github.io/skyward-pushto, <b>Share → Add to Home Screen</b>, open it and tap Start sensors → <b>Allow</b>.</li>'
                      : '<li>Settings app → <b>Apps → Safari → Advanced → Website Data</b> → swipe <b>github.io</b> → Delete.</li><li>Reload this page and tap Start sensors → <b>Allow</b>.</li>'}</ol>`
      : '<b>Motion access was blocked.</b> Allow motion/orientation sensors for this site in the browser\'s site settings, then reload.',
    nodata: `<b>The phone isn't sending motion data.</b> ${IS_IOS ? 'Close the app completely (swipe it away) and open it again, then tap Start sensors and choose Allow.' : 'This device may not have motion sensors (a desktop computer doesn\'t).'}`,
    error: `<b>Couldn't start the sensors.</b> ${detail}`,
  }[kind];
  const wipes = kind === 'denied' && IS_IOS;
  $('#gate-msg').innerHTML = `<div class="gate-err">${fix}${wipes ? `<p><b>Deleting website data also erases what this app has saved on the phone</b> (your log, plans and places). Back up first, then restore afterwards from More.</p><button id="gp-backup" class="primary">Back up my data first</button>` : ''}</div>`;
  if ($('#gp-backup')) $('#gp-backup').onclick = openBackup;
  $('#gate-skip').classList.remove('hidden');
}

async function init() {
  const saved = await loadState();
  state = Object.assign(structuredClone(DEFAULTS), saved || {});
  if ((state.v || 1) < 2) {                       // v2: kit is 23/10/4 mm at 62° AFOV (user, Nov 12)
    for (const k of ['sw150c', 'sw200v']) { const p = state.profiles[k]; if (p && p.eyepieces.length === 1 && /^23 mm/.test(p.eyepieces[0].name)) p.eyepieces = structuredClone(DEFAULT_PROFILES[k].eyepieces); }
    state.v = 2; state.ep = 0;
  }
  if (state.v < 3) { state.sort = 'best'; state.v = 3; }   // v3: Find opens on what looks best right now
  if (!Array.isArray(state.log)) state.log = [];
  sound.mode = state.sound || 'chime';
  if (state.rot180 == null) state.rot180 = true;
  for (const k of ['sw150c', 'sw200v']) if (state.profiles[k] && state.profiles[k].focuser == null) state.profiles[k].focuser = 90;   // Skyward: focuser always on the right
  for (const [k, v] of Object.entries(DEFAULT_PROFILES)) if (!state.profiles[k]) state.profiles[k] = structuredClone(v);
  // The 200 Visual was first entered as 203 mm / 812 mm. It is 200 mm f/4: correct a saved copy that still has the old figures.
  { const q = state.profiles.sw200v; if (q && q.aperture === 203 && q.fl === 812) { q.aperture = 200; q.fl = 800; q.source = DEFAULT_PROFILES.sw200v.source; } }
  if (state.calibrate == null) state.calibrate = true;
  sky.setSite(state.site.lat, state.site.lon, state.site.elev);
  applyModelSettings();
  document.querySelectorAll('nav#tabs button').forEach((b) => b.onclick = () => showTab(b.dataset.tab));
  $('#hb-day').onclick = (e) => { e.stopPropagation(); openShade(); };
  state.shade = 0;                                 // always open in the Day look; the fader is one tap away on every screen
  $('#hb-fs').innerHTML = ICON.full;
  $('#hb-fs').onclick = (e) => { e.stopPropagation(); toggleFullscreen(); };
  $('#st-scope').onclick = () => showTab('setup');
  $('#st-pill').onclick = () => { const st = pointState(); if (st === 'off' || st === 'nodata') { renderLaunch(); $('#gate').classList.remove('hidden'); } else showTab('align'); };
  // iOS ignores user-scalable=no: stop the page itself from pinch-zooming (the charts handle their own pinch).
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  if (IS_STANDALONE()) $('#hb-fs').classList.add('hidden');
  $('#fs-close').onclick = () => $('#fs-help').classList.add('hidden');
  applyTheme();
  renderLaunch();
  $('#gate-sim').onclick = () => startSensors(true);
  $('#gate-skip').onclick = () => { $('#gate').classList.add('hidden'); if (flow && !flow.started) flowNext(); toast('Browsing without sensors — drag the sky view to look around. Pointing needs them: tap the status at the top to turn them on.', 5500); };
  if (new URLSearchParams(location.search).has('sim')) $('#gate-sim').classList.remove('hidden');
  showTab('find');
  const flush = () => flushQueue(state).then((n) => { if (n) { save(); toast(`Sent ${n} queued score${n > 1 ? 's' : ''} to the leaderboard`); } }).catch(() => {});
  if (state.pendingScores && state.pendingScores.length) flush();
  window.addEventListener('online', flush);
  requestAnimationFrame(loop);
  if ('serviceWorker' in navigator && !window.Capacitor && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
