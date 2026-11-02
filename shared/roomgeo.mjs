// The room's size over time (Jens, 2 Nov 2026, t475u: "vi sätter room hight till 8 och bredd och djup
// till 16"). Every room is the box in shared/room.json (now 16 × 8 × 16 m, was 10 × 4 × 10 m). Rooms,
// stickers, presets and recordings made before the change are in the old box's coordinates:
//
//   LEGACY_ROOM = { width: 10, height: 4, depth: 10 }
//
// The least surprising move for an old sticker (remapStamp): it stays on the SAME surface, at the
// same size, the same height on its wall and the same place along it (measured from the middle of the
// wall), and its surface moves out to where it is now: a wall sticker moves straight out with its wall
// (north/south 5 → 8 m from the middle, east/west too), a ceiling sticker goes up with the ceiling (4 →
// 8 m), the floor stays. So nothing floats in the air, nothing is stretched, and what was at eye
// height still is – the old room now sits in the middle of each bigger surface, bottom-aligned on the
// walls. (Preset sheets are scenery and are scaled up instead, see presetSheet.)
// A sticker that used to fold round a corner of the old box is flat on its (bigger) wall now.
//
// room.geo (store.js) = the size its stickers are in, as sizeKey(); none = LEGACY_ROOM.
import ROOM from './room.json' with { type: 'json' };

export const LEGACY_ROOM = Object.freeze({ width: 10, height: 4, depth: 10 });
export const CURRENT_ROOM = Object.freeze({ width: ROOM.width, height: ROOM.height, depth: ROOM.depth });
export const sizeKey = (r) => `${r.width}x${r.height}x${r.depth}`;
export const CURRENT_KEY = sizeKey(CURRENT_ROOM);
// "16x8x16" → { width, height, depth } (null if it is not one)
export function parseSizeKey(k) {
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(String(k || ''));
  return m ? { width: +m[1], height: +m[2], depth: +m[3] } : null;
}
const FACE_BY_SURFACE = { golv: 'floor', tak: 'ceiling', 'vägg-norr': 'north', 'vägg-söder': 'south', 'vägg-väster': 'west', 'vägg-öster': 'east' };
// Which face a sticker is on: its surface name, else its normal (pointing into the room).
export function faceOf(surface, normal) {
  if (FACE_BY_SURFACE[surface]) return FACE_BY_SURFACE[surface];
  const [x = 0, y = 0, z = 0] = Array.isArray(normal) ? normal : [];
  if (y > 0.7) return 'floor';
  if (y < -0.7) return 'ceiling';
  if (Math.abs(x) >= Math.abs(z)) return x > 0 ? 'west' : 'east';
  return z > 0 ? 'north' : 'south';
}
// How a point on that face moves from box a to box b: [dx, dy, dz].
export function faceShift(face, a, b) {
  switch (face) {
    case 'ceiling': return [0, b.height - a.height, 0];
    case 'north': return [0, 0, -(b.depth - a.depth) / 2]; // the wall at −depth/2
    case 'south': return [0, 0, (b.depth - a.depth) / 2];
    case 'west': return [-(b.width - a.width) / 2, 0, 0];  // the wall at −width/2
    case 'east': return [(b.width - a.width) / 2, 0, 0];
    default: return [0, 0, 0];
  }
}
const r6 = (n) => Math.round(n * 1e6) / 1e6;
// A stamp ({ position, normal, surface, … }) in box `from` → the same stamp in box `to` (a copy; the
// same object if nothing moves).
export function remapStamp(stamp, from = LEGACY_ROOM, to = CURRENT_ROOM) {
  if (!stamp || !Array.isArray(stamp.position) || stamp.position.length !== 3) return stamp;
  const d = faceShift(faceOf(stamp.surface, stamp.normal), from, to);
  if (!d[0] && !d[1] && !d[2]) return stamp;
  return { ...stamp, position: stamp.position.map((v, i) => r6(v + d[i])) };
}
// A room / recording snapshot's stickers from its stored size key (none = legacy) to the current box.
export function remapStamps(stamps, fromKey) {
  const from = parseSizeKey(fromKey) || LEGACY_ROOM;
  if (sizeKey(from) === CURRENT_KEY || !Array.isArray(stamps)) return stamps;
  return stamps.map((s) => remapStamp(s, from, CURRENT_ROOM));
}
// Where a preset's baked sheet for `face` goes, when it was baked in box `baked` (none = legacy) and
// the room is `room`: { w, h, center: [x, y, z], scale } in world space. A preset is scenery (a whole
// landscape baked onto six images), so an old one is scaled UP uniformly to fill the floor, the ceiling
// and the width of every wall (16 / 10 = 1.6×) – never stretched in one direction only (no distortion)
// and never tiled. The walls are then 4 × 1.6 = 6.4 m high, bottom-aligned (the scenery stands on the
// floor; the top 1.6 m of the 8 m wall shows the room's own wall). A preset baked in this box: 1×, whole surface.
export function presetSheet(face, baked = LEGACY_ROOM, room = CURRENT_ROOM) {
  const B = baked || LEGACY_ROOM, R = room;
  const k = Math.min(R.width / B.width, R.depth / B.depth);
  const flat = face === 'floor' || face === 'ceiling';
  const w = (face === 'west' || face === 'east' ? B.depth : B.width) * k;
  const h = (flat ? B.depth : B.height) * k;
  let c;
  if (face === 'floor') c = [0, 0, 0];
  else if (face === 'ceiling') c = [0, R.height, 0];
  else {
    const y = Math.min(h, R.height) / 2; // bottom-aligned
    c = face === 'north' ? [0, y, -R.depth / 2] : face === 'south' ? [0, y, R.depth / 2] : face === 'west' ? [-R.width / 2, y, 0] : [R.width / 2, y, 0];
  }
  return { w: +w.toFixed(6), h: +h.toFixed(6), center: c.map((v) => +v.toFixed(6)), scale: k };
}
