// Sensor tests: precision (noise), drift, repeatability, level bias, and sky-referenced accuracy.
// Every number reported here is measured on the phone during the test; nothing is assumed.
import { mulMV, altAzFromVec, wrap180, wrap360, mean, std, slope, unwrap, circMean, fitDeviation, sepDeg, D2R, R2D } from './model.js';

const AM = 60; // arcminutes per degree

/** Collects raw samples from the sensor stream while active. */
export class Recorder {
  constructor(sensors, model) { this.sensors = sensors; this.model = model; this.samples = []; this.off = null; }
  start() {
    this.stop(); // never stack listeners: each restart must replace, not add, the subscription
    this.samples = []; this.t0 = performance.now();
    this.off = this.sensors.on((s) => {
      const a = altAzFromVec(mulMV(s.R, this.model.axis()));
      const co = s.compassOffset();
      this.samples.push({ t: (performance.now() - this.t0) / 1000, alt: a.alt, az: a.az, caz: co == null ? null : wrap360(a.az + co), euler: s.lastEuler ? s.lastEuler.slice() : null });
    });
  }
  stop() { if (this.off) this.off(); this.off = null; return this.samples; }
  /** Mean of the last `sec` seconds (used for marks). */
  lastMean(sec = 1) {
    const now = (performance.now() - this.t0) / 1000; const s = this.samples.filter((x) => now - x.t <= sec);
    if (!s.length) return null;
    const cz = s.filter((x) => x.caz != null).map((x) => x.caz);
    return { n: s.length, alt: mean(s.map((x) => x.alt)), az: circMean(s.map((x) => x.az)), caz: cz.length ? circMean(cz) : null,
             altStd: std(s.map((x) => x.alt)), at: Date.now() };
  }
}

/** Stillness test: precision (scatter) and drift while the scope is untouched. */
export function analyzeStillness(samples) {
  if (samples.length < 10) return null;
  const t = samples.map((s) => s.t), alt = samples.map((s) => s.alt), az = unwrap(samples.map((s) => s.az));
  const cosAlt = Math.cos(mean(alt) * D2R);
  const detr = (y) => { const k = slope(t, y), m = mean(y), mt = mean(t); return y.map((v, i) => v - (m + k * (t[i] - mt))); };
  const r = {
    duration: t[t.length - 1] - t[0], n: samples.length, rateHz: samples.length / Math.max(1e-6, t[t.length - 1] - t[0]), meanAlt: mean(alt),
    altNoise: std(detr(alt)) * AM, azNoise: std(detr(az)) * AM * cosAlt,                  // precision, arcmin on sky
    altPP: (Math.max(...alt) - Math.min(...alt)) * AM, azPP: (Math.max(...az) - Math.min(...az)) * AM * cosAlt,
    altDrift: slope(t, alt) * 60, azDrift: slope(t, az) * 60,                             // deg per minute
  };
  const cs = samples.filter((s) => s.caz != null);
  if (cs.length > 10) {
    const ct = cs.map((s) => s.t), cz = unwrap(cs.map((s) => s.caz));
    r.compassNoise = std(detr2(ct, cz)) * AM * cosAlt; r.compassDrift = slope(ct, cz) * 60;
    r.compassPP = (Math.max(...cz) - Math.min(...cz)) * AM * cosAlt;
  }
  return r;
  function detr2(x, y) { const k = slope(x, y), m = mean(y), mx = mean(x); return y.map((v, i) => v - (m + k * (x[i] - mx))); }
}

/**
 * Repeatability: return to the same target several times.
 * marks: [{alt, az, caz, at, truth?:{alt,az}}]. Terrestrial targets have no truth; sky targets do (computed at mark time).
 */
export function analyzeRepeat(marks) {
  if (marks.length < 2) return null;
  const sky = marks.every((m) => m.truth);
  // For sky targets, remove sky motion: compare each mark to the object's true position at that instant.
  const dAlt = marks.map((m) => sky ? m.alt - m.truth.alt : m.alt);
  const dAz = unwrap(marks.map((m) => sky ? wrap180(m.az - m.truth.az) : m.az));
  const cosAlt = Math.cos(mean(marks.map((m) => m.alt)) * D2R);
  const ma = mean(dAlt), mz = mean(dAz);
  const dev = marks.map((m, i) => Math.hypot(dAlt[i] - ma, (dAz[i] - mz) * cosAlt) * AM);
  const r = { n: marks.length, sky, altStd: std(dAlt) * AM, azStd: std(dAz) * AM * cosAlt, maxDev: Math.max(...dev), dev,
              span: (marks[marks.length - 1].at - marks[0].at) / 60000 };
  r.azTrend = r.span > 0.2 ? slope(marks.map((m) => (m.at - marks[0].at) / 60000), dAz) : null; // deg/min across marks (gyro drift)
  const cm = marks.filter((m) => m.caz != null);
  if (cm.length >= 2) {
    const cz = unwrap(cm.map((m) => sky ? wrap180(m.caz - m.truth.az) : m.caz));
    r.compassStd = std(cz) * AM * cosAlt;
    if (sky) r.compassMeanError = mean(cz); // includes magnetic declination
  }
  return r;
}

