// The phone camera as a star finder: open it, collect light, find the sky and the stars, and solve where it points.
// Browser-side glue around skycam.js (what is sky, where are the stars, how much light) and solve.js (which stars they are).

import { skyMask, findStars, planIntegration, skyWord, drawRejected, halfLum, registerStars, addFrame, dropHot } from './skycam.js';
import { makeIndex, solveField } from './solve.js';

export const MAX_LIGHT = 12;       // most seconds of light to collect
export const MAX_WAIT = 30;        // most seconds to keep the user waiting
export const fmtSec = (s) => s >= 0.1 ? `${s.toFixed(2)} s` : `1/${Math.round(1 / s)} s`;
export const hms = (ra) => { const t = ra / 15, hh = Math.floor(t), mm = Math.floor((t - hh) * 60); return `${hh}h ${String(mm).padStart(2, '0')}m`; };

let index = null;
export const starIndex = (FIELD) => index || (index = makeIndex(FIELD));

export class SkyCamera {
  constructor(video, overlay) { this.v = video; this.ov = overlay; this.stream = null; this.track = null; this.log = []; this.busy = false; this.alive = false; }
  get on() { return !!(this.track && this.track.readyState === 'live'); }
  async _try(label, c) { try { await this.track.applyConstraints(c); this.log.push(`set ${label}: ok`); return true; } catch (e) { this.log.push(`set ${label}: refused (${e.name})`); return false; } }

