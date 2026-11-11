// Sticker arrays ("dynamic array"): slap at A, keep the button held, look/drag to B, and the
// sticker repeats from A toward B, edge to edge (Jens, 26 Oct 2026). Shared by the web app
// (live ghosts + the optimistic copies) and the server (which recomputes the positions itself
// from the saved anchor sticker, so a client can't place copies anywhere it likes).
//
// The spacing rule. Every copy has the anchor's orientation (rotation included). Let d = the unit
// direction A→B on the anchor's face, and (du, dv) = d in the sticker's own axes. The step between
// two neighbours is the smallest distance along d at which two rectangles of their (local) sizes
// just touch:
//     step = min(w / |du|, h / |dv|)
// With a uniform size that is the old rule. With a fan (end size ≠ start size, Jens 6 Nov 2026) the
// size of each sticker interpolates from the anchor's size to the end size along the row, and each
// step uses that sticker's own w × h so neighbours still just touch (no ugly overlap / gap).
// Count = how many fit before past B, at most ARRAY_MAX. A copy whose centre falls outside the
// anchor's face is not placed (no wrapping round corners).
import { boxFaces } from './coverage.mjs';

export const ARRAY_MAX = 200; // stickers per drag, the anchor included

const qApply = (q, v) => { const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);
const r6 = (x) => Math.round(x * 1e6) / 1e6;

export const lerp = (a, b, t) => a + (b - a) * t;

// Size of sticker i in a row of n (i = 0…n-1), interpolating size0 → size1.
export function arraySizeAt(i, n, size0, size1) {
  if (!(n > 1) || !isNum(size0)) return size0;
  const s1 = isNum(size1) ? size1 : size0;
  return lerp(size0, s1, Math.min(1, Math.max(0, i / (n - 1))));
}

// Mouse / trackpad wheel → multiplicative scale factor for the LAST sticker while dragging an array.
// deltaMode: 0 = pixels (trackpad), 1 = lines (mouse notch), 2 = pages. Scroll down = smaller.
export function wheelScaleFactor(deltaY, deltaMode = 0) {
  let lines = Number(deltaY) || 0;
  if (deltaMode === 0) lines /= 100;
  else if (deltaMode === 2) lines *= 16;
  return Math.pow(1.08, -lines);
}

export function clampStampSize(size, min, max) {
  const s = Number(size);
  if (!isNum(s)) return isNum(min) ? min : 0;
  let out = s;
  if (isNum(min)) out = Math.max(min, out);
  if (isNum(max)) out = Math.min(max, out);
  return out;
}

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

// The space a row lives in (Jens, 11 Nov 2026: "reactivate hold-and-drag"). Rows used to be planned on
// the 16 × 8 × 16 m ROOM box only, so out in the 96 × 96 m city every drag away from the middle gave
// no copies at all. spaceFaces(box) = the six faces of THIS space (shared/city.mjs roomBox: the room, a
// house or the city), and clipFace narrows the anchor's face to the real surface it sits on (a house
// wall, a plaza bench top) so a row stops at that wall's edge instead of running out into the air.
export const spaceFaces = (box) => boxFaces(box || undefined);
// rect = { lo: [x, y, z], hi: [x, y, z] } (the surface's world bounds). Only shrinks the face; a rect
// that doesn't hold the anchor (or is junk) is ignored. Returns a face named after the anchor's surface.
export function clipFace(face, rect, anchorPos = null, eps = 1e-3) {
  if (!face) return null;
  if (!rect || !isVec(rect.lo, 3) || !isVec(rect.hi, 3)) return face;
  const lo = face.lo.slice(), hi = face.hi.slice();
  for (let j = 0; j < 3; j++) {
    if (j === face.k) continue;
    const a = Math.min(rect.lo[j], rect.hi[j]), b = Math.max(rect.lo[j], rect.hi[j]);
    lo[j] = Math.max(lo[j], a); hi[j] = Math.min(hi[j], b);
    if (lo[j] > hi[j]) return face;
    if (anchorPos && (anchorPos[j] < lo[j] - eps || anchorPos[j] > hi[j] + eps)) return face;
  }
  return { ...face, lo, hi };
}
// The face a row is planned on: the anchor's face in this space, clipped to its surface's rect.
export function anchorFace(anchor, { box = null, rect = null } = {}) {
  if (!anchor || !isVec(anchor.position, 3) || !isVec(anchor.quaternion, 4)) return null;
  const n = qApply(anchor.quaternion, [0, 0, 1]);
  const F = faceFor(spaceFaces(box), String(anchor.surface || ''), anchor.position, n);
  if (!F) return null;
  return clipFace({ ...F, name: String(anchor.surface || F.name) }, rect, anchor.position);
}

