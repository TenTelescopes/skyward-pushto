// Phone motion sensors via the W3C DeviceOrientation API (works inside the Capacitor WebView on iOS and Android).
//  - 'deviceorientation'          : gyro+accelerometer fusion, horizontal reference arbitrary (relative frame)
//  - 'deviceorientationabsolute'  : Android, magnetometer-referenced (magnetic north)
//  - event.webkitCompassHeading   : iOS, magnetic heading of the phone's top edge
// Both compass sources are reduced to one number: the offset between the relative frame and magnetic north.
import { rotFromEuler, mulMV, altAzFromVec, wrap180, wrap360, D2R, R2D } from './model.js';

export class Sensors {
  constructor() {
    this.R = null; this.Rabs = null; this.t = 0; this.compassOffsetSamples = []; this.listeners = new Set();
    this.count = 0; this.rateHz = 0; this._rateT0 = 0; this._rateN = 0; this.hasCompass = false; this.compassSource = null;
    this.compassAccuracy = null; this.started = false; this.lastEuler = null; this.motionEvents = 0; this.gyroEvents = 0;
  }
  static needsPermission() { return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'; }
  async start() {
    if (this.started) return true;
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') throw new Error('This device does not report orientation.');
    if (Sensors.needsPermission()) {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') throw new Error('Motion access was denied. Enable it in Settings for this app.');
      try { if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission(); } catch (e) { /* optional */ }
    }
    window.addEventListener('deviceorientation', (e) => this._onRel(e));
    window.addEventListener('deviceorientationabsolute', (e) => this._onAbs(e));
    // Gyroscope detection: phones without a gyro deliver devicemotion with rotationRate null (or all-null fields).
    window.addEventListener('devicemotion', (e) => {
      this.motionEvents++;
      const rr = e.rotationRate;
      if (rr && (rr.alpha != null || rr.beta != null || rr.gamma != null)) this.gyroEvents++;
    });
    this.started = true; return true;
  }
  _onRel(e) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const now = performance.now();
    this.R = rotFromEuler(e.alpha, e.beta, e.gamma); this.t = now; this.lastEuler = [e.alpha, e.beta, e.gamma];
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      // iOS: heading of the top edge, clockwise from magnetic north. Relative-frame azimuth of the top edge:
      const topAz = altAzFromVec(mulMV(this.R, [0, 1, 0]));
      // Heading is only defined meaningfully when the top edge isn't near vertical.
      if (Math.abs(topAz.alt) < 70) this._pushCompass(wrap180(e.webkitCompassHeading - topAz.az), now);
      this.compassAccuracy = e.webkitCompassAccuracy ?? null; this.compassSource = 'iOS compass';
    }
    this._tickRate(now);
    for (const f of this.listeners) f(this);
  }
  _onAbs(e) {
    if (e.alpha == null) return;
    this.Rabs = rotFromEuler(e.alpha, e.beta, e.gamma); this.compassSource = 'Android rotation vector';
    if (this.R) {
      // Compare the same physical axis in both frames; use whichever axis is most horizontal.
      const axis = [[0, 1, 0], [1, 0, 0], [0, 0, 1]].reduce((best, a) => Math.abs(mulMV(this.R, a)[2]) < Math.abs(mulMV(this.R, best)[2]) ? a : best);
      const azAbs = altAzFromVec(mulMV(this.Rabs, axis)).az, azRel = altAzFromVec(mulMV(this.R, axis)).az;
      this._pushCompass(wrap180(azAbs - azRel), performance.now());
    }
  }
  _pushCompass(off, now) {
    this.hasCompass = true; this.compassOffsetSamples.push([now, off]);
    while (this.compassOffsetSamples.length && now - this.compassOffsetSamples[0][0] > 1500) this.compassOffsetSamples.shift();
  }
  /** Relative-frame -> magnetic north offset (deg), circular mean of the last 1.5 s. Null if no compass. */
  compassOffset() {
    if (!this.compassOffsetSamples.length) return null;
    let s = 0, c = 0; for (const [, v] of this.compassOffsetSamples) { s += Math.sin(v * D2R); c += Math.cos(v * D2R); }
    return wrap180(Math.atan2(s, c) * R2D);
  }
  _tickRate(now) {
    this._rateN++; if (!this._rateT0) this._rateT0 = now;
    if (now - this._rateT0 > 2000) { this.rateHz = this._rateN * 1000 / (now - this._rateT0); this._rateT0 = now; this._rateN = 0; }
  }
  /** true = gyro confirmed, false = motion events arrive without rotation rates, null = can't tell yet. */
  hasGyro() { if (this.gyroEvents > 0) return true; return this.motionEvents >= 20 ? false : null; }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  fresh() { return this.R && performance.now() - this.t < 1000; }
}

/** Simulated sensor source for testing in a desktop browser (keyboard / on-screen nudges). */
export class SimSensors extends Sensors {
  constructor() { super(); this.alpha = 0; this.beta = 30; this.gamma = 0; this.noise = 0.05; this.drift = 0; this.trueOffset = 0; }
  hasGyro() { return this.simGyro ?? true; }
  async start() {
    this.started = true; const t0 = performance.now();
    this._timer = setInterval(() => {
      const n = () => (Math.random() - 0.5) * 2 * this.noise; const el = (performance.now() - t0) / 60000;
      const a = this.alpha + this.drift * el + (this.bend || 0) * (this.beta / 90) ** 2 + n(), b = this.beta + n(), g = this.gamma + n(); // bend: simulated altitude-dependent azimuth error (°)
      this._onRel({ alpha: wrap360(a), beta: b, gamma: g });
      this._onAbs({ alpha: wrap360(this.alpha + n() - this.trueOffset), beta: b, gamma: g }); // compass: no gyro drift; magnetic offset = trueOffset
    }, 1000 / 30);
    return true;
  }
}
