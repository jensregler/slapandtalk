// Footsteps on peels (Jens, 29 Oct 2026): walking on the backing paper on the floor ("pillen",
// the peels from shared/peels.mjs) plays the normal footstep (DEFAULT_PATCHES.step, the same
// player variation and slot colour) through a "paper" insert:
//   voice → low-pass (muffled, soft) → soft-clip WaveShaper (a little grit, more the faster you walk) → out
// "Lite filter, lite distorsion": the filter is gentle (12 dB/oct, low Q) and the distortion is
// unity-gain at small signals, so a peel step is about as loud as a normal one, only duller and a
// hair crisper when you hurry. Shared by the browser and the tests; all the numbers are here.
import { peelFrame } from './peels.mjs';

export const PEEL_STEP = {
  vSlow: 0.6, vFast: 4.7,  // m/s: walking (keys 2.6, joystick less) … Shift-running (2.6 × 1.8 ≈ 4.7)
  cutoffSlow: 330,         // Hz: low-pass when strolling (the normal step's noise sits at 520 Hz)
  cutoffFast: 420,         // Hz: opens a little with speed (a faster foot hits harder)
  q: 0.6,                  // filter resonance (no peak, just soft)
  driveSlow: 0.04,         // 0..1 distortion amount when strolling
  driveFast: 0.28,         // 0..1 when Shift-running (subtle: see peelCurve)
  pre: 2.2,                // gain into the shaper (the step peaks ~0.25 → ~0.55 of the curve)
  gain: 0.9,               // the peel step is a touch softer
  footRadius: 0.1,         // m: the foot counts as on a peel this close to its edge
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));
// speed (m/s, the groove's smoothed walking speed) → the insert's settings.
export function peelStepParams(speed) {
  const S = PEEL_STEP, t = clamp01(((+speed || 0) - S.vSlow) / (S.vFast - S.vSlow));
  return {
    t: +t.toFixed(3),
    cutoff: Math.round(S.cutoffSlow + (S.cutoffFast - S.cutoffSlow) * t),
    q: S.q,
    drive: +(S.driveSlow + (S.driveFast - S.driveSlow) * t).toFixed(3),
    pre: S.pre,
    gain: S.gain,
  };
}

// The WaveShaper curve for a drive 0..1: tanh soft clip with k = 1 + 6·drive, scaled so the
// whole chain (pre gain · curve slope at 0 · post gain) is unity for small signals.
// Returns { curve: Float32Array(n), post } (post = the gain after the shaper).
export function peelCurve(drive, n = 1025) {
  const k = 1 + 6 * clamp01(drive), c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  const slope = k / norm; // d/dx at 0
  return { curve: c, post: 1 / (PEEL_STEP.pre * slope) };
}

// How much a sine of amplitude a (before the pre gain) is distorted by that curve: total harmonic
// distortion 0..1 (tests: subtle, grows with speed).
export function peelThd(drive, a = 0.2, N = 2048) {
  const { curve, post } = peelCurve(drive), n = curve.length;
  const shape = (x) => { const p = Math.max(-1, Math.min(1, x)), f = (p + 1) / 2 * (n - 1), i = Math.floor(f), r = f - i; return (curve[i] + ((curve[Math.min(n - 1, i + 1)] - curve[i]) * r)) * post; };
  const y = new Float64Array(N);
  for (let i = 0; i < N; i++) y[i] = shape(PEEL_STEP.pre * a * Math.sin((2 * Math.PI * 8 * i) / N));
  const bin = (h) => { let re = 0, im = 0; for (let i = 0; i < N; i++) { re += y[i] * Math.cos((2 * Math.PI * 8 * h * i) / N); im += y[i] * Math.sin((2 * Math.PI * 8 * h * i) / N); } return Math.hypot(re, im); };
  const f = bin(1); let harm = 0; for (let h = 2; h <= 9; h++) harm += bin(h) ** 2;
  return f ? Math.sqrt(harm) / f : 0;
}

// Is the foot at (x, z) on a peel? peels: [{ x, z, w, h, yaw }] (landed ones, flat on the floor).
// A cheap rectangle test in the peel's own frame (the same frame as overlapFraction), widened by
// footRadius; bounding-circle reject first, so hundreds of peels cost nothing per frame.
export function onPeel(x, z, peels, r = PEEL_STEP.footRadius) {
  for (const p of peels || []) {
    const qx = x - p.x, qz = z - p.z, R = Math.hypot(p.w, p.h) / 2 + r;
    if (qx * qx + qz * qz > R * R) continue;
    const { u, v } = peelFrame(p.yaw || 0);
    const a = qx * u[0] + qz * u[1], b = qx * v[0] + qz * v[1];
    if (Math.abs(a) <= p.w / 2 + r && Math.abs(b) <= p.h / 2 + r) return true;
  }
  return false;
}