// The plan for one drag. anchor = { position, quaternion, surface }, w × h = the sticker's size in
// metres (stampDims) at the ANCHOR, to = B (any point; only its part along the face counts).
// endW × endH (optional): size of the LAST sticker (fan / trapezoid). Defaults to w × h (= old behaviour).
// Returns { step, dir, count, items: [{ i, position, w, h }] } with i = 0 the anchor itself; items are
// only the ones whose centre is on the face. A bad input gives count 0 and no items.
export function arrayPlan(anchor, w, h, to, { faces = boxFaces(), max = ARRAY_MAX, endW = null, endH = null } = {}) {
  const none = { step: 0, dir: [0, 0, 0], count: 0, items: [] };
  if (!anchor || !isVec(anchor.position, 3) || !isVec(anchor.quaternion, 4) || !isVec(to, 3) || !isNum(w) || !isNum(h) || w <= 0 || h <= 0) return none;
  const w1 = isNum(endW) && endW > 0 ? endW : w;
  const h1 = isNum(endH) && endH > 0 ? endH : h;
  const A = anchor.position, q = anchor.quaternion;
  const n = qApply(q, [0, 0, 1]);
  const F = faceFor(faces, String(anchor.surface || ''), A, n);
  if (!F) return none;
  const d = [to[0] - A[0], to[1] - A[1], to[2] - A[2]]; d[F.k] = 0; // along the face only
  const len = Math.hypot(d[0], d[1], d[2]);
  const one = { step: 0, dir: [0, 0, 0], count: 1, items: [{ i: 0, position: A.slice(), w, h }] };
  if (len < 1e-6) return one;
  const dir = d.map((x) => x / len);
  const u = qApply(q, [1, 0, 0]), v = qApply(q, [0, 1, 0]);
  const du = dot(dir, u), dv = dot(dir, v);
  const step0 = arrayStep(du, dv, w, h);
  if (!(step0 > 1e-6)) return one;
  // planned count from the ANCHOR step (same number the old uniform path reported), even when
  // some centres fall off the face; items is only the ones that fit.
  const planned = Math.min(Math.max(1, max | 0), Math.floor(len / step0 + 1e-9) + 1);
  const items = [];
  const eps = 1e-6;
  let dist = 0;
  for (let i = 0; i < planned; i++) {
    const t = planned <= 1 ? 0 : i / (planned - 1); // fan: size by index so last = end size
    const wi = lerp(w, w1, t), hi = lerp(h, h1, t);
    // spacing: step from previous sticker's size (i=0 uses anchor size)
    if (i > 0) {
      const prevT = (i - 1) / (planned - 1);
      const pw = lerp(w, w1, prevT), ph = lerp(h, h1, prevT);
      const step = arrayStep(du, dv, pw, ph);
      if (!(step > 1e-6)) break;
      dist += step;
      if (dist > len + 1e-9) break;
    }
    const p = A.map((a, j) => (j === F.k ? a : r6(a + dir[j] * dist)));
    let inside = true;
    for (let j = 0; j < 3; j++) if (j !== F.k && (p[j] < F.lo[j] - eps || p[j] > F.hi[j] + eps)) inside = false;
    if (!inside) break;
    items.push({ i, position: p, w: wi, h: hi });
  }
  if (!items.length) return none;
  return { step: step0, dir, count: planned, items };
}

// Backing paper (peels on): the anchor drops its own as usual, and every copy one each, seeded
// "<nonce>x<i>" (was only the first 4). The cap is the longest row there is (ARRAY_MAX), so it never
// bites a real drag; the floor still holds at most PEEL.maxPerRoom papers (oldest go first, as for
// single slaps) and the server's per-IP budget (ARRAY_BUDGET copies a minute) bounds the rate.
export const PEELS_PER_ARRAY = ARRAY_MAX;

// Is a sticker centred at `position` with bounding radius r fully inside the face (no fold needed)?
export function insideFace(face, position, r) {
  if (!face) return false;
  for (let j = 0; j < 3; j++) if (j !== face.k && (position[j] - r < face.lo[j] || position[j] + r > face.hi[j])) return false;
  return true;
}
