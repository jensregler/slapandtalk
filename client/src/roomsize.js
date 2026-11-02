// Room size test (Jens, 2 Nov 2026): Height, Width and Depth sliders in the room panel, so he can try
// sizes ("alla rum ska ha samma storlek"). A local test tool: only this browser's view changes –
// nothing is sent, synced or saved (a reload = the normal size). He picked 16 × 8 × 16 m (t475u), now
// the default in shared/room.json for every room; the sliders start there.
//
// What follows the size: the six surfaces (new planes, the textures re-tiled by applyStyle, fabrics are
// in world space), the ceiling lights, how far you can walk (room.bounds), and everything stuck on the
// walls and ceiling: each sticker's vertices (live ones and the painted-in chunks) and a preset's six
// sheets move with their surface (a wall sticker keeps its height and its place along the wall; the
// floor stays). While the size is not the normal one, slapping is off (a sticker placed in a test-size
// room would land in the wrong place for everyone else) and nothing is painted in (so the stickers'
// stored geometry stays in normal-size coordinates).
import * as THREE from 'three';
import ROOM_SIZE from '../../shared/room.json';
import { ceilingLights } from './room.js';

export const ROOM_DEFAULT = Object.freeze({ width: ROOM_SIZE.width, height: ROOM_SIZE.height, depth: ROOM_SIZE.depth });
export const ROOM_RANGE = Object.freeze({ width: { min: 4, max: 40, step: 0.5 }, height: { min: 2.5, max: 20, step: 0.25 }, depth: { min: 4, max: 40, step: 0.5 } });
const KEY = (d) => `${d.width}x${d.height}x${d.depth}`;

// How a point on the surface with normal n moves from size a to size b.
function shiftFor(nx, ny, nz, a, b, out) {
  out.set(0, 0, 0);
  if (ny < -0.7) out.y = b.height - a.height; // ceiling
  else if (ny > 0.7) return out; // floor
  else if (Math.abs(nx) > 0.7) out.x = -Math.sign(nx) * (b.width - a.width) / 2; // west (n +x) / east (n −x)
  else if (Math.abs(nz) > 0.7) out.z = -Math.sign(nz) * (b.depth - a.depth) / 2; // north (n +z) / south (n −z)
  return out;
}
const FACE_NORMAL = { floor: [0, 1, 0], ceiling: [0, -1, 0], north: [0, 0, 1], south: [0, 0, -1], west: [1, 0, 0], east: [-1, 0, 0] };

export function createRoomSizer({ room, scene, stamps, restyle = () => {}, camera = null }) {
  let cur = { ...ROOM_DEFAULT };
  const lights = room.group.children.filter((o) => o.isPointLight);
  const margin = 0.35;
  const v = new THREE.Vector3();
  const isDefault = () => KEY(cur) === KEY(ROOM_DEFAULT);
  // stickers: no painting-in while the size is a test size
  const rawBake = stamps.bake.bind(stamps);
  stamps.bake = (...a) => (isDefault() ? rawBake(...a) : 0);

  function moveGeometry(g, a, b) {
    const p = g.attributes.position, n = g.attributes.normal; if (!p || !n) return;
    for (let i = 0; i < p.count; i++) {
      shiftFor(n.getX(i), n.getY(i), n.getZ(i), a, b, v);
      if (v.x || v.y || v.z) p.setXYZ(i, p.getX(i) + v.x, p.getY(i) + v.y, p.getZ(i) + v.z);
    }
    p.needsUpdate = true; g.computeBoundingSphere(); g.computeBoundingBox?.();
  }
  // Every sticker mesh / painted-in chunk / preset sheet in the size it is drawn for (userData.roomSize;
  // none = the normal size) → the current one. Run every frame: new stickers (other people's, a chunk
  // rebuilt) are made in normal-size coordinates and follow at once.
  function sync() {
    const want = KEY(cur);
    for (const o of scene.children) {
      const ud = o.userData; if (!ud) continue;
      const isSticker = o.isMesh && (ud.stamp || ud.bakedChunk);
      if (o.name === 'preset') { for (const m of o.children) syncSheet(m, want); continue; }
      if (!isSticker) continue;
      const from = ud.roomSize || ROOM_DEFAULT;
      if (KEY(from) === want) continue;
      moveGeometry(o.geometry, from, cur); ud.roomSize = { ...cur };
    }
  }
  function syncSheet(m, want) {
    const from = m.userData.roomSize || ROOM_DEFAULT; if (KEY(from) === want) return;
    const n = FACE_NORMAL[m.userData.presetFace]; if (!n) return;
    shiftFor(n[0], n[1], n[2], from, cur, v); m.position.add(v); m.updateMatrixWorld(); m.userData.roomSize = { ...cur };
  }

  function set(next) {
    const d = { ...cur };
    for (const k of ['width', 'height', 'depth']) {
      const r = ROOM_RANGE[k], x = Number(next[k] ?? cur[k]);
      if (Number.isFinite(x)) d[k] = Math.round(Math.min(r.max, Math.max(r.min, x)) / r.step) * r.step;
    }
    if (KEY(d) === KEY(cur)) return cur;
    const wasDefault = isDefault();
    cur = d;
    const { width: w, height: h, depth: dp } = d, hw = w / 2, hd = dp / 2;
    const place = { golv: [w, dp, [0, 0, 0]], tak: [w, dp, [0, h, 0]], 'vägg-norr': [w, h, [0, h / 2, -hd]], 'vägg-söder': [w, h, [0, h / 2, hd]], 'vägg-väster': [dp, h, [-hw, h / 2, 0]], 'vägg-öster': [dp, h, [hw, h / 2, 0]] };
    for (const s of room.surfaces) {
      const p = place[s.name]; if (!p) continue;
      s.geometry.dispose(); s.geometry = new THREE.PlaneGeometry(p[0], p[1]);
      s.position.set(...p[2]); s.updateMatrixWorld();
    }
    const spots = ceilingLights(w, h, dp);
    lights.forEach((l, i) => { const o = spots[i % spots.length]; l.position.set(o.x, o.y, o.z); l.intensity = o.intensity; l.distance = o.distance; });
    room.bounds.min.set(-hw + margin, 0, -hd + margin); room.bounds.max.set(hw - margin, h, hd - margin);
    if (camera) { camera.position.x = Math.min(hw - margin, Math.max(-hw + margin, camera.position.x)); camera.position.z = Math.min(hd - margin, Math.max(-hd + margin, camera.position.z)); camera.position.y = Math.min(h - 0.2, camera.position.y); }
    sync();
    restyle(); // the textures' tiling follows the new plane sizes
    if (!wasDefault && isDefault()) stamps.scheduleBake(); // back to normal: painting-in again
    return cur;
  }
  return { get: () => ({ ...cur }), set, reset: () => set(ROOM_DEFAULT), sync, isDefault, DEFAULT: ROOM_DEFAULT, RANGE: ROOM_RANGE };
}
