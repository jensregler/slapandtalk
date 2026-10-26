// The automatic cameraman: a camera nobody has to place. A simulated cameraman walks the room
// along a preset track (like a dolly), at a real cameraman's pace, with a little handheld sway,
// and zooms gently toward what is interesting (for now: wall areas with recent stickers, otherwise
// the room). Pure JavaScript (no Three.js, no browser) and deterministic: the same recording and
// the same seed always give the same take, and any moment can be computed directly (seeking).
// Used by the replay (client/src/replay.js: the views "Auto cameraman: …", the director's room
// shot), the live room (client/src/main.js: the 🎥 Auto cameraman toggle), the server's shot list
// (shared/director.mjs shotList → server/recorder.js) and the tests (tests/autocam.test.mjs).
//
//   const cam = createAutoCam({ path: 'perimeter', seed: recId, provider: stickerTargets(tl) })
//   cam.poseAt(t)  // { p, yaw, pitch, fov, mm, speed, leg, target } for poseCamera() (cameras.js)
//   const crew = createAutoCrew([{ key, path, seed, start }, …], { provider })  // several at once
//   crew.get(key).poseAt(t)   // each one as above; they never come closer than crewGapM
//
// Several cameramen (a crew): each has its own seed, track and start, and its own cell of the
// room to walk in (see crewCells), so they can't collide – by construction, not by luck.
//
// A start point (the paid "＋ Add cameraman" click): path 'seeded' (automatic) + start → 'loop', a
// perimeter-style rectangle loop through the start (same distance from the walls as the click),
// starting exactly there; a preset + start → that preset's track, starting at its point nearest
// the click. Without a start, 'seeded' picks one of the presets (the free version's one cameraman).
//
// Times are ms from the start of the take (the recording start in a replay).
// ---------- Step 2 hook: the target provider ----------
// Where the cameraman looks (and how far it zooms) comes ONLY from a target provider:
//   provider = { name, targetsAt(t, ctx) → [{ id, kind, p: [x, y, z], size, weight, at }] }
//     t     the beat time (ms); ctx = { pos: [x, y, z] (the camera then), look: [x, y, z] (the
//           track's own default aim then), path, bounds }
//     id    stable id (ties are broken by it, so the take stays deterministic)
//     kind  'sticker' today; step 2 adds e.g. 'speaker', 'slap', 'movement', 'group'
//     p     the point to frame; size = how big the area is (m, sets the zoom); weight 0…1
// The engine keeps the targets in front of the camera (≤ maxAngleDeg from the track's own aim,
// ≥ minTargetM away) and frames the heaviest one; nothing qualifies → the track's own aim.
// Step 1 ships stickerTargets(tl) (replay, shot list) and liveStickerTargets(fn) (the live room).
// Step 2 (the smarter cameraman that follows the room's activity with accumulated knowledge) is
// a new provider – speakers from director.speechSegments, slaps, people walking, with memory of
// where things tend to happen – and may also return { path } hints in ctx-free form later; the
// engine, the views, the recording and the shot list stay as they are.
import ROOM from './room.json' with { type: 'json' };
import { hash01 } from './director.mjs';

export const AUTOCAM = {
  walk: [0.5, 1.0],      // m/s cruising between framing points (a real cameraman's walk)
  frame: [0.18, 0.32],   // m/s creeping while framing (push-ins, the slow middle of a sweep)
  accel: 0.45,           // m/s² peak (smooth S-curve ramps: ease in and out, a stop at every waypoint)
  hold: [1400, 3000],    // ms standing still at a corner / end of a push-in
  settle: [400, 800],    // ms settling before a slow framing leg
  eye: [1.5, 1.7],       // m eye/shoulder height (one per take)
  inset: 1.1,            // m the track keeps from the walls
  wallGap: 0.6,          // m the camera never comes closer to a wall than this (sway included)
  mm: [35, 70],          // focal length, full-frame equivalent
  sensorMm: 24,          // full-frame sensor height (vertical fov = 2·atan(12 / mm))
  idleMm: [35, 43],      // the slow breathing when nothing in particular is going on
  maxMmStep: 10,         // mm the zoom may change per beat (≈ ≤ 4 mm/s)
  beatMs: 4000,          // the cameraman decides where to look/zoom once per beat
  panMs: 2600,           // a pan to a new aim takes this long (smoothstep)
  recentMs: 30000,       // a sticker is "news" this long after it was slapped
  clusterM: 1.2,         // stickers this close together are framed as one area
  minTargetM: 1.0,
  maxAngleDeg: 60,
  sway: { pos: 0.012, bob: 0.006, yaw: 0.0045, pitch: 0.0035 }, // handheld (m, rad)
  crewGapM: 1.2,         // m two cameramen's tracks are at least this far apart (own cells; sway ≤ 3 cm)
  minLoopHalfM: 0.9,     // a derived loop is at least 1.8 m across
};
export const MAX_AUTO_CAMS = 6; // per room (server/app.js has the same number); free version: 1
export const AUTO_PATHS = ['perimeter', 'diagonal', 'pushin'];
export const AUTO_CHOICES = [...AUTO_PATHS, 'seeded']; // 'seeded' = one of the paths, picked by the seed
export const autoView = (path) => `auto:${path}`;
export const mmToFov = (mm) => +((2 * Math.atan(12 / mm) * 180) / Math.PI).toFixed(3);
export const fovToMm = (fov) => 12 / Math.tan((fov * Math.PI) / 360);
export const isStart = (s) => Array.isArray(s) && s.length === 2 && s.every((n) => typeof n === 'number' && Number.isFinite(n));
export function resolvePath(path, seed = '', start = null) {
  if (AUTO_PATHS.includes(path)) return path;
  if (isStart(start)) return 'loop';
  return AUTO_PATHS[Math.min(2, Math.floor(hash01('autocam-path', seed) * 3))];
}
// The walls (not the walkable area): the room box from shared/room.json, centred on 0.
export function roomBounds(room = ROOM) {
  const hw = room.width / 2, hd = room.depth / 2;
  return { minX: -hw, maxX: hw, minZ: -hd, maxZ: hd, height: room.height };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const range = (r, u) => r[0] + (r[1] - r[0]) * u;
const r4 = (n) => Math.round(n * 1e4) / 1e4;
function aim(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), dist: Math.hypot(dx, dy, dz) };
}

