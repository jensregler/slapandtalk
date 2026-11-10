// The reverb room (plot 4, open to the WEST) – Jens, voice 10 Nov 2026 (~22:02): "three feedback points in
// the reverb room, same setup as the delay room: point 1, 2 and 3 at the back left, centre and right".
// Same control law as the delay room (shared/delayroom.mjs), mirrored for a room that opens to the west:
//   - THREE points along the back wall (the EAST wall, opposite the opening), 1 m in from it and from the
//     side walls: 1 left, 2 centre, 3 right as you look in from the opening (looking east: left = north/−z,
//     right = south/+z – +z is south in this city).
//   - FEEDBACK follows where I stand: 100 % within fbFull (8 m) of a point, smooth to 0 % at the opening's
//     distance (14.6 m); the three 100 % zones overlap mid-room toward the back; at the opening all are 0 %.
//     "100 %" = loop gain loopMax (0.95) so it can't run away.
//   - NO REVERB OUTSIDE THE ROOM: the gate is 1 inside the walls, fades to 0 over the last 3 m before the
//     opening, 0 everywhere outside. It drives each point's send, feedback and return (a ringing tail is
//     cut when I walk out). No spill through the opening or the walls (the old hall's 5 m / 3 m is gone).
//   - TIMES are set when I slap, from ME (the camera, not the sticker): t = 0.010 + 0.99 · d / diagonal,
//     clamped 10 ms … 1 s; held until the next slap; set from where I walk in on every entry. No BPM.
//     In the reverb the time is each point's PRE-DELAY and the period of its diffuse feedback loop
//     (client/src/synth.js: pre-delay → 2 Schroeder all-passes → damping → feedback ↻, → diffuse tail).
//   - TONES (Jens, same evening, corrected): one pure SINE per point, rest pitch 440 Hz. The vector from me to
//     a point never moves its pitch; only where I LOOK does (below). Each tone's volume is pulsed by an LFO from 0 to 100 % (full depth). The VECTOR from me to the
//     point sets that LFO's RATE (how fast it pulses), live while I walk: its length d →
//       lfoHz = lfoMax − (lfoMax − lfoMin) · min(d, diagonal) / diagonal   (8 Hz at the point … 0.5 Hz at the diagonal)
//     – closer = faster. Only the length is used (direction does not matter). Same gate as the points.
//   - LOOK-OUT FADE (Jens, same evening): if I LOOK out of the room (past the ends of the side walls, out
//     through the opening) the three sines fade to silence; looking back at the walls brings them back.
//     My horizontal look ray (yaw only, from where I stand) is followed to the first face of the room's
//     inner box: back wall → 1; a side wall hit e metres in from its open end → smooth(e / lookFade)
//     (lookFade 2 m, so the fade happens along the last 2 m of the side walls); out through the opening → 0.
//     It multiplies the tones' level on top of the body gate (walk out OR look out shuts them).
//   - LOOK-DRIVEN PITCH: the look ray's hit on the three walls UNFOLDED into one strip (left/north wall from its
//     open end → back wall → right/south wall to its open end, 46.4 m), s = −1 (far left) … 0 (back-wall centre)
//     … +1 (far right), and the hit height on that wall, h = −1 (floor) … 0 (eye height) … +1 (roof):
//       tone 1 = 440 · 2^h          (vertical look: 220 … 880 Hz)
//       tone 2 = 440 · 2^max(0, s)  (how far right: 440 … 880 Hz)
//       tone 3 = 440 · 2^max(0, −s) (how far left: 440 … 880 Hz)
//     Looking at the back wall's centre at eye height = all three at 440 Hz (the rest point), from anywhere.
//   - STANDING STILL LOCKS THE LFO RATES (Jens, same evening): while I'm not walking/running (the footstep
//     sequencer's walking test) the three LFO rates stay at their values from when I stopped – the LFOs keep
//     pulsing 0 … 100 % at those rates; walking again unlocks them (they follow the live vectors). Entering the
//     room (or being outside) always takes the live rates. Nothing else locks (feedback, times, gates, pitch).
// Pure maths (no audio): shared/cityfx.mjs puts it in the place values, client/src/synth.js plays it,
// client/src/main.js holds the times (reverbRoomTimes).
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
  diagonal: Math.hypot(BACK - OPEN, ZMAX - ZMIN), // ≈ 21.8 m = 1 s
  minTime: 0.010, maxTime: 1.0,
  fbFull: 8,
  fbZero: (BACK - INSET) - OPEN,   // 14.6 m – the opening is 0 % for all three
  openFade: 3,
  wet: 0.5,                        // per-point send at full presence (× City sound)
  loopMax: 0.95,
  // The three sines (pitch fixed) and their volume LFOs (rate from my distance to the point).
  toneHz: 440, toneLevel: 0.12,    // per tone at full presence (× City sound) – a quiet bed under my sound
  lfoMin: 0.5, lfoMax: 8,          // Hz: at the diagonal (or further) … standing on the point
  lfoDepth: 1,                     // 0 … 100 % volume (full depth)
  toneMinHz: 220, toneMaxHz: 880,  // the look-driven pitch range (one octave either side of 440)
  lookFade: 2,                     // m: the tones fade over the last 2 m of the side walls toward the opening
});

