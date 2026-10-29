// Unit: the avatar's own face (Jens, 29 Oct 2026) – the face triangles on the real model, the face
// colour and the face fabric/photo in the look (browser rules = server rules), and the photo mapping.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { FACE, isFaceTriangle, effectiveFabrics, faceColour, facePhotoUv } from '../client/src/face.js';
import { cleanFabrics, FABRIC } from '../shared/fabric.mjs';
const require = createRequire(import.meta.url);
const { cleanLook } = require('../server/realtime.js');
const AV = JSON.parse(fs.readFileSync(new URL('../shared/avatar.json', import.meta.url)));

let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const ID = 'a1b2c3d4e5f60718';

await ok('face is a fabric slot, photo a fabric flag (browser and server read the same json)', () => {
  assert.ok(FABRIC.slots.includes('face')); assert.ok(FABRIC.flags.includes('photo'));
});
await ok('the look: face colour (any #rrggbb) kept by the server, junk dropped, absent = follows the skin', () => {
  assert.equal(cleanLook({ face: '#7CFF4F' }).face, '#7cff4f');
  assert.equal(cleanLook({ face: '#12345' }).face, undefined);
  assert.equal(cleanLook({ face: 'red' }).face, undefined);
  assert.equal(cleanLook({}).face, undefined);
  assert.equal(faceColour({ skin: '#e0ac69' }), '#e0ac69'); assert.equal(faceColour({ skin: '#e0ac69', face: '#00d1ff' }), '#00d1ff');
});
await ok('face fabric / face photo: cleaned the same in the browser and on the server', () => {
  const raw = { face: { id: ID, scale: 1.3, rot: 10, photo: true }, shirt: { id: ID, photo: 'yes' } };
  const c = cleanFabrics(raw);
  assert.equal(c.face.photo, true); assert.equal(c.shirt.photo, false); assert.equal(c.face.scale, 1.3);
  assert.deepEqual(cleanLook({ fabric: raw }).fabric, c);
});
await ok('entitlements: a free player\'s face fabric/photo is dropped like the top\'s (the face colour stays)', () => {
  const l = cleanLook({ face: '#ff70a6', fabric: { face: { id: ID, photo: true }, shirt: { id: ID } } }, { fabrics: false, soundDesign: false });
  assert.equal(l.fabric, undefined); assert.equal(l.face, '#ff70a6');
});
await ok('effectiveFabrics: the face follows the skin fabric until it has its own colour or fabric', () => {
  const skin = { id: ID, scale: 1, photo: false };
  assert.deepEqual(effectiveFabrics({ fabric: { skin } }).face, skin);
  assert.equal(effectiveFabrics({ face: '#ffffff', fabric: { skin } }).face, undefined);
  const own = { id: 'ffffffffffffffff', photo: true };
  assert.equal(effectiveFabrics({ fabric: { skin, face: own } }).face, own);
  assert.equal(effectiveFabrics({ fabric: { skin: { ...skin, photo: true } } }).skin.photo, false); // photo only on the face
});
await ok('face photo mapping: centre of the square = face centre; the eyes ~42 % from the top; zoom and tilt', () => {
  assert.deepEqual(facePhotoUv(FACE.cx, FACE.cy), [0.5, 0.5]);
  const eyes = facePhotoUv(FACE.cx, 1.655); assert.ok(Math.abs((1 - eyes[1]) - 0.42) < 0.02, eyes);
  const z = facePhotoUv(FACE.cx + 0.05, FACE.cy, 2); assert.ok(Math.abs(z[0] - (0.5 + 0.05 / (FACE.size * 2))) < 1e-9);
  const t = facePhotoUv(FACE.cx + 0.05, FACE.cy, 1, 90); assert.ok(Math.abs(t[0] - 0.5) < 1e-9 && t[1] > 0.5, t);
});
await ok('the real model: every head gets face triangles (front, forehead to chin); the back of the head and neck stay skin', async () => {
  const buf = fs.readFileSync(new URL('../client/public/avatars/gubbe.glb', import.meta.url));
  await MeshoptDecoder.ready;
  const gltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
  gltf.scene.updateMatrixWorld(true);
  const heads = new Set(Object.values(AV.hair).map((h) => h.head)), v = new THREE.Vector3(), seen = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh || o.material.name !== 'Skin' || !heads.has(o.parent?.name)) return;
    const P = (i) => { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); return v.toArray(); };
    const idx = o.geometry.index.array; let face = 0, back = 0, total = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = P(idx[t]), b = P(idx[t + 1]), c = P(idx[t + 2]); total++;
      if (isFaceTriangle(a, b, c)) { face++; if ((a[2] + b[2] + c[2]) / 3 < 0.05) back++; }
    }
    seen[o.parent.name] = { face, total, back };
  });
  assert.deepEqual(Object.keys(seen).sort(), [...heads].sort());
  for (const [h, s] of Object.entries(seen)) assert.ok(s.face >= 20 && s.face < s.total * 0.6 && s.back === 0, `${h}: ${JSON.stringify(s)}`);
});
console.log(`face: ${n} passed`);
