// Which stickers are hidden: fully (or almost fully) covered by NEWER stickers.
// Shared, deterministic and dependency-free (no three.js), used by the server for
// "Clear hidden stickers" and for the automatic cleanup when a sticker leaves the peel history.
//
// The room is the box from shared/room.json (the same box client/src/room.js builds).
// A sticker is a w×h rectangle (die-cut alpha mask if known) in the plane of the face it was
// slapped on, centred on its position and turned by its quaternion. Where it reaches past an edge it
// folds onto the neighbouring face (like client/src/fold.js: nothing is stretched, distances along
// the surface are kept). Coverage is sampled on an N×N grid of the sticker's own opaque cells:
// every sample is placed on the real surface point it lands on, and then tested against each newer
// sticker, unfolded into that sticker's plane (with its rotation and mask).
//
// Approximations (on purpose, all on the safe side of "keep"): in a room corner (past two edges at
// once) a sample goes to the face it is furthest into; a newer sticker only covers points on its own
// face or a neighbouring face (one fold), never across two folds.
import ROOM from './room.json' with { type: 'json' };

export const HIDDEN_AT = 0.98; // ≥ 98 % of the sticker's opaque area covered = hidden
export const COVER_SAMPLES = 24; // samples per side (576 per sticker)

// Faces: k = the axis the face is fixed on (0 x, 1 y, 2 z), v = where, s = +1/−1 = into the room.
export function boxFaces(room = ROOM) {
  const hw = room.width / 2, hd = room.depth / 2, H = room.height;
  const lo = [-hw, 0, -hd], hi = [hw, H, hd];
  const f = (name, k, v, s) => ({ name, k, v, s, lo, hi });
  return [f('golv', 1, 0, 1), f('tak', 1, H, -1), f('vägg-norr', 2, -hd, 1), f('vägg-söder', 2, hd, -1),
    f('vägg-väster', 0, -hw, 1), f('vägg-öster', 0, hw, -1)];
}

const qApply = (q, v) => { const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);

// mask = { n, bits } (row 0 = top of the image) or null/undefined = a plain rectangle.
const maskAt = (m, s, t) => !m || m.bits[Math.min(m.n - 1, Math.floor(t * m.n)) * m.n + Math.min(m.n - 1, Math.floor(s * m.n))] === 1;
export function stampDims(image, size) { const a = (image.width || 1) / (image.height || 1); return a >= 1 ? [size, size / a] : [size * a, size]; }

// The face a sticker sits on: its saved surface if that faces the right way, else the nearest face
// that does (old data), else null.
function faceOf(faces, stamp, n) {
  const want = (f) => f.s * n[f.k] > 0.9;
  const named = faces.find((f) => f.name === stamp.surface && want(f));
  if (named) return named;
  let best = null, bd = Infinity;
  for (const f of faces) { if (!want(f)) continue; const d = Math.abs(stamp.position[f.k] - f.v); if (d < bd) { bd = d; best = f; } }
  return best;
}

