// Hold-and-drag (sticker rows) everywhere (Jens, 11 Nov 2026: "reactivate hold-and-drag … hold, drag and
// scale at the same time"). Rows used to be planned on the 16 × 8 × 16 m ROOM box only, so in the
// 96 × 96 m city a drag anywhere away from the middle gave no copies. Now the row's face is THIS space's
// (shared/city.mjs roomBox) clipped to the real surface the anchor hit (shared/array.mjs anchorFace /
// clipFace), in the web app, the server and the replay. Run: node tests/arrayspace.test.mjs
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { arrayPlan, anchorFace, clipFace, spaceFaces, wheelScaleFactor, clampStampSize } = await import('../shared/array.mjs');
const { CITY, CITY_ROOM, roomBox } = await import('../shared/city.mjs');

let n = 0;
const assert = (c, m, extra) => { if (!c) { console.error('FEL: ' + m, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); } n++; console.log('✔ ' + m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const UP = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // a sticker lying on the ground (normal +y)

// ---------- the math ----------
{
  const ground = { position: [0, 0, 30], quaternion: UP, surface: 'golv' }; // out in the city, 30 m south of the middle
  const old = arrayPlan(ground, 0.2, 0.2, [1, 0, 30]); // the old default: the 16 m room box
  assert(old.items.length === 0, 'before: on the city ground 30 m out, the 16 m room box gave NO copies (hold-and-drag dead)', old);
  const F = anchorFace(ground, { box: roomBox(CITY_ROOM) });
  const row = arrayPlan(ground, 0.2, 0.2, [1, 0, 30], { faces: [F] });
  assert(row.items.length === 6 && row.items.every((x) => x.position[1] === 0 && x.position[2] === 30) && near(row.items[5].position[0], 1),
    'now: the same drag in the city plans 6 stickers along the ground (the 96 m space)', row.items.map((x) => x.position));
  // a house wall (facing +x at x = 30, 8 m high, 16 m wide around z = 30): the row stops at its edge
  const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // normal +x
  const wallA = { position: [30, 2, 37], quaternion: q, surface: 'house-3-east' };
  const rect = { lo: [30, 0, 22], hi: [30, 8, 38] };
  const Fw = anchorFace(wallA, { box: CITY, rect });
  assert(Fw && Fw.k === 0 && Fw.name === 'house-3-east' && near(Fw.hi[2], 38) && near(Fw.lo[1], 0) && near(Fw.hi[1], 8), 'a house wall: the face is clipped to that wall’s rect', Fw);
  const w = arrayPlan(wallA, 0.3, 0.3, [30, 2, 45], { faces: [Fw] });
  assert(w.items.length === 4 && w.items.every((x) => x.position[2] <= 38 + 1e-9), 'a row toward the wall’s end stops at the edge (no copies in the air)', w.items.map((x) => x.position));
  const inRoom = anchorFace({ position: [0, 2, -8], quaternion: [0, 0, 0, 1], surface: 'vägg-norr' }, { box: roomBox('abcdef') });
  assert(inRoom && near(inRoom.lo[0], -8) && near(inRoom.hi[0], 8) && near(inRoom.hi[1], 8), 'a normal room: the same 16 × 8 × 16 box as before (rooms unchanged)', inRoom);
  const base = spaceFaces(CITY).find((f) => f.name === 'golv');
  assert(clipFace(base, { lo: [100, 0, 100], hi: [120, 0, 120] }, [0, 0, 30]) === base && clipFace(base, { lo: 'x' }) === base && clipFace(base, { lo: [-200, 0, -200], hi: [200, 0, 200] }).hi[0] === 48,
    'clipFace only ever shrinks the face: a rect that misses the anchor, junk, or a bigger rect is ignored / capped by the space');
  // drag + scale at once: the wheel while dragging fans the row (last sticker bigger/smaller)
  const end = clampStampSize(0.2 * wheelScaleFactor(-3, 1), 0.05, Infinity);
  const fan = arrayPlan(ground, 0.2, 0.2, [3, 0, 30], { faces: [F], endW: end, endH: end });
  assert(end > 0.2 && near(fan.items[0].w, 0.2) && fan.items.at(-1).w > 0.2 && fan.items.every((x, i) => i === 0 || x.w >= fan.items[i - 1].w),
    `drag + scale: 3 wheel notches up while dragging → the last sticker ${Math.round(end * 100)} cm, the row grows from 20 cm toward it`, fan.items.map((x) => x.w));
}

// ---------- the server, in the city ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-arrayspace-'));
const store = createStore(new LocalAdapter(dir), { writeDelayMs: 20, log: { error: () => {}, log: () => {} } });
const app = createApp(store, { adminToken: 'as-admin', log: { log: () => {}, error: () => {}, warn: () => {} } });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
try {
  const fd = new FormData(); fd.append('file', new Blob([await sharp({ create: { width: 64, height: 64, channels: 4, background: '#22aaff' } }).png().toBuffer()], { type: 'image/png' }), 'k.png');
  const img = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
  const R = CITY_ROOM;
  await fetch(`${base}/api/rooms/${R}/stamps`);
  const slap = async (position, quaternion, normal, surface) => { const r = await post(`/api/rooms/${R}/stamps`, { imageId: img.id, position, normal, quaternion, size: 0.2, surface, owner: 'device-city' }); return { status: r.status, body: await r.json() }; };
  const A = await slap([0, 0, 30], UP, [0, 1, 0], 'golv');
  assert(A.status === 200 && A.body.peelToken, 'a slap on the city ground 30 m out', A);
  const r1 = await post(`/api/rooms/${R}/stamps/array`, { anchor: { id: A.body.stamp.id, token: A.body.peelToken }, to: [1, 0, 30] });
  const b1 = await r1.json();
  assert(r1.status === 200 && b1.stamps.length === 5 && b1.stamps.every((x) => x.stamp.position[2] === 30 && x.stamp.position[1] === 0), 'server: hold-and-drag in the city saves the row (5 copies) – it was "Nothing to repeat"', { status: r1.status, n: b1.stamps?.length, b1: b1.error });
  // the client's surface rect narrows the row; a rect that doesn't hold the anchor is ignored
  const B = await slap([0, 0, 34], UP, [0, 1, 0], 'golv');
  const r2 = await post(`/api/rooms/${R}/stamps/array`, { anchor: { id: B.body.stamp.id, token: B.body.peelToken }, to: [2, 0, 34], rect: { lo: [-1, 0, 33], hi: [0.5, 0, 35] } });
  const b2 = await r2.json();
  assert(r2.status === 200 && b2.stamps.length === 2 && b2.stamps.every((x) => x.stamp.position[0] <= 0.5 + 1e-9), 'server: the surface rect clips the row at the surface’s edge', b2.stamps?.map((x) => x.stamp.position));
  const C = await slap([0, 0, 38], UP, [0, 1, 0], 'golv');
  const r3 = await post(`/api/rooms/${R}/stamps/array`, { anchor: { id: C.body.stamp.id, token: C.body.peelToken }, to: [1, 0, 38], rect: { lo: [10, 0, 10], hi: [12, 0, 12] } });
  assert(r3.status === 200 && (await r3.json()).stamps.length === 5, 'server: a rect that misses the anchor is ignored (it can only shrink, never break or grow, the row)');
  // fan in the city: endSize rides along
  const D = await slap([0, 0, 42], UP, [0, 1, 0], 'golv');
  const r4 = await post(`/api/rooms/${R}/stamps/array`, { anchor: { id: D.body.stamp.id, token: D.body.peelToken }, to: [3, 0, 42], endSize: 0.4 });
  const b4 = await r4.json();
  assert(r4.status === 200 && b4.stamps.length >= 3 && b4.stamps.at(-1).stamp.size > b4.stamps[0].stamp.size && b4.stamps.at(-1).stamp.size > 0.2,
    'server: drag + scale (endSize) works in the city too – the copies grow toward the end', b4.stamps?.map((x) => x.stamp.size));
} finally { server.close(); await store.flush?.(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(`\narrayspace: ${n} passed`);
process.exit(0);
