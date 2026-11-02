// The City (t476u, 2 Nov 2026): the layout (shared/city.mjs), the Town Hall's packs (server/citypacks.js,
// a week, hand in → take 2), and the server side (old City stickers put away, houses seeded with a
// preset, box-only features refused in the City, people may stand all over the city).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as C from '../shared/city.mjs';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

ok('layout: 96 × 96 × 24, 3 × 3 plots of 32 m, houses 16 × 8 × 16, the Town Hall 24 m in the middle', () => {
  assert.deepEqual({ ...C.CITY }, { width: 96, height: 24, depth: 96 });
  assert.equal(C.PLOTS.length, 9); assert.equal(C.PLOT, 32);
  assert.deepEqual(C.PLOT_ROOMS, ['stad-1', 'stad-2', 'stad-3', 'stad-4', 'stad-5', 'stad-6', 'stad-7', 'stad-8']);
  assert.ok(C.HALL.x === 0 && C.HALL.z === 0 && C.HALL.house.h === 24 && C.HALL.room === null);
  for (const p of C.PLOTS) {
    assert.ok(Math.abs(p.x) + p.house.w / 2 <= 48 && Math.abs(p.z) + p.house.d / 2 <= 48);
    if (!p.hall) assert.ok(p.house.w === 16 && p.house.h === 8 && p.house.d === 16);
  }
  assert.ok(C.isCityRoom('stad') && C.isCityRoom('stad-5') && !C.isCityRoom('stad-9') && !C.isCityRoom('abc'));
});
ok('walking: slabs raise you, houses push you out, doors are in front of the south wall', () => {
  assert.equal(C.groundAt(0, 20), C.PLOT_SLAB); assert.equal(C.groundAt(16, 20), 0); // (x = 16: the street between two slabs)
  assert.deepEqual(C.pushOut(0, 7.9), [0, 8.35]);
  assert.deepEqual(C.pushOut(-32 + 7.9, -32), [-32 + 8.35, -32]);
  assert.equal(C.doorAt(0, 8.5).hall, true); assert.equal(C.doorAt(0, 8.5 - 32).room, 'stad-2'); assert.equal(C.doorAt(4, 8.5), null);
  assert.ok(!C.insideHouse(C.CITY_SPAWN.x, C.CITY_SPAWN.z));
  for (const id of C.PLOT_ROOMS) { const s = C.spawnOutside(id); assert.ok(!C.insideHouse(s.x, s.z), id); }
  assert.deepEqual({ ...C.roomBox('stad') }, { ...C.CITY }); assert.equal(C.roomBox('stad-1').width, 16);
});

// The packs with an in-memory adapter and a clock
const mem = new Map();
const adapter = { async get(k) { return mem.get(k) || null; }, async put(k, b) { mem.set(k, Buffer.from(b)); }, async delete(k) { mem.delete(k); }, async list(p) { return [...mem.keys()].filter((k) => k.startsWith(p)); }, async exists(k) { return mem.has(k); } };
let now = Date.parse('2026-11-02T12:00:00Z');
const { createCityPacks } = require('../server/citypacks.js');
const images = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((x) => x.repeat(16)));
const packs = createCityPacks(adapter, { imageInfo: async (id) => (images.has(id) ? { id, url: `/u/${id}.webp`, width: 100, height: 50 } : null), clock: () => now, log: { error() {} } });
const img = await sharp({ create: { width: 563, height: 802, channels: 4, background: { r: 200, g: 180, b: 150, alpha: 1 } } }).png().toBuffer();
const st = (s) => [...s].map((x) => x.repeat(16));
const A = await packs.handIn({ name: '  Jens\u0000 pack ', stickers: st('abc'), img });
const B = await packs.handIn({ name: 'B', stickers: st('def'), img });
const D = await packs.handIn({ name: 'D', stickers: st('ghi'), img });
const E = await packs.handIn({ name: 'E', stickers: st('adg'), img });
ok('hand in: a token, a week, a clean name, the picture as WebP', () => {
  assert.ok(A.token.length >= 20 && A.pack.name === 'Jens pack' && Date.parse(A.pack.expiresAt) - now === 7 * 864e5);
  assert.ok(mem.has(`citypacks/${A.pack.id}.webp`) && mem.has(`citypacks/${A.pack.id}.json`) && !JSON.stringify(JSON.parse(mem.get(`citypacks/${A.pack.id}.json`))).includes(A.token));
});
const rej = async (p, status) => { try { await p; assert.fail('should throw'); } catch (e) { assert.equal(e.status, status, e.message); } };
await rej(packs.handIn({ name: 'x', stickers: st('ab'), img }), 400);
await rej(packs.handIn({ name: 'x', stickers: ['z'.repeat(16), ...st('ab')], img }), 400);
await rej(packs.handIn({ name: 'x', stickers: st('abc'), img: Buffer.from('nope') }), 400);
await rej(packs.handIn({ name: 'again', stickers: st('abc'), img, token: A.token }), 409);
await rej(packs.take(B.pack.id, null), 403);
await rej(packs.take(A.pack.id, A.token), 400);
const t1 = await packs.take(B.pack.id, A.token), t2 = await packs.take(D.pack.id, A.token);
await rej(packs.take(E.pack.id, A.token), 409);
const again = await packs.take(B.pack.id, A.token);
ok('swap: only after handing in, never my own, at most 2 (the same one twice is a no-op)', () => {
  assert.equal(t1.left, 1); assert.equal(t2.left, 0); assert.deepEqual(again.takes, [B.pack.id, D.pack.id]);
  assert.equal(t1.pack.stickers.length, 3); assert.equal(t1.pack.stickers[0].url, `/u/${'d'.repeat(16)}.webp`);
});
const L = await packs.list(A.token);
ok('list: everyone\'s packs, mine marked, what I took marked', () => {
  assert.equal(L.packs.length, 4); assert.equal(L.mine.id, A.pack.id); assert.equal(L.mine.left, 0);
  assert.ok(L.packs.find((p) => p.id === B.pack.id).taken && L.packs.find((p) => p.id === A.pack.id).mine);
});
now += 7 * 864e5 + 1000;
const L2 = await packs.list(A.token);
ok('after a week: gone from the Town Hall (files deleted), and I may hand in again', () => {
  assert.equal(L2.packs.length, 0); assert.equal(L2.mine, null); assert.equal([...mem.keys()].length, 0);
});
const A2 = await packs.handIn({ name: 'week 2', stickers: st('abc'), img, token: A.token });
ok('…a new week: same token, fresh takes', () => { assert.equal(A2.token, A.token); });

