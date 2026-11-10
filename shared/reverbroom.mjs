// The reverb room (plot 4, open to the WEST) – Jens, voice 10 Nov 2026, corrected the same night (t808u–t812u):
// the delay-room-copied control law (distance feedback 8 m → 14.6 m, pre-delay / loop times set on slap, send
// 0 … 0.5 × City sound × a 3 m opening gate) was "allt fel". What is left:
//   - THREE points along the back wall (the EAST wall, opposite the opening), 1 m in from it and from the
//     side walls: 1 left, 2 centre, 3 right as you look in from the opening (looking east: left = north/−z,
//     right = south/+z – +z is south in this city).
//   - TONES: one pure SINE per point, rest pitch 440 Hz, each with ONE sine volume LFO, always 0 … 100 %
//     (0.5 + 0.5·sin – silence to full; the depth never changes). "lfo freq = avstånd character − punkt":
//     the distance d from me (the camera) to the point is the ONLY thing it drives – that LFO's frequency, live:
//       lfoHz = lfoMin + (lfoMax − lfoMin) · min(d, diagonal) / diagonal   (2 Hz on the point … 1000 Hz at the
//     21.8 m diagonal or further) – further away = faster. Only the length is used (direction does not matter).
//     Standing still the distance is constant, so the rate simply holds (no lock needed).
//   - The sines go to my ears DRY (after their LFO and the look-out / presence fade) – never into a feedback
//     loop (the live 0.95 loops with the sines injected howled mid-room).
//   - LOOK-OUT FADE: if I LOOK out of the room (past the ends of the side walls, out through the opening) the
//     three sines fade to silence; looking back at the walls brings them back. My horizontal look ray (yaw only,
//     from where I stand) is followed to the first face of the room's inner box: back wall → 1; a side wall hit
//     e metres in from its open end → smooth(e / lookFade) (lookFade 2 m); out through the opening → 0.
//     It multiplies only the tones' level, on top of the presence (walk out OR look out shuts them).
//   - LOOK-DRIVEN PITCH: the look ray's hit on the three walls UNFOLDED into one strip (left/north wall from its
//     open end → back wall → right/south wall to its open end, 46.4 m), s = −1 (far left) … 0 (back-wall centre)
//     … +1 (far right), and the hit height on that wall, h = −1 (floor) … 0 (eye height) … +1 (roof):
//       tone 1 = 440 · 2^h          (vertical look: 220 … 880 Hz)
//       tone 2 = 440 · 2^max(0, s)  (how far right: 440 … 880 Hz)
//       tone 3 = 440 · 2^max(0, −s) (how far left: 440 … 880 Hz)
//     Looking at the back wall's centre at eye height = all three at 440 Hz (the rest point), from anywhere.
//   - THE ROOM'S OWN REVERB (voices, footsteps, my sound): a plain FIXED reverb while I'm inside – the same
//     three diffuse cells (client/src/synth.js), but with fixed pre-delays, a fixed modest loop gain and a fixed
//     send; nothing follows my distance or my slaps. Presence is simply inside (1) / outside (0), with a short
//     2 m smooth step just inside the opening (no click, no jump), so nothing spills into the street.
// Pure maths (no audio): shared/cityfx.mjs puts it in the place values, client/src/synth.js plays it,
// client/src/main.js adds the look (pitch, look-out fade).
import { FX_ROOMS, HOUSE, WALL_T } from './city.mjs';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

const P4 = FX_ROOMS.find((p) => p.fx === 'reverb') || { x: -32, z: 0, n: 4 };
const HW = HOUSE.width / 2, HD = HOUSE.depth / 2;
const BACK = P4.x + HW - WALL_T;   // −24.4 – the back (east) wall's inner face
const OPEN = P4.x - HW;            // −40   – the opening (west)
const ZMIN = P4.z - HD + WALL_T, ZMAX = P4.z + HD - WALL_T; // −7.6 … 7.6
const INSET = 1;

export const REVERB_ROOM = Object.freeze({
  plot: P4.n,
  box: Object.freeze({ x0: OPEN, x1: BACK, z0: ZMIN, z1: ZMAX }),
  back: BACK, open: OPEN,
  // [x, z] of point 1 (left), 2 (centre), 3 (right) – seen from the opening, looking east.
  points: Object.freeze([
    Object.freeze([BACK - INSET, ZMIN + INSET]),
    Object.freeze([BACK - INSET, P4.z]),
    Object.freeze([BACK - INSET, ZMAX - INSET]),
  ]),
  diagonal: Math.hypot(BACK - OPEN, ZMAX - ZMIN), // ≈ 21.8 m
  // The room's own reverb – FIXED while inside (no distance, no slap): send, loop gain, per-cell pre-delays (s).
  wet: 0.35, loopGain: 0.5, preTimes: Object.freeze([0.019, 0.027, 0.037]), maxPre: 0.1,
  // The three sines (rest 440 Hz) and their volume LFOs (frequency = my distance to the point).
  toneHz: 440, toneLevel: 0.12,    // per tone at full presence (× City sound) – a quiet bed under my sound
  lfoMin: 2, lfoMax: 1000,         // Hz: standing on the point … at the diagonal (or further)
  lfoDepth: 1,                     // ALWAYS 0 … 100 % volume (full depth) – only the frequency changes
  toneMinHz: 220, toneMaxHz: 880,  // the look-driven pitch range (one octave either side of 440)
  lookFade: 2,                     // m: the tones fade over the last 2 m of the side walls toward the opening
  presenceFade: 2,                 // m: walking in / out through the opening – a short step, no click or jump
});