// ---------- The tracks (from the room box) ----------
// A track = a loop of waypoints; each leg says how fast (walk/frame) and where the camera aims
// meanwhile (a point on a wall or in the room). The seed picks the start corner, the direction
// and (push-in) the wall.
export function trackOf(path, b = roomBounds(), seed = '', start = null, box = null) {
  const legs = baseTrack(path, b, seed, start, box);
  return isStart(start) ? startAt(legs, start) : legs;
}
// Start the loop at its point nearest q: split that leg there (tiny pieces snap to the waypoint).
function startAt(legs, q) {
  let best = null;
  legs.forEach((l, i) => {
    const dx = l.b[0] - l.a[0], dz = l.b[1] - l.a[1], L2 = dx * dx + dz * dz || 1;
    const k = clamp(((q[0] - l.a[0]) * dx + (q[1] - l.a[1]) * dz) / L2, 0, 1), p = [l.a[0] + dx * k, l.a[1] + dz * k];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.d - 1e-9) best = { i, k, p, d, len: Math.sqrt(L2) };
  });
  const { i, k, p, len } = best;
  if (k * len < 0.4) return [...legs.slice(i), ...legs.slice(0, i)];
  if ((1 - k) * len < 0.4) return [...legs.slice(i + 1), ...legs.slice(0, i + 1)];
  const L = legs[i];
  return [{ ...L, a: p }, ...legs.slice(i + 1), ...legs.slice(0, i), { ...L, b: p }];
}
function baseTrack(path, b, seed, start, box) {
  // box = the rectangle the track stays inside (the room minus the inset, or a crew member's own cell)
  const I = AUTOCAM.inset;
  const K = box || { minX: b.minX + I, maxX: b.maxX - I, minZ: b.minZ + I, maxZ: b.maxZ - I };
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, kx = (K.minX + K.maxX) / 2, kz = (K.minZ + K.maxZ) / 2;
  const hx = (K.maxX - K.minX) / 2, hz = (K.maxZ - K.minZ) / 2;
  const h = (k) => hash01(seed, path, k);
  const mid = [cx, 1.3, cz];
  const legs = []; // { a: [x, z], b: [x, z], kind: 'walk'|'frame', look: [x, y, z] }
  const leg = (a, bb, kind, look) => legs.push({ a, b: bb, kind, look });
  // From a side of a rectangle: aim across the room at the wall facing that side (its middle).
  const across = (a, e, rx, rz) => {
    const m = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
    return Math.abs(a[1] - e[1]) < 1e-9 ? [m[0] * 0.3 + cx * 0.7, 1.4, m[1] > rz ? b.minZ + 0.05 : b.maxZ - 0.05] : [m[0] > rx ? b.minX + 0.05 : b.maxX - 0.05, 1.4, m[1] * 0.3 + cz * 0.7];
  };
  const rect = (LX, LZ, dirKey, startKey) => {
    let C = [[kx - LX, kz + LZ], [kx + LX, kz + LZ], [kx + LX, kz - LZ], [kx - LX, kz - LZ]];
    if (startKey) { const s = Math.floor(h(startKey) * 4); C = [...C.slice(s), ...C.slice(0, s)]; }
    if (h(dirKey) < 0.5) C = [C[0], ...C.slice(1).reverse()];
    for (let i = 0; i < 4; i++) {
      const a = C[i], e = C[(i + 1) % 4], p1 = [lerp(a[0], e[0], 1 / 3), lerp(a[1], e[1], 1 / 3)], p2 = [lerp(a[0], e[0], 2 / 3), lerp(a[1], e[1], 2 / 3)];
      const look = across(a, e, kx, kz);
      leg(a, p1, 'walk', look); leg(p1, p2, 'frame', look); leg(p2, e, 'walk', look);
    }
  };
  if (path === 'perimeter') {
    // Around the box, a third of each side slowly, aiming across the room at the facing wall.
    rect(hx, hz, 'dir', 'start');
  } else if (path === 'diagonal') {
    // Corner to corner through the middle (slow in the middle third), along a side, the other diagonal back.
    let C = [[K.minX, K.minZ], [K.maxX, K.maxZ], [K.maxX, K.minZ], [K.minX, K.maxZ]];
    if (h('start') < 0.5) C = [C[2], C[3], C[1], C[0]];
    // aim: the middle of one of the two walls ahead (seeded per diagonal), seen at an angle – the whole wall sweeps by
    const ahead = (e, k) => (h(`wall${k}`) < 0.5 ? [e[0] > kx ? b.maxX - 0.05 : b.minX + 0.05, 1.4, cz] : [cx, 1.4, e[1] > kz ? b.maxZ - 0.05 : b.minZ + 0.05]);
    let nd = 0;
    const diag = (a, e) => {
      const p1 = [lerp(a[0], e[0], 0.35), lerp(a[1], e[1], 0.35)], p2 = [lerp(a[0], e[0], 0.65), lerp(a[1], e[1], 0.65)], look = ahead(e, nd++);
      leg(a, p1, 'walk', look); leg(p1, p2, 'frame', look); leg(p2, e, 'walk', look);
    };
    diag(C[0], C[1]); leg(C[1], C[2], 'walk', mid); diag(C[2], C[3]); leg(C[3], C[0], 'walk', mid);
  } else if (path === 'pushin') {
    // A slow push-in toward one wall (seeded, one the box touches), hold, pull back to a new spot; three spots along it.
    const touch = (d) => d <= I + 1e-6;
    let walls = [
      { w: [kx, b.minZ], n: [0, 1], u: [1, 0], half: hx, depth: K.maxZ - b.minZ, on: touch(K.minZ - b.minZ) }, { w: [kx, b.maxZ], n: [0, -1], u: [-1, 0], half: hx, depth: b.maxZ - K.minZ, on: touch(b.maxZ - K.maxZ) },
      { w: [b.minX, kz], n: [1, 0], u: [0, -1], half: hz, depth: K.maxX - b.minX, on: touch(K.minX - b.minX) }, { w: [b.maxX, kz], n: [-1, 0], u: [0, 1], half: hz, depth: b.maxX - K.minX, on: touch(b.maxX - K.maxX) },
    ];
    if (walls.some((w) => w.on)) walls = walls.filter((w) => w.on);
    const W = walls[Math.min(walls.length - 1, Math.floor(h('wall') * walls.length))];
    const near = Math.max(I + 0.5, Math.min(1.6, W.depth - 0.8)), far = Math.max(near + 0.6, Math.min(4.4, W.depth - 0.05));
    let offs = [0, -0.4, 0.4]; if (h('offs') < 0.5) offs = [0, 0.4, -0.4];
    const at = (o, d) => [W.w[0] + W.n[0] * d + W.u[0] * o * W.half, W.w[1] + W.n[1] * d + W.u[1] * o * W.half];
    for (let i = 0; i < offs.length; i++) {
      const o = offs[i], o2 = offs[(i + 1) % offs.length];
      const look = [W.w[0] + W.u[0] * o * W.half * 0.9 + W.n[0] * 0.02, 1.5, W.w[1] + W.u[1] * o * W.half * 0.9 + W.n[1] * 0.02];
      leg(at(o, far), at(o * 0.85, near), 'frame', look);
      leg(at(o * 0.85, near), at(o2, far), 'walk', look);
    }
  } else if (path === 'loop') {
    // Through the start: a rectangle inside the box at the start's distance from the box's edge
    // (so a click near a wall walks close to the walls, a click in the middle makes a small inner
    // loop, at least minLoopHalfM from its middle when the box allows), thirds as in the perimeter.
    const q = isStart(start) ? start : [kx, kz];
    const lane = clamp(Math.min(q[0] - K.minX, K.maxX - q[0], q[1] - K.minZ, K.maxZ - q[1]), 0, Math.max(0, Math.min(hx, hz) - AUTOCAM.minLoopHalfM));
    rect(hx - lane, hz - lane, 'dir', null);
  } else throw new Error(`unknown auto camera path: ${path}`);
  return legs;
}

