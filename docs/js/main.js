import { PointingModel, MOUNTINGS, eulerForMounting, fitAlignment, guidance, tangentOffset, mulMV, altAzFromVec, norm, wrap180, wrap360, sepDeg, D2R, R2D } from './model.js';
import { emptyHorizon, hasHorizon, limitAt, blocked, setWedge, wedgeLevel, wedgeHeight, newTrace, traceAdd, traceFinish, traceCoverage, summary as horizonSummary, WEDGES, LEVELS as HZ_LEVELS, BINS as HZ_BINS } from './horizon.js';
import { marathonList, pick as marathonPick, nightOf, syncStarFor } from './marathon.js';
import { nearPlaces, uniqueName, relocate, planAutoName, coordText, PLACE_IDEAS, distKm } from './places.js';
import { Sky, typeLabel, compassName, LINES, j2000Vec } from './astro.js';
import { activeShowers, feedObjects, loadKp, kpAt3h, auroraView, geomagLat } from './transients.js';
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
import { rate, describe, DOTS, LEVEL_NAMES, DEFAULT_NELM, tooWide, moonlessNelm, setSeeing, splitLimit, moonlight, twilight, skyFromNelm, cdFromSB, sbFromCd, nelmFromSky } from './vis.js';
import { DAYLIGHT, STYLES, PENALTY, pickTargets, routeOrder, pathLength, tokenFor, buildTokenIndex, encodeChallenge, decodeChallenge, challengeId, encodeResult, decodeResult, points, rank, fmtTime, dwell } from './game.js';
import { submitScore, fetchBoard, flushQueue } from './wixscores.js';
import qrcode from '../vendor/qrcode.mjs';
import { analyzeSwing, analyzeAltSweep, analyzeHorizonTurn, gradeCheck, guessModel, GRADE } from './check.js';
import { SkyCamera, NativeSkyCamera, drawResult, reportText, hms as raHms } from './camera.js';
import { learnHot } from './skycam.js';
import { project as projectStar } from './solve.js';
import { loadTowns, townsLoaded, nearestName, DARK_SITES } from './towns.js';
import { loadSkyGlow, skyGlowAt, nelmToSqm, bortleOfNelm, skyGlowGrid, cellSqm, bortleOf, sqmToNelm } from './skyglow.js';
import { FIELD as STAR_FIELD } from '../data/catalog.js';
import { hourlyForecast, hoursBetween, outlook, seeingWord, transpAdj, appleHourly, mergeApple, comfort, coldWord, ATTRIB, LICENCE_URL, SCALE } from './forecast.js';

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
/** How the eyepiece shows the sky: a Newtonian rotates it (by where the focuser sits); a refractor with a star diagonal
 *  shows it upright but mirror-reversed; a straight-through refractor turns it upside down. */
function viewMatrix(p, tg) {
  if (lensView(p)) return p.diagonal ? [[-1, 0], [0, 1]] : [[-1, 0], [0, -1]];
  return newtonianMatrix(tg, p.focuser ?? 90);
}
/** Refractors and Schmidt-Cassegrains / Maksutovs show the sky the same way: upside down straight through, upright but
 *  mirror-reversed with a star diagonal. Only a Newtonian rotates it by where its focuser sits. (Build 119) */
const lensView = (p) => p.type === 'refractor' || p.type === 'sct';
/** Telescope types someone can pick for their own scope. A Newtonian is stored without a type, like the Skywards. */
const SCOPE_TYPES = [['reflector', 'Reflector: Newtonian or Dobsonian (mirror)'], ['refractor', 'Refractor (lens)'], ['sct', 'Schmidt-Cassegrain or Maksutov']];
/** What's wrong with an aperture and focal length (mm), or '' when they make sense. */
function scopeErr(ap, fl) {
  if (!(ap >= 20 && ap <= 1500)) return 'Aperture should be between 20 and 1500 mm: the clear diameter of the main mirror or lens.';
  if (!(fl >= 100 && fl <= 10000)) return 'Focal length should be between 100 and 10000 mm. It is printed on the tube or in the manual (or aperture × the f-number).';
  const f = fl / ap; if (f < 2 || f > 30) return `That makes f/${f.toFixed(1)}, which no ordinary telescope is. Check the two numbers.`;
  return '';
}
/** The note on where a scope's numbers come from: the built-in scopes use the current wording (an older saved copy
 *  may still hold an earlier one), your own scope says so. (Build 122) */
const scopeNote = (p) => (!p.custom && DEFAULT_PROFILES[state.active] ? DEFAULT_PROFILES[state.active].source : p.source) || '';
const DEFAULT_PROFILES = {
  sw150c: { name: 'Skyward 150 Compact', aperture: 150, fl: 750,
    source: 'Skyward 150 mirror: 150 mm across, 750 mm focal length (sold as "D150F750": D for diameter, F for focal length). Edit if yours is marked differently.', focuser: 90,
    eyepieces: [{ name: '23 mm', fl: 23, afov: 62, verified: false }, { name: '10 mm', fl: 10, afov: 62, verified: false }, { name: '4 mm', fl: 4, afov: 62, verified: false }], cal: null },
  sw200v: { name: 'Skyward 200 Visual', aperture: 200, fl: 800,
    source: '200 mm f/4 primary, 800 mm focal length (confirmed by Ten Telescopes). Edit if your mirror is marked differently.', focuser: 90,
    eyepieces: [{ name: '23 mm', fl: 23, afov: 62, verified: false }, { name: '10 mm', fl: 10, afov: 62, verified: false }, { name: '4 mm', fl: 4, afov: 62, verified: false }], cal: null },
  sw400: { name: 'Skyward 400 (16-inch)', aperture: 406, fl: 1624,
    source: '16-inch (406 mm) f/4 primary, 1624 mm focal length. Placeholder figures for the 16-inch design: edit if your mirror is marked differently.', focuser: 90,
    eyepieces: [{ name: '23 mm', fl: 23, afov: 62, verified: false }, { name: '10 mm', fl: 10, afov: 62, verified: false }, { name: '4 mm', fl: 4, afov: 62, verified: false }], cal: null },
  ed80: { name: 'Orion 80ED', aperture: 80, fl: 600, type: 'refractor', diagonal: true,
    source: 'Orion ED80: 80 mm f/7.5 apochromatic refractor, 600 mm focal length (Orion), used with a 90° star diagonal.',
    eyepieces: [{ name: '23 mm', fl: 23, afov: 62, verified: false }, { name: '10 mm', fl: 10, afov: 62, verified: false }, { name: '4 mm', fl: 4, afov: 62, verified: false }], cal: null },
};
const DEFAULTS = {
  v: 1, profiles: DEFAULT_PROFILES, active: 'sw150c', mounting: 'top-sky', mode: 'gyro', compassCorr: 0,
  site: { lat: 43.65, lon: -79.38, elev: 100, source: 'default (Toronto) — set your location' },
  smooth: 0.6, minAlt: 10, bright: 1, ep: 0, useRate: false, catFilter: 'ALL', upOnly: true, sort: 'best',
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
/** A light tap from the iPhone's Taptic Engine when a swipe lands on the next card. Does nothing on the web or until
 *  the @capacitor/haptics plugin is installed in the iPhone app. */
function tick() { try { const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics; if (H && H.impact) H.impact({ style: 'LIGHT' }); } catch (e) { /* no haptics */ } }
/** A hint shown once per session at most (repeats are noise). */
const toastOnce = new Set();
function onceToast(id, msg, ms) { if (toastOnce.has(id)) return; toastOnce.add(id); toast(msg, ms); }
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); t.onclick = () => t.classList.add('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms); }
// Icons are drawn, not typed: several arrow and sun characters turn into colour emoji on iPhones, which ruins a red screen.
const svg = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  moon: svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
  full: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  prev: svg('<path d="m15 5-7 7 7 7"/>'), next: svg('<path d="m9 5 7 7-7 7"/>'),
  cloud: svg('<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18z"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.4 9.3a2.7 2.7 0 1 1 4.1 2.3c-.9.6-1.5 1.1-1.5 2.1"/><path d="M12 16.9v.1"/>'),
  plan: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L6.8 5M3.5 12l1.2 1.2L6.8 11M3.5 18l1.2 1.2L6.8 17"/>'),
  pin: svg('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'),
  half: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
  star: svg('<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z"/>'),
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
  const note = () => { const t = state.shade ?? 0; $('#sh-note').textContent = t > 0.97 ? 'red only, keeps your night vision' : t < 0.03 ? 'easy to read' : 'in between'; };
  note();
  $('#sh-range').oninput = (e) => { setShade(parseFloat(e.target.value), true); note(); };
  pop.querySelectorAll('.shend').forEach((b) => b.onclick = () => { setShade(+b.dataset.v, true); $('#sh-range').value = b.dataset.v; note(); });
  const close = (e) => { if (!pop.contains(e.target) && !e.target.closest('.shadebtn')) { pop.remove(); document.removeEventListener('pointerdown', close, true); if (tab === 'setup') renderSetup(); if (tab === 'more') renderMore();
    // the forecast tiles are coloured when drawn: redraw them for the new look (Build 125; they stayed blue at Night)
    if (!$('#gate').classList.contains('hidden')) renderLaunch(); else if (tab === 'plan') renderPlan(); } };
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
const bindSensBtn = (el) => { const b = $('#ps-sens', el); if (b) b.onclick = () => { showStart(); }; };
/** Measured compass uncertainty (arcmin) from the Phone check, or null if never measured. */
function guessUncertainty() { const ph = state.phonePerf; return ph && ph.compassNoise != null ? Math.hypot(ph.compassNoise, ph.compassSwing || 0) : null; }

// ---------------------------------------------------------------- tabs
// Five tabs; Align, Log, Tests and Setup live under More.
const PARENT = { help: 'more', align: 'more', log: 'more', test: 'more', setup: 'more', horizon: 'more', route: 'plan', camera: 'more', collim: 'more', sim: 'more' };
const scrollPos = {}; let pendingScroll = null;
function showTab(t) {
  const m = $('main'); if (tab && m) scrollPos[tab] = m.scrollTop;
  if (PARENT[t] && tab && !PARENT[tab]) backTo = tab;       // remember where a sub-screen was opened from
  if (tab === 'camera' && t !== 'camera') closeCamera();     // never leave the camera running behind another screen
  tab = t; const top = PARENT[t] || t;
  document.body.dataset.tab = top;                          // CSS hides the pointing status where it doesn't matter (Find, Plan, More)
  document.querySelectorAll('nav#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === top));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + t));
  ({ plan: renderPlan, find: renderFind, push: renderPush, align: renderAlign, game: renderGame, test: renderTest, setup: renderSetup, more: renderMore, log: renderLog, horizon: renderHorizon, route: renderRoute, camera: renderCamera, collim: renderCollim, sim: renderSim, help: renderHelp })[t]();
  // Lists reopen where you left them; every other screen starts at the top.
  pendingScroll = (t === 'find' || t === 'plan') && scrollPos[t] ? { t, y: scrollPos[t] } : null;
  m.scrollTop = pendingScroll ? pendingScroll.y : 0;
}
function restoreScroll() { if (pendingScroll && pendingScroll.t === tab) { $('main').scrollTop = pendingScroll.y; pendingScroll = null; } }
let backTo = 'more';                               // the main tab a sub-screen was opened from
let helpFrom = null;                               // 'start' when the help page was opened from the start screen (Back returns there)
// The key under the forecast tiles remembers whether it was left open (the toggle event doesn't bubble: capture it).
document.addEventListener('toggle', (e) => { const d = e.target; if (d && d.classList && d.classList.contains('tkeyd')) { state.ui = state.ui || {}; state.ui.tileKey = d.open; save(); } }, true);
const BACK = '<button class="back" data-back>‹ Back</button>';
function bindBack(el) { const b = $('[data-back]', el); if (!b) return; if (flow && flow.i >= 0 && flow.i < flow.steps.length) { b.remove(); return; } b.onclick = () => showTab(backTo); }
const dlg = () => $('#dlg'), dlgCard = () => $('#dlg-card');
function closeDlg() { const c = dlgCard(); dlg().classList.add('hidden'); c.innerHTML = ''; c.classList.remove('hdcard'); c.onpointerdown = c.onpointerup = null; dlg().onclick = null; document.documentElement.classList.remove('dlg-open'); }
/**
 * A button that acts on the finger lifting, not on iOS's "click", which it withholds whenever it suspects the touch
 * began a scroll; in a dialog over a scrolling page that swallowed taps (Build 115). A touch that moves under 12 px
 * counts as a tap; the click that follows is ignored so the action runs once. Mouse and keyboard still use click.
 */
let fastFired = 0;                                   // shared: the button that gets the trailing click may be a new one
function fastTap(el, fn) {
  if (!el) return; let p0 = null;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') p0 = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', (e) => {
    if (!p0 || el.disabled) return; const moved = Math.hypot(e.clientX - p0.x, e.clientY - p0.y); p0 = null;
    if (moved < 12) { e.preventDefault(); fastFired = performance.now(); fn(); }
  });
  el.addEventListener('pointercancel', () => { p0 = null; });
  el.addEventListener('click', (e) => { e.stopPropagation(); if (performance.now() - fastFired < 700) return; if (!el.disabled) fn(); });
}
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
        <div class="btnrow"><button id="loc-never" class="mini">Don't ask again</button></div>
        <p class="muted small" style="margin-bottom:0">It stays on this phone. GPS works with no cell signal.</p>`;
    dlg().classList.remove('hidden');
    if (ok) { $('#loc-go').onclick = () => { closeDlg(); if (dest) launch(dest); else renderLaunch(); }; return; }
    $('#loc-gps').onclick = async () => { $('#loc-gps').textContent = 'Finding you…'; getGPS(); const t0 = Date.now(); while (!siteKnown() && Date.now() - t0 < 32000 && !dlg().classList.contains('hidden')) await new Promise((r) => setTimeout(r, 250)); if (!dlg().classList.contains('hidden')) show(); };
    $('#loc-set').onclick = () => { const la = parseFloat($('#loc-lat').value), lo = parseFloat($('#loc-lon').value); if (!(Math.abs(la) <= 90) || !(Math.abs(lo) <= 180)) return toast('Latitude is between −90 and 90, longitude between −180 and 180.', 4000);
      state.site = { lat: la, lon: lo, elev: state.site.elev || 0, source: 'entered manually' }; sky.setSite(la, lo, state.site.elev); planRows = null; rateCache.clear(); siteMoved(); save(); renderLaunch(); show(); };
    $('#loc-skip').onclick = () => { locAsked = true; closeDlg(); if (dest) launch(dest); else renderLaunch(); };      // asks again next time the app opens
    $('#loc-never').onclick = () => { locAsked = true; state.locNever = true; save(); closeDlg(); if (dest) launch(dest); else renderLaunch(); toast('OK. You can set your location any time under More → Telescope, eyepieces, location.', 4500); };
  };
  show();
}

// ---------------------------------------------------------------- PLAN
// state.plan = { id, start: ISO, hours, items: [{ key, sync? }], done: { key: true }, notes, name, nameSet, placeName }  (the one being worked on)
// state.plans = the other plans, kept automatically (newest first). Nothing is ever thrown away unless the user deletes it.
const plansList = () => state.plans || (state.plans = []);
const newPlanObj = () => ({ id: 'p' + Date.now().toString(36), start: null, hours: state.plan ? state.plan.hours || 2 : 2, items: [], done: {}, notes: '', placeName: null });
const planWhere = (P) => (P.site && P.site.name) || P.placeName || placeLabel() || (/^default/.test(state.site.source || '') ? '' : coordText(state.site.lat, state.site.lon));
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
// ---- This week's highlights (Build 102): a short list of visual sights for Southern Ontario, prepared weekly by the
// Eyepiece Daily scheduled task as docs/data/highlights.json (it opens a pull request; the owner merges). The iPhone app
// reads the live copy from the website when online, so it stays current between app updates.
let highlights; // undefined: not loaded yet; null: none
async function loadHighlights() {
  if (highlights !== undefined) return highlights;
  const live = 'https://tentelescopes.github.io/skyward-pushto/data/highlights.json';
  const urls = /github\.io$/.test(location.hostname) ? ['data/highlights.json'] : [live, 'data/highlights.json'];
  highlights = null;
  for (const u of urls) {
    try { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) { const j = await r.json(); if (j && (Array.isArray(j.items) || Array.isArray(j.comets) || Array.isArray(j.fixed))) { highlights = j; break; } } } catch (e) { /* offline or not there yet */ }
  }
  return highlights;
}
const hlTarget = (t) => { if (!t) return null; const k = String(t).toLowerCase().replace(/\s+/g, ''); return sky.objects.find((o) => [o.label, o.id, o.name].some((x) => x && String(x).toLowerCase().replace(/\s+/g, '') === k)) || null; };
const HL_LOOK = { eye: 'Naked eye', binoculars: 'Binoculars', telescope: 'Telescope', any: 'Eye or telescope' };
async function fillHighlights() {
  const el = $('#pl-hl'); if (!el) return;
  const H = await loadHighlights(); if (!el.isConnected) return;
  const today = new Date().toISOString().slice(0, 10), now = Date.now();
  const items = H && (!H.validUntil || H.validUntil >= today) ? (H.items || []).filter((it) => { const end = Date.parse(it.end || it.start || ''); return isNaN(end) || end > now - 6 * 3600e3; }) : [];
  if (!items.length) { el.innerHTML = ''; return; }
  const P = planState();
  const when = (it) => { const d = new Date(it.start); return isNaN(d) ? '' : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  el.innerHTML = `<div class="sech"><h3>This week's highlights <span class="muted small">${esc(H.region || '')}</span></h3></div>
    <ul class="list hl">${items.map((it, i) => { const o = hlTarget(it.target), inPlan = o && P.items.some((x) => x.key === o.key);
      return `<li><div class="grow${o ? ' tap' : ''}"${o ? ` data-hlinfo="${esc(o.key)}"` : ''}><b>${esc(it.title)}</b><div class="muted small">${esc(HL_LOOK[it.look] || '')}${when(it) ? ' · ' + esc(when(it)) : ''}</div>
        ${it.what ? `<div class="small">${esc(it.what)}</div>` : ''}${it.why ? `<div class="small hlwhy">${esc(it.why)}</div>` : ''}</div>
        ${o ? `<button class="mini" data-hl="${i}">${inPlan ? '✓ In plan' : '+ Plan'}</button>` : ''}</li>`; }).join('')}</ul>`;
  el.querySelectorAll('[data-hlinfo]').forEach((d) => d.onclick = () => openObject(d.dataset.hlinfo, { row: rowFor(d.dataset.hlinfo) }));
  el.querySelectorAll('[data-hl]').forEach((b) => b.onclick = () => {
    const o = hlTarget(items[+b.dataset.hl].target); if (!o) return;
    const i = P.items.findIndex((x) => x.key === o.key); if (i >= 0) P.items.splice(i, 1); else P.items.push({ key: o.key });
    save(); renderPlan(); fillPlanSuggestions();
  });
}
// ---- Comets, meteor showers, novae and the northern lights (Build 103)
// Showers come from the built-in IMO list (transients.js); comets and novae from the weekly highlights feed
// (`comets`: perihelion elements; `fixed`: RA/Dec); aurora from NOAA's Kp forecast when online.
function syncTransients(date = new Date()) {
  const keep = sky.objects.filter((o) => !o.key.startsWith('ms:') && !o.key.startsWith('cm:') && !o.key.startsWith('tr:'));
  const add = [];
  for (const sh of activeShowers(date)) add.push({ id: sh.id, key: 'ms:' + sh.id, label: sh.name, name: sh.name, sub: 'Meteor shower', t: 'MS', type: 'Meteor shower', cats: ['Meteor showers'], shower: sh, ra: sh.ra, dec: sh.dec, v: j2000Vec(sh.ra, sh.dec) });
  for (const o of feedObjects(highlights)) { if (o.orbit) sky.altAz(o, date); else o.v = j2000Vec(o.ra, o.dec); add.push(o); }
  sky.objects = keep.concat(add);
  planRows = null; rateCache.clear();
}
let kpList = null;
async function refreshAurora() { const L = await loadKp(); if (L) kpList = L; }
/** Aurora outlook now, or null: { kp, height } from the Kp forecast for this 3-hour block, at night only. */
function auroraNow(date = new Date()) {
  if (!kpList || sky.sunAlt(date) > -12) return null;
  return auroraView(kpAt3h(kpList, date), here().lat, here().lon);
}
/** The strongest aurora chance during tonight's dark hours: { kp, height, at } or null; undefined when no forecast. */
function auroraTonight() {
  if (!kpList) return undefined;
  const nt = sky.nightAt(new Date()), a = nt && (nt.astro || nt.naut || nt.set), b = nt && (nt.astroAm || nt.nautAm || nt.rise);
  const from = a ? a.getTime() : Date.now(), to = b ? b.getTime() : from + 10 * 3600e3;
  let best = null;
  for (const r of kpList) { if (r.t + 3 * 3600e3 < from || r.t > to) continue; const v = auroraView(r.kp, here().lat, here().lon); if (v && (!best || v.kp > best.kp)) best = { ...v, at: new Date(Math.max(r.t, from)) }; }
  const maxKp = kpList.filter((r) => r.t + 3 * 3600e3 >= from && r.t <= to).reduce((m, r) => Math.max(m, r.kp), 0);
  return best || { kp: maxKp, height: 0, none: true };
}
/** x for a centred label so it stays inside the round chart (radius 0.46 × width) at height y. */
function labelX(c, txt, x, y) {
  const W = c.canvas.width, H = c.canvas.height, R = W * 0.46, dy = Math.min(R, Math.abs(y - H / 2));
  const half = Math.sqrt(R * R - dy * dy), w = c.measureText(txt).width / 2 + 8;
  return w >= half ? W / 2 : Math.max(W / 2 - half + w, Math.min(W / 2 + half - w, x));
}
/**
 * A meteor shower worth a big circle on the chart tonight (Build 127): near its peak (within a day and a half, or still
 * at half its peak rate for the broad ones) and good for at least 5 meteors an hour under a dark sky. Away from the
 * peak, and for the minor showers, the chart stays clean; the shower is still listed under Find.
 */
const showerNearPeak = (sh) => !!sh && sh.zhrNow >= 5 && (Math.abs(sh.daysFromPeak) <= 1.5 || sh.zhrNow >= sh.zhr / 2);
/** Big dashed zones on the sky chart: a meteor shower near its peak (around the radiant) and possible aurora (low in
 *  the north, only while the Kp index says it's on). */
function drawZones(c, proj, view, col, s) {
  const t = performance.now(), D = Math.PI / 180;
  const sunA = sky.sunAlt(new Date());
  if (sunA > -6) return;
  const path = (pts) => { let pen = false; c.beginPath(); for (const p of pts) { const q = p.alt > -3 ? proj(p) : null; if (!q || q.r > view * 2.2) { pen = false; continue; } if (pen) c.lineTo(q.x, q.y); else { c.moveTo(q.x, q.y); pen = true; } } };
  // The zone's name written along its edge, the way a map labels a contour line, and repeated around it, so any stretch
  // of the line that crosses the chart says what it is even when the middle of the zone is off screen (Build 127).
  // `pts` is the line; `ring` when it closes on itself. The first label goes where the line passes nearest the middle
  // of the chart, the others about a label-and-a-half further along each way.
  const edgeLabels = (pts, txt, color, ring) => {
    const W = c.canvas.width, cx = W / 2, cy = c.canvas.height / 2, R = W * 0.46, n = ring ? pts.length - 1 : pts.length;
    const Q = pts.slice(0, n).map((p) => { const q = p.alt > -3 ? proj(p) : null; return q && q.r <= view ? q : null; });
    let best = -1, bd = Infinity; Q.forEach((q, i) => { if (q) { const d = Math.hypot(q.x - cx, q.y - cy); if (d < bd) { bd = d; best = i; } } });
    if (best < 0) return;
    const at = (i) => (ring ? Q[((i % n) + n) % n] : Q[i]);
    c.save(); c.setLineDash([]); c.font = `bold ${Math.round(25 * W / 800)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';   // sized like the chart's star names
    const w = c.measureText(txt).width, gap = w * 1.6 + 120;
    const put = (i, must) => {
      const q = at(i), a = at(i - 1) || q, b = at(i + 1) || q; if (!q) return;
      if (!must && Math.hypot(q.x - cx, q.y - cy) + w / 2 > R) return;          // would run off the round chart
      let ang = Math.atan2(b.y - a.y, b.x - a.x); if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;   // never upside down
      c.save(); c.translate(q.x, q.y); c.rotate(ang);
      c.lineWidth = 8; c.strokeStyle = col(0, 0, 0, 0.92); c.strokeText(txt, 0, 0);   // a dark halo breaks the dashes behind the words
      c.fillStyle = color; c.fillText(txt, 0, 0); c.restore();
    };
    put(best, true);
    for (const dir of [1, -1]) { let acc = 0, prev = Q[best]; for (let k = 1; k < n / 2; k++) { const q = at(best + dir * k); if (!q) break; acc += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; if (acc >= gap) { put(best + dir * k, false); acc = 0; } } }
    c.restore();
  };
  c.save(); c.lineWidth = 3; c.setLineDash([18, 14]); c.lineDashOffset = -(t / 45) % 32;          // marching ants
  for (const o of sky.objects) {
    if (!o.shower || !showerNearPeak(o.shower) || o.alt == null || o.alt < -15) continue;
    const lat1 = o.alt * D, lon1 = o.az * D, rho = 40 * D, pts = [];
    for (let k = 0; k <= 72; k++) { const th = k * 5 * D, lat2 = Math.asin(Math.sin(lat1) * Math.cos(rho) + Math.cos(lat1) * Math.sin(rho) * Math.cos(th)); const lon2 = lon1 + Math.atan2(Math.sin(th) * Math.sin(rho) * Math.cos(lat1), Math.cos(rho) - Math.sin(lat1) * Math.sin(lat2)); pts.push({ alt: lat2 / D, az: ((lon2 / D) % 360 + 360) % 360 }); }
    const pulse = 0.55 + 0.25 * Math.sin(t / 700);
    c.strokeStyle = col(255, 200, 120, pulse); path(pts); c.stroke();
    edgeLabels(pts, `${o.label} meteor zone`, col(255, 215, 140), true);
    // a few twinkling sparks inside the zone, so it reads as "meteors anywhere in here"
    c.setLineDash([]); for (let k = 0; k < 7; k++) { const ph = (t / 900 + k * 0.37) % 1, ang = k * 2.4 + Math.floor(t / 900 + k * 0.37) * 1.3, dist = 12 + (k * 37) % 26;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dist * D) + Math.cos(lat1) * Math.sin(dist * D) * Math.cos(ang)), lon2 = lon1 + Math.atan2(Math.sin(ang) * Math.sin(dist * D) * Math.cos(lat1), Math.cos(dist * D) - Math.sin(lat1) * Math.sin(lat2));
      const q = proj({ alt: lat2 / D, az: ((lon2 / D) % 360 + 360) % 360 }); if (!q || q.r > view * 1.2) continue;
      const a = Math.sin(ph * Math.PI); c.strokeStyle = col(255, 230, 170, 0.8 * a); c.lineWidth = 2; c.beginPath(); c.moveTo(q.x, q.y); const dx = Math.cos(ang) * 22 * a, dy = Math.sin(ang) * 22 * a; c.lineTo(q.x + dx, q.y + dy); c.stroke(); }
    c.setLineDash([18, 14]); c.lineWidth = 3;
    const rq = proj(o); if (rq && rq.r < view * 1.1) {               // labels kept inside the chart's edges
      const fit = (txt, y) => labelX(c, txt, rq.x, y);
      c.fillStyle = col(255, 215, 140); c.textAlign = 'center';
      let txt = `☄︎ ${o.label} radiant`; c.font = 'bold 22px system-ui'; c.fillText(txt, fit(txt, rq.y - 18), rq.y - 18);
      txt = 'meteors anywhere in the dashed circle'; c.font = '18px system-ui'; c.fillText(txt, fit(txt, rq.y + 30), rq.y + 30);
    }
  }
  const au = auroraNow();
  if (au) {
    const top = [], N = 60;
    for (let k = 0; k <= N; k++) { const az = (300 + k * 120 / N) % 360; top.push({ alt: Math.max(3, au.height * Math.cos(((k / N) - 0.5) * Math.PI * 0.9)), az }); }
    c.strokeStyle = col(120, 255, 160, 0.55 + 0.25 * Math.sin(t / 650)); path(top); c.stroke();
    edgeLabels(top, 'Northern lights possible below here', col(150, 255, 180), false);
    const mid = proj({ alt: Math.max(6, au.height * 0.55), az: 0 });
    if (mid && mid.r < view * 1.3) { c.setLineDash([]); c.fillStyle = col(150, 255, 180); c.font = 'bold 22px system-ui'; c.textAlign = 'center'; const txt = `Northern lights possible (Kp ${au.kp.toFixed(1)})`; c.fillText(txt, labelX(c, txt, mid.x, mid.y), mid.y); }
  }
  c.restore();
}

