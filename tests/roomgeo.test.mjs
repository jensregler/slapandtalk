// Unit: the bigger room (Jens, 2 Nov 2026, t475u: 16 × 8 × 16 m, was 10 × 4 × 10 m; shared/roomgeo.mjs).
// Old stickers move out with their surface (same size, same height, same place along the wall), old
// rooms are remapped once on load (server/store.js, room.geo), old recordings in the replay, and old
// presets' sheets keep their real size in the middle of each surface, bottom-aligned on the walls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ROOM from '../shared/room.json' with { type: 'json' };
import { LEGACY_ROOM, CURRENT_KEY, remapStamp, remapStamps, presetSheet, faceOf } from '../shared/roomgeo.mjs';
import { parseRecording } from '../shared/replay.mjs';
import { NATURE, STICKER_LIMITS, natureMaxSideCm } from '../shared/nature.mjs';
const require = createRequire(import.meta.url);
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };

await ok('the room is 16 × 8 × 16 m', () => { assert.deepEqual([ROOM.width, ROOM.height, ROOM.depth], [16, 8, 16]); assert.equal(CURRENT_KEY, '16x8x16'); });
await ok('sizes: stickers 10 cm – 1.5 m (free 15 cm – 1 m); nature 10 cm up to the room height (8 m) high', () => {
  assert.deepEqual({ ...STICKER_LIMITS.full }, { minCm: 10, maxCm: 150 }); assert.deepEqual({ ...STICKER_LIMITS.free }, { minCm: 15, maxCm: 100 });
  assert.equal(NATURE.minCm, 10); assert.equal(NATURE.maxHeightCm, 800);
  assert.equal(natureMaxSideCm({ width: 500, height: 1000 }), 800); assert.equal(natureMaxSideCm({ width: 1000, height: 500 }), 1600);
});
const S = (surface, position, normal) => ({ id: surface, surface, position, normal, quaternion: [0, 0, 0, 1], size: 0.3 });
await ok('an old sticker moves out with its surface: walls 5 → 8 m, ceiling 4 → 8 m, floor stays; height and place along the wall kept', () => {
  assert.deepEqual(remapStamp(S('vägg-norr', [1.2, 1.5, -5], [0, 0, 1])).position, [1.2, 1.5, -8]);
  assert.deepEqual(remapStamp(S('vägg-söder', [-2, 3.9, 5], [0, 0, -1])).position, [-2, 3.9, 8]);
  assert.deepEqual(remapStamp(S('vägg-väster', [-5, 0.4, 3], [1, 0, 0])).position, [-8, 0.4, 3]);
  assert.deepEqual(remapStamp(S('vägg-öster', [5, 2, -4.9], [-1, 0, 0])).position, [8, 2, -4.9]);
  assert.deepEqual(remapStamp(S('tak', [3, 4, 3], [0, -1, 0])).position, [3, 8, 3]);
  const floor = S('golv', [4, 0.002, -4], [0, 1, 0]); assert.equal(remapStamp(floor), floor);
  assert.equal(faceOf('', [0, 0, 1]), 'north'); assert.deepEqual(remapStamp({ ...S('', [0, 1, -5], [0, 0, 1]) }).position, [0, 1, -8]); // no surface name: by the normal
  const r = remapStamp(S('vägg-norr', [0, 1, -5], [0, 0, 1])); assert.equal(r.size, 0.3); assert.deepEqual(r.quaternion, [0, 0, 0, 1]);
  assert.equal(remapStamps([S('vägg-norr', [0, 1, -8], [0, 0, 1])], CURRENT_KEY)[0].position[2], -8); // already in the new box: unchanged
});
await ok('an old room is remapped once on load (store.js, geo), new rooms are not touched', async () => {
  const { createStore } = require('../server/store.js');
  const { LocalAdapter } = require('../server/storage/local.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roomgeo-'));
  const a = new LocalAdapter(dir);
  await a.put('rooms/oldroom1.json', Buffer.from(JSON.stringify({ id: 'oldroom1', type: 'quick', createdAt: '2026-10-30T10:00:00Z', lastVisitAt: '2026-10-30T10:00:00Z', stamps: [S('vägg-norr', [0, 1, -5], [0, 0, 1]), S('tak', [0, 4, 0], [0, -1, 0]), S('golv', [1, 0.002, 1], [0, 1, 0])] })));
  const store = createStore(a, { writeDelayMs: 10 });
  const r = await store.getRoom('oldroom1');
  assert.deepEqual(r.stamps.map((x) => x.position), [[0, 1, -8], [0, 8, 0], [1, 0.002, 1]]);
  await store.addStamp('oldroom1', S('vägg-öster', [8, 2, 0], [-1, 0, 0])); await store.flush();
  const raw = JSON.parse((await a.get('rooms/oldroom1.json')).toString());
  assert.equal(raw.geo, '16x8x16'); assert.deepEqual(raw.stamps.map((x) => x.position), [[0, 1, -8], [0, 8, 0], [1, 0.002, 1], [8, 2, 0]]);
  const again = createStore(a); const r2 = await again.getRoom('oldroom1'); // a restart: not moved a second time
  assert.deepEqual(r2.stamps.map((x) => x.position), raw.stamps.map((x) => x.position));
  fs.rmSync(dir, { recursive: true, force: true });
});
await ok('an old recording: its stickers (start + stamp:add) move the same way in the replay', () => {
  const head = { format: 'slapandtalk-rec', v: 1, startedAt: '2026-10-30T10:00:00Z', stamps: [S('vägg-norr', [0, 1, -5], [0, 0, 1])] };
  const ev = { t: 100, e: 'stamp:add', stamp: S('tak', [1, 4, 1], [0, -1, 0]) };
  const rec = parseRecording([JSON.stringify(head), JSON.stringify(ev)].join('\n'));
  assert.deepEqual(rec.header.stamps[0].position, [0, 1, -8]); assert.deepEqual(rec.events[0].stamp.position, [1, 8, 1]);
  const now = parseRecording([JSON.stringify({ ...head, geo: CURRENT_KEY }), JSON.stringify(ev)].join('\n'));
  assert.deepEqual(now.header.stamps[0].position, [0, 1, -5]); // a new recording: as recorded
});
await ok('an old preset sheet keeps its real size (never stretched): middle of each surface, bottom-aligned on the walls', () => {
  assert.deepEqual(presetSheet('north', LEGACY_ROOM), { w: 10, h: 4, center: [0, 2, -8] });
  assert.deepEqual(presetSheet('west', LEGACY_ROOM), { w: 10, h: 4, center: [-8, 2, 0] });
  assert.deepEqual(presetSheet('ceiling', LEGACY_ROOM), { w: 10, h: 10, center: [0, 8, 0] });
  assert.deepEqual(presetSheet('floor', LEGACY_ROOM), { w: 10, h: 10, center: [0, 0, 0] });
  assert.deepEqual(presetSheet('south', ROOM), { w: 16, h: 8, center: [0, 4, 8] }); // a new preset: the whole wall
});
console.log(`roomgeo: ${n} passed`);
