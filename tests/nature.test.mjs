// Nature stickers (Jens, 28 Oct 2026): curated library stickers whose name starts with "nature"
// (shared/nature.mjs) scale from 10 cm up to 8 m HIGH (the room height, t475u) in every version; every other sticker keeps the
// normal limits (free 15 cm – 1 m, full 10 cm – 1.5 m, t475u). The import tool flags a "nature" folder,
// /api/library carries the flag, and the server clamps POST …/stamps. Run: node tests/nature.test.mjs
// Tests the free/full split, so OPEN ACCESS (shared/openaccess.mjs) is off here unless OPEN_ACCESS is set.
process.env.OPEN_ACCESS ??= '0';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { loadLibrary, seedLibrary } = require('../server/library');
const { makeEntitlements } = require('../server/entitlements');
const { importFolder } = await import('../tools/import-library.mjs');
const { NATURE, isNature, isNatureName, natureMaxSideCm, sizeLimitsCm, STICKER_LIMITS, STICKER_EPSILON_CM, STICKER_EPSILON_M, roundSizeCm, sizeLabel } = await import('../shared/nature.mjs');

let n = 0;
const ok = async (name, fn) => { try { await fn(); n++; console.log('✔ ' + name); } catch (e) { console.error('✗ ' + name + '\n  ' + e.message); process.exitCode = 1; } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

await ok('constants: 8 m high hint (the room height), no gameplay floor – only the 0.01 cm epsilon (Jens 11 Nov 2026), prefix "nature"', () => {
  assert.equal(NATURE.maxHeightCm, 800); assert.equal(NATURE.minCm, 0.01); assert.equal(NATURE.minCm, STICKER_EPSILON_CM); assert.equal(NATURE.prefix, 'nature');
});
await ok('free scaling: no upper or lower limit on the graphic (only the 0.01 cm epsilon); rounding never sticks or hits 0', () => {
  assert.equal(STICKER_EPSILON_CM, 0.01); assert.equal(STICKER_EPSILON_M, 0.0001);
  for (const L of [STICKER_LIMITS.full, STICKER_LIMITS.free]) { assert.equal(L.minCm, STICKER_EPSILON_CM); assert.equal(L.maxCm, Infinity); }
  assert.ok(STICKER_EPSILON_CM < 10 && STICKER_EPSILON_CM < 15, 'no 10 / 15 cm floor');
  assert.equal(roundSizeCm(30.3), 30.5); assert.equal(roundSizeCm(4.567), 4.57); assert.equal(roundSizeCm(0.1234), 0.123); assert.equal(roundSizeCm(0.001), 0.01); assert.equal(roundSizeCm(1e6), 1e6);
  // the mouse wheel's ×0.9 / ×1.1 from 30 cm: 80 notches down reach well under 1 cm, 200 up go past 4 m and 100 m
  let cm = 30; for (let i = 0; i < 80; i++) { const nx = roundSizeCm(cm * 0.9); assert.ok(nx < cm || nx === STICKER_EPSILON_CM, `stuck at ${cm}`); cm = nx; }
  assert.equal(cm, STICKER_EPSILON_CM, `down: ${cm}`);
  for (let i = 0; i < 200; i++) { const nx = roundSizeCm(cm * 1.1); assert.ok(nx > cm, `stuck going up at ${cm}`); cm = nx; }
  assert.ok(cm > 10000, `up: ${cm}`);
  assert.equal(sizeLabel(30), '30 cm'); assert.equal(sizeLabel(2.345), '2.35 cm'); assert.equal(sizeLabel(0.01), '0.01 cm'); assert.equal(sizeLabel(1200), '1,200 cm');
});
await ok('the name rule: starts with "nature", any case, the file name only', () => {
  for (const y of ['nature.png', 'Nature-tree.png', 'NATURE_x.jpg', 'dir/natureboy.png']) assert.ok(isNatureName(y), y);
  for (const x of ['tree.png', 'my-nature.png', 'nature/tree.png', '', null]) assert.ok(!isNatureName(x), String(x));
  assert.ok(isNature({ nature: true })); assert.ok(isNature({ source: 'nature-a.png' })); assert.ok(!isNature({ source: 'a.png' })); assert.ok(!isNature(null));
});
await ok('the height cap as a longest-side cap: square/portrait 800 cm, a 4:1 strip 3200 cm', () => {
  assert.equal(natureMaxSideCm({ width: 100, height: 100 }), 800); assert.equal(natureMaxSideCm({ width: 50, height: 100 }), 800);
  assert.equal(natureMaxSideCm({ width: 400, height: 100 }), 3200); assert.equal(natureMaxSideCm({}), 800);
  const normal = { minCm: 15, maxCm: 100 };
  assert.deepEqual(sizeLimitsCm({ nature: true, width: 1, height: 1 }, normal), { minCm: 0.01, maxCm: Infinity });
  assert.equal(sizeLimitsCm({ source: 'tree.png' }, normal), normal);
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-nature-'));
try {
  const png = (hex, w = 40, h = 40) => sharp({ create: { width: w, height: h, channels: 4, background: hex } }).png().toBuffer();
  const src = path.join(tmp, 'src'); fs.mkdirSync(path.join(src, 'Nature'), { recursive: true });
  fs.writeFileSync(path.join(src, 'Nature', 'tree.png'), await png('#00aa00', 40, 80));
  fs.writeFileSync(path.join(src, 'Nature', 'nature-wide.png'), await png('#00aaaa', 160, 40));
  fs.writeFileSync(path.join(src, 'plain.png'), await png('#aa0000'));
  const out = path.join(tmp, 'lib');
  const logs = [];
  await importFolder({ folder: src, out, csv: null, artist: '', replace: false, dry: false }, (m) => logs.push(m));
  const man = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const by = Object.fromEntries(man.stickers.map((s) => [s.source, s]));
  await ok('import: files in a "nature" folder get nature: true and a "nature" name; "Nature" is not the artist; others unchanged', () => {
    assert.ok(by['nature-tree.png'] && by['nature-tree.png'].nature === true && by['nature-tree.png'].artist === '');
    assert.ok(by['nature-wide.png'] && by['nature-wide.png'].nature === true, 'already prefixed: kept as is');
    assert.ok(by['plain.png'] && !('nature' in by['plain.png']));
    assert.ok(logs.some((l) => /nature stickers .*: 2/.test(l)), logs.join('\n'));
  });
  const store = createStore(new LocalAdapter(path.join(tmp, 'data')), { writeDelayMs: 20, log: { error() {}, log() {} } });
  const lib = loadLibrary(out);
  await seedLibrary(store, lib, { log: { log() {}, error() {} } });
  const KEY = 'nature-test-key-123456';
  const NKEY = 'nature-only-key-123456';
  const app = createApp(store, { quickTtlHours: 24, log: { error() {}, log() {} }, library: lib, entitle: makeEntitlements({ FULL_ACCESS_KEYS: `${KEY},${NKEY}:natureStickers` }) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const pub = (await (await fetch(`${base}/api/library`)).json()).stickers;
    const pb = Object.fromEntries(pub.map((s) => [s.id, s]));
    await ok('GET /api/library: nature: true on the nature stickers only', () => {
      assert.equal(pb[by['nature-tree.png'].id].nature, true); assert.equal(pb[by['nature-wide.png'].id].nature, true); assert.ok(!('nature' in pb[by['plain.png'].id]));
    });
    const fd = new FormData(); fd.append('name', 'nature-sneaky.png'); fd.append('file', new Blob([await png('#333333')], { type: 'image/png' }), 'nature-sneaky.png');
    const upload = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
    const slap = async (imageId, size, key) => {
      const r = await fetch(`${base}/api/rooms/nature/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'x-unlock': key } : {}) },
        body: JSON.stringify({ imageId, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size, surface: 'vägg-norr' }) });
      const j = await r.json(); return r.ok ? j.stamp.size : `HTTP ${r.status}`;
    };
    const tree = by['nature-tree.png'].id, wide = by['nature-wide.png'].id, plain = by['plain.png'].id;
    await ok('paywall: the free version may NOT slap a nature sticker (403, full: true) – nothing saved', async () => {
      const r = await fetch(`${base}/api/rooms/nature/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: tree, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 1, surface: 'vägg-norr' }) });
      const j = await r.json();
      assert.equal(r.status, 403); assert.equal(j.full, true); assert.equal(j.feature, 'natureStickers');
      const room = await (await fetch(`${base}/api/rooms/nature`)).json();
      assert.ok(!JSON.stringify(room).includes(tree), 'no nature stamp saved');
    });
    await ok('full version, nature (portrait): no upper and no lower limit (3 / 8 / 9 / 50 m, 20 / 12 / 3 / 0.5 cm kept; 0.001 cm → 0.01 cm epsilon)', async () => {
      assert.equal(await slap(tree, 3, KEY), 3); assert.equal(await slap(tree, 8, KEY), 8); assert.equal(await slap(tree, 9, KEY), 9); assert.equal(await slap(tree, 50, KEY), 50);
      assert.equal(await slap(tree, 0.2, KEY), 0.2); assert.equal(await slap(tree, 0.12, KEY), 0.12); assert.equal(await slap(tree, 0.03, KEY), 0.03); assert.equal(await slap(tree, 0.005, KEY), 0.005);
      assert.equal(await slap(tree, 0.00001, KEY), 0.0001);
    });
    await ok('nature, wide 4:1: the cap is 8 m HIGH = 32 m longest side', async () => {
      assert.equal(await slap(wide, 24, KEY), 24); assert.ok(near(await slap(wide, 60, KEY), 60));
    });
    await ok('a key with only natureStickers (no bigStickers): nature has no upper or lower limit', async () => { assert.equal(await slap(tree, 3, NKEY), 3); assert.equal(await slap(tree, 0.03, NKEY), 0.03); assert.equal(await slap(tree, 50, NKEY), 50); });
    await ok('other stickers: free/full: no upper or lower limit (Jens, 11 Nov 2026; epsilon 0.01 cm); a user upload named "nature…" is NOT nature', async () => {
      assert.equal(await slap(plain, 3), 3); assert.equal(await slap(plain, 0.06), 0.06); assert.equal(await slap(plain, 0.5), 0.5); assert.equal(await slap(plain, 9), 9); assert.equal(await slap(plain, 0.002), 0.002);
      assert.equal(await slap(plain, 9, KEY), 9); assert.equal(await slap(plain, 40, KEY), 40); assert.equal(await slap(plain, 4, KEY), 4); assert.equal(await slap(plain, 0.06, KEY), 0.06); assert.equal(await slap(plain, 1.2, KEY), 1.2);
      assert.equal(await slap(upload.id, 3), 3);
    });
    await ok('sane guards: NaN / 0 / negative / strings refused, also for nature (a tiny positive size is fine)', async () => {
      assert.equal(await slap(tree, 'big', KEY), 'HTTP 400'); assert.equal(await slap(tree, 0, KEY), 'HTTP 400'); assert.equal(await slap(tree, -0.3, KEY), 'HTTP 400'); assert.equal(await slap(tree, null, KEY), 'HTTP 400');
      assert.equal(await slap(tree, 0.01, KEY), 0.01);
    });
    await ok('peels on: a nature sticker drops NO backing paper (single slap and a row); a normal one still does', async () => {
      const post = (url, body, h = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) });
      const { room: { id: R }, roomKey: RK } = await (await post('/api/rooms', {})).json();
      const put = await fetch(`${base}/api/rooms/${R}/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': RK }, body: JSON.stringify({ on: true }) });
      assert.ok(put.ok, 'peels on');
      const count = async () => (await store.peelState(R)).peels.length;
      const one = (imageId, x) => post(`/api/rooms/${R}/stamps`, { imageId, position: [x, 1.5, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr', owner: 'device-nature' }, { 'x-unlock': KEY }).then((r) => r.json());
      const nat = await one(tree, -2);
      assert.ok(nat.stamp && !nat.peel, 'nature slap: stamp, no peel'); assert.equal(await count(), 0);
      const freeRow = await post(`/api/rooms/${R}/stamps/array`, { anchor: { id: nat.stamp.id, token: nat.peelToken }, to: [-0.5, 1.5, -5], nonce: 'natrow0' });
      assert.equal(freeRow.status, 403, 'a nature row without the full version: 403');
      const row = await (await post(`/api/rooms/${R}/stamps/array`, { anchor: { id: nat.stamp.id, token: nat.peelToken }, to: [-0.5, 1.5, -5], nonce: 'natrow1' }, { 'x-unlock': KEY })).json();
      assert.ok(Array.isArray(row.stamps) && row.stamps.length >= 3, JSON.stringify(row).slice(0, 200));
      assert.ok(row.stamps.every((r) => !r.peel), 'no peel on any copy'); assert.equal(await count(), 0, 'no papers stored');
      const norm = await one(plain, 2);
      assert.ok(norm.peel, 'normal sticker: its paper'); assert.equal(await count(), 1);
      const row2 = await (await post(`/api/rooms/${R}/stamps/array`, { anchor: { id: norm.stamp.id, token: norm.peelToken }, to: [3.2, 1.5, -5], nonce: 'plainrow1' })).json();
      assert.equal(await count(), 1 + row2.stamps.length, 'a normal row: one paper per copy as before');
    });
    await ok('peels on: a sticker over 1 m drops NO backing paper (single slap and a row); 1 m and below still does (Jens, 10 Nov 2026)', async () => {
      const post = (url, body, h = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) });
      const { room: { id: R }, roomKey: RK } = await (await post('/api/rooms', {})).json();
      assert.ok((await fetch(`${base}/api/rooms/${R}/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': RK }, body: JSON.stringify({ on: true }) })).ok, 'peels on');
      const count = async () => (await store.peelState(R)).peels.length;
      const one = (size, x) => post(`/api/rooms/${R}/stamps`, { imageId: plain, position: [x, 2, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size, surface: 'vägg-norr', owner: 'device-bigpaper' }, { 'x-unlock': KEY }).then((r) => r.json());
      const at1 = await one(1, -4);
      assert.ok(at1.stamp && at1.peel, '1 m: its paper'); assert.equal(await count(), 1);
      const big = await one(1.2, 0);
      assert.ok(big.stamp && Math.abs(big.stamp.size - 1.2) < 1e-9 && !big.peel, '1.2 m: stamp, no paper'); assert.equal(await count(), 1);
      const huge = await one(4, 4);
      assert.ok(huge.stamp && !huge.peel, '4 m: no paper'); assert.equal(await count(), 1);
      const row = await (await post(`/api/rooms/${R}/stamps/array`, { anchor: { id: big.stamp.id, token: big.peelToken }, to: [6, 2, -5], nonce: 'bigrow1' }, { 'x-unlock': KEY })).json();
      assert.ok(Array.isArray(row.stamps) && row.stamps.length >= 2 && row.stamps.every((r) => !r.peel), JSON.stringify(row).slice(0, 200)); assert.equal(await count(), 1, 'no papers for a 1.2 m row');
    });
  } finally { server.close(); }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\nnature: ${n} passed`);
