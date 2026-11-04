// Props you can't walk through (Jens t521u, 4 Nov 2026): every prop is a few cheap boxes, never its mesh.
// Shared, dependency-free (no three.js): client/src/propsmode.js feeds it, client/src/controls.js asks it
// every frame, tests/propcollide.test.mjs checks it.
//   - a prop's LOCAL boxes ({ x0, x1, y0, y1, z0, z1 }, metres, the prop's own frame at its scale, y up
//     from its foot): client/src/props3d.js collisionBoxes() – the footprint of each part below body
//     height (a street light = its pole, a tree = its trunk, a bus stop = its posts, glass and bench),
//     the cuboid its own W × H × D.
//   - placed in the world: turned by the prop's yaw (three.js rotation.y) around its foot, raised by its y.
//   - the player is a circle (PLAYER_R) from the feet (eye − 1.6 m) to just over the head: a box only
//     blocks if it reaches above STEP over the feet and starts below the head.
//   - pushed out to the nearest side of each box (in the box's own frame, so turned props work).
//   - never stuck: a box the player already stood inside before this step (a prop placed on top of me,
//     spawning in one, standing up from a chair) is ignored until they have left it.
//   - a simple grid (CELL m) so 400 props cost a handful of tests per frame.
export const PLAYER_R = 0.3; // m
export const STEP = 0.3; // m: lower than this over the feet doesn't block (a rug, a low slab)
export const BODY_TOP = 1.5; // m over a prop's foot: parts higher than this don't count for its footprint
export const EYE = 1.6, HEAD = 0.1;
export const MIN_HALF = 0.04; // m: a flat part (a glass pane, a sign) still blocks as a thin wall
const CELL = 4;

// A prop's boxes in the world. local: boxes in the prop's frame (already at its scale).
export function worldBoxes(p, local) {
  const yaw = p.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), y = p.y || 0, out = [];
  for (const b of local || []) {
    const lx = (b.x0 + b.x1) / 2, lz = (b.z0 + b.z1) / 2;
    out.push({
      id: p.id, cx: p.x + lx * c + lz * s, cz: p.z - lx * s + lz * c, c, s,
      hx: Math.max(MIN_HALF, (b.x1 - b.x0) / 2), hz: Math.max(MIN_HALF, (b.z1 - b.z0) / 2), y0: y + b.y0, y1: y + b.y1,
    });
  }
  return out;
}
// The cuboid's one box (its own W × H × D, no scale).
export const cuboidBoxes = (p) => [{ x0: -p.sx / 2, x1: p.sx / 2, y0: 0, y1: p.sy, z0: -p.sz / 2, z1: p.sz / 2 }];

// (x, z) in box B's own frame: [u, v] along its width / depth.
const toLocal = (B, x, z) => { const dx = x - B.cx, dz = z - B.cz; return [dx * B.c - dz * B.s, dx * B.s + dz * B.c]; };
const toWorld = (B, u, v) => [B.cx + u * B.c + v * B.s, B.cz - u * B.s + v * B.c];
export function insideBox(B, x, z, r = PLAYER_R) {
  const [u, v] = toLocal(B, x, z);
  return Math.abs(u) < B.hx + r - 1e-4 && Math.abs(v) < B.hz + r - 1e-4;
}
// Out of B to its nearest side (the circle grows the box by r: corners are square, it is cheap and fine).
export function pushOutOf(B, x, z, r = PLAYER_R) {
  const [u, v] = toLocal(B, x, z), hx = B.hx + r, hz = B.hz + r;
  const ox = hx - Math.abs(u), oz = hz - Math.abs(v);
  if (ox <= 0 || oz <= 0) return [x, z];
  return ox < oz ? toWorld(B, Math.sign(u || 1) * hx, v) : toWorld(B, u, Math.sign(v || 1) * hz);
}
const blocksAt = (B, eyeY) => { const feet = eyeY - EYE; return B.y1 > feet + STEP && B.y0 < eyeY + HEAD; };

export function createPropCollider() {
  const byId = new Map(); // prop id -> world boxes
  const grid = new Map(); // "i,j" -> Set of boxes
  const ignored = new Set(); // boxes the player stood inside (ignored until they leave)
  const key = (i, j) => i + ',' + j;
  function cellsOf(B) {
    const r = Math.hypot(B.hx, B.hz) + PLAYER_R, out = [];
    for (let i = Math.floor((B.cx - r) / CELL); i <= Math.floor((B.cx + r) / CELL); i++)
      for (let j = Math.floor((B.cz - r) / CELL); j <= Math.floor((B.cz + r) / CELL); j++) out.push(key(i, j));
    return out;
  }
  function remove(id) {
    const bs = byId.get(id); if (!bs) return;
    for (const B of bs) { for (const k of cellsOf(B)) { const s = grid.get(k); if (s) { s.delete(B); if (!s.size) grid.delete(k); } } ignored.delete(B); }
    byId.delete(id);
  }
  function set(p, local) {
    remove(p.id);
    const bs = worldBoxes(p, local); byId.set(p.id, bs);
    for (const B of bs) for (const k of cellsOf(B)) { if (!grid.has(k)) grid.set(k, new Set()); grid.get(k).add(B); }
  }
  const near = (x, z) => grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || null;
  // One step from (px, pz) to (x, z) with the eye at eyeY: where the player may be. skip: a prop id to
  // leave out (the chair I sit on).
  // clamp(x, z) → [x, z]: the space's own limits (the room's walls, the city's houses), applied after
  // each push; a push that only ends up back inside a prop (a prop against a wall) = stay where I was.
  function move(px, pz, x, z, eyeY, skip = null, clamp = null) {
    for (const B of [...ignored]) if (!insideBox(B, px, pz)) ignored.delete(B);
    const prev = near(px, pz);
    if (prev) for (const B of prev) if (!ignored.has(B) && insideBox(B, px, pz)) ignored.add(B); // already inside: let me walk out
    for (let pass = 0; pass < 3; pass++) {
      const here = near(x, z); if (!here) break;
      let moved = false;
      for (const B of here) {
        if (ignored.has(B) || B.id === skip || !blocksAt(B, eyeY) || !insideBox(B, x, z)) continue;
        [x, z] = pushOutOf(B, x, z); moved = true;
      }
      if (!moved) break;
      if (clamp) [x, z] = clamp(x, z);
    }
    const end = near(x, z);
    if (end) for (const B of end) if (!ignored.has(B) && B.id !== skip && blocksAt(B, eyeY) && insideBox(B, x, z)) return [px, pz];
    return [x, z];
  }
  // Would (x, z) be inside some prop (tests, the e2e)?
  function blocked(x, z, eyeY = EYE) { const h = near(x, z); if (h) for (const B of h) if (blocksAt(B, eyeY) && insideBox(B, x, z)) return B.id; return null; }
  return { set, remove, move, blocked, clear: () => { byId.clear(); grid.clear(); ignored.clear(); }, boxes: (id) => byId.get(id) || [], size: () => byId.size };
}
