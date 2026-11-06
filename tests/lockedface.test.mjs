// Locked face + shoes (Jens t587u / t588u).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { LOCKED_FACE, LOCKED_FACE_ID, LOCKED_FACE_INSTA, LOCKED_FACE_SCALE, ownsLockedFace, applyLockedFace } from '../shared/lockedface.mjs';
const require = createRequire(import.meta.url);
const { cleanLook } = require('../server/realtime.js');
const AV = JSON.parse(fs.readFileSync(new URL('../shared/avatar.json', import.meta.url)));

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

ok('locked face constants match the prod snapshot (id + scale 1.15 + photo)', () => {
  assert.equal(LOCKED_FACE_ID, '70cf6e844298da52');
  assert.equal(LOCKED_FACE_SCALE, 1.15);
  assert.equal(LOCKED_FACE.photo, true);
  assert.equal(LOCKED_FACE.scale, 1.15);
  assert.ok(fs.existsSync(new URL('../client/public/locked/jens-face.webp', import.meta.url)));
});

ok('ownsLockedFace: only @jensreglermanniska', () => {
  assert.equal(ownsLockedFace({ insta: LOCKED_FACE_INSTA }), true);
  assert.equal(ownsLockedFace({ insta: '@JensReglerManniska' }), true); // @ stripped + lowercased
  assert.equal(ownsLockedFace({ insta: 'other' }), false);
  assert.equal(ownsLockedFace({}), false);
});

ok('applyLockedFace forces the photo and drops face colour', () => {
  const L = applyLockedFace({ skin: '#f1c27d', face: '#ff70a6', fabric: { face: { id: 'aaaaaaaaaaaaaaaa', scale: 2, photo: true }, shirt: { id: 'bbbbbbbbbbbbbbbb' } } });
  assert.equal(L.fabric.face.id, LOCKED_FACE_ID);
  assert.equal(L.fabric.face.scale, 1.15);
  assert.equal(L.fabric.face.photo, true);
  assert.equal(L.fabric.shirt.id, 'bbbbbbbbbbbbbbbb');
  assert.equal(L.face, undefined);
});

ok('server cleanLook locks Jens the same way and keeps shoes', () => {
  const L = cleanLook({
    outfit: 'tshirt', hair: 'lang', shirt: '#3a86ff', pants: '#8b5a2b', hairColor: '#1b1410',
    skin: '#f1c27d', shoes: '#3a86ff', hat: false, hatColor: '#222222',
    face: '#ff70a6', fabric: { face: { id: 'aaaaaaaaaaaaaaaa', scale: 2, photo: true } },
    insta: 'jensreglermanniska',
  });
  assert.equal(L.insta, 'jensreglermanniska');
  assert.equal(L.fabric.face.id, LOCKED_FACE_ID);
  assert.equal(L.fabric.face.scale, 1.15);
  assert.equal(L.face, undefined);
  assert.equal(L.shoes, '#3a86ff');
});

ok('server cleanLook leaves other players\' faces alone', () => {
  const L = cleanLook({
    outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#4a2c17',
    skin: '#e0ac69', shoes: '#e63946', hat: false, hatColor: '#e63946',
    fabric: { face: { id: 'bbbbbbbbbbbbbbbb', scale: 1.4, photo: true } },
    insta: 'someoneelse',
  });
  assert.equal(L.fabric.face.id, 'bbbbbbbbbbbbbbbb');
  assert.equal(L.fabric.face.scale, 1.4);
  assert.equal(L.shoes, '#e63946');
});

ok('shoes is a colour on every outfit and the default look', () => {
  for (const o of Object.values(AV.outfits)) assert.ok(o.shoes, JSON.stringify(o));
  assert.ok(AV.colors.shoes.length >= 4);
  assert.equal(AV.default.shoes, '#222222');
  assert.equal(cleanLook({}).shoes, AV.default.shoes);
});

ok('baked asset exists; fabricUrl mapping is covered by fabrics.js source', () => {
  const src = fs.readFileSync(new URL('../client/src/fabrics.js', import.meta.url), 'utf8');
  assert.ok(src.includes('LOCKED_FACE_URL'));
  assert.ok(src.includes('LOCKED_FACE_ID'));
  assert.ok(fs.statSync(new URL('../client/public/locked/jens-face.webp', import.meta.url)).size > 1000);
});

console.log(`lockedface: ${n} ok`);
