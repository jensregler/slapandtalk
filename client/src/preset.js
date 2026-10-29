// Preset rooms (Jens, 29 Oct 2026; the server side is server/presets.js).
//
// PresetLayer: a preset room's six baked images (floor, ceiling, four walls), each laid over its
// surface as a thin, lit, transparent sheet – drawn after the wall and before every sticker, so the
// stickers people slap still land on top. They are not stickers: nothing can pick, peel or change
// them (they are not in the raycast surfaces, nor in the stamp layer).
//
// bakeFaces (admin): renders the room's stickers – only the stickers, unlit (their own colours, the
// light comes back when the sheet is lit in the preset room) – one surface at a time with an
// orthographic camera that looks straight at it, into six PNGs. Transparent where there is no sticker.
import * as THREE from 'three';

export const FACE_OF = { golv: 'floor', tak: 'ceiling', 'vägg-norr': 'north', 'vägg-söder': 'south', 'vägg-väster': 'west', 'vägg-öster': 'east' };
export const PRESET_PX_PER_M = 160; // bake resolution: walls 1600×640, floor/ceiling 1600×1600 (10 × 4 × 10 m)
const SHEET_LIFT = 0.0008; // m off the surface (the stickers sit at ~1.5–3 mm)

const planeOf = (s) => {
  const p = s.geometry && s.geometry.parameters;
  return p && p.width && p.height ? { w: p.width, h: p.height } : null;
};
const normalOf = (s) => new THREE.Vector3(0, 0, 1).applyQuaternion(s.getWorldQuaternion(new THREE.Quaternion()));

export class PresetLayer {
  constructor(scene, surfaces) {
    this.scene = scene; this.surfaces = surfaces; this.group = new THREE.Group(); this.group.name = 'preset';
    scene.add(this.group); this.id = null; this.loaded = 0; this.key = '';
  }
  async set(preset) {
    const key = preset && preset.faces ? JSON.stringify(preset.faces) : '';
    if (key === this.key) return this.loaded;
    this.key = key; this.clear(); if (!key) return 0;
    this.id = preset.id;
    const loader = new THREE.TextureLoader();
    const jobs = this.surfaces.map(async (s) => {
      const face = FACE_OF[s.name], url = face && preset.faces[face], dims = planeOf(s);
      if (!url || !dims) return 0;
      let tex;
      try { tex = await loader.loadAsync(url); } catch { return 0; }
      if (this.key !== key) { tex.dispose(); return 0; }
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(dims.w, dims.h), new THREE.MeshStandardMaterial({
        map: tex, transparent: true, alphaTest: 0.02, depthWrite: false, roughness: 0.75,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      m.name = `preset-${face}`; m.userData.presetFace = face;
      m.position.copy(s.getWorldPosition(new THREE.Vector3())).addScaledVector(normalOf(s), SHEET_LIFT);
      m.quaternion.copy(s.getWorldQuaternion(new THREE.Quaternion()));
      m.renderOrder = 5; // after the walls, before the stickers (10 + their number)
      m.raycast = () => {}; // never in the way of aiming or picking
      this.group.add(m);
      return 1;
    });
    this.loaded = (await Promise.all(jobs)).reduce((a, b) => a + b, 0);
    return this.loaded;
  }
  clear() {
    for (const m of [...this.group.children]) { this.group.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); }
    this.id = null; this.loaded = 0;
  }
  info() { return { id: this.id, faces: this.group.children.map((m) => m.userData.presetFace).sort(), loaded: this.loaded }; }
}

// The stickers of the scene (live meshes and the merged "painted-in" chunks, stamps.js), each as an
// unlit copy (same geometry, same texture / texture array, same draw order) in a scene of their own.
function stickerScene(scene) {
  const bake = new THREE.Scene(), made = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !(o.userData && (o.userData.stamp || o.userData.bakedChunk))) return;
    if (String(o.userData.stamp?.id || '').startsWith('tmp-')) return;
    const src = o.material;
    const mat = new THREE.MeshBasicMaterial({ map: src.map || null, transparent: true, alphaTest: 0.02, depthWrite: false, depthTest: false, side: src.side });
    if (o.userData.bakedChunk) { mat.onBeforeCompile = src.onBeforeCompile; mat.customProgramCacheKey = () => 'klibb-baked-stamps-unlit'; }
    const c = new THREE.Mesh(o.geometry, mat);
    o.updateWorldMatrix(true, false);
    c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); c.renderOrder = o.renderOrder;
    bake.add(c); made.push(mat);
  });
  return { bake, dispose: () => made.forEach((m) => m.dispose()), count: made.length };
}

const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// → { faces: { floor: Blob(png), … }, count } . pxPerM: pixels per metre (capped at 4096 px a side).
export async function bakeFaces(renderer, scene, surfaces, { pxPerM = PRESET_PX_PER_M } = {}) {
  const { bake, dispose, count } = stickerScene(scene);
  const gl = renderer.getContext();
  const float = renderer.capabilities.isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
  const prev = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
  const faces = {};
  try {
    for (const s of surfaces) {
      const face = FACE_OF[s.name], dims = planeOf(s);
      if (!face || !dims) continue;
      const W = Math.min(4096, Math.round(dims.w * pxPerM)), H = Math.min(4096, Math.round(dims.h * pxPerM));
      const rt = new THREE.WebGLRenderTarget(W, H, { type: float ? THREE.FloatType : THREE.UnsignedByteType, depthBuffer: false, samples: 0 });
      const n = normalOf(s), c = s.getWorldPosition(new THREE.Vector3());
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.getWorldQuaternion(new THREE.Quaternion()));
      const cam = new THREE.OrthographicCamera(-dims.w / 2, dims.w / 2, dims.h / 2, -dims.h / 2, 0.001, 0.1);
      cam.position.copy(c).addScaledVector(n, 0.05); cam.up.copy(up); cam.lookAt(c); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, true);
      renderer.render(bake, cam);
      const px = float ? new Float32Array(W * H * 4) : new Uint8Array(W * H * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
      rt.dispose();
      const k = float ? 1 : 1 / 255;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data;
      for (let y = 0; y < H; y++) {
        const src = (H - 1 - y) * W * 4, dst = y * W * 4; // GL rows are bottom-up
        for (let x = 0; x < W * 4; x += 4) {
          const a = Math.min(1, px[src + x + 3] * k);
          if (a <= 0.002) { d[dst + x + 3] = 0; continue; }
          for (let ch = 0; ch < 3; ch++) d[dst + x + ch] = Math.round(255 * Math.min(1, toSrgb(Math.min(1, (px[src + x + ch] * k) / a))));
          d[dst + x + 3] = Math.round(a * 255);
        }
      }
      g.putImageData(img, 0, 0);
      faces[face] = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    }
  } finally {
    renderer.setRenderTarget(prev.target); renderer.setClearColor(prev.color, prev.alpha); dispose();
  }
  return { faces, count };
}
