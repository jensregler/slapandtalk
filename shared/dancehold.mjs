// Dance-mode hold vector (Jens, 11 Nov 2026, voice ~14:28–14:29): "När dansläget är aktiverat … när man
// sätter ett klistermärke ska avståndet till var klistermärket sitter kopplas till hold."
//   - Only while the dance (X) is on. Not dancing: the slap sounds exactly as its patch says.
//   - The distance is from ME (the character's head, camera.position)
//     to the point where the sticker lands, in metres (3D).
//   - Hold (the envelope's hold, the patch's 0 … 3 s range, shared/synth.mjs SYNTH.layer.hold) for THAT slap:
//     0 s within NEAR metres of me, 3 s at FAR metres = the city's width (96 m, the wall on the other side
//     of the city), linear in between, clamped outside (further than 96 m is still 3 s).
//   - Every layer of the slap patch gets that hold (seconds, not scaled by size/pitch).
// Pure maths (no audio). client/src/main.js computes it on slap, client/src/sound.js applies it.
import { CITY } from './city.mjs';
import { SYNTH } from './synth.mjs';

const HOLD = SYNTH.layer.hold; // [0, 3, 0.001] s

export const DANCE_HOLD = Object.freeze({
  near: 1,                 // m: within 1 m of me the hold is 0 s
  far: CITY.width,         // m: 96 m – across the whole city – the hold is 3 s
  min: HOLD[0],     // 0 s
  max: HOLD[1],     // 3 s
});

// One distance (m) → hold (s): 0 inside `near`, 3 at `far`, linear, clamped.
export function danceHoldFor(dist, H = DANCE_HOLD) {
  const d = Number.isFinite(dist) ? Math.max(0, dist) : H.near;
  const t = Math.min(1, Math.max(0, (d - H.near) / (H.far - H.near)));
  return H.min + (H.max - H.min) * t;
}

// The hold for a slap: a number only while dancing, else null (= leave the patch's own hold alone).
export function slapHold({ dancing, from, to }, H = DANCE_HOLD) {
  if (!dancing || !from || !to) return null;
  return danceHoldFor(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]), H);
}

// The patch with every layer's hold set to `hold` seconds; null/undefined → the same patch, untouched.
export function withHold(patch, hold) {
  if (hold == null || !Number.isFinite(hold) || !patch || !Array.isArray(patch.layers)) return patch;
  const h = Math.min(HOLD[1], Math.max(HOLD[0], hold));
  return { ...patch, layers: patch.layers.map((l) => ({ ...l, hold: h })) };
}
