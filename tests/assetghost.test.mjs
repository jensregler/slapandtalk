// Asset / sticker placement ghosts must draw in front of city surface-texture sheets
// (Jens t947u, 15 Nov 2026). Run: node tests/assetghost.test.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyAssetGhostStyle, ASSET_GHOST_RENDER_ORDER, ASSET_GHOST_OPACITY, ASSET_ROW_GHOST_OPACITY,
} from '../client/src/assetghost.js';
import { RENDER_ORDER as SURFACE_TEX_RENDER_ORDER } from '../client/src/surfacetex.js';
import { StampPreview } from '../client/src/stamps.js';
import { ArrayGhosts } from '../client/src/arraydrag.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

function dumpsterLike() {
  // A group with child meshes, like a loaded asset: the root itself is not a mesh.
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.1, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x2f4a2f, depthWrite: true }),
  );
  body.position.y = 0.55;
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 0.12, 0.92),
    [new THREE.MeshStandardMaterial({ color: 0x3a5a3a }), new THREE.MeshStandardMaterial({ color: 0x1a2a1a })],
  );
  lid.position.y = 1.16;
  const ink = new THREE.Mesh(new THREE.BoxGeometry(1.64, 1.14, 0.94), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  ink.userData.ink = true;
  ink.position.y = 0.55;
  root.add(body, lid, ink);
  return { root, body, lid, ink };
}

ok('surface-texture sheets stay below placement ghosts', () => {
  assert.equal(SURFACE_TEX_RENDER_ORDER, 8);
  assert.ok(ASSET_GHOST_RENDER_ORDER > SURFACE_TEX_RENDER_ORDER);
  assert.ok(ASSET_GHOST_RENDER_ORDER > 10 + 10000, 'also after a very late live sticker (10 + order)');
});

ok('applyAssetGhostStyle sets every child mesh, not just the parent group', () => {
  const { root, body, lid, ink } = dumpsterLike();
  assert.equal(body.renderOrder, 0, 'meshes start at the default (the bug: only the group was set to 50)');
  applyAssetGhostStyle(root, ASSET_GHOST_OPACITY);
  assert.equal(root.renderOrder, ASSET_GHOST_RENDER_ORDER);
  assert.equal(body.renderOrder, ASSET_GHOST_RENDER_ORDER);
  assert.equal(lid.renderOrder, ASSET_GHOST_RENDER_ORDER);
  assert.equal(ink.renderOrder, ASSET_GHOST_RENDER_ORDER);
  assert.equal(body.material.opacity, ASSET_GHOST_OPACITY);
  assert.equal(body.material.transparent, true);
  assert.equal(body.material.depthWrite, false);
  assert.equal(body.material.depthTest, true);
  assert.equal(lid.material[0].opacity, ASSET_GHOST_OPACITY);
  assert.equal(lid.material[1].depthWrite, false);
  assert.equal(lid.material[1].depthTest, true);
  // outline strokes keep their own material, but still draw with the ghost
  assert.notEqual(ink.material.opacity, ASSET_GHOST_OPACITY);
  assert.equal(typeof body.raycast, 'function');
  body.raycast(); // no-op, so the preview is not clickable
});

ok('nested groups like makeProp() also get the high renderOrder (three.js groupOrder)', () => {
  const inner = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x228822 }));
  inner.add(mesh);
  const root = new THREE.Group();
  root.add(inner);
  applyAssetGhostStyle(root, ASSET_GHOST_OPACITY);
  assert.equal(root.renderOrder, ASSET_GHOST_RENDER_ORDER);
  assert.equal(inner.renderOrder, ASSET_GHOST_RENDER_ORDER);
  assert.equal(mesh.renderOrder, ASSET_GHOST_RENDER_ORDER);
});

ok('row copies use the same order and a slightly clearer opacity', () => {
  const { root, body } = dumpsterLike();
  applyAssetGhostStyle(root, ASSET_ROW_GHOST_OPACITY);
  const clone = root.clone();
  assert.equal(clone.renderOrder, ASSET_GHOST_RENDER_ORDER);
  let child = null;
  clone.traverse((m) => { if (!child && m.isMesh && !m.userData.ink) child = m; });
  assert.equal(child.renderOrder, ASSET_GHOST_RENDER_ORDER);
  assert.equal(child.material.opacity, ASSET_ROW_GHOST_OPACITY);
  assert.equal(child.material.depthWrite, false);
  assert.equal(body.material.opacity, ASSET_ROW_GHOST_OPACITY);
});

ok('sticker preview and array ghosts already draw after surface textures', () => {
  const scene = new THREE.Scene();
  const prev = new StampPreview(scene);
  assert.equal(prev.mesh.renderOrder, 1e6);
  assert.ok(prev.mesh.renderOrder > SURFACE_TEX_RENDER_ORDER);
  assert.equal(prev.mat.depthWrite, false);
  assert.equal(prev.shadow.renderOrder, 1e6 - 1);
  assert.ok(prev.shadow.renderOrder > SURFACE_TEX_RENDER_ORDER);
  const ghosts = new ArrayGhosts(scene);
  const m = ghosts.mesh(0);
  assert.equal(m.renderOrder, 1e6 - 1);
  assert.ok(m.renderOrder > SURFACE_TEX_RENDER_ORDER);
  assert.equal(ghosts.mat.depthWrite, false);
  prev.hide(); ghosts.dispose();
});

console.log(`\nassetghost: ${n} ok`);