/** Plan: what's passing through tonight and worth a look — a good meteor shower, a comet or nova in reach, the northern lights. */
function fillEvents() {
  const el = $('#pl-ev'); if (!el) return;
  const P = planState(), rows = [], nt = sky.nightAt(new Date()), dark = nt.astro || nt.naut || nt.set || new Date();
  const fmt = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const best = (o) => {                                // best moment tonight, every half hour across the dark hours
    let b = null; const end = (nt.astroAm || nt.nautAm || nt.rise || new Date(dark.getTime() + 10 * 3600e3)).getTime();
    for (let t = dark.getTime(); t <= end; t += 1800e3) { const d = new Date(t), p = sky.altAz(o, d), m = sky.moonInfo(d);
      const r = rate(o, { alt: p.alt, sunAlt: sky.sunAlt(d), moonAlt: m.alt, moonFrac: m.frac, moonSep: sepDeg(p.alt, p.az, m.alt, m.az), nelm: skyNelm() }, profile());
      if (r && (!b || r.margin > b.r.margin)) b = { r, d, alt: p.alt }; }
    return b;
  };
  for (const o of sky.objects) {
    if (!o.shower && !o.comet && o.t !== 'TR') continue;
    const b = best(o), inPlan = P.items.some((x) => x.key === o.key);
    // Only what's worth a look tonight (Build 118): a shower giving 5 or more meteors an hour, a comet or nova the
    // scope can show from here, or anything already in the plan. The rest stays out of the list.
    const worth = o.shower ? !!(b && b.r.hr >= 5) : !!(b && b.r.level < 3);
    if (!worth && !inPlan) continue;
    let line;
    if (o.shower) {
      const sh = o.shower, dd = Math.round(sh.daysFromPeak);
      const peak = Math.abs(sh.daysFromPeak) < 1 ? 'peak tonight' : dd > 0 ? `peaked ${dd} day${dd === 1 ? '' : 's'} ago` : `peak in ${-dd} day${dd === -1 ? '' : 's'}`;
      line = `${peak} · ${b && b.r.hr >= 1 ? `best about ${fmt(b.d)}, maybe ${Math.round(b.r.hr)} an hour` : 'only the odd meteor tonight'}`;
    } else {
      line = `${o.type}${o.mag != null ? ` · about magnitude ${o.mag.toFixed(1)}` : ''}${b && b.r.level < 3 ? ` · best about ${fmt(b.d)}, ${Math.round(b.alt)}° up` : ' · not well placed tonight'}`;
    }
    rows.push(`<li><div class="grow tap" data-evinfo="${esc(o.key)}"><b>${esc(o.label)}</b><div class="muted small">${esc(line)}</div>${o.note ? `<div class="small">${esc(o.note)}</div>` : ''}</div><button class="mini" data-ev="${esc(o.key)}">${inPlan ? '✓ In plan' : '+ Plan'}</button></li>`);
  }
  const au = auroraTonight();
  if (au && !au.none) rows.push(`<li><div class="grow"><b>Northern lights possible</b><div class="muted small">Kp ${au.kp.toFixed(1)} forecast around ${fmt(au.at)} · look low in the north, away from lights · NOAA forecast</div></div></li>`);
  if (!rows.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sech"><h3>Passing through <span class="muted small">meteors, comets, aurora</span></h3></div><ul class="list hl">${rows.join('')}</ul>`;
  el.querySelectorAll('[data-evinfo]').forEach((d) => d.onclick = () => openObject(d.dataset.evinfo, { row: rowFor(d.dataset.evinfo) }));
  el.querySelectorAll('[data-ev]').forEach((btn) => btn.onclick = () => {
    const k = btn.dataset.ev, i = P.items.findIndex((x) => x.key === k); if (i >= 0) P.items.splice(i, 1); else P.items.push({ key: k });
    save(); renderPlan(); fillPlanSuggestions();
  });
}
function renderPlan() { return withPlanSite(renderPlanHere); }
function renderPlanHere() {
  const el = $('#tab-plan'), P = planState();
  { const pn = sky.nightAt(new Date(P.start)), over = pn.rise ? Date.now() > pn.rise.getTime() : new Date(P.start).getTime() + P.hours * 3600000 < Date.now() - 2 * 3600000;
    if (over) { P.start = defaultStart().toISOString(); planRows = null; save(); } }   // that night is over: plan for the next one
  const start = new Date(P.start), end = new Date(start.getTime() + P.hours * 3600000), n = sky.nightAt(start);
  const moonTxt = `${Math.round(n.moonFrac * 100)}% lit${n.moonRise ? ', rises ' + hm(n.moonRise) : ''}${n.moonSet ? ', sets ' + hm(n.moonSet) : ''}`;
  const T = P.items.filter((x) => !x.sync), nSync = P.items.length - T.length, nDone = T.filter((x) => P.done && P.done[x.key]).length;
  const skyName = skyQ() ? skyCheckName() : skyGuessName();
  // A plan put together by hand has no sync star at the front: suggest one.
  const firstObj = P.items.length && !P.items[0].sync ? objByKey(P.items[0].key) : null;
  let openStar = null; try { openStar = firstObj ? openingSync(sky, firstObj, start) : null; } catch (e) { /* no site yet */ }
  el.innerHTML = `<h2>Plan a session</h2>
    <div class="card">
      <div class="sess"><div><b>${dayLabel(start)} · ${hm(start)} – ${hm(end)}</b>${n.set && start < n.set ? '<div class="small"><b>You start before sunset</b></div>' : ''}</div>
        <button id="pl-edit" class="mini">${planEdit ? 'Done' : 'Change'}</button></div>
      ${(() => { const rec = ensureForecast(here(), start, () => { if (!$('#tab-plan').classList.contains('hidden')) renderPlan(); }); return glanceHTML(rec, n, start) + clearSpellBtn(rec, start); })()}
      ${P.site
        ? `<div class="sess hzrow"><div class="small">${ICON.pin}Planning for <b>${esc(P.site.name)}</b><div class="muted">${P.site.name === coordText(P.site.lat, P.site.lon) ? '' : coordText(P.site.lat, P.site.lon) + ' · '}not where you are now</div></div><div class="btncol"><button id="pl-where" class="mini">Change place</button><button id="pl-here" class="mini">Use where I am</button></div></div>` : ''}
      ${P.site ? '' : `<div class="plwhere"><div class="small">${ICON.pin}${whereText()}</div><div class="btnrow"><button id="pl-loc" class="mini">Update location</button><button id="pl-where" class="mini">Plan for another place</button></div><div class="muted small">Going somewhere darker? Pick the spot on a map and plan for its sky.</div></div>`}
      <details class="more tdetail" id="pl-tonight" ${state.ui && state.ui.plTonight ? 'open' : ''}><summary>Tonight in detail</summary>
      <div class="muted small">${esc(skyName)} · Moon ${moonTxt}</div>
      <div class="muted small">Sunset ${hm(n.set)} · fully dark ${hm(n.astro)} – ${hm(n.astroAm)}</div>
      <div id="pl-fc">${outlookHTML(fcFor(here(), start), { hint: false })}</div>
      <div class="sess hzrow"><div class="muted small">Steady air (seeing): <b>${SEEING_WORD[seeingFor(start)]}</b> ${{ check: `(${seeingTonight() && seeingTonight().how === 'pick' ? 'you picked it' : 'your check'} tonight)`, forecast: "(Environment Canada's forecast — your own check beats it)", assumed: '(not tested, so the app assumes average)' }[seeingSource(start)]}</div>${nightKey(start.getTime()) === nightKey(Date.now()) ? `<button id="pl-seetest" class="mini">${seeingTonight() ? 'Check again' : 'Test it (10 s)'}</button>` : ''}</div>
      ${P.site ? '' : `<div class="sess hzrow"><div class="muted small">${placeLabel() ? hzLine() : `Blocked sky: ${hzLine()}`}</div><button id="pl-hz" class="mini">${horizonNow() ? 'Change' : 'Trace it'}</button></div>`}
      </details>
      <div id="pl-form" class="${planEdit ? '' : 'hidden'}" style="margin-top:8px">
        <div class="btnrow"><button id="pl-dark" class="mini">Start at full dark (${hm(n.astro || n.naut)})</button><button id="pl-now" class="mini">Start now</button></div>
        <label class="row"><span>Date</span><input id="pl-date" type="date" value="${dateVal(start)}"></label>
        <label class="row"><span>Going out at</span><input id="pl-time" type="time" step="900" value="${timeVal(start)}"></label>
        <label class="row"><span>Staying out</span><select id="pl-hours">${[1, 1.5, 2, 3, 4, 6, 8].map((h) => `<option value="${h}" ${+P.hours === h ? 'selected' : ''}>${h} hour${h > 1 ? 's' : ''}</option>`).join('')}</select></label>
        <label class="row"><span>Your sky</span><select id="pl-skysel">${SKY_PICKS.map(([m, l]) => `<option value="${m}" ${Math.abs(skyNelm() - m) < 0.26 ? 'selected' : ''}>${l}</option>`).join('')}${SKY_PICKS.some(([m]) => Math.abs(skyNelm() - m) < 0.26) ? '' : `<option selected>${esc(skyQ() ? skyQ().label : skyGuessName())}</option>`}</select></label>
        <div class="btnrow"><button id="pl-skyq" class="mini">Measure it: Little Dipper check (30 s)</button></div>
        <label class="row"><span>Steady air (seeing)</span><select id="pl-seeing">${[['poor', 'Poor: bright stars twinkle hard'], ['average', 'Average (most nights)'], ['good', 'Good: stars barely twinkle']].map(([v, l]) => `<option value="${v}" ${seeingNow() === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="muted small" style="margin:2px 0 0">Seeing (how steady the air is) decides how much power planets and close doubles can take.</p>
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
      <div class="btnrow"><button id="pl-prev">▶ Preview the route</button><button id="pl-race">Race this plan with friends</button></div>
      <div class="chips wrap"><button id="pl-bytime">Order by time</button><button id="pl-nosync" ${nSync ? '' : 'disabled'}>Remove sync stars</button><button id="pl-auto">Rebuild for me</button><button id="pl-clear">Clear</button></div>
      <p class="muted small tipline">${ICON.bulb}${esc(tipOfTheNight())}</p>
      <details class="more"><summary>How this plan was picked</summary>${howPickedHTML(n)}</details>
      <p class="muted small">"Best order" keeps pushes short and adds a bright star before each long jump. Centre that star and tap Sync, so the pointing is freshly corrected right where you're about to look.</p>`
    : `<div class="card" style="text-align:center"><b>No plan yet</b><p class="muted small" style="margin:4px 0 10px">Let the app pick a varied tour for this session, or add your own from the suggestions below with <b>+</b>.</p><button id="pl-auto" class="primary big">Build a plan for me</button></div>`}
    <div id="pl-ev"></div>
    <div id="pl-hl"></div>
    <div class="sech"><h3>Suggestions <span class="muted small">for this session</span></h3></div>
    <div class="chips" id="pl-lv">${[['all', 'All'], ['0', '●●● Obvious'], ['1', '●●○ Visible'], ['2', '●○○ Challenging']].map(([k, l]) => `<button data-lv="${k}" class="${planLevel === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="chips" id="pl-sort">${[['top', 'Top picks'], ['time', 'Looks best'], ['alt', 'Highest'], ['name', 'Catalog #']].map(([k, l]) => `<button data-s="${k}" class="${planSort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <ul class="list" id="pl-sugg"><li class="muted">Working it out…</li></ul>`;
  if ($('#pl-hz')) $('#pl-hz').onclick = () => openHorizon('plan');
  fillHighlights(); fillEvents();
  wireUpdateLoc($('#pl-loc'));
  $('#pl-where').onclick = () => openPlacePicker(P.site || state.site, (pick) => { P.site = pick; P.placeName = pick.name; if (!P.nameSet) P.name = null; planRows = null; rateCache.clear(); save(); renderPlan(); });
  if ($('#pl-here')) $('#pl-here').onclick = () => { P.site = null; P.placeName = planWhere(P) || null; planRows = null; rateCache.clear(); save(); renderPlan(); };
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
  $('#pl-seeing').onchange = (e) => recordSeeing(e.target.value, 'pick');
  if ($('#pl-seetest')) $('#pl-seetest').onclick = () => openSeeingCheck();
  { const d = $('#pl-tonight'); if (d) d.ontoggle = () => { state.ui = state.ui || {}; state.ui.plTonight = d.open; save(); }; }
  if ($('#fc-start')) $('#fc-start').onclick = () => { const f = fcFor(here(), new Date(P.start)); if (f && f.ol && f.ol.from) { P.start = f.ol.from.toISOString(); planRows = null; save(); renderPlan(); } };
  $('#pl-skysel').onchange = (e) => { const m = +e.target.value; if (!m) return; const [label] = skyLabel(m); state.skyq = { nelm: m, label, when: Date.now(), lat: state.site.lat, lon: state.site.lon, src: 'pick' }; planRows = null; save(); renderPlan(); };
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
    const pick = autoPlan(computePlanRows(), { hours: +P.hours, seen: seenSet() });
    if (!pick.length) return toast('Nothing suitable in that session. Try a later start, or a longer stay.', 4000);
    P.done = {}; const r = applyRoute(pick); renderPlan(); $('main').scrollTop = 0;
    toast(`Plan built: ${pick.length} targets${r.nSync ? ` and ${r.nSync} sync star${r.nSync === 1 ? '' : 's'}` : ''}. Reorder or remove anything you like.`, 4500);
  };
  bindPlanList();
  if ($('#pl-openadd')) $('#pl-openadd').onclick = () => keepScroll(() => { P.items.unshift({ key: openStar.o.key, sync: true }); save(); renderPlan(); toast(`${openStar.o.label} added as your opening sync star`, 2500); });
  if ($('#pl-reorder')) $('#pl-reorder').onclick = () => keepScroll(() => { planReorder = !planReorder; renderPlan(); });
  if ($('#pl-route')) {
    $('#pl-prev').onclick = () => { route = null; showTab('route'); };
    // Race this plan (Build 122): everyone at the site races the plan's targets in the plan's order, as many as it has.
    // It is an ordinary race code, so friends join with Play → Join: scan (the QR on the next screen) or paste.
    $('#pl-race').onclick = racePlan;
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
  const start = new Date(P.start), see = seeingFor(start), nelm = planNelm(start);
  const sig = [P.start, P.hours, see, profile().name, profile().aperture, profile().eyepieces.map((e) => e.fl).join(), nelm.toFixed(2), hzSig()].join('|');
  if (sig !== planSig) { planRows = null; planSig = sig; }
  if (!planRows) { planDarkNight = (() => { try { return nextDarkNight(sky, start); } catch (e) { return null; } })(); }
  if (!planRows) { setSeeing(see); try { planRows = planTargets(sky, { start, hours: +P.hours, scope: profile(), nelm, minAlt: 20, horizon: horizonNow() }); } finally { setSeeing(seeingNow()); } }
  return planRows;
}
/** The blocked-sky map for this spot (null when nothing is marked). */
function horizonNow() {
  if (planSite) { const pl = nearPlaces(places(), planSite.lat, planSite.lon)[0]; return pl && hasHorizon(pl.horizon) ? pl.horizon : null; }   // planning elsewhere: that place's own blocked sky, if saved
  return hasHorizon(state.horizon) ? state.horizon : null;
}
const hzSig = () => (planSite ? `p${planSite.lat},${planSite.lon}` : state.horizon ? state.horizon.when || 1 : 0);
// The sky's darkness: the observer's own check if there is one, else the light-pollution map's estimate for the site,
// else a suburban guess.
/** While a plan for another place is being drawn, "here" is that place (see withPlanSite); otherwise your location. */
let planSite = null;
const here = () => planSite || state.site;
function mapSky() { return state && state.site ? skyGlowAt(here().lat, here().lon) : null; }
/** The darkest picture of the sky darkness check (all seven dipper stars and more) means "this dark or darker": the check
 *  can't tell darker skies apart. There, if the light-pollution map says darker still, go by the map. */
const checkTop = () => SKY_LEVELS[SKY_LEVELS.length - 1][0];
/** The sky darkness check result, if it still describes where you are (taken within 15 km of here). Otherwise null,
 *  and the light-pollution map is used instead. A check made with the Moon up or in twilight measured light pollution
 *  plus moonlight/twilight; its moonless part (`base`) is worked out by taking the modelled Moon and twilight away
 *  (vis.js moonlessNelm), because the ratings add the Moon back target by target. When the Moon hides the light
 *  pollution completely (base unknown), the check isn't used for the ratings. */
const SKYQ_KM = 15;
/** Run fn with the sky set up for the current plan's place (a plan for somewhere you aren't), then put it back. */
function withPlanSite(fn) {
  const P = state.plan, ps = P && P.site;
  if (!ps) return fn();
  sky.setSite(ps.lat, ps.lon, ps.elev || 0); planSite = ps;
  try { return fn(); } finally { planSite = null; sky.setSite(state.site.lat, state.site.lon, state.site.elev); }
}
function checkBase(q) {
  if (q.src === 'pick' || 'base' in q) return;
  try {                                                  // checks saved before Build 101: work it out from the time taken
    const at = new Date(q.when), mo = sky.moonInfo(at), sun = sky.sunAlt(at), pol = sky.altAzRaDec(37.95, 89.26, at);
    q.moonUp = mo.alt > 0 && mo.frac > 0.25; q.twilight = sun > -12;
    q.base = q.moonUp || q.twilight ? (moonlessNelm({ nelm: q.nelm, moonAlt: mo.alt, moonFrac: mo.frac, sepDeg: sepDeg(mo.alt, mo.az, pol.alt, pol.az), targetAlt: pol.alt, sunAlt: sun }) || { nelm: null }).nelm : q.nelm;
  } catch (e) { q.base = q.nelm; }
}
function skyQ() {
  const q = state.skyq; if (!q) return null;
  if (q.lat != null && distKm({ lat: q.lat, lon: q.lon }, here()) > SKYQ_KM) return null;
  checkBase(q);
  if (q.src !== 'pick' && q.base == null) return null;
  if (checkDoubt(q)) return null;
  return q;
}
/** A check that reads far brighter than the light-pollution map for that spot (more than 2 mag/arcsec², over 6 times
 *  brighter) was most likely clouds, haze, the Moon, a light nearby or a test run: go by the map instead. Returns the
 *  map estimate when the check is doubted, else null. */
function checkDoubt(q) {
  if (!q || q.src === 'pick' || q.base == null) return null;
  const mp = skyGlowAt(q.lat ?? state.site.lat, q.lon ?? state.site.lon);
  return mp && nelmToSqm(q.base) < mp.sqm - 2 ? mp : null;
}
/** Moonless limiting magnitude from a check (the darkest picture means "this dark or darker": go by the map if darker). */
function checkNelm(q = skyQ()) {
  if (!q) return null;
  const n = q.src === 'pick' || q.base === undefined ? q.nelm : q.base;
  if (!q.moonUp && !q.twilight && q.nelm >= checkTop() - 1e-6) { const mp = skyGlowAt(q.lat ?? state.site.lat, q.lon ?? state.site.lon); if (mp && mp.nelm > n) return mp.nelm; }
  return n;
}
function skyNelm() { const q = skyQ(), m = q ? null : mapSky(); return q ? checkNelm(q) : m ? m.nelm : DEFAULT_NELM; }
function skyCheckName() { return `${skyQ().label} (about Bortle ${bortleOfNelm(checkNelm())})`; }
function skyGuessName() { const m = mapSky(); return m ? `${skyLabel(m.nelm)[0]} (light-pollution map, about Bortle ${m.bortle})` : 'Suburban sky (a guess)'; }
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
  const info = it.sync ? '<div class="t2">Sync star: centre it, tap Sync, carry on</div>'
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
  // Tap a planned target for its preview (eyepiece views, rating, best time); step through the plan with the arrows.
  const keys = P.items.map((x) => x.key);
  ul.querySelectorAll('[data-goplan]').forEach((d) => d.onclick = () => { if (planReorder) return; const k = d.dataset.goplan; openObject(k, { row: rowFor(k), keys, rowFor }); });
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
function fillPlanSuggestions() { return withPlanSite(fillPlanSuggestionsHere); }
function fillPlanSuggestionsHere() {
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
// "All" comes first and is the default (Build 122).
const CATS = [['ALL', 'All'], ['M', 'Messier'], ['C', 'Caldwell'], ['H400', 'Herschel 400'], ['DS', 'RASC doubles'], ['AS', 'Asterisms'], ['PL', 'Planets & Moon'], ['ST', 'Bright stars']];
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
  else if (st === 'unaligned') rows.push(`<div class="strip warn"><span><b>Not aligned.</b> The arrows are a rough guess.</span><button id="qs-align" class="mini primary">Align</button></div>`);
  else if (st === 'resync') rows.push(`<div class="strip warn"><span><b>Sync recommended.</b> Centre a bright star and tap Sync.</span><button id="qs-align" class="mini">Align</button></div>`);
  if (!siteKnown()) rows.push(`<div class="strip"><span>Location not set: using Toronto.</span><button id="qs-gps" class="mini primary">Use GPS</button></div>`);
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
    ${P.length ? `<div class="picks">${P.map(({ o, r }) => `<button data-go="${esc(o.key)}"><b>${esc(o.label)}</b><span>${esc(o.name || kindLabel(o))}</span><span class="dots lv${r.level}">${DOTS[r.level]}</span><span>${o.alt.toFixed(0)}° up, ${compassName(o.az)}</span></button>`).join('')}</div>`
      : '<p class="muted small">Nothing is well placed right now. Try the Plan tab for later tonight.</p>'}`;
}
function bindQuickStart(el) {
  const on = (id, f) => { const b = $('#' + id, el); if (b) b.onclick = f; };
  on('qs-start', () => { showStart(); });
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
    <div class="chiplab">Show</div>
    <div class="chips">${CATS.map(([k, l]) => `<button data-cat="${k}" class="${state.catFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="chiplab">Sort and filter</div>
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
  el.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { state.catFilter = b.dataset.cat; state.catPicked = true; save(); renderFind(); });
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
  const p = profile(), sig = `${state.active}|${p.aperture}|${p.fl}|${p.eyepieces.map((e) => e.fl).join()}|${skyNelm()}|${hzSig()}|${here().lat},${here().lon}`;
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
const EP_ROW = () => `<div class="chips epq" id="ep-quick" aria-label="Eyepiece">${profile().eyepieces.map((e, i) => `<button data-epq="${i}" class="${i === state.ep ? 'on' : ''}">${esc(e.name)}<span> ${(profile().fl / e.fl).toFixed(0)}×</span></button>`).join('')}</div>`;
const ZOOM_ROW = () => `<div class="btnrow zoom"><button id="z-out" aria-label="Zoom out">−</button><button id="z-in" aria-label="Zoom in">+</button><button id="z-auto" class="${zoom == null ? 'on' : ''}">${zoom == null ? 'Auto zoom: on' : 'Auto zoom'}</button>${HZ_TOGGLE()}</div>`;
function renderPush() {
  const el = $('#tab-push'); const o = targetObj();
  pstatKey = null; rateT = 0;
  if (!o) {
    el.innerHTML = `<div class="target-h"><span class="name">Sky view</span><span class="muted">no target</span></div>
      <div class="pstat" id="pstat"></div>
      ${EP_ROW()}
      <canvas id="reticle" class="chart big" width="800" height="800"></canvas>
      <div id="whereami" class="whereami"></div>
      ${ZOOM_ROW()}
      <div class="btnrow"><button id="p-hz" class="mini">${placeLabel() ? hzLine() : `Blocked sky: ${hzLine()}`}</button></div>
      <p class="muted small">The chart follows the scope.${state.mounting === 'top-sky' ? ' In your hand, point the top edge of the phone at the sky, like a TV remote.' : ''} When it says you're near something, tap the name to read about it.</p>
      <div class="actionbar"><button id="sv-find" class="primary">Pick a target</button><button id="sv-what">${state.mode === 'compass' || align.obs.length >= alignNeeded() ? 'Sync on this' : 'Align on this'}</button>${align.fit || state.mode === 'compass' ? '' : '<button id="sv-align">Align</button>'}</div>`;
    chartCentre = 'scope';
    bindChartControls();
    $('#sv-find').onclick = () => showTab('find');
    $('#sv-what').onclick = () => openWhatsThis('push');
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
    ${EP_ROW()}
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
      <label class="row"><span>Draw the eyepiece view the way your telescope shows it (rotated or mirrored)</span><input type="checkbox" id="rot180" ${state.rot180 ? 'checked' : ''}></label>
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
  return `${rateTag(r)} <b>${LEVEL_NAMES[r.level]}</b>${r.ep ? ` · best with the ${esc(r.ep.name)}${r.epSteady ? `, the ${esc(r.epSteady.name)} when the air is steady (good seeing)` : ''}` : ''}<div class="muted small">${esc(describe(o, r))}</div>${high}`;
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
  const matrix = state.rot180 ? (lensView(p) ? viewMatrix(p, tgt) : newtonianMatrix(tgt, fz)) : null;
  const r = drawEyepiece(cv, sky, o.pairs && o.key.startsWith('st:') ? { ...o, t: 'DS' } : o, tgt, ep, p, { matrix, bright: vis(), nelm: skyNelm(), env: eyeEnv(tgt), refExit: p.aperture / (p.fl / longest.fl) });
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
    else setPstat('sv-off', `<b>Sensors are off.</b> Drag the chart to look around. ${SENS_BTN}`, bindSensBtn);
    const at = { alt: hand.alt, az: hand.az, ready: true };
    trackMotion(null); updateWhere(at);
    drawReticle(null, at, { label: '' }, { noTarget: true, noBanner: true });
    return;
  }
  const live = cur.ready ? cur : roughPointing();
  if (!live.guess) { setPstat('sv', '<span id="ps-far"></span>'); const f = $('#ps-far'); if (f) f.textContent = `${cur.alt.toFixed(0)}° up, facing ${compassName(cur.az)}`; }
  else if (live.src === 'compass') setPstat('sv-guess', `<b>Not aligned yet</b> — the position comes from the phone's compass, so it's rough. Align for an accurate one. <button class="mini primary" id="ps-align">Align</button>`, bindAlignBtn);
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
    const gd = $('#tab-push .guide'); if (gd) gd.classList.add('hidden');     // empty Turn/Tilt boxes say nothing; the line above says it once
    drawReticle(null, tgt, o, { noBanner: true }); return;
  }
  { const gd = $('#tab-push .guide'); if (gd) gd.classList.remove('hidden'); }
  if (!cur.ready) {                                 // no alignment yet: altitude is real, azimuth is a best guess
    trackMotion(cur);
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
const ZMIN = 0.08, ZMAX = 60;                       // radius in degrees: about 10′ across to the whole sky
let minView = ZMIN, dispView = 0, minViewGuess = false;
// Slew detection from the pointing itself: smoothed angular speed, "moving" above 1.5°/s, "settled" after 0.8 s below 0.4°/s.
const motion = { prev: null, t: 0, v: 0, moving: false, stillSince: 0 };
function trackMotion(cur) {
  const now = performance.now();
  if (cur && !cur.ready && cur.raw) cur = { alt: cur.raw.alt, az: cur.raw.az, ready: true };     // before alignment the phone's own frame still shows motion
  if (!cur || !cur.ready) { motion.prev = null; motion.moving = false; motion.hist = null; motion.vz = 0; return; }
  if (motion.prev) {
    const dt = Math.max(0.016, (now - motion.t) / 1000), v = sepDeg(motion.prev.alt, motion.prev.az, cur.alt, cur.az) / dt;
    motion.v = motion.v * 0.7 + v * 0.3;
    if (motion.v > 1.5) { motion.moving = true; motion.stillSince = 0; }
    else if (motion.v < 0.4) { if (!motion.stillSince) motion.stillSince = now; if (now - motion.stillSince > 800) motion.moving = false; }
  }
  motion.prev = { alt: cur.alt, az: cur.az }; motion.t = now;
  // Steadier speed for the auto zoom: distance moved over the last half second (frame-to-frame jitter averages out).
  const H = motion.hist || (motion.hist = []); H.push({ t: now, alt: cur.alt, az: cur.az });
  while (H.length > 2 && now - H[1].t > 500) H.shift();
  const h0 = H[0]; motion.vz = now - h0.t > 150 ? sepDeg(h0.alt, h0.az, cur.alt, cur.az) / ((now - h0.t) / 1000) : 0;
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
// By hand you can zoom as far as you like (the chart says when it's past what the phone can know); the automatic zoom
// stops at the phone's accuracy.
function setZoom(z) { zoom = z == null ? null : Math.min(ZMAX, Math.max(ZMIN, z)); autoZ = null; syncZoomUI(); }
function syncZoomUI() { const b = $('#z-auto'); if (b) { b.classList.toggle('on', zoom == null); b.textContent = zoom == null ? 'Auto zoom: on' : 'Auto zoom'; } }
/**
 * Automatic zoom that follows the hand on the telescope (Build 112): while the scope is still it keeps closing in, slowly,
 * down to about twice the eyepiece's field; as soon as it moves more than the phone's own jitter it widens in proportion
 * to the speed (about three seconds of travel), so a nudge widens it a little and a long push a lot.
 */
let autoZ = null, autoT = 0, stillAt = 0;
function motionZoom(floor, ceil) {
  const now = performance.now(), dt = autoT ? Math.min(0.25, (now - autoT) / 1000) : 0; autoT = now;
  if (autoZ == null) autoZ = Math.min(ceil, Math.max(floor, 20));
  const v = motion.vz || 0, JITTER = 0.5;                       // °/s over half a second: below this it's the phone's noise or a tremble
  if (v > JITTER) { stillAt = 0; const want = Math.min(ceil, floor + (v - JITTER) * 3); if (want > autoZ) autoZ = autoZ + (want - autoZ) * Math.min(1, dt * 6); }
  else { if (!stillAt) stillAt = now; if (now - stillAt > 700) autoZ = autoZ * Math.exp(-dt * 0.5); }   // after a moment's stillness, closes in by about a third a second   // closes in by about a third every second
  autoZ = Math.min(ceil, Math.max(floor, autoZ));
  return autoZ;
}

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
/** One tap on an eyepiece under the chart: use it, and let the chart close in on its field. */
function pickEyepiece(i) {
  state.ep = i; save(); eyeT = 0; setZoom(null); autoZ = null;
  document.querySelectorAll('#ep-quick [data-epq]').forEach((c) => c.classList.toggle('on', +c.dataset.epq === i));
  document.querySelectorAll('#ep-chips [data-ep]').forEach((c) => c.classList.toggle('on', +c.dataset.ep === i));
  const ep = eyepiece(); toast(`${ep.name} · ${(profile().fl / ep.fl).toFixed(0)}× · ${(tfov(ep) * 60).toFixed(0)}′ field`, 2000);
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
  on('z-auto', () => { setZoom(null); toast('Auto zoom: closes in while the scope is still, widens as you move it', 3500); });
  document.querySelectorAll('#ep-quick [data-epq]').forEach((b) => b.onclick = () => pickEyepiece(+b.dataset.epq));
  on('z-hz', () => { state.hzShow = state.hzShow === false; save(); const b = $('#z-hz'); b.classList.toggle('on', state.hzShow); b.textContent = state.hzShow ? 'Blocked sky: shown' : 'Blocked sky: hidden'; toast(state.hzShow ? 'Hatching on: sky hidden from this spot is marked. Targets behind it stay off your suggestions.' : 'Hatching off. Targets behind your blocked sky still stay off your suggestions.', 4500); });
  on('z-lock', () => { state.zoomLock = !state.zoomLock; save(); const b = $('#z-lock'); b.classList.toggle('on', state.zoomLock); b.textContent = state.zoomLock ? 'Zoom locked' : 'Lock zoom'; toast(state.zoomLock ? 'Zoom locked: it won\'t zoom out while you move' : 'Zoom unlocked — zooms out while you move'); });
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
  let view, limited = false;
  if (opt.view) view = opt.view;
  else if (zoom != null) view = zoom;                                  // by hand: anything from ZMIN up
  else if (!cur) view = 25;
  else {                                                              // automatic: follows the motion of the scope
    const floor = Math.max(guess ? minView : 0, half * 2.2, tgt && chartCentre !== 'target' && !opt.noTarget ? Math.min(45, sepDeg(cur.alt, cur.az, tgt.alt, tgt.az) * 1.25) : 0);
    view = state.zoomLock && tgt ? Math.max(floor, autoRadius(cur, tgt)) : motionZoom(floor, 50);
    limited = false;
  }
  const pastPhone = !opt.view && cur && view < minView * 0.9;     // closer than the phone can know: say so; the dashed circle shows the uncertainty
  if (!opt.view) {
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

  // Text scales with the canvas: about 15 px on a phone screen for names (Build 112; it was about 9 px).
  const FS = W / 800, f = (px, w = '') => `${w} ${Math.round(px * FS)}px system-ui`.trim();
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
    if (view > 8) { c.fillStyle = col(120, 20, 0); c.font = f(30, 'italic'); c.textAlign = 'center';
      for (const [con, [x, y, n]] of Object.entries(cen)) if (n >= 2) c.fillText(con, x / n, y / n + 40); }
  }
  for (const [, q] of P) {
    if (q.mag > magLim) continue;
    const r = Math.max(1.6, (magLim + 1.2 - q.mag) * 2.1);
    c.fillStyle = col(Math.min(255, 140 + (magLim - q.mag) * 25), 20, 10); c.beginPath(); c.arc(q.x, q.y, r, 0, 7); c.fill();
  }

  drawZones(c, proj, view, col, s);
  // catalog objects, asterisms, named stars. Labels thin out as the chart widens: only the brightest when zoomed out,
  // more as you close in; a label that would sit on another is skipped. The target is always labelled (drawn last).
  const boxes = [], free = (x, y, w, h) => { for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; boxes.push([x, y, w, h]); return true; };
  const starLim = view >= 30 ? 1.0 : view >= 15 ? 1.8 : view >= 7 ? 2.8 : view >= 3 ? 4.5 : 9;        // label named stars to this magnitude
  const label = (txt, x, y, px, weight, fill) => { c.font = f(px, weight); const w = c.measureText(txt).width, h = px * FS; if (!free(x - 2, y - h, w + 4, h + 6)) return; c.fillStyle = fill; c.fillText(txt, x, y); };
  c.textAlign = 'left';
  const todo = [];
  for (const n of sky.objects) {
    if (n === o || n.alt == null || n.alt < -2 || Math.abs(n.alt - centre.alt) > view * 1.2) continue;
    const q = proj(n); if (!q || q.r > view) continue;
    todo.push([n, q]);
  }
  todo.sort((a, b) => (b[0].planet ? 1 : 0) - (a[0].planet ? 1 : 0) || (a[0].mag ?? 9) - (b[0].mag ?? 9));   // brightest claim their label space first
  for (const [n, q] of todo) {
    const star = n.key.startsWith('st:'), aster = n.t === 'AS', mess = n.cats && n.cats.some((x) => /^M\d/.test(x));
    if (star && n.mag != null && n.mag <= magLim) {                    // named stars in their own colour (toward Day; red at Night)
      const sc = starTint(STAR_CLASS[n.id], 1, k);
      if (sc) { c.fillStyle = sc; c.beginPath(); c.arc(q.x, q.y, Math.max(1.6, (magLim + 1.2 - n.mag) * 2.1) + 0.6, 0, 7); c.fill(); }
    }
    if (aster) {
      const rr = n.maj ? Math.max(8, n.maj / 120 * s) : 10;
      if (rr > Rpx * 1.5 || rr < 6 || view > 20) continue;
      c.strokeStyle = col(150, 40, 0); c.lineWidth = 2; c.setLineDash([6, 6]); c.beginPath(); c.arc(q.x, q.y, rr, 0, 7); c.stroke(); c.setLineDash([]);
      if (view < 12) label(n.label, q.x + Math.min(rr, 40) + 6, q.y - 6, 26, '', col(170, 50, 10)); continue;
    }
    if (!star && !n.planet && view > 25 && !mess) continue;
    if (!star && !n.planet) { c.strokeStyle = col(160, 20, 0); c.lineWidth = 2; const rr = n.maj ? Math.max(5, n.maj / 120 * s) : 5; c.beginPath(); c.arc(q.x, q.y, rr, 0, 7); c.stroke(); }
    if (n.planet) { c.fillStyle = col(255, 90, 40); c.beginPath(); c.arc(q.x, q.y, 9, 0, 7); c.fill(); }
    const show = n.planet || (star && (n.mag ?? 9) <= starLim) || (mess && view < 15) || (!star && view < 5);
    if (show) label(n.label, q.x + 12, q.y - 9, n.planet || (star && (n.mag ?? 9) < 1.5) ? 34 : 30, n.planet ? '600' : '', col(star || n.planet ? 220 : 160, 30, 10));
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
  c.fillStyle = col(140); c.font = f(28); c.textAlign = 'left';
  c.fillText(`${view >= 2 ? (2 * view).toFixed(view < 5 ? 1 : 0) + '°' : (2 * view * 60).toFixed(0) + '′'} across${zoom == null && !opt.view ? ' · auto' : ''}`, 12, 32);
  c.fillStyle = col(200, 40, 15); c.font = f(26);
  if (limited && !guess && U) c.fillText(`Auto zoom stops at the phone's accuracy (±${fmt.am(U)})`, 12, H - 16);
  else if (pastPhone) c.fillText(guess ? 'Closer than the rough position allows: align first' : U ? `Closer than the phone's accuracy (±${fmt.am(U)})` : '', 12, H - 16);
  // Unmistakable label whenever the chart is not showing a known pointing: a best guess, or no pointing at all.
  const banner = opt.noBanner ? null : guess ? ['NOT ALIGNED YET — ROUGH POSITION',
    src === 'hand' ? 'Direction set by hand · align to make it accurate' : src === 'assumed' ? 'No compass reading, assuming south · align to fix it'
      : U ? `From the compass (±${fmt.am(U)}) · align to make it accurate` : 'From the compass · align to make it accurate'] : opt.banner || null;
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
    if (guess) { c.fillStyle = col(230, 50, 25); c.font = f(28, 'bold'); c.textAlign = 'center'; c.fillText(opt.noBanner ? 'Not aligned yet (compass)' : 'Not aligned yet', scope.x, scope.y + Math.max(28, half * s + 26)); c.textAlign = 'left'; }
    if (half * s > 40) { c.fillStyle = col(230, 50, 25); c.font = f(24); c.textAlign = 'center'; c.fillText(eyepiece().name, scope.x, scope.y - half * s - 10); c.textAlign = 'left'; }
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
  c.font = f(38, 'bold');
  if (inside) { c.textAlign = 'left'; c.fillText(o.label, Math.min(x + sz + 12, W - c.measureText(o.label).width - 8), y + 8); }
  else { c.textAlign = 'center'; const hw = c.measureText(o.label).width / 2 + 8; c.fillText(o.label, Math.min(W - hw, Math.max(hw, x)), y > cy ? y - 34 : y + 54); }
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
/**
 * Add a star (or planet) to the alignment. Checks the tilt and, for a second star, the angle between them; a mismatch
 * shows "Is that X?" on the Align page. opt.stay: stay on the current page when the alignment completes.
 */
function addAlignStar(o, force, opt = {}) {
  const c = profile().cal;
  const rerender = () => (tab === 'align' ? renderAlign() : showTab('align'));
  const ob = makeObs(o); if (!ob) return toast('No sensor data yet');
  if (!force) {
    const raw = altAzFromVec(mulMV(ob.R, model.axis()));
    const ca = checkAltitude(raw.alt, ob.alt, c ? 2.5 : 3.5);
    if (!ca.ok) { assist.pending = { ob, o, msg: `The scope is at ${raw.alt.toFixed(0)}° altitude, but ${o.label} is at ${ob.alt.toFixed(0)}° right now — ${Math.abs(ca.diff).toFixed(0)}° ${ca.diff < 0 ? 'lower' : 'higher'} than expected. It may be a different star.` }; return rerender(); }
    if (align.obs.length) {
      const p0 = align.obs[0], r0 = altAzFromVec(mulMV(p0.R, model.axis()));
      const cp = checkPair(r0, raw, { alt: p0.alt, az: p0.az }, { alt: ob.alt, az: ob.az });
      if (!cp.ok) { assist.pending = { ob, o, msg: `The scope moved ${cp.measured.toFixed(0)}° from ${p0.label}, but ${o.label} is ${cp.expected.toFixed(0)}° from it. One of the two may be the wrong star.` }; return rerender(); }
    }
  }
  assist.pending = null; align.obs.push(ob); align.confirm.push({ ...ob, kind: 'align' }); refit();
  if (align.obs.length === 1 && $('#a-finck') && $('#a-finck').checked) { profile().finder = { star: o.label, t: Date.now() }; save(); }
  if (align.obs.length === alignNeeded()) {
    cue.onTarget(); toast(`Aligned on ${align.obs.map((x) => x.label).join(' and ')}`, 3000);
    if (opt.stay) { if (tab === 'push') renderPush(); return; }
    if (!flowStepDone('align')) showTab(state.target ? 'push' : 'find');
    return;
  }
  toast(`Added ${o.label}. ${alignNeeded() - align.obs.length === 1 ? 'One more: point at another bright one far from it.' : ''}`, 4000);
  if (opt.stay) { if (tab === 'push') renderPush(); return; }
  renderAlign();
}

/**
 * Bright things the scope could be on right now, best match first (Build 112). Height comes from gravity and is good
 * to a degree or so even before alignment; direction comes from the alignment, else the compass (rough), else nothing,
 * when brightness decides between objects at the right height.
 */
function pointedCandidates(n = 4, facing = null) {
  const cur = pointing(); if (!cur) return { list: [], alt: null, how: 'none' };
  const aligned = !!cur.ready, g = aligned || facing != null ? null : guessPointing();
  const az = aligned ? cur.az : facing != null ? facing : g ? g.az : null, how = aligned ? 'aligned' : facing != null ? 'facing' : g ? 'compass' : 'height';
  const azTol = aligned ? 8 : how === 'facing' ? 35 : 45, altTol = aligned ? 6 : 4;
  const list = [];
  for (const o of sky.objects) {
    if (o.alt == null || o.alt < 2) continue;
    if (!((o.planet || o.key.startsWith('st:')) && (o.mag ?? 9) <= 3)) continue;     // bright enough to be sure of by eye (not Uranus or Neptune)
    const dAlt = Math.abs(o.alt - cur.alt); if (dAlt > altTol) continue;
    let dAz = null;
    if (az != null) { dAz = Math.abs(wrap180(o.az - az)) * Math.cos(o.alt * D2R); if (dAz > azTol) continue; }
    const score = dAlt / 1.5 + (dAz != null ? dAz / (azTol / 4) + (o.mag ?? 2) * 0.35 : 0);   // no direction known: go by height only, never by brightness
    list.push({ o, dAlt, dAz, sep: az != null ? sepDeg(cur.alt, az, o.alt, o.az) : null, score });
  }
  return { list: list.sort((x, y) => x.score - y.score).slice(0, n), alt: cur.alt, how };
}
/** "What am I pointing at?": the app's best guesses, and one tap to align or sync on the right one. */
function openWhatsThis(from = tab) {
  // The phone's compass is often thrown off by the telescope itself (metal, motors, a mount), so before alignment the
  // dialog asks which way the scope faces: one tap, and objects at the right height on the other side drop out.
  let facing = null;
  { const g = !pointing()?.ready ? guessPointing() : null; if (g) facing = Math.round(g.az / 45) % 8 * 45; }   // start from the compass; one tap changes it
  const draw = () => {
    const r = pointedCandidates(facing != null ? 4 : 6, facing), needAlign = state.mode !== 'compass' && align.obs.length < alignNeeded();
    const verb = needAlign ? (align.obs.length ? 'use it as the second alignment star' : 'align on it') : 'sync on it';
    const sure = r.how === 'aligned' || r.how === 'facing';
    const g = r.how === 'compass' ? guessPointing() : null;
    dlgCard().innerHTML = `<h3 style="margin-top:0">What is the scope pointing at?</h3>
      ${r.alt == null ? '<p>No motion-sensor reading yet. Put the phone on the telescope and try again.</p>' : `
      <p class="small" style="margin:0 0 6px">Centre it in the eyepiece first. The scope is tilted <b>${r.alt.toFixed(0)}°</b> up${guessPointing() && r.how !== 'aligned' ? ` and the compass says it faces <b>${compassName(guessPointing().az)}</b> (${esc(sensors.compassSource || 'compass')}${sensors.compassCal ? ', ' + esc(sensors.compassCal) : ''}; metal nearby can throw a compass off, so tap another direction if it's wrong)` : ''}.</p>
      ${r.how !== 'aligned' ? `<div class="small" style="margin:4px 0">Which way is the scope facing?</div><div class="dirs wtdirs">${DIRS.map((d, i) => `<button data-wdir="${i * 45}" class="${facing === i * 45 ? 'on' : ''}">${d}</button>`).join('')}</div>` : ''}
      ${r.list.length ? `<div class="whatlist">${r.list.map((c, i) => `<button class="${i === 0 && sure ? 'primary' : ''}" data-wk="${esc(c.o.key)}"><b>${esc(c.o.label)} <span class="wtdir">${compassName(c.o.az)}</span></b><span class="small muted">${c.o.planet ? (c.o.id === 'Moon' ? 'the Moon' : 'planet') : 'star'}, magnitude ${(+c.o.mag).toFixed(1)} · ${c.o.alt.toFixed(0)}° up in the ${compassName(c.o.az)}${i === 0 && sure ? ' · best match' : ''}</span></button>`).join('')}</div>
        <p class="muted small">${sure ? `Tap the right one to ${verb}.` : `These are at the right height. Tap the one in the direction the scope faces to ${verb}, or tap a direction above.`}</p>`
      : `<p>Nothing bright (stars brighter than magnitude 3, planets, the Moon) is at that height${r.how !== 'height' ? ' in that direction' : ''}. ${facing != null ? 'Try the next direction over.' : 'Is the phone sitting firmly on the tube?'}</p>`}`}
      ${mountChecked() || align.obs.length ? '' : `<p class="small muted">The height reading depends on how the phone sits on the tube, and that hasn't been checked yet. <a id="wt-mc">Check it first</a></p>`}
      <div class="btnrow"><button id="wt-again">Look again</button><button id="wt-close">Close</button></div>`;
    dlgCard().querySelectorAll('[data-wk]').forEach((b) => b.onclick = () => {
      const o = sky.objects.find((x) => x.key === b.dataset.wk); closeDlg(); if (!o) return;
      if (needAlign) addAlignStar(o, false, { stay: from === 'push' });
      else { doSync(o); if (tab === 'push') renderPush(); else if (tab === 'align') renderAlign(); }
    });
    dlgCard().querySelectorAll('[data-wdir]').forEach((b) => b.onclick = () => { facing = facing === +b.dataset.wdir ? null : +b.dataset.wdir; draw(); });
    $('#wt-again').onclick = draw; $('#wt-close').onclick = closeDlg;
    if ($('#wt-mc')) $('#wt-mc').onclick = () => { closeDlg(); showTab('align'); };
  };
  refreshSky(true); draw(); dlg().classList.remove('hidden');
}
/**
 * Before aligning (Build 113): confirm how the phone sits on the tube. Point the tube near straight up; whichever edge
 * (or the back) of the phone then points at the sky is the one that runs along the tube. Each possible position puts a
 * different side of the phone there, 90° apart, so even a rough "as high as it goes" (60° or more) tells them apart.
 */
const MOUNT_AXES = [['top-sky', [0, 1, 0]], ['top-mirror', [0, -1, 0]], ['across-right', [1, 0, 0]], ['across-left', [-1, 0, 0]], ['camera', [0, 0, -1]]];
function mountCheckRead() {
  if (!sensors || !sensors.fresh()) return null;
  const R = avgR(1.0) || sensors.R, up = [R[2][0], R[2][1], R[2][2]];          // straight up, in the phone's own axes
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], asin = (x) => Math.asin(Math.max(-1, Math.min(1, x))) * R2D;
  const cur = asin(dot(MOUNTINGS[state.mounting].d, up));
  const best = MOUNT_AXES.map(([k, d]) => [k, asin(dot(d, up))]).sort((a, b) => b[1] - a[1])[0];
  const screenUp = asin(up[2]);                                                  // screen facing the sky
  return { cur, best, screenUp };
}
const mountChecked = () => state.mountOk && state.mountOk.mount === state.mounting && Date.now() - state.mountOk.t < 14 * 3600e3;
/**
 * "Phone on the scope: <how> · Change" (Build 122): always on the Align page and in Setup, so the way the phone sits
 * can be told to the app directly. Change opens the pictures; picking one clears the alignment (it depends on it).
 */
let mountRowOpen = false;   // the pictures stay open while someone flips through them (each pick redraws the page)
// Build 127: the row carries a small picture of the position, and also sits on the start screen under the location,
// so the app says how it thinks the phone is mounted before anything else happens. `plain` is that compact form: no
// card border and the short wording ("On top, top edge to the sky end"). The row is found inside `root`, since the start screen, Align and Setup can each hold one.
function mountRowHTML(plain = false) {
  const m = MOUNTINGS[state.mounting];
  return `<div class="${plain ? 'mntrow plain' : 'card mntrow'}"><div class="mnthead"><span class="mntpic" aria-hidden="true">${mountSVG(state.mounting)}</span><span class="mnttxt"><span class="muted small">Phone on the scope</span><b>${esc(plain ? `${m.where}, ${m.edge.charAt(0).toLowerCase()}${m.edge.slice(1)}` : m.label)}</b></span><button class="mini mr-change" aria-expanded="${mountRowOpen}">${mountRowOpen ? 'Done' : 'Change'}</button></div>
    <div class="mr-pick${mountRowOpen ? '' : ' hidden'}"><p class="muted small" style="margin:6px 0">Tap the picture that matches how the phone sits on the tube.</p>${mountPickerHTML()}</div></div>`;
}
function wireMountRow(redraw, root = document) {
  const b = $('.mr-change', root), pick = $('.mr-pick', root); if (!b || !pick) return;
  b.onclick = () => { mountRowOpen = pick.classList.toggle('hidden') === false; b.setAttribute('aria-expanded', mountRowOpen); b.textContent = mountRowOpen ? 'Done' : 'Change'; };
  wireMountPicker(pick, (ch) => {
    if (ch) { state.mountOk = { mount: state.mounting, t: Date.now(), manual: true }; save(); toast(`Phone on the scope: ${MOUNTINGS[state.mounting].label.toLowerCase()}. Align again.`, 3500); }
    redraw();
  });
}
function mountCheckHTML() {
  if (mountChecked() || align.obs.length) return '';
  return `<div class="card mntcheck" id="mc-card"><b>First: is the phone set the right way round?</b>
    <p class="small" style="margin:4px 0">The app thinks the phone is <b>${esc(MOUNTINGS[state.mounting].label.toLowerCase())}</b>. Point the tube as high as it will go (near straight up), then tap <b>Check</b>.</p>
    <p class="small" id="mc-live"></p>
    <div class="btnrow"><button id="mc-go" class="primary">Check</button><button id="mc-skip">Skip</button></div><div id="mc-res"></div></div>`;
}
function wireMountCheck() {
  const card = $('#mc-card'); if (!card) return;
  const live = () => { const r = mountCheckRead(), el = $('#mc-live'); if (!el || !card.isConnected) return; el.textContent = r ? `With this setting the tube reads ${r.cur.toFixed(0)}° up.` : 'Waiting for the motion sensors…'; setTimeout(live, 400); };
  live();
  $('#mc-skip').onclick = () => { state.mountOk = { mount: state.mounting, t: Date.now(), skipped: true }; save(); renderAlign(); };
  $('#mc-go').onclick = () => {
    const r = mountCheckRead(), out = $('#mc-res'); if (!r) { out.innerHTML = '<p class="small">No motion-sensor reading yet.</p>'; return; }
    if (r.cur >= 60) {
      state.mountOk = { mount: state.mounting, t: Date.now(), alt: r.cur }; save(); cue.onTarget();
      toast(`Confirmed: ${MOUNTINGS[state.mounting].label.toLowerCase()} (tube reads ${r.cur.toFixed(0)}° up)`, 3500); renderAlign(); return;
    }
    const [k, alt] = r.best;
    if (alt >= 60 && k !== state.mounting && MOUNTINGS[k].d.join() !== MOUNTINGS[state.mounting].d.join()) {
      out.innerHTML = `<p class="small"><b>The phone looks different from the setting.</b> With the tube up, it is the phone's <b>${{ 'top-sky': 'top edge', 'top-mirror': 'bottom edge', 'across-right': 'right edge', 'across-left': 'left edge', camera: 'back (the camera side)' }[k]}</b> that points at the sky, so the phone is probably <b>${esc(MOUNTINGS[k].label.toLowerCase())}</b>.</p><div class="btnrow"><button id="mc-sw" class="primary">Switch to that</button><button id="mc-no">No, keep mine</button></div>`;
      $('#mc-sw').onclick = () => { setMounting(k); state.mountOk = { mount: k, t: Date.now(), alt }; save(); toast(`Phone position set: ${MOUNTINGS[k].label.toLowerCase()}`, 3500); renderAlign(); };
      $('#mc-no').onclick = () => { out.innerHTML = '<p class="small muted">Kept. If the arrows go the wrong way, tap Change next to “Phone on the scope” above.</p>'; };
      return;
    }
    out.innerHTML = r.screenUp >= 60 ? '<p class="small">The <b>screen</b> is facing the sky. On the telescope the screen should face you or out to the side, with one edge or the camera running along the tube.</p>'
      : `<p class="small">The tube doesn't look high enough: no side of the phone is pointing near straight up (best ${alt.toFixed(0)}°). Raise the tube further, keep the phone still, and tap Check again.</p>`;
  };
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
      <div class="alguide" id="a-guide" aria-live="polite"><svg viewBox="0 0 100 100" class="alarrow" id="a-arrow" aria-hidden="true"><path class="ar" d="M50 6 L84 46 L62 46 L62 94 L38 94 L38 46 L16 46 Z"/><g class="ok"><circle cx="50" cy="50" r="34"/><circle cx="50" cy="50" r="8"/></g></svg><div><div class="algbig" id="a-live">Waiting for sensors…</div><div class="small" id="a-sub">${esc(s.label)}</div></div></div>
      <canvas id="a-chart" class="chart" width="600" height="600"></canvas>
      ${done === 0 ? finderHowHTML(s.label, !profile().finder, 'a-finck') : ''}
      <p class="muted small">Get it in the red-dot finder first, then centre it in the eyepiece and tap <b>It's centred</b>. Not sure it's the right star? Tap <b>Different star</b>.</p>`;
  } else if (done >= need) {
    assistHTML = `<div class="card"><b>✓ Aligned on ${align.obs.map((o) => esc(o.label)).join(' and ')}.</b>
      ${f.solvedAxis && !c ? '<div class="btnrow"><button id="savecal2">Remember how the phone sits — next time one star is enough</button></div>' : ''}<p class="muted small">Tap Sync on anything you centre to keep it accurate. Before a long push, the app suggests a star to check on the way.</p>
      <div class="btnrow"><button id="a-find" class="primary">Pick a target</button></div></div>`;
  } else assistHTML = '<p class="muted">No bright stars above 15° right now.</p>';
  el.innerHTML = `${BACK}
    <h2>Star alignment</h2>
    ${mountRowHTML()}
    ${state.mode !== 'compass' ? mountCheckHTML() : ''}
    ${state.mounting === 'camera' && state.mode !== 'compass' ? `<div class="card"><b>Your phone looks along the tube</b><p class="muted small" style="margin:4px 0 8px">The camera can do this for you: no star to find or centre.</p><button id="a-cam" class="primary">${profile().camBore ? 'Align with the camera' : 'Line up and align with the camera'}</button></div>` : ''}
    ${state.mode === 'compass' ? `<p class="muted">Compass mode is on: azimuth comes from the magnetometer. Star alignment below uses the gyro instead and is usually more accurate — switch in Setup.</p>` : ''}
    ${assistHTML}
    ${assist.pending ? '' : `<div class="card whatcard"><div><b>Already on something bright?</b><div class="muted small">A planet or bright star you know. Centre it and the app will guess which one it is.</div></div><button id="a-what">What am I on?</button></div>`}
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
  if ($('#a-what')) $('#a-what').onclick = () => openWhatsThis('align');
  wireMountRow(renderAlign, el);
  wireMountCheck();
  if ($('#a-cam')) $('#a-cam').onclick = () => { if (!camWiz && !profile().camBore) camWiz = { step: 'start', star: null }; showTab('camera'); };
  const addStar = (o, force) => addAlignStar(o, force);
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
  const arrow = $('#a-arrow'), sub = $('#a-sub');
  // The big arrow at the top of the page (it stays put while the page scrolls): which way to move the scope.
  // Angle 0 = up; turning right is clockwise. Before alignment only up/down is certain unless the compass gives a guess.
  const point = (deg, close) => { if (!arrow) return; arrow.classList.toggle('close', !!close); arrow.classList.toggle('none', deg == null && !close); if (deg != null) arrow.style.transform = `rotate(${deg.toFixed(0)}deg)`; };
  if (!cur) { live.textContent = 'Waiting for sensors…'; point(null); }
  else if (!cur.ready) {               // altitude is known before alignment
    const d = tgt.alt - cur.alt;
    const gp = guessPointing(), gd = gp ? guidance(gp, tgt) : null;
    const azRight = gd && Math.abs(gd.dAz) >= 3;
    if (Math.abs(d) < 1.5 && !azRight) { live.textContent = gd ? 'Height right, direction about right' : `Height right: now swing to the ${compassName(tgt.az)}`; point(gd ? 0 : null, !!gd); }
    else {
      const dx = gd ? wrap180(gd.dAz) * Math.cos(tgt.alt * D2R) : 0;
      point(Math.atan2(dx, d) * 180 / Math.PI);
      live.textContent = [Math.abs(d) >= 1.5 ? `${d > 0 ? 'Raise' : 'Lower'} ${Math.abs(d).toFixed(0)}°` : '', azRight ? `swing ${Math.abs(gd.dAz).toFixed(0)}° ${gd.dAz > 0 ? 'right' : 'left'}` : !gd ? `face ${compassName(tgt.az)}` : ''].filter(Boolean).join(' · ');
    }
    if (sub) sub.textContent = `${s.label} · ${gd ? 'left/right is a rough compass guess' : 'up/down is exact; no compass for left/right'}`;
  } else {
    const g = guidance(cur, tgt);
    if (g.sep < 1) { point(0, true); live.textContent = 'In the finder: centre it'; }
    else { point(Math.atan2(g.dAz * Math.cos(tgt.alt * D2R), g.dAlt) * 180 / Math.PI); live.textContent = `${fmtDelta(g.dAz)} ${g.dAz > 0 ? 'right' : 'left'}, ${fmtDelta(g.dAlt)} ${g.dAlt > 0 ? 'up' : 'down'}`; }
    if (sub) sub.textContent = `${s.label} · ${g.sep.toFixed(g.sep < 10 ? 1 : 0)}° away`;
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
  if (T.length < 3) return toast(sky.sunAlt() > -6 ? 'Too bright. Wait until the sky is darker.' : 'Not enough suitable targets above 25° right now.', 4000);
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
/** Start the race: a 3-second countdown, or to `at` (a shared start time, ms) when one is given. */
function startGame(at = null) {
  game.play = game.targets.filter((o) => playable(o));        // targets not up at this site are left out, without penalty
  if (!game.play.length) return toast('None of these targets are above 20° here right now.');
  game.phase = 'count'; game.countEnd = at || Date.now() + 3000; game.i = 0; game.splits = []; game.penalty = 0; game.hints = 0; game.manual = 0; game.dw = {};
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
/** The plan's targets (sync stars left out), for racing. */
const planRaceObjs = () => (state.plan && state.plan.items ? state.plan.items.filter((x) => !x.sync).map((x) => objByKey(x.key)).filter(Boolean) : []);
function racePlan() {
  sky.updateAll();
  const objs = planRaceObjs();
  if (objs.length < 2) return toast('Add at least two targets to race.');
  const up = objs.filter((o) => playable(o)).length;
  loadChallenge(encodeChallenge({ style: state.gameStyle || 'push', tokens: objs.map(tokenFor), host: state.player || '' }));
  showTab('game');
  if (up < objs.length) toast(`${objs.length - up} of ${objs.length} aren't above 20° right now and will be skipped`, 4000);
}
/**
 * The marathon card's picture (Build 125): all 110 Messier objects as a grid of dots, M1 top left to M110 bottom
 * right. Bright = can be caught at some point tonight from here with this telescope; ringed = found tonight; faint =
 * not tonight. Worked out once per night, place, telescope and sky (it rates every object through the night).
 */
let marCard = null;
function marathonCard(found) {
  const N = nightOf(sky), end = N.nautAm || N.rise, dusk = N.naut || N.set, now = new Date();
  const start = dusk && now < dusk ? dusk : now;
  const sig = [N.id, state.active, profile().aperture, skyNelm(), hzSig(), state.site.lat.toFixed(2), state.site.lon.toFixed(2), Math.floor(start.getTime() / 1800000)].join('|');
  if (!marCard || marCard.sig !== sig) {
    let rows = []; try { if (end && end > start) rows = marathonList(sky, { start, end, scope: profile(), nelm: skyNelm(), horizon: horizonNow() }); } catch (e) { console.error(e); }
    const num = (o) => { const c = (o.cats || []).find((x) => /^M\d+$/.test(x)); return c ? +c.slice(1) : 0; };
    const byNo = {}; for (const o of sky.objects) { const n = num(o); if (n && !o.twin && !byNo[n]) byNo[n] = o.key; }
    marCard = { sig, can: new Set(rows.map((r) => r.key)), byNo };
  }
  const dots = []; let nCan = 0;
  for (let n = 1; n <= 110; n++) {
    const k = marCard.byNo[n], got = k && found[k], can = k && marCard.can.has(k); if (can || got) nCan++;
    dots.push(`<i class="${got ? 'got' : can ? 'can' : ''}"></i>`);
  }
  return { html: `<div class="mgrid" role="img" aria-label="${nCan} of the 110 Messier objects can be caught tonight">${dots.join('')}</div>`, nCan };
}
function renderLobby(el) {
  const aligned = state.mode === 'gyro' ? !!align.fit : true;
  const sel = state.gameStyle || 'push';
  const M = state.marathon, tonight = nightOf(sky).id, mine = M && M.night === tonight ? M : null, nFound = mine ? Object.keys(mine.found).length : 0;
  const best = state.marathonBest;
  const MC = marathonCard(mine ? mine.found : {}), nPlan = planRaceObjs().length;
  const dark = sky.sunAlt() < -12;
  el.innerHTML = `<h2>Play</h2>
    <p class="playlead">Turn tonight's sky into a game. On your own, or against friends at the same site.</p>
    ${aligned ? '' : `<div class="strip warn"><span>Both games follow the arrows, so align the telescope first. Two minutes.</span><button id="g-align" class="mini">Align</button></div>`}
    <div class="card gamecard marathon">
      <div class="gamehead"><h3>Messier Marathon</h3><span class="gamebadge">${mine && !mine.over ? 'in progress' : 'solo'}</span></div>
      <p class="gamepitch">How many of the 110 can you bag in one night?</p>
      ${MC.html}
      <p class="gamestat"><b>${MC.nCan}</b> of the 110 ${dark ? 'can still be caught tonight' : 'will be in reach tonight'} from here${mine ? `, and you have found <b>${nFound}</b>` : ''}.</p>
      ${best ? `<p class="muted small">Your best night: ${best.found} of ${best.possible} possible, ${shortDate(best.when)}.</p>` : ''}
      <div class="btnrow"><button id="mm-go" class="primary big" ${aligned ? '' : 'disabled'}>${mine && !mine.over ? 'Carry on' : mine ? 'Start again tonight' : 'Start the marathon'}</button></div>
      <p class="muted small">No clock, one point each. The app picks the order: whatever is about to set comes first, then the shortest hop.</p>
      <label class="row"><span>Sync stars before long hops <span class="muted small">(a bright star to centre first, so the arrows land closer)</span></span><input type="checkbox" id="mm-sync" ${state.marSync !== false ? 'checked' : ''}></label>
    </div>
    <div class="card gamecard race">
      <div class="gamehead"><h3>Race</h3><span class="gamebadge">solo or with friends</span></div>
      <p class="gamepitch">Ten targets, one route, and a stopwatch.</p>
      <svg class="raceart" viewBox="0 0 300 64" aria-hidden="true"><path d="M14 46 44 22 78 40 106 14 138 30 168 12 198 38 226 24 256 44 286 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round" opacity=".7"/>${[[14, 46], [44, 22], [78, 40], [106, 14], [138, 30], [168, 12], [198, 38], [226, 24], [256, 44]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i ? 3.2 : 4.4}" fill="currentColor"/>`).join('')}<path d="M286 18l1.9 4.6 4.9.4-3.7 3.2 1.1 4.8-4.2-2.6-4.2 2.6 1.1-4.8-3.7-3.2 4.9-.4z" class="racestar"/></svg>
      <p class="small">The app picks the ten best targets for your sky right now. Friends scan your code to race the same ten, and you can all start on the same countdown.</p>
      <div class="chiplab">How you find them</div>
      <div class="seg" id="g-style">${Object.entries(STYLES).map(([k, v]) => `<button data-style="${k}" class="${k === sel ? 'on' : ''}">${v.name}</button>`).join('')}</div>
      <p class="muted small" id="g-styledesc">${esc(STYLES[sel].desc)}</p>
      <div class="btnrow"><button id="g-new" class="primary big" ${aligned ? '' : 'disabled'}>New race</button></div>
      <div class="btnrow"><button id="g-scan">Join a friend's race</button><button id="g-paste" class="mini">Paste a code</button></div>
      ${nPlan >= 2 ? `<button class="linkrow" id="g-plan">${ICON.plan || ''}<span><b>Race your plan</b><span class="muted">The ${nPlan} targets in your plan, in its order</span></span></button>` : ''}
      <details class="more"><summary>Leaderboard and your name</summary>
        <label class="field"><span>Your name on the leaderboard</span><input id="g-name" value="${esc(state.player || '')}" placeholder="e.g. Bryan" maxlength="24"></label>
        <label class="field"><span>Observing site <span class="muted small">(optional)</span></span><input id="g-site" value="${esc(state.siteName || '')}" placeholder="e.g. Torrance Barrens" maxlength="40"></label>
        <div class="btnrow"><button id="g-board">Show leaderboard</button></div>
        <div id="g-boardbox"></div></details></div>`;
  if ($('#g-plan')) $('#g-plan').onclick = racePlan;
  $('#g-name').onchange = (e) => { state.player = e.target.value.trim(); save(); };
  $('#g-site').onchange = (e) => { state.siteName = e.target.value.trim(); save(); };
  el.querySelectorAll('[data-style]').forEach((b) => b.onclick = () => { state.gameStyle = b.dataset.style; save(); el.querySelectorAll('[data-style]').forEach((x) => x.classList.toggle('on', x === b)); $('#g-styledesc').textContent = STYLES[state.gameStyle].desc; });
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
  if (r.to.getTime() <= now) { toast(`${r.o.label} has gone. On to the next`, 3000); marPick(); renderGame(); return; }
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
const ROUTE_HOLD = 1440, ROUTE_MOVE = 440;      // ms looking at a stop, ms travelling to the next (Build 124: 2.5× faster than 3600/1100)
function renderRoute() {
  const el = $('#tab-route'), P = planState();
  if (!route) route = { stops: routeStops(), i: 0, f: 1, playing: true, t0: performance.now() };
  const S = route.stops;
  if (!S.length) { el.innerHTML = `<button class="back" id="rt-back">‹ Plan</button><h2>Route preview</h2><p>Add some targets to the plan first.</p>`; $('#rt-back').onclick = () => showTab('plan'); return; }
  const bad = S.filter((s) => s.blocked && s.kind === 'target');
  el.innerHTML = `<button class="back" id="rt-back">‹ Plan</button><h2>Route preview</h2>
    <p class="muted small" style="margin:-6px 0 4px">${esc(planTitle(P))}</p>
    <div class="card rtcard" id="rt-card"></div>
    <div class="rtgrid"><canvas id="rt-map" class="chart rtmap" width="800" height="800"></canvas><div id="rt-views" class="rtviews"></div></div>
    ${bad.length ? `<p class="small" style="text-align:center;margin:4px 0"><b>${bad.length} stop${bad.length === 1 ? ' is' : 's are'} behind your blocked sky at the planned time:</b> ${bad.map((s) => esc(s.o.label)).join(', ')}</p>` : ''}
    <p class="muted small" style="text-align:center;margin:4px 0">Map: the whole sky, rim = horizon, middle = overhead${horizonNow() ? ', hatched = your blocked sky' : ''}.</p>
    <div class="actionbar"><button id="rt-prevb" class="nav" aria-label="Back one stop">◀ Back</button><button id="rt-play" class="primary wide"></button><button id="rt-nextb" class="nav" aria-label="Forward one stop">Next ▶</button></div>`;
  $('#rt-back').onclick = () => showTab('plan');
  const go = (i) => { route.i = Math.max(0, Math.min(S.length - 1, i)); route.f = 0; route.t0 = performance.now(); routeCard(); };
  // Back / Next step one stop and keep playing or paused as it was (Build 124; they used to pause it).
  $('#rt-prevb').onclick = () => { go(route.i - 1); route.f = 1; route.t0 = performance.now() - ROUTE_MOVE; routeCard(); };
  $('#rt-nextb').onclick = () => { go(route.i + 1); };
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
      drawEyepiece(cv, sky, o.pairs && o.key.startsWith('st:') ? { ...o, t: 'DS' } : o, tg, e, p, { matrix: state.rot180 ? viewMatrix(p, tg) : null, bright: vis(), nelm: skyNelm(), env: eyeEnv(tg, s.t), refExit: p.aperture / (p.fl / wide.fl), thumb: true, date: s.t });
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
function hzBindBack() { const b = $('#hz-back'); if (b) b.onclick = () => { hzTrace = null; if (hzFrom === 'start') { showStart(true); } else showTab(hzFrom); }; }
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
    ${g.ch.start ? `<div class="card gwait"><div class="muted small">Everyone starts together at ${new Date(g.ch.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</div><div class="gwait-n mono" id="g-wait">…</div></div>` : ''}
    <div class="card" style="text-align:center"><b>Same site? Others scan this in Play → Join: scan to race the same ${g.targets.length}${g.ch.start ? ', starting together' : ''}.</b>
      <canvas id="g-qr" width="520" height="520" style="width:70%;max-width:260px;display:block;margin:8px auto;border-radius:8px"></canvas>
      <div class="btnrow"><button id="g-copy">Copy / share code</button></div>
      ${g.ch.start ? '' : `<div class="muted small" style="margin-top:6px">Start everyone together in:</div><div class="chips" style="justify-content:center">${[[30, '30 s'], [60, '1 min'], [120, '2 min']].map(([sec, l]) => `<button data-gstart="${sec}">${l}</button>`).join('')}</div>`}</div>
    <div class="btnrow"><button id="g-back">Back</button></div>
    <div class="actionbar"><button id="g-start" class="primary">${g.ch.start ? 'Start now (on my own)' : 'Start — 3, 2, 1…'}</button></div>`;
  drawQR($('#g-qr'), g.code);
  $('#g-copy').onclick = () => exportText(`Skyward challenge ${g.ch.id}`, g.code);
  $('#g-start').onclick = () => startGame();
  // Shared start (Build 123): the start time goes into the code, so the QR changes; friends scan the new one.
  el.querySelectorAll('[data-gstart]').forEach((b) => b.onclick = () => {
    const c = g.ch; loadChallenge(encodeChallenge({ style: c.style, tokens: c.tokens, created: c.created, host: c.host, start: Date.now() + +b.dataset.gstart * 1000 }));
    toast('Friends scan the new code. Every phone counts down to the same moment.', 3500);
  });
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
  // Waiting for a shared start: show the time left, then the usual 3-2-1 ends exactly on the shared moment. A phone
  // whose clock puts the start more than 3 minutes away (we only offer up to 2) is told so instead of waiting.
  if (g.phase === 'ready' && g.ch.start) {
    const ms = g.ch.start - Date.now(), w = $('#g-wait');
    if (ms > 3.5 * 60000) { if (w) w.textContent = 'Check the clock'; if (!g.clockWarned) { g.clockWarned = true; toast(`This phone's clock puts the start ${Math.round(ms / 60000)} minutes away. Check the time in Settings, or use Start now.`, 6000); } return; }
    const sec = Math.max(0, Math.ceil(ms / 1000)); if (w) w.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    if (ms <= 3000 && ms > -15000) startGame(g.ch.start);          // the last 3 seconds count down as usual
    else if (ms <= -15000 && !g.lateNote) { g.lateNote = true; if (w) w.textContent = 'Already started'; toast('The group has already started. Tap Start now: your time counts from your own Go.', 5000); }
    return;
  }
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
    <div class="btnrow"><button class="mini" id="s-new">Add your telescope</button>${p.custom ? `<button class="mini" id="s-del">Delete ${esc(p.name)}</button>` : ''}</div>
    <div id="s-newform" class="card hidden">
      <b>Your telescope</b>
      <label class="row"><span>Name</span><input id="n-name" maxlength="40" placeholder="e.g. My 8-inch Dob"></label>
      <label class="row"><span>Type</span><select id="n-type">${SCOPE_TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="row"><span>Aperture (mm)<span class="muted small" style="display:block">Diameter of the main mirror or lens</span></span><input id="n-ap" type="number" inputmode="decimal" placeholder="e.g. 203"></label>
      <label class="row"><span>Focal length (mm)<span class="muted small" style="display:block">On the tube or in the manual, or aperture × f-number</span></span><input id="n-fl" type="number" inputmode="decimal" placeholder="e.g. 1200"></label>
      <p class="muted small">It starts with the eyepieces of the ${esc(p.name)}; change them below once it's saved.</p>
      <p class="small fcbad" id="n-err"></p>
      <div class="btnrow"><button id="n-save">Save telescope</button><button class="mini" id="n-cancel">Cancel</button></div>
    </div>
    <label class="row"><span>Name</span><input id="s-name" maxlength="40" value="${esc(p.name)}"></label>
    <label class="row"><span>Type</span><select id="s-type">${SCOPE_TYPES.map(([k, l]) => `<option value="${k}" ${(p.type || 'reflector') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="row"><span>Focal length (mm)</span><input id="s-fl" type="number" inputmode="decimal" value="${p.fl}"></label>
    <label class="row"><span>Aperture (mm)<span class="muted small" style="display:block">Diameter of the main mirror or lens · f/${(p.fl / p.aperture).toFixed(1)}</span></span><input id="s-ap" type="number" inputmode="decimal" value="${p.aperture}"></label>
    ${scopeNote(p) ? `<p class="muted small">Where these numbers come from: ${esc(scopeNote(p))}</p>` : ''}
    ${lensView(p) ? `<label class="row"><span>Star diagonal (right-angle eyepiece adapter)<span class="muted small" style="display:block">With it the view is upright but mirror-reversed; without it, upside down.</span></span><input type="checkbox" id="s-diagonal" ${p.diagonal ? 'checked' : ''}></label>` : ''}
    <div class="focpick${lensView(p) ? ' hidden' : ''}"><div><b>Where is the focuser?</b><p class="muted small" style="margin:4px 0 0">Stand behind the telescope with the tube level, looking the way it points. Tap where the focuser sticks out. On a Skyward it is on the right.</p><p id="s-foclab" style="margin:8px 0 0"></p></div>
      <svg viewBox="0 0 160 112" role="group" aria-label="Focuser position"><circle cx="80" cy="70" r="30" class="fp-tube"/><circle cx="80" cy="70" r="20" class="fp-mirror"/><text x="80" y="74" text-anchor="middle" class="fp-t">tube</text>
      ${FOC.map(([v, l]) => { const s = Math.sin(v * D2R), c = Math.cos(v * D2R); return `<g data-foc="${v}" class="fp-opt${(p.focuser ?? 90) === v ? ' on' : ''}" role="button" aria-label="${l}"><line x1="${(80 + 30 * s).toFixed(1)}" y1="${(70 - 30 * c).toFixed(1)}" x2="${(80 + 44 * s).toFixed(1)}" y2="${(70 - 44 * c).toFixed(1)}"/><circle cx="${(80 + 52 * s).toFixed(1)}" cy="${(70 - 52 * c).toFixed(1)}" r="11"/></g>`; }).join('')}</svg></div>
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

    ${mountRowHTML()}
    <details class="more"><summary>Phone mount and sensors (advanced)</summary>
    <label class="row"><span>Phone dock</span><select id="s-dock"><option value="yes" ${state.dock !== 'no' ? 'selected' : ''}>Yes, on a bridge mount</option><option value="no" ${state.dock === 'no' ? 'selected' : ''}>No, strapped to the tube</option></select></label>
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
    <div class="btnrow"><button id="s-gps">Update location (GPS)</button></div>
    <div id="s-lp"></div>

    <h2>Display</h2>
    <label class="row"><span>Day look <span class="muted small">(off = Night, red only; the sun/moon button fades between them)</span></span><input id="s-day" type="checkbox" ${state.day ? 'checked' : ''}></label>
    <label class="row"><span>Screen brightness</span><input id="s-br" type="range" min="0.25" max="1" step="0.05" value="${state.bright}"></label>
    <label class="row"><span>Lowest altitude to list (°)</span><input id="s-min" type="number" value="${state.minAlt}"></label>
    <p class="muted small">Keep screen awake: ${awakeText()}. Sounds are under More.</p>

    <h2>About</h2>
    <p class="small">Skyward Push-To for Ten Telescopes' Skyward 150 Compact, Skyward 200 Visual and Skyward 400, and for other telescopes such as an 80 mm refractor.</p>
    <p class="muted small">Sky positions: Astronomy Engine © Don Cross (MIT). Deep-sky positions, sizes and magnitudes: OpenNGC © Mattia Verga (CC BY-SA 4.0). Globular clusters' horizontal-branch magnitudes: W. E. Harris, Catalog of Parameters for Milky Way Globular Clusters (2010 edition). Caldwell, Herschel 400, RASC double-star and bright-star selections compiled from the PiFinder project's catalog files. Star field: Hipparcos main catalogue (ESA 1997). Constellation figures: Stellarium modern sky culture. Named asterisms: Saguaro Astronomy Club asterism list v3.2. Light-pollution map: NASA Black Marble night lights. Town names: GeoNames (CC BY 4.0). Street maps (with internet): © OpenStreetMap contributors (ODbL), openstreetmap.org/copyright. Dark-sky sites: RASC and DarkSky International listings. Telescope specs from the TenTelescopes Skyward150 and Skyward200 repositories (CC BY-NC 4.0).</p>
    <p class="muted small mono" id="s-diag"></p>`;
  bindBack(el);
  const num = (id) => parseFloat($(id).value);
  // (the star-diagonal box was also #s-diag, the id of the sensor readout at the bottom, so the readout never showed)
  if ($('#s-diagonal')) $('#s-diagonal').onchange = (e) => { p.diagonal = e.target.checked; save(); };
  // Your own telescope (Build 119): name, type, aperture and focal length; it starts with the current scope's eyepieces.
  const form = $('#s-newform');
  $('#s-new').onclick = () => { form.classList.remove('hidden'); $('#s-new').disabled = true; $('#n-name').focus(); };
  $('#n-cancel').onclick = () => { form.classList.add('hidden'); $('#s-new').disabled = false; };
  $('#n-save').onclick = () => {
    const name = $('#n-name').value.trim(), ap = num('#n-ap'), fl = num('#n-fl'), type = $('#n-type').value;
    const err = !name ? 'Give it a name, so you can tell it apart in the list.' : scopeErr(ap, fl);
    if (err) { $('#n-err').textContent = err; return; }
    const key = 'my' + Date.now().toString(36);
    state.profiles[key] = { name, aperture: ap, fl, type: type === 'reflector' ? undefined : type, diagonal: type !== 'reflector', focuser: 90, custom: true,
      source: 'Your own figures.', eyepieces: structuredClone(p.eyepieces), cal: null };
    state.active = key; state.ep = 0; align = { obs: [], fit: null, syncs: [], confirm: [] }; applyModelSettings(); save(); renderSetup();
    toast(`${name} added and in use`);
  };
  // Deleting takes two taps (no pop-up): the first changes the button to ask again.
  if ($('#s-del')) $('#s-del').onclick = (e) => {
    const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = `Tap again to delete ${p.name}`; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = `Delete ${p.name}`; } }, 4000); return; }
    const gone = p.name; delete state.profiles[state.active]; state.active = Object.keys(state.profiles)[0]; state.ep = 0;
    align = { obs: [], fit: null, syncs: [], confirm: [] }; applyModelSettings(); save(); renderSetup(); toast(`${gone} deleted`);
  };
  $('#s-name').onchange = (e) => { const v = e.target.value.trim(); if (v) { p.name = v; save(); } renderSetup(); };
  $('#s-type').onchange = (e) => { const v = e.target.value; p.type = v === 'reflector' ? undefined : v; if (v !== 'reflector' && p.diagonal == null) p.diagonal = true; save(); renderSetup(); };
  $('#s-prof').onchange = (e) => { state.active = e.target.value; state.ep = 0; align = { obs: [], fit: null, syncs: [], confirm: [] }; applyModelSettings(); save(); renderSetup(); };
  // Checked like a new telescope's figures; a number that makes no sense is refused with the reason.
  $('#s-fl').onchange = () => { const v = num('#s-fl'), e = scopeErr(p.aperture, v); if (e) toast(e, 6000); else { p.fl = v; save(); } renderSetup(); };
  $('#s-ap').onchange = () => { const v = num('#s-ap'), e = scopeErr(v, p.fl); if (e) toast(e, 6000); else { p.aperture = v; save(); } renderSetup(); };
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
  wireMountRow(renderSetup, el);
  $('#s-mode').onchange = (e) => { state.mode = e.target.value; save(); };
  $('#s-cc').onchange = () => { state.compassCorr = num('#s-cc') || 0; save(); };
  $('#s-rate').onchange = (e) => { state.useRate = e.target.checked; model.useRate = state.useRate; save(); };
  $('#s-smooth').onchange = (e) => { state.smooth = parseFloat(e.target.value); save(); };
  $('#s-clrcal').onclick = () => { p.cal = null; applyModelSettings(); save(); renderSetup(); };
  const site = () => { state.site = { lat: num('#s-lat'), lon: num('#s-lon'), elev: num('#s-el') || 0, source: 'entered manually' }; sky.setSite(state.site.lat, state.site.lon, state.site.elev); planRows = null; rateCache.clear(); siteMoved(); save(); renderLightHere(); };
  ['#s-lat', '#s-lon', '#s-el'].forEach((id) => $(id).onchange = site);
  $('#s-gps').onclick = getGPS;
  $('#s-day').onchange = (e) => setShade(e.target.checked ? 0 : 1, true);
  $('#s-br').oninput = (e) => { state.bright = parseFloat(e.target.value); applyModelSettings(); save(); };
  $('#s-min').onchange = () => { state.minAlt = num('#s-min') || 0; save(); };
  renderLightHere();
}

// ---- Light pollution where you are: the map estimate, the sky check (if any), and a small map of the area (Build 98)
const BORTLE_COL = ['', '#141414', '#3d4466', '#2457c9', '#2f9e44', '#e3d03a', '#f08a24', '#d8321f', '#f2a6cf', '#ffffff'];
const BORTLE_NAME = ['', 'Excellent dark sky', 'Truly dark sky', 'Rural sky', 'Rural-suburban sky', 'Suburban sky', 'Bright suburban sky', 'Edge-of-city sky', 'City sky', 'Inner-city sky'];
const LP_MIN = 0.012, LP_MAX = 3;                    // half-height of the map in degrees of latitude: about 3 km to 670 km tall
// Towns to label on the light-pollution map so you can find your way around it (largest first; labels that would overlap are skipped).
const LP_TOWNS = [['Chicago', 41.88, -87.63], ['New York', 40.71, -74.01], ['Toronto', 43.65, -79.38], ['Philadelphia', 39.95, -75.17], ['Montréal', 45.50, -73.57], ['Washington', 38.91, -77.04], ['Atlanta', 33.75, -84.39], ['Boston', 42.36, -71.06], ['Detroit', 42.33, -83.05], ['Dallas', 32.78, -96.80], ['Minneapolis', 44.98, -93.27], ['St. Louis', 38.63, -90.20], ['Baltimore', 39.29, -76.61], ['Charlotte', 35.23, -80.84], ['Pittsburgh', 40.44, -79.99], ['Cincinnati', 39.10, -84.51], ['Kansas City', 39.10, -94.58], ['Cleveland', 41.50, -81.69], ['Columbus', 39.96, -83.00], ['Indianapolis', 39.77, -86.16], ['Nashville', 36.16, -86.78], ['Ottawa', 45.42, -75.70], ['Milwaukee', 43.04, -87.91], ['Louisville', 38.25, -85.76], ['Memphis', 35.15, -90.05], ['Richmond', 37.54, -77.44], ['Raleigh', 35.78, -78.64], ['Oklahoma City', 35.47, -97.52], ['Buffalo', 42.89, -78.88], ['Québec', 46.81, -71.21], ['Winnipeg', 49.90, -97.14], ['Hamilton', 43.26, -79.87], ['Omaha', 41.26, -95.93], ['Rochester', 43.16, -77.61], ['Birmingham', 33.52, -86.80], ['Jacksonville', 30.33, -81.66], ['Grand Rapids', 42.96, -85.67], ['Toledo', 41.65, -83.54], ['Des Moines', 41.59, -93.62], ['Kitchener', 43.45, -80.49], ['London', 42.98, -81.25], ['Albany', 42.65, -73.76], ['Syracuse', 43.05, -76.15], ['Windsor', 42.31, -83.04], ['Madison', 43.07, -89.40], ['Lansing', 42.73, -84.56], ['Oshawa', 43.90, -78.86], ['Flint', 43.01, -83.69], ['Barrie', 44.39, -79.69], ['Guelph', 43.55, -80.25], ['Kingston', 44.23, -76.49], ['Erie', 42.13, -80.09], ['Green Bay', 44.51, -88.01], ['Sudbury', 46.49, -80.99], ['Duluth', 46.79, -92.10], ['Burlington', 44.48, -73.21], ['Thunder Bay', 48.38, -89.25], ['Peterborough', 44.30, -78.32], ['Niagara Falls', 43.09, -79.08], ['Sarnia', 42.97, -82.40], ['Sault Ste. Marie', 46.52, -84.33], ['North Bay', 46.31, -79.46], ['Traverse City', 44.76, -85.62], ['Orillia', 44.61, -79.42], ['Owen Sound', 44.57, -80.94], ['Huntsville', 45.33, -79.22]];                     // half-height of the map in degrees of latitude: ~55, 140, 330 km across
let lpH = 1.25, lpC = null;                         // zoom (half-height, degrees) and centre (null = your spot)
/** Setup → Location: one line, pointing to the full picture in the sky darkness check. */
function renderLightHere() {
  const el = $('#s-lp'); if (!el) return;
  const g = skyGlowGrid();
  if (!g) { loadSkyGlow().then((x) => { if (x && $('#s-lp')) renderLightHere(); }); el.innerHTML = ''; return; }
  const here = skyGlowAt(state.site.lat, state.site.lon, g);
  el.innerHTML = `<p class="small">Light pollution here: ${here ? `<b>about Bortle ${here.bortle}</b> (map estimate)` : 'outside the built-in map'}${skyQ() ? ` · your check: about Bortle ${bortleOfNelm(checkNelm())}` : ''}</p>
    <div class="btnrow"><button id="s-lpcheck">Your sky: map and darkness check</button></div>`;
  $('#s-lpcheck').onclick = () => openSkyCheck();
}
/** The light-pollution picture for this spot (summary, the sky check if any, and the map) into element el. */
function lightHereHTML(g, here) {
  const sq = skyQ(), old = state.skyq && !sq ? state.skyq : null;
  const checkLine = sq ? `<p class="small">Your sky darkness check (${esc(shortDate(sq.when))}): <b>${esc(sq.label)}</b>, about Bortle ${bortleOfNelm(checkNelm(sq))}, stars brighter than magnitude ${checkNelm(sq).toFixed(1)}. The app uses your check, not the map.</p>` : '';
  const dbt = old ? checkDoubt(old) : null;
  const oldLine = old ? `<p class="muted small">Your last darkness check (${esc(shortDate(old.when))}) ${dbt ? `read much brighter than the map says for this spot (about Bortle ${bortleOfNelm(old.base)} against Bortle ${dbt.bortle}). Clouds, haze, the Moon, a light nearby or a test run can do that, so` : old.lat != null && distKm({ lat: old.lat, lon: old.lon }, state.site) > SKYQ_KM ? 'was taken somewhere else, so' : `was taken when ${old.moonUp ? 'the Moon' : 'twilight'} was too bright to see the light pollution under it, so`} the app goes by the map here until you check again.</p>` : '';
  if (!here) return `<p class="muted small">This spot is outside the built-in light-pollution map (it covers about 30°–50° N, 70°–100° W). The 30-second check below measures your sky anywhere.</p>${checkLine}${oldLine}`;
  return `<p class="small">Light-pollution map: <b>about Bortle ${here.bortle}</b> — ${BORTLE_NAME[here.bortle].toLowerCase()}. Sky brightness about ${here.sqm.toFixed(1)} mag/arcsec², stars brighter than about magnitude ${here.nelm.toFixed(1)} overhead on a clear moonless night.</p>
    ${checkLine}${oldLine}
    <canvas class="lpmap" aria-label="Map of estimated sky brightness around you. Pinch or use Closer and Wider to zoom, drag to move."></canvas>
    <div class="lpleg">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => `<span><i style="background:${BORTLE_COL[b]}"></i>${b}</span>`).join('')}</div>
    <div class="btnrow"><button class="lpless">Closer</button><button class="lpmore">Wider</button><button class="lpme hidden">Back to me</button><button class="lpstreets">Hide streets</button></div>
    <p class="muted small lpzoom" style="margin:0"></p>
    <p class="muted small">Bortle class, 1 darkest. The bright patches are towns: their light glows in the sky for tens of kilometres around them. Estimated from NASA Black Marble satellite night lights (${g.year || 'recent'}) in 5 km squares, so it can't show the dark side of a hill or a park in town. The 30-second check measures your actual sky.</p>`;
}
function wireLightMap(el, g) {
  const cv = el.querySelector('.lpmap'); if (!cv) return;
  if (!townsLoaded()) loadTowns().then((T) => { if (T && cv.isConnected) draw(); });
  let raf = 0, view = null;
  const draw = () => {
    raf = 0; if (!cv.isConnected) return;
    view = drawLightMap(cv, g, { center: lpC || state.site, hLat: lpH, streets: streetsOn(), onTile: () => { if (!raf && cv.isConnected) raf = requestAnimationFrame(draw); } });
    el.querySelector('.lpless').disabled = lpH <= LP_MIN * 1.01; el.querySelector('.lpmore').disabled = lpH >= LP_MAX * 0.99;
    el.querySelector('.lpme').classList.toggle('hidden', !lpC);
    const km = Math.round(lpH * 2 * 111), z = el.querySelector('.lpzoom');
    if (z) z.textContent = `Map about ${km < 10 ? (lpH * 2 * 111).toFixed(1) : km} km top to bottom.${lpH < 0.1 ? ' Closer than the map\'s 5 km squares: the colours are smoothed between them, so use the streets to find your spot rather than to read the sky.' : ''}`;
    const sb = el.querySelector('.lpstreets'); if (sb) { sb.classList.toggle('hidden', navigator.onLine === false); sb.textContent = state.streets === false ? 'Show streets' : 'Hide streets'; }
  };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const zoomBy = (f) => { lpH = Math.min(LP_MAX, Math.max(LP_MIN, lpH * f)); redraw(); };
  const sb = el.querySelector('.lpstreets'); if (sb) sb.onclick = () => { state.streets = state.streets === false; save(); draw(); };
  el.querySelector('.lpless').onclick = () => zoomBy(1 / 2.5);
  el.querySelector('.lpmore').onclick = () => zoomBy(2.5);
  el.querySelector('.lpme').onclick = () => { lpC = null; redraw(); };
  // Drag to move, pinch (or the mouse wheel) to zoom.
  const pts = new Map(); let g0 = null;
  cv.style.touchAction = 'none';
  const pair = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    g0 = pts.size === 2 ? { pinch: pair().d, h: lpH } : { x: e.clientX, y: e.clientY, v: view }; });
  cv.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !g0) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2 && g0.pinch) { const d = pair().d; if (d > 10) { lpH = Math.min(LP_MAX, Math.max(LP_MIN, g0.h * g0.pinch / d)); redraw(); } return; }
    if (pts.size === 1 && g0.v) { const dx = e.clientX - g0.x, dy = e.clientY - g0.y; if (Math.hypot(dx, dy) < 4) return;
      const c = g0.v.ll(g0.v.W / 2 - dx, g0.v.H / 2 - dy); lpC = { lat: Math.max(-80, Math.min(80, c.lat)), lon: c.lon }; redraw(); }
  });
  const up = (e) => { pts.delete(e.pointerId); g0 = pts.size === 1 ? (() => { const [p] = [...pts.values()]; return { x: p.x, y: p.y, v: view }; })() : null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { zoomBy(Math.exp(e.deltaY * 0.002)); e.preventDefault(); }, { passive: false });
  draw();
}
/** OpenStreetMap tiles, fetched only for what's on screen and kept for reuse (their usage policy: no bulk or offline
 *  downloading, credit on the map). Returns the image once loaded, else null (and calls onload when it arrives). */
const OSM_TILES = new Map();
/** Make an OpenStreetMap tile easier to read under the light-pollution colours: water (OSM's pale blue) becomes a
 *  strong dark blue, roads (white and the coloured main roads) stay bright, everything else is darkened so the roads
 *  stand out. Needs the tile server's CORS permission; without it the tile is used as it is. */
function contrastTile(img) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.drawImage(img, 0, 0, 256, 256); const d = x.getImageData(0, 0, 256, 256), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const r = a[i], g = a[i + 1], b = a[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (b > r + 25 && b >= g - 4 && g > r + 15) { a[i] = 22; a[i + 1] = 52; a[i + 2] = 118; continue; }          // water
    if (mn > 246 || (mx > 225 && mx - mn > 45 && r > b + 30)) { a[i] = Math.min(255, r + 10); a[i + 1] = Math.min(255, g + 10); a[i + 2] = Math.min(255, b + 10); continue; }   // roads: white, and the pink/orange/yellow main roads
    a[i] = r * 0.55; a[i + 1] = g * 0.55; a[i + 2] = b * 0.55;                                                     // land, buildings, parks: darker
  }
  x.putImageData(d, 0, 0); return c;
}
function osmTile(z, x, y, onload) {
  const N = 2 ** z; if (y < 0 || y >= N) return null; x = ((x % N) + N) % N;
  const key = `${z}/${x}/${y}`; let t = OSM_TILES.get(key);
  if (!t) {
    t = { img: new Image(), ok: false, cbs: [], cors: true };
    const load = () => { t.img.src = `https://tile.openstreetmap.org/${key}.png`; };
    t.img.crossOrigin = 'anonymous';
    t.img.onload = () => { try { t.draw = t.cors ? contrastTile(t.img) : t.img; } catch (e) { t.draw = t.img; } t.ok = true; t.cbs.splice(0).forEach((f) => f()); };
    t.img.onerror = () => { if (t.cors) { t.cors = false; t.img = Object.assign(new Image(), { onload: t.img.onload, onerror: () => OSM_TILES.delete(key) }); load(); } else OSM_TILES.delete(key); };
    load();
    OSM_TILES.set(key, t); if (OSM_TILES.size > 300) OSM_TILES.delete(OSM_TILES.keys().next().value);
  }
  if (!t.ok && onload && !t.cbs.includes(onload)) t.cbs.push(onload);
  return t.ok ? t.draw : null;
}
const streetsOn = () => state.streets !== false && navigator.onLine !== false;
function drawLightMap(cv, g, opt = {}) {
  const W = cv.clientWidth || 320, H = Math.round(W * (opt.aspect || 0.75)), dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineJoin = 'round';
  // Web Mercator (as street maps use), scaled so the map is about 2·hLat degrees of latitude tall.
  const c0 = opt.center || state.site, D = Math.PI / 180, hLat = opt.hLat || lpH;
  const Sw = 180 * H * Math.cos(c0.lat * D) / hLat;                                // the whole world's width in pixels
  const mx = (lo) => (lo + 180) / 360 * Sw, my = (la) => (1 - Math.log(Math.tan(Math.PI / 4 + la * D / 2)) / Math.PI) / 2 * Sw;
  const ox = mx(c0.lon) - W / 2, oy = my(c0.lat) - H / 2;
  const px = (la, lo) => [mx(lo) - ox, my(la) - oy];
  const ll = (x, y) => ({ lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + oy) / Sw))) / D, lon: (x + ox) / Sw * 360 - 180 });
  const n = ll(0, 0).lat, s = ll(0, H).lat, w = ll(0, 0).lon, e = ll(W, 0).lon;
  // Sky brightness interpolated between map cells at every (half-)pixel, then coloured by Bortle class: smooth edges.
  const pw = Math.ceil(W / 2), ph = Math.ceil(H / 2), off = document.createElement('canvas'); off.width = pw; off.height = ph;
  const oc = off.getContext('2d'), img = oc.createImageData(pw, ph);
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const pal = BORTLE_COL.map((h) => h ? rgb(h) : null);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const q = ll((x + 0.5) * W / pw, (y + 0.5) * H / ph), lat = q.lat, lon = q.lon, k = (y * pw + x) * 4;
    const fy = (g.north - lat) / g.dLat - 0.5, fx = (lon - g.west) / g.dLon - 0.5, r = Math.floor(fy), c = Math.floor(fx), ty = fy - r, tx = fx - c;
    let sum = 0, wt = 0;
    for (const [dr, dc, kk] of [[0, 0, (1 - ty) * (1 - tx)], [0, 1, (1 - ty) * tx], [1, 0, ty * (1 - tx)], [1, 1, ty * tx]]) { const q = cellSqm(g, r + dr, c + dc); if (q != null) { sum += q * kk; wt += kk; } }
    if (wt < 0.3) { img.data[k] = 20; img.data[k + 1] = 24; img.data[k + 2] = 40; img.data[k + 3] = 255; continue; }
    const [R, G, B] = pal[bortleOf(sum / wt)]; img.data[k] = R; img.data[k + 1] = G; img.data[k + 2] = B; img.data[k + 3] = 255;
  }
  oc.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, W, H);
  // Streets (OpenStreetMap, only with internet): under a dimming veil so they don't spoil night vision, with the
  // light-pollution colours see-through on top. Tiles still loading leave the plain colours showing.
  let streets = false;
  if (opt.streets) {
    const zt = Math.max(0, Math.min(18, Math.round(Math.log2(Sw / 256)))), ts = Sw / 2 ** zt;
    for (let ty = Math.floor(oy / ts); ty <= Math.floor((oy + H) / ts); ty++) for (let tx = Math.floor(ox / ts); tx <= Math.floor((ox + W) / ts); tx++) {
      const im = osmTile(zt, tx, ty, opt.onTile); if (im) { ctx.drawImage(im, tx * ts - ox, ty * ts - oy, ts, ts); streets = true; }
    }
    if (streets) { ctx.fillStyle = 'rgba(4,7,22,0.2)'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 0.32; ctx.drawImage(off, 0, 0, W, H); ctx.globalAlpha = 1; }
  }
  // Town names (dot + label), skipping any that would overlap one already drawn or the "You" marker.
  ctx.font = '600 11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  const [X, Y] = px(state.site.lat, state.site.lon), youIn = siteKnown() && X > -20 && Y > -20 && X < W + 20 && Y < H + 20;
  const taken = [[0, H - 36, 120, 36], [W - 48, 0, 48, 26], [W - 120, H - 16, 120, 16]];             // scale bar and north stay clear
  if (youIn) taken.push([X - 18, Y - 22, 60, 40]);
  const [PX, PY] = opt.pin ? px(opt.pin.lat, opt.pin.lon) : [-99, -99]; if (opt.pin) taken.push([PX - 14, PY - 30, 28, 34]);
  const fits = (box) => !taken.some((b) => box[0] < b[0] + b[2] && b[0] < box[0] + box[2] && box[1] < b[1] + b[3] && b[1] < box[1] + box[3]);
  const place = (name, la, lo, dark) => {
    const [tx, ty] = px(la, lo); if (tx < 4 || ty < 4 || tx > W - 4 || ty > H - 4) return false;
    const tw = ctx.measureText(name).width, right = tx + 8 + tw < W - 4, bx = right ? tx - 4 : tx - 11 - tw, box = [bx, ty - 8, tw + 15, 16];
    if (!fits(box)) return false;
    taken.push(box);
    if (dark) {                                       // dark-sky site: a small gold four-point star
      ctx.fillStyle = '#ffd680'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let k = 0; k < 8; k++) { const r = k % 2 ? 2.2 : 6.5, a = k * Math.PI / 4 - Math.PI / 2; ctx.lineTo(tx + r * Math.cos(a), ty + r * Math.sin(a)); }
      ctx.closePath(); ctx.stroke(); ctx.fill();
    } else { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(tx, ty, 3, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(tx, ty, 1.8, 0, 7); ctx.fill(); }
    ctx.textAlign = right ? 'left' : 'right'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; const lx = right ? tx + 8 : tx - 8;
    ctx.strokeText(name, lx, ty); ctx.fillStyle = dark ? '#ffd680' : '#fff'; ctx.fillText(name, lx, ty);
    return true;
  };
  for (const [name, la, lo] of DARK_SITES) place(name, la, lo, true);
  const T = townsLoaded(), maxLabels = Math.round(W * H / 3500);
  if (T) { let k = 0; for (let i = 0; i < T.n && k < maxLabels; i++) { const la = T.lat[i], lo = T.lon[i]; if (la > n || la < s || lo < w || lo > e) continue; if (place(T.name[i], la, lo, false)) k++; } }
  else for (const [name, la, lo] of LP_TOWNS) place(name, la, lo, false);
  const label = (t, x, y, a = 'left') => { ctx.textAlign = a; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(t, x, y); ctx.fillStyle = '#fff'; ctx.fillText(t, x, y); };
  // You are here.
  if (youIn) {
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(X, Y, 9, 0, 7); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(X, Y, 9, 0, 7); ctx.moveTo(X - 15, Y); ctx.lineTo(X - 4, Y); ctx.moveTo(X + 4, Y); ctx.lineTo(X + 15, Y); ctx.moveTo(X, Y - 15); ctx.lineTo(X, Y - 4); ctx.moveTo(X, Y + 4); ctx.lineTo(X, Y + 15); ctx.stroke();
  ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  label('You', X + 13, Y - 12);
  } else { ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'middle'; }
  if (opt.pin) {                                    // the place chosen for a plan: a gold pin
    ctx.fillStyle = '#ffd680'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PX, PY); ctx.bezierCurveTo(PX - 12, PY - 14, PX - 9, PY - 27, PX, PY - 27); ctx.bezierCurveTo(PX + 9, PY - 27, PX + 12, PY - 14, PX, PY); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(PX, PY - 18, 3.5, 0, 7); ctx.fill();
  }
  // Scale bar and north.
  const kmPerPx = 40075 * Math.cos(c0.lat * D) / Sw, nice = [5, 10, 20, 25, 50, 100, 200].find((k) => k / kmPerPx > W * 0.18) || 200, len = nice / kmPerPx;
  ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.moveTo(10, H - 12); ctx.lineTo(10 + len, H - 12); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(10, H - 12); ctx.lineTo(10 + len, H - 12); ctx.stroke();
  label(`${nice} km`, 10, H - 24); label('N ↑', W - 10, 14, 'right');
  if (streets) { ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(W - 112, H - 14, 112, 14); ctx.fillStyle = '#fff'; ctx.fillText('© OpenStreetMap', W - 4, H - 3); }
  return { n, s, w, e, W, H, px, ll, streets };
}
/** At start-up: refresh the location from GPS without a fuss when the phone already allows it, so the light-pollution
 *  estimate (and everything else) is for where you are tonight. First time ever: ask, once, with the usual explanation. */
