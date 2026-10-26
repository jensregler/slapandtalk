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
};
export const AUTO_PATHS = ['perimeter', 'diagonal', 'pushin'];
export const AUTO_CHOICES = [...AUTO_PATHS, 'seeded']; // 'seeded' = one of the paths, picked by the seed
export const autoView = (path) => `auto:${path}`;
export const mmToFov = (mm) => +((2 * Math.atan(12 / mm) * 180) / Math.PI).toFixed(3);
export const fovToMm = (fov) => 12 / Math.tan((fov * Math.PI) / 360);
export function resolvePath(path, seed = '') {
  return AUTO_PATHS.includes(path) ? path : AUTO_PATHS[Math.min(2, Math.floor(hash01('autocam-path', seed) * 3))];
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
export function trackOf(path, b = roomBounds(), seed = '') {
  const I = AUTOCAM.inset, X = b.maxX - I, Z = b.maxZ - I, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const h = (k) => hash01(seed, path, k);
  const mid = [cx, 1.3, cz];
  const legs = []; // { a: [x, z], b: [x, z], kind: 'walk'|'frame', look: [x, y, z] }
  const leg = (a, bb, kind, look) => legs.push({ a, b: bb, kind, look });
  if (path === 'perimeter') {
    // Around the room, a third of each side slowly (framing the far wall), aiming over the middle.
    let C = [[-X, Z], [X, Z], [X, -Z], [-X, -Z]];
    const s = Math.floor(h('start') * 4); C = [...C.slice(s), ...C.slice(0, s)];
    if (h('dir') < 0.5) C = [C[0], ...C.slice(1).reverse()];
    for (let i = 0; i < 4; i++) {
      const a = C[i], e = C[(i + 1) % 4], p1 = [lerp(a[0], e[0], 1 / 3), lerp(a[1], e[1], 1 / 3)], p2 = [lerp(a[0], e[0], 2 / 3), lerp(a[1], e[1], 2 / 3)];
      // aim: the middle of the room, pulled toward the opposite wall
      const o = [-(a[0] + e[0]) / 2, -(a[1] + e[1]) / 2], look = [cx + o[0] * 0.5, 1.4, cz + o[1] * 0.5];
      leg(a, p1, 'walk', look); leg(p1, p2, 'frame', look); leg(p2, e, 'walk', look);
    }
  } else if (path === 'diagonal') {
    // Corner to corner through the middle (slow in the middle third), along a wall, the other diagonal back.
    let C = [[-X, -Z], [X, Z], [X, -Z], [-X, Z]];
    if (h('start') < 0.5) C = [C[2], C[3], C[1], C[0]];
    // aim: the middle of one of the two walls ahead (seeded per diagonal), seen at an angle – the whole wall sweeps by
    const ahead = (e, k) => (h(`wall${k}`) < 0.5 ? [Math.sign(e[0]) * (b.maxX - 0.05), 1.4, cz] : [cx, 1.4, Math.sign(e[1]) * (b.maxZ - 0.05)]);
    let nd = 0;
    const diag = (a, e) => {
      const p1 = [lerp(a[0], e[0], 0.35), lerp(a[1], e[1], 0.35)], p2 = [lerp(a[0], e[0], 0.65), lerp(a[1], e[1], 0.65)], look = ahead(e, nd++);
      leg(a, p1, 'walk', look); leg(p1, p2, 'frame', look); leg(p2, e, 'walk', look);
    };
    diag(C[0], C[1]); leg(C[1], C[2], 'walk', mid); diag(C[2], C[3]); leg(C[3], C[0], 'walk', mid);
  } else if (path === 'pushin') {
    // A slow push-in toward one wall (seeded), hold, pull back to a new spot; three spots along the wall.
    const walls = [
      { w: [cx, b.minZ], n: [0, 1], u: [1, 0], half: X }, { w: [cx, b.maxZ], n: [0, -1], u: [-1, 0], half: X },
      { w: [b.minX, cz], n: [1, 0], u: [0, -1], half: Z }, { w: [b.maxX, cz], n: [-1, 0], u: [0, 1], half: Z },
    ];
    const W = walls[Math.min(3, Math.floor(h('wall') * 4))];
    const depth = Math.min(b.maxX - b.minX, b.maxZ - b.minZ);
    const far = Math.min(4.4, depth - I - 0.2), near = 1.6;
    let offs = [0, -0.4, 0.4]; if (h('offs') < 0.5) offs = [0, 0.4, -0.4];
    const at = (o, d) => [W.w[0] + W.n[0] * d + W.u[0] * o * W.half, W.w[1] + W.n[1] * d + W.u[1] * o * W.half];
    for (let i = 0; i < offs.length; i++) {
      const o = offs[i], o2 = offs[(i + 1) % offs.length];
      const look = [W.w[0] + W.u[0] * o * W.half * 0.9 + W.n[0] * 0.02, 1.5, W.w[1] + W.u[1] * o * W.half * 0.9 + W.n[1] * 0.02];
      leg(at(o, far), at(o * 0.85, near), 'frame', look);
      leg(at(o * 0.85, near), at(o2, far), 'walk', look);
    }
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

// ---------- The cameraman ----------
export function createAutoCam({ path = 'seeded', seed = '', bounds = roomBounds(), provider = noTargets, ...o } = {}) {
  const P = { ...AUTOCAM, ...o, sway: { ...AUTOCAM.sway, ...(o.sway || {}) } };
  const name = resolvePath(path, seed);
  const loop = trackOf(name, bounds, seed);
  const eye = range(P.eye, hash01(seed, name, 'eye'));
  const lim = { minX: bounds.minX + P.wallGap, maxX: bounds.maxX - P.wallGap, minZ: bounds.minZ + P.wallGap, maxZ: bounds.maxZ - P.wallGap };
  // The schedule, built lazily: legs[i] = { t0 (hold starts), t1 (moving starts), t2 (arrives), … }
  const legs = [];
  function extend(t) {
    while (!legs.length || legs[legs.length - 1].t2 <= t) {
      const i = legs.length, L = loop[i % loop.length], prev = legs[i - 1];
      const u = hash01(seed, name, 'leg', i);
      const vMax = range(L.kind === 'frame' ? P.frame : P.walk, u);
      const holdMs = L.kind === 'frame' ? range(P.settle, hash01(seed, name, 'hold', i)) : prev && prev.kind === 'frame' ? 0 : range(P.hold, hash01(seed, name, 'hold', i));
      const d = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]);
      const prof = legProfile(d, vMax, P.accel);
      const t0 = prev ? prev.t2 : 0, t1 = t0 + holdMs, t2 = t1 + prof.T * 1000;
      legs.push({ i, kind: L.kind, a: L.a, b: L.b, look: L.look, vMax: r4(vMax), prof, t0, t1, t2 });
      if (legs.length > 100000) break;
    }
  }
  function legAt(t) {
    extend(t);
    let lo = 0, hi = legs.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (legs[m].t2 <= t) lo = m + 1; else hi = m; }
    return legs[lo];
  }
  // Where the track puts the camera (no sway), and how fast it moves there.
  function base(t) {
    t = Math.max(0, t);
    const L = legAt(t), tau = (t - L.t1) / 1000, s = legDist(L.prof, tau), k = L.prof.d > 0 ? s / L.prof.d : 1;
    const ds = legDist(L.prof, tau + 0.01) - legDist(L.prof, tau - 0.01);
    return { L, p: [lerp(L.a[0], L.b[0], k), eye, lerp(L.a[1], L.b[1], k)], speed: tau > 0 && tau < L.prof.T ? ds / 0.02 : 0 };
  }
  // Beats: the cameraman picks an aim and a focal length every beatMs, in order (the zoom never
  // jumps more than maxMmStep from one beat to the next).
  const beats = [];
  function beat(k) {
    while (beats.length <= k) {
      const j = beats.length, tb = j * P.beatMs, B = base(tb), look = B.L.look;
      const def = aim(B.p, look);
      let best = null;
      for (const c of provider.targetsAt(tb, { pos: B.p, look, path: name, bounds }) || []) {
        if (!(c && Array.isArray(c.p) && c.weight > 0)) continue;
        const a = aim(B.p, c.p);
        if (a.dist < P.minTargetM || Math.abs(wrap(a.yaw - def.yaw)) > (P.maxAngleDeg * Math.PI) / 180) continue;
        if (!best || c.weight > best.weight + 1e-9 || (Math.abs(c.weight - best.weight) <= 1e-9 && String(c.id) < String(best.id))) best = { ...c, dist: a.dist };
      }
      let want;
      if (best) want = clamp((P.sensorMm * best.dist) / Math.max(0.6, (best.size || 0.5) * 2.2 + 0.6), P.mm[0] + 7, P.mm[1]); // the area ≈ ½ the frame height
      else want = range(P.idleMm, 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (4 + Math.floor(hash01(seed, name, 'breath') * 3))));
      const prevMm = j ? beats[j - 1].mm : range(P.idleMm, 0);
      const mm = +clamp(clamp(want, prevMm - P.maxMmStep, prevMm + P.maxMmStep), P.mm[0], P.mm[1]).toFixed(2);
      beats.push({ t: tb, target: best ? { id: best.id, kind: best.kind, p: best.p.map(r4) } : { id: null, kind: 'track', p: look.map(r4) }, mm });
      if (beats.length > 200000) break;
    }
    return beats[k];
  }
  const sw = [0, 1, 2, 3, 4, 5].map((i) => hash01(seed, name, 'sway', i) * Math.PI * 2);
  function poseAt(t) {
    t = Math.max(0, t);
    const B = base(t), k = Math.floor(t / P.beatMs), b0 = beat(k), b1 = beat(k + 1);
    const u = (t - b0.t) / P.beatMs, pan = smooth((t - b0.t) / P.panMs);
    const ts = t / 1000, S = P.sway, step = Math.min(1, B.speed / P.walk[1]);
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
  // For the shot list: the schedule and the aim/zoom decisions up to `duration`, and a sampled track.
  function legsUntil(duration) { extend(duration); return legs.filter((L) => L.t0 < duration).map((L) => ({ from: Math.round(L.t0), moveFrom: Math.round(L.t1), to: Math.round(L.t2), kind: L.kind, a: L.a.map(r4), b: L.b.map(r4), vMax: L.vMax })); }
  function beatsUntil(duration) { const n = Math.floor(duration / P.beatMs); for (let k = 0; k <= n; k++) beat(k); return beats.slice(0, n + 1).map((b) => ({ ...b })); }
  function track(duration, stepMs = 1000) {
    const out = [];
    for (let t = 0; t <= duration; t += stepMs) { const q = poseAt(t); out.push([Math.round(t), ...q.p, q.yaw, q.pitch, q.mm]); }
    return out;
  }
  return { path: name, requested: path, seed: String(seed), eye: r4(eye), params: P, poseAt, base, legsUntil, beatsUntil, track, provider: provider.name || 'custom' };
}