// ---------- Motion along one leg: stop → S-curve up to cruise → cruise → S-curve down → stop ----------
// A smoothstep speed ramp of length tr reaches v with peak acceleration 1.5 v / tr and covers v·tr/2.
export function legProfile(d, vMax, A = AUTOCAM.accel) {
  let v = vMax, tr = (1.5 * v) / A;
  if (v * tr > d) { v = Math.sqrt((d * A) / 1.5); tr = (1.5 * v) / A; } // too short to reach cruise
  const cruise = Math.max(0, (d - v * tr) / v);
  return { d, v, tr, cruise, T: 2 * tr + cruise };
}
function legDist(P, tau) { // distance covered after tau seconds
  const { v, tr, cruise, d, T } = P;
  if (tau <= 0) return 0;
  if (tau >= T) return d;
  const ramp = (u) => v * tr * (u * u * u - (u * u * u * u) / 2);
  if (tau < tr) return ramp(tau / tr);
  if (tau < tr + cruise) return (v * tr) / 2 + v * (tau - tr);
  return d - ramp((T - tau) / tr);
}

// ---------- Targets: stickers ----------
// Stickers slapped during the recording (not the ones already there at the start), "news" for
// recentMs; neighbours within clusterM are framed together as one wall area.
function clusterTargets(list, t, P) {
  const out = [];
  for (const s of list) {
    const n = s.normal || [0, 0, 0];
    if (Math.abs(n[1]) > 0.7) continue; // floor/ceiling: not a wall area
    const near = list.filter((o) => Math.hypot(o.p[0] - s.p[0], o.p[1] - s.p[1], o.p[2] - s.p[2]) <= P.clusterM && Math.abs((o.normal || [0, 1, 0])[1]) <= 0.7);
    const c = [0, 1, 2].map((i) => near.reduce((a, o) => a + o.p[i], 0) / near.length);
    let ext = 0; for (const o of near) ext = Math.max(ext, Math.hypot(o.p[0] - c[0], o.p[1] - c[1], o.p[2] - c[2]) * 2 + (o.size || 0.3));
    const fresh = near.reduce((a, o) => Math.max(a, 1 - (t - o.at) / P.recentMs), 0);
    out.push({ id: `sticker:${s.id}`, kind: 'sticker', p: c, size: Math.max(ext, s.size || 0.3), weight: clamp(fresh * (0.8 + 0.2 * Math.min(1, near.length / 3)), 0, 1), at: s.at, n: near.length });
  }
  return out;
}
export function stickerTargets(tl, o = {}) {
  const P = { ...AUTOCAM, ...o };
  const added = [...tl.stamps.values()].filter((s) => s.from > 0 && s.stamp && Array.isArray(s.stamp.position))
    .map((s) => ({ id: s.stamp.id, p: s.stamp.position, normal: s.stamp.normal, size: s.stamp.size, at: s.from, to: s.to }))
    .sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)));
  return {
    name: 'stickers',
    targetsAt(t) { return clusterTargets(added.filter((s) => s.at <= t && t < s.to && t - s.at < P.recentMs), t, P); },
  };
}
// The live room: list() → [{ id, position, normal, size, createdAt (ISO) }]; t0 = the take's start (ms epoch).
export function liveStickerTargets(list, t0, o = {}) {
  const P = { ...AUTOCAM, ...o };
  return {
    name: 'stickers',
    targetsAt(t) {
      const now = t0 + t;
      const rec = (list() || []).map((s) => ({ id: s.id, p: s.position, normal: s.normal, size: s.size, at: Date.parse(s.createdAt) - t0 }))
        .filter((s) => Array.isArray(s.p) && Number.isFinite(s.at) && s.at <= t && now - (t0 + s.at) < P.recentMs);
      return clusterTargets(rec, t, P);
    },
  };
}
export const noTargets = { name: 'none', targetsAt: () => [] };

