// Sticker arrays: the see-through ghosts of the copies while you hold the button and drag
// (slap at A, look toward B). The math (spacing, count, the fold round seams onto the next face) is
// shared/array.mjs, the same as the server's. A ghost that sits fully inside its face is a plain
// quad (cheap, so 200 of them can follow the crosshair every frame); one near an edge is folded
// like the real sticker (fold.js).
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
  // items: [{ position: [x, y, z], q?, n?, surface?, face? }]; quaternion/normal: THREE; w × h
  // metres; face: shared face (or null). A copy folded over a seam onto another face brings its own
  // q (THREE.Quaternion), n (THREE.Vector3), surface and face.
  show(items, quaternion0, normal0, w, h, surface0, face0) {
    const r = Math.hypot(w, h) / 2;
    items.forEach((it, k) => {
      const quaternion = it.q || quaternion0, normal = it.n || normal0, surface = it.surface || surface0, face = it.surface ? it.face : face0;
      const m = this.mesh(k);
      if (!this.faces || insideFace(face, it.position, r)) {
        if (m.userData.key !== 'quad') { m.geometry.dispose(); m.geometry = this.quad; m.userData.key = 'quad'; }
        m.position.set(...it.position).addScaledVector(normal, 0.0025);
        m.quaternion.copy(quaternion); m.scale.set(w, h, 1);
      } else {
        const key = [...it.position, ...quaternion.toArray(), w, h, surface].map((v) => (typeof v === 'number' ? v.toFixed(4) : v)).join();
        if (m.userData.key !== key) {
          if (m.userData.key !== 'quad') m.geometry.dispose();
          m.geometry = foldGeometry(foldStamp(this.faces, { center: new THREE.Vector3(...it.position), quaternion, w, h, surface }), 0.0025);
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
}
