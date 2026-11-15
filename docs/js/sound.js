// Small audio cues, so you can keep your eye at the finder or eyepiece instead of on the phone.
// mode: 'off' | 'chime' (events only) | 'guide' (events + ticks that speed up as you close in on the target).
export const sound = { mode: 'chime', volume: 0.6 };
let ctx = null, master = null;

/** Create/resume the audio context. Must be called from a tap (browsers block audio until the user interacts). */
export function initSound() {
  try {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); if (!AC) return false;
    if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  } catch (e) { return false; }
}
function tone(freq, dur, when = 0, gain = 0.25, type = 'sine') {
  if (!ctx || sound.mode === 'off' || ctx.state !== 'running') return;
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * sound.volume), t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
}
export const cue = {
  /** Approach tick; pitch rises as the target gets closer (closeness 0..1). */
  tick: (closeness = 0.5) => tone(420 + 520 * closeness, 0.045, 0, 0.16, 'triangle'),
  onTarget: () => { tone(660, 0.12); tone(880, 0.12, 0.11); tone(1320, 0.3, 0.22); },
  sync: () => { tone(520, 0.08); tone(780, 0.16, 0.09); },
  logged: () => { tone(784, 0.1); tone(988, 0.1, 0.1); tone(1175, 0.1, 0.2); tone(1568, 0.35, 0.3); },
  milestone: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, i * 0.11)); tone(1568, 0.5, 0.6); },
  miss: () => tone(200, 0.22, 0, 0.18, 'triangle'),
  count: () => tone(500, 0.1), go: () => tone(1000, 0.35),
  test: () => { tone(660, 0.12); tone(880, 0.2, 0.12); },
};
/**
 * Milliseconds between approach ticks for a separation `sep` (deg) and eyepiece half-field `half` (deg):
 * silent beyond 25°, ~900 ms far out, ~140 ms at the edge of the field, silent once inside it.
 */
export function tickInterval(sep, half) {
  if (!(sep > half) || sep > 25) return null;
  const f = Math.min(1, Math.log(sep / half) / Math.log(25 / half));    // 0 at the field edge, 1 at 25°
  return Math.round(140 + 760 * f);
}