// The take descriptions that go into the shot list (director.shotList): one per path.
export function autoCamTakes(tl, { seed = tl.header?.id || '', room = null, paths = AUTO_PATHS, stepMs = null, labels = null } = {}) {
  const duration = Math.max(0, tl.duration || 0);
  const step = stepMs || Math.max(1000, Math.ceil(duration / 1200 / 500) * 500); // ≤ ~1200 samples per take
  const provider = stickerTargets(tl);
  return paths.map((p) => {
    const c = createAutoCam({ path: p, seed: `${seed}:${p}`, provider, ...(room ? { bounds: roomBounds(room) } : {}) });
    return {
      view: autoView(p), path: p, label: labels ? labels(p) : `Auto cameraman: ${p}`, seed: `${seed}:${p}`, eyeM: c.eye, provider: c.provider,
      legs: c.legsUntil(duration), beats: c.beatsUntil(duration),
      track: { stepMs: step, columns: ['t', 'x', 'y', 'z', 'yaw', 'pitch', 'mm'], samples: c.track(duration, step) },
    };
  });
}
// The room's own auto cameraman (a camera entry { auto: 'perimeter'|'diagonal'|'pushin'|'seeded' }) at time t.
export const autoCamOf = (cameras) => (cameras || []).find((c) => c && c.auto && AUTO_CHOICES.includes(c.auto)) || null;

