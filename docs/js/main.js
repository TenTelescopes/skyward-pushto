import { PointingModel, MOUNTINGS, fitAlignment, guidance, tangentOffset, mulMV, altAzFromVec, norm, wrap180, wrap360, sepDeg, D2R, R2D } from './model.js';
import { Sky, typeLabel, compassName, LINES } from './astro.js';
import { Sensors, SimSensors } from './sensors.js';
import { Recorder, analyzeStillness, analyzeRepeat, analyzeReversal, analyzeAccuracy, fmt, toCSV } from './tests.js';
import { fitConsistency, pairConsistency, outliers, verdict as domeVerdict, drawDome, correctionTable, splitJumps } from './dome.js';
import { constellationAt, conName, altAzToJ2000 } from './locate.js';
import { whereWords, recogniseWords, pickStars, checkAltitude, checkPair, chooseWaypoint } from './assist.js';
import { drawEyepiece, newtonianMatrix } from './eyeview.js';
import { theme, tint, applyShade } from './theme.js';
import { LEVELS, planTargets, routePlan, nextDarkNight, interest, pickScore, varied, autoPlan, kindOf } from './plan.js';
import { seenKeys, lastEntry, logStats, MILESTONES, newlyAchieved, logCSV } from './log.js';
import { sound, initSound, cue, tickInterval } from './sound.js';
import { blurbFor } from '../data/blurbs.js';
import { rate, describe, DOTS, LEVEL_NAMES, DEFAULT_NELM } from './vis.js';
import { DAYLIGHT, STYLES, PENALTY, pickTargets, routeOrder, pathLength, tokenFor, buildTokenIndex, encodeChallenge, decodeChallenge, challengeId, encodeResult, decodeResult, points, rank, fmtTime, dwell } from './game.js';
import { submitScore, fetchBoard, flushQueue } from './wixscores.js';
import qrcode from '../vendor/qrcode.mjs';
import { analyzeSwing, analyzeAltSweep, analyzeHorizonTurn, gradeCheck, guessModel, GRADE } from './check.js';

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
  sw200v: { name: 'Skyward 200 Visual', aperture: 203, fl: 812,
    source: '8″ f/4 primary (AD048) — SW200 Visual packing list rev H. Focal length assumes 203 mm × 4; edit if your mirror is marked differently.', focuser: 90,
    eyepieces: [{ name: '23 mm', fl: 23, afov: 62, verified: false }, { name: '10 mm', fl: 10, afov: 62, verified: false }, { name: '4 mm', fl: 4, afov: 62, verified: false }], cal: null },
};
const DEFAULTS = {
  v: 1, profiles: DEFAULT_PROFILES, active: 'sw150c', mounting: 'top-sky', mode: 'gyro', compassCorr: 0,
  site: { lat: 43.65, lon: -79.38, elev: 100, source: 'default (Toronto) — set your location' },
  smooth: 0.6, minAlt: 10, bright: 1, ep: 0, useRate: false, catFilter: 'M', upOnly: true, sort: 'best',
  history: [], target: null, log: [], sound: 'chime', skyCorr: true,
  launch: { check: true, sky: false, align: true },
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
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms); }
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
const kindLabel = (o) => (o.id === 'Moon' ? 'Moon' : o.key.startsWith('st:') ? (o.pairs ? 'Double star' : 'Star') : typeLabel(o.t));
const sizeText = (o) => (o.maj ? (o.maj >= 60 ? `${(o.maj / 60).toFixed(1)}°` : `${o.maj.toFixed(o.maj < 3 ? 1 : 0)}′`) : (o.sep ? `${o.sep}″ apart` : ''));
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
const PARENT = { align: 'more', log: 'more', test: 'more', setup: 'more' };
const scrollPos = {}; let pendingScroll = null;
function showTab(t) {
  const m = $('main'); if (tab && m) scrollPos[tab] = m.scrollTop;
  tab = t; const top = PARENT[t] || t;
  document.querySelectorAll('nav#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === top));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + t));
  ({ plan: renderPlan, find: renderFind, push: renderPush, align: renderAlign, game: renderGame, test: renderTest, setup: renderSetup, more: renderMore, log: renderLog })[t]();
  // Lists reopen where you left them; every other screen starts at the top.
  pendingScroll = (t === 'find' || t === 'plan') && scrollPos[t] ? { t, y: scrollPos[t] } : null;
  m.scrollTop = pendingScroll ? pendingScroll.y : 0;
}
function restoreScroll() { if (pendingScroll && pendingScroll.t === tab) { $('main').scrollTop = pendingScroll.y; pendingScroll = null; } }
const BACK = '<button class="back" data-back>‹ More</button>';
function bindBack(el) { const b = $('[data-back]', el); if (b) b.onclick = () => showTab('more'); }

// ---------------------------------------------------------------- PLAN
// state.plan = { start: ISO, hours, items: [{ key, sync? }], done: { key: true } }
let planRows = null, planLevel = 'all', planSort = 'top', planLimit = 40, planEdit = false, planReorder = false;
const hm = (d) => (d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—');
const pad = (n) => String(n).padStart(2, '0');
const dateVal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeVal = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const objByKey = (k) => sky.objects.find((o) => o.key === k);
function planState() {
  if (!state.plan) state.plan = { start: null, hours: 2, items: [], done: {} };
  if (!state.plan.start) state.plan.start = defaultStart().toISOString();
  return state.plan;
}
function defaultStart() {
  const now = new Date(), n = sky.night(now), dark = n.astro || n.naut || n.set;
  if (dark && now < dark) return dark;
  const r = new Date(Math.ceil(now.getTime() / 900000) * 900000);
  return r;
}
const planList = () => (state.plan ? state.plan.items : []);
function markDone(key, v) { if (!state.plan) return; state.plan.done = state.plan.done || {}; if (v) state.plan.done[key] = true; else delete state.plan.done[key]; save(); }
function planBar(o) {
  const P = planList(), i = P.findIndex((x) => x.key === o.key); if (i < 0) return '';
  const it = P[i], nxt = P[i + 1] && objByKey(P[i + 1].key);
  return `<div class="planbar">${it.sync ? `<b>Sync star.</b> Centre ${esc(o.label)}, tap <b>Centred — Sync</b>, then the arrow. ` : ''}Plan ${i + 1} of ${P.length}${nxt ? ` · next: <b>${esc(nxt.label)}</b>` : ' · last one'}</div>`;
}
function dayLabel(d) {
  const now = new Date(), a = new Date(now.getFullYear(), now.getMonth(), now.getDate()), b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((b - a) / 864e5);
  return diff === 0 ? (d.getHours() < 16 ? 'Today' : 'Tonight') : diff === 1 && d.getHours() < 6 ? 'Tonight' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
function renderPlan() {
  const el = $('#tab-plan'), P = planState();
  if (new Date(P.start).getTime() + P.hours * 3600000 < Date.now() - 2 * 3600000) { P.start = defaultStart().toISOString(); planRows = null; save(); }   // last session is over: plan for the next one
  const start = new Date(P.start), end = new Date(start.getTime() + P.hours * 3600000), n = sky.night(start);
  const moonTxt = `${Math.round(n.moonFrac * 100)}% lit${n.moonRise ? ', rises ' + hm(n.moonRise) : ''}${n.moonSet ? ', sets ' + hm(n.moonSet) : ''}`;
  const T = P.items.filter((x) => !x.sync), nSync = P.items.length - T.length, nDone = T.filter((x) => P.done && P.done[x.key]).length;
  const skyName = state.skyq ? state.skyq.label : 'Suburban sky (a guess)';
  el.innerHTML = `<h2>Plan a session</h2>
    <div class="card">
      <div class="sess"><div><b>${dayLabel(start)} · ${hm(start)} – ${hm(end)}</b>
        <div class="muted small">${esc(skyName)} · Moon ${moonTxt}</div>
        <div class="muted small">Sunset ${hm(n.set)} · fully dark ${hm(n.astro)} – ${hm(n.astroAm)}${n.set && start < n.set ? ' · <b>you start before sunset</b>' : ''}</div></div>
        <button id="pl-edit" class="mini">${planEdit ? 'Done' : 'Change'}</button></div>
      <div id="pl-form" class="${planEdit ? '' : 'hidden'}" style="margin-top:8px">
        <div class="btnrow"><button id="pl-dark" class="mini">Start at full dark (${hm(n.astro || n.naut)})</button><button id="pl-now" class="mini">Start now</button></div>
        <label class="row"><span>Date</span><input id="pl-date" type="date" value="${dateVal(start)}"></label>
        <label class="row"><span>Going out at</span><input id="pl-time" type="time" step="900" value="${timeVal(start)}"></label>
        <label class="row"><span>Staying out</span><select id="pl-hours">${[1, 1.5, 2, 3, 4, 6, 8].map((h) => `<option value="${h}" ${+P.hours === h ? 'selected' : ''}>${h} hour${h > 1 ? 's' : ''}</option>`).join('')}</select></label>
        <label class="row"><span>Your sky</span><select id="pl-skysel">${SKY_PICKS.map(([m, l]) => `<option value="${m}" ${Math.abs(skyNelm() - m) < 0.26 ? 'selected' : ''}>${l}</option>`).join('')}${SKY_PICKS.some(([m]) => Math.abs(skyNelm() - m) < 0.26) ? '' : `<option selected>${esc(state.skyq.label)}</option>`}</select></label>
        <div class="btnrow"><button id="pl-skyq" class="mini">Measure it: Little Dipper check (30 s)</button></div>
      </div>
    </div>
    ${P.items.length ? `<div class="sech"><h3>Your plan <span class="muted small">${T.length} target${T.length === 1 ? '' : 's'}${nSync ? ` + ${nSync} sync star${nSync === 1 ? '' : 's'}` : ''}${nDone ? ` · ${nDone} done` : ''}</span></h3><button id="pl-reorder" class="mini">${planReorder ? 'Done' : 'Edit'}</button></div>
      <ul class="list" id="pl-list">${P.items.map((it, i) => planItemHTML(it, i)).join('')}</ul>
      <div class="btnrow"><button id="pl-go" class="primary">Start observing</button><button id="pl-route">Best order + sync stars</button></div>
      <div class="chips wrap"><button id="pl-bytime">Order by time</button><button id="pl-nosync" ${nSync ? '' : 'disabled'}>Remove sync stars</button><button id="pl-auto">Rebuild for me</button><button id="pl-clear">Clear</button></div>
      <p class="muted small">"Best order" keeps pushes short and adds a bright star before each long jump. Centre that star and tap Sync, so the pointing is freshly corrected right where you're about to look.</p>`
    : `<div class="card" style="text-align:center"><b>No plan yet</b><p class="muted small" style="margin:4px 0 10px">Let the app pick a varied tour for this session, or add your own from the suggestions below with <b>+</b>.</p><button id="pl-auto" class="primary big">Build a plan for me</button></div>`}
    <div class="sech"><h3>Suggestions <span class="muted small">for this session</span></h3></div>
    <div class="chips" id="pl-lv">${[['all', 'All'], ['0', '●●● Obvious'], ['1', '●●○ Visible'], ['2', '●○○ Challenging']].map(([k, l]) => `<button data-lv="${k}" class="${planLevel === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="chips" id="pl-sort">${[['top', 'Top picks'], ['time', 'Best time'], ['alt', 'Highest'], ['name', 'Catalog #']].map(([k, l]) => `<button data-s="${k}" class="${planSort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <ul class="list" id="pl-sugg"><li class="muted">Working it out…</li></ul>`;
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
  el.querySelectorAll('#pl-lv [data-lv]').forEach((b) => b.onclick = () => keepScroll(() => { planLevel = b.dataset.lv; planLimit = 40; renderPlan(); }));
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
  if ($('#pl-reorder')) $('#pl-reorder').onclick = () => keepScroll(() => { planReorder = !planReorder; renderPlan(); });
  if ($('#pl-route')) {
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
  const sig = [P.start, P.hours, profile().name, profile().aperture, profile().eyepieces.map((e) => e.fl).join(), skyNelm()].join('|');
  if (sig !== planSig) { planRows = null; planSig = sig; }
  if (!planRows) { planDarkNight = (() => { try { return nextDarkNight(sky, new Date(P.start)); } catch (e) { return null; } })(); }
  if (!planRows) planRows = planTargets(sky, { start: new Date(P.start), hours: +P.hours, scope: profile(), nelm: skyNelm(), minAlt: 20 });
  return planRows;
}
function skyNelm() { return state.skyq ? state.skyq.nelm : DEFAULT_NELM; }
let planDarkNight = null, planSig = '';
const rowFor = (key) => computePlanRows().find((r) => r.key === key) || null;
function planItemHTML(it, i) {
  const o = objByKey(it.key); if (!o) return '';
  const r = it.sync ? null : rowFor(it.key), done = state.plan.done && state.plan.done[it.key], last = i === state.plan.items.length - 1;
  const info = it.sync ? '<div class="t2">Sync star — centre it, tap Sync, carry on</div>'
    : r ? `<div class="t2"><span class="dots lv${r.level}">${DOTS[r.level]}</span> ${hm(r.best)} · ${r.alt.toFixed(0)}° ${compassName(r.az)}${r.ep ? ' · ' + esc(r.ep.name) : ''}</div>${planReorder ? '' : `<div class="t2">${esc(r.desc)}</div>`}`
    : '<div class="t2">Not well placed in this session</div>';
  return `<li class="${done ? 'done' : ''}"><span class="muted small" style="width:16px;text-align:right">${i + 1}</span>
    <div class="main" data-goplan="${esc(it.key)}"><div class="t1">${it.sync ? '★ ' : ''}${nameHTML(o)}${done ? ' <span class="seen">✓</span>' : ''}</div>${info}</div>
    ${planReorder ? `<button class="ibtn" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="ibtn" data-dn="${i}" ${last ? 'disabled' : ''} aria-label="Move down">↓</button><button class="ibtn" data-rm="${i}" aria-label="Remove from plan">✕</button>` : `<span class="muted" aria-hidden="true">›</span>`}</li>`;
}
function bindPlanList() {
  const P = state.plan, ul = $('#pl-list'); if (!ul) return;
  const redo = () => { const y = $('main').scrollTop; save(); renderPlan(); $('main').scrollTop = y; };
  const mv = (i, j) => { const a = P.items; [a[i], a[j]] = [a[j], a[i]]; redo(); };
  ul.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => mv(+b.dataset.up, +b.dataset.up - 1));
  ul.querySelectorAll('[data-dn]').forEach((b) => b.onclick = () => mv(+b.dataset.dn, +b.dataset.dn + 1));
  ul.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { P.items.splice(+b.dataset.rm, 1); redo(); });
  ul.querySelectorAll('[data-goplan]').forEach((d) => d.onclick = () => openObject(d.dataset.goplan, { row: rowFor(d.dataset.goplan) }));
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
  ul.innerHTML = L.slice(0, planLimit).map((r) => `<li class="wrap"><div class="main" data-info="${esc(r.key)}"><div class="t1">${nameHTML(r.o)}${seen.has(r.key) ? ' <span class="seen">✓</span>' : ''}</div>
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
  ul.querySelectorAll('[data-info]').forEach((d) => d.onclick = () => { const k = d.dataset.info; openObject(k, { row: rowFor(k) }); });
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
  if (!siteKnown()) rows.push(`<div class="strip"><span>Location not set.</span><button id="qs-gps" class="mini primary">Use GPS</button></div>`);
  if (!lastCheck() && !state.skipCheck) rows.push(`<div class="strip"><span>Phone not tested yet (4 min).</span><button id="qs-check" class="mini">Test</button><button id="qs-skip" class="mini" aria-label="Dismiss">✕</button></div>`);
  return rows.join('');
}
/** The best things up right now for this scope and sky: famous, well above the visibility limit, comfortably high, and varied. */
function tonightPicks(n = 8) {
  const sun = sky.sunAlt(), names = new Set();
  const c = sky.objects.filter((o) => o.alt > 20 && (!o.key.startsWith('st:') || o.show)).map((o) => ({ o, r: rateNow(o) }))
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
  const p = profile(), sig = `${state.active}|${p.aperture}|${p.fl}|${p.eyepieces.map((e) => e.fl).join()}|${skyNelm()}`;
  if (Date.now() - nowCond.t > 30000 || sig !== rateSig) { nowCond = { t: Date.now(), sun: sky.sunAlt(), m: sky.moonInfo() }; rateSig = sig; rateCache.clear(); }
  if (rateCache.has(o.key)) return rateCache.get(o.key);
  const c = nowCond, sepM = c.m.alt > 0 ? sepDeg(o.alt, o.az, c.m.alt, c.m.az) : 180;
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
const ZOOM_ROW = () => `<div class="btnrow zoom"><button id="z-out" aria-label="Zoom out">−</button><button id="z-in" aria-label="Zoom in">+</button><button id="z-ep" title="Tap to cycle eyepieces">${esc(eyepiece().name)}</button><button id="z-auto">Fit</button></div>`;
function renderPush() {
  const el = $('#tab-push'); const o = targetObj();
  pstatKey = null; rateT = 0;
  if (!o) {
    el.innerHTML = `<div class="target-h"><span class="name">Sky view</span><span class="muted">no target</span></div>
      <div class="pstat" id="pstat"></div>
      <canvas id="reticle" class="chart big" width="800" height="800"></canvas>
      <div id="whereami" class="whereami"></div>
      ${ZOOM_ROW()}
      <p class="muted small">The chart follows the scope.${state.mounting === 'top-sky' ? ' In your hand, point the top edge of the phone at the sky, like a TV remote.' : ''} When it says you're near something, tap the name to read about it.</p>
      <div class="actionbar"><button id="sv-find" class="primary">Pick a target</button>${align.fit || state.mode === 'compass' ? '' : '<button id="sv-align">Align</button>'}</div>`;
    chartCentre = 'scope'; if (zoom == null) zoom = 30;
    bindChartControls();
    $('#sv-find').onclick = () => showTab('find');
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
    <details class="more"><summary>View options</summary>
      <div class="btnrow"><button id="z-ctr">${chartCentre === 'scope' ? 'Chart follows: scope' : 'Chart follows: target'}</button><button id="z-wide">Wide (30°)</button><button id="z-lock" class="${state.zoomLock ? 'on' : ''}">${state.zoomLock ? 'Zoom locked' : 'Lock zoom'}</button></div>
      <label class="row"><span>Draw the eyepiece view the way your Newtonian shows it</span><input type="checkbox" id="rot180" ${state.rot180 ? 'checked' : ''}></label>
      <p class="muted small" id="eyedim"></p>
      <p class="muted small">Eyepiece view computed for a focuser on the ${({ '-90': 'left side', '-45': 'upper left', 0: 'top', 45: 'upper right', 90: 'right side' })[profile().focuser ?? 90]} (standing behind the scope, tube level), with your head upright; tilting your head turns the view with it. <b>↑Z</b> points toward the zenith, N and E are celestial north and east.</p>
      <p class="muted small">The chart above is drawn as you see the sky standing behind the scope (up = toward the zenith). Pinch it, or use − and +, to zoom out until you recognise the star pattern. The circle is your eyepiece's true field; the chart zooms out by itself while you move unless you lock the zoom.</p>
    </details>
    <details class="more"><summary>Numbers</summary>
      <p class="muted small">${esc(o.sub || '')}${o.con ? ' · ' + esc(fullCon(o.con)) : ''}${o.mag != null ? ' · mag ' + (+o.mag).toFixed(1) : ''}${o.mnote ? ' · ' + esc(o.mnote) : ''}</p>
      ${o.pairs ? `<p class="muted small">${o.pairs.map((p) => `${p.c}: ${p.sep}″ apart, PA ${p.pa}° (mags ${p.mags})`).join(' · ')}</p>` : ''}
      <div class="kv" id="pinfo"></div>
    </details>
    <div class="btnrow"><button id="b-info">About ${esc(o.label)}</button><button id="b-free">Sky view</button></div>
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
    bar.innerHTML = `<button class="ibtn" id="b-prev" aria-label="Previous target">${ICON.prev}</button><button id="b-sync" class="primary wide">Centred — Sync</button>${loggable ? `<button id="b-log">${seen ? 'Seen ✓' : 'Log'}</button>` : ''}<button class="ibtn" id="b-next" aria-label="Next target">${ICON.next}</button>`;
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
  if (!loggable) return `<div class="ontarget"><b>✓ In the eyepiece</b><div class="small">Centre it, then tap <b>Centred — Sync</b>.</div></div>`;
  if (recent) return `<div class="ontarget"><b>✓ In the eyepiece</b><div class="small">Logged ✓ — tap the arrow for the next one.</div></div>`;
  return `<div class="ontarget"><b>✓ In the eyepiece</b> — take a look
    <div class="seenrow"><span>See it?</span><button data-seen="yes" class="primary">Yes</button><button data-seen="maybe">Not sure</button><button data-seen="no">No</button></div></div>`;
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
    if (guess) { c.fillStyle = col(230, 50, 25); c.font = 'bold 22px system-ui'; c.textAlign = 'center'; c.fillText(opt.noBanner ? 'scope (compass guess)' : 'scope? (guess)', scope.x, scope.y + Math.max(28, half * s + 26)); c.textAlign = 'left'; }
    const L = Math.max(14, half * s * 0.35); c.beginPath(); c.moveTo(scope.x - L, scope.y); c.lineTo(scope.x + L, scope.y); c.moveTo(scope.x, scope.y - L); c.lineTo(scope.x, scope.y + L); c.stroke();
  }

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
  const R = avgR(1.0); if (!R) return null; const truth = sky.altAz(o);
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
function doSync(o) {
  const ob = makeObs(o); if (!ob) return toast('No sensor data');
  if (state.mode === 'compass') {
    const co = sensors.compassOffset(); if (co == null) return toast('No compass reading');
    const raw = altAzFromVec(mulMV(ob.R, model.axis()));
    state.compassCorr = wrap180(ob.az - raw.az - co); save(); return toast(`Compass correction set to ${state.compassCorr.toFixed(2)}°`);
  }
  const f = fitAlignment([ob], model.d0, { p: model.p, q: model.q }, { thetaOnly: true });
  const prev = align.syncs[align.syncs.length - 1];
  const seenBefore = skyTable() ? pointing() : null;       // with sky correction on, report the error of what the arrows actually showed
  const before = align.fit ? (seenBefore && seenBefore.ready ? wrap180(ob.az - seenBefore.az) : wrap180(f.theta - model.thetaAt())) : null;
  model.theta = f.theta; model.t0 = Date.now(); align.suspect = false; cue.sync();
  if (!align.fit) align.fit = { theta: f.theta, p: model.p, q: model.q, rms: f.rms, resid: [f.rms], solvedAxis: false };
  // Drift is only measured between two syncs with no interruption in between (a heading jump is not drift).
  if (prev && (prev.ep || 0) === (align.epoch || 0) && Date.now() - prev.t > 120000) { model.rate = wrap180(f.theta - prev.theta) / ((Date.now() - prev.t) / 60000); }
  align.syncs.push({ t: Date.now(), theta: f.theta, kind: 'sync', key: o.key, correction: before, pos: { alt: ob.alt, az: ob.az }, ep: align.epoch || 0 });
  align.confirm.push({ ...ob, kind: 'sync' });
  const msg = before == null ? `Synced on ${o.label}` : (Math.abs(before) * 60 < 0.5 ? `Synced on ${o.label}: alignment still spot on` : `Synced on ${o.label}: corrected ${Math.abs(before) < 1 ? Math.abs(before * 60).toFixed(0) + '′' : Math.abs(before).toFixed(2) + '°'}`);
  if (state.waypoint && state.waypoint.via === o.key) {
    const then = sky.objects.find((x) => x.key === state.waypoint.then); state.waypoint = null;
    if (then) { state.target = then.key; save(); const U = pointingUncertainty(sky.altAz(then)); toast(`${msg}. Now push to ${then.label}${U ? ` — estimated error ±${fmt.am(U)}` : ''}`, 4500); renderPush(); return; }
  }
  toast(msg);
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
      <div class="target-h" style="margin:2px 0"><span class="name">${esc(s.label)}</span><span class="muted">${s.planet ? 'planet' : 'star'} · mag ${(+s.mag).toFixed(1)}</span></div>
      <p style="margin:2px 0">${esc(cap1(starHelp(s)))}. Look ${esc(whereWords(s.alt, s.az))}.</p>
      <p class="infield" id="a-live"></p>
      <canvas id="a-chart" class="chart" width="600" height="600"></canvas>
      <p class="muted small">Get it in the red-dot finder first, then centre it in the eyepiece and tap <b>It's centred</b>. Not sure it's the right star? Tap <b>Different star</b>.</p>`;
  } else if (done >= need) {
    assistHTML = `<div class="card"><b>✓ Aligned on ${align.obs.map((o) => esc(o.label)).join(' and ')}.</b> <span class="muted small">Fit ${fmt.am(f.rms * 60)}.</span>
      ${f.solvedAxis && !c ? '<div class="btnrow"><button id="savecal2">Remember how the phone sits — next time one star is enough</button></div>' : ''}<p class="muted small">Tap Sync on anything you centre to keep it accurate. Before a long push, the app suggests a star to check on the way.</p>
      <div class="btnrow"><button id="a-find" class="primary">Pick a target</button></div></div>`;
  } else assistHTML = '<p class="muted">No bright stars above 15° right now.</p>';
  el.innerHTML = `${BACK}
    <h2>Alignment</h2>
    ${state.mode === 'compass' ? `<p class="muted">Compass mode is on: azimuth comes from the magnetometer. Star alignment below uses the gyro instead and is usually more accurate — switch in Setup.</p>` : ''}
    ${assistHTML}
    ${done ? `<table class="res"><tr><th>Star</th><th>Alt</th><th>Residual</th><th></th></tr>${align.obs.map((o, i) => `<tr><td>${esc(o.label)}</td><td>${o.alt.toFixed(0)}°</td><td>${f ? fmt.am(f.resid[i] * 60) : ''}</td><td><button data-del="${i}">✕</button></td></tr>`).join('')}</table>` : ''}
    ${align.confirm.length ? `<div class="card"><h3 style="margin-top:0">Sky consistency</h3>
      <canvas id="dome" width="700" height="720" style="width:100%;max-width:360px;display:block;margin:0 auto;background:var(--chart);border-radius:10px"></canvas>
      <div class="chips" style="justify-content:center">${[1, 10, 30].map((m) => `<button data-mag="${m}" class="${domeMag === m ? 'on' : ''}">errors ×${m}</button>`).join('')}<button id="dome-red" class="${state.domeRed ? 'on' : ''}">Red only</button></div>
      <div id="dome-info"></div></div>` : ''}
    <div class="btnrow"><button id="clr">Start over</button><button id="savecal" ${f && f.solvedAxis ? '' : 'disabled'}>Save tilt to ${esc(profile().name)}</button></div>
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
    ${s && !assist.pending ? '<div class="actionbar"><button id="a-ok" class="primary wide">It\'s centred</button><button id="a-skip">Different star</button></div>' : ''}`;
  bindBack(el);
  if ($('#a-find')) $('#a-find').onclick = () => showTab('find');
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
    <p class="muted small">Looking up: north at top, east on the left. White is the true sky; the coloured mesh is how the sensors see it after removing the offset, phone tilt and drift — green perfect, blue good, yellow fair, red poor (compared with your eyepiece field). Dots are confirmed objects, arrows point to where the sensors put them. With Sky correction in use, the arrows on the Push screen are shifted to cancel this map. Colours cost some night vision; use Red only at the eyepiece.</p>`;
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
    $('#scan-paste').onclick = () => { const v = prompt('Paste the Skyward code'); resolve(finish(v && v.trim() ? v.trim() : null)); };
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
  if (!game || game.phase === 'lobby') return renderLobby(el);
  if (game.phase === 'ready') return renderReady(el);
  if (game.phase === 'count' || game.phase === 'play') return renderPlay(el);
  if (game.phase === 'done') return renderDone(el);
}
function renderLobby(el) {
  const aligned = state.mode === 'gyro' ? !!align.fit : true;
  const sel = state.gameStyle || 'push';
  el.innerHTML = `<h2>Game</h2>
    <p class="muted small">The app picks the 10 best targets for your sky and scope right now, plots a short route, and times you. Each find is confirmed by the phone's sensors.</p>
    <label class="field"><span>Your name on the leaderboard</span><input id="g-name" value="${esc(state.player || '')}" placeholder="e.g. Bryan" maxlength="24"></label>
    <label class="field"><span>Observing site <span class="muted small">(optional)</span></span><input id="g-site" value="${esc(state.siteName || '')}" placeholder="e.g. Torrance Barrens" maxlength="40"></label>
    <h3>Style</h3>
    ${Object.entries(STYLES).map(([k, v]) => `<button class="act pick ${k === sel ? 'on' : ''}" data-style="${k}"><b>${k === sel ? '● ' : '○ '}${v.name}</b><span class="muted small">${v.desc}</span></button>`).join('')}
    ${aligned ? '' : `<div class="card"><b>Align first.</b> <span class="small">Alignment isn't timed — do it before you start.</span><div class="btnrow"><button id="g-align">Go to Align</button></div></div>`}
    <div class="btnrow"><button id="g-new" class="primary big" ${aligned ? '' : 'disabled'}>New game — best 10 for here, now</button></div>
    <div class="btnrow"><button id="g-scan">Join: scan code</button><button id="g-paste">Join: paste code</button></div>
    <div class="btnrow"><button id="g-board">Leaderboard</button></div>
    <div id="g-boardbox"></div>`;
  $('#g-name').onchange = (e) => { state.player = e.target.value.trim(); save(); };
  $('#g-site').onchange = (e) => { state.siteName = e.target.value.trim(); save(); };
  el.querySelectorAll('[data-style]').forEach((b) => b.onclick = () => { state.gameStyle = b.dataset.style; save(); renderLobby(el); });
  if ($('#g-align')) $('#g-align').onclick = () => showTab('align');
  $('#g-new').onclick = () => newGame(state.gameStyle || 'push');
  $('#g-scan').onclick = async () => { const c = await scanCode(); if (c) (c.startsWith('SKYR') ? addFriendResult(c) : loadChallenge(c)); };
  $('#g-paste').onclick = () => { const c = prompt('Paste a Skyward challenge code'); if (c) loadChallenge(c.trim()); };
  $('#g-board').onclick = () => showBoard($('#g-boardbox'), { style: state.gameStyle || 'push' });
}
function renderReady(el) {
  const g = game, len = pathLength(g.targets);
  el.innerHTML = `<h2>${esc(STYLES[g.style].name)} · challenge ${esc(g.ch.id)}</h2>
    <p class="muted small">${g.ch.host ? 'Set by ' + esc(g.ch.host) + ' · ' : ''}${new Date(g.ch.created).toLocaleString()} · route ${len.toFixed(0)}° of slewing${g.missing ? ` · ${g.missing} target(s) not in this app version` : ''}</p>
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
    if (d <= 3 * R) nextTarget(true, d <= R ? 'auto' : 'manual'); else { cue.miss(); toast(`The sensors put you ${d.toFixed(1)}° away — keep looking`); }
  };
  $('#g-quit').onclick = () => { if (confirmTwice('g-quit')) { game = null; renderGame(); } };
}
function updateGame() {
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
  st.textContent = g.dw.since != null ? `On target — hold steady ${Math.max(0, 2 - (Date.now() - g.dw.since) / 1000).toFixed(1)} s` : (showArrows ? `${gd.sep.toFixed(1)}° away` : 'Find it from the chart');
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
    <p class="muted small">Run these on the scope with the phone in its bridge mount unless the test says otherwise. Results are saved below and can be exported.</p>
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
    el.innerHTML = head + `<p>Four short steps, no stars needed — do it outdoors in daylight or at dusk. You'll need a table, the scope set up with the phone in its bridge mount, and a distant landmark low on the horizon.</p>
      <label class="row"><span>Phone make & model</span><input id="c-phone" value="${esc(test.phone)}" placeholder="e.g. Pixel 8, iPhone 13"></label>
      <label class="row"><span>Grade against eyepiece</span><select id="c-ep">${profile().eyepieces.map((e, i) => `<option value="${i}" ${i === test.epIdx ? 'selected' : ''}>${esc(e.name)} — ${(tfov(e) * 60).toFixed(0)}′ field</option>`).join('')}</select></label>
      <div class="card kv"><span>Gyroscope</span><span id="c-gyro">${gy === true ? 'present' : gy === false ? '<span class="bad">not found</span>' : 'checking…'}</span>
        <span>Update rate</span><span id="c-rate">${sensors.rateHz ? sensors.rateHz.toFixed(0) + ' Hz' : '…'}</span>
        <span>Compass</span><span id="c-comp">${sensors.hasCompass ? (sensors.compassSource || 'present') : 'checking…'}</span></div>
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
      <p>Put the phone in the bridge mount. Point the scope anywhere comfortable (not straight up), then let go of the scope and the tripod completely.</p>
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
function renderSetup() {
  const el = $('#tab-setup'); const p = profile();
  el.innerHTML = `${BACK}
    <h2>Telescope</h2>
    <label class="row"><span>Scope</span><select id="s-prof">${Object.entries(state.profiles).map(([k, v]) => `<option value="${k}" ${k === state.active ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
    <label class="row"><span>Focal length (mm)</span><input id="s-fl" type="number" inputmode="decimal" value="${p.fl}"></label>
    <label class="row"><span>Aperture (mm)</span><input id="s-ap" type="number" inputmode="decimal" value="${p.aperture}"></label>
    <label class="row"><span>Focuser position <span class="muted small">(behind the scope, tube level)</span></span><select id="s-foc">${[[-90, 'Left side'], [-45, 'Upper left'], [0, 'Top'], [45, 'Upper right'], [90, 'Right side']].map(([v, l]) => `<option value="${v}" ${(p.focuser ?? 90) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="muted small">${esc(p.source || '')}</p>
    <h3>Eyepieces</h3>
    <table class="res"><tr><th>Name</th><th>mm</th><th>AFOV°</th><th>Field</th><th>Cycle</th><th></th></tr>
      ${p.eyepieces.map((e, i) => `<tr><td><input data-epn="${i}" value="${esc(e.name)}"></td><td><input data-epf="${i}" type="number" value="${e.fl}" style="width:60px"></td><td><input data-epa="${i}" type="number" value="${e.afov}" style="width:60px"></td><td>${(tfov(e) * 60).toFixed(0)}′</td><td style="text-align:center"><input type="checkbox" data-epc="${i}" ${e.cycle !== false ? 'checked' : ''}></td><td><button data-epd="${i}">✕</button></td></tr>`).join('')}
    </table>
    <div class="btnrow"><button id="ep-add">Add eyepiece</button></div>
    <p class="muted small">The Eyepiece button on Push cycles through the ticked eyepieces in this order. Add your own, untick ones you don't carry, or delete them. To check any eyepiece's true field, time a star near the celestial equator drifting across it (scope still).</p>
    <label class="row"><span>Drift time (s)</span><input id="drift-s" type="number" inputmode="decimal" placeholder="e.g. 140"></label>
    <label class="row"><span>Star declination (°)</span><input id="drift-d" type="number" inputmode="decimal" placeholder="e.g. 0"></label>
    <div class="btnrow"><button id="drift-go">Set AFOV for selected eyepiece from drift</button></div>

    <details class="more"><summary>Phone mount and sensors (advanced)</summary>
    <label class="row"><span>Phone position</span><select id="s-mount">${Object.entries(MOUNTINGS).map(([k, v]) => `<option value="${k}" ${k === state.mounting ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
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
  $('#s-foc').onchange = (e) => { p.focuser = +e.target.value; save(); };
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
  $('#s-mount').onchange = (e) => { state.mounting = e.target.value; applyModelSettings(); align = { obs: [], fit: null, syncs: [], confirm: [] }; save(); toast('Mounting changed — re-align'); };
  $('#s-mode').onchange = (e) => { state.mode = e.target.value; save(); };
  $('#s-cc').onchange = () => { state.compassCorr = num('#s-cc') || 0; save(); };
  $('#s-rate').onchange = (e) => { state.useRate = e.target.checked; model.useRate = state.useRate; save(); };
  $('#s-smooth').onchange = (e) => { state.smooth = parseFloat(e.target.value); save(); };
  $('#s-clrcal').onclick = () => { p.cal = null; applyModelSettings(); save(); renderSetup(); };
  const site = () => { state.site = { lat: num('#s-lat'), lon: num('#s-lon'), elev: num('#s-el') || 0, source: 'entered manually' }; sky.setSite(state.site.lat, state.site.lon, state.site.elev); save(); };
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
    sky.setSite(state.site.lat, state.site.lon, state.site.elev); planRows = null; rateCache.clear(); save(); toast('Location set'); if (tab === 'setup') renderSetup(); if (tab === 'find') renderFind(); if (!$('#gate').classList.contains('hidden')) renderLaunch();
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
    ${log.length ? '' : '<p class="muted">Nothing logged yet. When a target is in the eyepiece, tap <b>Log</b> on the Push screen. Your Messier count and milestones build up here.</p>'}
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
function openObject(key, opt = {}) {
  const o = objByKey(key); if (!o) return;
  refreshSky(false);
  const box = $('#sheet'), card = $('#sheet-card');
  const row = opt.row || null, r = row || (o.alt > 0 ? rateNow(o) : null);
  const blurb = blurbFor(o), last = lastEntry(state.log, key), seen = seenSet().has(key);
  const inPlan = planList().some((x) => x.key === key && !x.sync), isTarget = !o.key.startsWith('st:') || o.show;
  card.innerHTML = `<div class="sheet-h"><div><div class="target-h"><span class="name">${esc(o.label)}</span>${o.name ? `<span class="cname">${esc(o.name)}</span>` : ''}</div>
      <div class="muted small">${esc(kindLabel(o))}${o.con ? ' in ' + esc(fullCon(o.con)) : ''}${o.key.startsWith('dso:') && o.label !== o.id ? ' · ' + esc(o.id) : ''}</div></div>
      <button class="ibtn" id="sh-x" aria-label="Close">✕</button></div>
    ${r ? `<p class="rateline"><span class="dots lv${r.level}">${DOTS[r.level]}</span> <b>${LEVEL_NAMES[r.level]}</b> ${row ? 'at its best in your session' : 'right now'} — ${esc(row ? row.desc : describe(o, r))}</p>` : (o.alt <= 0 ? '<p class="rateline muted">Below the horizon right now.</p>' : '')}
    ${blurb ? `<p class="blurb">${esc(blurb)}</p>` : ''}
    <div class="kv">
      ${row ? `<span>Best time</span><span>${hm(row.best)} · ${row.alt.toFixed(0)}° ${compassName(row.az)}</span>` : ''}
      <span>Right now</span><span>${o.alt > 0 ? `${o.alt.toFixed(0)}° up, ${compassName(o.az)}` : 'below the horizon'}</span>
      ${r && r.ep ? `<span>Best eyepiece</span><span>${esc(r.ep.name)} (${(profile().fl / r.ep.fl).toFixed(0)}×)</span>` : ''}
      ${o.mag != null ? `<span>Brightness</span><span>magnitude ${(+o.mag).toFixed(1)}</span>` : ''}
      ${sizeText(o) ? `<span>${o.maj ? 'Size' : 'Pair'}</span><span>${sizeText(o)}</span>` : ''}
      <span>Your log</span><span>${seen ? 'Seen ✓' : last ? RESULT[last.seen] : 'Not logged yet'}${last ? ' · ' + shortDate(last.t) : ''}</span>
    </div>
    <div class="btnrow"><button id="sh-go" class="primary">Push to it</button>${isTarget ? `<button id="sh-plan">${inPlan ? '✓ In plan — remove' : '+ Add to plan'}</button>` : ''}</div>
    ${isTarget ? `<div class="btnrow"><button id="sh-seen">${seen ? 'Log it again ✓' : 'Log as seen ✓'}</button></div>` : '<p class="muted small">A bright star for aligning and syncing.</p>'}`;
  box.classList.remove('hidden'); card.scrollTop = 0;
  box.onclick = (e) => { if (e.target === box) closeSheet(); };
  $('#sh-x').onclick = closeSheet;
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
    ${item('align', 'Alignment', state.mode === 'compass' ? 'Compass mode — no alignment needed' : alignedNow() ? `Aligned on ${align.obs.map((o) => esc(o.label)).join(' and ')} · ${syncAgo()}` : 'Not aligned yet — two minutes, and the app shows you which stars')}
    ${item('log', 'Observing log', st.total ? `${st.total} object${st.total === 1 ? '' : 's'} seen · Messier ${st.messier} of ${st.messierTotal}` : 'Nothing logged yet — your Messier count and milestones live here')}
    ${item('sky', 'Sky darkness check', state.skyq ? `${esc(state.skyq.label)} · ${shortDate(state.skyq.when)}` : '30 seconds — tunes the visibility ratings to your sky')}
    ${item('test', 'Phone check-up and sensor tests', chk ? `This phone: ${V[chk.result.verdict] || esc(chk.result.verdict)} · ${shortDate(chk.when)}` : 'Find out how accurate this phone can be — 4 minutes')}
    ${item('setup', 'Setup', `${esc(profile().name)} · eyepieces, location, phone mount`)}
    ${item('start', 'Start screen', 'Choose what to do and how it works')}
    <h3>Quick settings</h3>
    <label class="row"><span>Screen brightness</span><input id="m-br" type="range" min="0.25" max="1" step="0.05" value="${state.bright}" ${state.day ? 'disabled' : ''}></label>
    <label class="row"><span>Day look <span class="muted small">(off = Night, red only; the sun/moon button fades between them)</span></span><input id="m-day" type="checkbox" ${state.day ? 'checked' : ''}></label>
    <div style="padding:10px 0 4px">Sounds</div>
    <div class="seg" id="m-snd">${[['off', 'Off'], ['chime', 'Chime'], ['guide', 'Chime + ticks']].map(([k, l]) => `<button data-snd="${k}" class="${state.sound === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="muted small">Chime: a tone when the target enters your eyepiece's field. Ticks get faster as you close in, so you can watch the sky instead of the phone. On an iPhone the silent switch may mute both.</p>
    <p class="muted small">Keep screen awake: ${awakeText()}.</p>`;
  el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => {
    const k = b.dataset.go;
    if (k === 'sky') openSkyCheck(); else if (k === 'start') { renderLaunch(); $('#gate').classList.remove('hidden'); } else showTab(k);
  });
  $('#m-br').oninput = (e) => { state.bright = parseFloat(e.target.value); applyTheme(); save(); };
  $('#m-day').onchange = (e) => setShade(e.target.checked ? 0 : 1);
  el.querySelectorAll('[data-snd]').forEach((b) => b.onclick = () => { state.sound = b.dataset.snd; sound.mode = state.sound; save(); initSound(); cue.test(); renderMore(); });
}

let lastFrame = 0;
function loop(ts) {
  if (ts - lastFrame > 66) {
    lastFrame = ts; refreshSky(false);
    try { updateStatus(); if (tab === 'push') updatePush(); if (tab === 'align') updateAlign(); if (tab === 'game') updateGame(); updateTest(); } catch (e) { console.error(e); }
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- LAUNCH: pick an activity, tick the warm-up steps
const ACTIVITIES = [
  ['observe', 'Observe', 'Follow the arrows to targets', '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'],
  ['explore', 'Explore', 'Wander the sky, no set-up', '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 16l.6 1.9 1.9.6-1.9.6L19 21l-.6-1.9-1.9-.6 1.9-.6z"/>'],
  ['game', 'Play', 'Ten targets against the clock', '<circle cx="12" cy="14" r="7"/><path d="M12 14v-4M10 3h4M12 3v4M18.5 7.5 20 6"/>'],
  ['plan', 'Plan', 'Pick targets for a night out', '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L6.8 5M3.5 12l1.2 1.2L6.8 11M3.5 18l1.2 1.2L6.8 17"/>'],
];
const STEP_INFO = {
  check: ['Phone check-up', '4 min, once per phone — how far to trust the arrows'],
  sky: ['Sky darkness check', '30 s — count Little Dipper stars'],
  align: ['Star alignment', '2 min — point at two bright stars'],
};
/** The stops that make sense on the way to each activity. Planning and exploring need no phone check-up. */
const PATH = { observe: ['check', 'sky', 'align'], game: ['check', 'align'], explore: ['sky'], plan: ['sky'], resume: ['check', 'sky', 'align'] };
const GO = { observe: 'Start observing', explore: 'Start exploring', game: 'Start the game', plan: 'Start planning' };
let flow = null;   // { steps: [..], i, dest, started, quiet }
const stepsFor = (dest) => (PATH[dest] || []).filter((k) => state.launch[k] && !(k === 'align' && alignedNow()));
/** "Dark from 6:32 PM · Moon 27% lit, sets 8:58 PM · Saturn and Jupiter are up" */
function tonightLine() {
  try {
    const now = new Date(), sun = sky.sunAlt(now), n = sky.night(now.getHours() < 12 ? new Date(now.getTime() - 12 * 3600000) : now);
    const dark = n.astro || n.naut, m = sky.moonInfo(now);
    const when = sun > -18 && dark && now < dark ? `${sun > 0 ? 'Daylight now — dark' : 'Getting dark — fully dark'} from ${hm(dark)}`
      : sun <= -18 ? `Dark now${n.astroAm ? ', until ' + hm(n.astroAm) : ''}` : sun > 0 ? 'Daylight' : 'Twilight';
    const moon = `Moon ${Math.round(m.frac * 100)}% lit${m.alt > 0 ? (n.moonSet && n.moonSet > now ? ', sets ' + hm(n.moonSet) : ', up') : (n.moonRise && n.moonRise > now ? ', rises ' + hm(n.moonRise) : ', down')}`;
    const at = dark && now < dark ? dark : now;
    const up = ['Venus', 'Jupiter', 'Saturn', 'Mars'].filter((p) => { const o = sky.objects.find((x) => x.key === 'pl:' + p); return o && sky.altAz(o, at).alt > 15; });
    return [when, moon, up.length ? `${up.join(' and ')} ${up.length > 1 ? 'are' : 'is'} up` : ''].filter(Boolean).join(' · ');
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
  };
  const act = ACTIVITIES.some((x) => x[0] === state.launchAct) ? state.launchAct : 'observe', stops = PATH[act];
  $('#launch').innerHTML = `<div class="lhead"><h1>Skyward <span>Push-To</span></h1><button class="hbtn shadebtn" id="l-shade" aria-label="Day or night look"></button></div>
    <p class="tonight">${esc(tonightLine())}</p>
    ${pp && pp.next ? `<button id="l-resume" class="primary" style="width:100%;margin:6px 0 2px">Carry on with your plan — ${pp.done} of ${pp.total} done</button>` : ''}
    <h3 class="lq">What are we up to?</h3>
    <div class="lgrid">${ACTIVITIES.map(([k, t, sub, ic]) => `<button class="act${k === act ? ' on' : ''}" data-act="${k}"><svg class="ic" viewBox="0 0 24 24">${ic}</svg><b>${t}</b><span class="muted">${sub}</span></button>`).join('')}</div>
    <div class="path">
      <div class="pnote">${stops.some((k) => k !== 'sky') ? 'Your path — tap a star to skip a stop' : 'Nothing to set up. One optional stop:'}</div>
      ${stops.map((k) => `<label class="stop"><input type="checkbox" data-step="${k}" ${L[k] ? 'checked' : ''}><span><b>${STEP_INFO[k][0]}</b><span class="muted">${esc(L[k] ? status[k] : 'skipped')}</span></span></label>`).join('')}
      <div class="stop end"><span class="dest"></span><button id="l-go" class="primary">${GO[act]}</button></div>
    </div>
    <details class="more"><summary>How it works</summary>
      <ol class="how"><li><b>Clip the phone into the bridge mount</b> — screen up, top of the phone toward the sky end of the tube.</li>
      <li><b>Align on two bright stars.</b> The app tells you which ones and where to look.</li>
      <li><b>Pick a target and follow the arrows.</b> A chime tells you when it should be in the eyepiece.</li>
      <li><b>Tap Sync whenever you centre something.</b> It keeps the pointing accurate all night.</li></ol>
      <p class="muted small">Works offline. Add it to your Home Screen for a full-screen app.</p></details>`;
  $('#launch').querySelectorAll('[data-step]').forEach((c) => c.onchange = () => { state.launch[c.dataset.step] = c.checked; save(); renderLaunch(); });
  $('#launch').querySelectorAll('[data-act]').forEach((b) => b.onclick = () => { state.launchAct = b.dataset.act; save(); renderLaunch(); });
  $('#l-go').onclick = () => launch(act);
  $('#l-shade').onclick = (e) => { e.stopPropagation(); openShade(); };
  if ($('#l-resume')) $('#l-resume').onclick = () => launch('resume');
  applyTheme();
}
function launch(dest) {
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
const SKY_ANSWERS = [
  [2.8, 'Only Polaris and Kochab (2)'], [3.5, 'Those plus Pherkad (3)'], [4.3, '4 to 6 of them'],
  [5.0, 'All 7'], [5.7, 'All 7, plus faint stars inside the bowl'],
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
  const P = UMI.map(([n, ra, dec, m]) => ({ n, m, ...sky.altAzRaDec(ra, dec) }));
  const a0 = P.reduce((s, p) => s + p.alt, 0) / P.length, z0 = P[0].az;
  const xy = P.map((p) => ({ ...p, x: (((p.az - z0 + 540) % 360) - 180) * Math.cos(a0 * Math.PI / 180), y: -(p.alt - a0) }));
  const xs = xy.map((p) => p.x), ys = xy.map((p) => p.y), cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1, sc = 220 / span;
  const pt = (p) => [150 + (p.x - cx) * sc, 150 + (p.y - cy) * sc];
  const lines = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]];
  const sun = sky.sunAlt();
  card.innerHTML = `<h3 style="margin-top:0">Sky darkness check</h3>
    <p class="small">Face north. The Little Dipper hangs from <b>Polaris</b>, ${P[0].alt.toFixed(0)}° up — about where your latitude puts it. Give your eyes 10 minutes away from screens and lights first.${sun > -12 ? ' <b>It isn\'t fully dark yet</b>, so this will read brighter than your real sky.' : ''}</p>
    <svg viewBox="0 0 300 300" class="umi">${lines.map(([i, j]) => { const [x1, y1] = pt(xy[i]), [x2, y2] = pt(xy[j]); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }).join('')}
      ${xy.map((p) => { const [x, y] = pt(p); return `<circle cx="${x}" cy="${y}" r="${(7 - p.m) * 1.3}"/><text x="${x + 9}" y="${y + 4}">${p.n}</text>`; }).join('')}
      <text x="150" y="294" text-anchor="middle" class="muted">as it looks now · up is overhead</text></svg>
    <p class="small"><b>How many of these 7 stars can you see?</b></p>
    ${SKY_ANSWERS.map(([m, t]) => `<button class="sq-a" data-m="${m}" style="width:100%;margin:3px 0;text-align:left">${t}</button>`).join('')}
    <button id="sq-skip" style="width:100%;margin-top:6px">Can't see it (cloud, trees, not dark) — skip</button>`;
  card.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
    const m = +b.dataset.m, [label, means] = skyLabel(m);
    state.skyq = { nelm: m, label, when: Date.now(), lat: state.site.lat, lon: state.site.lon, twilight: sun > -12 }; planRows = null; save(); if (tab === 'plan') renderPlan();
    card.innerHTML = `<h3 style="margin-top:0">${label}</h3><p>Faintest stars you can see: about magnitude ${m.toFixed(1)}.</p><p class="small">${means}</p>
      <button id="sq-done" class="primary" style="width:100%">${flow ? 'Continue' : 'Done'}</button>`;
    $('#sq-done').onclick = () => { if (flow) return flowNext(); box.classList.add('hidden'); rateCache.clear(); if (tab === 'more') renderMore(); if (tab === 'find') renderFind(); };
  });
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
      window.simGoto = (k, dAlt = 0, dAz = 0) => { const o = typeof k === 'string' ? sky.objects.find((x) => x.key === k || x.label === k) : null; const t = o ? sky.altAz(o) : k; if (!t) return null; sensors.beta = t.alt + dAlt; sensors.alpha = wrap360(sensors.trueOffset - (t.az + dAz)); return { alt: t.alt, az: t.az }; };
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
  $('#gate-msg').innerHTML = `<div class="gate-err">${fix}</div>`;
  $('#gate-skip').classList.remove('hidden');
  if (!IS_IOS) $('#gate-sim').classList.remove('hidden');
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
