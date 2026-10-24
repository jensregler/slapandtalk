// Stämplarna: varje klibba är en "decal", en bild som projiceras på en yta
// (vägg, golv eller tak), ungefär som en diaprojektor som lyser rakt på väggen.
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { facesFromSurfaces, foldStamp, foldGeometry } from './fold.js';

const loader = new THREE.TextureLoader();
const DEPTH = 0.25; // hur "djup" projektionen är (meter)

export class StampLayer {
  constructor(scene, surfaces) {
    this.scene = scene;
    this.surfaces = surfaces;
    // Rektangulära ytor (lådrummet) -> klibbor viks över kanter och hörn.
    // Annars (t.ex. ett rum från Blender) används den gamla projektionen.
    this.faces = facesFromSurfaces(surfaces);
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

  // Geometrin för en stämpel. Fungerar för gamla sparade stämplar också:
  // allt som behövs (position, quaternion, size, surface) har alltid sparats.
  geometry(stamp, image) {
    const pos = new THREE.Vector3(...stamp.position);
    const quat = new THREE.Quaternion(...stamp.quaternion);
    const [w, h] = StampLayer.dims(image, stamp.size);
    if (this.faces) {
      const pieces = foldStamp(this.faces, { center: pos, quaternion: quat, w, h, surface: stamp.surface });
      return pieces.length ? foldGeometry(pieces) : null;
    }
    const euler = new THREE.Euler().setFromQuaternion(quat);
    const targets = this.findSurface(stamp) ? [this.findSurface(stamp)] : this.surfaces;
    for (const surf of targets) {
      const g = new DecalGeometry(surf, pos, euler, new THREE.Vector3(w, h, DEPTH));
      if (g.attributes.position.count > 0) return g;
      g.dispose();
    }
    return null;
  }

  async add(stamp, image) {
    if (this.meshes.has(stamp.id) || !image) return;
    let mat;
    try { mat = await this.material(image); } catch {
      // Bilden gick inte att hämta (borta från servern): hoppa över stämpeln i stället
      // för att låta den förstöra resten av rummet.
      this.textures.delete(image.id);
      return;
    }
    const geom = this.geometry(stamp, image);
    if (!geom) return;
    if (this.meshes.has(stamp.id)) { geom.dispose(); return; }
    const mesh = new THREE.Mesh(geom, mat);
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
    if (m.userData.ownMaterial) m.material.dispose();
    this.meshes.delete(stampId);
  }

  // Peel: klibban tonar bort och krymper lite (200 ms) och tas sedan bort.
  peelAway(stampId, ms = 200) {
    const m = this.meshes.get(stampId);
    if (!m) return Promise.resolve();
    this.meshes.delete(stampId); // syns inte längre i räkning/val
    const base = m.material;
    m.material = base.clone(); m.userData.ownMaterial = true;
    m.geometry.computeBoundingSphere();
    const c = m.geometry.boundingSphere.center.clone();
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        m.material.opacity = 1 - k;
        const s = 1 - 0.25 * k; // krymp mot mitten
        m.scale.setScalar(s); m.position.copy(c).multiplyScalar(1 - s);
        if (k < 1) requestAnimationFrame(step);
        else { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  // Markera en stämpel (t.ex. när man pekar på den i historiken).
  highlight(stampId, on) {
    const m = this.meshes.get(stampId);
    if (!m) return;
    if (on && !m.userData.hl) {
      m.userData.hl = m.material;
      m.material = m.material.clone();
      m.material.emissive = new THREE.Color(0x665500); m.material.color = new THREE.Color(1, 1, 0.55);
      m.renderOrder += 1e5;
    } else if (!on && m.userData.hl) {
      m.material.dispose(); m.material = m.userData.hl; m.userData.hl = null; m.renderOrder -= 1e5;
    }
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
// Den viks på samma sätt som den riktiga klibban, så man ser hur den hamnar i hörn.
export class StampPreview {
  constructor(scene, faces = null) {
    this.faces = faces;
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 1e6;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.key = '';
    scene.add(this.mesh);
  }
  setTexture(tex) { this.mat.map = tex; this.mat.needsUpdate = true; }
  show(point, normal, quaternion, w, h, surface) {
    this.mesh.visible = !!this.mat.map;
    if (!this.faces) {
      if (this.key !== 'plane') { this.mesh.geometry.dispose(); this.mesh.geometry = new THREE.PlaneGeometry(1, 1); this.key = 'plane'; }
      this.mesh.position.copy(point).addScaledVector(normal, 0.003);
      this.mesh.quaternion.copy(quaternion);
      this.mesh.scale.set(w, h, 1);
      return;
    }
    // Bygg bara om geometrin när något har ändrats.
    const key = [...point.toArray(), ...quaternion.toArray(), w, h, surface].map((v) => (typeof v === 'number' ? v.toFixed(4) : v)).join();
    if (key === this.key) return;
    this.key = key;
    const pieces = foldStamp(this.faces, { center: point, quaternion, w, h, surface });
    this.mesh.geometry.dispose();
    this.mesh.geometry = foldGeometry(pieces, 0.0015);
  }
  hide() { this.mesh.visible = false; }
}