async function autoLocate() {
  let granted = false;
  try {
    const G = cap('Geolocation');
    if (G && G.checkPermissions) granted = (await G.checkPermissions()).location === 'granted';
    else if (navigator.permissions && navigator.permissions.query) granted = (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted';
  } catch (e) { /* unknown: treat as not granted */ }
  if (granted) return getGPS(true);
  if (!siteKnown() && !locAsked && !state.locNever) askLocation(null);
}
/** Where the app thinks you are, in a few words, for the "Update location" lines. */
function whereText() {
  if (!siteKnown()) return 'Toronto (not set)';
  const name = placeLabel(), gps = /^GPS/.test(state.site.source || '') ? /, (.+)$/.exec(state.site.source) : null;
  const when = gps && !Number.isNaN(Date.parse(gps[1])) ? new Date(gps[1]) : null;
  const age = when ? (Date.now() - when < 864e5 && new Date().toDateString() === when.toDateString() ? `GPS today ${hm(when)}` : `GPS ${shortDate(when)}`) : 'typed in';
  return `${name ? esc(name) + ' · ' : ''}${coordText(state.site.lat, state.site.lon)} · ${age}`;
}
/** An "Update location" button: GPS now, then whatever shows the location redraws itself (see getGPS). */
function wireUpdateLoc(btn) {
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Finding you…';
    const ok = await getGPS();
    if (!btn.isConnected) return;                       // success redraws the screen with the new place
    btn.disabled = false; btn.textContent = 'Update location';
    if (!ok) { const row = btn.closest('.whereline, .hzrow') || btn.parentElement; let m = row.nextElementSibling; if (!m || !m.classList.contains('gpserr')) { m = document.createElement('p'); m.className = 'gpserr small'; row.after(m); } m.textContent = gpsError || 'No location came back from the phone.'; }
  };
}
/** A name for a spot on the map: the town it's in or near, else its coordinates. */
function spotName(lat, lon) {
  const nm = nearestName(lat, lon); if (nm) return nm;
  if (townsLoaded()) return coordText(lat, lon);
  let best = null;
  for (const [nm, la, lo] of LP_TOWNS) { const d = distKm({ lat, lon }, { lat: la, lon: lo }); if (!best || d < best.d) best = { nm, d }; }
  return best && best.d < 6 ? best.nm : best && best.d < 40 ? `near ${best.nm}` : coordText(lat, lon);
}
/** Choose a place on the light-pollution map (drag to move, tap to drop a pin), for planning somewhere you aren't. */
const PP_SPANS = [0.012, 0.04, 0.15, 0.5, 1.25, 3, 6];   // half-height in degrees: ~3 km to ~1300 km tall
function openPlacePicker(start, onPick) {
  let center = { lat: start.lat, lon: start.lon }, pin = start === state.site ? null : { lat: start.lat, lon: start.lon }, zi = 4, view = null, drag = null, raf = 0;
  dlgCard().innerHTML = `<h3 style="margin-top:0">Plan for another place</h3>
    <p class="small muted" style="margin:0 0 6px">Drag the map to move it, then tap where you'll be observing. Colours show light pollution (Bortle class, 1 darkest).</p>
    <canvas id="pp-map" class="lpmap" style="touch-action:none;cursor:crosshair" aria-label="Map: tap to choose a place"></canvas>
    <div class="btnrow"><button id="pp-less" class="mini">Closer</button><button id="pp-more" class="mini">Wider</button><button id="pp-me" class="mini">Where I am</button></div>
    <div class="btnrow"><button id="pp-streets" class="mini">Hide streets</button></div>
    <p id="pp-info" class="small" style="min-height:2.6em">Tap the map to choose a spot.</p>
    <details class="more"><summary>Type coordinates instead</summary>
      <label class="row"><span>Latitude (°N)</span><input id="pp-lat" inputmode="decimal" placeholder="44.94"></label>
      <label class="row"><span>Longitude (°E, west is −)</span><input id="pp-lon" inputmode="decimal" placeholder="-79.50"></label>
      <div class="btnrow"><button id="pp-set" class="mini">Put the pin there</button></div></details>
    <div class="btnrow"><button id="pp-ok" class="primary">Plan here</button><button id="pp-cancel">Cancel</button></div>`;
  dlg().classList.remove('hidden');
  const cv = $('#pp-map');
  const info = () => {
    $('#pp-ok').disabled = !pin; if (!pin) return;
    const m = skyGlowAt(pin.lat, pin.lon);
    $('#pp-info').innerHTML = `${ICON.pin}<b>${esc(spotName(pin.lat, pin.lon))}</b>${spotName(pin.lat, pin.lon) === coordText(pin.lat, pin.lon) ? '' : ` · ${coordText(pin.lat, pin.lon)}`}<br>${m ? `Light pollution about <b>Bortle ${m.bortle}</b> (${BORTLE_NAME[m.bortle].toLowerCase()})` : 'Outside the light-pollution map: the plan will use a typical suburban sky'}`;
  };
  const draw = () => {
    raf = 0; const g = skyGlowGrid();
    if (!g) { loadSkyGlow().then((x) => { if (x && cv.isConnected) draw(); }); return; }
    view = drawLightMap(cv, g, { center, pin, hLat: PP_SPANS[zi], aspect: 0.95, streets: streetsOn(), onTile: () => { if (cv.isConnected) redraw(); } });
    const sb = $('#pp-streets'); if (sb) { sb.classList.toggle('hidden', navigator.onLine === false); sb.textContent = state.streets === false ? 'Show streets' : 'Hide streets'; }
    if (!townsLoaded()) loadTowns().then((T) => { if (T && cv.isConnected) { info(); redraw(); } });
    $('#pp-less').disabled = zi === 0; $('#pp-more').disabled = zi === PP_SPANS.length - 1;
  };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const toLatLon = (ev) => { const r = cv.getBoundingClientRect(); return view.ll(ev.clientX - r.left, ev.clientY - r.top); };
  cv.addEventListener('pointerdown', (ev) => { cv.setPointerCapture(ev.pointerId); drag = { x: ev.clientX, y: ev.clientY, v: view, moved: false }; });
  cv.addEventListener('pointermove', (ev) => {
    if (!drag || !view) return; const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return; drag.moved = true;
    const c = drag.v.ll(drag.v.W / 2 - dx, drag.v.H / 2 - dy); center = { lat: Math.max(-80, Math.min(80, c.lat)), lon: c.lon }; redraw();
  });
  cv.addEventListener('pointerup', (ev) => { if (drag && !drag.moved && view) { const p = toLatLon(ev); pin = { lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4) }; info(); redraw(); } drag = null; });
  $('#pp-less').onclick = () => { zi = Math.max(0, zi - 1); if (pin) center = { ...pin }; redraw(); };
  $('#pp-more').onclick = () => { zi = Math.min(PP_SPANS.length - 1, zi + 1); redraw(); };
  $('#pp-me').onclick = () => { center = { lat: state.site.lat, lon: state.site.lon }; redraw(); };
  $('#pp-set').onclick = () => { const la = parseFloat($('#pp-lat').value), lo = parseFloat($('#pp-lon').value); if (!(Math.abs(la) <= 90) || !(Math.abs(lo) <= 180)) return toast('Latitude is between −90 and 90, longitude between −180 and 180.', 4000); pin = { lat: la, lon: lo }; center = { ...pin }; info(); redraw(); };
  $('#pp-streets').onclick = () => { state.streets = state.streets === false; save(); redraw(); };
  $('#pp-cancel').onclick = closeDlg;
  $('#pp-ok').onclick = () => { if (!pin) return; closeDlg(); onPick({ lat: pin.lat, lon: pin.lon, elev: 0, name: spotName(pin.lat, pin.lon) }); };
  info(); draw();
}
/** GPS fix → state.site. Resolves true when the location was set, false (with a message unless quiet) when not. */
let gpsError = '';
async function getGPS(quiet = false) {
  gpsError = '';
  if (!quiet) toast('Getting GPS fix…', 8000);
  const say = (m) => { gpsError = m; if (!quiet) toast(m, 7000); return false; };
  const OFF = 'Location is off for this app. On the iPhone: Settings → Privacy & Security → Location Services → Skyward Push-To → While Using the App.';
  const done = (lat, lon, elev, acc) => {
    state.site = { lat: +lat.toFixed(5), lon: +lon.toFixed(5), elev: Math.round(elev || state.site.elev || 0), source: `GPS ±${Math.round(acc)} m, ${new Date().toLocaleString()}` };
    sky.setSite(state.site.lat, state.site.lon, state.site.elev); planRows = null; rateCache.clear(); siteMoved(); save(); if (!quiet) toast('Location set'); if (tab === 'setup') renderSetup(); if (tab === 'find') renderFind(); if (tab === 'plan') renderPlan(); if (!$('#gate').classList.contains('hidden')) renderLaunch(); if (!$('#skycheck').classList.contains('hidden') && $('#sq-lp')) openSkyCheck();
    return true;
  };
  const G = cap('Geolocation');
  if (G) {                                          // the iPhone app: Capacitor's location plug-in
    try {
      const perm = await G.requestPermissions?.();
      if (perm && perm.location === 'denied') return say(OFF);
      const p = await G.getCurrentPosition({ enableHighAccuracy: true, timeout: 30000, maximumAge: quiet ? 600000 : 0 });
      return done(p.coords.latitude, p.coords.longitude, p.coords.altitude, p.coords.accuracy);
    } catch (e) {
      const m = String((e && e.message) || e);
      return say(/denied|not authori[sz]ed|permission/i.test(m) ? OFF : /time ?out/i.test(m) ? 'No GPS fix after 30 seconds. Step outside or near a window and try again.' : 'Location failed: ' + m);
    }
  }
  if (!navigator.geolocation) return say('No location service on this device');
  return new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res(done(p.coords.latitude, p.coords.longitude, p.coords.altitude, p.coords.accuracy)),
    (e) => res(say(e.code === 1 ? 'Location is blocked for this site. Allow it in the browser\'s site settings and try again.' : e.code === 3 ? 'No GPS fix after 30 seconds. Step outside or near a window and try again.' : 'Location failed: ' + e.message)),
    { enableHighAccuracy: true, timeout: 30000, maximumAge: quiet ? 600000 : 0 }));   // a button press wants a fresh fix
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
  const short = profile().name.replace(/^Skyward\s+/, ''), sc = $('#st-scope'); if (sc.dataset.name !== short) { sc.dataset.name = short; sc.innerHTML = `<small>Scope:</small><span>${esc(short)}</span>`; sc.setAttribute('aria-label', `Scope: ${short} — telescope settings`); }
  const st = pointState();
  const txt = { off: 'Turn sensors on', nodata: 'No sensor data', compass: 'Compass mode', unaligned: 'Tap to align',
    resync: 'Re-sync on a star', aligned: cap1(syncAgo()) }[st];
  const pill = $('#st-pill'); if (pill.textContent !== txt) pill.textContent = txt; if (pill.dataset.st !== st) pill.dataset.st = st;
  const d = $('#s-diag'); if (d && sensors) d.textContent = `${sensors.constructor === SimSensors ? 'SIMULATED · ' : ''}${sensors.rateHz.toFixed(0)} Hz · compass: ${sensors.compassSource || 'none'}${sensors.compassAccuracy != null ? ' ±' + sensors.compassAccuracy + '°' : ''}${sensors.compassCal ? ' · ' + sensors.compassCal : ''}`;
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
/**
 * Screen off or locked (Build 113): iOS stops the motion sensors, and when they start again the gyro's left/right
 * frame may have turned. The compass doesn't care: it measures that frame against north. So just before the screen
 * goes off the app notes the compass offset (north in gyro terms), and when it comes back it measures it again; the
 * difference is how far the gyro frame turned, and the alignment is turned back by it. Errors in the compass itself
 * (metal on the scope, declination) are the same before and after and cancel; what's left is its noise, a degree or two.
 */