export function insideReverbRoom(x, z, R = REVERB_ROOM) {
  return Number.isFinite(x) && Number.isFinite(z) && x > R.box.x0 && x < R.box.x1 && z > R.box.z0 && z < R.box.z1;
}
// 0 … 1: 0 outside, 1 inside, a smooth fade over the last openFade metres before the (west) opening.
export function reverbRoomGate(x, z, R = REVERB_ROOM) {
  if (!insideReverbRoom(x, z, R)) return 0;
  return smooth((x - R.open) / R.openFade);
}
// The vectors from me (x, z) to the three points, and their lengths.
export const reverbVectors = (x, z, R = REVERB_ROOM) => R.points.map(([px, pz]) => [px - x, pz - z]);
export const reverbDistances = (x, z, R = REVERB_ROOM) => R.points.map(([px, pz]) => Math.hypot(x - px, z - pz));
export function reverbTimeFor(dist, R = REVERB_ROOM) {
  const d = Number.isFinite(dist) ? Math.max(0, dist) : R.diagonal;
  return clamp(R.minTime + (R.maxTime - R.minTime) * (d / R.diagonal), R.minTime, R.maxTime);
}
export const reverbTimesAt = (x, z, R = REVERB_ROOM) => reverbDistances(x, z, R).map((d) => reverbTimeFor(d, R));
export function reverbFeedbackAt(x, z, R = REVERB_ROOM) {
  if (!insideReverbRoom(x, z, R)) return [0, 0, 0];
  return reverbDistances(x, z, R).map((d) => (d <= R.fbFull ? 1 : d >= R.fbZero ? 0 : 1 - smooth((d - R.fbFull) / (R.fbZero - R.fbFull))));
}
// The LFO rate (Hz) for one vector [dx, dz] from me to a point: its length, linear, closer = faster.
export function lfoRateFor(vec, R = REVERB_ROOM) {
  const d = Array.isArray(vec) ? Math.hypot(vec[0], vec[1]) : vec;
  const k = Number.isFinite(d) ? clamp(Math.max(0, d) / R.diagonal, 0, 1) : 1;
  return R.lfoMax - (R.lfoMax - R.lfoMin) * k;
}
export const reverbLfoRatesAt = (x, z, R = REVERB_ROOM) => reverbVectors(x, z, R).map((v) => lfoRateFor(v, R));

// 0 … 1: how much of the tones I hear for where I LOOK, standing at (x, z) looking along (dx, dz) (horizontal
// forward; the client passes (−sin yaw, −cos yaw)). Outside the room: 0 (the body gate shuts it anyway).
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
// The LFO-rate lock (client: one per page). update(x, z, walking) every place tick → the three rates to play.
export function reverbLfoLock(R = REVERB_ROOM) {
  const s = { inside: false, locked: false, rates: reverbLfoRatesAt((R.box.x0 + R.box.x1) / 2, (R.box.z0 + R.box.z1) / 2, R), locks: 0 };
  return {
    state: s,
    get rates() { return s.rates.slice(); },
    update(x, z, walking) {
      const inside = insideReverbRoom(x, z, R), entering = inside && !s.inside;
      s.inside = inside;
      if (!inside || entering || walking) { s.rates = reverbLfoRatesAt(x, z, R); s.locked = false; }
      else if (!s.locked) { s.locked = true; s.locks++; } // stopped: keep the rates from the last moving tick
      return s.rates.slice();
    },
  };
}

// The held times (client: one per page), exactly like delayRoomTimes.
export function reverbRoomTimes(R = REVERB_ROOM) {
  const s = { inside: false, times: reverbTimesAt((R.box.x0 + R.box.x1) / 2, (R.box.z0 + R.box.z1) / 2, R), slapped: false, entries: 0, slaps: 0, from: 'start' };
  return {
    state: s,
    get times() { return s.times.slice(); },
    update(x, z) {
      const inside = insideReverbRoom(x, z, R);
      if (inside && !s.inside) { s.times = reverbTimesAt(x, z, R); s.slapped = false; s.entries++; s.from = 'entry'; }
      s.inside = inside;
      return s.times.slice();
    },
    slap(x, z) {
      if (!insideReverbRoom(x, z, R)) return false;
      if (!s.inside) this.update(x, z);
      s.times = reverbTimesAt(x, z, R); s.slapped = true; s.slaps++; s.from = 'slap';
      return true;
    },
  };
}
