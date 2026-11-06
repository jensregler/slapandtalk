// Fold math (client/src/fold.js): facesFromSurfaces neighbor discovery, incl. the city case where a
// house wall sits on the large ground plane without sharing the ground's corner vertices.
// Run: node tests/fold.test.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { facesFromSurfaces, pointOnFace, edgeOnFace, foldStamp } from '../client/src/fold.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

function plane(name, w, h, pos, rot) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial());
  m.name = name; m.position.set(...pos); m.rotation.set(...rot); m.updateMatrixWorld();
  return m;
}

ok('pointOnFace / edgeOnFace: on the plane and inside the rect', () => {
  const faces = facesFromSurfaces([plane('golv', 10, 10, [0, 0, 0], [-Math.PI / 2, 0, 0])]);
  assert.ok(faces && faces.length === 1);
  const G = faces[0];
  assert.equal(pointOnFace(G, new THREE.Vector3(1, 0, 1)), true);
  assert.equal(pointOnFace(G, new THREE.Vector3(1, 0.05, 1)), false); // above
  assert.equal(pointOnFace(G, new THREE.Vector3(6, 0, 0)), false); // outside
  assert.equal(edgeOnFace(G, new THREE.Vector3(-1, 0, -2), new THREE.Vector3(1, 0, -2)), true);
});

ok('room box: walls share corner vertices with floor and each other (classic)', () => {
  const W = 4, H = 3, D = 4;
  const surfs = [
    plane('golv', W, D, [0, 0, 0], [-Math.PI / 2, 0, 0]),
    plane('vägg-norr', W, H, [0, H / 2, -D / 2], [0, 0, 0]),
    plane('vägg-öster', D, H, [W / 2, H / 2, 0], [0, -Math.PI / 2, 0]),
  ];
  const faces = facesFromSurfaces(surfs);
  const by = Object.fromEntries(faces.map((f) => [f.name, f]));
  assert.ok(by['vägg-norr'].neighbors.some((n) => n.face.name === 'golv'));
  assert.ok(by['golv'].neighbors.some((n) => n.face.name === 'vägg-norr'));
  assert.ok(by['vägg-norr'].neighbors.some((n) => n.face.name === 'vägg-öster'));
});

ok('city: house wall on large ground – wall↔ground neighbors even without shared corners', () => {
  // Ground 96×96; a small south-facing wall at z=+2, y from 0..3, x -1.5..1.5 (like a house face).
  const surfs = [
    plane('golv', 96, 96, [0, 0, 0], [-Math.PI / 2, 0, 0]),
    plane('h1-s', 3, 3, [0, 1.5, 2], [0, 0, 0]),
    plane('h1-e', 4, 3, [1.5, 1.5, 0], [0, Math.PI / 2, 0]),
  ];
  const faces = facesFromSurfaces(surfs);
  const by = Object.fromEntries(faces.map((f) => [f.name, f]));
  assert.ok(by['h1-s'].neighbors.some((n) => n.face.name === 'golv'), 'south wall → ground');
  assert.ok(by['golv'].neighbors.some((n) => n.face.name === 'h1-s'), 'ground → south wall');
  assert.ok(by['h1-s'].neighbors.some((n) => n.face.name === 'h1-e'), 'south ↔ east (outside corner)');
  assert.ok(by['h1-e'].neighbors.some((n) => n.face.name === 'golv'), 'east wall → ground');
});

ok('foldStamp at wall base: pieces on wall AND ground (no rigid poke-through)', () => {
  const surfs = [
    plane('golv', 96, 96, [0, 0, 0], [-Math.PI / 2, 0, 0]),
    plane('h1-s', 3, 3, [0, 1.5, 2], [0, 0, 0]),
  ];
  const faces = facesFromSurfaces(surfs);
  // Sticker centred just above the ground on the south wall, tall enough to overhang onto the floor.
  const center = new THREE.Vector3(0, 0.15, 2);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1));
  const pieces = foldStamp(faces, { center, quaternion: q, w: 0.4, h: 0.5, surface: 'h1-s' });
  const names = new Set(pieces.map((p) => p.face));
  assert.ok(names.has('h1-s'), 'keeps a piece on the wall');
  assert.ok(names.has('golv'), `folds onto the ground (got ${[...names]})`);
  assert.ok(pieces.every((p) => p.points.length >= 3));
});