let sleepCompass = null;
const compassNow = () => (sensors && sensors.hasCompass && sensors.compassOffsetSamples && sensors.compassOffsetSamples.length >= 10 && performance.now() - sensors.compassOffsetSamples[sensors.compassOffsetSamples.length - 1][0] < 1500 ? sensors.compassOffset() : null);
function resumeWithCompass(away) {
  const before = sleepCompass; sleepCompass = null;
  const fallback = () => { if (away > 20) { align.suspect = true; toast('Welcome back. The phone may have lost track while the screen was off — centre a bright star and tap Sync before trusting the arrows.', 7000); if (tab === 'push') renderPush(); } };
  if (!before || before.off == null) return fallback();
  const t0 = performance.now();
  if (sensors) sensors.compassOffsetSamples = [];                     // only readings from after the restart
  const wait = () => {
    if (!sensors || !sensors.fresh() || !sensors.compassOffsetSamples || sensors.compassOffsetSamples.length < 20) {
      if (performance.now() - t0 > 8000) return fallback();
      return setTimeout(wait, 250);
    }
    const after = sensors.compassOffset(), jump = wrap180(before.off - after);   // how far the gyro frame turned
    model.theta = model.thetaAt() - jump; model.t0 = Date.now(); align.suspect = false;   // keep any drift so far, then turn back
    align.syncs.push({ t: Date.now(), theta: model.theta, kind: 'compass-resume', jump, ep: align.epoch || 0 });
    const src = sensors.compassSource || 'the compass';
    if (Math.abs(jump) >= 1) toast(`Welcome back. While the screen was off the phone's direction shifted ${Math.abs(jump).toFixed(0)}°; put right with ${src}. Check the next target and Sync if it's off.`, 6000);
    else if (away > 20) toast(`Welcome back. The phone kept its bearings (checked with ${src}).`, 3500);
    if (tab === 'push') renderPush();
  };
  wait();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    sleepCompass = align.fit && state.mode === 'gyro' ? { off: compassNow(), src: sensors && sensors.compassSource } : null;
    return;
  }
  if (sensors) keepAwake();
  const away = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0; hiddenAt = 0;
  if (away > 600 || dayKey() !== shownDay) refreshForTime();
  if (away > 2 && align.fit && state.mode === 'gyro') {
    align.epoch = (align.epoch || 0) + 1;                             // objects from now on get their own offset in the sky table
    resumeWithCompass(away);
  } else sleepCompass = null;
});

// ---------------------------------------------------------------- OBSERVING LOG
let seenCache = null;
const seenSet = () => (seenCache ||= seenKeys(state.log));
const fullCon = (c) => (c ? conName(String(c).toUpperCase()) : '');
const RESULT = { yes: 'Seen', maybe: 'Not sure', no: 'Not seen' };
const shortDate = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
function logObservation(o, seen) {
  const before = logStats(state.log, sky.objects);
  (state.log ||= []).push({ key: o.key, label: o.label, t: Date.now(), seen, scope: profile().name, ep: eyepiece().name, sky: skyQ() ? skyQ().label : '' });
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
/** Eyepieces worth previewing for an object, longest first. One that shows less than half the width of a big object
 *  (the Pleiades in a 4 mm) is left out; the widest is always kept. `skipped` names the ones left out. */
function epsFor(o) {
  const p = profile(), all = p.eyepieces.map((e, i) => ({ e, i, tf: (e.afov || 62) / (p.fl / e.fl) * 60 })).sort((a, b) => b.e.fl - a.e.fl);
  if (!o.maj || o.planet || o.pairs || (o.key || '').startsWith('ds:')) return all;
  const keep = all.filter((x, k) => k === 0 || x.tf >= o.maj * 0.5);
  keep.skipped = all.filter((x) => !keep.includes(x)).map((x) => x.e.name);
  return keep;
}
// ---------------------------------------------------------------- steady air ("seeing")
// How much the air shimmers sets how much power planets and close doubles can take. It changes hour to hour, so a check
// counts only for the night it was made (until noon the next day); otherwise the app assumes an average night.
const SEEING_WORD = { poor: 'poor', average: 'average', good: 'good' };
const nightKey = (t) => new Date(t - 12 * 3600000).toDateString();        // noon to noon
/** Tonight's steady-air check { v, how: 'twinkle' | 'eyepiece' | 'pick', when }, or null. */
function seeingTonight() { const c = state && state.seeingCheck; return c && nightKey(c.when) === nightKey(Date.now()) ? c : null; }
/** Steady air for a time: your own check that night, else Environment Canada's forecast, else average. */
function seeingFor(t = new Date()) {
  const c = state && state.seeingCheck;
  if (c && nightKey(c.when) === nightKey(t.getTime())) return c.v;
  const f = fcFor(here(), t); return (f && f.ol && seeingWord(f.ol.seeing)) || 'average';
}
const seeingNow = () => seeingFor(new Date());
/** Where tonight's steady-air figure comes from: 'check' | 'forecast' | 'assumed'. */
function seeingSource(t = new Date()) {
  const c = state && state.seeingCheck; if (c && nightKey(c.when) === nightKey(t.getTime())) return 'check';
  const f = fcFor(here(), t); return f && f.ol && seeingWord(f.ol.seeing) ? 'forecast' : 'assumed';
}
/** The sky's limit for a plan: your check as measured; the map's estimate adjusted for that night's forecast haze. */
function planNelm(t) { const f = skyQ() ? null : fcFor(here(), t); return skyNelm() + (f && f.ol ? transpAdj(f.ol.transp) : 0); }

// ---------------------------------------------------------------- Environment Canada forecast
// Fetched for a place and night when a screen needs it, kept in memory (and for 90 minutes in localStorage).
const fcStore = new Map();
const fcKey = (site, t) => site ? `${site.lat.toFixed(2)},${site.lon.toFixed(2)}|${nightKey(t.getTime())}` : '';
/** The forecast for a place and the night containing `t`: { rows, ol } once loaded, { loading } while fetching, or null. */
function fcFor(site, t) { return fcStore.get(fcKey(site, t)) || null; }
/** Start fetching (once) and call `done` when it arrives. Only for nights the models cover (about 3 days ahead). */
/** Apple Weather plug-in (iPhone app with the WeatherKit capability), or null. */
function appleWeather() {
  const C = window.Capacitor;
  try { return C && C.isNativePlatform && C.isNativePlatform() && C.isPluginAvailable && C.isPluginAvailable('SkyWeather') ? C.Plugins.SkyWeather : null; } catch (e) { return null; }
}
function ensureForecast(site, t, done) {
  if (!site || site.lat == null) return null;
  const inCanadaModels = site.lat >= 20 && site.lat <= 75 && site.lon <= -40 && site.lon >= -160;   // GeoMet's models cover North America
  const wk = appleWeather();
  if (!inCanadaModels && !wk) return null;
  // Build 119: a record is fetched again when it failed, is a cached copy (no connection at the time) or is over 90
  // minutes old, once the phone is online, at most every 2 minutes. While that runs the old forecast stays on screen.
  const k = fcKey(site, t), old = fcStore.get(k);
  if (old && (old.loading || old.refreshing || !fcStale(old))) return old;
  const n = sky.nightAt(t), from = n.naut || n.set, to = n.nautAm || n.rise;
  if (!from || !to || from.getTime() - Date.now() > 3.3 * 864e5 || to < Date.now()) return old || null;
  const rec = old || { loading: true }; fcStore.set(k, rec);
  rec.args = [site, t, done]; if (old) rec.refreshing = true;
  const rest = from < new Date(), hours = hoursBetween(rest ? new Date() : from, to);
  Promise.all([
    inCanadaModels ? hourlyForecast(site.lat, site.lon, hours) : Promise.resolve(null),
    wk && hours.length ? appleHourly(wk, site.lat, site.lon, hours[0], new Date(+hours[hours.length - 1] + 3600000)) : Promise.resolve(null),
  ]).then(([eccc, apple]) => {
    rec.loading = false; rec.refreshing = false; rec.tried = Date.now();
    const rows = mergeApple(eccc, apple, hours);
    if (!rows) { if (!rec.ol) rec.failed = true; if (done) done(); return; }   // nothing new: keep what was showing
    rec.failed = false; rec.rows = rows; rec.eccc = !!eccc; rec.apple = apple ? apple.attribution || {} : null;
    rec.at = eccc && eccc.at ? eccc.at : Date.now(); rec.cached = !!(eccc && eccc.cached) && !apple;
    rec.ol = outlook(rows, { moonUp: (h) => { const m = sky.moonInfo(h); return { up: m.alt > 0, frac: m.frac }; }, nelm: skyNelm(), fromCheck: !!skyQ(), restOfNight: rest });
    setSeeing(seeingNow()); planRows = null; rateCache.clear();
    if (done) done();
  });
  return rec;
}
const isOnline = () => navigator.onLine !== false;
/** Worth fetching again: failed, a cached copy, or over 90 minutes old; only when online, at most every 2 minutes. */
function fcStale(r) {
  if (!isOnline() || Date.now() - (r.tried || 0) < 120000) return false;
  return !!(r.failed || r.cached || (r.at && Date.now() - r.at > 90 * 60000));
}
/** When the connection comes back, refresh every forecast that failed or is a cached copy (and redraw its screen). */
window.addEventListener('online', () => { for (const r of fcStore.values()) if (r.args && (r.failed || r.cached)) { r.tried = 0; ensureForecast(...r.args); } });
/** "Cached forecast from 9:15" when the forecast is a saved copy shown without a data connection, else ''. */
const fcCachedNote = (rec) => rec && rec.cached && rec.at ? `Cached forecast from ${hm(new Date(rec.at))} (no data connection)` : '';
/** "Start at the clear spell" when the forecast has cloud first and the plan starts in it. */
function clearSpellBtn(rec, start) {
  const o = rec && rec.ol; if (!o || !o.from || o.kind === 'cloudy' || !(o.from > rec.rows[0].t)) return '';
  if (!(start < new Date(o.from.getTime() - 30 * 60000) || start > o.to)) return '';
  return `<button id="fc-start" class="mini" style="margin:4px 0">Start at the clear spell (${hm(o.from)})</button>`;
}
/** Little sky pictures for the forecast strip, drawn in the app's colours (emoji would turn colourful on an iPhone). */
const spark = (x, y, r) => `M${x} ${y - r}L${x + r * 0.28} ${y - r * 0.28}L${x + r} ${y}L${x + r * 0.28} ${y + r * 0.28}L${x} ${y + r}L${x - r * 0.28} ${y + r * 0.28}L${x - r} ${y}L${x - r * 0.28} ${y - r * 0.28}Z`;
const CLOUD = 'M7 19h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 19z';
const SKYPIC = [
  `<svg viewBox="0 0 24 24" class="skp"><path fill="currentColor" d="${spark(12, 11, 7)}${spark(5, 5, 3)}${spark(19, 18, 3.2)}"/></svg>`,                              // good: sparkling stars
  `<svg viewBox="0 0 24 24" class="skp"><path fill="currentColor" d="${spark(9, 10, 5)}${spark(17, 16, 3)}"/></svg>`,                                                  // OK: a couple of stars
  `<svg viewBox="0 0 24 24" class="skp"><path fill="currentColor" d="${spark(17, 6, 3.6)}"/><path d="${CLOUD}" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,   // poor: a star peeking past a cloud
  `<svg viewBox="0 0 24 24" class="skp"><path d="${CLOUD}" fill="currentColor"/></svg>`,                                                                               // clouded out
];
/** Emoji-style faces for each hour, filled in the level's colour with dark features (drawn, so Night stays red):
 *  star-eyed grin, smile, flat mouth, frown behind a cloud. */
const FACEPIC = [0, 1, 2, 3].map((l) => {
  const ink = 'var(--bg)', eyes = l === 0 ? `<path fill="${ink}" d="${spark(8.4, 9.6, 3)}${spark(15.6, 9.6, 3)}"/>` : `<circle cx="8.8" cy="9.8" r="1.5" fill="${ink}"/><circle cx="15.2" cy="9.8" r="1.5" fill="${ink}"/>`;
  const mouth = [`<path d="M6.8 13.3h10.4a5.2 5.2 0 0 1-10.4 0z" fill="${ink}"/>`, `<path d="M8 14.3a4.6 4.6 0 0 0 8 0" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`,
    `<path d="M8.4 15.6h7.2" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`, `<path d="M8.3 16.6a4.4 4.4 0 0 1 7.4 0" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`][l];
  const cloud = l === 3 ? `<path d="${'M7 19h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 19z'}" transform="translate(5 6) scale(.75)" fill="currentColor" stroke="${ink}" stroke-width="1.4"/>` : '';
  return `<svg viewBox="0 0 24 24" class="skp"><circle cx="12" cy="12" r="10.5" fill="currentColor"/>${eyes}${mouth}${cloud}</svg>`;
});
// A bright Moon: a crescent with a soft glow and a few short rays off its lit side, so it reads as shining and not
// as a Sun (Build 114).
const MOONPIC = '<svg viewBox="0 0 24 24" class="skm"><circle cx="11.5" cy="12.5" r="9.2" fill="currentColor" opacity=".16"/><g stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".8"><path d="M10.8 20.8L10.6 23.3"/><path d="M6.2 18.9L4.6 20.8"/><path d="M3.5 14.6L1.1 15.3"/><path d="M3.7 9.7L1.4 8.8"/><path d="M6.7 5.7L5.3 3.7"/></g><path fill="currentColor" transform="translate(2.3 2.5) scale(.8)" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
/** Tonight in one face: star-eyed (clear, dark, no bright Moon), smiling, so-so, or behind a cloud. */
/**
 * How good one hour is for looking (Build 113). Clear sky is only the start: a great hour also has no bright Moon up,
 * is past twilight, and has clear and steady air. Light pollution is left out on purpose (Build 114), or nobody in a
 * town would ever see the top face; it shows instead as the brightness of the tile behind the face (`hourSkyLight`). Each thing missing takes it down a step, so a clear
 * hour with one drawback is "good" and with two or more "so-so". Before, the hours only counted cloud and haze, so a
 * clear night under a full Moon in a Bortle 8 sky with unsteady air still got the star-eyed face.
 */
function hourLevel(r) {
  if (r.cloud == null) return { lvl: 2, why: ['no cloud forecast'] };
  if (r.cloud >= 80) return { lvl: 3, why: ['cloud'] };
  if (r.cloud >= 50) return { lvl: 2, why: ['mostly cloudy'] };
  const why = [];
  if (r.cloud >= 20) why.push('some cloud');
  const m = sky.moonInfo(r.t); if (m.alt > 0 && m.frac > 0.4) why.push('bright Moon up');
  if (sky.sunAlt(r.t) > -15) why.push('twilight');
  if (r.transp && r.transp <= 2) why.push('hazy');
  if (r.seeing && r.seeing <= 2) why.push('unsteady air (poor seeing)');
  return { lvl: Math.min(2, why.length), why };
}
/**
 * The sky's two kinds of light that hour, each 0 (pristine, about 22 mag/arcsec²) to 1 (16 or brighter): natural light
 * from the Moon and twilight (Krisciunas & Schaefer moonlight overhead), and light pollution (the map or your check).
 * The tile shows the first in its top half (black → dark blue → light blue → white-blue) and the second in its bottom
 * half (black → brown → pale yellow), blended top to bottom (Build 114).
 */
function hourSkyLight(t) {
  const m = sky.moonInfo(t), dark = cdFromSB(22);
  const nat = moonlight({ moonAlt: m.alt, moonFrac: m.frac, sepDeg: 90 - m.alt, targetAlt: 90 }) + twilight(sky.sunAlt(t));
  const lp = Math.max(0, cdFromSB(skyFromNelm(skyNelm())) - dark);
  const lvl = (B) => Math.max(0, Math.min(1, (22 - sbFromCd(dark + B)) / 6));
  return { moon: lvl(nat), lp: lvl(lp), sb: sbFromCd(dark + nat + lp) };
}
const ramp = (stops, x) => { for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (x - a) / (b - a); return ca.map((v, k) => Math.round(v + (cb[k] - v) * f)); } return stops[stops.length - 1][1]; };
const MOON_RAMP = [[0, [6, 8, 16]], [0.35, [20, 44, 110]], [0.7, [88, 140, 214]], [1, [214, 230, 255]]];
const LP_RAMP = [[0, [6, 8, 16]], [0.5, [104, 70, 30]], [1, [244, 226, 156]]];
function tileBG(sl) {
  const night = theme.shade > 0.5, c = (rgb) => (night ? `rgb(${Math.round(0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2])},0,0)` : `rgb(${rgb.join(',')})`);   // red-only at Night
  return `linear-gradient(to bottom, ${c(ramp(MOON_RAMP, sl.moon))}, ${c(ramp(LP_RAMP, sl.lp))})`;
}
function verdictFace(o, rows) {
  const win = rows && o.kind !== 'cloudy' ? rows.filter((r) => o.from && r.t >= o.from && r.t < o.to && r.cloud != null) : [];
  const med = win.length ? win.map((r) => hourLevel(r).lvl).sort((a, b) => a - b)[Math.floor((win.length - 1) / 2)] : null;
  const lvl = o.kind === 'cloudy' ? 3 : med != null ? Math.max(med, o.kind === 'partly' ? 1 : 0)
    : o.kind === 'clear' && !o.brightMoon && (o.transp == null || o.transp >= 3) ? 0 : o.kind === 'clear' ? 1 : 2;
  const eyes = lvl === 0 ? `<path fill="currentColor" d="${spark(8.6, 9.6, 2.6)}${spark(15.4, 9.6, 2.6)}"/>` : '<circle cx="8.8" cy="9.8" r="1.3" fill="currentColor"/><circle cx="15.2" cy="9.8" r="1.3" fill="currentColor"/>';
  const mouth = ['<path d="M7 13.5h10a5 5 0 0 1-10 0z" fill="currentColor"/>', '<path d="M8 14.5a4.5 4.5 0 0 0 8 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    '<path d="M8.5 15.5h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>', ''][lvl];
  const face = `<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.7"/>${eyes}${mouth}`;
  const cloud = lvl === 3 ? `<path d="${CLOUD}" transform="translate(3 4) scale(.85)" fill="currentColor" stroke="var(--bg)" stroke-width="1.2"/>` : '';
  return { svg: `<svg viewBox="0 0 24 24" class="face q${lvl}" aria-hidden="true">${face}${cloud}</svg>`, word: ['A great night', 'A good night', 'So-so', 'Clouded out'][lvl] };
}
const glanceRows = new Map(); let glanceSeq = 0;
const SEE5 = ['cloudy', 'very bad', 'poor', 'average', 'good', 'excellent'];
/**
 * One hour of the forecast, in full (Build 114): everything that hour that matters at the eyepiece, and what it suits.
 * Opened by tapping an hour in the strip.
 */
