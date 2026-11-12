// Sightline (Jens t866u, 12 Nov 2026): look at something and measure how far away it is. The distance along the
// aim (crosshair) to the first surface it hits, from MIN (1 m) to MAX (the city's width, 96 m), as metres and as
// a 0…1 value on a log scale (1 m → 0, 96 m → 1: every doubling of the distance is the same step, the way we
// hear pitch and judge depth). Pure maths here; client/src/sightline.js does the throttled raycast + smoothing.
// First use: sneak (Ctrl) – the Steps oscillator's pitch follows the distance (main.js walkSounds, sightFreq).
import { CITY } from './city.mjs';

export const SIGHTLINE = Object.freeze({
  minM: 1, maxM: CITY.width, // 1 m … 96 m
  intervalMs: 100,           // one raycast every 100 ms (10 a second) – cheap
  smoothMs: 220,             // one-pole smoothing of the log value (no jitter when the aim crosses an edge)
  // Steps osc pitch while sneaking: near = HIGH, far = LOW (a close wall "pings", the open sky / far end of the
  // city is a deep hum – like sonar / a small vs a big space). Inside the step osc's own range (shared/synth.mjs
  // freq 20…8000 Hz), kept to the musical middle so it never whistles or vanishes: 1 m = A6 1760 Hz … 96 m = E1 41.2 Hz
  // (≈ 5.4 octaves); snapped to semitones (snapFreq) so the steps stay in tune.
  nearHz: 1760, farHz: 41.2,
});
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// metres → 0…1 (log). null / no hit / NaN = as far as it goes (1).
export function sightValue(d, { minM = SIGHTLINE.minM, maxM = SIGHTLINE.maxM } = {}) {
  if (!Number.isFinite(d)) return 1;
  return clamp(Math.log(clamp(d, minM, maxM) / minM) / Math.log(maxM / minM), 0, 1);
}
// 0…1 → metres (the inverse).
export const sightMetres = (v, { minM = SIGHTLINE.minM, maxM = SIGHTLINE.maxM } = {}) => minM * Math.pow(maxM / minM, clamp(v, 0, 1));
// 0…1 → Hz between near (0) and far (1), log (equal steps = equal intervals).
export const sightFreq = (v, { nearHz = SIGHTLINE.nearHz, farHz = SIGHTLINE.farHz } = {}) => nearHz * Math.pow(farHz / nearHz, clamp(v, 0, 1));
// One smoothing step: from `cur` toward `target` over dtMs with time constant smoothMs (exponential).
export const sightSmooth = (cur, target, dtMs, smoothMs = SIGHTLINE.smoothMs) => (cur == null || !Number.isFinite(cur) ? target : cur + (target - cur) * (1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, smoothMs))));

// Highline + Widthline (Jens t867u, 12 Nov 2026) – Sightline's siblings, from the same raycast: WHERE on the aimed
// surface the hit point is. Highline = vertical, 0 = the surface's bottom … 1 = its top; Widthline = horizontal,
// 0 = its left … 1 = its right, as seen from where you stand. "The surface" = the mesh that was hit (its world
// bounding box: a facade, a wall, a door, the ground, a prop). Walls (|normal.y| < 0.7): up = world up and right =
// your right along the wall. Floors / ceilings / roofs (no "up" on them): Highline runs AWAY from you (near edge 0
// … far edge 1, like up on the screen) and Widthline left → right. Not wired to any sound yet (Jens decides).
//   surfaceLines(point, normal, min, max, viewDir) → { highline, widthline }   (all [x, y, z] arrays)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : null; };
export function surfaceAxes(normal, viewDir) {
  const n = norm(normal) || [0, 1, 0];
  if (Math.abs(n[1]) < 0.7) { // a wall: up is up, right = (look into the wall) × up
    const right = norm(cross([-n[0], -n[1], -n[2]], [0, 1, 0])) || [1, 0, 0];
    return { up: [0, 1, 0], right };
  }
  const fwd = norm([viewDir?.[0] || 0, 0, viewDir?.[2] || 0]) || [0, 0, -1]; // a floor / ceiling: "up" = away from me
  return { up: fwd, right: norm(cross(fwd, [0, 1, 0])) };
}
function spanOn(axis, p, min, max) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]], d = dot(c, axis);
    if (d < lo) lo = d; if (d > hi) hi = d;
  }
  return hi - lo < 1e-6 ? 0.5 : clamp((dot(p, axis) - lo) / (hi - lo), 0, 1);
}
export function surfaceLines(point, normal, min, max, viewDir) {
  if (!point || !min || !max) return { highline: null, widthline: null };
  const { up, right } = surfaceAxes(normal, viewDir);
  return { highline: spanOn(up, point, min, max), widthline: spanOn(right, point, min, max) };
}
