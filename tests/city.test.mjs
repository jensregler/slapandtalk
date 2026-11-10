// The cities (t476u, t479u – 2 Nov 2026): the layout and ids (shared/city.mjs), the Town Hall's one pack
// shop (server/citypacks.js: a week free / for good paid, a description, hand in → take; free carries 3
// packs and drops what it took on leaving, paid keeps it), and the server side (old City stickers put
// away, cities started + named, houses started in order – no preset seeding, box-only features refused
// in a city's outside, the Join list with city names).
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
    assert.ok(Math.abs(p.house.x) + p.house.w / 2 <= 48 && Math.abs(p.house.z) + p.house.d / 2 <= 48);
    if (!p.hall && !p.subway) assert.ok(p.house.w === 16 && p.house.h === 8 && p.house.d === 16);
  }
  assert.ok(C.isCityRoom('stad') && C.isCityRoom('stad-5') && !C.isCityRoom('stad-9') && !C.isCityRoom('abc'));
});
ok('ids: many cities – stad-<code> outside, stad-<code>-<n> its houses; the first City is "stad"', () => {
  assert.deepEqual(C.parseCityRoom('stad-ab12cd-3'), { city: 'stad-ab12cd', n: 3 }); assert.deepEqual(C.parseCityRoom('stad'), { city: 'stad', n: 0 });
  assert.deepEqual(C.parseCityRoom('stad-4'), { city: 'stad', n: 4 }); assert.equal(C.parseCityRoom('stad-ab12cd-9'), null); assert.equal(C.parseCityRoom('stadium'), null);
  assert.ok(C.isCityOutside('stad-ab12cd') && !C.isCityOutside('stad-ab12cd-1') && C.isPlotRoom('stad-ab12cd-1') && C.isFirstCity('stad-2') && !C.isFirstCity('stad-ab12cd'));
  assert.deepEqual(C.houseIds('stad-ab12cd').slice(0, 2), ['stad-ab12cd-1', 'stad-ab12cd-2']);
  for (let k = 0; k < 200; k++) { const id = C.newCityId(); assert.ok(C.CITY_CODE_RE.test(id) && C.isCityOutside(id) && !C.isFirstCity(id), id); }
  assert.equal(C.nextHouse([]), 1); assert.equal(C.nextHouse([1, 2, 4]), 3); assert.equal(C.nextHouse([1, 2, 3, 4, 5, 6, 7, 8]), 0);
  assert.equal(C.nextHouse([1, 3]), 6); assert.equal(C.nextHouse([1, 3, 6, 8]), 0); // (rebuild: only 1, 3, 6, 8 are houses)
  assert.equal(C.plotOfRoom('stad-ab12cd-2').z, -32); assert.deepEqual({ ...C.roomBox('stad-ab12cd') }, { ...C.CITY }); assert.equal(C.roomBox('stad-ab12cd-2').width, 16);
});
ok('walking: the ground is ONE flat piece (no ditches, t481u), houses push you out, doors are in front of the south wall', () => {
  assert.equal(C.PLOT_SLAB, 0); assert.equal(C.CITY_GEO, 'city-2');
  for (const [x, z] of [[0, 20], [16, 20], [-40, -40], [32, 16.2], [47, 0]]) assert.equal(C.groundAt(x, z), 0, `${x},${z}`); // (x = 16: the street between two plots)
  assert.deepEqual(C.pushOut(0, 7.9), [0, 8.35]);
  assert.deepEqual(C.pushOut(-32 + 7.9, -32), [-32 + 8.35, -32]);
  assert.equal(C.doorAt(0, 8.5).hall, true); assert.equal(C.doorAt(-32, 8.5 - 32).room, 'stad-1'); assert.equal(C.doorAt(4, 8.5), null);
  assert.equal(C.doorAt(0, C.SUBWAY.z + C.SUBWAY.d / 2 + 0.5).subway, true); // the subway station's door (plot 2)
  assert.ok(!C.insideHouse(C.CITY_SPAWN.x, C.CITY_SPAWN.z));
  for (const id of C.PLOT_ROOMS) { const s = C.spawnOutside(id); assert.ok(!C.insideHouse(s.x, s.z), id); }
  assert.deepEqual({ ...C.roomBox('stad') }, { ...C.CITY }); assert.equal(C.roomBox('stad-1').width, 16);
});

