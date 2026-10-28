// The sticker wheel (Jens, 28 Oct 2026): the sticker tray as a round reel that never ends – past the
// last sticker comes the first again, both ways. The selected (held) sticker sits in the middle:
// full colour, upright, on top. Outwards the stickers lose colour (30 % less per step: 70 %, 40 %,
// 10 %, then grey), turn more and more (clockwise to the right, counter-clockwise to the left) and
// tuck in behind each other, so it reads like a wheel turning. Pure maths (no DOM): the client
// (client/src/wheel.js) and the tests use the same numbers.

export const WHEEL = {
  satStep: 0.3,     // colour lost per sticker of distance from the middle
  rotStep: 9,       // degrees per sticker of distance (right = clockwise = positive CSS rotate)
  rotMax: 38,       // the outermost never turn more than this
  scaleStep: 0.07,  // a bit smaller per step …
  scaleMin: 0.72,   // … down to this
  dropPx: 2.2,      // the reel curves down a little outwards (px · d²) …
  dropMax: 26,      // … at most this
};

// i mod n, always 0 … n-1
export const mod = (i, n) => ((i % n) + n) % n;

// Signed distance (in stickers) from the wheel's position `pos` (fractional while it turns) to
// sticker i of n, the short way round: in (-n/2, n/2]. Positive = to the right of the middle.
export function wrapDist(i, pos, n) {
  if (!(n > 0)) return 0;
  let d = mod(i - pos, n);
  if (d > n / 2) d -= n;
  return d;
}

// Which sticker the wheel stops on at `pos`.
export const indexAt = (pos, n) => (n > 0 ? mod(Math.round(pos), n) : -1);

// Where to turn to so sticker i is in the middle, the short way from `pos` (unwrapped, so turning
// from the last to the first is one step, not a spin back through all of them).
export const targetFor = (i, pos, n) => pos + wrapDist(i, pos, n);

// Saturation (1 = full colour) at distance d: 1, .7, .4, .1, 0 …
export const saturationAt = (d) => Math.max(0, Math.min(1, 1 - WHEEL.satStep * Math.abs(d)));

// Rotation in degrees at distance d: 0 in the middle, + (clockwise) to the right, − to the left.
export const rotationAt = (d) => Math.sign(d) * Math.min(Math.abs(d) * WHEEL.rotStep, WHEEL.rotMax);

// Stacking: the middle on top, each step out further behind.
export const zAt = (d) => 1000 - Math.round(Math.abs(d) * 100);

export const scaleAt = (d) => Math.max(WHEEL.scaleMin, 1 - WHEEL.scaleStep * Math.abs(d));

// How far out (in stickers) there is room for, given the half-width of the wheel in px, the gap
// from the middle to its neighbour (`first`) and between the others (`gap`, smaller: they overlap).
export function reach(halfPx, first, gap) {
  if (!(halfPx > 0)) return 0;
  return Math.max(0, halfPx <= first ? 0 : 1 + Math.floor((halfPx - first) / gap));
}

// Everything one sticker needs at distance d: x/y offset from the middle (px), rotation (deg),
// saturation (0–1), scale, z-index and opacity (it fades in/out at the ends of the window, and on a
// short list where the wheel's two ends meet behind it).
export function itemAt(d, { n, first = 70, gap = 46, reachN = Infinity } = {}) {
  const a = Math.abs(d), s = Math.sign(d);
  const x = s * (Math.min(a, 1) * first + Math.max(a - 1, 0) * gap);
  const y = Math.min(WHEEL.dropMax, WHEEL.dropPx * a * a);
  const edge = Math.min(reachN, n > 0 ? n / 2 : Infinity);
  const op = Math.max(0, Math.min(1, edge + 0.5 - a));
  return { d, x, y, rot: rotationAt(d), sat: saturationAt(d), scale: scaleAt(d), z: zAt(d), op };
}