// ---------- The cameramen ----------
// Several at once never collide by construction: the room is split into one cell per cameraman
// (1 → the whole room, 2 → halves, 3 → thirds, 4 → 2×2, 5–6 → 3×2, along the longer side first),
// and each one's track stays inside its own cell – crewGapM/2 from the inner cell edges and the
// usual inset from the walls – so two tracks are always ≥ crewGapM apart (the sway is ≤ 3 cm).
// They still film the whole room: only where they walk is shared out, not where they look.
// A cameraman with a start gets the cell its start is in (or the nearest free one); the others
// take the remaining cells in order. The start is clamped into its cell.
export function crewCells(n, b = roomBounds()) {
  const I = AUTOCAM.inset, g = AUTOCAM.crewGapM / 2;
  const wide = b.maxX - b.minX >= b.maxZ - b.minZ;
  const [a, c] = n <= 1 ? [1, 1] : n === 2 ? [2, 1] : n === 3 ? [3, 1] : n === 4 ? [2, 2] : [3, 2];
  const [nx, nz] = wide ? [a, c] : [c, a];
  const cells = [];
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x0 = lerp(b.minX, b.maxX, ix / nx), x1 = lerp(b.minX, b.maxX, (ix + 1) / nx), z0 = lerp(b.minZ, b.maxZ, iz / nz), z1 = lerp(b.minZ, b.maxZ, (iz + 1) / nz);
    cells.push({ area: { minX: x0, maxX: x1, minZ: z0, maxZ: z1 }, box: { minX: x0 + (ix === 0 ? I : g), maxX: x1 - (ix === nx - 1 ? I : g), minZ: z0 + (iz === 0 ? I : g), maxZ: z1 - (iz === nz - 1 ? I : g) } });
  }
  return cells;
}
function assignCells(specs, b) {
  // members with the same group (one camera's versions over a recording: a path change) share a cell
  const gk = (sp, i) => String(sp.group ?? `#${i}`), groups = [...new Set(specs.map(gk))];
  const cells = crewCells(Math.min(groups.length, MAX_AUTO_CAMS), b), cellOf = new Map(), free = new Set(cells.map((_, i) => i));
  const centre = (c) => [(c.area.minX + c.area.maxX) / 2, (c.area.minZ + c.area.maxZ) / 2];
  const inside = (c, q) => q[0] >= c.area.minX && q[0] <= c.area.maxX && q[1] >= c.area.minZ && q[1] <= c.area.maxZ;
  const startOf = (g) => { const sp = specs.find((x, i) => gk(x, i) === g && isStart(x.start)); return sp ? sp.start : null; };
  for (const g of groups) {
    const st = startOf(g); if (!st || !free.size) continue;
    let pick = [...free].find((k) => inside(cells[k], st));
    if (pick === undefined) pick = [...free].sort((x, y) => Math.hypot(...centre(cells[x]).map((v, d) => v - st[d])) - Math.hypot(...centre(cells[y]).map((v, d) => v - st[d])) || x - y)[0];
    cellOf.set(g, cells[pick]); free.delete(pick);
  }
  groups.forEach((g, i) => { if (cellOf.has(g)) return; const k = [...free][0]; cellOf.set(g, k === undefined ? cells[i % cells.length] : cells[k]); free.delete(k); });
  return { cells, out: specs.map((sp, i) => cellOf.get(gk(sp, i))), single: groups.length <= 1 };
}
function makeMember(spec, idx, bounds, P, cell, single) {
  const seed = String(spec.seed ?? spec.key ?? idx);
  const box = single ? null : cell.box;
  const start = isStart(spec.start) ? (box ? [clamp(spec.start[0], box.minX, box.maxX), clamp(spec.start[1], box.minZ, box.maxZ)] : spec.start) : null;
  const name = resolvePath(spec.path || 'seeded', seed, start);
  const loop = trackOf(name, bounds, seed, start, box);
  return { idx, key: spec.key ?? String(idx), seed, start, path: name, requested: spec.path || 'seeded', loop, box, legs: [], beats: [], eye: range(P.eye, hash01(seed, name, 'eye')),
    sw: [0, 1, 2, 3, 4, 5].map((i) => hash01(seed, name, 'sway', i) * Math.PI * 2) };
}