function openHourDetail(rec, ix) {
  const r = rec.rows[ix]; if (!r) return;
  const t = r.t, hl = hourLevel(r), sl = hourSkyLight(t), f = FACEPIC[hl.lvl], W = ['Great', 'Good', 'So-so', 'Clouded out'][hl.lvl];
  const m = sky.moonInfo(t), sun = sky.sunAlt(t), nelm = nelmFromSky(sl.sb);
  const lpSb = skyFromNelm(skyNelm()), mp = skyQ() ? null : mapSky(), bort = skyQ() ? bortleOfNelm(checkNelm()) : mp && mp.bortle;
  const lpText = `${bort ? `Bortle ${bort}, ` : ''}${lpSb.toFixed(1)} mag/arcsec² with no Moon (${skyQ() ? 'your darkness check' : 'light-pollution map'})${lpSb < 19 ? ': faint galaxies and nebulae hard from here; a darker site makes the biggest difference' : lpSb < 20.5 ? ': brighter galaxies and nebulae show, faint ones struggle' : ': a dark sky'}`;
  const natAdd = sl.sb < lpSb - 0.05 ? (lpSb - sl.sb).toFixed(1) : null;
  const tw = sun <= -18 ? 'Fully dark' : sun <= -12 ? `Astronomical twilight (Sun ${(-sun).toFixed(0)}° down): faint galaxies still washed out` : sun <= -6 ? `Nautical twilight (Sun ${(-sun).toFixed(0)}° down): bright stars and planets only` : sun <= 0 ? 'Civil twilight: the Moon and planets' : 'Daytime';
  const moonTxt = m.alt > 0 ? `${Math.round(m.frac * 100)}% lit, ${m.alt.toFixed(0)}° up ${compassName(m.az)}${m.frac > 0.4 ? ': lights the whole sky' : ''}` : `Below the horizon (${Math.round(m.frac * 100)}% lit)`;
  const see = r.seeing ? `${SEE5[r.seeing]} (${r.seeing} of 5)${r.seeing <= 2 ? ': planets and close doubles blur at high power' : r.seeing >= 4 ? ': good for high power on planets and close doubles' : ''}` : '–';
  const tr = r.transp ? `${SEE5[r.transp] === 'average' ? 'medium' : SEE5[r.transp]} (${r.transp} of 5)${r.transp <= 2 ? ': hazy, faint things fade first' : r.transp >= 4 ? ': crisp, good for faint galaxies' : ''}` : '–';
  const planets = sky.objects.filter((o) => o.planet && o.id !== 'Moon').map((o) => ({ o, p: sky.altAz(o, t) })).filter((x) => x.p.alt > 10).sort((a, b) => b.p.alt - a.p.alt);
  const suits = [];
  if (hl.lvl < 3) {
    if (m.alt > 0) suits.push('the Moon itself');
    const brightP = planets.filter((x) => (x.o.mag ?? 9) <= 3); if (brightP.length) suits.push(brightP.map((x) => x.o.label).join(', '));
    if (r.seeing >= 4) suits.push('close doubles at high power');
    suits.push(sl.sb < 19.5 ? 'bright clusters and colourful doubles' : 'clusters and doubles');
    if (sl.sb >= 20 && sun <= -18 && (!r.transp || r.transp >= 3)) suits.push('galaxies and nebulae');
  }
  const ap = r.ap, cf = comfort(r), row = (a, b) => `<span>${a}</span><span>${b}</span>`;
  // Its own layout (Build 114): a scrolling middle and a fixed row of buttons below it, outside the scrolling part,
  // because on the phone a sticky row inside a scrolling box lost taps to the scroll.
  dlgCard().classList.add('hdcard');
  // Buttons at the top (Build 118): ‹ and › step through the hours, ✕ closes. They sat at the bottom before and took
  // several taps on the iPhone; up here they are away from the scrolling part and the edge of the screen. Swiping the
  // card left or right also steps, and tapping outside it closes it.
  const last = rec.rows.length - 1;
  dlgCard().innerHTML = `<div class="hdtop"><button type="button" class="ibtn" id="hd-prev" aria-label="Earlier hour" ${ix ? '' : 'disabled'}>‹</button>
      <div class="hdtitle"><span class="hdface q${hl.lvl}">${f}</span><div><b>${t.toLocaleDateString([], { weekday: 'short' })} ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b><div class="small">${W} · ${ix + 1} of ${last + 1}</div></div></div>
      <button type="button" class="ibtn" id="hd-next" aria-label="Later hour" ${ix < last ? '' : 'disabled'}>›</button><button type="button" class="ibtn" id="hd-x" aria-label="Close">✕</button></div>
    <div class="hdbody">
    ${hl.why.length ? `<p class="small" style="margin:0 0 6px">Held back by: ${esc(hl.why.join(', '))}.</p>` : '<p class="small" style="margin:0 0 6px">Nothing holding it back.</p>'}
    <div class="kv hdkv">
      ${row('Cloud', r.cloud == null ? 'no forecast' : `${Math.round(r.cloud)}%${r.cloudSrc === 'apple' ? ' (Apple Weather)' : ''}`)}
      ${ap && ap.high != null ? row('High cloud', `${Math.round(ap.high)}%${ap.high >= 40 ? ': thin haze, dims faint things' : ''}`) : ''}
      ${row('Steadiness (seeing)', see)}
      ${row('Clear air', tr)}
      ${row('Darkness', tw)}
      ${row('Moon', moonTxt)}
      ${row('Light pollution', lpText)}
      ${row('Sky overhead', `${sl.sb.toFixed(1)} mag/arcsec²: by eye you'd see stars brighter than about magnitude ${nelm.toFixed(1)}${natAdd ? ` (town lights ${lpSb.toFixed(1)}, the Moon and twilight brighten it by ${natAdd})` : ' (town lights only)'}`)}
      ${cf.temp != null ? row('Temperature', `${Math.round(cf.temp)}°C${cf.feels != null && Math.round(cf.feels) < Math.round(cf.temp) ? `, feels like ${Math.round(cf.feels)}°C in the wind` : ''}${coldWord(cf.feels) ? ': ' + coldWord(cf.feels) : ''}. <b>Dress for about ${Math.round((cf.feels ?? cf.temp) - 10)}°C</b>: you hardly move at a telescope`) : ''}
      ${cf.gap != null ? row('Dew', `${cf.gap.toFixed(0)}° above the dew point${cf.gap <= 2.5 ? `: ${cf.temp <= 0.5 ? 'frost' : 'dew'} likely on the eyepieces, finder and small mirror. Away more than about 20 minutes? Cover the scope and eyepieces. On a wet night a dew shield helps` : cf.gap <= 5 ? ': dew possible later as the scope cools' : ': dry'}`) : ''}
      ${cf.wind != null ? row('Wind', `${Math.round(cf.wind)} km/h${cf.gust ? `, gusts ${Math.round(cf.gust)}` : ''}${Math.max(cf.gust || 0, cf.wind) >= 25 ? ': shaky at high power' : ''}`) : ''}
      ${row('Planets up', planets.length ? planets.map((x) => `${esc(x.o.label)} ${x.p.alt.toFixed(0)}° ${compassName(x.p.az)}`).join(', ') : 'none above 10°')}
    </div>
    ${suits.length ? `<p class="small"><b>Good night for:</b> ${esc(suits.join('; '))}.</p>` : ''}
    ${fcCachedNote(rec) ? `<p class="muted small"><b>${fcCachedNote(rec)}.</b></p>` : ''}
    <p class="muted small">${rec.eccc ? `Cloud, steadiness (seeing), clear air (transparency), temperature, dew point and wind: Environment Canada${rec.apple ? '; gusts and high cloud: Apple Weather' : ''}. Feels-like: Environment Canada's wind-chill formula.` : 'Cloud, dew and wind: Apple Weather (no steadiness (seeing) or clear-air forecast outside Environment Canada\'s area).'} Moon, twilight and town lights: worked out by the app for this spot.</p>
    <p class="muted small hdswipe">Swipe sideways for the next hour.</p></div>`;
  const body = dlgCard().querySelector('.hdbody'); if (body) body.scrollTop = 0;
  fastTap($('#hd-prev'), () => openHourDetail(rec, ix - 1));
  fastTap($('#hd-next'), () => openHourDetail(rec, ix + 1));
  fastTap($('#hd-x'), closeDlg);
  document.documentElement.classList.add('dlg-open');
  const box = dlg(), card = dlgCard();
  box.onclick = (e) => { if (e.target === box) closeDlg(); };                 // tap outside the card
  card.onpointerdown = (e) => { card._sw = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY }; };
  card.onpointerup = (e) => {                                                     // swipe sideways: next / previous hour
    const p = card._sw; card._sw = null; if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) { const j = ix + (dx < 0 ? 1 : -1); if (j >= 0 && j <= last) { fastFired = performance.now(); openHourDetail(rec, j); } }
  };
  dlg().classList.remove('hidden');
}
document.addEventListener('click', (e) => {
  const c = e.target.closest && e.target.closest('.cbar > i[data-hi]'); if (!c) return;
  const rec = glanceRows.get(c.dataset.g); if (rec) { e.preventDefault(); e.stopPropagation(); openHourDetail(rec, +c.dataset.hi); }
}, true);
document.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const c = e.target.closest && e.target.closest('.cbar > i[data-hi]'); if (c) { e.preventDefault(); c.click(); } });
/** Tonight at a glance: a few chips instead of paragraphs (forecast · dark · Moon · sky · steady air). */
function glanceHTML(rec, n, t = new Date()) {
  const chips = [], o = rec && rec.ol;
  if (rec && rec.loading) chips.push('<span>Forecast…</span>');
  else if (rec && rec.failed && !isOnline()) chips.push('<span>No data connection</span>');
  else if (o) { const f = verdictFace(o, rec.rows); chips.push(`<span class="${o.kind === 'cloudy' ? '' : 'go'}" title="${f.word}">${f.svg}${o.kind === 'cloudy' ? 'Cloudy' : o.kind === 'clear' ? 'Clear' : `Clear ${hm(o.from)}–${hm(o.to)}`}</span>`); if (rec.cached) chips.push(`<span title="${fcCachedNote(rec)}">Cached ${hm(new Date(rec.at))}</span>`); }
  const dark = n.astro || n.naut, now = new Date();
  chips.push(`<span>${dark && now >= dark && now < (n.astroAm || n.rise || now) && nightKey(t.getTime()) === nightKey(now.getTime()) ? 'Dark now' : 'Dark ' + hm(dark)}</span>`);
  const m = sky.moonInfo(dark || t); chips.push(`<span>${ICON.moon}${Math.round(m.frac * 100)}%</span>`);
  const bort = skyQ() ? bortleOfNelm(checkNelm()) : (mapSky() || {}).bortle; if (bort) chips.push(`<span>Bortle ${bort}</span>`);
  chips.push(`<span title="Seeing: how steady the air is. Steady air gives sharp planets and close doubles at high power.">Seeing: ${({ poor: 'unsteady', average: 'fair', good: 'steady' })[seeingFor(t)]}</span>`);   // the astronomers' word, with plain values
  if (o && o.extra && o.extra.cold && o.extra.cold.feels <= 5) chips.push(`<span class="${o.extra.cold.feels <= -10 ? 'warn' : ''}" title="Coldest ${Math.round(o.extra.cold.temp)}°C, feels like ${Math.round(o.extra.cold.feels)}°C. Standing still at a telescope, dress for about 10° colder.">Feels ${Math.round(o.extra.cold.feels)}° · dress for ${o.extra.cold.dressFor}°</span>`);
  if (o && o.extra && o.extra.dew) chips.push(`<span title="The air reaches its dew point: the finder, eyepieces and small mirror fog first.">${o.extra.dew.frost ? 'Frost' : 'Dew'} from ${hm(o.extra.dew.from)}</span>`);
  if (rec && rec.rows && rec.rows.length > 2) {                 // the night hour by hour
    const hh = (d) => d.toLocaleTimeString([], { hour: 'numeric' }).replace(/\s?([AP])M/i, (x, a) => a.toLowerCase());
    const q = (r) => hourLevel(r).lvl, QN = ['great', 'good', 'so-so', 'clouded out'];
    const gid = 'g' + (++glanceSeq); glanceRows.set(gid, rec); if (glanceRows.size > 8) glanceRows.delete(glanceRows.keys().next().value);
    const cells = rec.rows.map((r, ix) => {
      const dk = sky.sunAlt(r.t) <= -18, mi = sky.moonInfo(r.t), moon = mi.alt > 0 && mi.frac > 0.4;
      const h = r.t.getHours(), ap = h < 12 ? 'a' : 'p', edge = ix === 0 || ix === rec.rows.length - 1;
      const lab = h === 0 ? '12a' : h === 12 ? '12p' : `${h % 12}${edge ? ap : ''}`;          // am/pm on the ends and at midnight
      const hl = hourLevel(r);
      const sl = hourSkyLight(r.t);
      return `<i role="button" tabindex="0" data-g="${gid}" data-hi="${ix}" class="q${hl.lvl}${dk ? ' dk' : ''}" style="background:${tileBG(sl)}" title="${hh(r.t)}: ${QN[hl.lvl]}${hl.why.length ? ' (' + hl.why.join(', ') + ')' : ''} · sky about ${sl.sb.toFixed(1)} mag/arcsec² (top: Moon and twilight; bottom: light pollution)">${moon ? MOONPIC : '<em class="skg"></em>'}${FACEPIC[q(r)]}<b>${lab}</b></i>`;
    }).join('');
    chips.push(`<div class="cbar" aria-label="Sky by hour (tap an hour for details): ${rec.rows.map((r) => QN[q(r)]).join(', ')}">${cells}<details class="tkeyd"${state.ui && state.ui.tileKey ? ' open' : ''}><summary><span>Tap an hour for details</span><span class="tkeyb">What the tiles mean</span></summary><div class="cbl"><span class="qkey"><b class="kq0">${FACEPIC[0]} great</b> · <b class="kq1">${FACEPIC[1]} good</b> · <b class="kq2">${FACEPIC[2]} so-so</b> · <b class="kq3">${FACEPIC[3]} cloud</b> · <b>${MOONPIC} bright Moon</b></span><span class="qkey tkey"><b>Tile top: <i class="swm"></i> moonlight</b> · <b>bottom: <i class="swl"></i> light pollution</b></span></div></details></div>`);
  }
  return `<div class="glance">${chips.join('')}${o && o.best && o.best.length ? `<div class="muted small" style="flex-basis:100%">${skyWhose(t)} sky conditions are best for ${esc(o.best[0])}.</div>` : ''}</div>`;
}
/** "Tonight's", or "Friday night's" for another night (the evening's weekday, also after midnight). (Build 119) */
const skyWhose = (t) => nightKey(t.getTime()) === nightKey(Date.now()) ? "Tonight's" : `${new Date(t.getTime() - 12 * 3600000).toLocaleDateString([], { weekday: 'long' })} night's`;
/** The outlook card: verdict, what it suits, hour-by-hour strip, a hint and the credit Environment Canada asks for. */
function outlookHTML(rec, { planStart = null, hint = true } = {}) {
  if (!rec) return '';
  if (rec.loading) return `<div class="fc muted small">Checking tonight's forecast…</div>`;
  if (rec.failed || !rec.ol) return `<div class="fc muted small">${isOnline() ? 'No forecast right now: the forecast service didn\'t answer. The app tries again in a couple of minutes.' : 'No forecast: no data connection, and no forecast saved in the last 12 hours.'}</div>`;
  const o = rec.ol, ic = o.kind === 'clear' ? ICON.star : o.kind === 'partly' ? ICON.half : ICON.cloud;
  const hasHigh = !!(rec.apple && rec.rows.some((r) => r.ap && r.ap.high != null)), hasComfort = rec.rows.some((r) => comfort(r).temp != null);
  const cells = rec.rows.map((r) => {
    const m = sky.moonInfo(r.t), cl = r.cloud == null ? null : Math.round(r.cloud);
    return `<div class="fch"><span>${r.t.toLocaleTimeString([], { hour: 'numeric' }).replace(/\s?([AP])M/i, (x, a) => a.toLowerCase())}</span>
      <span class="fcc" style="--c:${cl == null ? 0.3 : (cl / 100).toFixed(2)}" title="cloud">${cl == null ? '–' : cl + '%'}</span>
      <span>${r.seeing ? r.seeing : '–'}</span><span>${r.transp ? r.transp : '–'}</span><span>${m.alt > 0 ? (m.frac > 0.4 ? '☾' : '·') : ''}</span>${hasComfort ? (() => { const c = comfort(r), w = c.wind != null ? Math.max(c.gust || 0, c.wind) : null; return `<span class="${c.feels != null && c.feels <= -10 ? 'fcbad' : ''}">${c.feels != null ? Math.round(c.feels) + '°' : '–'}</span><span class="${c.gap != null && c.gap <= 2.5 ? 'fcbad' : ''}">${c.gap != null ? c.gap.toFixed(0) + '°' : '–'}</span><span class="${w != null && w >= 25 ? 'fcbad' : ''}">${w != null ? Math.round(w) : '–'}</span>`; })() : ''}${hasHigh ? `<span>${r.ap && r.ap.high != null ? Math.round(r.ap.high) + '%' : '–'}</span>` : ''}</div>`;
  }).join('');
  const hintText = o.hints[Math.floor(Date.now() / 864e5) % o.hints.length];
  return `<div class="fc">
    <div><b>${ic} ${esc(o.text)}</b></div>
    ${fcCachedNote(rec) ? `<div class="muted small">${fcCachedNote(rec)}</div>` : ''}
    ${o.best.length ? `<div class="small">${skyWhose(rec.rows[0].t)} sky conditions are best for ${esc(o.best.join('; '))}.</div>` : ''}
    ${o.extra && o.extra.warn && o.extra.warn.length ? `<ul class="fcwarn small">${o.extra.warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <details class="more"><summary>Hour by hour</summary>
      <div class="fcgrid"><div class="fch lab"><span></span><span>Cloud</span><span>Seeing</span><span>Clear air</span><span>Moon</span>${hasComfort ? '<span>Feels like</span><span>Dew gap</span><span>Wind</span>' : ''}${hasHigh ? '<span>High cloud</span>' : ''}</div>${cells}</div>
      <p class="muted small">${rec.eccc ? 'Seeing (how steady the air is) and clear air (transparency) are out of 5. Environment Canada calibrated the steadiness (seeing) forecast with 28–35 cm telescopes and says it can be a little pessimistic for smaller ones. Your own twinkle check beats it on the night.' : 'Outside Environment Canada\'s area there is no steadiness (seeing) or clear-air forecast: do the twinkle check on the night.'}${hasComfort ? ' Feels like: °C with wind chill; dress for about 10° colder, since you hardly move at a telescope. Dew gap: how far the air is above its dew point; at 2° or less expect dew (frost below freezing). Wind: km/h (gusts where known).' : ''}</p>
    </details>
    ${hint ? `<p class="muted small iconline" style="margin:4px 0 0">${ICON.bulb}${esc(hintText)}</p>` : ''}
    <p class="muted small fcattr">${rec.eccc ? `${esc(ATTRIB)} · <a href="${LICENCE_URL}" target="_blank" rel="noopener">licence</a>` : ''}${rec.apple ? `${rec.eccc ? '<br>' : ''}<span class="wkmark">${rec.apple.markDark ? `<img src="${esc(rec.apple.markDark)}" alt="Apple Weather" height="12"${theme.shade > 0.5 ? ' style="filter:sepia(1) saturate(8) hue-rotate(-40deg) brightness(.6)"' : ''}>` : ' Weather'}</span> dew, wind${rec.eccc ? ', high cloud' : ' and cloud'} · <a href="${esc(rec.apple.legal || 'https://developer.apple.com/weatherkit/data-source-attribution/')}" target="_blank" rel="noopener">other data sources</a>` : ''}</p>
  </div>`;
}
function recordSeeing(v, how) {
  state.seeingCheck = { v, how, when: Date.now() }; setSeeing(v); planRows = null; rateCache.clear(); save();
  const cap = { poor: 'planets about 100× at most tonight', average: 'planets up to about 150×', good: 'full power on planets and close doubles' }[v];
  toast(`Steady air (seeing): ${SEEING_WORD[v]} — ${cap}`);
  if (!$('#tab-plan').classList.contains('hidden')) renderPlan();
}
/** A bright star at least halfway up to judge twinkling on (stars low down always twinkle). */
function seeingStar() {
  const now = new Date(), cands = sky.stars.filter((o) => (o.mag ?? 9) <= 2.2).map((o) => ({ o, p: sky.altAz(o, now) }));
  return cands.filter((x) => x.p.alt >= 45).sort((a, b) => a.o.mag - b.o.mag)[0] || cands.filter((x) => x.p.alt >= 30).sort((a, b) => b.p.alt - a.p.alt)[0] || null;
}
/** Three small pictures of a bright star at high power, steady to boiling (the usual way to grade seeing at the eyepiece). */
function seeingPic(v) {
  if (v === 'good') return `<svg viewBox="0 0 80 80" class="seepic"><circle cx="40" cy="40" r="4" fill="currentColor"/><circle cx="40" cy="40" r="9" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/><circle cx="40" cy="40" r="14" fill="none" stroke="currentColor" stroke-width=".8" opacity=".3"/></svg>`;
  if (v === 'average') return `<svg viewBox="0 0 80 80" class="seepic"><circle cx="40" cy="40" r="6" fill="currentColor" opacity=".9"/><path d="M29 36a12 12 0 0 1 14-8M52 41a12 12 0 0 1-9 11M30 47a12 12 0 0 1-2-4" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".5"/><circle cx="47" cy="33" r="1.6" fill="currentColor" opacity=".5"/></svg>`;
  return `<svg viewBox="0 0 80 80" class="seepic"><g fill="currentColor"><circle cx="40" cy="40" r="11" opacity=".35"/><circle cx="37" cy="38" r="5" opacity=".7"/><circle cx="44" cy="43" r="4" opacity=".6"/><circle cx="31" cy="46" r="2.5" opacity=".4"/><circle cx="49" cy="33" r="2.5" opacity=".4"/><circle cx="46" cy="51" r="2" opacity=".35"/><circle cx="28" cy="32" r="1.8" opacity=".3"/></g></svg>`;
}
/** The steady-air check: a 10-second look at how much a high star twinkles, or (more accurate) how it looks in the 4 mm. */
function openSeeingCheck(mode = 'twinkle') {
  const box = $('#skycheck'), card = $('#skycheck-card'); box.classList.remove('hidden');
  const close = () => (flow ? flowNext() : box.classList.add('hidden'));
  const done = (v) => { recordSeeing(v, mode); close(); };
  const dark = sky.sunAlt(new Date()) < -6, st = dark ? seeingStar() : null;
  const hi = profile().eyepieces.reduce((a, e) => (e.fl < a.fl ? e : a), profile().eyepieces[0]);
  if (mode === 'twinkle') {
    if (!dark) {                                  // daylight or bright twilight: no stars to judge by yet
      const f = seeingSource() === 'forecast' ? ` Until then the app uses Environment Canada's forecast (${SEEING_WORD[seeingNow()]}).` : ' Until then the app assumes an average night.';
      card.innerHTML = `<h3 style="margin-top:0">Seeing: steady air check</h3>
        <p><b>This needs stars, so it only works once it is dark.</b> Come back after sunset, when bright stars are out, and it takes ten seconds.${f}</p>
        <button id="see-close" class="primary" style="width:100%;margin-top:6px">${flow ? 'Skip for now' : 'OK'}</button>`;
      $('#see-close').onclick = close; return;
    }
    card.innerHTML = `<h3 style="margin-top:0">Seeing: steady air check</h3>
      ${seeingTonight() ? `<p class="small">Earlier tonight: <b>${SEEING_WORD[seeingTonight().v]}</b> (${seeingTonight().how === 'pick' ? 'picked' : 'checked'} at ${hm(new Date(seeingTonight().when))}). The air changes through the evening, so check again, or <button class="mini" id="see-keep">keep it</button></p>` : ''}
      <p>${st ? `Look at <b>${esc(st.o.label)}</b>, ${st.p.alt.toFixed(0)}° up in the ${compassName(st.p.az)}, for about ten seconds.` : dark ? 'Look at any bright star at least halfway up the sky for about ten seconds.' : 'Do this after dark: look at a bright star at least halfway up the sky for about ten seconds.'}
      <span class="muted small">Not a star near the horizon: everything twinkles down there, whatever the air is doing higher up.</span></p>
      <div class="seebtns">
        <button data-see="good"><b>Barely twinkles</b><span class="muted small">a steady point</span></button>
        <button data-see="average"><b>Twinkles gently</b><span class="muted small">flickers in brightness; colour stays about the same</span></button>
        <button data-see="poor"><b>Twinkles hard</b><span class="muted small">jumps around and flashes colours</span></button>
      </div>
      <p class="muted small">Seeing (how steady the air is) decides how much power planets and close double stars can take tonight. It changes during the night, so this counts for tonight only.</p>
      <button id="see-ep" style="width:100%">More accurate: look at a star in your ${esc(hi.name)}</button>
      <button id="see-close" style="width:100%;margin-top:6px">${flow ? (seeingSource() === 'forecast' ? `Skip — use the forecast (${SEEING_WORD[seeingNow()]})` : 'Skip — assume average') : 'Close'}</button>`;
  } else {
    card.innerHTML = `<h3 style="margin-top:0">Seeing: eyepiece check</h3>
      <p>Put a bright star high in the sky in the middle of your <b>${esc(hi.name)}</b>, focus as sharply as you can, and watch it for half a minute. Which looks most like it?</p>
      <div class="seebtns pics">
        <button data-see="good">${seeingPic('good')}<b>Sharp point with steady rings</b></button>
        <button data-see="average">${seeingPic('average')}<b>Sharp now and then, rings come and go</b></button>
        <button data-see="poor">${seeingPic('poor')}<b>A boiling blob that never settles</b></button>
      </div>
      <button id="see-back" style="width:100%">Back to the twinkle check</button>
      <button id="see-close" style="width:100%;margin-top:6px">${flow ? (seeingSource() === 'forecast' ? `Skip — use the forecast (${SEEING_WORD[seeingNow()]})` : 'Skip — assume average') : 'Close'}</button>`;
  }
  card.querySelectorAll('[data-see]').forEach((b) => b.onclick = () => done(b.dataset.see));
  if ($('#see-ep')) $('#see-ep').onclick = () => openSeeingCheck('eyepiece');
  if ($('#see-keep')) $('#see-keep').onclick = close;
  if ($('#see-back')) $('#see-back').onclick = () => openSeeingCheck('twinkle');
  $('#see-close').onclick = close;
}
/** Short lessons in how observers decide, one a night (the same one all evening). */
const TIPS = [
  'Your eyes keep improving for about 20 minutes in the dark. Red light keeps that; one glance at a white screen undoes it.',
  'Averted vision: look slightly to one side of a faint galaxy and it appears. The edge of your eye is more sensitive to dim light than the centre.',
  'Objects are clearest when they are highest. Low down you look through several times more air.',
  'The Moon is best near first and last quarter, when shadows along the line between light and dark show the craters. A full Moon is flat and glaring.',
  'Not sure a faint glow is there? Tap the tube gently. The eye notices a faint object much more easily while it moves.',
  'Find with low power, look with more. The widest eyepiece makes finding easy; then step up one at a time.',
  'Twinkling tells you how steady the air is, which astronomers call seeing. Steady air (good seeing) brings out planets and close doubles; dark, clear air brings out galaxies. They are often different nights: crisp, sparkling skies after a cold front tend to be unsteady.',
  'Doubles are perfect for Moon nights and city skies: moonlight and streetlights barely touch them.',
  'Let the telescope cool for 20–30 minutes before trying high power. A warm mirror makes its own shimmer.',
  'Sketching, even badly, makes you see more. You look longer and notice details you would otherwise skip.',
  'A galaxy rated "Challenging" might not show the first time. Try again on a darker night, when it is higher, or from a darker spot.',
  'Colour in double stars shows best slightly out of focus, where the light spreads into small coloured discs.',
  'The Dawes limit: a telescope can split two equal stars about 116 ÷ its aperture in mm arcseconds apart. That is 0.77″ for a 150 mm and 0.58″ for a 200 mm, if the air is steady enough (good seeing).',
  'A bigger aperture (main mirror or lens) shows more stars and brighter glows at the same power. A "faster" f/4 only looks brighter because the same eyepiece gives it lower power.',
];
function tipOfTheNight() { const d = Math.floor((Date.now() - 12 * 3600000) / 86400000); return TIPS[d % TIPS.length]; }
/** "How this plan was picked": what the app assumed about tonight, in plain words. */
function howPickedHTML(n) {
  const sq = skyQ(), see = seeingTonight();
  return `<ul class="small how">
    <li><b>Sky darkness:</b> ${sq ? `your darkness check (${esc(skyCheckName())})` : `the light-pollution map for this spot (${esc(skyGuessName())}) — do the 30-second check to make it yours`}${!sq && fcFor(here(), new Date()) && fcFor(here(), new Date()).ol && fcFor(here(), new Date()).ol.transp ? `, adjusted for the forecast haze (transparency ${fcFor(here(), new Date()).ol.transp}/5)` : ''}. <i>Do it yourself:</i> count the Little Dipper's stars. All seven means a dark sky that's good for galaxies; only two or three means stick to the Moon, planets, doubles and bright clusters.</li>
    <li><b>Moon:</b> ${Math.round(n.moonFrac * 100)}% lit. ${n.moonFrac > 0.3 ? 'Galaxies and nebulae near it fade, and nothing deep-sky is suggested within 15° of it (its glare fills an open tube).' : 'Not enough to matter much.'} <i>Do it yourself:</i> on Moon nights pick clusters, doubles and planets; save galaxies and nebulae for the week around new Moon.</li>
    <li><b>Steady air (seeing):</b> ${see ? `${SEEING_WORD[see.v]} (${see.how === 'pick' ? 'picked' : 'checked'} tonight)` : seeingSource() === 'forecast' ? `${SEEING_WORD[seeingNow()]}, from Environment Canada's seeing forecast` : 'not tested, so average is assumed'}. It sets how much power planets and close doubles get. <i>Do it yourself:</i> look at a star high up. If it hardly twinkles, use your highest power on planets tonight.</li>
    <li><b>What's chosen:</b> a mix of kinds — a planet, a double, clusters, a nebula, a galaxy — favouring the famous showpieces, things high in the sky, and things you haven't logged yet. Doubles are judged by how bright and colourful they are. <i>Do it yourself:</i> start with whatever is highest. Low objects are seen through more air, so they're dimmer and blurrier.</li>
    <li><b>Eyepieces:</b> big things get your widest view; globulars and small planetaries get more power to show detail; galaxies and nebulae are never made too dim; doubles get enough power to split comfortably. <i>Do it yourself:</i> always find a target in your lowest power, then step up one eyepiece at a time and stop when the view stops getting better.</li>
  </ul>`;
}
/** A rule of thumb for choosing the eyepiece yourself, by kind of object. */
const EP_TIP = {
  PL: 'Try it: if the planet ripples like it is under water, drop to a longer eyepiece. Detail shows when the image is steady, not when it is biggest.',
  DS: 'Rule of thumb: power × gap in arcseconds should come to about 240 for an even pair (so a 4″ pair wants about 60×), and more when one star is much fainter. The closest pair any telescope can split is about 116 ÷ its size in mm arcseconds (the Dawes limit).',
  GC: 'Try it: find it at low power, then step up until it stops getting better. Globulars usually look best at 100× or more.',
  PN: 'Try it: at low power a small planetary looks like a star. Add power and it swells into a disc while the real stars stay points.',
  GX: 'Try it: if a galaxy fades as you add power, go back down. Faint glows like a brighter, smaller image. Look slightly to one side of it.',
  NB: 'Try it: faint glows like a brighter, smaller image, so go back down if it fades as you add power.',
  CN: 'Try it: faint glows like a brighter, smaller image, so go back down if it fades as you add power.',
  OC: 'Rule of thumb: field of view = the eyepiece\'s own field (often 50–62°) ÷ magnification. Choose one a bit wider than the cluster.',
};
const epTip = (o) => EP_TIP[o.planet ? 'PL' : o.pairs || (o.key || '').startsWith('ds:') ? 'DS' : o.t] || '';
/** A short reason not to use an eyepiece on this scope for this object, or '' when it's fine. */
function epFlag(o, e, p) {
  const M = p.fl / e.fl, D = p.aperture, exit = D / M;
  if (M > 2 * D) return `more power than ${Math.round(D)} mm can use`;
  if (M > 300) return 'more power than the air allows most nights';
  if (exit > 7.2) return `${exit.toFixed(1)} mm exit pupil, wider than your eye`;
  if (!o.planet && !o.pairs && !(o.key || '').startsWith('ds:') && !(o.key || '').startsWith('st:') && exit < 0.6) return 'too dim at this power';
  return '';
}
/** One line on why that eyepiece. */
function epReason(o, r) {
  const k = o.planet ? 'PL' : o.pairs || (o.key || '').startsWith('ds:') ? 'DS' : o.t, steady = SEEING_WORD[seeingNow()];
  if (o.planet && o.id === 'Moon') return 'Shows the whole Moon; zoom in along the shadow line between light and dark.';
  if (k === 'PL') return `As much power as the air allows: ${steady} seeing tonight${{ check: '', forecast: ' (forecast)', assumed: ' (not tested)' }[seeingSource()]}.`;
  if (k === 'DS') return 'Enough power to split the pair comfortably, no more.';
  if (o.maj && r.ep) { const tf = (r.ep.afov || 62) / (profile().fl / r.ep.fl) * 60; if (tf < o.maj * 1.1) return "It's bigger than this field — your widest view shows the most of it."; }
  return { GC: 'Frames it with room to spare and starts to break it into stars.', PN: 'Makes the small disc big enough to show its shape.', GX: 'Frames it without dimming it too much.', NB: 'Frames the glow without dimming it too much.', CN: 'Frames the glow without dimming it too much.', OC: 'Frames the whole cluster.' }[k] || 'Frames it well.';
}
/** Real-world effects the full-screen eyepiece view can switch off, one at a time (all off = a perfect night, with catalogue magnitudes). */
const EP_FACTORS = [['moon', 'Moon'], ['lp', 'Light pollution'], ['twilight', 'Twilight'], ['transp', 'Transparency'], ['altitude', 'Altitude'], ['seeing', 'Seeing'], ['dawes', 'Dawes limit'], ['aperture', 'Aperture brightness'], ['coma', 'Coma']];
function epFactors() { const f = (state.ui && state.ui.epF) || {}; return Object.fromEntries(EP_FACTORS.map(([k]) => [k, f[k] !== false])); }
function setEpFactors(f) { state.ui = state.ui || {}; state.ui.epF = f; save(); }
/** What the sky and air are doing toward a target, for the eyepiece pictures: your sky's limit (check or map), the
 *  moonlight toward it, tonight's forecast haze (map-based skies only), and the steady-air smear in arcseconds. */
function eyeEnv(tg, t = new Date()) {
  let moonCd = 0;
  try {
    const m = sky.moonInfo(t), D = Math.PI / 180;
    const sep = Math.acos(Math.max(-1, Math.min(1, Math.sin(tg.alt * D) * Math.sin(m.alt * D) + Math.cos(tg.alt * D) * Math.cos(m.alt * D) * Math.cos((tg.az - m.az) * D)))) / D;
    moonCd = moonlight({ moonAlt: m.alt, moonFrac: m.frac, sepDeg: sep, targetAlt: Math.max(1, tg.alt) });
  } catch (e) { /* no Moon data */ }
  const f = skyQ() ? null : fcFor(here(), t);
  let twiCd = 0; try { twiCd = twilight(sky.sunAlt(t)); } catch (e) { /* no Sun data */ }
  return { nelm: skyNelm(), moonCd, twiCd, transpAdj: f && f.ol ? transpAdj(f.ol.transp) : 0, seeingArc: { poor: 2.5, average: 1.5, good: 1.0 }[seeingFor(t)] };
}
/** One eyepiece view filling the screen (tap a small preview). The eyepieces sit side by side on a track that scrolls
 *  and snaps natively, so the next one follows your finger and settles with the phone's own momentum. Same order as the
 *  previews (longest first). Redrawn every few seconds as the sky turns. Tap outside the picture, or ✕, to close. */
function openEpZoom(o, epi, at0 = null) {
  const p = profile(); if (!p.eyepieces[epi]) return;
  const order = epsFor(o).map((x) => x.i);
  let at = Math.max(0, order.indexOf(epi));
  let box = $('#epzoom'); if (box) box.remove();
  box = document.createElement('div'); box.id = 'epzoom'; box.className = 'epzoom';
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  box.innerHTML = `<div class="epz-h"><div><b>${esc(o.label)}</b> <span id="epz-t"></span><div class="muted small" id="epz-note"></div></div><button class="ibtn" id="epz-x" aria-label="Close">✕</button></div>
    <div class="epz-track" id="epz-track">${order.map((i) => `<div class="epz-page"><canvas data-epi="${i}" width="300" height="300"></canvas></div>`).join('')}</div>
    <div class="epz-nav"><button class="ibtn" id="epz-prev" aria-label="Previous eyepiece">‹</button><span id="epz-dots"></span><button class="ibtn" id="epz-next" aria-label="Next eyepiece">›</button></div>
    <div class="epz-drawer" id="epz-drawer"><button class="epz-handle" id="epz-hd" aria-expanded="true"><i></i><span id="epz-hdt">Hide controls</span></button>
    <div class="epz-mode"><div class="seg advseg" role="group" aria-label="Controls"><button data-adv="0">Basic</button><button data-adv="1">Advanced: switch effects</button></div><div class="adv"><div class="chips epz-chips">${EP_FACTORS.map(([k, l]) => `<button data-f="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
      <div class="muted small epz-hint">Switch an effect off to see what it does. All off is a perfect night: dark sky, still air, sharp optics, catalogue magnitudes.</div></div>
      <div class="epz-btns"><span class="adv"><button class="mini" id="epz-all">All on</button><button class="mini" id="epz-none">All off</button></span><button class="mini" id="epz-sim">Open in the simulator</button></div></div>
    <p class="muted small" id="epz-cap"></p></div>`;
  document.body.appendChild(box);
  const track = $('#epz-track'), res = [];
  // The view takes whatever room the controls leave, and grows when they are tucked away.
  const fit = () => {
    const side = Math.max(120, Math.floor(Math.min(track.clientWidth - 8, track.clientHeight - 4)));
    track.querySelectorAll('canvas').forEach((cv) => { cv.style.width = cv.style.height = side + 'px'; cv.width = cv.height = Math.round(side * dpr); });
    track.scrollLeft = at * track.clientWidth;
  };
  const tuck = (min) => {
    state.ui = state.ui || {}; state.ui.epzMin = min; save();
    box.classList.toggle('dock-min', min); $('#epz-hd').setAttribute('aria-expanded', String(!min));
    requestAnimationFrame(() => { fit(); draw(); });
  };
  box.classList.toggle('dock-min', !!(state.ui && state.ui.epzMin)); $('#epz-hd').setAttribute('aria-expanded', String(!(state.ui && state.ui.epzMin)));
  { const dr = $('#epz-drawer'); let y0 = null, x0 = 0;                     // a downward flick tucks the controls away, upward brings them back
    dr.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; }, { passive: true });
    dr.addEventListener('touchend', (e) => { if (y0 == null) return; const t = e.changedTouches[0], dy = t.clientY - y0, dx = t.clientX - x0; y0 = null;
      if (Math.abs(dy) > 40 && Math.abs(dy) > 1.5 * Math.abs(dx)) { const min = dy > 0; if (min !== box.classList.contains('dock-min')) { tuck(min); tick(); } } }, { passive: true }); }
  window.addEventListener('resize', function rs() { if (!box.isConnected) return window.removeEventListener('resize', rs); fit(); draw(); });
  const label = () => {
    const e = p.eyepieces[order[at]], r = res[at];
    $('#epz-t').textContent = `in the ${e.name} · ${(p.fl / e.fl).toFixed(0)}×${epFlag(o, e, p) ? ' · not recommended: ' + epFlag(o, e, p) : ''}`;
    $('#epz-dots').innerHTML = order.map((_, k) => `<i class="${k === at ? 'on' : ''}"></i>`).join('');
    $('#epz-prev').disabled = at === 0; $('#epz-next').disabled = at === order.length - 1;
    $('#epz-note').textContent = r ? [r.note, `field ${r.tfov >= 1 ? r.tfov.toFixed(1) + '°' : (r.tfov * 60).toFixed(0) + '′'}`, at0 ? `at ${hm(at0)}` : '', r.sbEye < 90 ? `background ${r.sbEye.toFixed(1)} mag/arcsec²` : ''].filter(Boolean).join(' · ') : '';
    const advOn = !!(state.ui && state.ui.adv);
    box.classList.toggle('show-adv', advOn); box.querySelectorAll('[data-adv]').forEach((b) => b.classList.toggle('on', (b.dataset.adv === '1') === advOn));
    const f = advOn ? epFactors() : Object.fromEntries(EP_FACTORS.map(([k]) => [k, true])), raw = !Object.values(f).some(Boolean);
    box.querySelectorAll('[data-f]').forEach((b) => { b.classList.toggle('on', !!f[b.dataset.f]); b.setAttribute('aria-pressed', String(!!f[b.dataset.f])); });
    const off = EP_FACTORS.filter(([k]) => !f[k]).map(([, l]) => l.toLowerCase());
    $('#epz-hdt').textContent = box.classList.contains('dock-min') ? `Show controls${advOn ? ` · ${raw ? 'perfect night' : off.length ? off.length + ' effect' + (off.length > 1 ? 's' : '') + ' off' : 'all effects on'}` : ''}` : 'Hide controls';
    const cap = raw ? 'A perfect night: dark sky, no Moon, clear and still air, overhead, sharp optics. Every star to magnitude 8, the brighter ones labelled with their catalogue magnitude.'
      : off.length ? `Without: ${off.join(', ')}.`
      : r && r.enlarged ? `The planet is drawn ${r.enlarged}× larger than scale.` : r && r.widened ? 'Close pairs are drawn a little wider than scale so the split the eye sees shows up.' : 'To scale for this eyepiece; brightness shown as the eye would see it.';
    $('#epz-cap').textContent = `${cap} ${order.length > 1 ? 'Swipe for the next eyepiece; ' : ''}tap outside the view to close.`;
  };
  const draw = () => {
    if (!box.isConnected) return clearInterval(timer);
    const now = at0 || new Date(), tg = sky.altAz(o, now);
    track.querySelectorAll('canvas').forEach((cv, k) => {
      try { res[k] = drawEyepiece(cv, sky, o.pairs && o.key.startsWith('st:') ? { ...o, t: 'DS' } : o, tg, p.eyepieces[order[k]], p, { matrix: state.rot180 ? viewMatrix(p, tg) : null, bright: vis(), nelm: skyNelm(), env: eyeEnv(tg, now), date: now, factors: state.ui && state.ui.adv ? epFactors() : {} }); } catch (err) { console.error(err); }
    });
    label();
  };
  const timer = setInterval(draw, 4000); fit(); draw();
  requestAnimationFrame(() => { fit(); draw(); });
  track.addEventListener('scroll', () => {
    const k = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (k !== at && k >= 0 && k < order.length) { at = k; label(); tick(); }
  }, { passive: true });
  const go = (d) => { const n = Math.max(0, Math.min(order.length - 1, at + d)); track.scrollTo({ left: n * track.clientWidth, behavior: 'smooth' }); };
  const close = () => { clearInterval(timer); box.remove(); };
  box.onclick = (ev) => {
    if (ev.target.closest('#epz-prev')) return go(-1);
    if (ev.target.closest('#epz-next')) return go(1);
    if (ev.target.closest('#epz-hd')) return tuck(!box.classList.contains('dock-min'));
    if (ev.target.closest('.epz-drawer')) { if (!ev.target.closest('button')) return; }
    const ab = ev.target.closest('[data-adv]'); if (ab) { state.ui = state.ui || {}; state.ui.adv = ab.dataset.adv === '1'; save(); draw(); return; }
    const fb = ev.target.closest('[data-f]'); if (fb) { const f = epFactors(); f[fb.dataset.f] = !f[fb.dataset.f]; setEpFactors(f); draw(); return; }
    if (ev.target.closest('#epz-sim')) { const e = p.eyepieces[order[at]]; simFrom(o, p, e); close(); closeSheet(); showTab('sim'); window.scrollTo(0, 0); return; }
    if (ev.target.closest('#epz-all')) { setEpFactors(Object.fromEntries(EP_FACTORS.map(([k]) => [k, true]))); draw(); return; }
    if (ev.target.closest('#epz-none')) { setEpFactors(Object.fromEntries(EP_FACTORS.map(([k]) => [k, false]))); draw(); return; }
    if (ev.target.closest('.epz-mode')) return;
    if (ev.target.tagName === 'CANVAS' || ev.target.closest('.epz-nav')) return;     // a tap on the view itself keeps it open
    close();
  };
}
let sheetCan = () => false;
/** Slide the target sheet out, show the next target, slide it in from the other side (arrows and swipes alike). */
function slideSheet(d, fromDrag = false) {
  const card = $('#sheet-card'); if (!sheetStep || !sheetCan(d) || !card) return;
  const w = card.clientWidth || 360;
  card.style.transition = `transform ${fromDrag ? '.16s' : '.2s'} ease-in, opacity .16s ease-in`; card.style.transform = `translateX(${-d * w}px)`; card.style.opacity = '0.3';
  setTimeout(() => {
    sheetStep(d); tick();
    card.style.transition = 'none'; card.style.transform = `translateX(${d * w * 0.35}px)`; card.style.opacity = '0.3';
    void card.offsetWidth;                                                   // apply that start position before animating
    card.style.transition = 'transform .24s cubic-bezier(.2,.8,.2,1), opacity .2s ease-out'; card.style.transform = ''; card.style.opacity = '';
  }, fromDrag ? 150 : 190);
}
/** For a star that is only on the list to line the telescope up: say plainly there is nothing to study, and why it is useful. */
function alignCardHTML(o, inPlanAsSync) {
  const pic = `<svg class="alignpic" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" class="f"/><circle cx="60" cy="60" r="16" class="ring"/><circle cx="60" cy="60" r="9" class="glow"/><circle cx="60" cy="60" r="3.2" class="star"/></svg>`;
  return `<div class="aligncard">${pic}<div>
    <p><b>Nothing to study here, and that is the point.</b> In the eyepiece ${esc(o.label)} is one bright, sharp point at every magnification, so there are no eyepiece previews.</p>
    <p class="small">It is here because it is easy: bright enough to spot by eye in twilight or a city sky, and a single point centres exactly. ${inPlanAsSync ? 'Push to it, centre it in your lowest-power eyepiece, tap <b>Sync</b>, then carry on: the arrows to the targets after it get more accurate.' : 'Centre it in your lowest-power eyepiece and tap <b>Sync</b>: the arrows to whatever you look at next get more accurate.'}</p></div></div>`;
}
/**
 * When to draw eyepiece previews for. A planned target: its best time in the session. Otherwise, in daylight or
 * twilight, tonight once it is fully dark (if the target is up then), because the daytime sky hides everything.
 * Otherwise now.
 */