// The room's auto cameraman over a recording: [{ from, to, auto, id }] (when it was switched on, which path).
export function autoCamSpans(tl) {
  const out = [];
  for (const versions of tl.cameras.values()) {
    for (let i = 0; i < versions.length; i++) {
      const c = versions[i].cam; if (c.removed || !c.auto || !AUTO_CHOICES.includes(c.auto)) continue;
      out.push({ from: versions[i].t, to: i + 1 < versions.length ? versions[i + 1].t : Infinity, auto: c.auto, id: c.id });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}
// Which take the room's auto cameraman is at time t (the view 'auto:<path>'), or null when it is off.
export function roomAutoPathAt(spans, t, seed = '') {
  let hit = null; for (const s of spans) if (s.from <= t && t < s.to) hit = s;
  return hit ? resolvePath(hit.auto, `${seed}:${hit.id}`) : null;
}

// Adds the auto cameraman to the director's shot list (director.shotList), for editing:
//   views     every cuttable take ('director', 'close:<id>', …, 'auto:perimeter', …) with a label
//   shots[i].camera  which take the director used ('auto:<path>' for its room shot while the room's
//             auto cameraman is on, otherwise 'room' = the fixed high corner, or '<kind>:<speaker>')
//   autocam   per path: legs (hold/move times, waypoints, top speed), beats (aim + focal length every
//             4 s) and a sampled track [t, x, y, z, yaw, pitch, mm], all in ms from the recording start
export function withAutoCam(list, tl, o = {}) {
  const seed = tl.header?.id || '';
  const spans = autoCamSpans(tl);
  const names = { perimeter: 'Perimeter', diagonal: 'Diagonal sweep', pushin: 'Push-in' };
  const takes = autoCamTakes(tl, { seed, labels: (p) => `Auto cameraman: ${names[p] || p}`, ...o });
  const shots = (list.shots || []).map((s) => ({ ...s, camera: s.kind === 'room' ? (roomAutoPathAt(spans, s.from, seed) ? autoView(roomAutoPathAt(spans, s.from, seed)) : 'room') : `${s.kind}:${s.speaker}` }));
  const views = [{ view: 'director', label: 'Director' },
    ...(list.speakers || []).flatMap((sp) => ['close', 'medium', 'rear'].map((k) => ({ view: `${k}:${sp.id}`, label: `${k}: ${sp.name}` }))),
    ...takes.map((t) => ({ view: t.view, label: t.label }))];
  return {
    ...list, shots, views,
    autocam: {
      v: 1, note: 'Deterministic from the recording and the seed; times in ms from the recording start (add introMs in a finished video).',
      room: spans.map((s) => ({ from: s.from, to: Number.isFinite(s.to) ? s.to : list.durationMs, choice: s.auto, view: autoView(resolvePath(s.auto, `${seed}:${s.id}`)) })),
      directorRoomShot: spans.length ? 'auto cameraman while the room has it on, otherwise the fixed corner' : 'fixed corner',
      params: { walkMps: AUTOCAM.walk, frameMps: AUTOCAM.frame, accelMps2: AUTOCAM.accel, eyeM: AUTOCAM.eye, mm: AUTOCAM.mm, beatMs: AUTOCAM.beatMs, panMs: AUTOCAM.panMs, maxMmPerBeat: AUTOCAM.maxMmStep },
      takes,
    },
  };
}