export function createAutoCrew(specs, { bounds = roomBounds(), provider = noTargets, ...o } = {}) {
  const P = { ...AUTOCAM, ...o, sway: { ...AUTOCAM.sway, ...(o.sway || {}) } };
  const lim = { minX: bounds.minX + P.wallGap, maxX: bounds.maxX - P.wallGap, minZ: bounds.minZ + P.wallGap, maxZ: bounds.maxZ - P.wallGap };
  const { out, single } = assignCells(specs, bounds);
  const members = specs.map((sp, i) => makeMember(sp, i, bounds, P, out[i], single));
  function extend(m, t) {
    while (!m.legs.length || m.legs[m.legs.length - 1].t2 <= t) {
      const i = m.legs.length, L = m.loop[i % m.loop.length], prev = m.legs[i - 1];
      const vMax = range(L.kind === 'frame' ? P.frame : P.walk, hash01(m.seed, m.path, 'leg', i));
      const holdMs = L.kind === 'frame' ? range(P.settle, hash01(m.seed, m.path, 'hold', i)) : prev && prev.kind === 'frame' ? 0 : range(P.hold, hash01(m.seed, m.path, 'hold', i));
      const prof = legProfile(Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]), vMax, P.accel);
      const t0 = prev ? prev.t2 : 0, t1 = t0 + holdMs;
      m.legs.push({ i, kind: L.kind, a: L.a, b: L.b, look: L.look, vMax: r4(vMax), prof, t0, t1, t2: t1 + prof.T * 1000 });
      if (m.legs.length > 200000) break;
    }
  }
  function legAt(m, t) {
    extend(m, t);
    let lo = 0, hi = m.legs.length - 1;
    while (lo < hi) { const x = (lo + hi) >> 1; if (m.legs[x].t2 <= t) lo = x + 1; else hi = x; }
    return m.legs[lo];
  }
  function base(m, t) {
    t = Math.max(0, t);
    const L = legAt(m, t), tau = (t - L.t1) / 1000, s = legDist(L.prof, tau), k = L.prof.d > 0 ? s / L.prof.d : 1;
    const ds = legDist(L.prof, tau + 0.01) - legDist(L.prof, tau - 0.01);
    return { L, p: [lerp(L.a[0], L.b[0], k), m.eye, lerp(L.a[1], L.b[1], k)], speed: tau > 0 && tau < L.prof.T ? ds / 0.02 : 0 };
  }
  // Beats: aim and focal length every beatMs, in order (≤ maxMmStep from one beat to the next).
  function beat(m, k) {
    while (m.beats.length <= k) {
      const j = m.beats.length, tb = j * P.beatMs, B = base(m, tb), look = B.L.look;
      const def = aim(B.p, look);
      let best = null;
      for (const c of provider.targetsAt(tb, { pos: B.p, look, path: m.path, bounds, key: m.key }) || []) {
        if (!(c && Array.isArray(c.p) && c.weight > 0)) continue;
        const a = aim(B.p, c.p);
        if (a.dist < P.minTargetM || Math.abs(wrap(a.yaw - def.yaw)) > (P.maxAngleDeg * Math.PI) / 180) continue;
        if (!best || c.weight > best.weight + 1e-9 || (Math.abs(c.weight - best.weight) <= 1e-9 && String(c.id) < String(best.id))) best = { ...c, dist: a.dist };
      }
      let want;
      if (best) want = clamp((P.sensorMm * best.dist) / Math.max(0.6, (best.size || 0.5) * 2.2 + 0.6), P.mm[0] + 7, P.mm[1]);
      else want = range(P.idleMm, 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (4 + Math.floor(hash01(m.seed, m.path, 'breath') * 3))));
      const prevMm = j ? m.beats[j - 1].mm : range(P.idleMm, 0);
      const mm = +clamp(clamp(want, prevMm - P.maxMmStep, prevMm + P.maxMmStep), P.mm[0], P.mm[1]).toFixed(2);
      m.beats.push({ t: tb, target: best ? { id: best.id, kind: best.kind, p: best.p.map(r4) } : { id: null, kind: 'track', p: look.map(r4) }, mm });
      if (m.beats.length > 200000) break;
    }
    return m.beats[k];
  }
  function poseAt(m, t) {
    t = Math.max(0, t);
    const B = base(m, t), k = Math.floor(t / P.beatMs), b0 = beat(m, k), b1 = beat(m, k + 1);
    const u = (t - b0.t) / P.beatMs, pan = smooth((t - b0.t) / P.panMs);
    const ts = t / 1000, S = P.sway, sw = m.sw, step = Math.min(1, B.speed / P.walk[1]);
    const p = [
      clamp(B.p[0] + S.pos * (0.6 * Math.sin(ts * 1.7 + sw[0]) + 0.4 * Math.sin(ts * 3.3 + sw[1])), lim.minX, lim.maxX),
      clamp(B.p[1] + S.pos * 0.6 * Math.sin(ts * 1.3 + sw[2]) + S.bob * step * Math.sin(ts * 2 * Math.PI * 1.8), 0.3, bounds.height - 0.2),
      clamp(B.p[2] + S.pos * (0.6 * Math.sin(ts * 1.5 + sw[3]) + 0.4 * Math.sin(ts * 2.9 + sw[4])), lim.minZ, lim.maxZ),
    ];
    const a0 = aim(p, b0.target.p), a1 = aim(p, b1.target.p);
    const yaw = wrap(a0.yaw + wrap(a1.yaw - a0.yaw) * pan + S.yaw * (0.7 * Math.sin(ts * 0.9 + sw[5]) + 0.3 * Math.sin(ts * 2.3)));
    const pitch = lerp(a0.pitch, a1.pitch, pan) + S.pitch * (0.6 * Math.sin(ts * 1.1 + sw[1]) + 0.4 * Math.sin(ts * 2.7 + sw[3]));
    const mm = lerp(b0.mm, b1.mm, smooth(u));
    const target = pan < 0.5 ? b0.target : b1.target;
    return { p: p.map(r4), yaw: r4(yaw), pitch: r4(pitch), fov: mmToFov(mm), mm: +mm.toFixed(2), speed: +B.speed.toFixed(3), leg: B.L.kind === 'frame' && t >= B.L.t1 ? 'frame' : t < B.L.t1 ? 'hold' : 'walk', target };
  }
  const api = members.map((m) => ({
    key: m.key, path: m.path, requested: m.requested, seed: m.seed, start: m.start, eye: r4(m.eye), params: P, provider: provider.name || 'custom',
    poseAt: (t) => poseAt(m, t), base: (t) => base(m, t),
    box: m.box ? Object.fromEntries(Object.entries(m.box).map(([k, v]) => [k, r4(v)])) : null,
    legsUntil(duration) { extend(m, duration); return m.legs.filter((L) => L.t0 < duration).map((L) => ({ from: Math.round(L.t0), moveFrom: Math.round(L.t1), to: Math.round(L.t2), kind: L.kind, a: L.a.map(r4), b: L.b.map(r4), vMax: L.vMax })); },
    beatsUntil(duration) { const n = Math.floor(duration / P.beatMs); for (let k = 0; k <= n; k++) beat(m, k); return m.beats.slice(0, n + 1).map((b) => ({ ...b })); },
    track(duration, stepMs = 1000) { const out = []; for (let t = 0; t <= duration; t += stepMs) { const q = poseAt(m, t); out.push([Math.round(t), ...q.p, q.yaw, q.pitch, q.mm]); } return out; },
  }));
  const byKey = new Map(api.map((a) => [a.key, a]));
  return { members: api, get: (key) => byKey.get(key) || null, size: api.length };
}
// One cameraman alone (the generic takes 'auto:<path>').
export function createAutoCam({ path = 'seeded', seed = '', start = null, ...o } = {}) {
  return createAutoCrew([{ key: 'solo', path, seed, start }], o).members[0];
}

