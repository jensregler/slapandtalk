// Dance lines (Jens t888u, 13 Nov 2026): "i dance mode kopplar vi highline, som tittar vart på ytan (den vi siktar
// på) i y-led, till hold på alla levels i step sound och widthline som tittar i x-led till drive."
//   - Only while the dance (X) is on. Not dancing: my Steps sound is exactly my patch (nothing is written to it).
//   - Highline (shared/sightline.mjs surfaceLines: where on the aimed surface I look, 0 = its bottom … 1 = its top)
//     → the envelope HOLD of EVERY layer of my Steps patch, across the whole hold range (SYNTH.layer.hold,
//     0 … 3 s), linear: bottom of the wall = 0 s, top = 3 s.
//   - Widthline (0 = the surface's left … 1 = its right, as seen from me) → DRIVE (the waveshaper) of every
//     layer, across its whole range (SYNTH.layer.drive, 0 … 1), linear: left = clean, right = full drive.
//   - Smoothed (one-pole, SMOOTH_MS) so a jump to another surface glides instead of stepping.
//   - Aiming at nothing (the sky): the last values are kept.
//   - Leaving the dance: back to my own hold / drive at once (the override is dropped, my saved patch was never
//     touched). The next dance starts from where the aim is then (no memory of the last dance).
// Pure maths (no audio). client/src/main.js feeds it from the Sightline cast; client/src/sound.js + radio.js
// apply it to my own steps only.
import { SYNTH } from './synth.mjs';

const HOLD = SYNTH.layer.hold;   // [0, 3, 0.001] s
const DRIVE = SYNTH.layer.drive; // [0, 1, 0.01]
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const DANCE_LINES = Object.freeze({
  hold: Object.freeze({ min: HOLD[0], max: HOLD[1] }),   // Highline 0 → 0 s … 1 → 3 s
  drive: Object.freeze({ min: DRIVE[0], max: DRIVE[1] }), // Widthline 0 → 0 … 1 → 1
  smoothMs: 150,
});

export const lineHold = (h, R = DANCE_LINES.hold) => R.min + (R.max - R.min) * clamp(Number.isFinite(h) ? h : 0, 0, 1);
export const lineDrive = (w, R = DANCE_LINES.drive) => R.min + (R.max - R.min) * clamp(Number.isFinite(w) ? w : 0, 0, 1);

const smooth1 = (cur, target, dtMs, ms) => (cur == null || !Number.isFinite(cur) ? target : cur + (target - cur) * (1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, ms))));

// One frame. state = the previous result (or null at the start of a dance). highline / widthline = the raw
// values from the cast (null = nothing hit → keep the target). → { highline, widthline (smoothed, 0…1),
// target: { highline, widthline }, hold (s), drive } — hold / drive null until the aim has hit something once.
export function stepLines(state, { highline = null, widthline = null } = {}, dtMs = 16, smoothMs = DANCE_LINES.smoothMs) {
  const s = state || { highline: null, widthline: null, target: { highline: null, widthline: null } };
  const target = {
    highline: Number.isFinite(highline) ? clamp(highline, 0, 1) : s.target.highline,
    widthline: Number.isFinite(widthline) ? clamp(widthline, 0, 1) : s.target.widthline,
  };
  const h = target.highline == null ? null : smooth1(s.highline, target.highline, dtMs, smoothMs);
  const w = target.widthline == null ? null : smooth1(s.widthline, target.widthline, dtMs, smoothMs);
  return { highline: h, widthline: w, target, hold: h == null ? null : lineHold(h), drive: w == null ? null : lineDrive(w) };
}

// The patch with every layer's hold / drive set (either may be null = that one untouched). Never mutates.
export function withLines(patch, mod) {
  if (!mod || !patch || !Array.isArray(patch.layers)) return patch;
  const hold = Number.isFinite(mod.hold) ? clamp(mod.hold, HOLD[0], HOLD[1]) : null;
  const drive = Number.isFinite(mod.drive) ? clamp(mod.drive, DRIVE[0], DRIVE[1]) : null;
  if (hold == null && drive == null) return patch;
  return { ...patch, layers: patch.layers.map((l) => ({ ...l, ...(hold != null ? { hold } : {}), ...(drive != null ? { drive } : {}) })) };
}