ok('foldStamp at outside wall corner: pieces on both walls', () => {
  const surfs = [
    plane('h1-s', 3, 3, [0, 1.5, 2], [0, 0, 0]),
    plane('h1-e', 4, 3, [1.5, 1.5, 0], [0, Math.PI / 2, 0]),
  ];
  const faces = facesFromSurfaces(surfs);
  const center = new THREE.Vector3(1.4, 1.5, 2); // near the SE vertical edge on the south wall
  const q = new THREE.Quaternion();
  const pieces = foldStamp(faces, { center, quaternion: q, w: 0.4, h: 0.4, surface: 'h1-s' });
  const names = new Set(pieces.map((p) => p.face));
  assert.ok(names.has('h1-s') && names.has('h1-e'), `wall↔wall fold (got ${[...names]})`);
});


ok('city: sticker fully on wall does NOT ghost-copy onto ground', () => {
  const surfs = [
    plane('golv', 96, 96, [0, 0, 0], [-Math.PI / 2, 0, 0]),
    plane('h1-s', 16, 8, [0, 4, -24], [0, 0, 0]),
  ];
  const faces = facesFromSurfaces(surfs);
  const q = new THREE.Quaternion(); // facing +Z
  const pieces = foldStamp(faces, { center: new THREE.Vector3(0, 4, -24), quaternion: q, w: 2, h: 2, surface: 'h1-s' });
  const names = pieces.map((p) => p.face);
  assert.deepEqual(names, ['h1-s'], `only wall, got ${names}`);
});

ok('city: overhang at wall base folds OUTSIDE the building, not under it', () => {
  const surfs = [
    plane('golv', 96, 96, [0, 0, 0], [-Math.PI / 2, 0, 0]),
    plane('h1-s', 16, 8, [0, 4, -24], [0, 0, 0]), // normal +Z, outside is z > -24
  ];
  const faces = facesFromSurfaces(surfs);
  const q = new THREE.Quaternion();
  const pieces = foldStamp(faces, { center: new THREE.Vector3(0, 0.2, -24), quaternion: q, w: 1, h: 1, surface: 'h1-s' });
  const names = new Set(pieces.map((p) => p.face));
  assert.ok(names.has('h1-s') && names.has('golv'), `wall+ground got ${[...names]}`);
  const gp = pieces.find((p) => p.face === 'golv');
  const mid = gp.points.reduce((a, v) => a.add(v.clone()), new THREE.Vector3()).multiplyScalar(1 / gp.points.length);
  assert.ok(mid.z > -24 + 1e-3, `ground piece must be outside (z>-24), got z=${mid.z}`);
  assert.ok(gp.points.every((p) => p.z > -24 - 1e-3), 'no ground vertex under the house');
});

ok('city: hall wall prefers roof over coplanar city sky; no sky float from mid-wall sticker', () => {
  const surfs = [
    plane('tak', 96, 96, [0, 24, 0], [Math.PI / 2, 0, 0]),       // city sky
    plane('hall-s', 16, 24, [0, 12, 8], [0, 0, 0]),                 // Town Hall south
    plane('hall-roof', 16, 16, [0, 24, 0], [-Math.PI / 2, 0, 0]),   // coplanar with sky
  ];
  const faces = facesFromSurfaces(surfs);
  const by = Object.fromEntries(faces.map((f) => [f.name, f]));
  assert.ok(!by['tak'].neighbors.some((n) => n.face.name === 'hall-roof'), 'sky ↔ hall-roof must not link (coplanar)');
  assert.ok(by['hall-s'].neighbors.some((n) => n.face.name === 'hall-roof'), 'hall wall → roof');
  assert.ok(!by['hall-s'].neighbors.some((n) => n.face.name === 'tak'), 'hall wall must not prefer city sky over roof');
  const q = new THREE.Quaternion();
  const pieces = foldStamp(faces, { center: new THREE.Vector3(0, 12, 8), quaternion: q, w: 4, h: 4, surface: 'hall-s' });
  assert.ok(!pieces.some((p) => p.face === 'tak'), `no floating sky piece, got ${pieces.map((p) => p.face)}`);
  assert.ok(pieces.some((p) => p.face === 'hall-s'));
});

console.log(`\nfold: ${n} passed`);
