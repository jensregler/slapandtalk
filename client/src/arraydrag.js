// Sticker arrays: the see-through ghosts of the copies while you hold the button and drag
// (slap at A, look toward B). The math (spacing, count, which copies fit on the face) is
// shared/array.mjs, the same as the server's. A ghost that sits fully inside its face is a plain
// quad (cheap, so 200 of them can follow the crosshair every frame); one near an edge is folded
// like the real sticker (fold.js). Per-item w/h (fan / trapezoid scale) come from arrayPlan.
import * as THREE from 'three';
import { foldStamp, foldGeometry } from './fold.js';
import { insideFace } from '../../shared/array.mjs';

export const GHOST_OPACITY = 0.45;

export class ArrayGhosts {
  constructor(scene, faces = null) {
    this.scene = scene; this.faces = faces;
    this.mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: GHOST_OPACITY, alphaTest: 0.02, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
    });
    this.quad = new THREE.PlaneGeometry(1, 1);
    this.pool = [];
    this.shown = 0;
  }
  setTexture(tex) { this.mat.map = tex; this.mat.needsUpdate = true; }
  mesh(k) {
    if (!this.pool[k]) {
      const m = new THREE.Mesh(this.quad, this.mat);
      m.renderOrder = 1e6 - 1; m.frustumCulled = false; m.visible = false; m.userData.key = 'quad';
      this.scene.add(m); this.pool[k] = m;
    }
    return this.pool[k];
  }
  // items: [{ position, w?, h? }]; quaternion/normal: THREE; w × h metres = fallback (anchor size); face: shared face (or null).
  show(items, quaternion, normal, w, h, surface, face) {
    items.forEach((it, k) => {
      const wi = isFinite(it.w) && it.w > 0 ? it.w : w;
      const hi = isFinite(it.h) && it.h > 0 ? it.h : h;
      const r = Math.hypot(wi, hi) / 2;
      const m = this.mesh(k);
      if (!this.faces || insideFace(face, it.position, r)) {
        if (m.userData.key !== 'quad') { m.geometry.dispose(); m.geometry = this.quad; m.userData.key = 'quad'; }
        m.position.set(...it.position).addScaledVector(normal, 0.0025);
        m.quaternion.copy(quaternion); m.scale.set(wi, hi, 1);
      } else {
        const key = [...it.position, ...quaternion.toArray(), wi, hi, surface].map((v) => (typeof v === 'number' ? v.toFixed(4) : v)).join();
        if (m.userData.key !== key) {
          if (m.userData.key !== 'quad') m.geometry.dispose();
          m.geometry = foldGeometry(foldStamp(this.faces, { center: new THREE.Vector3(...it.position), quaternion, w: wi, h: hi, surface }), 0.0025);
          m.userData.key = key;
        }
        m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1);
      }
      m.visible = !!this.mat.map;
    });
    for (let k = items.length; k < this.shown; k++) this.pool[k].visible = false;
    this.shown = items.length;
  }
  hide() { for (let k = 0; k < this.shown; k++) this.pool[k].visible = false; this.shown = 0; }
  get count() { return this.shown; }
  dispose() { for (const m of this.pool) { this.scene.remove(m); if (m.userData.key !== 'quad') m.geometry.dispose(); } this.pool = []; this.shown = 0; this.quad.dispose(); this.mat.dispose(); }
}
