// Sticker arrays (slap at A, hold, drag to B): the spacing math (shared/array.mjs) and the server's
// batch endpoint POST /api/rooms/:room/stamps/array (atomic, limits, cap, permissions, broadcast,
// recording, one peel step, backing paper).   Run: node tests/array.test.mjs
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
process.env.MAX_STAMPS_PER_ROOM = '60';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime, onBroadcast } = require('../server/realtime');
const { createRecorder } = require('../server/recorder');
const { arrayPlan, arrayStep, ARRAY_MAX } = await import('../shared/array.mjs');
const { parseRecording, buildTimeline } = await import('../shared/replay.mjs');

let n = 0;
const assert = (c, m, extra) => { if (!c) { console.error('FEL: ' + m, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); } n++; console.log('✔ ' + m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- The spacing math ----------
const wall = { position: [0, 2, -5], quaternion: [0, 0, 0, 1], surface: 'vägg-norr' }; // north wall, upright
{
  const p = arrayPlan(wall, 0.2, 0.3, [1, 2, -5]);
  assert(near(p.step, 0.2) && p.count === 6 && p.items.length === 6 && near(p.items[5].position[0], 1) && p.items.every((x) => x.position[1] === 2 && x.position[2] === -5),
    'horizontal: step = the width (0.2 m), count = floor(1 / 0.2) + 1 = 6, all on the wall plane');
  const v = arrayPlan(wall, 0.2, 0.3, [0, 3.05, -5]);
  assert(near(v.step, 0.3) && v.count === 4 && near(v.items[3].position[1], 2.9), 'vertical: step = the height (0.3 m), 1.05 m → 4 stickers');
  const d = arrayPlan(wall, 0.2, 0.4, [-1, 1, -5]); // down-left at 45°, a tall sticker
  const [a, b] = [d.items[0].position, d.items[1].position];
  assert(near(d.step, 0.2 * Math.SQRT2) && near(Math.abs(b[0] - a[0]), 0.2) && near(Math.abs(b[1] - a[1]), 0.2),
    'diagonal: a staircase, each copy one width across and offset along the line (they touch along the vertical edge)');
  assert(near(arrayStep(Math.cos(0.3), Math.sin(0.3), 0.2, 0.4), 0.2 / Math.cos(0.3)) && near(arrayStep(Math.cos(1.4), Math.sin(1.4), 0.2, 0.4), 0.4 / Math.sin(1.4)),
    'arrayStep = min(w/|du|, h/|dv|): the width rules near horizontal, the height near vertical');
  // Rotated 90°: the sticker's width axis is now vertical, so a horizontal drag steps by its height.
  const q90 = [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)];
  const r = arrayPlan({ ...wall, quaternion: q90 }, 0.2, 0.3, [1.2, 2, -5]);
  assert(near(r.step, 0.3) && r.count === 5, 'rotation: a sticker turned 90° steps by its (now horizontal) height along a horizontal drag');
  const big = arrayPlan(wall, 0.4, 0.6, [1, 2, -5]);
  assert(near(big.step, 0.4) && big.count === 3, 'size: a bigger sticker gets a bigger step (0.4 m → 3 in 1 m)');
  const edge = arrayPlan({ ...wall, position: [4.5, 2, -5] }, 0.3, 0.3, [9, 2, -5]);
  assert(edge.count === 16 && edge.items.length === 2 && edge.items.every((x) => x.position[0] <= 5), 'copies whose centre falls off the face are not placed (no wrapping)', edge.items);
  const tiny = arrayPlan(wall, 0.2, 0.3, [0.15, 2.1, -5]);
  assert(tiny.count === 1 && tiny.items.length === 1, 'a drag shorter than one step = just the anchor (a plain click)');
  const off = arrayPlan(wall, 0.2, 0.3, [1, 2, 3]);
  assert(off.count === 6 && off.items.every((x) => x.position[2] === -5), 'B off the wall plane: only the part along the face counts');
  const many = arrayPlan(wall, 0.02, 0.02, [4.9, 2, -5]);
  assert(many.count === ARRAY_MAX && ARRAY_MAX === 200, 'at most 200 stickers per drag');
  const floor = arrayPlan({ position: [0, 0, 0], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], surface: 'golv' }, 0.2, 0.2, [0, 0.5, -1]);
  assert(floor.items.length === 6 && floor.items.every((x) => x.position[1] === 0) && near(floor.items[5].position[2], -1), 'floor: works the same on the floor (y stays 0)');
}

