import { newtonianMatrix, applyM } from '../docs/js/eyeview.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const det = (M) => M[0][0] * M[1][1] - M[0][1] * M[1][0];
// 1. Never a mirror image: two reflections make a pure rotation (det +1, orthonormal), for any pointing and focuser.
let allRot = true;
for (const alt of [5, 30, 60, 85]) for (const az of [0, 90, 200]) for (const f of [-90, -45, 0, 45, 90]) {
  const M = newtonianMatrix({ alt, az }, f);
  if (!near(det(M), 1, 1e-6) || !near(Math.hypot(M[0][0], M[1][0]), 1, 1e-6)) { allRot = false; console.log('  not a rotation at', alt, az, f, det(M)); }
}
ok(allRot, 'image is always rotated, never mirrored (det = +1)');
// 2. Hand-derived case: scope level, pointing north, focuser on the right side, head upright:
//    a star above the target appears below it, a star to the east (right) appears to the left — 180°.
{ const M = newtonianMatrix({ alt: 0, az: 0 }, 90);
  const up = applyM(M, 0, 1), right = applyM(M, 1, 0);
  ok(near(up[0], 0) && near(up[1], -1) && near(right[0], -1) && near(right[1], 0), `level scope, side focuser: rotated 180° (up→${up.map((v) => v.toFixed(2))}, right→${right.map((v) => v.toFixed(2))})`); }
// 3. Mirror-symmetric setups give mirror-symmetric rotations: left vs right focuser are opposite rotations.
{ const a = newtonianMatrix({ alt: 40, az: 120 }, 45), b = newtonianMatrix({ alt: 40, az: 120 }, -45);
  const angA = Math.atan2(a[1][0], a[0][0]), angB = Math.atan2(b[1][0], b[0][0]);
  ok(near(Math.abs(angA), Math.abs(angB), 1e-6), `left/right focusers rotate by equal and opposite amounts (${(angA * 180 / Math.PI).toFixed(1)}° vs ${(angB * 180 / Math.PI).toFixed(1)}°)`); }
// 4. Rotation does not depend on azimuth (only on altitude and focuser position).
{ const a = newtonianMatrix({ alt: 50, az: 10 }, 60), b = newtonianMatrix({ alt: 50, az: 250 }, 60);
  ok(near(a[0][0], b[0][0]) && near(a[0][1], b[0][1]), 'same altitude & focuser → same rotation at any azimuth'); }
// 5. Side focuser, head upright (derived by hand): 'toward zenith' appears at (sin alt, −cos alt),
//    i.e. the view is rotated by 180° − altitude and turns as the scope is raised.
{ let all = true; for (const alt of [0, 10, 40, 70]) { const M = newtonianMatrix({ alt, az: 33 }, 90); const u = applyM(M, 0, 1), r = alt * Math.PI / 180;
    if (!near(u[0], Math.sin(r), 1e-6) || !near(u[1], -Math.cos(r), 1e-6)) { all = false; console.log('  alt', alt, u); } }
  ok(all, 'side focuser: field rotation = 180° − altitude, matching the hand derivation'); }
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