// The server: old City stickers put away, houses seeded with a preset, box-only things refused.
const { startServer } = require('./demo-helpers.js');
const dir = fs.mkdtempSync('/tmp/klibb-city-');
fs.mkdirSync(path.join(dir, 'rooms'), { recursive: true }); fs.mkdirSync(path.join(dir, 'presets/abcd1234ef'), { recursive: true });
const old = { id: 'stad', type: 'stad', createdAt: '2026-01-01T00:00:00Z', stamps: [{ id: 'a'.repeat(16), imageId: 'b'.repeat(16), position: [0, 2, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.5, surface: 'vägg-norr', order: 1 }], cameras: [{ id: '0123456789', p: [0, 1.6, 0], yaw: 0, pitch: 0, fov: 60 }] };
fs.writeFileSync(path.join(dir, 'rooms/stad.json'), JSON.stringify(old));
const face = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).webp().toBuffer();
for (const f of ['floor', 'ceiling', 'north', 'south', 'west', 'east']) fs.writeFileSync(path.join(dir, `presets/abcd1234ef/${f}.webp`), face);
fs.writeFileSync(path.join(dir, 'presets/abcd1234ef.json'), JSON.stringify({ id: 'abcd1234ef', name: 'Cozy', sourceRoom: null, style: null, faces: Object.fromEntries(['floor', 'ceiling', 'north', 'south', 'west', 'east'].map((f) => [f, `/api/presets/abcd1234ef/${f}.webp?v=1`])), px: 64, geo: '16x8x16', createdAt: '2026-10-30T00:00:00Z' }));
const S = await startServer(Number(process.env.CITY_TEST_PORT || 8993), { DATA_DIR: dir, DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
try {
  const city = await (await fetch(`${S.base}/api/rooms/stad/stamps`)).json();
  ok('the City\'s old box-room stickers are not shown (they would float) …', () => { assert.equal(city.stamps.length, 0); });
  const house = (await (await fetch(`${S.base}/api/rooms/stad-3`)).json()).room;
  ok('a house (stad-3) is made on first visit: type stad, with a preset as its starting look', () => { assert.equal(house.type, 'stad'); assert.equal(house.preset && house.preset.id, 'abcd1234ef'); });
  const lib = (await (await fetch(`${S.base}/api/library`)).json()).stickers.filter((d) => !d.nature);
  const slap = await fetch(`${S.base}/api/rooms/stad/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: lib[0].id, position: [30, 3, 8.01], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.5, surface: 'h5-s' }) });
  await new Promise((r) => setTimeout(r, 600));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'rooms/stad.json'), 'utf8'));
  ok('… kept in the file (legacy), not deleted; a new city slap is saved where it was put', () => {
    assert.equal(slap.status, 200); assert.equal(saved.geo, 'city-1'); assert.equal(saved.legacy.stamps.length, 1); assert.equal(saved.legacy.cameras.length, 1);
    assert.deepEqual(saved.stamps.map((s) => [s.surface, s.position]), [['h5-s', [30, 3, 8.01]]]);
  });
  const peels = await fetch(`${S.base}/api/rooms/stad/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: '{"on":true}' });
  const cam = await fetch(`${S.base}/api/rooms/stad/cameras`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: '{"p":[0,1.6,0]}' });
  const camHouse = await fetch(`${S.base}/api/rooms/stad-3/cameras`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: '{"p":[0,1.6,0],"yaw":0,"pitch":0}' });
  ok('peels and cameras: not in the City (400); in a house they work as in any room', () => { assert.equal(peels.status, 400); assert.equal(cam.status, 400); assert.equal(camHouse.status, 200); });
  const recent = await (await fetch(`${S.base}/api/rooms/recent?ids=stad-3`)).json();
  ok('a house is nobody\'s own room (not in "recent")', () => { assert.deepEqual(recent.missing, ['stad-3']); });
} finally { S.child.kill(); }
console.log(`city: ${n} checks ✓`);
