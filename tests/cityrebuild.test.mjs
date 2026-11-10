// The city rebuild (Jens, 10 Nov 2026, pt781u + his annotated sketch): the kept houses' room presets
// (server/housepresets.js – id first, then title), the open FX rooms' sound (shared/cityfx.mjs: reverb in
// 4, delay in 5, noise in 7, ducking the street fields inside) and the calm kept houses (PLACE_HOUSE).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as C from '../shared/city.mjs';
import * as F from '../shared/cityfx.mjs';
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
await ok('FX rooms: reverb inside 4, delay inside 5, noise inside 7 – the room is the boss inside (street fields ducked)', () => {
  const at = (p, dx = 0, dz = 0) => F.cityFxAt(p.x + dx, p.z + dz);
  const [r4, r5, r7] = C.FX_ROOMS;
  const v4 = at(r4), v5 = at(r5), v7 = at(r7);
  assert.equal(v4.zones.fxReverb, 1); assert.ok(v4.verbWet >= 0.79 && v4.verbSize > 0.95 && v4.noiseWet === 0);
  assert.equal(v5.zones.fxDelay, 1); assert.ok(v5.delayWet >= 0.74 && Math.abs(v5.delayTime - F.BEAT / 2) < 0.02 && v5.delayFb >= 0.54);
  assert.equal(v7.zones.fxNoise, 1); assert.ok(v7.noiseWet >= 0.84 && v7.noiseBed >= 0.49 && v7.verbWet < 0.2);
  // ducked: the old Flanger W / Chorus E side fields peak on plots 4/5 – inside the rooms they are ≤ 15 %
  assert.ok(v4.zones.flanger <= 0.151 && v5.zones.chorus <= 0.151, JSON.stringify([v4.zones, v5.zones]));
});
await ok('… the effect spills out through the open side / doorway, much less through a wall', () => {
  const [r4, r5, r7] = C.FX_ROOMS;
  const pairs = [[r4, -1, 0], [r5, 1, 0], [r7, 0, 1]]; // [room, open direction x, z]
  for (const [p, ox, oz] of pairs) {
    const o = F.fxRoomField(p.x + ox * 9.5, p.z + oz * 9.5, p), w = F.fxRoomField(p.x - ox * 9.5, p.z - oz * 9.5, p);
    const wFar = F.fxRoomField(p.x - ox * 11, p.z - oz * 11, p), oFar = F.fxRoomField(p.x + ox * 11, p.z + oz * 11, p);
    assert.ok(o > w + 0.3 && wFar === 0 && oFar > 0.15, `room ${p.n}: open ${o} / ${oFar}, wall ${w} / ${wFar}`);
  }
  // the Town Hall, the spawn and the plaza hear none of it
  for (const [x, z] of [[0, 9], [C.CITY_SPAWN.x, C.CITY_SPAWN.z], [0, -22]]) { const v = F.cityFxAt(x, z); assert.ok(!v.zones.fxReverb && !v.zones.fxDelay && !v.zones.fxNoise && v.noiseWet === 0, `${x},${z}`); }
});
await ok('kept houses: calm – no place effect, the bird/wind bed well down; every value inside its range', () => {
  const h = F.placeHouse();
  for (const k of Object.keys(F.PLACE)) { assert.ok(h[k] >= F.PLACE[k][0] && h[k] <= F.PLACE[k][1], k); }
  assert.ok(h.bird < 0.5 && h.wind < 0.5 && h.verbWet === 0 && h.delayWet === 0 && h.noiseWet === 0);
  for (let x = -47; x <= 47; x += 4) for (let z = -47; z <= 47; z += 4) { const v = F.cityFxAt(x, z); for (const k of Object.keys(F.PLACE)) assert.ok(Number.isFinite(v[k]) && v[k] >= F.PLACE[k][0] - 1e-9 && v[k] <= F.PLACE[k][1] + 1e-9, `${k} at ${x},${z}`); }
});
console.log(`cityrebuild: ${n} checks ✓`);
