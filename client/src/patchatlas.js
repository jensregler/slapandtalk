// Clothing-patch atlas: stamps composited into a per-slot canvas, sampled in the fabric
// shader via cylindrical fabPos unwrap (shared/patches.mjs patchUnwrap). One level down in
// the material — not floating decal meshes (Jens, 9 Nov 2026).
import * as THREE from 'three';
import { fabricPhase, fabricUrl, acquireFabric, releaseFabric } from './fabrics.js';
import { PATCH_SIZE_DEFAULT, PATCH_Y, patchUnwrap } from '../../shared/patches.mjs';

export const ATLAS_SIZE = 512;

function hueRotate(ctx, deg) {
  // CanvasFilter hue-rotate where supported; otherwise skip (static hue still applied via
  // a cheap approx on draw — browsers without the filter just show the unshifted stamp).
  try { ctx.filter = deg ? `hue-rotate(${deg}deg)` : 'none'; } catch { ctx.filter = 'none'; }
}

// Draw one stamp into an atlas. img = HTMLImage/canvas/ImageBitmap with the patch picture.
export function paintStamp(ctx, img, patch, W, H, tMs = Date.now()) {
  if (!img || !patch?.p) return;
  const [u, v] = patchUnwrap(patch.p, patch.slot);
  const yR = PATCH_Y[patch.slot] || PATCH_Y.shirt;
  const metersToPx = H / Math.max(1e-4, yR[1] - yR[0]);
  const s = Math.max(4, PATCH_SIZE_DEFAULT * (patch.scale || 1) * metersToPx);
  const ph = fabricPhase(patch, tMs);
  const px = u * W;
  const py = (1 - v) * H;
  // scroll slides the stamp along +U (around the body)
  const scrollPx = (ph.offset || 0) * W;
  ctx.save();
  ctx.translate(px + scrollPx, py);
  ctx.rotate((-ph.rot || 0) * Math.PI / 180);
  hueRotate(ctx, ph.hue || 0);
  try {
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
  } catch { /* decode race */ }
  ctx.filter = 'none';
  ctx.restore();
}

// Build (or update) a CanvasTexture atlas for one slot from its stamp list.
// images: Map<id, HTMLImageElement|ImageBitmap|HTMLCanvasElement>
export function buildSlotAtlas(patches, images, tMs = Date.now(), reuse = null) {
  const W = ATLAS_SIZE, H = ATLAS_SIZE;
  let canvas, tex;
  if (reuse?.image && reuse.image.width === W) {
    canvas = reuse.image; tex = reuse;
  } else {
    canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // atlas v=0 at y0: default flipY=true matches paintStamp py=(1-v)*H
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    if (reuse) reuse.dispose();
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  for (const p of patches) {
    const img = images.get(p.id);
    if (img) paintStamp(ctx, img, p, W, H, tMs);
  }
  tex.needsUpdate = true;
  return tex;
}

// Load stamp images (via fabric cache) into a Map. Caller must releaseIds when done.
export async function loadPatchImages(ids) {
  const map = new Map();
  const uniq = [...new Set(ids.filter(Boolean))];
  await Promise.all(uniq.map(async (id) => {
    const prom = acquireFabric(id);
    if (!prom) return;
    const tex = await prom;
    if (tex?.image) map.set(id, tex.image);
  }));
  return { map, release: () => { for (const id of uniq) releaseFabric(id); } };
}

export { fabricUrl, fabricPhase };
