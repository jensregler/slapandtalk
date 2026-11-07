// Slap hit confirmation + a super-discreet wind puff (Jens, Nov 2026).
// Pure Three.js overlays in the room: a short expanding ring at the hit, a soft flash on the
// surface, and a translucent air puff that drifts from the hand toward the wall along the normal.
import * as THREE from 'three';

const RING_MS = 280;
const FLASH_MS = 160;
const PUFF_MS = 420;

function discGeo(r = 1, seg = 32) {
  return new THREE.CircleGeometry(r, seg);
}

export class SlapFx {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'slap-fx';
    this.root.renderOrder = 20;
    scene.add(this.root);
    this.items = [];
    this._ringGeo = discGeo(1, 40);
    this._puffGeo = discGeo(1, 18);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._n = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._face = new THREE.Vector3(0, 0, 1); // CircleGeometry faces +Z
  }

  // point + normal = where the slap landed (world). from = optional hand/eye origin for the puff.
  burst(point, normal, from = null, now = performance.now()) {
    if (!point || !normal) return;
    const p = this._p.set(point.x ?? point[0], point.y ?? point[1], point.z ?? point[2]);
    const n = this._n.set(normal.x ?? normal[0], normal.y ?? normal[1], normal.z ?? normal[2]).normalize();
    if (n.lengthSq() < 1e-8) n.set(0, 0, 1);

    // Orient a disc to sit on the surface (facing along the normal).
    this._q.setFromUnitVectors(this._face, n);

    // Impact ring (thin, expands, fades).
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xfff2a8, transparent: true, opacity: 0.85, depth: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(this._ringGeo, ringMat);
    ring.position.copy(p).addScaledVector(n, 0.012);
    ring.quaternion.copy(this._q);
    ring.scale.setScalar(0.04);
    ring.renderOrder = 21;
    this.root.add(ring);
    this.items.push({ kind: 'ring', mesh: ring, t0: now, ms: RING_MS });

    // Soft flash disc (fills briefly under the ring).
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffe28a, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const flash = new THREE.Mesh(this._ringGeo, flashMat);
    flash.position.copy(p).addScaledVector(n, 0.008);
    flash.quaternion.copy(this._q);
    flash.scale.setScalar(0.08);
    flash.renderOrder = 20;
    this.root.add(flash);
    this.items.push({ kind: 'flash', mesh: flash, t0: now, ms: FLASH_MS });

    // Wind puff: starts a little off the wall toward the slapper, drifts into the wall, fades.
    const hand = from
      ? new THREE.Vector3(from.x ?? from[0], from.y ?? from[1], from.z ?? from[2])
      : p.clone().addScaledVector(n, 0.35);
    const start = hand.clone().lerp(p, 0.55).addScaledVector(n, 0.18);
    const puffMat = new THREE.MeshBasicMaterial({
      color: 0xdde8ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
      depthWrite: false,
    });
    const puff = new THREE.Mesh(this._puffGeo, puffMat);
    puff.position.copy(start);
    puff.quaternion.copy(this._q);
    puff.scale.setScalar(0.05);
    puff.renderOrder = 22;
    this.root.add(puff);
    this.items.push({
      kind: 'puff', mesh: puff, t0: now, ms: PUFF_MS,
      start: start.clone(), end: p.clone().addScaledVector(n, 0.02),
    });
  }

  update(now = performance.now()) {
    if (!this.items.length) return;
    const keep = [];
    for (const it of this.items) {
      const u = (now - it.t0) / it.ms;
      if (u >= 1) {
        this.root.remove(it.mesh);
        it.mesh.material.dispose();
        continue;
      }
      if (it.kind === 'ring') {
        const s = 0.04 + u * 0.42;
        it.mesh.scale.setScalar(s);
        it.mesh.material.opacity = 0.85 * (1 - u) * (1 - u);
      } else if (it.kind === 'flash') {
        const s = 0.08 + u * 0.18;
        it.mesh.scale.setScalar(s);
        it.mesh.material.opacity = 0.35 * (1 - u);
      } else if (it.kind === 'puff') {
        const e = u * u * (3 - 2 * u);
        it.mesh.position.lerpVectors(it.start, it.end, e);
        it.mesh.scale.setScalar(0.05 + e * 0.22);
        it.mesh.material.opacity = 0.18 * (1 - u) * (1 - 0.4 * e);
      }
      keep.push(it);
    }
    this.items = keep;
  }

  clear() {
    for (const it of this.items) { this.root.remove(it.mesh); it.mesh.material.dispose(); }
    this.items = [];
  }

  get count() { return this.items.length; }
}