// The take descriptions that go into the shot list: one per generic path (not the room's own).
export function autoCamTakes(tl, { seed = tl.header?.id || '', room = null, paths = AUTO_PATHS, stepMs = null, labels = null } = {}) {
  const duration = Math.max(0, tl.duration || 0);
  const step = stepMs || trackStep(duration);
  const provider = stickerTargets(tl);
  return paths.map((p) => {
    const c = createAutoCam({ path: p, seed: `${seed}:${p}`, provider, ...(room ? { bounds: roomBounds(room) } : {}) });
    return { view: autoView(p), path: p, label: labels ? labels(p) : `Auto cameraman: ${p}`, seed: `${seed}:${p}`, eyeM: c.eye, provider: c.provider,
      legs: c.legsUntil(duration), beats: c.beatsUntil(duration), track: { stepMs: step, columns: TRACK_COLS, samples: c.track(duration, step) } };
  });
}
const TRACK_COLS = ['t', 'x', 'y', 'z', 'yaw', 'pitch', 'mm'];
const trackStep = (duration) => Math.max(1000, Math.ceil(duration / 1200 / 500) * 500); // ≤ ~1200 samples per take

// ---------- The room's own cameramen (camera entries { auto, start?, name }) ----------
export const isAutoCam = (c) => !!(c && c.auto && AUTO_CHOICES.includes(c.auto));
export const autoCamsOf = (cameras) => (cameras || []).filter(isAutoCam).sort((a, b) => (a.seq || 0) - (b.seq || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
export const autoCamOf = (cameras) => autoCamsOf(cameras)[0] || null;
export const crewView = (id) => `autocam:${id}`;
const versionKey = (c) => `${c.id}:${c.auto}:${isStart(c.start) ? c.start.join(',') : ''}`;
// Over a recording: [{ from, to, id, name, auto, start, key }] – one span per camera version (on, path change, off).
export function autoCamSpans(tl) {
  const out = [];
  for (const versions of tl.cameras.values()) {
    for (let i = 0; i < versions.length; i++) {
      const c = versions[i].cam; if (c.removed || !isAutoCam(c)) continue;
      out.push({ from: versions[i].t, to: i + 1 < versions.length ? versions[i + 1].t : Infinity, id: c.id, name: c.name || 'Auto cameraman', auto: c.auto, start: isStart(c.start) ? c.start : null, seq: c.seq || 0, key: versionKey(c) });
    }
  }
  return out.sort((a, b) => a.from - b.from || a.seq - b.seq || String(a.id).localeCompare(String(b.id)));
}
// The crew of a recording: every camera version that was on at some point, in the order they came
// (= priority when they meet), seeded `${recId}:${cameraId}` – so each one has its own take.
export function recordingCrew(tl, { seed = tl.header?.id || '', provider = stickerTargets(tl), ...o } = {}) {
  const spans = autoCamSpans(tl), keys = [...new Map(spans.map((s) => [s.key, s])).values()];
  const crew = createAutoCrew(keys.map((s) => ({ key: s.key, group: s.id, path: s.auto, seed: `${seed}:${s.id}`, start: s.start })), { provider, ...o });
  // which version of camera id is on at t (or null)
  const at = (id, t) => { let hit = null; for (const s of spans) if (s.id === id && s.from <= t && t < s.to) hit = s; return hit; };
  const activeAt = (t) => { const ids = []; for (const s of spans) if (s.from <= t && t < s.to && !ids.includes(s.id)) ids.push(s.id); return ids.map((id) => at(id, t)); };
  const ids = [...new Set(spans.map((s) => s.id))];
  return { crew, spans, ids, at, activeAt, poseAt: (id, t) => { const s = at(id, t); return s ? crew.get(s.key).poseAt(t) : null; } };
}
// The director's room shot in a silence: the room's cameramen take turns (the n-th silence goes to
// the n-th one on at that moment, round robin); none on → the fixed corner ('room').
export function roomShotCamera(rc, plan, shot) {
  const act = rc.activeAt(shot.from); if (!act.length) return null;
  let n = 0; for (const s of plan) { if (s === shot || s.from >= shot.from) break; if (s.kind === 'room') n++; }
  return act[n % act.length];
}

// Adds the cameramen to the director's shot list (director.shotList), for editing:
//   views     every cuttable take with a label ('director', '<angle>:<speaker>', 'autocam:<id>', 'auto:<path>')
//   shots[i].camera  which take the director used: 'autocam:<id>' for a silence while the room has
//             cameramen (they take turns), otherwise 'room' (the fixed corner), or '<angle>:<speaker>'
//   autocam   crew: one per room cameraman (its on/off spans, path, start, legs, beats, track);
//             takes: the generic paths; all times in ms from the recording start
export function withAutoCam(list, tl, o = {}) {
  const seed = tl.header?.id || '', duration = Math.max(0, tl.duration || 0), step = trackStep(duration);
  const names = { perimeter: 'Perimeter', diagonal: 'Diagonal sweep', pushin: 'Push-in', loop: 'Loop' };
  const takes = autoCamTakes(tl, { seed, labels: (p) => `Auto cameraman: ${names[p] || p}`, ...o });
  const rc = recordingCrew(tl, { seed });
  const plan = list.shots || [];
  const shots = plan.map((s) => { const c = s.kind === 'room' ? roomShotCamera(rc, plan, s) : null; return { ...s, camera: s.kind === 'room' ? (c ? crewView(c.id) : 'room') : `${s.kind}:${s.speaker}` }; });
  const crew = rc.ids.map((id) => {
    const sp = rc.spans.filter((s) => s.id === id), last = sp[sp.length - 1];
    // the track while it is on (each version from its own schedule)
    const samples = [];
    for (let t = 0; t <= duration; t += step) { const q = rc.poseAt(id, t); if (q) samples.push([Math.round(t), ...q.p, q.yaw, q.pitch, q.mm]); }
    const legs = [], beats = [];
    for (const v of sp) { const m = rc.crew.get(v.key), to = Number.isFinite(v.to) ? v.to : duration; legs.push(...m.legsUntil(to).filter((L) => L.to > v.from)); beats.push(...m.beatsUntil(to).filter((b) => b.t >= v.from)); }
    return { view: crewView(id), id, label: last.name, seed: `${seed}:${id}`, on: sp.map((v) => ({ from: v.from, to: Number.isFinite(v.to) ? v.to : duration, choice: v.auto, path: rc.crew.get(v.key).path, start: v.start })),
      legs, beats, track: { stepMs: step, columns: TRACK_COLS, samples } };
  });
  const views = [{ view: 'director', label: 'Director' },
    ...(list.speakers || []).flatMap((sp) => ['close', 'medium', 'rear'].map((k) => ({ view: `${k}:${sp.id}`, label: `${k}: ${sp.name}` }))),
    ...crew.map((c) => ({ view: c.view, label: c.label })), ...takes.map((t) => ({ view: t.view, label: t.label }))];
  return {
    ...list, shots, views,
    autocam: {
      v: 2, note: 'Deterministic from the recording and the seed; times in ms from the recording start (add introMs in a finished video).',
      directorRoomShot: crew.length ? 'the room’s cameramen take turns in the silences (round robin), otherwise the fixed corner' : 'fixed corner',
      params: { walkMps: AUTOCAM.walk, frameMps: AUTOCAM.frame, accelMps2: AUTOCAM.accel, eyeM: AUTOCAM.eye, mm: AUTOCAM.mm, beatMs: AUTOCAM.beatMs, panMs: AUTOCAM.panMs, maxMmPerBeat: AUTOCAM.maxMmStep, crewGapM: AUTOCAM.crewGapM },
      crew, takes,
    },
  };
}
