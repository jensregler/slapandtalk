// Stämplarna: varje klibba är en "decal", en bild som projiceras på en yta
// (vägg, golv eller tak), ungefär som en diaprojektor som lyser rakt på väggen.
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

const loader = new THREE.TextureLoader();
const DEPTH = 0.25; // hur "djup" projektionen är (meter)

export class StampLayer {
  constructor(scene, surfaces) {
    this.scene = scene;
    this.surfaces = surfaces;
    this.textures = new Map(); // imageId -> Promise<Texture>
    this.materials = new Map(); // imageId -> Material
    this.meshes = new Map(); // stampId -> Mesh
  }

  texture(image) {
    if (!this.textures.has(image.id)) {
      this.textures.set(image.id, loader.loadAsync(image.url).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        return t;
      }));
    }
    return this.textures.get(image.id);
  }

  async material(image) {
    if (!this.materials.has(image.id)) {
      const map = await this.texture(image);
      // depthWrite:false + polygonOffset: klibban ritas en aning "framför" väggen
      // utan att flimra. renderOrder (= stämpelns nummer) avgör vilken som hamnar överst.
      this.materials.set(image.id, new THREE.MeshStandardMaterial({
        map, transparent: true, depthWrite: false, depthTest: true, alphaTest: 0.02,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.75,
      }));
    }
    return this.materials.get(image.id);
  }

  // Räknar ut hur klibban ska vändas: rakt ut från ytan, och med "uppåt" uppåt.
  // På golv och tak är "uppåt" den riktning du tittar åt, så den blir rättvänd för dig.
  static orientation(normal, viewDir, rotationDeg) {
    const z = normal.clone().normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(z.y) > 0.9) {
      up = viewDir.clone().setY(0);
      if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
      up.normalize();
      if (z.y < 0) up.negate(); // i taket: toppen mot dig
    }
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-rotationDeg));
    return q.multiply(spin);
  }

  static dims(image, size) {
    const a = (image.width || 1) / (image.height || 1);
    return a >= 1 ? [size, size / a] : [size * a, size];
  }

  findSurface(stamp) {
    return this.surfaces.find((s) => s.name === stamp.surface) || null;
  }

  async add(stamp, image) {
    if (this.meshes.has(stamp.id)) return;
    const mat = await this.material(image);
    const pos = new THREE.Vector3(...stamp.position);
    const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...stamp.quaternion));
    const [w, h] = StampLayer.dims(image, stamp.size);
    const targets = this.findSurface(stamp) ? [this.findSurface(stamp)] : this.surfaces;
    const geoms = [];
    for (const surf of targets) {
      const g = new DecalGeometry(surf, pos, euler, new THREE.Vector3(w, h, DEPTH));
      if (g.attributes.position.count > 0) geoms.push(g); else g.dispose();
    }
    if (!geoms.length) return;
    const mesh = new THREE.Mesh(geoms[0], mat);
    mesh.renderOrder = 10 + stamp.order;
    mesh.userData = { stamp, image };
    this.scene.add(mesh);
    this.meshes.set(stamp.id, mesh);
  }

  remove(stampId) {
    const m = this.meshes.get(stampId);
    if (!m) return;
    this.scene.remove(m);
    m.geometry.dispose();
    this.meshes.delete(stampId);
  }

  removeImage(imageId) {
    for (const [id, m] of this.meshes) if (m.userData.image.id === imageId) this.remove(id);
  }

  // Vilken stämpel träffar strålen? Den översta (högst nummer) om flera ligger på samma ställe.
  pick(raycaster) {
    const hits = raycaster.intersectObjects([...this.meshes.values()], false);
    if (!hits.length) return null;
    const near = hits.filter((h) => h.distance - hits[0].distance < 0.02);
    near.sort((a, b) => b.object.userData.stamp.order - a.object.userData.stamp.order);
    return near[0].object.userData;
  }

  get count() { return this.meshes.size; }
}

// En genomskinlig förhandsvisning som följer siktet (bara på dator).
export class StampPreview {
  constructor(scene) {
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 1e6;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  setTexture(tex) { this.mat.map = tex; this.mat.needsUpdate = true; }
  show(point, normal, quaternion, w, h) {
    this.mesh.position.copy(point).addScaledVector(normal, 0.003);
    this.mesh.quaternion.copy(quaternion);
    this.mesh.scale.set(w, h, 1);
    this.mesh.visible = !!this.mat.map;
  }
  hide() { this.mesh.visible = false; }
}