  /** Open the back camera and ask for manual exposure, top gain and far focus wherever the browser offers them. */
  async open() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser will not give the app the camera.');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    this.track = this.stream.getVideoTracks()[0]; this.log = [];
    const caps = this.caps();
    if (caps.exposureMode && caps.exposureMode.includes('manual') && caps.exposureTime && caps.exposureTime.max) {
      await this._try(`manual exposure ${caps.exposureTime.max}`, { advanced: [{ exposureMode: 'manual', exposureTime: caps.exposureTime.max }] });
      const got = this.track.getSettings().exposureTime; if (got && caps.frameRate) { const fps = Math.min(30, Math.max(caps.frameRate.min || 1, 10000 / got)); await this._try(`frame rate ${fps.toFixed(1)} to match the exposure`, { frameRate: { ideal: fps } }); }
    } else this.log.push('manual exposure: not offered');
    if (caps.iso && caps.iso.max) await this._try(`ISO ${caps.iso.max}`, { advanced: [{ iso: caps.iso.max }] }); else this.log.push('ISO: not offered');
    if (caps.exposureCompensation && caps.exposureCompensation.max && !(caps.exposureMode && caps.exposureMode.includes('manual'))) await this._try(`exposure compensation ${caps.exposureCompensation.max}`, { advanced: [{ exposureCompensation: caps.exposureCompensation.max }] });
    if (caps.focusMode && caps.focusMode.includes('manual') && caps.focusDistance && caps.focusDistance.max) await this._try(`focus far (${caps.focusDistance.max})`, { advanced: [{ focusMode: 'manual', focusDistance: caps.focusDistance.max }] });
    else this.log.push('manual focus: not offered');
    if (caps.torch) await this._try('torch off', { advanced: [{ torch: false }] });
    this.v.srcObject = this.stream; await this.v.play().catch(() => {});
    this.alive = true; this._live();
  }
  caps() { return this.track && this.track.getCapabilities ? this.track.getCapabilities() : {}; }
  close() { this.alive = false; if (this.stream) for (const t of this.stream.getTracks()) t.stop(); this.stream = null; this.track = null; if (this.v) this.v.srcObject = null; }

  // A genuinely new frame, timed by the wall clock (the video's own clock is not trustworthy: Safari reported 1/30 s gaps
  // while delivering one frame a second).
  _next() {
    const v = this.v;
    return new Promise((res) => {
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => res(performance.now() / 1000));
      else { const t0 = v.currentTime; const tick = () => { if (!this.alive || v.currentTime !== t0) res(performance.now() / 1000); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    });
  }
  async _gap(n) { const times = []; let prev = await this._next(); for (let i = 0; i < n; i++) { const t = await this._next(); times.push(t - prev); prev = t; } times.sort((a, b) => a - b); return times.length ? times[times.length >> 1] : 1 / 30; }
  _small() {
    const v = this.v, k = 480 / Math.max(v.videoWidth, v.videoHeight), w = Math.max(16, Math.round(v.videoWidth * k)), h = Math.max(16, Math.round(v.videoHeight * k));
    const c = this._sc || (this._sc = document.createElement('canvas')); c.width = w; c.height = h; const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(v, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data, lum = new Float32Array(w * h); for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = d[j] + d[j + 1] + d[j + 2];
    return { lum, w, h };
  }
  // Brightness of the SKY ONLY. Everything about exposure is decided from this, never from trees, walls or lamps.
  async _skyLevel(frames) { let tot = 0; for (let k = 0; k < frames; k++) { await this._next(); const g = this._small(); tot += skyMask(g.lum, g.w, g.h).level; } return tot / frames; }
  // Grey stripes over the live view, refreshed about once a second while idle.
  async _live() {
    while (this.alive && this.on) {
      if (!this.busy && this.v.videoWidth && this.ov && this.ov.isConnected) { const g = this._small(), m = skyMask(g.lum, g.w, g.h); this.ov.width = g.w; this.ov.height = g.h; const c = this.ov.getContext('2d'); c.clearRect(0, 0, g.w, g.h); drawRejected(c, m, g.w, g.h); }
      await new Promise((r) => setTimeout(r, 1100));
    }
  }
  // When the phone will not say how long each frame is exposed, find out by experiment: slow the frame rate step by step
  // and watch whether the sky gets brighter. In the dark the phone is already at full gain, so brighter means longer.
  async _probe(status) {
    const caps = this.caps(), lo = Math.max(1, (caps.frameRate && caps.frameRate.min) || 1), hi = Math.min(30, (caps.frameRate && caps.frameRate.max) || 30);
    const rates = [30, 10, 4, 2, 1].filter((r) => r <= hi && r >= lo), rows = []; if (!rates.length) rates.push(hi);
    let best = null;
    for (const r of rates) {
      status(`Finding the longest exposure the camera allows: trying ${r} frames a second…`);
      try { await this.track.applyConstraints({ frameRate: { ideal: r } }); } catch (e) { rows.push({ rate: r, refused: true }); continue; }
      await new Promise((res) => setTimeout(res, Math.max(1300, 2500 / r)));
      const gap = await this._gap(r >= 10 ? 8 : 3), level = await this._skyLevel(r >= 10 ? 3 : 2), row = { rate: r, gap, level }; rows.push(row);
      if (!best) { best = row; row.time = Math.min(gap, 1 / 30); continue; }
      const gain = level / Math.max(best.level, 0.5); row.time = Math.min(gap, best.time * gain);
      if (gain >= 1.25 && level < 765 * 0.2) best = row; else break;       // no brighter, or the sky is as bright as is useful
    }
    if (best.rate !== rows[rows.length - 1].rate) { try { await this.track.applyConstraints({ frameRate: { ideal: best.rate } }); } catch (e) {} await new Promise((res) => setTimeout(res, Math.max(1300, 2500 / best.rate))); best.gap = await this._gap(best.rate >= 10 ? 8 : 3); }
    return { best, rows };
  }

  /**
   * Collect light until the sky shows enough stars (or patience runs out), then solve.
   * opts: { FIELD, prior: {ra, dec, radius} | null, status(text), progress(0..1), align (default true),
   *         onReference() — called when the reference frame is taken; the solved position is where the camera pointed then }
   */
  async find(opts) {
    const v = this.v, status = opts.status || (() => {}), progress = opts.progress || (() => {});
    if (this.busy) return null; this.busy = true;
    try {
      const w = v.videoWidth, h = v.videoHeight; if (!w || !h) throw new Error('The camera has not produced a picture yet. Wait a second and try again.');
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d', { willReadFrequently: true });
      status('Measuring the frame time…');
      const st0 = this.track.getSettings(), caps = this.caps(); let frameTime, source, interval, probe = null;
      if (st0.exposureTime) { frameTime = st0.exposureTime / 10000; source = 'reported by the camera'; interval = await this._gap(6); }
      else if (this._known) { ({ frameTime, source, interval, probe } = this._known); }           // the trial was done earlier this session
      else {
        probe = await this._probe(status); interval = probe.best.gap; frameTime = probe.best.time;
        source = probe.best.rate >= 30 || probe.rows.length < 2 ? 'not reported; slowing the frame rate did not brighten the sky, so assumed 1/30 s at most' : `not reported; estimated from how much brighter the sky got at ${probe.best.rate} frames a second`;
        this._known = { frameTime, source, interval, probe };
      }
      frameTime = Math.min(Math.max(frameTime, 1 / 2000), 4);
      const src = { next: async () => { await this._next(); if (!this.alive) return null; cx.drawImage(v, 0, 0, w, h); return cx.getImageData(0, 0, w, h).data; }, canSet: !!st0.exposureTime, maxFrameTime: caps.exposureTime ? caps.exposureTime.max / 10000 : frameTime };
      const { avg, an, plan, N, reg, checks, took, collected } = await collectLight(src, w, h, frameTime, opts, status, progress);
      status('Matching the stars to the star map…'); await new Promise((r) => setTimeout(r, 30));
      const sc = opts.scale && (!opts.scale.w || (opts.scale.w === w && opts.scale.h === h)) ? opts.scale : null;      // a remembered scale belongs to one picture size
      const s = await solveInBackground(an, w, h, opts.FIELD, opts.prior, sc);
      return { reg, lum: avg, w, h, an, sol: s.sol, ms: s.ms, usedPrior: s.usedPrior, usedScale: s.usedScale, skipped: s.skipped, timedOut: s.timedOut, workerError: s.workerError, inWorker: s.inWorker, scaleHint: sc, plan, frameTime, source, interval, probe, N, collected, took, checks, log: this.log.slice(), settings: this.track.getSettings(), caps, label: this.track.label };
    } finally { this.busy = false; }
  }
}

/**
 * Collect light until the sky shows enough stars or patience runs out. Shared by the web camera and the native one.
 * src: { next(): Promise<RGBA Uint8ClampedArray | null>, canSet, maxFrameTime }
 */
export async function collectLight(src, w, h, frameTime, opts, status, progress) {
  if (opts.hotSize && (opts.hotSize.w !== w || opts.hotSize.h !== h)) opts = { ...opts, hot: null };      // the hot-pixel list belongs to one picture size
  const sum = new Float32Array(w * h), cnt = new Uint16Array(w * h), avg = new Float32Array(w * h); let N = 0, plan = null, an = null; const checks = [];
  // Lining frames up. The first frame is the reference; each later frame's brightest stars say how far it has moved.
  // When several frames in a row have not moved, the phone is steady and only every sixth frame is checked.
  const reg = { on: opts.align !== false, ref: null, seen: 0, rejected: 0, moved: 0, maxShift: 0, steady: 0, note: '' };
  const quick = (d) => { const hl = halfLum(d, w, h); return dropHot(findStars(hl.lum, hl.w, hl.h, null, 8).stars, opts.hot, 0.5).slice(0, 14); };      // hot pixels would vote for 'no movement'
  const mean = () => { for (let i = 0; i < sum.length; i++) avg[i] = cnt[i] ? sum[i] / cnt[i] : 0; };
  const t0 = performance.now(), batch = Math.max(1, Math.round(0.5 / frameTime));
  for (;;) {
    const d = await src.next(); if (!d) throw new Error('The camera was closed.');
    let tf = null, use = true; reg.seen++;
    if (reg.on) {
      if (!reg.ref) { reg.ref = quick(d); if (opts.onReference) opts.onReference();      // the solution will describe THIS frame: note the phone's attitude now
        if (reg.ref.length < 2) { reg.on = false; reg.note = 'too few stars in a single frame to line frames up, so they were added as they came'; } }
      else if (reg.steady < 4 || reg.seen % 6 === 0) {
        const r = registerStars(reg.ref, quick(d), w >> 1, h >> 1);
        if (!r) { use = false; reg.rejected++; reg.steady = 0; }
        else { tf = { dx: r.dx * 2, dy: r.dy * 2, rot: r.rot }; const sh = Math.hypot(tf.dx, tf.dy) + Math.abs(tf.rot) * Math.hypot(w, h) / 2; reg.maxShift = Math.max(reg.maxShift, sh); if (sh < 0.5) { reg.steady++; tf = null; } else { reg.steady = 0; reg.moved++; reg.last = tf; } }
      } else tf = null;
    }
    if (use) { addFrame(sum, cnt, d, w, h, tf); N++; }
    const collected = N * frameTime, waited = (performance.now() - t0) / 1000, last = collected >= MAX_LIGHT || waited >= MAX_WAIT;
    progress(Math.min(1, collected / (plan ? Math.max(plan.total, collected) : 2)));
    if (!N) { if (last) throw new Error('The picture never held still long enough to use.'); continue; }
    if ((use && N % batch === 0) || last) {
      mean();
      an = analyse(avg, w, h, opts.hot);
      plan = planIntegration({ level: an.mask.level, noise: an.mask.noise, frameTime, collected, snrs: an.cand.map((s) => s.snr), canSetExposure: !!src.canSet, maxFrameTime: src.maxFrameTime || frameTime, maxTotal: MAX_LIGHT });
      checks.push(`${collected.toFixed(2)} s: ${plan.good} clear, ${an.cand.length} possible → ${plan.done ? 'enough' : `aim for ${plan.total.toFixed(1)} s`}`);
      status(`Sky is ${plan.sky}. ${collected.toFixed(1)} s of light, ${plan.good} clear stars${reg.moved ? ', lining up a moving picture' : ''}. ${plan.done ? 'Enough.' : `Collecting to about ${plan.total.toFixed(1)} s…`}`);
      if (plan.done || collected >= plan.total - 1e-6 || last) break;
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  if (!reg.note) reg.note = !reg.on ? 'switched off' : reg.moved || reg.rejected ? `the picture moved up to ${reg.maxShift.toFixed(1)} px; ${reg.moved} frame${reg.moved === 1 ? '' : 's'} shifted into place, ${reg.rejected} left out as smeared or unmatched` : 'the picture held still, nothing to correct';
  return { avg, an, plan, N, reg, checks, took: (performance.now() - t0) / 1000, collected: N * frameTime };
}

/**
 * The same job through the native plug-in (iPhone app): here the app SETS the exposure time and gain.
 * plugin: window.Capacitor.Plugins.SkyCam — open(), setExposure({seconds, iso}), frame(), close().
 * Draws its own preview into a canvas, because there is no <video> for a native camera.
 */
/** Sky level and noise of a frame (RGBA or brightness), from a reduced copy, judged on the sky only. */
function levelOf(fr) {
  const k = Math.max(1, Math.round(Math.max(fr.w, fr.h) / 480)), w = Math.floor(fr.w / k), h = Math.floor(fr.h / k), lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) { const i = (y * k + yy) * fr.w + x * k + xx; s += fr.lum ? fr.lum[i] : fr.rgba[4 * i] + fr.rgba[4 * i + 1] + fr.rgba[4 * i + 2]; }
    lum[y * w + x] = s / (k * k);
  }
  return skyMask(lum, w, h);
}

export class NativeSkyCamera {
  constructor(plugin, canvas, overlay) { this.p = plugin; this.v = canvas; this.ov = overlay; this.stream = null; this.isNative = true; this.log = []; this.busy = false; this.alive = false; this.opened = false; this.info = null; this.set = null; }
  get on() { return this.opened; }
  async open() {
    this.info = await this._call('open', {}, 20000); this.opened = true; this.alive = true;
    this.log = [`native camera: ${this.info.camera}${this.info.raw ? ', RAW' : ', no RAW (processed frames)'}, exposure ${fmtSec(this.info.minExposure)} to ${fmtSec(this.info.maxExposure)}, ISO ${Math.round(this.info.minISO)}–${Math.round(this.info.maxISO)}, lens ${Number(this.info.fieldOfView).toFixed(0)}° wide${this.info.formatInfo ? `; format ${this.info.formatInfo}` : ''}`];
    await this._expose(Math.min(this.info.maxExposure, 0.1), this.info.maxISO * 0.6);
    this._live();
  }
  async close() { this.alive = false; this.opened = false; try { await this.p.close(); } catch (e) {} }
  // Every call into the plug-in gets a time limit, so a frame that never arrives shows an error instead of hanging.
  // On a time-out, ask the camera how it is doing and add that to the message (and to the log for the report).
  async _call(name, args, ms) {
    let timer = null;
    try { return await Promise.race([this.p[name](args), new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error(`the camera did not answer (${name}) within ${Math.round(ms / 1000)} s`), { timeout: true })), ms); })]); }
    catch (e) {
      let st = '';
      if (e.timeout && this.p.status) { try { const s = await Promise.race([this.p.status(), new Promise((r) => setTimeout(() => r(null), 3000))]); st = s ? ` [${s.state}]` : ' [the camera did not answer a status check either]'; } catch (x) {} }
      const m = `${e.message || e}${st}`; this.log.push(`${name} FAILED: ${m}`); throw new Error(m);
    } finally { clearTimeout(timer); }
  }
  async _expose(seconds, iso) {
    this.set = await this._call('setExposure', { seconds, iso }, 8000 + 2000 * seconds);
    this.log.push(`set exposure ${fmtSec(this.set.exposure)}, ISO ${Math.round(this.set.iso)}${this.set.confirmed === false ? ` (NOT confirmed by the camera: ${this.set.state})` : ''}`); return this.set;
  }
  // A frame for measuring: RAW when the camera offers it (linear, no noise reduction or sharpening, averaged 2×2 by the
  // plug-in), returned as brightness 0..765 so the rest of the app reads it like any other frame. Otherwise a preview frame.
  async _sci() {
    if (!this.info.raw) return this._frame();
    const f = await this._call('raw', { bin: 4 }, 1000 * ((this.set && this.set.exposure) || 1) + 15000), bin = atob(f.data), n = bin.length >> 1, lum = new Float32Array(n), k = 765 / 65535;
    for (let i = 0, j = 0; i < n; i++, j += 2) lum[i] = (bin.charCodeAt(j) | (bin.charCodeAt(j + 1) << 8)) * k;
    await new Promise((r) => setTimeout(r, 0));              // let the screen catch up between frames
    return { lum, w: f.width, h: f.height, exposure: f.exposure, iso: f.iso, raw: true, method: f.method || 'developed', bin: f.bin || 2, black: f.black, white: f.white, stats: f.stats || '' };
  }
  // One preview frame as RGBA (grey), so the rest of the app treats it exactly like a web-camera frame.
  async _frame() {
    const f = await this._call('frame', {}, 1000 * ((this.set && this.set.exposure) || 1) + 8000), bin = atob(f.data), n = bin.length, rgba = new Uint8ClampedArray(n * 4);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const y = bin.charCodeAt(i); rgba[j] = y; rgba[j + 1] = y; rgba[j + 2] = y; rgba[j + 3] = 255; }
    return { rgba, w: f.width, h: f.height, exposure: f.exposure, iso: f.iso };
  }
  _show(fr) {
    const cv = this.v; if (!cv || !cv.isConnected) return;
    const k = 480 / Math.max(fr.w, fr.h), w = Math.round(fr.w * k), h = Math.round(fr.h * k), big = this._bc || (this._bc = document.createElement('canvas'));
    let rgba = fr.rgba;
    if (!rgba) {                                        // a linear RAW frame: brighten for the eye (square root), for display only
      rgba = new Uint8ClampedArray(fr.w * fr.h * 4); for (let i = 0, j = 0; i < fr.lum.length; i++, j += 4) { const g = 255 * Math.sqrt(Math.min(1, fr.lum[i] / 765)); rgba[j] = rgba[j + 1] = rgba[j + 2] = g; rgba[j + 3] = 255; }
    }
    big.width = fr.w; big.height = fr.h; big.getContext('2d').putImageData(new ImageData(rgba, fr.w, fr.h), 0, 0);
    cv.width = w; cv.height = h; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(big, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data, lum = new Float32Array(w * h); for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = d[j] + d[j + 1] + d[j + 2];
    const m = skyMask(lum, w, h);
    if (this.ov && this.ov.isConnected) { this.ov.width = w; this.ov.height = h; const c = this.ov.getContext('2d'); c.clearRect(0, 0, w, h); drawRejected(c, m, w, h); }
    return m;
  }
  async _live() {
    while (this.alive) {
      if (!this.busy) { try { this._show(await this._frame()); } catch (e) { /* closed, or between settings */ } }
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  /**
   * Choose the exposure from the SKY ONLY, then collect light and solve. Same options and result as SkyCamera.find().
   * The sky background is the yardstick: aim for roughly a tenth of full scale. A dark sky gets the longest exposure the
   * camera allows; a light-polluted or moonlit one gets a shorter exposure, and lower gain if that is still too bright.
   */
  async find(opts) {
    const status = opts.status || (() => {}), progress = opts.progress || (() => {});
    if (this.busy) return null; this.busy = true;
    try {
      const I = this.info; let exp = this.set.exposure, iso = this.set.iso, fr = null; const trial = [];
      for (let k = 0; k < 5; k++) {
        status(`Reading the sky to choose the exposure (${fmtSec(exp)})…`);
        try { fr = await this._sci(); }
        catch (e) {
          // A RAW photo that fails is not the end: carry on with the camera's preview frames (processed, but they work).
          if (!this.info.raw) throw e;
          this.info.raw = false; this.log.push(`RAW photos failed, so using preview frames instead`); status('RAW photos failed; using the preview frames instead…');
          fr = await this._sci();
        }
        this._show(fr); const m = levelOf(fr), frac = m.level / 765;
        trial.push(`${fmtSec(fr.exposure)} ISO ${Math.round(fr.iso)}: sky ${m.level.toFixed(1)}`);
        if (fr.stats) this.log.push(`RAW check at ${fmtSec(fr.exposure)} ISO ${Math.round(fr.iso)}: ${fr.stats}`);
        const p = planIntegration({ level: m.level, noise: m.noise, frameTime: fr.exposure, collected: fr.exposure, canSetExposure: true, maxFrameTime: I.maxExposure });
        let want = Math.min(I.maxExposure, Math.max(I.minExposure, p.wantedFrameTime)), wantIso = iso;
        if (fr.raw && frac > 0.20) {
          // RAW frames each cost a photo, so under a bright sky turn the GAIN down first and keep frames long (fewer of them,
          // and more room before stars saturate); only shorten the exposure once the gain is as low as it goes.
          const need = 0.11 / frac; wantIso = Math.max(I.minISO, iso * need); want = Math.min(I.maxExposure, Math.max(I.minExposure, fr.exposure * need * iso / wantIso));
        } else if (frac > 0.20 && want <= 1 / 25) wantIso = Math.max(I.minISO, iso * 0.11 / frac);          // already short and still bright: turn the gain down
        if (frac < 0.06 && fr.exposure >= I.maxExposure * 0.98) wantIso = Math.min(I.maxISO, iso * Math.min(2, 0.11 / Math.max(frac, 0.01)));   // as long as it goes and still dark: turn it up
        if (Math.abs(want / fr.exposure - 1) < 0.25 && Math.abs(wantIso / iso - 1) < 0.2) break;
        const s = await this._expose(want, wantIso); exp = s.exposure; iso = s.iso;
      }
      const frameTime = fr.exposure, w = fr.w, h = fr.h; let first = fr;
      const src = { next: async () => { if (!this.alive) return null; if (first) { const f = first; first = null; return f.lum || f.rgba; } const f = await this._sci(); this._show(f); return f.lum || f.rgba; }, canSet: true, maxFrameTime: I.maxExposure };
      const { avg, an, plan, N, reg, checks, took, collected } = await collectLight(src, w, h, frameTime, opts, status, progress);
      status('Matching the stars to the star map…'); await new Promise((r) => setTimeout(r, 30));
      const scale = (opts.scale && (!opts.scale.w || (opts.scale.w === w && opts.scale.h === h)) ? opts.scale : null) || (I.fieldOfView > 20 && I.fieldOfView < 130 ? { f: focalFromFov(I.fieldOfView, w, h), tol: 0.15, from: 'the phone' } : null);
      const s = await solveInBackground(an, w, h, opts.FIELD, opts.prior, scale);
      return { reg, lum: avg, w, h, an, sol: s.sol, ms: s.ms, usedPrior: s.usedPrior, usedScale: s.usedScale, skipped: s.skipped, timedOut: s.timedOut, workerError: s.workerError, inWorker: s.inWorker, scaleHint: scale, plan, frameTime, source: `set by the app (ISO ${Math.round(fr.iso)})${fr.raw ? (fr.method === 'superpixel' ? `; RAW, superpixel-binned from the sensor (each ${fr.bin}×${fr.bin} block of photosites added; black level ${Math.round(fr.black)}, white ${Math.round(fr.white)}; no demosaic, no white balance)` : `; RAW, developed linearly with noise reduction and sharpening off, ${fr.bin}×${fr.bin} averaged (superpixel not possible on this phone)`) : '; processed preview frames (this camera offers no RAW)'}; trial: ${trial.join(' → ')}`, interval: frameTime, probe: null, N, collected, took, checks, log: this.log.slice(), settings: { width: w, height: h, exposureTime: frameTime, iso: fr.iso }, caps: { exposureTime: { min: I.minExposure, max: I.maxExposure }, iso: { min: I.minISO, max: I.maxISO } }, label: `${I.camera} (native)` };
    } finally { this.busy = false; }
  }
}

/** Sky mask, star candidates and trusted stars for one brightness image. */
export function analyse(lum, w, h, hot) {
  let mask = skyMask(lum, w, h);
  const cand = dropHot(findStars(lum, w, h, mask, 3.5).stars, hot);        // everything that might be a star: judges the plan and vets the mask
  mask = skyMask(lum, w, h, cand);
  const inSky = (s) => mask.sky[Math.min(mask.th - 1, (s.y / mask.T) | 0) * mask.tw + Math.min(mask.tw - 1, (s.x / mask.T) | 0)];
  return { mask, cand: cand.filter(inSky), stars: dropHot(findStars(lum, w, h, mask, 6).stars, hot) };
}
/** Diagonal field-of-view limits (degrees) for a focal length known to within `tol` (a fraction). */
export function fovRange(f, w, h, tol) { const d = Math.hypot(w, h) / 2; return { fovMin: 2 * Math.atan(d / (f * (1 + tol))) * 180 / Math.PI, fovMax: 2 * Math.atan(d / (f / (1 + tol))) * 180 / Math.PI }; }
/** Focal length in pixels from a lens's field of view across the picture's LONG side (what the phone reports). */
export const focalFromFov = (fovDeg, w, h) => Math.max(w, h) / 2 / Math.tan(fovDeg * Math.PI / 360);
/**
 * Solve. Uses whatever is known to narrow the search, and falls back step by step if that fails:
 *   scale: { f, tol } — the picture scale (focal length in pixels), from an earlier fix or from the phone itself;
 *   prior: { ra, dec, radius } — roughly where the scope points.
 * A known scale is the stronger help: the solver no longer has to consider every possible lens, so it is faster, far
 * less likely to be fooled by a chance pattern, and can work from fewer stars.
 */
export function solve(stars, w, h, FIELD, prior, scale, budget = 20000) {
  if (stars.length < 5) return { sol: null, ms: 0, usedPrior: false, usedScale: false };
  const deadline = Date.now() + budget;
  const t0 = performance.now(), ix = starIndex(FIELD), fov = scale && scale.f ? fovRange(scale.f, w, h, scale.tol || 0.05) : null;
  const tries = []; if (fov && prior) tries.push([fov, prior]); if (fov) tries.push([fov, null]); if (prior) tries.push([null, prior]); tries.push([null, null]);
  for (const [fv, pr] of tries) { if (Date.now() > deadline) break; const sol = solveField(stars, w, h, ix, { ...(fv || {}), ...(pr ? { prior: pr } : {}), deadline }); if (sol) return { sol, ms: performance.now() - t0, usedPrior: !!pr, usedScale: !!fv }; }
  return { sol: null, ms: performance.now() - t0, usedPrior: false, usedScale: false, timedOut: Date.now() > deadline };
}
/**
 * Solve without freezing the screen: in a background worker when the browser allows it, otherwise right here.
 * Pictures that are plainly not a night sky (a lit room, daylight, hardly any sky) are not searched at all.
 */
let worker = null, wid = 0;
const pending = new Map();
export async function solveInBackground(an, w, h, FIELD, prior, scale) {
  if (an.mask.level > 765 * 0.5 || an.mask.fraction < 0.1) return { sol: null, ms: 0, usedPrior: false, usedScale: false, skipped: an.mask.level > 765 * 0.5 ? 'too bright to be a night sky' : 'hardly any sky in the picture' };
  const stars = an.stars.map((s) => ({ x: s.x, y: s.y, flux: s.flux, snr: s.snr }));
  if (stars.length < 5) return { sol: null, ms: 0, usedPrior: false, usedScale: false };
  try {
    if (!worker) { worker = new Worker(new URL('./solve-worker.js', import.meta.url), { type: 'module' }); worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.ok ? p.res(e.data.r) : p.rej(new Error(e.data.error)); } }; worker.onerror = (e) => { for (const p of pending.values()) p.rej(new Error(e.message || 'worker failed')); pending.clear(); worker = null; }; }
    const id = ++wid;
    const r = await new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ id, stars, w, h, prior: prior || null, scale: scale || null, budget: 20000 }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timed out')); } }, 30000); });
    return { ...r, inWorker: true };
  } catch (e) {
    return { ...solve(stars, w, h, FIELD, prior, scale, 6000), inWorker: false, workerError: String(e.message || e) };
  }
}
/** Draw the stacked picture with stripes over what was ignored, circles on the stars and a mark where the telescope points. */
export function drawResult(canvas, r, bore) {
  const { lum, w, h, an, sol } = r; canvas.width = w; canvas.height = h; const px = canvas.getContext('2d');
  const img = px.createImageData(w, h), lo = an.mask.level - 1.5 * an.mask.noise, span = Math.max(12 * Math.max(an.mask.noise, 0.5), 20);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) { const t = Math.max(0, (lum[i] - lo) / span), g = Math.min(255, 255 * Math.asinh(t * 3) / Math.asinh(30)); img.data[j] = img.data[j + 1] = img.data[j + 2] = g; img.data[j + 3] = 255; }
  px.putImageData(img, 0, 0); drawRejected(px, an.mask, w, h);
  const known = new Set((sol ? sol.matches : []).map((m) => `${Math.round(m.x)},${Math.round(m.y)}`));
  px.lineWidth = Math.max(2, w / 600);
  for (const s of an.stars.slice(0, 150)) { px.strokeStyle = known.has(`${Math.round(s.x)},${Math.round(s.y)}`) ? '#7fe0a5' : '#ffd66e'; px.beginPath(); px.arc(s.x, s.y, Math.max(9, w / 120), 0, 6.283); px.stroke(); }
  if (sol) {
    const b = bore || [0, 0, 1], x = w / 2 + sol.f * b[0] / b[2], y = h / 2 + sol.f * b[1] / b[2], q = Math.max(16, w / 50);
    px.strokeStyle = '#7fe0a5'; px.lineWidth = Math.max(3, w / 400); px.beginPath(); px.moveTo(x - q, y); px.lineTo(x + q, y); px.moveTo(x, y - q); px.lineTo(x, y + q); px.stroke(); px.beginPath(); px.arc(x, y, q * 0.6, 0, 6.283); px.stroke();
  }
}
/** Plain-text report of one attempt, for sending back when something is off. */
export function reportText(r, version) {
  const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  const KS = ['width', 'height', 'frameRate', 'exposureMode', 'exposureTime', 'exposureCompensation', 'iso', 'focusMode', 'focusDistance', 'whiteBalanceMode', 'zoom', 'facingMode'], sol = r.sol;
  return [
    `Skyward camera fix — ${version}`,
    `When: ${new Date().toString()}`,
    `Phone and browser: ${navigator.userAgent}`,
    `Camera: ${r.label || 'unnamed'}, ${r.w}×${r.h}`,
    ...(sol ? [`SOLVED: RA ${sol.ra.toFixed(3)}° (${hms(sol.ra)}), Dec ${sol.dec.toFixed(3)}°, roll ${sol.roll.toFixed(1)}°, ${sol.confidence} confidence${r.usedPrior ? '' : ', found without a hint'}`,
      `Matched ${sol.n} of the ${sol.of} brightest stars, fit ${sol.rms.toFixed(2)} px (${(sol.rmsDeg * 60).toFixed(1)}′), solved in ${r.ms.toFixed(0)} ms${r.inWorker ? ' in the background' : ''}`,
      `Field of view: ${sol.fovW.toFixed(1)}° × ${sol.fovH.toFixed(1)}°, focal length ${sol.f.toFixed(0)} px, ${(Math.atan(1 / sol.f) * 180 / Math.PI * 60).toFixed(2)}′ per pixel`,
      `Scale hint: ${r.scaleHint ? `${r.scaleHint.f.toFixed(0)} px ±${((r.scaleHint.tol || 0.05) * 100).toFixed(0)}% from ${r.scaleHint.from || 'an earlier fix'}${r.usedScale ? ' — used' : ' — did not fit, searched every scale'}` : 'none yet (first fix at this picture size)'}`] : [`NOT SOLVED (${r.ms.toFixed(0)} ms${r.skipped ? `; not searched: ${r.skipped}` : ''}${r.timedOut ? '; gave up after 20 s' : ''}${r.workerError ? `; background search unavailable: ${r.workerError}` : ''})`]),
    `Single-frame time: ${fmtSec(r.frameTime)} (${(r.frameTime * 1000).toFixed(1)} ms), ${r.source}`,
    `Gap between frames: ${(r.interval * 1000).toFixed(1)} ms`,
    ...(r.probe ? [`Frame-rate trial (rate: gap, sky brightness, implied frame time): ${r.probe.rows.map((x) => x.refused ? `${x.rate}/s refused` : `${x.rate}/s: ${(x.gap * 1000).toFixed(0)} ms, ${x.level.toFixed(1)}, ${(x.time * 1000).toFixed(0)} ms`).join(' | ')}`] : []),
    `Light collected: ${r.N} frame${r.N === 1 ? '' : 's'} = ${r.collected.toFixed(2)} s, in ${r.took.toFixed(1)} s of waiting`,
    `Lining frames up: ${r.reg.note}`,
    `Sky: ${r.plan.sky}; level ${r.an.mask.level.toFixed(1)} of 765, noise ${r.an.mask.noise.toFixed(2)}; ${(r.an.mask.fraction * 100).toFixed(0)}% of the picture counted as sky`,
    `Plan: ${r.plan.why}${r.plan.capped ? ' (capped)' : ''}; ${r.plan.frameWhy}`,
    `Checks along the way: ${r.checks.join(' | ')}`,
    `Hot pixels: ${r.hotKnown || 0} known and ignored${r.hotNew ? `, ${r.hotNew} newly confirmed by this fix` : ''}`,
    `Stars: ${r.an.stars.length} clear, ${r.an.cand.length} possible; brightest ten (signal-to-noise): ${r.an.stars.slice(0, 10).map((s) => s.snr.toFixed(0)).join(', ') || 'none'}`,
    `What the camera was asked for: ${r.log.join('; ')}`,
    `Settings in use: ${JSON.stringify(pick(r.settings, KS))}`,
    `What this browser offers: ${JSON.stringify(pick(r.caps, KS))}`,
  ].join('\n');
}
export { skyWord };
