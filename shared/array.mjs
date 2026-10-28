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
// (the anchor included), at most ARRAY_MAX.
//
// Round corners (Jens, 28 Oct 2026): the row does not stop at the edge of the anchor's face. Like a
// strip of tape it folds over the seam onto the next face (wall → wall at a corner, wall → floor or
// ceiling, and on), keeps going the same way, and the spacing is measured along the surface (the
// unfolded distance). A copy on the next face is the anchor turned over the seam (a 90° fold about
// the edge), so it lies on that face exactly as a sticker folded over that edge would; copies that
// straddle a seam fold like any sticker. B can be on the next face: it is unfolded into the anchor's
// plane first. The row ends where it would run into a corner where three faces meet (or after
// MAX_FOLDS seams). Each item on another face than the anchor's carries its own quaternion, normal
// and surface; the server recomputes exactly the same (this file).
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

const MAX_FOLDS = 4;
const ON_FACE = 0.05; // m: how close to a face B counts as on it
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const inward = (f) => { const n = [0, 0, 0]; n[f.k] = f.s; return n; };
// The face B lies on (within ON_FACE of its plane and inside it), or null.
function faceAt(faces, p) {
  let best = null, bd = ON_FACE;
  for (const f of faces) {
    const d = Math.abs(p[f.k] - f.v); if (d >= bd) continue;
    let inside = true; for (let j = 0; j < 3; j++) if (j !== f.k && (p[j] < f.lo[j] - ON_FACE || p[j] > f.hi[j] + ON_FACE)) inside = false;
    if (inside) { best = f; bd = d; }
  }
  return best;
}
// B on a face next to the anchor's (sharing an edge): unfold it into the anchor's plane, as if the
// next face were swung out flat about the seam. Anywhere else: B as it is (only its part along the face counts).
export function unfoldTo(faces, F, to) {
  const G = faceAt(faces, to);
  if (!G || G === F || G.k === F.k) return to.slice();
  const out = to.slice(), dist = Math.abs(to[F.k] - F.v);
  out[F.k] = F.v; out[G.k] = G.v - G.s * dist; // past G's plane, outward
  return out;
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
  const T = unfoldTo(faces, F, to);
  const d = [T[0] - A[0], T[1] - A[1], T[2] - A[2]]; d[F.k] = 0; // along the face only
  const len = Math.hypot(d[0], d[1], d[2]);
  const one = { step: 0, dir: [0, 0, 0], count: 1, items: [{ i: 0, position: A.slice() }] };
  if (len < 1e-6) return one;
  const dir = d.map((x) => x / len);
  const u = qApply(q, [1, 0, 0]), v = qApply(q, [0, 1, 0]);
  const step = arrayStep(dot(dir, u), dot(dir, v), w, h);
  if (!(step > 1e-6)) return one;
  const count = Math.min(Math.max(1, max | 0), Math.floor(len / step + 1e-9) + 1);
  // The path: straight on the anchor's face to its edge, then folded over the seam onto the next face, …
  const segs = [];
  let P = A.slice(), dc = dir.slice(), face = F, qq = q.slice(), from = 0;
  for (let fold = 0; fold <= MAX_FOLDS; fold++) {
    let t = Infinity, jx = -1, tie = false;
    for (let j = 0; j < 3; j++) {
      if (j === face.k || Math.abs(dc[j]) < 1e-9) continue;
      const tj = Math.max(0, ((dc[j] > 0 ? face.hi[j] : face.lo[j]) - P[j]) / dc[j]);
      if (tj < t - 1e-9) { t = tj; jx = j; tie = false; } else if (Math.abs(tj - t) <= 1e-9) tie = true;
    }
    segs.push({ face, P, dir: dc, q: qq, from, to: from + t, first: fold === 0 });
    if (!Number.isFinite(t) || tie || fold === MAX_FOLDS) break; // straight into a corner of three faces: the row ends there
    const bound = dc[jx] > 0 ? face.hi[jx] : face.lo[jx];
    const next = faces.find((f) => f.k === jx && Math.abs(f.v - bound) < 1e-9);
    if (!next) break;
    const n0 = inward(face), n1 = inward(next), ax = cross(n0, n1), sn = Math.SQRT1_2;
    const P2 = P.map((x, j) => x + dc[j] * t); P2[jx] = next.v;
    const d2 = dc.slice(); d2[face.k] = face.s * Math.abs(dc[jx]); d2[jx] = 0;
    qq = qMul([ax[0] * sn, ax[1] * sn, ax[2] * sn, sn], qq);
    from += t; P = P2; dc = d2; face = next;
  }
  const items = [];
  const end = segs[segs.length - 1].to;
  for (let i = 0; i < count; i++) {
    const dist = step * i;
    if (dist > end + 1e-6) break; // ran into a corner of three faces: the rest is not placed
    const sg = segs.find((x) => dist <= x.to + 1e-9) || segs[segs.length - 1];
    const o = dist - sg.from;
    const p = sg.P.map((a, j) => (j === sg.face.k ? (sg.first ? a : sg.face.v) : r6(a + sg.dir[j] * o)));
    if (sg.first) items.push({ i, position: p });
    else items.push({ i, position: p, quaternion: sg.q.map(r6), normal: inward(sg.face), surface: sg.face.name });
  }
  return { step, dir, count, items };
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