function previewTime(o, row) {
  const now = new Date();
  if (row && row.best) return new Date(row.best);
  try { if (sky.sunAlt(now) > -12) { const n = sky.night(), t = n && (n.astro || n.naut); if (t && +t > +now && sky.altAz(o, new Date(t)).alt > 5) return new Date(t); } } catch (e) { /* no night data */ }
  return now;
}
/**
 * "There's more to see": when tonight (Moon, twilight, low in the sky) shows less of a deep-sky object than this scope
 * can, say what it looks like on a moonless night with the object high, from here, and from a dark site when that adds
 * more; and which evenings it's highest. Worded for a first look when it isn't logged as seen. (Build 120)
 */
function betterNightHTML(o, seen) {
  if (!o.key.startsWith('dso:') || !(o.alt > 0) || o.dec == null || o.ra == null) return '';
  const now = rateNow(o); if (!now || now.cause === 'blocked') return '';
  const p = profile(), culm = 90 - Math.abs(here().lat - o.dec); if (culm < 15) return '';
  const at = (nelm) => rate(o, { alt: Math.min(culm, 85), sunAlt: -30, nelm }, p);
  const more = (a, b) => a && b && (a.level < b.level || (a.res ?? 0) > (b.res ?? 0));   // a shows more than b
  const home = at(skyNelm()), dark = skyNelm() < 6.2 ? at(6.5) : null;
  const homeMore = more(home, now), darkMore = more(dark, homeMore ? home : now);
  if (!homeMore && !darkMore) return '';
  // Highest at about 10 pm when the Sun's right ascension is the object's minus 10 h; the Sun's RA is 0 h on Mar 20
  // and gains 2 h a month.
  const days = ((((o.ra / 15 - 10) % 24) + 24) % 24) / 24 * 365.25, month = new Date(new Date().getFullYear(), 2, 20 + Math.round(days)).toLocaleDateString([], { month: 'long' });
  const lines = [];
  if (homeMore) lines.push(`On a moonless night with it high up, your ${esc(p.name)} shows: ${esc(describe(o, home).split(' · ')[0].toLowerCase())}.`);
  if (darkMore) lines.push(`From a dark site${homeMore ? '' : `, with it high and no Moon`}: ${esc(describe(o, dark).split(' · ')[0].toLowerCase())}.`);
  return `<div class="card small"><b>${seen ? 'There’s more to see than tonight shows' : 'First look? There’s more to it than tonight shows'}</b><p style="margin:4px 0 0">${lines.join(' ')} It’s highest in the evening around ${month}.</p></div>`;
}
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
  sheetCan = nav ? (d) => !!keys[at + d] : () => false;
  card.innerHTML = `<div class="sheet-h"><div><div class="target-h"><span class="name">${esc(o.label)}</span>${o.name ? `<span class="cname">${esc(o.name)}</span>` : ''}</div>
      <div class="muted small">${isTarget ? '' : '<span class="alignbadge">Alignment star</span> '}${esc(kindLabel(o))}${o.con ? ' in ' + esc(fullCon(o.con)) : ''}${o.key.startsWith('dso:') && o.label !== o.id ? ' · ' + esc(o.id) : ''}</div></div>
      <button class="ibtn" id="sh-x" aria-label="Close">✕</button></div>
    ${nav ? `<div class="shnav"><button id="sh-prev" aria-label="Previous target" ${nav.i === 0 ? 'disabled' : ''}>${ICON.prev}</button><span>${nav.i + 1} of ${nav.n} · swipe for the next</span><button id="sh-next" aria-label="Next target" ${nav.i === nav.n - 1 ? 'disabled' : ''}>${ICON.next}</button></div>` : ''}
    ${r ? `<p class="rateline"><span class="dots lv${r.level}">${DOTS[r.level]}</span> <b>${LEVEL_NAMES[r.level]}</b> ${row ? 'at its best in your session' : 'right now'} — ${esc(row ? row.desc : describe(o, r))}</p>` : (o.alt <= 0 ? '<p class="rateline muted">Below the horizon right now.</p>' : '')}
    ${betterNightHTML(o, seen)}
    ${blurb ? `<p class="blurb">${esc(blurb)}</p>` : ''}
    ${!isTarget ? alignCardHTML(o, planList().some((x) => x.key === key && x.sync)) : ''}
    ${doubleNature(o) ? `<p class="small">${esc(NATURE_NOTE[doubleNature(o)])}</p>` : ''}
    ${o.shower ? `<p class="small"><b>No telescope needed.</b> Meteors can appear anywhere in the sky; they only seem to come from the radiant, ${o.alt > 0 ? `${Math.round(o.alt)}° up in the ${compassName(o.az)} right now` : 'below the horizon right now; the best rates come after it rises'}. Lie back, face about halfway up, away from lights and the Moon, and give your eyes 20 minutes. The sky view shows the radiant as a big dashed circle.</p>` : tooWide(o, profile()) && o.t === 'AS' ? `<p class="small"><b>A naked-eye pattern.</b> At ${(o.maj / 60).toFixed(0)}° across it is far bigger than any eyepiece field, so there is no eyepiece view. Use Push to it and the sky chart to find it, then look up.</p>` : isTarget && o.alt != null ? `<div class="eprow" id="sh-eps">${epsFor(o).map(({ e, i }) => `<figure class="${epFlag(o, e, profile()) ? 'notrec' : ''}"><canvas width="300" height="300" data-epi="${i}"></canvas><figcaption><b>${esc(e.name)}</b><span>${(profile().fl / e.fl).toFixed(0)}×<span id="sh-epn${i}"></span></span>${epFlag(o, e, profile()) ? `<span class="flag">Not recommended: ${esc(epFlag(o, e, profile()))}</span>` : ''}</figcaption></figure>`).join('')}</div>
      <p class="muted small hidden" id="sh-more" style="text-align:right;margin:0">swipe for more ›</p>
      <p class="muted small" id="sh-epcap" style="text-align:center;margin-top:2px">${(() => { const sk = epsFor(o).skipped || []; return sk.length ? `To scale; brightness is not. It's too big for your ${sk.join(' and ')}: ${sk.length > 1 ? 'they show' : 'it shows'} only a small part of it, so ${sk.length > 1 ? "they're" : "it's"} left out. Tap a view to enlarge.` : 'In each of your eyepieces, to scale. Brightness is not to scale. Tap a view to enlarge; add or change eyepieces in Setup.'; })()}</p>` : ''}
    <div class="kv">
      ${row ? `<span>Looks best at</span><span>${hm(row.best)} · ${row.alt.toFixed(0)}° ${compassName(row.az)}</span>` : ''}
      <span>Right now</span><span>${o.alt > 0 ? `${o.alt.toFixed(0)}° up, ${compassName(o.az)}` : 'below the horizon'}</span>
      ${r && r.ep ? `<span>Best eyepiece</span><span>${esc(r.ep.name)} (${(profile().fl / r.ep.fl).toFixed(0)}×)${r.epSteady ? `; ${esc(r.epSteady.name)} (${(profile().fl / r.epSteady.fl).toFixed(0)}×) when the air is steady (good seeing)` : ''}</span>` : ''}
      ${o.mag != null ? `<span>Brightness</span><span>magnitude ${(+o.mag).toFixed(1)}</span>` : ''}
      ${sizeText(o) ? `<span>${o.maj ? 'Size' : 'Pair'}</span><span>${sizeText(o)}</span>` : ''}
      ${o.pairs || o.sep ? `<span>Your scope splits</span><span>${splitLimit(profile().aperture).toFixed(splitLimit(profile().aperture) < 1 ? 2 : 1)}″ tonight</span>` : ''}
      ${isTarget ? `<span>Your log</span><span>${seen ? 'Seen ✓' : last ? RESULT[last.seen] : 'Not logged yet'}${last ? ' · ' + shortDate(last.t) : ''}</span>` : ''}
    </div>
    ${r && r.ep ? `<div class="why"><b>Why the ${esc(r.ep.name)}?</b> ${esc(epReason(o, r))}${epTip(o) ? `<div class="tip">${esc(epTip(o))}</div>` : ''}</div>` : ''}
    <div class="btnrow"><button id="sh-go" class="primary">Push to it</button>${isTarget ? `<button id="sh-plan">${inPlan ? '✓ In plan (remove)' : '+ Add to plan'}</button>` : ''}</div>
    ${isTarget ? `<div class="btnrow"><button id="sh-seen">${seen ? 'Log it again ✓' : 'Log as seen ✓'}</button></div>` : ''}`;
  box.classList.remove('hidden'); card.scrollTop = 0;
  { const row = $('#sh-eps'), more = $('#sh-more'); if (row && more && row.scrollWidth > row.clientWidth + 4) { more.classList.remove('hidden'); row.addEventListener('scroll', () => more.classList.add('hidden'), { once: true, passive: true }); } }
  // one small preview per eyepiece, drawn for when you will actually look (see previewTime)
  const pvT = previewTime(o, row), pvLater = +pvT - Date.now() > 5 * 60000;
  if (pvLater) { const cap = $('#sh-epcap'); if (cap) cap.textContent = `As it will look at ${hm(pvT)}${row ? ', its best time in your session' : ', once it is fully dark'}. ` + cap.textContent; }
  card.querySelectorAll('#sh-eps canvas').forEach((cv) => {
    try {
      // Work the position out for this instant. The list's stored position can be minutes old, and the sky turns a
      // quarter of a degree a minute: enough to slide a high-power field right off the target's own stars.
      const p = profile(), e = p.eyepieces[+cv.dataset.epi], now = pvT, tg = sky.altAz(o, now);
      const longest = p.eyepieces.reduce((a, x) => (x.fl > a.fl ? x : a), p.eyepieces[0]);
      const res = drawEyepiece(cv, sky, o.pairs && o.key.startsWith('st:') ? { ...o, t: 'DS' } : o, tg, e, p, { matrix: state.rot180 ? viewMatrix(p, tg) : null, bright: vis(), nelm: skyNelm(), env: eyeEnv(tg, now), refExit: p.aperture / (p.fl / longest.fl), thumb: true, date: now });
      const n = $('#sh-epn' + cv.dataset.epi); if (n && res) n.textContent = ` · ${res.tfov >= 1 ? res.tfov.toFixed(1) + '°' : (res.tfov * 60).toFixed(0) + '′'}`;
      if (res && res.widened) { const cap = $('#sh-epcap'); if (cap) cap.textContent = (pvLater ? `As it will look at ${hm(pvT)}. ` : '') + 'In each of your eyepieces. Close pairs are drawn a little wider than scale, so a split the eye would see is not lost in the small picture.'; }
      if (res && res.enlarged) { const cap = $('#sh-epcap'); if (cap) cap.textContent = (pvLater ? `As it will look at ${hm(pvT)}. ` : '') + `In each of your eyepieces. The planet is drawn ${res.enlarged}× larger than scale so you can see its shape. In the real eyepiece it looks smaller than this, but sharp.`; }
      cv.onclick = () => openEpZoom(o, +cv.dataset.epi, pvLater ? pvT : null);
    } catch (err) { console.error(err); }
  });
  box.onclick = (e) => { if (e.target === box) closeSheet(); };
  $('#sh-x').onclick = closeSheet;
  if (nav) { $('#sh-prev').onclick = () => slideSheet(-1); $('#sh-next').onclick = () => slideSheet(1); }
  if (!card._swipe) {                                // one set of listeners for the life of the page; they act on whatever list is current
    card._swipe = true; let t0 = null, horiz = null;
    card.addEventListener('touchstart', (e) => {
      const row = e.target.closest('.eprow');
      t0 = e.touches.length === 1 && sheetStep && !(row && row.scrollWidth > row.clientWidth + 4) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() } : null; horiz = null;
    }, { passive: true });
    card.addEventListener('touchmove', (e) => {
      if (!t0) return; const dx = e.touches[0].clientX - t0.x, dy = e.touches[0].clientY - t0.y;
      if (horiz === null && Math.hypot(dx, dy) > 10) horiz = Math.abs(dx) > 1.4 * Math.abs(dy);
      if (!horiz) return;
      const edge = !sheetCan(dx < 0 ? 1 : -1);                 // nothing that way: a little give, then resistance
      card.style.transition = 'none'; card.style.transform = `translateX(${edge ? dx * 0.25 : dx}px)`; card.style.opacity = String(1 - Math.min(0.35, Math.abs(dx) / card.clientWidth * 0.5));
    }, { passive: true });
    card.addEventListener('touchend', (e) => {
      if (!t0) return; const dx = e.changedTouches[0].clientX - t0.x, v = Math.abs(dx) / Math.max(1, performance.now() - t0.t); const was = horiz; t0 = null; horiz = null;
      if (!was) return;
      const d = dx < 0 ? 1 : -1;
      if ((Math.abs(dx) > card.clientWidth * 0.22 || v > 0.5) && sheetCan(d)) slideSheet(d, true);
      else { card.style.transition = 'transform .22s ease, opacity .22s ease'; card.style.transform = ''; card.style.opacity = ''; }
    });
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
  // Grouped by when you need them: every night, now and then, your records, then setup. The start screen is the
  // house button at the top of every screen.
  el.innerHTML = `<h2>More</h2>
    ${item('help', 'How this app works', 'What it does, a first night, and the words you’ll meet')}
    <h3>Each night</h3>
    ${item('align', 'Star alignment', state.mode === 'compass' ? 'Compass mode: no alignment needed' : alignedNow() ? `Aligned on ${align.obs.map((o) => esc(o.label)).join(' and ')} · ${syncAgo()}` : 'Not aligned yet. Two minutes, and the app shows you which stars')}
    ${item('camera', 'Camera star finder', state.mounting === 'camera' ? (profile().camBore ? 'Finds where the telescope points from the stars · lined up with the eyepiece' : 'Finds where the telescope points from the stars, with no star to centre') : 'Works out where the phone’s camera is pointing from the stars')}
    ${item('sky', 'Sky darkness check', skyQ() ? `${esc(skyCheckName())} · ${shortDate(state.skyq.when)}` : mapSky() ? `Map estimate: ${esc(skyGuessName())}. A 30-second check makes it exact` : '30 seconds: tunes the visibility ratings to your sky')}
    <h3>Now and then</h3>
    ${item('collim', lensView(profile()) ? 'Collimation' : state.active.startsWith('sw') ? 'Collimate your Skyward' : 'Collimate your telescope', profile().collimated ? `Last done ${shortDate(profile().collimated)} · laser, about 10 minutes` : 'Line up the mirrors with the laser for sharper views. About 10 minutes')}
    ${item('sim', 'Telescope simulator', 'Build any telescope and eyepiece, set the sky and the air, and see what each one changes')}
    ${item('horizon', 'Blocked sky', horizonNow() ? esc(horizonSummary(state.horizon)) : 'Mark trees and buildings so the app never sends you behind them')}
    ${item('test', 'Phone check-up and sensor tests', chk ? `This phone: ${V[chk.result.verdict] || esc(chk.result.verdict)} · ${shortDate(chk.when)}` : 'Find out how accurate this phone can be. 4 minutes')}
    <h3>Your records</h3>
    ${item('log', 'Observing log', st.total ? `${st.total} object${st.total === 1 ? '' : 's'} seen · Messier ${st.messier} of ${st.messierTotal}` : 'Nothing logged yet. Your Messier count and milestones live here')}
    ${item('backup', 'Back up or restore', state.backedUp ? `Last backup ${shortDate(state.backedUp)} · your log, plans and places` : 'Keep a copy of your log, plans and places. They live only on this phone')}
    <h3>Setup</h3>
    ${item('setup', 'Telescope, eyepieces, location and phone mount', `${esc(profile().name)} · ${esc(MOUNTINGS[state.mounting] ? MOUNTINGS[state.mounting].label : 'phone mount')}`)}
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
    if (k === 'sky') openSkyCheck(); else if (k === 'backup') openBackup(); else if (k === 'horizon') openHorizon('more'); else if (k === 'start') { showStart(); } else { if (k === 'help') helpFrom = null; showTab(k); }
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
  check: ['Phone check-up', 'optional, 4 min, once per phone: how far to trust the arrows'],
  sky: ['Sky darkness check', '30 s, once fully dark: count Little Dipper stars'],
  seeing: ['Seeing: steady air check', '10 s, after dark: how much the stars twinkle'],
  horizon: ['Blocked sky', 'one slow turn with the phone, once per place'],
  align: ['Star alignment', '2 min: point at two bright stars'],
};
/** The stops that make sense on the way to each activity. Planning and exploring need no phone check-up. */
const PATH = { observe: ['check', 'sky', 'seeing', 'horizon', 'align'], game: ['check', 'horizon', 'align'], explore: ['check', 'sky', 'seeing', 'horizon', 'align'], plan: ['check', 'sky', 'seeing', 'horizon'], resume: ['check', 'sky', 'seeing', 'horizon', 'align'] };
/** Is a stop switched on? Blocked sky starts on until this spot has a map, then stays off unless the user ticks it. */
// Exploring offers the alignment too, but it starts off there (exploring needs no set-up): its own switch.
// Build 125: Explore keeps its own switch for every step, all off until ticked, so "no set-up" is true on a first visit
// (before, only its alignment switch was separate, and the seeing check and blocked sky ran by default).
const stepKey = (k, act) => (act === 'explore' ? `${k}Explore` : k);
const stepOn = (k, act) => (act === 'explore' ? !!state.launch[`${k}Explore`] : k === 'horizon' ? (state.launch.horizon ?? (!horizonNow() && !curPlace())) : k === 'seeing' ? (state.launch.seeing ?? true) : !!state.launch[stepKey(k, act)]);
const GO = { observe: 'Start observing', explore: 'Start exploring', game: 'Start the game', plan: 'Start planning' };
let flow = null;   // { steps: [..], i, dest, started, quiet }
const stepsFor = (dest) => (PATH[dest] || []).filter((k) => stepOn(k, dest) && !(k === 'align' && alignedNow()));   // the steady-air check always runs when its star is on: the air changes through the evening
/** "Dark from 6:32 PM · Moon 27% lit, sets 8:58 PM · Saturn and Jupiter are up" */
function tonightLine() {
  try {
    const now = new Date(), sun = sky.sunAlt(now), n = sky.nightAt(now);
    const dark = n.astro || n.naut, m = sky.moonInfo(now);
    const when = sun > -18 && dark && now < dark ? `${sun > 0 ? 'Daylight now, dark' : 'Getting dark, fully dark'} from ${hm(dark)}`
      : sun <= -18 ? `Dark now${n.astroAm ? ', until ' + hm(n.astroAm) : ''}` : sun > 0 ? 'Daylight' : 'Twilight';
    const moon = `Moon ${Math.round(m.frac * 100)}% lit${m.alt > 0 ? (n.moonSet && n.moonSet > now ? ', sets ' + hm(n.moonSet) : ', up') : (n.moonRise && n.moonRise > now ? ', rises ' + hm(n.moonRise) : ', down')}`;
    const at = dark && now < dark ? dark : now;
    const up = ['Venus', 'Jupiter', 'Saturn', 'Mars'].filter((p) => { const o = sky.objects.find((x) => x.key === 'pl:' + p); return o && sky.altAz(o, at).alt > 15; });
    const mp = skyQ() ? null : mapSky();
    const q = skyQ(), bort = q ? `your sky about Bortle ${bortleOfNelm(checkNelm())} (your check${q.moonUp || q.twilight ? `, ${q.moonUp ? 'Moon' : 'twilight'} glow taken away` : ''})` : mp ? `sky about Bortle ${mp.bortle} (light-pollution map)` : '';
    return [when, moon, up.length ? `${up.join(' and ')} ${up.length > 1 ? 'are' : 'is'} up` : '', bort].filter(Boolean).join(' · ');
  } catch (e) { return ''; }
}
function planProgress() {
  const P = state.plan; if (!P || !P.items.length) return null;
  if (new Date(P.start).getTime() + P.hours * 3600000 < Date.now() - 6 * 3600000) return null;      // that session is long over
  const T = P.items.filter((x) => !x.sync), done = T.filter((x) => P.done && P.done[x.key]).length;
  const next = P.items.find((x) => !(P.done && P.done[x.key]));
  return { total: T.length, done, next: done < T.length ? next : null };
}
/** Back to the start screen. Its fade-in (timed to follow the splash) only belongs to the first showing: without this,
 *  every return left the screen blank for over two seconds (Build 125). */
function showStart(keepStage = false) { if (!keepStage) launchStage = null; $('#launch').style.animation = 'none'; renderLaunch(); $('#gate').classList.remove('hidden'); }
// The start screen has two stages (Build 127): the main one (tonight's sky, where you are, how the phone sits, and the
// four things to do), and, once one of the four is tapped, that activity's start-up screen: its optional start-up steps
// as a list of stars to switch on or off, ending in the Start button. `launchStage` is the activity whose start-up
// screen is showing, or null for the main one.
let launchStage = null;
function renderLaunch() {
  if (helpFrom === 'start') return;                    // the tour is open on this panel: background redraws (forecast, location) wait
  $('#launch').classList.remove('gatehelp');
  const L = state.launch, chk = lastCheck(), sq = skyQ(), pp = planProgress();
  const V = { solid: 'solid', usable: 'usable', poor: 'poor', unsuitable: 'not suitable', incomplete: 'incomplete' };
  const status = {
    check: chk ? `done: ${V[chk.result.verdict] || chk.result.verdict}` : STEP_INFO.check[1],
    sky: (sky.sunAlt() > -18 ? `needs a fully dark sky (from ${hm(sky.night().astro || sky.night().naut)}) · ` : '') + (sq ? `last: ${sq.label.toLowerCase()}` : STEP_INFO.sky[1]),
    align: alignedNow() ? 'already aligned' : STEP_INFO.align[1],
    seeing: (sky.sunAlt() > -6 ? 'needs stars: only possible once it is dark · ' : '') + (seeingTonight() ? `earlier tonight: ${SEEING_WORD[seeingTonight().v]}, 10 s to check again` : seeingSource() === 'forecast' ? `forecast says ${SEEING_WORD[seeingNow()]}, 10 s to check it yourself` : STEP_INFO.seeing[1]),
    horizon: horizonNow() || placeLabel() ? hzLine() : STEP_INFO.horizon[1],
  };
  const act = ACTIVITIES.some((x) => x[0] === launchStage) ? launchStage : ACTIVITIES.some((x) => x[0] === state.launchAct) ? state.launchAct : 'observe', stops = PATH[act];
  const first = !state.welcomed && !state.seenIntro;                       // nobody has started anything on this phone yet
  if (launchStage) {
    // ---- an activity's start-up screen: the optional steps, then Start
    const [, title, sub, ic] = ACTIVITIES.find((x) => x[0] === act);
    $('#launch').innerHTML = `<button class="back" id="l-back">‹ Start screen</button>
    <div class="stagehead"><svg class="ic" viewBox="0 0 24 24">${ic}</svg><div><h2>${title}</h2><div class="muted">${sub}</div></div></div>
    <div class="path">
      <h3 class="lq lq2">Start-up refinements</h3><div class="pnote">All optional. Tap a star to turn that step on or off (bright = on).</div>
      ${['check', 'sky', 'seeing', 'horizon', 'align'].map((k) => (stops.includes(k)
    ? `<label class="stop"><input type="checkbox" data-step="${stepKey(k, act)}" ${stepOn(k, act) ? 'checked' : ''}><span><b>${STEP_INFO[k][0]}</b><span class="muted">${k === 'horizon' ? (stepOn(k, act) || horizonNow() || placeLabel() ? status[k] : 'skipped') : esc(stepOn(k, act) ? status[k] : k === 'check' ? (chk ? `done: ${V[chk.result.verdict] || chk.result.verdict}` : 'optional, once per phone, 4 min: how far to trust the arrows and the sky view') : k === 'align' && act === 'explore' ? (alignedNow() ? 'already aligned' : 'optional, 2 min: makes the chart match the real sky') : k === 'sky' && !sq && mapSky() ? `skipped: using the map estimate, about Bortle ${mapSky().bortle}` : 'skipped')}</span></span>${k === 'horizon' ? '<button id="l-hz" class="mini" type="button">Open</button>' : ''}</label>`
    : `<div class="stop na"><input type="checkbox" disabled aria-hidden="true"><span><b>${STEP_INFO[k][0]}</b><span class="muted">not needed for this</span></span></div>`)).join('')}
      <div class="stop end"><span class="dest"></span><button id="l-go" class="primary">${GO[act]}</button></div>
    </div>`;
    $('#l-back').onclick = () => { launchStage = null; renderLaunch(); $('#gate').scrollTop = 0; };
    $('#launch').querySelectorAll('[data-step]').forEach((c) => c.onchange = () => { state.launch[c.dataset.step] = c.checked; save(); renderLaunch(); });
    $('#l-go').onclick = () => launch(act);
    if ($('#l-hz')) $('#l-hz').onclick = (e) => { e.preventDefault(); e.stopPropagation(); openHorizon('start'); };
    applyTheme();
    return;
  }
  $('#launch').innerHTML = `<div class="lhead"><h1>Skyward <span>Push-To</span></h1><span class="lhbtns"><button class="hbtn" id="l-help" aria-label="How this app works">${ICON.help}</button><button class="hbtn shadebtn" id="l-shade" aria-label="Day or night look"></button></span></div>
    ${first ? `<div class="welcome"><b>First time here?</b><p>Your telescope has no motors. This app is its guide: the phone rides on the tube and shows which way to push, and how far, until your target is in the eyepiece.</p><div class="btnrow"><button id="l-tour" class="primary">See how it works</button><button id="l-skip">I'll find my way</button></div></div>` : ''}
    ${(() => { const rec = ensureForecast(state.site, new Date(), () => { const f = fcFor(state.site, new Date()); const el = $('#l-fc'), g = $('#l-glance'); if (el) el.innerHTML = outlookHTML(f); if (g) g.outerHTML = glanceHTML(f, sky.nightAt(new Date())).replace('class="glance"', 'class="glance" id="l-glance"'); });
      return glanceHTML(rec, sky.nightAt(new Date())).replace('class="glance"', 'class="glance" id="l-glance"'); })()}
    <details class="more tdetail"><summary>Tonight in detail</summary><p class="tonight">${esc(tonightLine())}</p><div id="l-fc">${outlookHTML(fcFor(state.site, new Date()))}</div></details>
    <div class="whereline"><span class="muted small">${ICON.pin}${whereText()}</span><button id="l-loc" class="mini">Update location</button></div>
    ${mountRowHTML(true)}
    ${pp && pp.next ? `<button id="l-resume" class="primary" style="width:100%;margin:6px 0 2px">Carry on with your plan: ${pp.done} of ${pp.total} done</button>` : ''}
    <h3 class="lq">What are we up to?</h3>
    <div class="lgrid">${ACTIVITIES.map(([k, t, sub, ic]) => `<button class="act" data-act="${k}"><svg class="ic" viewBox="0 0 24 24">${ic}</svg><b>${t}</b><span class="muted">${sub}</span></button>`).join('')}</div>
    <button class="linkrow" id="l-how">${ICON.help}<span><b>How this app works</b><span class="muted">A two-minute read: what it does, a first night, and the words you'll meet</span></span></button>`;
  wireMountRow(renderLaunch, $('#launch'));
  // The tour opens on top of the start screen, not inside the app (Build 126). Before, it left the start screen, and
  // a newcomer who then tapped a tab at the bottom was in the app without ever tapping Start, so the motion sensors
  // (which the phone only lets the app switch on from that tap) were never on.
  const openHelpFromStart = () => { if (!state.welcomed) { state.welcomed = true; save(); } helpFrom = 'start'; renderHelp(); };
  $('#l-help').onclick = $('#l-how').onclick = openHelpFromStart;
  if ($('#l-tour')) { $('#l-tour').onclick = openHelpFromStart; $('#l-skip').onclick = () => { state.welcomed = true; save(); renderLaunch(); }; }
  // Tapping one of the four opens its start-up screen (the steps and the Start button).
  $('#launch').querySelectorAll('[data-act]').forEach((b) => b.onclick = () => { state.launchAct = launchStage = b.dataset.act; save(); renderLaunch(); $('#gate').scrollTop = 0; });
  wireUpdateLoc($('#l-loc'));
  $('#l-shade').onclick = (e) => { e.stopPropagation(); openShade(); };
  if ($('#l-resume')) $('#l-resume').onclick = () => launch('resume');
  applyTheme();
}
// ---------------------------------------------------------------- HELP: what the app is, a first night, the words (Build 125)
// One page a newcomer can read in two minutes, reached from the start screen (the ? button, the welcome card, the link
// under Start) and from More. Written the way an observer would explain it at the eyepiece; the terms give their origin.
const HELP_WORDS = [
  ['Push-to', 'A telescope you move by hand while something tells you where to push. The name is a play on “go-to” telescopes, which drive themselves to a target with motors.'],
  ['Alignment', 'Showing the app two known stars so it learns how the phone sits on your telescope. Two minutes, at the start of the night.'],
  ['Sync', 'Telling the app “this is centred in my eyepiece right now”. It corrects the small drift that builds up as the night goes on.'],
  ['Seeing', 'How steady the air is. In good seeing stars are sharp points and planets show fine detail; in poor seeing everything shimmers. It is the old observers’ word for how well you can see through the air tonight.'],
  ['Transparency', 'How clear the air is. Haze, smoke and thin cloud dim galaxies and nebulae even when the stars look steady.'],
  ['Bortle', 'A 1 to 9 scale of sky darkness: 1 is a pristine desert sky, 9 is a city centre. Named for John Bortle, the American observer who published it in Sky & Telescope in 2001.'],
  ['Messier objects', 'M13, M31, M42 and the rest: 110 bright clusters, nebulae and galaxies. The list was begun in the 1700s by the French comet hunter Charles Messier, who wanted to stop mistaking them for comets. They are the classic first targets.'],
  ['Messier Marathon', 'Finding as many of the 110 as you can in one night, a challenge amateur astronomers came up with in the 1970s. All 110 are only possible around new Moon in March; any night makes a good partial run.'],
  ['Star-hop', 'Finding a target the old way: start at a bright star and step from star to star along a chart until you arrive.'],
  ['Averted vision', 'Looking slightly to one side of a faint object. The edge of your vision is more sensitive to dim light than the centre, so the object brightens.'],
  ['Field of view', 'How much sky an eyepiece shows. The app draws it as a circle on the chart.'],
  ['Collimation', 'Lining up a reflector’s mirrors so stars focus to sharp points. The word comes from the Latin for bringing into a straight line.'],
];
function renderHelp() {
  // From the start screen it is drawn in the start screen's own panel (no tabs, no header): the only way on is back to
  // the start screen and its Start button, which is what turns the sensors on. From More it is an ordinary page.
  const fromStart = helpFrom === 'start', el = fromStart ? $('#launch') : $('#tab-help');
  if (fromStart) $('#tab-help').innerHTML = ''; else if ($('#launch #h-back')) renderLaunch();   // one copy at a time (shared ids)
  const toStart = () => { helpFrom = null; showStart(); $('#gate').scrollTop = 0; };
  const way = (k, t, d) => `<li><b>${t}</b><span>${d}</span></li>`;
  el.innerHTML = `<button class="back" id="h-back">‹ ${fromStart ? 'Start screen' : 'Back'}</button>
    <h2>How this app works</h2>
    <p class="helplead">Your telescope has no motors: you move it by hand. This app is its guide. The phone rides on the tube, feels where the telescope is pointing, and shows which way to push, and how far, until your target is in the eyepiece.</p>
    <div class="guide helpdemo" aria-hidden="true"><div class="delta"><div class="lab">Turn</div><div class="val">${L_ARR} 12.4°</div><div class="dir">left</div></div><div class="delta"><div class="lab">Tilt</div><div class="val">▲ 3.1°</div><div class="dir">up</div></div></div>
    <p class="muted small" style="text-align:center;margin-top:2px">Push until both numbers reach zero. That's the whole idea.</p>

    <h3>A night with it</h3>
    <ol class="nightsteps">
      <li><b>Put the phone on the tube.</b> In the Skyward dock it sits screen up, top edge toward the sky end. Any other way works too; you tell the app how it sits.</li>
      <li><b>Align on two bright stars.</b> The app names them and shows where to look. Centre each one in the eyepiece and tap. It takes about two minutes and it is what makes the arrows trustworthy.</li>
      <li><b>Pick a target and follow the arrows.</b> A chime means it should be in the eyepiece.</li>
      <li><b>Tap Sync now and then.</b> Whenever something is centred, a sync keeps the pointing sharp for the rest of the night.</li>
    </ol>

    <h3>Four ways to use it</h3>
    <ul class="ways">
      ${way('observe', 'Observe', 'Pick targets and follow the arrows. The usual way to spend a night.')}
      ${way('explore', 'Explore', 'No set-up at all. Swing the telescope, or just hold the phone up, and see what is there. A good first look, even indoors.')}
      ${way('plan', 'Plan', 'Say when you are going out and for how long. The app picks what suits your telescope and your sky, in an order that saves pushing.')}
      ${way('game', 'Play', 'The Messier Marathon, or a timed race against friends at the same site.')}
    </ul>

    <h3>Reading the screen</h3>
    <p class="small"><b>The faces.</b> Each tile on the start screen is an hour of tonight: <span class="kq0">${FACEPIC[0]}</span> great, <span class="kq1">${FACEPIC[1]}</span> good, <span class="kq2">${FACEPIC[2]}</span> so-so, <span class="kq3">${FACEPIC[3]}</span> cloud. Tap an hour for the details.</p>
    <p class="small"><b>The dots.</b> Beside every target: <span class="dots lv0">●●●</span> obvious, <span class="dots lv1">●●○</span> visible, <span class="dots lv2">●○○</span> challenging, <span class="dots lv3">○○○</span> not tonight. That is worked out for your telescope, your sky and this moment.</p>
    <p class="small"><b>The sun button</b> at the top fades the screen from the blue Day look to red-only Night. Red light leaves your night vision alone, so switch over once you are at the eyepiece.</p>
    <p class="small"><b>The house button</b> always brings you back to the start screen.</p>

    <h3>First night? Start small</h3>
    <ul class="how">
      <li>Skip the optional checks. Star alignment is the only step that matters, and Explore doesn't even need that.</li>
      <li>Begin with something bright: the Moon, Saturn or Jupiter, a double star such as Albireo. “Best right now” under Find is sorted for exactly this.</li>
      <li>Find things with your lowest-power eyepiece (the biggest number on the barrel), then switch up.</li>
      <li>Give your eyes 20 minutes in the dark before you judge a faint galaxy, and try looking slightly to one side of it.</li>
      <li>Dress for 10°C colder than the forecast. You will be standing still.</li>
    </ul>

    <details class="more"><summary>Words you'll meet</summary>
      <dl class="words">${HELP_WORDS.map(([w, d]) => `<dt>${w}</dt><dd>${d}</dd>`).join('')}</dl></details>
    <details class="more"><summary>If something seems off</summary>
      <ul class="how">
        <li><b>The arrows send you the wrong way.</b> The app has the phone the wrong way round. Open Star alignment and tap Change beside “Phone on the scope”.</li>
        <li><b>It chimes, but the target isn't in the eyepiece.</b> Use your lowest-power eyepiece, centre anything bright nearby and tap Sync. If it keeps happening, align again.</li>
        <li><b>The numbers don't move.</b> The motion sensors are off. Tap the message at the top of the screen.</li>
        <li><b>A target says “not tonight”.</b> It is too low, too faint for tonight's sky, or behind something you marked as blocked. Its page says which.</li>
      </ul></details>
    <p class="muted small" style="margin-top:14px">It works without a signal once it has loaded. Your log, plans and settings stay on this phone.</p>
    ${fromStart ? '<div class="actionbar gatebar"><button id="h-start" class="primary wide">Back to the start screen</button></div>' : ''}`;
  if (fromStart) { el.classList.add('gatehelp'); $('#gate').scrollTop = 0; el.scrollIntoView({ block: 'start' }); }
  $('#h-back').onclick = () => (fromStart ? toStart() : showTab(backTo));
  if ($('#h-start')) $('#h-start').onclick = toStart;
}

