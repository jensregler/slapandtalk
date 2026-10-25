// Peels (backing paper): when a room has peels on, every slap drops the sticker's glossy
// backing paper, a pure-white copy with the same silhouette, which flutters to the floor and stays.
// Shared by the browser, the server and the tests, so everyone computes the same thing:
//   - peelPlan(seed, from, target): where it is born (hip height, on the line from the slapper towards
//     the slap) and where it lands (near the foot of the slap: the wall base, or just short of a floor
//     sticker). Deterministic from the seed (the slap's nonce, or the stamp id), the server stores it.
//   - SLAP_REACH / inReach(eye, target): with peels on, you can only slap what is within arm's reach
//     (so the paper lands near the slap). Checked in the browser and, with a little slack, on the server.
//   - peelPose(peel, u): position + rotation along the scripted fall path at u = 0..1 (no physics).
//   - overlapFraction(sticker, peels): how much of a new floor sticker lies on peels (easter egg:
//     stickers don't stick on backing paper; more than PEEL.refuseOverlap is refused).
// All the tweakable numbers are in PEEL.
import ROOM from './room.json' with { type: 'json' };

// With peels on, the furthest you can slap: metres from the avatar's eyes to the hit point (3D).
// 2.5 m reaches a wall at eye height from 2.5 m, the floor up to ~1.9 m ahead and the 4 m ceiling
// when standing almost under the spot. With peels off there is no reach limit at all.
export const SLAP_REACH = 2.5;
// The server measures from the last position it heard over the WebSocket, which can be a step
// behind (moves are sent ~12×/s), so it allows this much extra before it refuses.
export const REACH_TOLERANCE = 0.6;
export const reachDistance = (eye, target) => Math.hypot(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
export const inReach = (eye, target, slack = 0) => reachDistance(eye, target) <= SLAP_REACH + slack;

export const PEEL = {
  maxPerRoom: 300,          // oldest peels go first
  refuseOverlap: 0.4,       // a floor sticker more than this much on peels doesn't stick
  birthHeight: 1.0,         // m: hip height of the slapping player
  birthAlong: 0.5,          // born this fraction of the way from the slapper towards the slap …
  birthAlongMax: 0.9,       // m: … but at most this far out (it comes off at the hand, at hip height)
  birthSide: 0.12,          // m: a little to the side of the slapping arm
  footBack: 0.22,           // m: lands this far back from the foot of a wall slap (towards the slapper)
  footBackFloor: 0.4,       // m: a floor slap's paper lands this much short of the sticker (not on it)
  footScatter: 0.25,        // m: random scatter around that spot
  curve: 0.35,              // the drift bends this much (fraction of the distance), random sign
  fallMin: 0.8, fallMax: 1.4,            // s: fall time
  swayAmp: 0.13,            // m: side-to-side flutter at the start (fades out)
  swayCyclesMin: 1.4, swayCyclesMax: 2.6,
  tumbleTurnsMin: 0.35, tumbleTurnsMax: 1.2, // full turns of tumbling, unwinding to flat on landing
  flutterTilt: 0.5,         // rad: extra rocking that fades out
  floorY: 0.0015,           // m: rests just above the floor (no z-fighting)
  wallMargin: 0.12,         // m: lands at least this far from the walls
  maskSize: 32,             // silhouette grid (alpha mask) per design
  overlapSamples: 100,      // samples per side of the new sticker when measuring overlap
};
export const FLOOR_SURFACE = 'golv';

// ---------- Deterministic random numbers from a seed ----------
function hash32(s) { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0; }
export function seeded(seed) {
  let a = hash32(seed);
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerp = (a, b, t) => a + (b - a) * t;
const round = (n) => Math.round(n * 1e4) / 1e4;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

// Same conventions as the camera (controls.js): yaw 0 looks towards −z.
export const forwardOf = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];
export const rightOf = (yaw) => [Math.cos(yaw), -Math.sin(yaw)];
// Which arm slaps: the one on the side of the target (the avatar uses the arm nearest the hit).
export function slapSide(from, target) {
  const [rx, rz] = rightOf(from.yaw);
  return (target[0] - from.x) * rx + (target[2] - from.z) * rz >= 0 ? 1 : -1; // 1 = right
}

// The random but seed-fixed parts of the path (same for everyone).
export function pathParams(seed) {
  const r = seeded('path:' + seed);
  return {
    dur: round(lerp(PEEL.fallMin, PEEL.fallMax, r())),
    swayCycles: lerp(PEEL.swayCyclesMin, PEEL.swayCyclesMax, r()), swayPhase: r() * Math.PI * 2,
    curve: (r() < 0.5 ? -1 : 1) * PEEL.curve * lerp(0.4, 1, r()),
    turns: lerp(PEEL.tumbleTurnsMin, PEEL.tumbleTurnsMax, r()) * (r() < 0.5 ? -1 : 1),
    axis: (() => { const a = r() * Math.PI * 2; return [Math.cos(a), Math.sin(a) * 0.6, Math.sin(a)]; })(),
    flutter: lerp(0.5, 1, r()),
  };
}

// from = { x, z, yaw } of the slapping player, target = [x, y, z] where the sticker landed.
// Returns the stored part: start (born), x/z/yaw (resting place), side (+1 right / −1 left).
// Born at hip height on the line from the slapper towards the slap; lands near the foot of the
// slap (the wall base, right under a ceiling slap, just short of a floor sticker).
export function peelPlan(seed, from, target, room = ROOM) {
  const r = seeded('land:' + seed);
  const side = slapSide(from, target);
  const [rx, rz] = rightOf(from.yaw);
  const mx = room.width / 2 - PEEL.wallMargin, mz = room.depth / 2 - PEEL.wallMargin;
  const hx = clamp(from.x, -mx, mx), hz = clamp(from.z, -mz, mz);
  let dx = target[0] - hx, dz = target[2] - hz;
  const D = Math.hypot(dx, dz);
  if (D > 0.05) { dx /= D; dz /= D; } else [dx, dz] = forwardOf(from.yaw); // rakt upp/ner: framåt
  const a = Math.min(D * PEEL.birthAlong, PEEL.birthAlongMax);
  const start = [hx + dx * a + rx * PEEL.birthSide * side, PEEL.birthHeight, hz + dz * a + rz * PEEL.birthSide * side];
  const floor = target[1] < 0.15;
  const back = Math.min(floor ? PEEL.footBackFloor : PEEL.footBack, D);
  const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * PEEL.footScatter;
  const x = clamp(target[0] - dx * back + Math.cos(ang) * rad, -mx, mx), z = clamp(target[2] - dz * back + Math.sin(ang) * rad, -mz, mz);
  const yaw = r() * Math.PI * 2;
  return { start: start.map(round), x: round(x), z: round(z), yaw: round(yaw), side };
}

// ---------- Quaternions (tiny, no three.js) ----------
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qAxis = (ax, ang) => { const l = Math.hypot(...ax) || 1, s = Math.sin(ang / 2); return [ax[0] / l * s, ax[1] / l * s, ax[2] / l * s, Math.cos(ang / 2)]; };
export const qApply = (q, v) => { const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
// Lying flat on the floor, turned by yaw: a plane (local x right, y up) rotated −90° about x, then yaw about y.
export const flatQuat = (yaw) => qMul(qAxis([0, 1, 0], yaw), qAxis([1, 0, 0], -Math.PI / 2));
// The peel's frame on the floor: u = local +x, v = local +y (the top of the image), as [x, z].
export function peelFrame(yaw) { return { u: [Math.cos(yaw), -Math.sin(yaw)], v: [-Math.sin(yaw), -Math.cos(yaw)] }; }

// Where the peel is at u = 0..1 of its fall. peel = { seed, start, x, z, yaw }.
export function peelPose(peel, u, params = pathParams(peel.seed)) {
  u = clamp(u, 0, 1);
  const [sx, sy, sz] = peel.start, ex = peel.x, ez = peel.z;
  const dx = ex - sx, dz = ez - sz, dist = Math.hypot(dx, dz) || 1e-6, px = -dz / dist, pz = dx / dist;
  // Curved drift (quadratic) + a flutter sideways that fades out.
  const bend = 4 * u * (1 - u) * params.curve * Math.min(dist, 1); // longer falls don't swing wider
  const sway = Math.sin(params.swayPhase + u * params.swayCycles * Math.PI * 2) * PEEL.swayAmp * (1 - u) * (1 - u) - Math.sin(params.swayPhase) * PEEL.swayAmp * (1 - u) * (1 - u) * (1 - u);
  const e = u * u * (3 - 2 * u) * 0.55 + u * 0.45; // drifts out fast-ish, settles softly
  const x = sx + dx * e + px * (bend + sway), z = sz + dz * e + pz * (bend + sway);
  // Height: floats a little, then sinks; lands exactly on the floor at u = 1.
  const fall = u * (0.35 + 0.65 * u);
  const y = lerp(sy, PEEL.floorY, fall) + Math.sin(u * Math.PI) * 0.04;
  // Tumbling that unwinds to flat, plus a fading rock.
  const k = (1 - u) ** 1.6;
  const tumble = qAxis(params.axis, params.turns * Math.PI * 2 * k + Math.sin(u * params.swayCycles * Math.PI * 2) * PEEL.flutterTilt * params.flutter * k);
  const q = qMul(flatQuat(peel.yaw), tumble);
  return { p: [x, y, z], q };
}

// ---------- Silhouettes and overlap ----------
// mask = { n, bits } (n×n, row 0 = top of the image, 1 = opaque) or null = a plain rectangle.
export function maskFromAlpha(alpha, n, stride = 1, offset = 0) {
  const bits = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) bits[i] = alpha[i * stride + offset] >= 128 ? 1 : 0;
  if (bits.every((b) => b === 1)) return null; // helt ogenomskinlig = rektangel
  return { n, bits };
}
const maskAt = (m, s, t) => !m || m.bits[Math.min(m.n - 1, Math.floor(t * m.n)) * m.n + Math.min(m.n - 1, Math.floor(s * m.n))] === 1;
// Width and height of a sticker: the longest side = size (same as StampLayer.dims).
export function stampDims(image, size) { const a = (image.width || 1) / (image.height || 1); return a >= 1 ? [size, size / a] : [size * a, size]; }
// A floor sticker's frame from its quaternion: u = local +x, v = local +y, projected to [x, z].
export function stampFrame(quaternion) { const u = qApply(quaternion, [1, 0, 0]), v = qApply(quaternion, [0, 1, 0]); return { u: [u[0], u[2]], v: [v[0], v[2]] }; }

// sticker = { x, z, w, h, u, v, mask }, peels = [{ x, z, w, h, yaw, mask }] → 0..1 of the sticker's
// opaque area that lies on (opaque parts of) peels. Sampled on an N×N grid (cell centres).
export function overlapFraction(sticker, peels, N = PEEL.overlapSamples) {
  const R = Math.hypot(sticker.w, sticker.h) / 2;
  const near = peels.filter((p) => Math.hypot(p.x - sticker.x, p.z - sticker.z) < R + Math.hypot(p.w, p.h) / 2)
    .map((p) => ({ ...p, ...peelFrame(p.yaw) }));
  let total = 0, covered = 0;
  for (let j = 0; j < N; j++) {
    const t = (j + 0.5) / N;
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) / N;
      if (!maskAt(sticker.mask, s, t)) continue;
      total++;
      if (!near.length) continue;
      const a = (s - 0.5) * sticker.w, b = (0.5 - t) * sticker.h;
      const px = sticker.x + sticker.u[0] * a + sticker.v[0] * b, pz = sticker.z + sticker.u[1] * a + sticker.v[1] * b;
      for (const p of near) {
        const qx = px - p.x, qz = pz - p.z;
        const ps = (qx * p.u[0] + qz * p.u[1]) / p.w + 0.5, pt = 0.5 - (qx * p.v[0] + qz * p.v[1]) / p.h;
        if (ps >= 0 && ps < 1 && pt >= 0 && pt < 1 && maskAt(p.mask, ps, pt)) { covered++; break; }
      }
    }
  }
  return total ? covered / total : 0;
}
// Is this slap on the floor (where peels can be in the way)?
export const onFloor = (surface, normal) => surface === FLOOR_SURFACE && Array.isArray(normal) && normal[1] > 0.9;