export function insideReverbRoom(x, z, R = REVERB_ROOM) {
  return Number.isFinite(x) && Number.isFinite(z) && x > R.box.x0 && x < R.box.x1 && z > R.box.z0 && z < R.box.z1;
}
// Presence: 1 inside the walls, 0 outside, with a short smooth step over the last presenceFade (2 m) inside the
// opening so walking in / out never clicks or jumps. Only an on/off for the room – it is not the old 3 m gate
// (no feedback rides on it, and nothing else in the room depends on where I stand).
export function reverbRoomPresence(x, z, R = REVERB_ROOM) {
  if (!insideReverbRoom(x, z, R)) return 0;
  return smooth((x - R.open) / R.presenceFade);
}
// The vectors from me (x, z) to the three points, and their lengths.
export const reverbVectors = (x, z, R = REVERB_ROOM) => R.points.map(([px, pz]) => [px - x, pz - z]);
export const reverbDistances = (x, z, R = REVERB_ROOM) => R.points.map(([px, pz]) => Math.hypot(x - px, z - pz));
// The volume-LFO frequency (Hz) for one vector [dx, dz] from me to a point (or a distance): its length, linear,
// further = faster – 2 Hz on the point … 1000 Hz at the diagonal or beyond.
export function lfoRateFor(vec, R = REVERB_ROOM) {
  const d = Array.isArray(vec) ? Math.hypot(vec[0], vec[1]) : vec;
  const k = Number.isFinite(d) ? clamp(Math.max(0, d) / R.diagonal, 0, 1) : 1;
  return clamp(R.lfoMin + (R.lfoMax - R.lfoMin) * k, R.lfoMin, R.lfoMax);
}
export const reverbLfoRatesAt = (x, z, R = REVERB_ROOM) => reverbVectors(x, z, R).map((v) => lfoRateFor(v, R));

// 0 … 1: how much of the tones I hear for where I LOOK, standing at (x, z) looking along (dx, dz) (horizontal
// forward; the client passes (−sin yaw, −cos yaw)). Outside the room: 0 (the presence shuts it anyway).
export function reverbGazeAt(x, z, dx, dz, R = REVERB_ROOM) {
  if (!insideReverbRoom(x, z, R)) return 0;
  const hit = lookHit(x, z, dx, dz, R); if (!hit) return 1; // straight up / down: no horizontal look → keep
  if (hit.face === 'back') return 1;
  if (hit.face === 'open') return 0;
  return smooth((hit.hx - R.box.x0) / R.lookFade); // metres in from the side wall's open end
}
// Gaze from a yaw (controls.yaw: forward = (−sin yaw, −cos yaw)).
export const reverbGazeYaw = (x, z, yaw, R = REVERB_ROOM) => reverbGazeAt(x, z, -Math.sin(yaw), -Math.cos(yaw), R);

// The look ray's hit on the room's inner box: { face: 'back' | 'side' | 'open', t (horizontal m), hx, hz }.
function lookHit(x, z, dx, dz, R) {
  const L = Math.hypot(dx, dz); if (!(L > 1e-9)) return null;
  dx /= L; dz /= L;
  const B = R.box; let t = Infinity, face = null;
  if (dx > 0) { const tt = (B.x1 - x) / dx; if (tt < t) { t = tt; face = 'back'; } }
  if (dx < 0) { const tt = (B.x0 - x) / dx; if (tt < t) { t = tt; face = 'open'; } }
  if (dz > 0) { const tt = (B.z1 - z) / dz; if (tt < t) { t = tt; face = 'side'; } }
  if (dz < 0) { const tt = (B.z0 - z) / dz; if (tt < t) { t = tt; face = 'side'; } }
  return { face, t, hx: x + dx * t, hz: z + dz * t };
}
// Where on the unfolded walls I look: s −1 (left end) … +1 (right end), h −1 (floor) … +1 (roof).
export function reverbLookAt(x, z, yaw, pitch = 0, eyeY = 1.7, R = REVERB_ROOM) {
  const B = R.box, W = B.x1 - B.x0, D = B.z1 - B.z0, half = W + D / 2;
  const hit = lookHit(x, z, -Math.sin(yaw), -Math.cos(yaw), R);
  if (!hit) return { s: 0, h: clamp(Math.sign(pitch), -1, 1), face: null };
  let u;
  if (hit.face === 'back') u = W + (hit.hz - B.z0);
  else if (hit.face === 'side') u = hit.hz <= (B.z0 + B.z1) / 2 ? hit.hx - B.x0 : W + D + (B.x1 - hit.hx);
  else u = hit.hz <= (B.z0 + B.z1) / 2 ? 0 : 2 * half; // out through the opening: the strip's ends (silent anyway)
  const s = clamp((u - half) / half, -1, 1);
  const H = HOUSE.height, y = clamp(eyeY + Math.tan(clamp(pitch, -1.55, 1.55)) * hit.t, 0, H);
  const h = y >= eyeY ? (H > eyeY ? (y - eyeY) / (H - eyeY) : 0) : (eyeY > 0 ? (y - eyeY) / eyeY : 0);
  return { s, h: clamp(h, -1, 1), face: hit.face };
}
// The three sine pitches (Hz) for where I look.
export function reverbPitchesAt(x, z, yaw, pitch = 0, eyeY = 1.7, R = REVERB_ROOM) {
  const { s, h } = reverbLookAt(x, z, yaw, pitch, eyeY, R);
  const f = (k) => clamp(R.toneHz * Math.pow(2, k), R.toneMinHz, R.toneMaxHz);
  return [f(h), f(Math.max(0, s)), f(Math.max(0, -s))];
}