// ---------------------------------------------------------------- camera star finder
// The phone's camera photographs the sky, the app recognises the stars, and that tells it where the telescope points —
// no star to pick, find or centre. Only meaningful for pointing when the phone is mounted looking along the tube.
let skyCam = null, camLast = null, camNote = '', camErr = '';
function closeCamera() { camStop = true; camFloat(false); if (skyCam) skyCam.close(); skyCam = null; }
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
  if (!r && camErr) resultHTML = `<div class="card"><b class="warn">The camera stopped with an error</b><div class="btnrow"><button id="cam-errcopy">Copy this</button></div><pre class="camrep">${esc(camErr)}</pre></div>`;
  if (r) {
    const near = sol ? brightestNamedNear(sol) : null, t = sol ? camTruth(sol) : null;
    resultHTML = `<div class="card">
      <b class="${sol ? '' : 'warn'}" style="font-size:19px">${sol ? `Found it: ${near ? (near.d < 1.5 ? `on ${esc(near.name)}` : `${near.d.toFixed(0)}° from ${esc(near.name)}`) : `RA ${raHms(t.ra)}, Dec ${t.dec.toFixed(1)}°`}` : (r.an.stars.length < 5 ? 'Not enough stars to tell where this is' : 'Could not match these stars to the star map')}</b>
      ${sol ? `<p class="small" style="margin:4px 0">Telescope: ${t.alt.toFixed(1)}° up, ${compassName(t.az)} (${t.az.toFixed(1)}°). Recognised ${sol.n} of the ${sol.of} brightest stars.</p>` : ''}
      ${camNote ? `<p class="small" style="margin:4px 0"><b>${esc(camNote)}</b></p>` : ''}
      <p class="muted small" style="margin:4px 0">Sky ${r.plan.sky}, ${(r.an.mask.fraction * 100).toFixed(0)}% of the picture used. ${r.collected.toFixed(1)} s of light in ${r.N} frame${r.N === 1 ? '' : 's'}: ${esc(r.plan.why)}${r.plan.capped ? ' (stopped at the limit)' : ''}.${r.reg && (r.reg.moved || r.reg.rejected) ? ` The picture was moving: ${r.reg.moved} frame${r.reg.moved === 1 ? '' : 's'} lined up, ${r.reg.rejected} left out.` : ''}${r.an.mask.level > 765 * 0.5 ? ' This looks like daylight or a lit room, so it means nothing here.' : r.an.mask.fraction < 0.15 ? ' Hardly any of this is sky: aim away from trees and buildings.' : ''}</p>
      <canvas id="cam-pic" class="campic"></canvas>
      <p class="muted small" style="margin:4px 0">Grey stripes were ignored. Green circles are stars it recognised, yellow ones it did not. The green mark is where the telescope points.${sol ? ' Blue dashed circles are deep-sky objects.' : ''}</p>
      <div class="btnrow"><button id="cam-save">Save picture</button>${sol ? '<button id="cam-save-l">Save with names</button>' : '<button id="cam-save-l">Save with markings</button>'}</div>
      ${sol && along && !camWiz ? `<details class="more"><summary>Line the camera up with the eyepiece by hand ${cal ? '✓' : '(recommended once)'}</summary>
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
    ${wizardHTML(along)}
    ${on ? `<div class="camstage">${skyCam.isNative ? '<canvas id="cam-v"></canvas>' : '<video id="cam-v" playsinline muted autoplay></video>'}<canvas id="cam-ov"></canvas></div>
      <p class="muted small" style="margin:4px 0">Keep the phone still. After the light is collected, grey stripes show what was not used as sky.</p>
      <label class="row"><span>Light to collect: <b id="cam-light-v">${state.camLight || 3} s</b> <span class="muted small">— more finds fainter stars but takes longer; it stops early once there are enough stars</span></span><input id="cam-light" type="range" min="1" max="10" step="1" value="${state.camLight || 3}"></label>
      <div class="hzbar"><i id="cam-bar" style="width:0"></i></div>
      <p id="cam-status" class="small" style="min-height:1.4em">${along ? (alignedNow() ? 'Aligned. A fix here re-syncs the pointing.' : `Not aligned yet: ${align.obs.length ? 'one more fix, in a different part of the sky' : 'two fixes in different parts of the sky will do it'}.`) : ''}</p>
      <div class="actionbar"><button id="cam-go" class="primary wide" ${camWiz && camWiz.step === 'finder' ? 'disabled' : ''}>${camWiz && camWiz.step === 'shoot' ? 'It’s centred' : 'Find where I’m pointing'}</button><button id="cam-stop">Close camera</button></div>`
      : `<div class="btnrow"><button id="cam-start" class="primary">Start the camera</button></div><p id="cam-status" class="small"></p>`}
    ${resultHTML}`;
  bindBack(el);
  wireWizard();
  if ($('#cam-along')) $('#cam-along').onclick = () => { setMounting('camera'); toast('Phone position: looking along the tube'); renderCamera(); };
  if ($('#cam-start')) $('#cam-start').onclick = async () => {
    $('#cam-status').textContent = 'Opening the camera…';
    renderCameraLive(); if (!skyCam || !skyCam.on) return;
  };
  if (on) attachCamera();
  if ($('#cam-stop')) $('#cam-stop').onclick = () => { closeCamera(); renderCamera(); };
  if ($('#cam-light')) $('#cam-light').oninput = (e) => { state.camLight = +e.target.value; $('#cam-light-v').textContent = `${state.camLight} s`; save(); };
  if ($('#cam-go')) $('#cam-go').onclick = cameraFind;
  if ($('#cam-errcopy')) $('#cam-errcopy').onclick = async () => { try { await navigator.clipboard.writeText(`${$('#build').textContent}\n${camErr}`); toast('Copied'); } catch (e) { toast('Could not copy; select the text instead'); } };
  if (r && $('#cam-pic')) {
    drawResult($('#cam-pic'), r, camBore(), { labels: camLabels(r) });
    const ws = camWiz && camWiz.star && sol ? wizWhere(sol, camWiz.star) : null;      // ring the star to centre
    if (ws) { const c = $('#cam-pic').getContext('2d'), q = Math.max(30, r.w / 25); c.strokeStyle = '#ffd66e'; c.lineWidth = Math.max(3, r.w / 300); c.beginPath(); c.arc(ws.x, ws.y, q, 0, 6.283); c.stroke(); c.fillStyle = '#ffd66e'; c.font = `bold ${Math.round(q * 0.8)}px system-ui`; c.textAlign = 'center'; c.fillText(camWiz.star.name, ws.x, ws.y - q - 8); }
  }
  if ($('#cam-save')) $('#cam-save').onclick = () => savePicture(false);
  if ($('#cam-save-l')) $('#cam-save-l').onclick = () => savePicture(true);
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
/** Names to write on a solved picture: bright stars, planets and the Moon, and Messier and Caldwell objects. */
function camLabels(r) {
  const sol = r && r.sol; if (!sol) return [];
  const { w, h } = r, out = [], m = r.an && r.an.mask, when = r.when ? new Date(r.when) : new Date();
  // Only where the picture shows sky: no names on trees or roofs that hide the object.
  const inside = (p) => p && p.x >= 0 && p.y >= 0 && p.x < w && p.y < h && (!m || m.sky[Math.min(m.th - 1, (p.y / m.T) | 0) * m.tw + Math.min(m.tw - 1, (p.x / m.T) | 0)] === 1);
  const fovMag = sol.fovW > 30 ? 3.2 : sol.fovW > 10 ? 4.5 : 6;          // fewer names on a wide view
  for (const o of sky.objects) {
    if (o.key.startsWith('st:')) { if ((o.mag ?? 9) > fovMag || o.ra == null) continue; const p = projectStar(sol, w, h, o.ra, o.dec); if (inside(p)) out.push({ ...p, text: o.label, kind: 'star', mag: o.mag }); }
    else if (o.key.startsWith('dso:') && /^(M\d|Caldwell)/.test(o.label) && o.ra != null) { const p = projectStar(sol, w, h, o.ra, o.dec); if (inside(p)) out.push({ ...p, text: o.name && o.name !== o.label && o.name.length < 22 ? `${o.label} ${o.name}` : o.label, kind: 'dso', mag: o.mag ?? 8 }); }
    else if (o.planet) { try { const q = sky.raDecJ2000(o.id, when), p = projectStar(sol, w, h, q.ra, q.dec); if (inside(p)) out.push({ ...p, text: o.label, kind: 'star', mag: -3 }); } catch (e) { /* no position */ } }
  }
  // Keep the brightest few, and none so close to another that the names would overlap.
  out.sort((a, b) => a.mag - b.mag); const kept = [], gap = w / 14;
  for (const L of out) { if (kept.length >= 24) break; if (kept.every((k) => Math.hypot(k.x - L.x, k.y - L.y) > gap)) kept.push(L); }
  return kept;
}
/** Save the stacked picture: plain, or with the markings and names plus a caption. To Photos in the iPhone app,
 *  otherwise through the share sheet or a download. */
async function savePicture(marked) {
  const r = camLast; if (!r) return;
  const c = document.createElement('canvas'); drawResult(c, r, camBore(), marked ? { labels: camLabels(r), stripes: false } : { clean: true });
  let out = c;
  if (marked) {
    const sol = r.sol, fs = Math.max(14, Math.round(r.w / 40)), lines = [`Skyward Push-To · ${new Date(r.when || Date.now()).toLocaleString()}`,
      sol ? `RA ${raHms(sol.ra)}, Dec ${sol.dec.toFixed(1)}° · ${sol.fovW.toFixed(0)}° × ${sol.fovH.toFixed(0)}° · ${sol.n} of ${sol.of} stars recognised` : 'Not recognised',
      `${r.collected.toFixed(1)} s of light in ${r.N} frame${r.N === 1 ? '' : 's'}`];
    out = document.createElement('canvas'); out.width = c.width; out.height = c.height + Math.round(fs * 1.5 * lines.length + fs);
    const x = out.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, out.width, out.height); x.drawImage(c, 0, 0);
    x.fillStyle = '#d8dcf0'; x.font = `${fs}px system-ui, -apple-system, sans-serif`; x.textBaseline = 'top';
    lines.forEach((l, i) => x.fillText(l, fs * 0.6, c.height + fs * 0.5 + i * fs * 1.5));
  }
  const stamp = new Date(r.when || Date.now()).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const name = `skyward-${stamp}${marked ? '-labelled' : ''}.png`;
  const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
  try {
    const sc = cap('SkyCam');
    if (sc) {
      const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
      await sc.savePhoto({ data: b64 }); toast('Saved to Photos'); return;
    }
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Skyward camera picture' }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { if (!(e && e.name === 'AbortError')) toast('Could not save: ' + (e.message || e), 5000); }
}
function camStars(sol) {
  if (!camLast) return []; const { w, h } = camLast, b = camBore(), bx = w / 2 + sol.f * b[0] / b[2], by = h / 2 + sol.f * b[1] / b[2], out = [];
  for (const o of sky.objects) {
    if (!o.key.startsWith('st:') || (o.mag ?? 9) > 3.2 || o.ra == null) continue;
    const p = projectStar(sol, w, h, o.ra, o.dec); if (!p || p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
    out.push({ name: o.label, x: p.x, y: p.y, d: Math.hypot(p.x - bx, p.y - by) });
  }
  return out.sort((a, c) => a.d - c.d).slice(0, 12);
}
// ---- Collimating with the laser (Build 88). Drawings are made here; the photos of the screws and knobs are from the
// Skyward 150 build manual (original design). Steps follow the usual laser method: secondary first (the dot onto the
// primary's centre ring), then the primary (the return beam into the laser's centre hole), repeat, then a star test.
function collimSVG(kind) {
  const ring = (cx, cy, r, c, w = 2, o = 1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="${w}" opacity="${o}"/>`;
  const dot = (cx, cy, r = 5) => `<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="#ff3030" opacity="0.25"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ff3030"/>`;
  const lab = (x, y, s, c = '#c9cff0') => `<text x="${x}" y="${y}" fill="${c}" font-size="13" text-anchor="middle">${s}</text>`;
  if (kind === 'primary-view') {          // looking down the front of the tube at the big mirror
    const one = (cx, ok) => `<circle cx="${cx}" cy="78" r="62" fill="#20263f" stroke="#8a93c9" stroke-width="3"/>
      <rect x="${cx - 62}" y="75" width="124" height="6" fill="#3a4266"/><rect x="${cx - 3}" y="16" width="6" height="124" fill="#3a4266"/>
      <circle cx="${cx}" cy="78" r="17" fill="#3a4266"/>${ring(cx, 78, 7, '#fff', 2.5)}${dot(ok ? cx : cx + 22, ok ? 78 : 64, 4)}
      ${lab(cx, 166, ok ? '✓ dot in the ring' : '✗ dot beside the ring', ok ? '#7ee0a0' : '#ffb0a0')}`;
    return `<svg class="finderart" viewBox="0 0 340 176" role="img" aria-label="The big mirror seen down the front of the tube: the red dot should land in the small centre ring">${one(86, false)}${one(254, true)}</svg>`;
  }
  if (kind === 'target') {                // the laser's own target face, where the beam comes back
    const one = (cx, ok) => `<circle cx="${cx}" cy="78" r="58" fill="#e9e6dc" stroke="#8a93c9" stroke-width="3"/>
      ${ring(cx, 78, 40, '#9a958a', 1.5)}${ring(cx, 78, 22, '#9a958a', 1.5)}<circle cx="${cx}" cy="78" r="4.5" fill="#222"/>
      ${ok ? `<circle cx="${cx}" cy="78" r="9" fill="#ff3030" opacity="0.3"/>` : dot(cx - 20, 92, 4)}
      ${lab(cx, 166, ok ? '✓ back in the hole' : '✗ spot off centre', ok ? '#7ee0a0' : '#ffb0a0')}`;
    return `<svg class="finderart" viewBox="0 0 340 176" role="img" aria-label="The laser's target face: the returning spot should go back into the centre hole">${one(86, false)}${one(254, true)}</svg>`;
  }
  // star test: a bright star slightly out of focus
  const one = (cx, ok) => `<rect x="${cx - 64}" y="14" width="128" height="128" rx="10" fill="#05070f"/>
    ${[22, 16, 10].map((r, i) => ring(cx + (ok ? 0 : 6 - 2 * i), 78 + (ok ? 0 : 3 - i), r, '#fff', 2, 0.55 + 0.15 * i)).join('')}
    <circle cx="${cx + (ok ? 0 : 9)}" cy="${78 + (ok ? 0 : 5)}" r="6" fill="#05070f"/>
    ${lab(cx, 166, ok ? '✓ rings centred' : '✗ rings lopsided', ok ? '#7ee0a0' : '#ffb0a0')}`;
  return `<svg class="finderart" viewBox="0 0 340 176" role="img" aria-label="A bright star slightly out of focus: the rings should be centred">${one(86, false)}${one(254, true)}</svg>`;
}
// ---------------------------------------------------------------- telescope simulator
// Any telescope (50–3000 mm focal length, f/2–f/20) with any eyepiece, under any sky. Every effect the eyepiece
// pictures use has a slider or a switch, with the numbers that matter shown beside the picture.
const SIM_TARGETS = ['M42', 'M13', 'M31', 'M57', 'M45', 'M51', 'M27', 'Jupiter', 'Saturn', 'Albireo', 'Mizar', 'Polaris', 'Tegmen'];
const BORTLE_SQM = [0, 22.0, 21.94, 21.79, 21.09, 19.99, 19.22, 18.66, 18.09, 17.5];      // middle of each class (bortleOf)
const logPos = (v, lo, hi) => Math.round(1000 * Math.log(v / lo) / Math.log(hi / lo)), logVal = (p, lo, hi) => lo * (hi / lo) ** (p / 1000);
function simState() {
  if (!state.sim) {
    const P = profile(), e = P.eyepieces.reduce((a, x) => (x.fl > a.fl ? x : a), P.eyepieces[0]);
    state.sim = { fl: P.fl, N: +(P.fl / P.aperture).toFixed(1), ep: e.fl, afov: e.afov || 62, target: 'M42', bortle: (mapSky() || {}).bortle || 5,
      moon: 0, moonSep: 90, sun: -18, transp: 3, alt: 60, seeing: 1.5, pupil: 7, f: {} };
  }
  return state.sim;
}
/** Start the simulator from a real view: this target, this scope and eyepiece, tonight's conditions. */
function simFrom(o, P, e) {
  const S = simState(), m = sky.moonInfo(), tg = sky.altAz(o);
  Object.assign(S, { fl: P.fl, N: +(P.fl / P.aperture).toFixed(1), ep: e.fl, afov: e.afov || 62, target: o.key, type: P.type || null,
    bortle: skyQ() ? bortleOfNelm(checkNelm()) : (mapSky() || {}).bortle || S.bortle, moon: m.alt > 0 ? Math.round(m.frac * 100) : 0,
    alt: Math.max(5, Math.round(tg.alt)), seeing: { poor: 2.5, average: 1.5, good: 1.0 }[seeingNow()] });
  save();
}
const simObj = (t) => objByKey(t) || sky.objects.find((o) => o.label === t || (o.cats || []).includes(t) || o.id === t);
function renderSim() {
  const el = $('#tab-sim'), S = simState(), o = simObj(S.target) || simObj('M42');
  const opt = SIM_TARGETS.map((t) => simObj(t)).filter(Boolean);
  if (o && !opt.includes(o)) opt.unshift(o);
  // Each slider keeps its explanation behind an ⓘ, so the sliders sit close under the view.
  const SL = (id, label, min, max, step, val, help) => `<div class="simrow"><span><b>${label}</b><button type="button" class="hintbtn" data-hint aria-label="What is ${esc(label)}?">i</button><span id="${id}-v" class="num"></span></span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${esc(label)}"><span class="muted small hint">${help}</span></div>`;
  // The view stays pinned at the top while the sliders scroll under it.
  const side = Math.max(150, Math.min(window.innerWidth - 32, 440, Math.round(window.innerHeight * 0.3))), dpr = Math.min(3, window.devicePixelRatio || 1);
  el.innerHTML = `${BACK}<h2>Telescope simulator</h2>
    <label class="row"><span>Target</span><select id="sm-t">${opt.map((x) => `<option value="${esc(x.key)}" ${x === o ? 'selected' : ''}>${esc(x.label)}${x.name ? ' · ' + esc(x.name) : ''}</option>`).join('')}</select></label>
    <div class="seg advseg" role="group" aria-label="Controls"><button data-adv="0">Basic</button><button data-adv="1">Advanced</button></div>
    <p class="muted small" style="margin:0 0 4px">Move a slider and watch the view; the view stays put while you scroll. Tap <span class="hintbtn" aria-hidden="true">i</span> for what a slider does.</p>
    <div class="simdock"><div class="simview"><canvas id="sm-cv" width="${Math.round(side * dpr)}" height="${Math.round(side * dpr)}" style="width:${side}px;height:${side}px"></canvas></div>
    <p class="simsum" id="sm-sum"></p><p class="muted small" id="sm-note" style="text-align:center;margin:0"></p></div>
    <h3>Telescope</h3>
    ${SL('sm-fl', 'Focal length', 0, 1000, 1, logPos(S.fl, 50, 3000), 'Longer gives more power with the same eyepiece.')}
    ${SL('sm-n', 'Focal ratio', 2, 20, 0.1, S.N, 'Focal length ÷ aperture. Fast (small number) means wide fields and more coma; it does not make images brighter by itself.')}
    <h3>Eyepiece</h3>
    ${SL('sm-ep', 'Eyepiece focal length', 0, 1000, 1, logPos(S.ep, 2, 56), 'Shorter gives more power and a smaller, dimmer view.')}
    <div class="adv">${SL('sm-af', 'Apparent field', 30, 120, 1, S.afov, 'How wide the eyepiece looks: about 50° for a Plössl, 82–100° for wide-angles.')}</div>
    <h3>Sky and air</h3>
    ${SL('sm-b', 'Light pollution', 1, 9, 1, S.bortle, 'Bortle 1 is pristine; 9 is a city centre.')}
    ${SL('sm-m', 'Moon', 0, 100, 1, S.moon, '0 = no Moon up. Percent lit, with the Moon 40° up.')}
    <div class="adv">${SL('sm-ms', 'Moon distance from the target', 5, 180, 1, S.moonSep, 'Moonlight is worst close to the Moon.')}
    ${SL('sm-tr', 'Transparency', 1, 5, 1, S.transp, 'Haze, from Environment Canada\'s 1–5 scale (3 = medium).')}
    ${SL('sm-alt', 'Target altitude', 5, 90, 1, S.alt, 'Low down you look through more air: everything dims.')}
    ${SL('sm-se', 'Seeing', 0.5, 5, 0.1, S.seeing, 'How much the air smears a star, in arcseconds: 1″ is a steady night, 3″+ a shimmering one.')}
    ${SL('sm-pu', 'Your eye\'s pupil', 3, 8, 0.5, S.pupil, 'About 7 mm when young, closer to 5 mm by 60–70. A bigger exit pupil than this is wasted light.')}
    <h3>Effects</h3>
    <div class="chips wrap" id="sm-f">${EP_FACTORS.map(([k, l]) => `<button data-f="${k}">${l}</button>`).join('')}</div>
    <p class="muted small">Switch an effect off to see its share; all off is a perfect night (dark sky, still air, sharp optics).</p>
    <div class="btnrow"><button class="mini" id="sm-all">All on</button><button class="mini" id="sm-none">All off: perfect night</button></div></div>
    <div class="btnrow"><button class="mini" id="sm-mine">Use my telescope</button></div>
    <h3>The numbers</h3><div class="kv" id="sm-stats"></div>`;
  const setAdv = (on) => { state.ui = state.ui || {}; state.ui.adv = on; save(); el.classList.toggle('show-adv', on); el.querySelectorAll('[data-adv]').forEach((b) => b.classList.toggle('on', (b.dataset.adv === '1') === on)); redraw(); };
  bindBack(el);
  const fmt = (x, d = 0) => (+x).toFixed(d);
  const draw = () => {
    const tgt = simObj(S.target) || o; if (!tgt) return;
    const adv = !!(state.ui && state.ui.adv);
    const D = S.fl / S.N, M = S.fl / S.ep, exit = D / M, tf = S.afov / M, dawes = 116 / D, f = { ...Object.fromEntries(EP_FACTORS.map(([k]) => [k, true])), ...(adv ? S.f : {}) };
    const nelm = sqmToNelm(BORTLE_SQM[S.bortle]);
    const env = { nelm, moonCd: S.moon > 0 ? moonlight({ moonAlt: 40, moonFrac: S.moon / 100, sepDeg: S.moonSep, targetAlt: S.alt }) : 0, twiCd: 0,   // the simulator always shows full dark (Sun 18° or more below the horizon), whatever the time of day (Build 119)
      transpAdj: transpAdj(S.transp), seeingArc: S.seeing, alt: S.alt, pupil: S.pupil };
    const scope = { aperture: D, fl: S.fl, type: S.type || null, eyepieces: [{ name: `${fmt(S.ep, 1)} mm`, fl: S.ep, afov: S.afov }] };
    let r = null;
    try { r = drawEyepiece($('#sm-cv'), sky, tgt.pairs && tgt.key.startsWith('st:') ? { ...tgt, t: 'DS' } : tgt, sky.altAz(tgt), scope.eyepieces[0], scope, { bright: vis(), env, factors: f, date: new Date(), afovScale: 110 }); } catch (e) { console.error(e); }
    $('#sm-note').textContent = r && r.note ? r.note : '';
    const coma = 3 * (tf / 2) / (16 * S.N * S.N) * 3600;                 // arcseconds at the field edge
    const used = Math.min(exit, S.pupil), bright = (used / 7) ** 2 * 100;
    const reach = nelm + (f.transp ? transpAdj(S.transp) : 0) + 5 * Math.log10(D / 7) - 1;
    $('#sm-stats').innerHTML = [
      ['Aperture (main objective diameter)', `${fmt(D)} mm (${fmt(D / 25.4, 1)}″)`],
      ['Magnification', `${fmt(M)}×${M > 2 * D ? ' — past the useful limit' : M < D / S.pupil ? ' — below the useful minimum' : ''}`],
      ['Useful power', `${fmt(D / S.pupil)}× to about ${fmt(2 * D)}×`],
      ['Exit pupil', `${fmt(exit, 1)} mm${exit > S.pupil ? ' — wider than your eye, light wasted' : ''}`],
      ['True field', tf >= 1 ? `${fmt(tf, 2)}°` : `${fmt(tf * 60)}′`],
      ['Glow brightness', `${fmt(bright)}% of the naked-eye view`],
      ['Dawes limit', `${fmt(dawes, 2)}″${S.seeing > dawes ? ` — the air (${fmt(S.seeing, 1)}″) limits you first` : ''}`],
      ['Faintest stars', `about magnitude ${fmt(reach, 1)}`],
      ['Coma at the edge', `${fmt(coma)}″ (${fmt(coma * M / 60, 1)}′ as seen)${coma * M / 60 > 2 ? ' — a coma corrector helps' : ''}`],
    ].slice(0, adv ? 99 : 5).map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
    $('#sm-sum').textContent = `${fmt(D)} mm f/${fmt(S.N, 1)} · ${fmt(M)}× · exit pupil ${fmt(exit, 1)} mm · field ${tf >= 1 ? fmt(tf, 2) + '°' : fmt(tf * 60) + '′'}${M > 2 * D ? ' · too much power' : exit > S.pupil ? ' · wider than your eye' : ''}`;
    const vals = { 'sm-fl': `${fmt(S.fl)} mm`, 'sm-n': `f/${fmt(S.N, 1)}`, 'sm-ep': `${fmt(S.ep, 1)} mm`, 'sm-af': `${S.afov}°`, 'sm-b': `Bortle ${S.bortle}`, 'sm-m': S.moon ? `${S.moon}% lit` : 'none',
      'sm-ms': `${S.moonSep}°`, 'sm-tr': `${S.transp}/5`, 'sm-alt': `${S.alt}°`, 'sm-se': `${fmt(S.seeing, 1)}″`, 'sm-pu': `${fmt(S.pupil, 1)} mm` };
    for (const [id, v] of Object.entries(vals)) { const x = $('#' + id + '-v'); if (x) x.textContent = v; }
    el.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', f[b.dataset.f] !== false));
  };
  let pend = 0; const redraw = () => { if (!pend) pend = requestAnimationFrame(() => { pend = 0; draw(); }); };
  const bind = (id, key, conv = (v) => +v) => { $('#' + id).oninput = (e) => { S[key] = conv(e.target.value); redraw(); }; $('#' + id).onchange = () => save(); };
  bind('sm-fl', 'fl', (v) => Math.round(logVal(+v, 50, 3000))); bind('sm-n', 'N'); bind('sm-ep', 'ep', (v) => +logVal(+v, 2, 56).toFixed(1)); bind('sm-af', 'afov');
  bind('sm-b', 'bortle'); bind('sm-m', 'moon'); bind('sm-ms', 'moonSep'); bind('sm-tr', 'transp'); bind('sm-alt', 'alt'); bind('sm-se', 'seeing'); bind('sm-pu', 'pupil');
  $('#sm-t').onchange = (e) => { S.target = e.target.value; save(); redraw(); };
  el.querySelectorAll('[data-hint]').forEach((b) => b.onclick = (e) => { e.preventDefault(); b.closest('.simrow').classList.toggle('open'); });
  el.querySelectorAll('[data-adv]').forEach((b) => b.onclick = () => setAdv(b.dataset.adv === '1'));
  el.classList.toggle('show-adv', !!(state.ui && state.ui.adv)); el.querySelectorAll('[data-adv]').forEach((b) => b.classList.toggle('on', (b.dataset.adv === '1') === !!(state.ui && state.ui.adv)));
  el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { S.f = { ...S.f, [b.dataset.f]: S.f[b.dataset.f] === false }; save(); redraw(); });
  $('#sm-all').onclick = () => { S.f = {}; save(); redraw(); };
  $('#sm-none').onclick = () => { S.f = Object.fromEntries(EP_FACTORS.map(([k]) => [k, false])); save(); redraw(); };
  $('#sm-mine').onclick = () => { const P = profile(), e = P.eyepieces.reduce((a, x) => (x.fl > a.fl ? x : a), P.eyepieces[0]); S.fl = P.fl; S.N = +(P.fl / P.aperture).toFixed(1); S.ep = e.fl; S.afov = e.afov || 62; S.type = P.type || null; save(); renderSim(); };
  draw();
}
function renderCollim() {
  const el = $('#tab-collim'), P = profile(), fr = Math.round(P.fl / P.aperture * 2) / 2;
  if (P.type === 'refractor') { el.innerHTML = `${BACK}<h2>Collimation</h2><p>Your ${esc(P.name)} is a refractor: its lenses are aligned at the factory and held in a fixed cell, so there is nothing to collimate. If stars ever look like little comets at the centre of the field, the lens cell has been knocked and the maker should look at it.</p>`; bindBack(el); return; }
  if (P.type === 'sct') { el.innerHTML = `${BACK}<h2>Collimation</h2><p>Your ${esc(P.name)} is a Schmidt-Cassegrain or Maksutov. A Maksutov is set at the factory and rarely needs it. A Schmidt-Cassegrain is collimated with the three small screws on the front (secondary) mirror while watching a defocused star at high power, which is a different method from the laser steps here: follow the maker's manual.</p>`; bindBack(el); return; }
  el.innerHTML = `${BACK}<h2>${state.active.startsWith('sw') ? 'Collimate your Skyward' : 'Collimate your telescope'}</h2>
    <p>Collimating lines up the two mirrors so stars come to a sharp point. With the laser it takes about ten minutes, indoors or out. ${fr <= 4.5 ? `Your ${esc(P.name)} is f/${fr}: fast mirrors show small errors, so check it every time you set up.` : 'Check it every few sessions, and after the telescope has been bumped or moved in a car.'}</p>
    <div class="card"><b>Before you start</b>
      <ul class="small" style="margin:6px 0 0 18px;padding:0">
        <li><b>Never look into the laser beam</b>, or at its reflection in the mirrors. Look at where the dot lands. Switch the laser off between steps.</li>
        <li>Point the tube level, so nothing you drop can land on the big mirror.</li>
        <li>Slide the laser into the focuser and tighten the thumbscrew gently: the same way every time.</li>
        <li>The laser method aims for the small ring marked in the centre of the big (primary) mirror. If yours has none, get in touch before going further.</li>
      </ul></div>
    <div class="card"><div class="muted small">Step 1 of 3</div><b style="font-size:18px">The small mirror: dot into the ring</b>
      <p class="small">Switch the laser on. Look down the <b>front</b> of the tube at the big mirror at the bottom. The red dot should sit inside the small centre ring.</p>
      ${collimSVG('primary-view')}
      <p class="small">If it doesn't, adjust the small (secondary) mirror with the <b>three small screws</b> around the centre of its holder, in the middle of the spider. Make small turns: loosen one a little, then tighten the other two, until the dot moves into the ring. Keep the screws snug at the end.</p>
      <img class="findermount" src="img/secondary-screws.png" alt="The three adjusting screws in the centre of the secondary holder">
      <p class="muted small" style="text-align:center;margin:0">The secondary holder’s three screws (from the Skyward 150 build manual).</p></div>
    <div class="card"><div class="muted small">Step 2 of 3</div><b style="font-size:18px">The big mirror: spot back into the hole</b>
      <p class="small">Now look at the laser’s own <b>target face</b>, the angled window on its side. The beam comes back from the big mirror and makes a spot there. It should go back into the centre hole.</p>
      ${collimSVG('target')}
      <p class="small">If it doesn't, turn the <b>knobs at the back</b> of the telescope, behind the big mirror. They come in pairs: one adjusts, the other locks. Loosen the locks a little, turn the adjusting knobs until the spot goes into the hole, then tighten the locks gently and check the spot didn’t move.</p>
      <img class="findermount" src="img/primary-knobs.jpg" alt="The pairs of knobs at the back of the telescope that tilt the big mirror" style="background:none">
      <p class="muted small" style="text-align:center;margin:0">The knobs behind the big mirror (Skyward 150 build manual; your model may look a little different).</p></div>
    <div class="card"><div class="muted small">Step 3 of 3</div><b style="font-size:18px">Check both again</b>
      <p class="small">Adjusting the big mirror can move the dot from step 1 a little. Go back and forth between steps 1 and 2 until both hold without changes, usually two or three rounds.</p>
      <p class="small"><b>If the dot draws a small circle</b> when you turn the laser in the focuser, the laser itself is off. Adjust it as its instructions say, or turn it so the dot sits in the middle of that circle and use that position every time.</p>
      <label class="row"><span>Collimated today</span><input type="checkbox" id="co-done" ${P.collimated && new Date(P.collimated).toDateString() === new Date().toDateString() ? 'checked' : ''}></label></div>
    <details class="more"><summary>At night: check on a star (optional)</summary>
      <p class="small">The laser gets you close. A star shows what is left. Let the telescope cool for half an hour. Centre a bright star high in the sky, use your highest-power eyepiece (the 4 mm), and turn the focuser so the star is slightly out of focus. The rings should be centred, like a target.</p>
      ${collimSVG('star')}
      <p class="small">If the rings are lopsided, make a tiny turn of one adjusting knob at the back, re-centre the star, and look again. Better? Keep going a little. Worse? Turn it back and try another knob. Small steps, re-centring each time.</p></details>`;
  bindBack(el);
  $('#co-done').onchange = (e) => { if (e.target.checked) { P.collimated = Date.now(); toast('Noted: collimated today'); } else delete P.collimated; save(); };
}