// ---------- The server ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-array-'));
const store = createStore(new LocalAdapter(dir), { writeDelayMs: 20, log: { error: () => {}, log: () => {} } });
const recorder = createRecorder(store, { flushMs: 100, tickMs: 20 });
const app = createApp(store, { adminToken: 'arr-admin', recorder, log: { log: () => {}, error: () => {}, warn: () => {} } });
const server = app.listen(0);
const rt = attachRealtime(server, { maxPlayers: 5, heartbeatMs: 500, recorder });
const base = `http://127.0.0.1:${server.address().port}`;
const events = [];
const off = onBroadcast((room, e) => events.push({ room, e }));
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const sockets = [];
try {
  const fd = new FormData(); fd.append('file', new Blob([await sharp({ create: { width: 64, height: 32, channels: 4, background: '#ff00aa' } }).png().toBuffer()], { type: 'image/png' }), 'k.png');
  const img = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
  const { room: { id: R }, roomKey: KEY } = await (await post('/api/rooms', {})).json();
  const slap = (pos, extra = {}) => post(`/api/rooms/${R}/stamps`, { imageId: img.id, position: pos, normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr', owner: 'device-aaaa', ...extra }).then((r) => r.json());
  const array = (body) => post(`/api/rooms/${R}/stamps/array`, body);

  // Record it, so replays/videos show the row.
  const rec = (await (await post(`/api/rooms/${R}/recording/start`, {}, { 'x-room-key': KEY })).json()).recording;
  const A = await slap([0, 2, -5]);
  events.length = 0;
  // 64×32 at 0.3 m = 0.3 × 0.15: drag 1.2 m right → floor(1.2 / 0.3) + 1 = 5 (4 copies)
  const res = await array({ anchor: { id: A.stamp.id, token: A.peelToken }, to: [1.2, 2, -5], nonce: 'abc123' });
  const out = await res.json();
  assert(res.status === 200 && out.stamps.length === 4 && out.stamps.map((x) => x.i).join() === '1,2,3,4', 'the batch adds the 4 copies (i = 1…4), the anchor is not repeated', out);
  assert(out.stamps.every((x, k) => near(x.stamp.position[0], 0.3 * (k + 1)) && x.stamp.size === 0.3 && x.stamp.group === A.stamp.id && x.stamp.quaternion.join() === '0,0,0,1'),
    'copies: same size and orientation as the anchor, edge to edge, group = the anchor');
  assert(!JSON.stringify(out).includes('peelHash') && !out.peelToken, 'no peel keys or hashes in the answer (the anchor’s key already peels the row)');
  const adds = events.filter((x) => x.room === R && x.e.type === 'stamp:add');
  assert(adds.length === 4 && adds.every((x, k) => x.e.nonce === `abc123x${k + 1}` && x.e.batch.g === A.stamp.id && x.e.batch.n === 4 && x.e.image.id === img.id),
    'broadcast: one ordinary stamp:add per copy, nonce "<nonce>x<i>", batch = { g, i, n }');
  let room = await store.getRoom(R);
  const ids = out.stamps.map((x) => x.stamp.id);
  assert(room.stamps.length === 5 && room.stamps.slice(1).every((s) => s.peelHash === room.stamps[0].peelHash), 'saved in one step; all copies share the anchor’s peel key');

  // Permissions and validation
  assert((await array({ anchor: { id: A.stamp.id, token: 'wrong' }, to: [1, 2, -5] })).status === 403, 'someone else’s sticker (wrong peel key): 403');
  assert((await array({ anchor: { id: 'ffffffffffffffff', token: 'x' }, to: [1, 2, -5] })).status === 404, 'unknown anchor: 404');
  assert((await array({ anchor: { id: A.stamp.id, token: A.peelToken }, to: [0.1, 2, -5] })).status === 400, 'a drag shorter than one step: 400 (nothing to repeat)');
  assert((await array({ anchor: { id: A.stamp.id, token: A.peelToken }, to: 'x' })).status === 400 && (await array({ to: [1, 2, -5] })).status === 400, 'bad input: 400');
  // Size limits ride on the anchor: a free 3 m slap is clamped to 1 m, and so is every copy.
  const huge = await slap([-3, 2, -5], { size: 3 });
  const hr = await (await array({ anchor: { id: huge.stamp.id, token: huge.peelToken }, to: [-3, 0, -5] })).json();
  assert(huge.stamp.size === 1 && hr.stamps.every((x) => x.stamp.size === 1), 'free version: the anchor is clamped to 1 m and the copies copy that');

  // One peel step: the anchor's key peels the whole row (POST /peel with the same token for every id).
  const peel = await (await post(`/api/rooms/${R}/peel`, { items: [A.stamp.id, ...ids].map((id) => ({ id, token: A.peelToken })) })).json();
  room = await store.getRoom(R);
  assert(Object.values(peel.results).every((r) => r === 'ok') && !room.stamps.some((s) => [A.stamp.id, ...ids].includes(s.id)), 'the anchor’s peel key peels the whole row');

  // History: a row counts as ONE of the 20 peel steps.
  const first = await slap([2, 3, -5], { owner: 'device-bbbb' });
  await array({ anchor: { id: first.stamp.id, token: first.peelToken }, to: [4, 3, -5] }); // 1 step (7 stickers)
  for (let k = 0; k < 19; k++) await slap([-4 + k * 0.4, 0.5, -5], { owner: 'device-bbbb' });
  room = await store.getRoom(R);
  const row = room.stamps.filter((s) => s.id === first.stamp.id || s.group === first.stamp.id);
  assert(row.length === 7 && row.every((s) => s.peelHash), 'a row + 19 single slaps = 20 steps: the row is still peelable');
  await slap([-4, 0.2, -5], { owner: 'device-bbbb' });
  room = await store.getRoom(R);
  assert(room.stamps.filter((s) => s.id === first.stamp.id || s.group === first.stamp.id).every((s) => !s.peelHash), 'the 21st step: the whole row leaves the history together (auto-prune sees them all)');
  assert((await array({ anchor: { id: first.stamp.id, token: first.peelToken }, to: [4, 3, -5] })).status === 403, 'a row can’t be extended once its anchor left the history');

  // Room cap (60 here): oldest go, broadcast as stamp:remove before the new adds.
  room = await store.getRoom(R);
  const before = room.stamps.length;
  const tinyA = await slap([-4.9, 3.9, -5], { size: 0.15, owner: 'device-cccc' });
  events.length = 0;
  const big = await (await array({ anchor: { id: tinyA.stamp.id, token: tinyA.peelToken }, to: [0, 3.9, -5] })).json(); // 0.15 × 0.075 → 32 copies
  room = await store.getRoom(R);
  const rem = events.filter((x) => x.e.type === 'stamp:remove');
  assert(room.stamps.length === 60 && big.stamps.length === 32 && rem.length === before + 1 + 32 - 60 && events.findIndex((x) => x.e.type === 'stamp:remove') < events.findIndex((x) => x.e.type === 'stamp:add'),
    'room cap: the oldest stickers drop (stamp:remove first), the room stays at the cap', { len: room.stamps.length, rem: rem.length, before, n: big.stamps.length });

  // Recording: the copies are ordinary stamp:add lines, so the replay has them.
  await sleep(150);
  await post(`/api/rooms/${R}/recording/stop`, {}, { 'x-room-key': KEY });
  const tl = buildTimeline(parseRecording(await (await fetch(`${base}/api/rooms/${R}/recordings/${rec.recId}/log`)).text()));
  assert(ids.every((id) => tl.stamps.has(id) && tl.stamps.get(id).to !== Infinity) && big.stamps.every((x) => tl.stamps.has(x.stamp.id)), 'the recording has every copy (and their peel), so replays and videos show the row');

  // Peels on (backing paper): no reach limit; one paper per copy for the first 4 (5 with the anchor's).
  await fetch(`${base}/api/rooms/${R}/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': KEY }, body: JSON.stringify({ on: true }) });
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${R}`); sockets.push(ws);
  const msgs = []; ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r)); ws.send(JSON.stringify({ t: 'hello', name: 'Jens', p: [0, 1.6, -3.5], y: 0 }));
  let w; for (let k = 0; k < 100 && !(w = msgs.find((m) => m.t === 'welcome')); k++) await sleep(20);
  const pa = await slap([0, 1, -5], { by: w.id, nonce: 'pp1', owner: 'device-dddd' });
  assert(pa.peel, 'peels on: the anchor drops its own backing paper');
  const pr = await (await array({ anchor: { id: pa.stamp.id, token: pa.peelToken }, to: [4.5, 1, -5], by: w.id, nonce: 'pp1' })).json();
  assert(pr.stamps.length === 15 && pr.stamps.filter((x) => x.peel).length === 4 && pr.stamps.slice(0, 4).every((x) => x.peel && x.peel.seed === `pp1x${x.i}`),
    'peels on: the row runs along the wall, and the first 4 copies drop a paper each (seed = their nonce)', pr.stamps.map((x) => !!x.peel));
  const fr = await post(`/api/rooms/${R}/stamps`, { imageId: img.id, position: [0, 1, 4.9], normal: [0, 0, -1], quaternion: [0, 1, 0, 0], size: 0.3, surface: 'vägg-söder', by: w.id });
  assert(fr.status === 200, 'peels on: a slap ~8.5 m away is accepted too (no reach limit)', fr);
} finally {
  off(); for (const s of sockets) s.terminate(); await recorder.close(); rt.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\narray: ${n} passed`);
process.exit(0);
