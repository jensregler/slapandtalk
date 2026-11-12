// Noise-room speakers (Jens, t872u, 12 Nov 2026 – sketch: plot 7 seen from above, north up, opening in the
// south wall). Two speakers, A on the WEST wall and B on the EAST wall, facing each other. Each one is a
// player of its own: a random track from the playlist (public/noise-speakers/manifest.json), then the next
// random one, and so on – A and B independently.
//
// Volume depends ONLY on where the listener stands along the west–east axis INSIDE the room (no ordinary
// distance falloff, no sound outside). t = 0 at a speaker's own wall, 1 at the opposite wall:
//   0      … FULL            100 %
//   FULL   … FADE_END        99 % → 0 % (straight line)
//   FADE_END … 1             silent
// With FULL = 2/3 and FADE_END = 2/3 + (2/3)·(1/3) = 8/9 this gives (room 15.2 m wide inside):
//   west ninth  (0 … 1/9)    only A          (B is silent there)
//   1/9 … 1/3                A 100 %, B fading in
//   middle third (1/3 … 2/3) A and B both 100 %
//   2/3 … 8/9                B 100 %, A fading out
//   east ninth  (8/9 … 1)    only B
// ---- the numbers to tweak are all here ----
import { PLOTS, HOUSE, WALL_T } from './city.mjs';

export const NOISE_SPEAKERS = Object.freeze({
  plot: 7,                 // the noise room
  full: 2 / 3,             // 100 % from the speaker's wall up to this share of the room's width
  fadeEnd: 2 / 3 + (2 / 3) * (1 / 3), // …then 99 % → 0 % up to here (8/9); silent after it
  fadeTop: 0.99,           // the fade starts at 99 %
  master: 0.85,            // overall loudness of the speakers (× the player's own volume)
  mountY: 3.2,             // the speaker's centre, metres above the floor
  size: Object.freeze({ w: 1.1, h: 1.7, d: 0.55 }), // the cabinet (m)
  blockHours: 6,           // the shared schedule restarts every 6 h (a track running over the edge is cut there)
  resyncSec: 1.5,          // seek again if my player drifts more than this from the shared schedule
});

export const NOISE_PLOT = PLOTS.find((p) => p.n === NOISE_SPEAKERS.plot);
// The room's inside (between the walls' inner faces).
export const NOISE_INSIDE = Object.freeze({
  x0: NOISE_PLOT.x - HOUSE.width / 2 + WALL_T, x1: NOISE_PLOT.x + HOUSE.width / 2 - WALL_T,
  z0: NOISE_PLOT.z - HOUSE.depth / 2 + WALL_T, z1: NOISE_PLOT.z + HOUSE.depth / 2 - WALL_T,
});
export const NOISE_WIDTH = NOISE_INSIDE.x1 - NOISE_INSIDE.x0;
// The two speakers: on the inner face of the west / east wall, mid-depth, facing into the room.
export const SPEAKERS = Object.freeze([
  Object.freeze({ id: 'A', wall: 'west', x: NOISE_INSIDE.x0, z: NOISE_PLOT.z, facing: 1 }),
  Object.freeze({ id: 'B', wall: 'east', x: NOISE_INSIDE.x1, z: NOISE_PLOT.z, facing: -1 }),
]);

export const inNoiseRoom = (x, z) => x > NOISE_INSIDE.x0 && x < NOISE_INSIDE.x1 && z > NOISE_INSIDE.z0 && z < NOISE_INSIDE.z1;
// The zone curve: t = share of the room's width from the speaker's wall (0 … 1) → gain 0 … 1.
export function zoneGain(t, Z = NOISE_SPEAKERS) {
  if (!(t >= 0)) t = 0; if (t > 1) t = 1;
  if (t <= Z.full) return 1;
  if (t >= Z.fadeEnd) return 0;
  return Z.fadeTop * (1 - (t - Z.full) / (Z.fadeEnd - Z.full));
}
// A speaker's gain for a listener at (x, z): 0 outside the room.
export function speakerGain(id, x, z, Z = NOISE_SPEAKERS) {
  if (!inNoiseRoom(x, z)) return 0;
  const u = (x - NOISE_INSIDE.x0) / NOISE_WIDTH; // 0 west wall … 1 east wall
  return zoneGain(id === 'A' ? u : 1 - u, Z);
}

// ---- the shared schedule: everyone in the room hears the same track at the same place ----
// No server state: from the server-corrected clock (groove.now()) and the manifest, every client works out
// the same "track i started at ms s" for each speaker. Time is cut into blocks (blockHours); a block's tracks
// are drawn by a PRNG seeded with (speaker, block, playlist), never the same track twice in a row (if > 1).
function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const playlistKey = (tracks) => tracks.map((t) => t.file + ':' + Math.round(t.duration * 10)).join('|');
// → { index, track, startMs, endMs, offsetSec } or null (no tracks).
export function speakerTrackAt(tracks, speakerId, nowMs, Z = NOISE_SPEAKERS) {
  const list = (tracks || []).filter((t) => t && t.file && t.duration > 0.5);
  if (!list.length) return null;
  const P = Z.blockHours * 3600e3, block = Math.floor(nowMs / P), blockStart = block * P;
  const rnd = mulberry(hash32(`${speakerId}|${block}|${playlistKey(list)}`));
  let at = blockStart, prev = -1;
  for (let guard = 0; guard < 100000; guard++) {
    let i = Math.floor(rnd() * list.length);
    if (list.length > 1 && i === prev) i = (i + 1 + Math.floor(rnd() * (list.length - 1))) % list.length;
    const end = Math.min(at + list[i].duration * 1000, blockStart + P);
    if (nowMs < end) return { index: tracks.indexOf(list[i]), track: list[i], startMs: at, endMs: end, offsetSec: (nowMs - at) / 1000 };
    at = end; prev = i;
  }
  return null;
}
