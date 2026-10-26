// Sticker arrays ("dynamic array"): slap at A, keep the button held, look/drag to B, and the
// sticker repeats from A toward B, edge to edge (Jens, 26 Oct 2026). Shared by the web app
// (live ghosts + the optimistic copies) and the server (which recomputes the positions itself
// from the saved anchor sticker, so a client can't place copies anywhere it likes).
//
// The spacing rule. Every copy has the anchor's orientation (rotation included) and size; they are
// never turned to the drag direction. Let d = the unit direction A→B on the anchor's face, and
// (du, dv) = d in the sticker's own axes (u = its width axis, v = its height axis). The step is the
// smallest distance along d at which two such rectangles just touch:
//     step = min(w / |du|, h / |dv|)
// so straight along the width the step is w, straight along the height it is h, and on a diagonal
// the copies touch along one edge, offset like a staircase (Jens's sketch). Count = floor(|AB| / step) + 1
// (the anchor included), at most ARRAY_MAX. A copy whose centre falls outside the anchor's face is
// not placed (no wrapping round corners); one whose centre is on the face but overhangs an edge
// folds like any other sticker.
import { boxFaces } from './coverage.mjs';

export const ARRAY_MAX = 200; // stickers per drag, the anchor included

const qApply = (q, v) => { const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);
const r6 = (x) => Math.round(x * 1e6) / 1e6;

// The step along a unit direction (du, dv) given in the sticker's own axes, for a w × h sticker.
export function arrayStep(du, dv, w, h) {
  const a = Math.abs(du), b = Math.abs(dv);
  const s = Math.min(a > 1e-9 ? w / a : Infinity, b > 1e-9 ? h / b : Infinity);
  return Number.isFinite(s) ? s : 0;
}

// The anchor's face: its saved surface if that faces the sticker's way, else the nearest one that does.
export function faceFor(faces, surface, position, normal) {
  const want = (f) => f.s * normal[f.k] > 0.9;
  const named = faces.find((f) => f.name === surface && want(f));
  if (named) return named;
  let best = null, bd = Infinity;
  for (const f of faces) { if (!want(f)) continue; const d = Math.abs(position[f.k] - f.v); if (d < bd) { bd = d; best = f; } }
  return best;
}

// The plan for one drag. anchor = { position, quaternion, surface }, w × h = the sticker's size in
// metres (stampDims), to = B (any point; only its part along the face counts).
// Returns { step, dir, count, items: [{ i, position }] } with i = 0 the anchor itself; items are
// only the ones whose centre is on the face. A bad input gives count 0 and no items.
export function arrayPlan(anchor, w, h, to, { faces = boxFaces(), max = ARRAY_MAX } = {}) {
  const none = { step: 0, dir: [0, 0, 0], count: 0, items: [] };
  if (!anchor || !isVec(anchor.position, 3) || !isVec(anchor.quaternion, 4) || !isVec(to, 3) || !isNum(w) || !isNum(h) || w <= 0 || h <= 0) return none;
  const A = anchor.position, q = anchor.quaternion;
  const n = qApply(q, [0, 0, 1]);
  const F = faceFor(faces, String(anchor.surface || ''), A, n);
  if (!F) return none;
  const d = [to[0] - A[0], to[1] - A[1], to[2] - A[2]]; d[F.k] = 0; // along the face only
  const len = Math.hypot(d[0], d[1], d[2]);
  const one = { step: 0, dir: [0, 0, 0], count: 1, items: [{ i: 0, position: A.slice() }] };
  if (len < 1e-6) return one;
  const dir = d.map((x) => x / len);
  const u = qApply(q, [1, 0, 0]), v = qApply(q, [0, 1, 0]);
  const step = arrayStep(dot(dir, u), dot(dir, v), w, h);
  if (!(step > 1e-6)) return one;
  const count = Math.min(Math.max(1, max | 0), Math.floor(len / step + 1e-9) + 1);
  const items = [];
  const eps = 1e-6;
  for (let i = 0; i < count; i++) {
    const p = A.map((a, j) => (j === F.k ? a : r6(a + dir[j] * step * i)));
    let inside = true;
    for (let j = 0; j < 3; j++) if (j !== F.k && (p[j] < F.lo[j] - eps || p[j] > F.hi[j] + eps)) inside = false;
    if (!inside) break; // the face is a rectangle: once off it, the rest of the row is off it too
    items.push({ i, position: p });
  }
  return { step, dir, count, items };
}

// Backing paper (peels on): the anchor drops its own as usual, and the first PEELS_PER_ARRAY copies
// one each, seeded "<nonce>x<i>" (so a long row doesn't bury the floor in paper).
export const PEELS_PER_ARRAY = 4;

// Is a sticker centred at `position` with bounding radius r fully inside the face (no fold needed)?
export function insideFace(face, position, r) {
  if (!face) return false;
  for (let j = 0; j < 3; j++) if (j !== face.k && (position[j] - r < face.lo[j] || position[j] + r > face.hi[j])) return false;
  return true;
}