/** Level-surface reversal test (accelerometer bias). readings: [{beta, gamma}] alternating 0°, 180°, 0°, 180°… */
export function analyzeReversal(readings) {
  const pairs = [];
  for (let i = 0; i + 1 < readings.length; i += 2) {
    const a = readings[i], b = readings[i + 1];
    // Rotating the phone 180° about vertical flips the sign of the true surface tilt in both axes; sensor bias does not flip.
    pairs.push({ pitchBias: (a.beta + b.beta) / 2, rollBias: (a.gamma + b.gamma) / 2, surfPitch: (a.beta - b.beta) / 2, surfRoll: (a.gamma - b.gamma) / 2 });
  }
  if (!pairs.length) return null;
  return { pairs, pitchBias: mean(pairs.map((p) => p.pitchBias)) * AM, rollBias: mean(pairs.map((p) => p.rollBias)) * AM,
           pitchBiasStd: std(pairs.map((p) => p.pitchBias)) * AM, rollBiasStd: std(pairs.map((p) => p.rollBias)) * AM,
           surfPitch: mean(pairs.map((p) => p.surfPitch)), surfRoll: mean(pairs.map((p) => p.surfRoll)) };
}

/**
 * Sky accuracy: user centres known objects. marks: [{obj, alt, az, caz, truth:{alt,az}, model?:{alt,az}}].
 *  - Altitude error = gravity-derived altitude − true altitude (phone tilt on the mount + accelerometer bias)
 *  - Compass error  = compass azimuth − true azimuth (declination + local magnetic deviation + sensor error)
 *  - Model error    = aligned-model prediction vs truth (the push-to accuracy you actually get)
 */
export function analyzeAccuracy(marks) {
  if (!marks.length) return null;
  const altErr = marks.map((m) => m.alt - m.truth.alt);
  const r = { n: marks.length, altErrMean: mean(altErr) * AM, altErrStd: std(altErr) * AM, altErr: altErr.map((v) => v * AM) };
  if (marks.length >= 3) { r.altScale = slope(marks.map((m) => m.truth.alt), altErr); }
  const cm = marks.filter((m) => m.caz != null);
  if (cm.length) {
    const ce = cm.map((m) => wrap180(m.caz - m.truth.az));
    r.compassErr = ce; r.compassErrMean = mean(ce); r.compassErrStd = std(ce);
    r.deviation = cm.length >= 4 ? fitDeviation(cm.map((m) => m.truth.az), ce) : null;
  }
  const mm = marks.filter((m) => m.model);
  if (mm.length) {
    const e = mm.map((m) => sepDeg(m.model.alt, m.model.az, m.truth.alt, m.truth.az) * AM);
    r.modelRms = Math.sqrt(mean(e.map((v) => v * v))); r.modelMax = Math.max(...e); r.modelErr = e;
  }
  return r;
}

export const fmt = {
  am: (v) => v == null || isNaN(v) ? '—' : (Math.abs(v) >= 60 ? `${(v / 60).toFixed(2)}°` : `${v.toFixed(1)}′`),
  deg: (v, d = 2) => v == null || isNaN(v) ? '—' : `${v.toFixed(d)}°`,
  rate: (v) => v == null || isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}°/min`,
};

/** Flatten a result into CSV rows for export. */
export function toCSV(history) {
  const rows = [['when', 'test', 'scope', 'mounting', 'metric', 'value']];
  for (const h of history) for (const [k, v] of Object.entries(h.result || {})) {
    if (v == null || typeof v === 'object') continue;
    rows.push([new Date(h.when).toISOString(), h.test, h.scope, h.mounting, k, typeof v === 'number' ? +v.toFixed(5) : v]);
  }
  return rows.map((r) => r.map((c) => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')).join('\n');
}
