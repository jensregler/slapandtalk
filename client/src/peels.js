// Peels (backing paper) on the floor: white copies of the stickers' silhouettes.
// One InstancedMesh per design (plus one for the soft dark edge underneath), so 300 peels are a
// handful of draw calls. Silhouette textures and alpha masks are cached per design.
// Peels draw before the stickers (renderOrder 4–5, stickers are 10+) and sit just above the floor
// (PEEL.floorY + polygonOffset), so they never z-fight and later floor stickers end up on top.
// The fall itself is shared/peels.mjs (peelPose), the same for everyone.
// Time: live = performance.now(). The replay (client/src/replay.js) passes now = () => replay time
// and gives every peel its born time (the slap's t), so the fall is a pure function of the
// replay time: the same at every play, seek or scrub (rewind() puts a landed peel back in the air).
import * as THREE from 'three';
import { PEEL, peelPose, pathParams, maskFromAlpha, overlapFraction, stampDims, stampFrame } from '../../shared/peels.mjs';

const SIL_PX = 128;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const FLAT = new THREE.Quaternion();

export class PeelLayer {
  constructor(scene, { now = () => performance.now() } = {}) {
    this.now = now;
    this.scene = scene; this.root = new THREE.Group(); this.root.name = 'peels'; this.root.visible = false; scene.add(this.root);
    this.on = false;
    this.groups = new Map(); // imageId -> { mesh, edge, items: [peel], tex, cap }
    this.peels = new Map();  // id -> { peel, image, born, params, landed }
    this.sil = new Map();    // imageId -> Promise<{ tex, mask }>
    this.falling = new Set();
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.landedCount = 0;
  }
  setOn(on) { this.on = !!on; this.root.visible = this.on; }
  // Silhouette (white, same alpha) and the alpha mask of a design. Cached.
  silhouette(image) {
    if (!this.sil.has(image.id)) {
      const p = new Promise((resolve, reject) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => resolve(im); im.onerror = reject; im.src = image.url; })
        .then((im) => {
          const a = im.naturalWidth / im.naturalHeight, w = a >= 1 ? SIL_PX : Math.max(8, Math.round(SIL_PX * a)), h = a >= 1 ? Math.max(8, Math.round(SIL_PX / a)) : SIL_PX;
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g = c.getContext('2d'); g.drawImage(im, 0, 0, w, h);
          g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
          const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
          const n = PEEL.maskSize, mc = document.createElement('canvas'); mc.width = mc.height = n;
          const mg = mc.getContext('2d', { willReadFrequently: true }); mg.drawImage(im, 0, 0, n, n);
          const mask = maskFromAlpha(mg.getImageData(0, 0, n, n).data, n, 4, 3);
          return { tex, mask };
        });
      p.catch(() => this.sil.delete(image.id));
      this.sil.set(image.id, p);
    }
    return this.sil.get(image.id);
  }
  async group(image) {
    let g = this.groups.get(image.id);
    if (g) return g;
    const { tex } = await this.silhouette(image);
    if (this.groups.has(image.id)) return this.groups.get(image.id);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.5, metalness: 0, transparent: true, alphaTest: 0.5,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: tex, transparent: true, opacity: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    g = { image, mat, edgeMat, items: [], cap: 0, mesh: null, edge: null };
    this.groups.set(image.id, g);
    this.resize(g, 16);
    return g;
  }
  resize(g, cap) {
    for (const k of ['mesh', 'edge']) if (g[k]) { this.root.remove(g[k]); g[k].dispose(); }
    g.cap = cap;
    g.mesh = new THREE.InstancedMesh(this.geo, g.mat, cap); g.edge = new THREE.InstancedMesh(this.geo, g.edgeMat, cap);
    for (const [m, o] of [[g.mesh, 5], [g.edge, 4]]) { m.renderOrder = o; m.frustumCulled = false; m.raycast = () => {}; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.root.add(m); }
    g.items.forEach((it, i) => this.place(g, it, i));
    g.mesh.count = g.edge.count = g.items.length;
  }
  // Pose instance i: falling = along the path, landed = flat on the floor.
  place(g, it, i, now = this.now()) {
    const e = this.peels.get(it.id); if (!e) return;
    const P = e.peel;
    const u = e.landed ? 1 : Math.max(0, Math.min(1, (now - e.born) / (e.params.dur * 1000)));
    const pose = peelPose(P, u, e.params);
    _p.set(...pose.p); _q.set(...pose.q); _s.set(P.w, P.h, 1);
    g.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    if (u >= 1) { // mjuk mörk kant under, lite större och förskjuten mot ljuset
      FLAT.set(...pose.q);
      _p.set(pose.p[0] + 0.006, PEEL.floorY * 0.5, pose.p[2] + 0.008); _s.set(P.w * 1.06 + 0.01, P.h * 1.06 + 0.01, 1);
      g.edge.setMatrixAt(i, _m.compose(_p, FLAT, _s));
    } else g.edge.setMatrixAt(i, _m.makeScale(0, 0, 0));
    if (u >= 1 && !e.landed) { e.landed = true; this.falling.delete(it.id); this.landedCount++; if (this.onLand) this.onLand(e.peel, e.by); }
  }
  // peel = { id, imageId, w, h, seed, start, x, z, yaw }. animate = fall from the slap (a new slap).
  // by: who slapped it ('me' or a player id) – the landing "duff" uses their sound (onLand).
  // born (replay): when it was slapped, on the now() clock; it falls if that was < dur ago.
  async add(peel, image, { animate = false, by = null, born = null } = {}) {
    if (!peel || !image || this.peels.has(peel.id)) return;
    const params = pathParams(peel.seed);
    if (born != null) animate = this.now() - born < params.dur * 1000;
    const e = { peel, image, born: born ?? this.now(), params, landed: !animate, by };
    this.peels.set(peel.id, e);
    let g;
    try { g = await this.group(image); } catch { if (this.peels.get(peel.id) === e) this.peels.delete(peel.id); return; }
    if (this.peels.get(peel.id) !== e) return; // removed (or removed and added again) while loading
    if (born != null) { e.landed = !(animate = this.now() - born < params.dur * 1000); } // the replay may have moved on
    else if (animate) e.born = this.now(); // fallet börjar när formen finns
    if (g.items.length >= g.cap) this.resize(g, g.cap * 2);
    g.items.push({ id: peel.id });
    g.mesh.count = g.edge.count = g.items.length;
    if (animate) this.falling.add(peel.id); else this.landedCount++;
    this.place(g, { id: peel.id }, g.items.length - 1);
    g.mesh.instanceMatrix.needsUpdate = g.edge.instanceMatrix.needsUpdate = true;
    this.trim();
  }
  // Byt id (min egen peel, när servern svarat) och landa där servern säger.
  confirm(tempId, peel) {
    const e = this.peels.get(tempId); if (!e) return false;
    this.peels.delete(tempId);
    e.peel = { ...peel }; this.peels.set(peel.id, e);
    const g = this.groups.get(e.image.id); const it = g?.items.find((x) => x.id === tempId); if (it) it.id = peel.id;
    if (this.falling.delete(tempId)) this.falling.add(peel.id);
    return true;
  }
  remove(ids) {
    const set = new Set(ids); if (!set.size) return;
    for (const [imageId, g] of this.groups) {
      const keep = g.items.filter((it) => !set.has(it.id));
      if (keep.length !== g.items.length) { g.items = keep; this.resize(g, g.cap); }
      if (!g.items.length) { this.root.remove(g.mesh); this.root.remove(g.edge); g.mesh.dispose(); g.edge.dispose(); g.mat.dispose(); g.edgeMat.dispose(); this.groups.delete(imageId); }
    }
    for (const id of set) { const e = this.peels.get(id); if (e?.landed) this.landedCount--; this.peels.delete(id); this.falling.delete(id); }
  }
  // Replay seek: born again at this time. A landed peel that should still be falling goes back in the air.
  rewind(id, born) {
    const e = this.peels.get(id); if (!e) return;
    e.born = born;
    if (e.landed && this.now() - born < e.params.dur * 1000 && this.groups.get(e.image.id)?.items.some((it) => it.id === id)) {
      e.landed = false; this.landedCount--; this.falling.add(id);
    }
  }
  clear() { this.remove([...this.peels.keys()]); }
  removeImage(imageId) { this.remove([...this.peels.values()].filter((e) => e.image.id === imageId).map((e) => e.peel.id)); }
  // Högst maxPerRoom, de äldsta först bort (som servern).
  trim() { const n = this.peels.size - PEEL.maxPerRoom; if (n > 0) this.remove([...this.peels.keys()].slice(0, n)); }
  update(now = this.now()) {
    if (!this.falling.size) return;
    for (const g of this.groups.values()) {
      let dirty = false;
      g.items.forEach((it, i) => { if (this.falling.has(it.id)) { this.place(g, it, i, now); dirty = true; } });
      if (dirty) g.mesh.instanceMatrix.needsUpdate = g.edge.instanceMatrix.needsUpdate = true;
    }
  }
  // Hur mycket av en ny golvklibba hamnar på papper? (samma räkning som servern)
  async overlap(design, { position, quaternion, size }) {
    if (!this.on || !this.peels.size) return 0;
    const [w, h] = stampDims(design, size), { u, v } = stampFrame(quaternion);
    const sticker = { x: position[0], z: position[2], w, h, u, v, mask: (await this.silhouette(design).catch(() => ({ mask: null }))).mask };
    const list = [];
    for (const e of this.peels.values()) {
      const P = e.peel; // även de som faller (servern räknar med dem)
      const s = await this.sil.get(e.image.id)?.catch(() => null);
      list.push({ x: P.x, z: P.z, w: P.w, h: P.h, yaw: P.yaw, mask: s ? s.mask : null });
    }
    return overlapFraction(sticker, list);
  }
  get count() { return this.peels.size; }
  info() {
    return { on: this.on, count: this.peels.size, landed: this.landedCount, falling: this.falling.size, groups: this.groups.size,
      drawCalls: this.groups.size * 2, peels: [...this.peels.values()].map((e) => ({ id: e.peel.id, imageId: e.image.id, x: e.peel.x, z: e.peel.z, yaw: e.peel.yaw, seed: e.peel.seed, landed: e.landed })) };
  }
  // Var är peelen just nu (för tester): position och om den har landat.
  poseOf(id) {
    const e = this.peels.get(id); if (!e) return null;
    const u = e.landed ? 1 : Math.max(0, Math.min(1, (this.now() - e.born) / (e.params.dur * 1000)));
    return { ...peelPose(e.peel, u, e.params), u, dur: e.params.dur };
  }
}