// A sticker ready for the math, or null (bad data / unknown image / no face).
export function prepareStamp(stamp, image, mask, { faces = boxFaces() } = {}) {
  if (!stamp || !image || !isVec(stamp.position, 3) || !isVec(stamp.quaternion, 4) || !isNum(stamp.size)) return null;
  const q = stamp.quaternion, n = qApply(q, [0, 0, 1]);
  const F = faceOf(faces, stamp, n);
  if (!F) return null;
  const [w, h] = stampDims(image, stamp.size); // no size cap (the full version may go past the room)
  const c = stamp.position.slice(); c[F.k] = F.v;
  const flat = (v) => { v = v.slice(); v[F.k] = 0; const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  return { id: stamp.id, order: stamp.order || 0, F, c, ex: flat(qApply(q, [1, 0, 0])), ey: flat(qApply(q, [0, 1, 0])), w, h, mask: mask || null, R: Math.hypot(w, h) / 2, imageId: stamp.imageId };
}

// A point in face F's plane (possibly past its edges) → the real surface point { face, X }.
function onSurface(faces, F, P) {
  let m = -1, em = 0;
  for (let a = 0; a < 3; a++) {
    if (a === F.k) continue;
    const e = P[a] > F.hi[a] ? P[a] - F.hi[a] : P[a] < F.lo[a] ? F.lo[a] - P[a] : 0;
    if (e > em) { em = e; m = a; }
  }
  if (m < 0) return { face: F, X: P };
  const G = faces.find((g) => g.k === m && g.v === (P[m] > F.hi[m] ? F.hi[m] : F.lo[m]));
  const X = P.slice();
  X[m] = G.v;
  X[F.k] = clamp(F.v + F.s * em, F.lo[F.k], F.hi[F.k]); // folded: as far from the edge as it reached past it
  for (let a = 0; a < 3; a++) if (a !== m && a !== F.k) X[a] = clamp(X[a], F.lo[a], F.hi[a]);
  return { face: G, X };
}

// Does sticker B cover the real surface point X on face G?
function covers(B, G, X) {
  let d;
  if (G === B.F) d = [X[0] - B.c[0], X[1] - B.c[1], X[2] - B.c[2]];
  else if (G.k !== B.F.k) { // a neighbour: unfold X into B's plane, across the shared edge
    const U = X.slice(), e = Math.abs(X[B.F.k] - B.F.v);
    U[B.F.k] = B.F.v; U[G.k] = G.v - G.s * e;
    d = [U[0] - B.c[0], U[1] - B.c[1], U[2] - B.c[2]];
  } else return false; // the opposite face
  const s = dot(d, B.ex) / B.w + 0.5, t = 0.5 - dot(d, B.ey) / B.h;
  return s >= 0 && s < 1 && t >= 0 && t < 1 && maskAt(B.mask, s, t);
}

// 0..1: how much of A's opaque area is covered by the stickers in `over` (all newer than A).
// stopBelow: stop early (and return a lower bound < stopBelow) once A can no longer reach it.
export function coveredFraction(A, over, { faces = boxFaces(), N = COVER_SAMPLES, stopBelow = 0 } = {}) {
  let total = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (maskAt(A.mask, (i + 0.5) / N, (j + 0.5) / N)) total++;
  if (!total) return 0;
  const near = over.filter((B) => B !== A && Math.hypot(B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]) < A.R + B.R + 1e-6);
  if (!near.length) return 0;
  const allowMiss = stopBelow > 0 ? Math.floor(total * (1 - stopBelow)) : Infinity;
  let covered = 0, missed = 0;
  for (let j = 0; j < N; j++) {
    const t = (j + 0.5) / N;
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) / N;
      if (!maskAt(A.mask, s, t)) continue;
      const a = (s - 0.5) * A.w, b = (0.5 - t) * A.h;
      const P = [A.c[0] + A.ex[0] * a + A.ey[0] * b, A.c[1] + A.ex[1] * a + A.ey[1] * b, A.c[2] + A.ex[2] * a + A.ey[2] * b];
      const { face, X } = onSurface(faces, A.F, P);
      let hit = false;
      for (const B of near) if (covers(B, face, X)) { hit = true; break; }
      if (hit) covered++; else if (++missed > allowMiss) return covered / total; // can't reach the threshold any more
    }
  }
  return covered / total;
}

// stamps: the room's stickers (any order); images: id -> { width, height }; masks: id -> mask|null.
// candidates: only check these ids (default: all). Stickers whose image is unknown are skipped
// (never removed, never count as covering). Returns [{ id, covered }] in the room's order, hidden only.
export function hiddenStamps(stamps, { images, masks = {}, candidates = null, threshold = HIDDEN_AT, N = COVER_SAMPLES, room = ROOM } = {}) {
  const faces = boxFaces(room);
  const get = (m, k) => (m instanceof Map ? m.get(k) : m[k]);
  const prep = [];
  for (const s of stamps) { const im = get(images, s.imageId); const p = im && prepareStamp(s, im, get(masks, s.imageId), { faces }); if (p) prep.push(p); }
  prep.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const want = candidates ? new Set(candidates) : null;
  const out = [];
  prep.forEach((A, i) => {
    if (want && !want.has(A.id)) return;
    const over = prep.slice(i + 1); // everything newer than A
    if (!over.length) return;
    const f = coveredFraction(A, over, { faces, N, stopBelow: threshold });
    if (f >= threshold) out.push({ id: A.id, covered: Math.round(f * 1000) / 1000 });
  });
  return out;
}