ok('rebuild (Jens, 10 Nov 2026): kept houses 1/3/6/8 with presets, subway on plot 2, open FX rooms 4/5/7, a plaza', () => {
  assert.deepEqual([...C.KEPT_HOUSES], [1, 3, 6, 8]); assert.equal(C.HOUSE_MAX, 4);
  assert.deepEqual(C.PLOTS.map((p) => p.kind), ['house', 'subway', 'house', 'fx', 'hall', 'fx', 'house', 'fx', 'house']);
  assert.deepEqual(Object.keys(C.HOUSE_PRESETS).map(Number), [1, 3, 6, 8]);
  assert.deepEqual(C.FX_ROOMS.map((p) => [p.n, p.fx]), [[4, 'reverb'], [5, 'delay'], [7, 'noise']]);
  for (const p of C.PLOTS) assert.equal(!!p.door, p.kind !== 'fx', `plot ${p.n}: door`);
  // kept houses are rooms; the others are not
  for (const n of [1, 3, 6, 8]) assert.equal(C.plotOfHouse(n).room, `stad-${n}`);
  for (const n of [2, 4, 5, 7]) assert.equal(C.plotOfHouse(n).room, null);
  // open rooms: you can walk in through the open side / the doorway, not through a wall
  for (const p of C.FX_ROOMS) { assert.ok(!C.insideHouse(p.x, p.z), `inside room ${p.n} is free`); assert.equal(C.insideFxRoom(p.x, p.z).n, p.n); }
  assert.ok(!C.insideHouse(-40.5, 0) && !C.insideHouse(-38, 0), 'room 4 is open to the west');
  assert.ok(C.insideHouse(-24.2, 0) && C.insideHouse(-32, -7.8), 'room 4: east + north walls');
  assert.ok(!C.insideHouse(40.5, 0) && C.insideHouse(24.2, 0), 'room 5 is open to the east, walled to the west');
  assert.ok(!C.insideHouse(0, 39.8) && C.insideHouse(-5, 39.8) && C.insideHouse(5, 39.8), 'room 7: a doorway in the south wall');
  // pushOut keeps you out of the wall on the side you came from
  assert.ok(C.pushOut(-23.9, 0)[0] > -23.8 && C.pushOut(-24.6, 0)[0] < -24.4);
  // the subway station + the plaza between it and the Town Hall
  assert.ok(C.insideHouse(C.SUBWAY.x, C.SUBWAY.z).subway && !C.insideHouse(C.SUBWAY_SPAWN.x, C.SUBWAY_SPAWN.z));
  assert.ok(C.PLAZA.z - C.PLAZA.d / 2 >= C.SUBWAY.z + C.SUBWAY.d / 2 - 0.01 && C.PLAZA.z + C.PLAZA.d / 2 <= C.HALL.z - C.HALL.house.d / 2 + 0.01);
  for (let z = -35; z <= -9; z += 0.5) assert.ok(!C.insideHouse(0, z), `walk the plaza at z ${z}`);
  assert.equal(C.spawnOutside('stad-ab12cd-4').z, C.CITY_SPAWN.z); // an old house-4 link: the city's spawn
});
ok('nature stickers: up to 24 m high in the city\'s outside, 8 m in a house or room, min 10 cm (t482u)', async () => {
  assert.equal(C.natureMaxHeightCmIn('stad'), 2400); assert.equal(C.natureMaxHeightCmIn('stad-ab12cd'), 2400); assert.equal(C.natureMaxHeightCmIn('stad-ab12cd-2'), 800); assert.equal(C.natureMaxHeightCmIn('stad-4'), 800); assert.equal(C.natureMaxHeightCmIn('abc123'), 800);
});
const NAT = await import('../shared/nature.mjs');
ok('… the shared limits take the space\'s height', () => {
  assert.deepEqual(NAT.sizeLimitsCm({ nature: true, width: 1, height: 1 }, null, { maxHeightCm: 2400 }), { minCm: 10, maxCm: Infinity });
  assert.deepEqual(NAT.sizeLimitsCm({ nature: true, width: 2, height: 1 }, null, { maxHeightCm: 2400 }), { minCm: 10, maxCm: Infinity });
  assert.deepEqual(NAT.sizeLimitsCm({ nature: true, width: 1, height: 1 }, null), { minCm: 10, maxCm: Infinity });
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
  assert.ok(A.token.length >= 20 && A.pack.name === 'Jens pack' && Date.parse(A.pack.expiresAt) - now === 7 * 864e5 && !A.pack.forever);
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
// Full: discard one taken pack (Replace this?), then take another
const droppedOne = await packs.dropOne(A.token, B.pack.id);
const t3 = await packs.take(E.pack.id, A.token);
ok('full → dropOne then take: replace a carried pack to free a slot', () => {
  assert.equal(droppedOne.dropped, B.pack.id); assert.equal(droppedOne.left, 1);
  assert.deepEqual(t3.takes.sort(), [D.pack.id, E.pack.id].sort()); assert.equal(t3.left, 0);
});
await rej(packs.dropOne(A.token, B.pack.id), 404);
const L = await packs.list(A.token);
ok('list: everyone\'s packs, mine marked, what I took marked, taken counts', () => {
  assert.equal(L.packs.length, 4); assert.equal(L.mine.id, A.pack.id); assert.equal(L.mine.left, 0); assert.equal(L.maxPacks, 3);
  assert.ok(L.packs.find((p) => p.id === D.pack.id).taken && L.packs.find((p) => p.id === E.pack.id).taken && L.packs.find((p) => p.id === A.pack.id).mine);
  assert.equal(L.packs.find((p) => p.id === B.pack.id).taken, false);
  assert.equal(L.packs.find((p) => p.id === B.pack.id).takenCount, 1); // still counted historically
});
// leaving the city (free): what I took is dropped, my pack stays; then I may take 2 again
const dropped = await packs.dropTaken(A.token, { paid: false });
const L1 = await packs.list(A.token);
ok('free: leaving the city drops what I took (my own pack stays in the shop), and I may take 2 again', () => {
  assert.deepEqual(dropped.takes, []); assert.equal(L1.mine.id, A.pack.id); assert.equal(L1.mine.left, 2);
});
// a description, who made it, Instagram; a paying player: for good, more packs, keeps what they took
const P = await packs.handIn({ name: 'Forever', stickers: st('ghi'), img, about: 'Hi! I am Jens.\r\n\n\n\nThese are\u0007 my  best.', author: '  Jens  T ', insta: '@JensRegler!', paid: true });
const P2 = await packs.handIn({ name: 'Forever 2', stickers: st('abc'), img, token: P.token, paid: true });
await rej(packs.handIn({ name: 'again', stickers: st('abc'), img, token: A.token, paid: false }), 409);
for (const id of [A.pack.id, B.pack.id, D.pack.id]) await packs.take(id, P.token, { paid: true });
const keep = await packs.dropTaken(P.token, { paid: true });
ok('hand in with a description, my name and Instagram (cleaned)', () => {
  assert.equal(P.pack.about, 'Hi! I am Jens.\n\nThese are my best.'); assert.deepEqual(P.pack.author, { name: 'Jens T', insta: 'jensregler' });
});
ok('paid: in the shop for good (expiresAt null), may hand in more, takes more than 2 and keeps them on leaving', () => {
  assert.ok(P.pack.forever && P.pack.expiresAt === null && P2.pack.forever); assert.equal(keep.takes.length, 3);
});
now += 7 * 864e5 + 1000;
const L2 = await packs.list(A.token);
ok('after a week: the free packs are gone from the shop (files deleted), the paid ones stay', () => {
  assert.equal(L2.mine, null); assert.deepEqual(L2.packs.map((p) => p.name).sort(), ['Forever', 'Forever 2']);
  assert.ok(![...mem.keys()].some((k) => k.includes(A.pack.id)));
});
const A2 = await packs.handIn({ name: 'week 2', stickers: st('abc'), img, token: A.token });
ok('…a new week: same token, fresh takes', () => { assert.equal(A2.token, A.token); });

// The server: old City stickers put away, houses seeded with a preset, box-only things refused.
const { startServer } = require('./demo-helpers.js');
const dir = fs.mkdtempSync('/tmp/klibb-city-');
fs.mkdirSync(path.join(dir, 'rooms'), { recursive: true }); fs.mkdirSync(path.join(dir, 'presets/abcd1234ef'), { recursive: true });
// A city saved with the raised plots ('city-1', live 814b13a): moved down onto the flat ground.
const city1 = { id: 'stad', type: 'stad', geo: 'city-1', createdAt: '2026-11-02T00:00:00Z', stamps: [
  { id: 'c'.repeat(16), imageId: 'b'.repeat(16), position: [3, 0.5, 20], normal: [0, 1, 0], quaternion: [0, 0, 0, 1], size: 0.5, surface: 'plot-7', order: 1 },
  { id: 'd'.repeat(16), imageId: 'b'.repeat(16), position: [30, 3.5, 8.01], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.5, surface: 'h5-s', order: 2 },
  { id: 'e'.repeat(16), imageId: 'b'.repeat(16), position: [16, 0, 20], normal: [0, 1, 0], quaternion: [0, 0, 0, 1], size: 0.5, surface: 'golv', order: 3 }] };
const dir1 = fs.mkdtempSync('/tmp/klibb-city1-'); fs.mkdirSync(path.join(dir1, 'rooms'), { recursive: true });
fs.writeFileSync(path.join(dir1, 'rooms/stad.json'), JSON.stringify(city1));
const { startServer: start1 } = require('./demo-helpers.js');
const S1 = await start1(Number(process.env.CITY_TEST_PORT || 8993) + 1, { DATA_DIR: dir1, DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
try {
  await fetch(`${S1.base}/api/rooms/stad/stamps`); await new Promise((r) => setTimeout(r, 400));
  const got = JSON.parse(fs.readFileSync(path.join(dir1, 'rooms/stad.json'), 'utf8')).stamps;
  ok('a \'city-1\' city: plot stickers land on the flat ground, house stickers move down with the house', () => {
    assert.deepEqual(got.map((s) => [s.surface, s.position]), [['golv', [3, 0, 20]], ['h5-s', [30, 3, 8.01]], ['golv', [16, 0, 20]]]);
  });
} finally { S1.child.kill(); }

const old = { id: 'stad', type: 'stad', createdAt: '2026-01-01T00:00:00Z', stamps: [{ id: 'a'.repeat(16), imageId: 'b'.repeat(16), position: [0, 2, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.5, surface: 'vägg-norr', order: 1 }], cameras: [{ id: '0123456789', p: [0, 1.6, 0], yaw: 0, pitch: 0, fov: 60 }] };
fs.writeFileSync(path.join(dir, 'rooms/stad.json'), JSON.stringify(old));
const face = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).webp().toBuffer();
for (const f of ['floor', 'ceiling', 'north', 'south', 'west', 'east']) fs.writeFileSync(path.join(dir, `presets/abcd1234ef/${f}.webp`), face);
fs.writeFileSync(path.join(dir, 'presets/abcd1234ef.json'), JSON.stringify({ id: 'abcd1234ef', name: 'Cozy', sourceRoom: null, style: null, faces: Object.fromEntries(['floor', 'ceiling', 'north', 'south', 'west', 'east'].map((f) => [f, `/api/presets/abcd1234ef/${f}.webp?v=1`])), px: 64, geo: '16x8x16', createdAt: '2026-10-30T00:00:00Z' }));
const S = await startServer(Number(process.env.CITY_TEST_PORT || 8993), { DATA_DIR: dir, DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
try {
  const city = await (await fetch(`${S.base}/api/rooms/stad/stamps`)).json();
  ok('the City\'s old box-room stickers are not shown (they would float) …', () => { assert.equal(city.stamps.length, 0); });
  const J = (r) => r.json();
  const post = (u, b) => fetch(S.base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  const house0 = (await J(await fetch(`${S.base}/api/rooms/stad-3`))).room, first0 = (await J(await fetch(`${S.base}/api/cities/stad`))).city;
  ok('a house is NOT made by just looking at it (no preset seeding any more – t479u)', () => { assert.ok(!house0.preset); assert.deepEqual(first0.houses, []); assert.equal(first0.next, 1); assert.equal(first0.name, 'The City'); });
  const first = []; for (let k = 0; k < 3; k++) first.push(await J(await post('/api/cities/stad/houses')));
  const house = (await J(await fetch(`${S.base}/api/rooms/stad-3`))).room;
  ok('houses start in order (the next free KEPT number – rebuild: 1, 3, 6) – a room of type stad (no matching room preset here)', () => {
    assert.deepEqual(first.map((r) => r.n), [1, 3, 6]); assert.equal(house.type, 'stad'); assert.ok(!house.preset);
  });
  const noName = await post('/api/cities', { name: '   ' });
  const made = await J(await post('/api/cities', { name: '  Slap\u0000ville  ', by: 'Jens' }));
  const cid = made.city && made.city.id;
  const h = []; for (let k = 0; k < 5; k++) h.push(await post(`/api/cities/${cid}/houses`, { by: 'Jens' }));
  const removed = await post(`/api/cities/${cid}/houses`, { n: 4 }), again = await J(await post(`/api/cities/${cid}/houses`, { n: 3 }));
  const info = (await J(await fetch(`${S.base}/api/cities/${cid}`))).city;
  const list = (await J(await fetch(`${S.base}/api/cities`))).cities;
  const gone = await fetch(`${S.base}/api/cities/stad-zz99zz`);
  ok('a city: started with a name (required, cleaned), the 4 kept houses then 409, a removed one 400, listed, a gone one is 404', () => {
    assert.equal(noName.status, 400); assert.ok(C.CITY_CODE_RE.test(cid)); assert.equal(made.city.name, 'Slapville'); assert.equal(made.city.startedBy, 'Jens');
    assert.deepEqual(h.map((r) => r.status), [200, 200, 200, 200, 409]);
    assert.equal(removed.status, 400); assert.equal(again.n, 3); // starting a started house = the same house
    assert.deepEqual(info.houses, [1, 3, 6, 8]); assert.equal(info.next, 0);
    assert.equal(info.houseMax, 4); assert.equal(typeof info.space, 'number'); assert.deepEqual(Object.keys(info.inHouses).map(Number), [1, 3, 6, 8]);
    assert.ok(list.some((c) => c.id === cid && c.name === 'Slapville')); assert.ok(!list.some((c) => c.id === 'stad'), 'the first City is not offered when empty');
    const row = list.find((c) => c.id === cid);
    assert.equal(typeof row.stickers, 'number'); assert.equal(typeof row.visitors, 'number');
    assert.equal(typeof info.stickers, 'number'); assert.equal(typeof info.visitors, 'number');
    assert.equal(gone.status, 404);
  });
  const camCity = await fetch(`${S.base}/api/rooms/${cid}/cameras`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: '{"p":[0,1.6,0]}' });
  const style = await post(`/api/rooms/${cid}-1/reset`, { by: 'X' });
  ok('a new city\'s outside is no box either (cameras 400); its houses are locked like the City (reset 403)', () => { assert.equal(camCity.status, 400); assert.equal(style.status, 403); });
  const lib = (await (await fetch(`${S.base}/api/library`)).json()).stickers.filter((d) => !d.nature);
  const slap = await fetch(`${S.base}/api/rooms/stad/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: lib[0].id, position: [30, 3, 8.01], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.5, surface: 'h5-s' }) });
  await new Promise((r) => setTimeout(r, 600));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'rooms/stad.json'), 'utf8'));
  ok('… kept in the file (legacy), not deleted; a new city slap is saved where it was put', () => {
    assert.equal(slap.status, 200); assert.equal(saved.geo, 'city-2'); assert.equal(saved.legacy.stamps.length, 1); assert.equal(saved.legacy.cameras.length, 1);
    assert.deepEqual(saved.stamps.map((s) => [s.surface, s.position]), [['h5-s', [30, 3, 8.01]]]);
  });
  // Nature stickers (t482u): asked for 30 m → 24 m outside (the city's height); 30 m in a house → 8 m.
  const nat = (await (await fetch(`${S.base}/api/library`)).json()).stickers.find((d) => d.nature && d.width && d.height && d.width <= d.height);
  if (nat) {
    const big = (room, surface) => fetch(`${S.base}/api/rooms/${room}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: JSON.stringify({ imageId: nat.id, position: [16, 0, 20], normal: [0, 1, 0], quaternion: [0, 0, 0, 1], size: 30, surface }) });
    const tiny = (room) => fetch(`${S.base}/api/rooms/${room}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: JSON.stringify({ imageId: nat.id, position: [16, 0, 20], normal: [0, 1, 0], quaternion: [0, 0, 0, 1], size: 0.05, surface: 'golv' }) });
    const out = await (await big('stad', 'golv')).json(), mid = await (await fetch(`${S.base}/api/rooms/stad/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: JSON.stringify({ imageId: nat.id, position: [16, 0, 22], normal: [0, 1, 0], quaternion: [0, 0, 0, 1], size: 20, surface: 'golv' }) })).json();
    const inHouse = await (await fetch(`${S.base}/api/rooms/stad-3/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: JSON.stringify({ imageId: nat.id, position: [0, 0, 0], normal: [0, 1, 0], quaternion: [0, 0, 0, 1], size: 30, surface: 'golv' }) })).json();
    const small = await (await tiny('stad')).json();
    ok('nature stickers on the server: no upper size cap outside or in a house; 10 cm min still (t482u)', () => {
      const sz = (r) => (r.stamp || r).size;
      assert.equal(sz(out), 30); assert.equal(sz(mid), 20); assert.equal(sz(inHouse), 30); assert.equal(sz(small), 0.1);
    });
  } else console.log('  (no portrait nature sticker in the library – server nature check skipped)');
  const peels = await fetch(`${S.base}/api/rooms/stad/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: '{"on":true}' });
  const cam = await fetch(`${S.base}/api/rooms/stad/cameras`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: '{"p":[0,1.6,0]}' });
  const camHouse = await fetch(`${S.base}/api/rooms/stad-3/cameras`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'demo-e2e-admin' }, body: '{"p":[0,1.6,0],"yaw":0,"pitch":0}' });
  ok('city outside: peels always on (PUT on → 200); cameras still not (400); in a house cameras work', () => { assert.equal(peels.status, 200); assert.equal(cam.status, 400); assert.equal(camHouse.status, 200); });
  const recent = await (await fetch(`${S.base}/api/rooms/recent?ids=stad-3,${cid}-2`)).json();
  ok('a house is nobody\'s own room (not in "recent")', () => { assert.deepEqual(recent.missing, ['stad-3', `${cid}-2`]); });
  // the Join list: people in a city room → the city's name with it
  const { default: WebSocket } = await import('ws');
  const join = async (id) => { const ws = new WebSocket(`${S.base.replace('http', 'ws')}/ws?room=${id}`); await new Promise((r) => ws.on('open', r)); ws.send(JSON.stringify({ t: 'hello', name: 'A' })); await new Promise((r) => setTimeout(r, 150)); return ws; };
  const w1 = await join(cid), w2 = await join(`${cid}-6`);
  const open = (await J(await fetch(`${S.base}/api/rooms/open`))).rooms;
  const cities2 = (await J(await fetch(`${S.base}/api/cities`))).cities;
  w1.close(); w2.close();
  ok('Join list: rooms in a city carry the city\'s name (outside: the city; a house: "House 6" in it)', () => {
    const o = open.find((r) => r.id === cid), hh = open.find((r) => r.id === `${cid}-6`);
    assert.deepEqual(o.city, { id: cid, name: 'Slapville', house: 0 }); assert.equal(o.name, 'Slapville');
    assert.deepEqual(hh.city, { id: cid, name: 'Slapville', house: 6 }); assert.equal(hh.name, 'House 6');
    assert.equal(cities2.find((c) => c.id === cid).people, 2);
  });
  // Max 4 in a kept house (rebuild, pt781u): the fifth is turned away ('house-full', socket closed 4003), not left watching.
  const inside = []; for (let k = 0; k < 4; k++) inside.push(await join(`${cid}-8`));
  const fifth = new WebSocket(`${S.base.replace('http', 'ws')}/ws?room=${cid}-8`); const got = [];
  fifth.on('message', (b) => got.push(JSON.parse(String(b))));
  const closed = new Promise((r) => fifth.on('close', (code) => r(code)));
  await new Promise((r) => fifth.on('open', r)); fifth.send(JSON.stringify({ t: 'hello', name: 'Five' }));
  const code5 = await closed;
  const busy = (await J(await fetch(`${S.base}/api/cities/${cid}`))).city;
  inside[0].close(); await new Promise((r) => setTimeout(r, 200));
  const sixth = await join(`${cid}-8`); const welcomed = await new Promise((r) => { sixth.once('message', (b) => r(JSON.parse(String(b)))); setTimeout(() => r(null), 800); });
  for (const w of [...inside, sixth]) w.close();
  ok('a kept house holds 4: number five is denied (house-full, 4003, not a watcher); a freed place lets the next one in', () => {
    assert.equal(code5, 4003); assert.ok(got.some((m) => m.t === 'denied' && m.code === 'house-full' && m.house === 8 && m.max === 4), JSON.stringify(got));
    assert.ok(!got.some((m) => m.t === 'welcome')); assert.equal(busy.inHouses[8], 4);
    assert.ok(!welcomed || welcomed.t !== 'denied', JSON.stringify(welcomed));
  });
} finally { S.child.kill(); }
console.log(`city: ${n} checks ✓`);