// ---- Red-dot finder: drawings and instructions shared by the star alignment and the camera line-up
/** Left: the view through a red-dot finder with the dot on the star, and its two knobs. Right: the same star in the
 *  middle of the eyepiece. */
function finderArtSVG(name) {
  const n = esc(name), st = (x, y, r, o = 1) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`;
  return `<svg class="finderart" viewBox="0 0 360 190" role="img" aria-label="Red dot on ${n} in the finder; ${n} in the middle of the eyepiece">
    <g transform="translate(90,92)">
      <circle r="60" fill="#0b1030" stroke="#8a93c9" stroke-width="3"/>
      ${st(-34, -22, 1.4, 0.7)}${st(30, 30, 1.2, 0.7)}${st(-18, 38, 1, 0.6)}${st(36, -34, 1, 0.6)}${st(10, -8, 3.4)}
      <circle cx="10" cy="-8" r="6.5" fill="none" stroke="#ff4040" stroke-width="2.5"/><circle cx="10" cy="-8" r="2.2" fill="#ff4040"/>
      <rect x="-9" y="-78" width="18" height="12" rx="3" fill="#8a93c9"/><text x="16" y="-68" fill="#c9cff0" font-size="12">↕ knob</text>
      <rect x="64" y="-9" width="12" height="18" rx="3" fill="#8a93c9"/><text x="70" y="26" fill="#c9cff0" font-size="12" text-anchor="middle">↔ knob</text>
    </g>
    <text x="90" y="182" fill="#c9cff0" font-size="13" text-anchor="middle">Red-dot finder</text>
    <g transform="translate(270,92)">
      <circle r="60" fill="#0b1030" stroke="#8a93c9" stroke-width="3"/>
      ${st(-26, 30, 1.4, 0.7)}${st(34, -20, 1.2, 0.7)}${st(-40, -18, 1, 0.6)}${st(0, 0, 5)}
      <circle r="60" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="10"/>
    </g>
    <text x="270" y="182" fill="#c9cff0" font-size="13" text-anchor="middle">Eyepiece: in the middle</text>
  </svg>`;
}
/** The finder steps for a named star, with the drawings. `open`: start expanded. `check`: id of an "I set it" box. */
function finderHowHTML(name, open, check) {
  const n = esc(name);
  return `<details class="finderbox" ${open ? 'open' : ''}><summary>Use the red-dot finder to get ${n} in the eyepiece</summary>
    ${finderArtSVG(name)}
    <ol class="small">
      <li><b>Finder already lined up?</b> Put the red dot on ${n}. It should then be in the eyepiece: centre it.</li>
      <li><b>Not lined up, or not sure?</b> With your lowest-power eyepiece, sweep slowly until ${n} shows up and centre it. Then, without moving the telescope, turn the finder’s two knobs (one moves the dot up and down, the other side to side) until the dot sits on ${n}.</li>
      <li><b>Look again.</b> Turning the knobs can nudge the telescope: re-centre ${n} in the eyepiece if it moved.</li>
    </ol>
    <img class="findermount" src="img/finder-mount.png" alt="The red-dot finder on its mount on top of the tube">
    <p class="muted small" style="text-align:center;margin:0">The finder on its mount (from the Skyward build manual). Lining it up is easiest on the Moon or a bright planet, or in daylight on a far-off treetop.</p>
    ${check ? `<label class="row"><span>I set the red-dot finder on ${n}</span><input type="checkbox" id="${check}"></label>` : ''}
  </details>`;
}

// ---- Lining up: camera, telescope and red-dot finder, all on one star
// 1. a rough fix tells the app which bright star the telescope is near; 2. the user gets that star into the eyepiece
// with the red-dot finder (or lines the finder up on it, if it was off); 3. with the star re-checked in the middle of the
// eyepiece, another fix: where the star sits in that picture is where the eyepiece looks (the camera line-up), and the
// same fix aligns the pointing; 4. one more fix elsewhere finishes the alignment (unless one is enough).
// The finder comes before the picture because it is how the star gets into the eyepiece, and because turning its knobs
// can nudge the telescope: the picture is taken after the last nudge.
let camWiz = null;   // { step: 'start' | 'finder' | 'shoot' | 'second' | 'done', star: { key, name, ra, dec } }
/** The bright star the telescope is most likely nearest: close to the telescope mark, and bright. */
function wizPick(sol) {
  const { w, h } = camLast, b = camBore(), bx = w / 2 + sol.f * b[0] / b[2], by = h / 2 + sol.f * b[1] / b[2]; let best = null;
  for (const o of sky.objects) {
    if (!o.key.startsWith('st:') || (o.mag ?? 9) > 2.5 || o.ra == null) continue;
    const p = projectStar(sol, w, h, o.ra, o.dec); if (!p || p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
    const off = Math.atan(Math.hypot(p.x - bx, p.y - by) / sol.f) * R2D; if (off > 15) continue;
    const score = off + 4 * (o.mag ?? 2);
    if (!best || score < best.score) best = { key: o.key, name: o.label, ra: o.ra, dec: o.dec, off, score };
  }
  return best;
}
/** Where a star is in the current picture, or null. */
function wizWhere(sol, s) {
  if (!camLast || !s) return null; const { w, h } = camLast, p = projectStar(sol, w, h, s.ra, s.dec);
  return p && p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h ? p : null;
}
/** A camera fix taken while lining up. Returns the sentence shown with the result. */
function wizardFix(r, refR) {
  const sol = r.sol, W = camWiz;
  if (W.step === 'start' || W.step === 'shoot') {
    if (W.step === 'shoot' && W.star) {
      const p = wizWhere(sol, W.star);
      if (!p) return `${W.star.name} is not in this picture. Centre ${W.star.name} in the eyepiece and try again, or tap “Pick another star”.`;
      const x = (p.x - r.w / 2) / sol.f, y = (p.y - r.h / 2) / sol.f, off = Math.atan(Math.hypot(x, y)) * R2D;
      if (off > 15) return `${W.star.name} is ${off.toFixed(0)}° from the middle of the picture: too far to be the star in the eyepiece. Is the right star centred? Nothing was changed.`;
      const l = Math.hypot(x, y, 1); profile().camBore = [x / l, y / l, 1 / l]; save();
      // Earlier camera fixes assumed the old line-up, so the alignment starts again from this one.
      align = { obs: [], fit: null, syncs: [], confirm: [] }; model.rate = 0;
      const a = applyCameraFix(sol, refR);
      W.step = alignedNow() ? 'done' : 'second'; if (W.step === 'done') { cue.onTarget(); flowStepDone('align'); }
      return `Camera lined up: the eyepiece looks ${off.toFixed(1)}° from the middle of the camera’s picture. ${a}`;
    }
    const s = wizPick(sol);
    if (!s) return 'No bright star near where the telescope points. Aim at one of the brightest stars you can see and take another picture.';
    W.star = s; W.step = 'finder';
    return `The telescope is near ${s.name} (circled). Next: get it into the eyepiece.`;
  }
  // Second part of the sky (or a later check): an ordinary camera fix.
  const a = applyCameraFix(sol, refR);
  if (alignedNow()) W.step = 'done';
  return a;
}
function wizardHTML(along) {
  if (!along) return '';
  const W = camWiz, cal = profile().camBore, fin = profile().finder;
  if (!W) return `<div class="card"><b>${cal ? 'Camera, telescope and finder' : 'Line up the camera, telescope and red-dot finder'}</b>
    <p class="muted small" style="margin:4px 0 8px">${cal ? `Lined up${fin ? `, finder set on ${esc(fin.star)} ${new Date(fin.t).toLocaleDateString()}` : ''}. Do it again if the phone or finder was moved.` : 'Once per setup, about two minutes: one bright star makes all three point at the same place, and aligns the pointing at the same time.'}</p>
    <div class="btnrow"><button id="wiz-go" class="${cal ? '' : 'primary'}">${cal ? 'Line up again' : 'Start lining up'}</button></div></div>`;
  const S = W.star ? esc(W.star.name) : 'the star';
  const steps = {
    start: ['1 of 4', 'Point the telescope at a bright star', 'Aim roughly at one of the brightest stars you can see — sighting along the tube is fine. Then tap <b>Find where I’m pointing</b>.'],
    finder: ['2 of 4', `Get ${S} in the eyepiece`, `${S} is circled in the picture below.${W.star ? finderHowHTML(W.star.name, true, '') : ''}`],
    shoot: ['3 of 4', `Check ${S} is centred, then take the picture`, `Look in the eyepiece once more: ${S} should be in the middle (re-centre it if the finder’s knobs nudged the telescope). Keep the telescope still and tap <b>It’s centred</b>. Where ${S} lands in the camera’s picture is where the eyepiece looks.`],
    second: ['4 of 4', 'One more part of the sky', 'Swing the telescope a quarter turn or more to another part of the sky, hold it still and tap <b>Find where I’m pointing</b>. Any stars will do.'],
    done: ['Done', 'All three agree', `The camera, the eyepiece${fin ? ' and the red-dot finder' : ''} point at the same place, and the arrows are aligned. The green cross in each picture is where the eyepiece looks. Check now and then with any star: centre it, take a picture, and the pointing re-syncs.`]
  }[W.step];
  return `<div class="card" style="border-color:var(--hi)"><div class="muted small">Lining up · step ${steps[0]}</div><b style="font-size:18px">${steps[1]}</b>
    <div class="small" style="margin:4px 0 8px">${steps[2]}</div>
    ${W.step === 'finder' ? `<div class="btnrow"><button id="wiz-fin" class="primary">It’s centred and the dot is on it</button><button id="wiz-nofin">It’s centred — no finder</button></div>` : ''}
    <div class="btnrow">${W.step === 'finder' || W.step === 'shoot' ? '<button id="wiz-other">Pick another star</button>' : ''}<button id="wiz-stop">${W.step === 'done' ? 'Close' : 'Stop lining up'}</button></div></div>`;
}
function wireWizard() {
  if ($('#wiz-go')) $('#wiz-go').onclick = () => { camWiz = { step: 'start', star: null }; camLast = null; camNote = ''; renderCamera(); };
  if ($('#wiz-stop')) $('#wiz-stop').onclick = () => { camWiz = null; renderCamera(); };
  if ($('#wiz-other')) $('#wiz-other').onclick = () => { camWiz = { step: 'start', star: null }; camNote = 'Aim at a different bright star and take another picture.'; renderCamera(); };
  const fin = (has) => {
    const W = camWiz; if (has) { profile().finder = { star: W.star ? W.star.name : '', t: Date.now() }; save(); toast('Red-dot finder set'); }
    W.step = 'shoot'; renderCamera();
  };
  if ($('#wiz-fin')) $('#wiz-fin').onclick = () => fin(true);
  if ($('#wiz-nofin')) $('#wiz-nofin').onclick = () => fin(false);
}
function brightestNamedNear(sol) {
  const t = camTruth(sol); let best = null;
  for (const o of sky.objects) { if (!o.key.startsWith('st:') || (o.mag ?? 9) > 2.6 || o.ra == null) continue; const d = sepDeg(t.dec, t.ra, o.dec, o.ra); if (!best || d < best.d) best = { d, name: o.label }; }
  return best;
}
async function renderCameraLive() {
  try {
    const plug = nativeCam();
    if (plug) { skyCam = new NativeSkyCamera(plug, null, null); skyCam.start = state.camGood || null; }
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
// While the camera collects light: a window of its own over the whole screen, with the live picture, what is
// happening, a progress bar and "Stop and use what I have" (finishes with the light so far and still solves).
// The camera's picture element is moved into the window for the duration, then the screen is redrawn as usual.
let camStop = false;
function camFloat(on) {
  let f = $('#cam-float');
  if (!on) { if (f) f.remove(); document.body.classList.remove('camwin-open'); return; }
  if (f) return;
  f = document.createElement('div'); f.id = 'cam-float'; f.className = 'camwin';
  f.innerHTML = `<div class="camwin-box"><b class="camwin-title">Collecting starlight</b>
    <div class="muted small">Keep the telescope still · up to ${state.camLight || 3} s of light</div>
    <div id="camf-stage" class="camwin-stage"></div>
    <div id="camf-text" class="small">Starting…</div><div class="hzbar"><i id="camf-bar" style="width:0"></i></div>
    <button id="camf-stop">Stop and use what I have</button></div>`;
  document.body.appendChild(f); document.body.classList.add('camwin-open');
  const st = $('#tab-camera .camstage'); if (st) { $('#camf-stage').appendChild(st); const v = st.querySelector('video'); if (v && v.play) v.play().catch(() => {}); }
  $('#camf-stop').onclick = () => { camStop = true; $('#camf-stop').disabled = true; $('#camf-text').textContent = 'Finishing with the light collected so far…'; };
}
async function cameraFind() {
  if (!skyCam || !skyCam.on) return; const go = $('#cam-go'); if (go) go.disabled = true;
  camStop = false; camFloat(true);
  const here = pointing(), prior = here && here.ready && alignedNow() ? { ...altAzToJ2000(sky, here.alt, here.az), radius: 25 } : null;
  try {
    let refR = null;
    // The picture scale learned from an earlier fix with this camera (kept per picture size); none the first time.
    const camKey = () => skyCam && skyCam.v ? `${skyCam.isNative ? 'n' : 'w'}` : 'w', known = (state.camScale || {})[camKey()];
    const hp = (state.hotPix || {})[camKey()];
    const r = await skyCam.find({ FIELD: STAR_FIELD, prior, hot: hp ? hp.list : null, hotSize: hp ? { w: hp.w, h: hp.h } : null, scale: known ? { f: known.f, tol: 0.05, from: 'an earlier fix', w: known.w, h: known.h } : null, onReference: () => { refR = avgR(0.3) || (sensors && sensors.R) || null; }, align: !/[?&]noalign/.test(location.search), maxLight: state.camLight || 3, shouldStop: () => camStop,
      status: (t) => { for (const id of ['#cam-status', '#camf-text']) { const s = $(id); if (s && !(id === '#camf-text' && camStop)) s.textContent = t; } },
      progress: (f) => { for (const id of ['#cam-bar', '#camf-bar']) { const b = $(id); if (b) b.style.width = `${f * 100}%`; } } });
    if (!r) return;
    r.when = Date.now(); camLast = r; camErr = ''; if (skyCam && skyCam.good) { state.camGood = skyCam.good; save(); } camNote = r.sol ? (camWiz && camWiz.step !== 'done' ? wizardFix(r, refR) : applyCameraFix(r.sol, refR)) : '';
    // Learn hot pixels: unrecognised spots that stay on the same pixel while the sky moves. Only from confident fixes.
    { const same = hp && hp.w === r.w && hp.h === r.h, before = same ? hp.list.filter((e) => e.hot).length : 0; r.hotKnown = before;
      if (r.sol && r.sol.confidence === 'high') {
        const known = new Set(r.sol.matches.map((m) => `${Math.round(m.x)},${Math.round(m.y)}`)), spots = r.an.stars.filter((s) => !known.has(`${Math.round(s.x)},${Math.round(s.y)}`));
        const list = learnHot(same ? hp.list : [], spots, { ra: r.sol.ra, dec: r.sol.dec });
        r.hotNew = list.filter((e) => e.hot).length - before;
        state.hotPix = { ...(state.hotPix || {}), [camKey()]: { w: r.w, h: r.h, list } }; save();
      } }
    if (r.sol && r.sol.confidence === 'high') { state.camScale = { ...(state.camScale || {}), [camKey()]: { f: r.sol.f, w: r.w, h: r.h } }; save(); }
  } catch (e) {
    // Keep the error on screen (with what the camera was doing) so it can be read and copied, not just a passing toast.
    camLast = null; camErr = `Camera: ${e.message || e}` + (skyCam && skyCam.log && skyCam.log.length ? `\n\nWhat the camera was asked for:\n${skyCam.log.join('\n')}` : '');
    toast('Camera: ' + (e.message || e), 6000);
  } finally { camFloat(false); }
  if (tab === 'camera') { renderCamera(); const c = $('#cam-pic'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

// ---- Phone position picker: a small picture of each way the phone can sit on the tube ----
// Phone positions (Build 122): three pictures (on top, on the side, camera along the tube), a switch for which end
// the phone's top edge points to (on top / on the side only), and "across the tube" tucked under "Other ways".
// All seven positions in MOUNTINGS can be told to the app this way.
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
  const cur = state.mounting, end = cur.endsWith('mirror') ? 'mirror' : 'sky', flips = cur.startsWith('top') || cur.startsWith('side');
  const tile = (k) => { const v = MOUNTINGS[k]; return `<button class="mnt${k === cur ? ' on' : ''}" data-mount="${k}" aria-pressed="${k === cur}" aria-label="${esc(v.label)}">${mountSVG(k)}<b>${esc(v.where)}</b><span>${esc(v.edge)}</span></button>`; };
  const across = cur.startsWith('across');
  return `<div class="mnt-grid">${[`top-${end}`, `side-${end}`, 'camera'].map(tile).join('')}</div>
    ${flips ? `<div class="mnt-end"><span>Phone's top edge points to:</span><div class="chips">${[['sky', 'Sky end'], ['mirror', 'Mirror end']].map(([e, l]) => `<button data-end="${e}" class="${e === end ? 'on' : ''}" aria-pressed="${e === end}">${l}</button>`).join('')}</div>
      <p class="muted small" style="margin:2px 0 0">The app's screen doesn't rotate. At a Newtonian you stand at the sky end, so with the top edge to the mirror end the screen reads the right way up from the eyepiece.</p></div>` : ''}
    <details class="more mnt-other"${across ? ' open' : ''}><summary>Other ways</summary><div class="mnt-grid">${['across-left', 'across-right'].map(tile).join('')}</div></details>
    <p class="muted small">Looking at the tube with the sky end at the top. The little bar and the word “top” mark the phone's top edge. ${cur.startsWith('side') ? 'On the side, the round focuser is facing you.' : ''}</p>`;
}
function setMounting(k) {
  if (!MOUNTINGS[k] || k === state.mounting) return false;
  state.mounting = k;
  for (const pr of Object.values(state.profiles)) delete pr.cal;      // a remembered tilt belongs to the old position
  applyModelSettings(); align = { obs: [], fit: null, syncs: [], confirm: [] }; save(); return true;
}
function wireMountPicker(root, after) {
  root.querySelectorAll('.mnt').forEach((b) => { b.onclick = () => { const ch = setMounting(b.dataset.mount); after(ch); }; });
  // The end switch keeps the position (on top / on the side) and turns the phone round.
  root.querySelectorAll('[data-end]').forEach((b) => { b.onclick = () => { const base = state.mounting.split('-')[0]; after(setMounting(`${base}-${b.dataset.end}`)); }; });
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
  if (!siteKnown() && !locAsked && !state.locNever) { askLocation(dest); return; }
  if (dest !== 'plan' && dest !== 'explore' && !state.dock) { askDock(dest); return; }
  initSound();                                    // audio can only start from a tap
  state.seenIntro = true; state.welcomed = true;
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
  else if (k === 'seeing') openSeeingCheck();
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
const SKY_PICKS = [[3.5, 'Inner city (Bortle 9)'], [4.0, 'City (8)'], [4.5, 'Edge of city (7)'], [5.0, 'Bright suburbs (6)'], [5.5, 'Suburbs (5)'], [6.0, 'Rural-suburban (4)'], [6.5, 'Rural (3)'], [7.0, 'Dark site (1–2)']];
// [naked-eye limit saved, faintest star drawn as visible, title, caption]
const SKY_LEVELS = [
  [2.8, 2.6, 'Two stars', 'Only Polaris and Kochab'],
  [3.5, 3.2, 'Three stars', 'Polaris, Kochab and Pherkad'],
  [4.3, 4.4, 'Most of the dipper', 'The handle and bowl, with a gap or two'],
  [5.0, 5.0, 'The whole dipper', 'All seven stars'],
  [5.7, 5.8, 'The dipper and more', 'All seven, with faint stars around them'],
];
function skyLabel(m) {
  // Named by Bortle class, so the name always agrees with the "about Bortle N" shown beside it.
  const b = bortleOfNelm(m);
  return b >= 9 ? ['Inner-city sky', 'Moon, planets, bright clusters and double stars. Galaxies will be very hard.']
    : b === 8 ? ['City sky', 'Planets, bright clusters, globulars and double stars; a few bright nebulae and galaxies.']
    : b === 7 ? ['Edge-of-city sky', 'Planets, clusters, globulars, small planetary nebulae and the brightest galaxies.']
    : b === 6 ? ['Bright suburban sky', 'Most clusters and nebulae, and the brighter galaxies.']
    : b === 5 ? ['Suburban sky', 'Most of the Messier list, including some faint galaxies.']
    : b === 4 ? ['Rural-suburban sky', 'Most of the Messier list, including faint galaxies.']
    : b === 3 ? ['Rural sky', 'Faint galaxies and large nebulae — a great night.']
    : ['Dark sky', 'Faint galaxies, large nebulae and the Milky Way full of detail — a superb night.'];
}
/** Your sky: what the light-pollution map says here, your last check, and the 30-second check itself. */
function openSkyCheck() {
  const box = $('#skycheck'), card = $('#skycheck-card'); box.classList.remove('hidden');
  const show = (g) => {
    const here = g ? skyGlowAt(state.site.lat, state.site.lon, g) : null;
    card.innerHTML = `<h3 style="margin-top:0">Your sky</h3>
      <div class="whereline"><span class="muted small">${ICON.pin}${whereText()}</span><button id="sq-loc" class="mini">Update location</button></div>
      <div id="sq-lp">${g ? lightHereHTML(g, here) : '<p class="muted small">Loading the light-pollution map…</p>'}</div>
      ${sky.sunAlt() > -18 ? `<p class="small"><b>The darkness check needs a fully dark sky</b> (from about ${hm(sky.nightAt(new Date()).astro || sky.nightAt(new Date()).naut)}, when the Sun is 18° down). Before that, twilight hides faint stars and the result would read too bright. Until then the light-pollution map is used.</p>` : ''}
      <button id="sq-go" class="${sky.sunAlt() > -18 ? '' : 'primary'}" style="width:100%;margin-top:8px">${state.skyq ? 'Check again (30 seconds)' : 'Do the 30-second darkness check'}${sky.sunAlt() > -18 ? ' anyway' : ''}</button>
      <button id="sq-close" style="width:100%;margin-top:6px">${flow ? 'Skip' : 'Close'}</button>`;
    if (g) wireLightMap($('#sq-lp'), g);
    $('#sq-go').onclick = () => runSkyCheck();
    wireUpdateLoc($('#sq-loc'));
    $('#sq-close').onclick = () => (flow ? flowNext() : box.classList.add('hidden'));
  };
  const g = skyGlowGrid(); show(g);
  if (!g) loadSkyGlow().then((x) => { if (x && !box.classList.contains('hidden') && $('#sq-lp')) show(x); });
}
function runSkyCheck() {
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
    <p class="small">Face north and find the Little Dipper hanging from <b>Polaris</b>, ${P[0].alt.toFixed(0)}° up. Give your eyes 10 minutes away from screens and lights. Then flip through the pictures until one matches what you see.${sun > -12 ? ' <b>It isn\'t fully dark yet</b>, so this will read brighter than your real sky.' : ''}${(() => { const mo = sky.moonInfo(new Date()); return sun <= -12 && mo.alt > 0 && mo.frac > 0.25 ? ` <b>The Moon is up (${Math.round(mo.frac * 100)}% lit)</b>, so you'll see fewer stars than on a dark night. That's fine: the app takes the Moon's glow away to find your light pollution.` : ''; })()}</p>
    <svg viewBox="0 0 300 300" class="umi" id="sq-svg"></svg>
    <div class="sqnav"><button id="sq-less" aria-label="Fewer stars">${ICON.prev}</button>
      <div class="sqmid"><b id="sq-title"></b><span id="sq-cap" class="muted small"></span><span class="sqdots" id="sq-dots"></span></div>
      <button id="sq-more" aria-label="More stars">${ICON.next}</button></div>
    <button id="sq-ok" class="primary" style="width:100%;margin-top:8px">That's my sky — OK</button>
    <button id="sq-skip" style="width:100%;margin-top:6px">Can't see it (cloud, trees, not dark) — skip</button>`;
  const show = () => {
    $('#sq-svg').innerHTML = chart(); $('#sq-title').textContent = SKY_LEVELS[lv][2]; $('#sq-cap').textContent = `${SKY_LEVELS[lv][3]} · faintest stars magnitude ${SKY_LEVELS[lv][0].toFixed(1)}${lv === SKY_LEVELS.length - 1 ? ' or fainter' : ''} · about Bortle ${bortleOfNelm(SKY_LEVELS[lv][0])}${lv === SKY_LEVELS.length - 1 ? ' or darker' : ''}`;
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
    const m = SKY_LEVELS[lv][0], mp = skyGlowAt(state.site.lat, state.site.lon), top = lv === SKY_LEVELS.length - 1;
    const mo = sky.moonInfo(new Date()), moonUp = mo.alt > 0 && mo.frac > 0.25, twi = sun > -12;
    const q = { nelm: m, when: Date.now(), lat: state.site.lat, lon: state.site.lon, twilight: twi, moonUp };
    // With the Moon up or in twilight, take their modelled glow away to get the light pollution alone (see checkBase).
    q.base = moonUp || twi ? (moonlessNelm({ nelm: m, moonAlt: mo.alt, moonFrac: mo.frac, sepDeg: sepDeg(mo.alt, mo.az, P[0].alt, P[0].az), targetAlt: P[0].alt, sunAlt: sun }) || { nelm: null }).nelm : m;
    const eff = q.base == null ? (mp ? mp.nelm : DEFAULT_NELM) : checkNelm(q), [label, means] = skyLabel(eff); q.label = label;
    state.skyq = q; planRows = null; rateCache.clear(); save(); if (tab === 'plan') renderPlan(); if (tab === 'setup') renderLightHere();
    const what = moonUp ? 'the Moon' : 'twilight';
    const verdict = (moonUp || twi)
      ? (q.base == null
        ? `Faintest stars you can see: about magnitude ${m.toFixed(1)}. Tonight ${what} is so bright that it hides the light pollution underneath, so this check can't measure it.${mp ? ` The app goes by the light-pollution map here (about Bortle ${mp.bortle})` : ' The app keeps its usual estimate'} and allows for ${what} target by target.`
        : `Faintest stars you can see: about magnitude ${m.toFixed(1)}, with ${what} adding to the light pollution. Taking ${what}'s glow away, your light pollution is about <b>Bortle ${bortleOfNelm(q.base)}</b>${mp ? ` (the map estimated about Bortle ${mp.bortle})` : ''}. The app uses that, and allows for ${what} target by target, so the ratings fit tonight. A check on a dark, moonless night is more precise.`)
      : top
        ? `Faintest stars you can see: magnitude ${m.toFixed(1)} or fainter — Bortle ${bortleOfNelm(m)} or darker. This check can't tell darker skies apart${mp && eff > m ? `, so the app goes by the light-pollution map here: about Bortle ${mp.bortle}` : ''}.`
        : `Faintest stars you can see: about magnitude ${m.toFixed(1)} — about Bortle ${bortleOfNelm(m)}.${mp ? ` The light-pollution map estimated about Bortle ${mp.bortle} here.` : ''}`;
    const dq = checkDoubt(q), doubtNote = dq ? `<p class="small"><b>That's much brighter than the light-pollution map expects here (Bortle ${dq.bortle}).</b> Clouds, haze, the Moon or a light nearby can do that. The app keeps using the map for now; check again on a clear night.</p>` : '';
    card.innerHTML = `<h3 style="margin-top:0">${label}</h3><p>${verdict}</p>${doubtNote}<p class="small">${means}</p>
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
  // The light-pollution map loads in the background; when it arrives, ratings that rely on a guess are redone.
  syncTransients();                                                   // tonight's meteor showers (built in)
  loadHighlights().then(() => { syncTransients(); if (tab === 'plan') { renderPlan(); fillPlanSuggestions(); } });   // comets and novae from the weekly feed
  refreshAurora().then(() => { if (tab === 'plan') fillEvents(); });
  setInterval(() => { syncTransients(); refreshAurora(); }, 30 * 60e3);
  loadSkyGlow().then((g) => { if (g && !skyQ() && mapSky()) { planRows = null; rateCache.clear(); try { renderLaunch(); } catch (e) { /* launch screen not built yet */ } if (tab === 'plan') renderPlan(); else if (tab === 'find') renderFind(); } }).catch(() => {});
  sound.mode = state.sound || 'chime';
  if (state.rot180 == null) state.rot180 = true;
  if (!state.catPicked && state.catFilter === 'M') state.catFilter = 'ALL';   // Build 122: the old default (Messier) becomes All, unless someone picked it
  for (const k of ['sw150c', 'sw200v', 'sw400']) if (state.profiles[k] && state.profiles[k].focuser == null) state.profiles[k].focuser = 90;   // Skyward: focuser always on the right
  for (const [k, v] of Object.entries(DEFAULT_PROFILES)) if (!state.profiles[k]) state.profiles[k] = structuredClone(v);
  setSeeing(seeingNow());
  // The 200 Visual was first entered as 203 mm / 812 mm. It is 200 mm f/4: correct a saved copy that still has the old figures.
  { const q = state.profiles.sw200v; if (q && q.aperture === 203 && q.fl === 812) { q.aperture = 200; q.fl = 800; q.source = DEFAULT_PROFILES.sw200v.source; } }
  if (state.calibrate == null) state.calibrate = true;
  sky.setSite(state.site.lat, state.site.lon, state.site.elev);
  applyModelSettings();
  document.querySelectorAll('nav#tabs button').forEach((b) => b.onclick = () => showTab(b.dataset.tab));
  $('#hb-day').onclick = (e) => { e.stopPropagation(); openShade(); };
  state.shade = 0;                                 // always open in the Day look; the fader is one tap away on every screen
  $('#hb-fs').innerHTML = ICON.full;
  // Home: the start screen, one tap from anywhere (it used to be at the bottom of More).
  $('#hb-home').innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 11 12 3.5 21 11"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/></svg>';
  $('#hb-home').onclick = (e) => { e.stopPropagation(); showStart(); };
  $('#hb-fs').onclick = (e) => { e.stopPropagation(); toggleFullscreen(); };
  $('#st-scope').onclick = () => showTab('setup');
  $('#st-pill').onclick = () => { const st = pointState(); if (st === 'off' || st === 'nodata') { showStart(); } else showTab('align'); };
  // iOS ignores user-scalable=no: stop the page itself from pinch-zooming (the charts handle their own pinch).
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  if (IS_STANDALONE()) $('#hb-fs').classList.add('hidden');
  $('#fs-close').onclick = () => $('#fs-help').classList.add('hidden');
  applyTheme();
  renderLaunch();
  setTimeout(() => autoLocate().catch(() => {}), 2600);   // after the splash
  $('#gate-sim').onclick = () => startSensors(true);
  $('#gate-skip').onclick = () => { $('#gate').classList.add('hidden'); if (flow && !flow.started) flowNext(); onceToast('nosens', 'Browsing without sensors — drag the sky view to look around. Pointing needs them: tap the status at the top to turn them on.', 5500); };
  if (new URLSearchParams(location.search).has('sim')) $('#gate-sim').classList.remove('hidden');
  showTab('find');
  const flush = () => flushQueue(state).then((n) => { if (n) { save(); toast(`Sent ${n} queued score${n > 1 ? 's' : ''} to the leaderboard`); } }).catch(() => {});
  if (state.pendingScores && state.pendingScores.length) flush();
  window.addEventListener('online', flush);
  requestAnimationFrame(loop);
  if ('serviceWorker' in navigator && !window.Capacitor && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
