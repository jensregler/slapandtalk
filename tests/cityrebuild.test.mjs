// The city rebuild (Jens, 10 Nov 2026, pt781u + his annotated sketch): the kept houses' room presets
// (server/housepresets.js – id first, then title). (The open FX rooms' sound tests went with the city
// place effects – Jens t857u, 12 Nov 2026.)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createHousePresets } = require('../server/housepresets.js');
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };

const mk = (id, title, extra = {}) => ({ id, title, faces: { floor: `/api/presets/${id}/floor.webp?v=1` }, style: { floor: 'f', wall: 'w', ceiling: 'c' }, ...extra });
const fake = (all) => ({ get: async (id) => all.find((p) => p.id === id) || null, list: async () => all, forRoom: (p) => ({ id: p.id, faces: { ...p.faces } }) });

await ok('house presets: the sketch notes – 1 village in forrest, 3 Reglersro, 6 modern office, 8 Cozy Village', async () => {
  const hp = createHousePresets(fake([mk('50288ba516', 'small village in forrest'), mk('ef54aa361a', 'Reglersro'), mk('62bda393d3', 'modern office'), mk('af39b8617f', 'Cozy Village'), mk('ba96fb9dc1', 'start')]));
  assert.deepEqual(await Promise.all([1, 3, 6, 8].map(async (k) => (await hp.resolve(k)).title)), ['small village in forrest', 'Reglersro', 'modern office', 'Cozy Village']);
  for (const k of [2, 4, 5, 7, 0, 9]) assert.equal(await hp.resolve(k), null, `house ${k}: none`);
  const x = await hp.extraFor(6); assert.equal(x.preset.id, '62bda393d3'); assert.ok(x.preset.faces.floor && x.style.wall === 'w');
});
await ok('… a re-made preset (new id, same name) is found by its title; a missing one = a plain house', async () => {
  const hp = createHousePresets(fake([mk('aaaaaaaaaa', 'reglersro'), mk('bbbbbbbbbb', 'Cozy  Village ')]));
  assert.equal((await hp.resolve(3)).id, 'aaaaaaaaaa'); assert.equal((await hp.resolve(8)).id, 'bbbbbbbbbb');
  assert.equal(await hp.resolve(1), null); assert.equal(await hp.extraFor(6), null);
  const broken = createHousePresets({ get: async () => { throw new Error('S3 down'); }, list: async () => [] }, { log: { error() {} } });
  assert.equal(await broken.resolve(1), null);
});
console.log(`cityrebuild: ${n} checks ✓`);
