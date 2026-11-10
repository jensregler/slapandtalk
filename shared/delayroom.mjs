// The delay room (plot 5, open to the east) – Jens's sketch + t790u, agreed 10 Nov 2026:
//   - THREE delays along the back wall (the west wall, opposite the opening): 1 left, 2 centre,
//     3 right as you look in from the entrance (looking west: left = south/+z, right = north/−z).
//   - FEEDBACK follows where I stand: each delay has 100 % in a zone round its point, fading
//     smoothly to 0 % toward the opening. The three 100 % zones overlap in the middle of the room
//     (the sketch's red "ALL 3 AT 100 %"); at the opening all three are 0 %.
//   - NO DELAY OUTSIDE THE ROOM: the room's delays (sends, feedback and the echoes' return) are
//     gated by delayRoomGate – 1 inside the walls, fading to 0 over the last metres before the
//     opening, 0 everywhere outside (street, other rooms, houses).
//   - DELAY TIMES are set when I slap: the distance from ME (the character, not the sticker) to each
//     delay point → a vector of three times, linear and clamped: 10 ms at the point, 1 s at the
//     room's diagonal. They stay until the next slap (feedback still follows me while I walk).
//     Before my first slap in a visit the times come from where I walked in (set on every entry).
//   - No 90 BPM sync: times come from distance only.
// Pure maths (no audio): shared/cityfx.mjs puts it in the place values, client/src/synth.js plays it
// (three delay lines on the place bus), client/src/main.js keeps the times (delayRoomTimes).
import { FX_ROOMS, HOUSE, WALL_T } from './city.mjs';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

const P5 = FX_ROOMS.find((p) => p.fx === 'delay') || { x: 32, z: 0, n: 5 };
const HW = HOUSE.width / 2, HD = HOUSE.depth / 2;
// The room's inside (metres, city coordinates): from the back wall's inner face to the opening
// (the ends of the north/south walls), between the north and south walls' inner faces.
const BACK = P5.x - HW + WALL_T;   // 24.4 – the back (west) wall's inner face
const OPEN = P5.x + HW;            // 40   – the opening (east)
const ZMIN = P5.z - HD + WALL_T, ZMAX = P5.z + HD - WALL_T; // −7.6 … 7.6
const INSET = 1;                   // the delay points sit 1 m in from the back wall / side walls

export const DELAY_ROOM = Object.freeze({
  plot: P5.n,
  box: Object.freeze({ x0: BACK, x1: OPEN, z0: ZMIN, z1: ZMAX }),
  // [x, z] of delay 1 (left), 2 (centre), 3 (right) – seen from the entrance, looking west.
  points: Object.freeze([
    Object.freeze([BACK + INSET, ZMAX - INSET]),
    Object.freeze([BACK + INSET, P5.z]),
    Object.freeze([BACK + INSET, ZMIN + INSET]),
  ]),
  // The room's own diagonal (inside floor, back wall → opening × wall → wall): ≈ 21.8 m = 1 s.
  diagonal: Math.hypot(OPEN - BACK, ZMAX - ZMIN),
  minTime: 0.010, maxTime: 1.0,     // seconds: at a delay point … at the diagonal (Jens: 10 ms, as on the sketch)
  fbFull: 8,                        // m: 100 % feedback within this distance of a point (overlaps mid-room)
  fbZero: OPEN - (BACK + INSET),    // m: 0 % at the opening's distance (14.6 m) – the opening is 0 % for all three
  openFade: 3,                      // m: the room's sound fades out over the last 3 m before the opening
  wet: 0.5,                         // per-delay send at full presence (× City sound, like the other FX rooms)
  loopMax: 0.95,                    // "100 %" feedback → loop gain 0.95: endless-sounding but can't run away
});

// Inside the room's walls (the open side up to the ends of the side walls)?
export function insideDelayRoom(x, z, R = DELAY_ROOM) {
  return Number.isFinite(x) && Number.isFinite(z) && x > R.box.x0 && x < R.box.x1 && z > R.box.z0 && z < R.box.z1;
}
// 0 … 1: how much of the room's delay I hear. 0 outside (no bleed through walls or the opening),
// 1 inside, a smooth fade over the last openFade metres before the opening.
export function delayRoomGate(x, z, R = DELAY_ROOM) {
  if (!insideDelayRoom(x, z, R)) return 0;
  return smooth((R.box.x1 - x) / R.openFade);
}
// Distances from (x, z) to the three delay points.
export const delayDistances = (x, z, R = DELAY_ROOM) => R.points.map(([px, pz]) => Math.hypot(x - px, z - pz));
// One distance → seconds: 10 ms at 0, 1 s at the room's diagonal, linear, clamped.
export function delayTimeFor(dist, R = DELAY_ROOM) {
  const d = Number.isFinite(dist) ? Math.max(0, dist) : R.diagonal;
  return clamp(R.minTime + (R.maxTime - R.minTime) * (d / R.diagonal), R.minTime, R.maxTime);
}
// The delay-time vector [t1, t2, t3] for a player at (x, z).
export const delayTimesAt = (x, z, R = DELAY_ROOM) => delayDistances(x, z, R).map((d) => delayTimeFor(d, R));
// Feedback 0 … 1 per delay at (x, z): 100 % within fbFull of its point, smooth to 0 % at fbZero
// (the opening); 0 outside the room.
export function delayFeedbackAt(x, z, R = DELAY_ROOM) {
  if (!insideDelayRoom(x, z, R)) return [0, 0, 0];
  return delayDistances(x, z, R).map((d) => (d <= R.fbFull ? 1 : d >= R.fbZero ? 0 : 1 - smooth((d - R.fbFull) / (R.fbZero - R.fbFull))));
}

// The held delay times (client: one per page). update(x, z) every place tick: on walking IN it sets the
// times from where I stand (every entry; a new visit forgets the last slap). slap(x, z) when I slap:
// inside the room the times jump to my distances and stay there until the next slap.
export function delayRoomTimes(R = DELAY_ROOM) {
  const s = { inside: false, times: delayTimesAt((R.box.x0 + R.box.x1) / 2, (R.box.z0 + R.box.z1) / 2, R), slapped: false, entries: 0, slaps: 0, from: 'start' };
  return {
    state: s,
    get times() { return s.times.slice(); },
    update(x, z) {
      const inside = insideDelayRoom(x, z, R);
      if (inside && !s.inside) { s.times = delayTimesAt(x, z, R); s.slapped = false; s.entries++; s.from = 'entry'; }
      s.inside = inside;
      return s.times.slice();
    },
    slap(x, z) {
      if (!insideDelayRoom(x, z, R)) return false; // a slap outside doesn't touch the room's times
      if (!s.inside) this.update(x, z);
      s.times = delayTimesAt(x, z, R); s.slapped = true; s.slaps++; s.from = 'slap';
      return true;
    },
  };
}
