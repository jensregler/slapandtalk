// The held sticker in session recordings (event 'held'): the server takes it only from players,
// only into a running recording (never relayed live), cleans it, throttles it (~10/s, the latest
// always comes, a let-go at once), puts the design's metadata on the first line that uses it; the
// replay (shared/replay.mjs heldAt / snapshotAt) shows it from pickup to let-go, glides between
// updates, and old recordings without it still play.   Run: node tests/heldrec.test.mjs
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime, cleanHeld } = require('../server/realtime');
const { createRecorder } = require('../server/recorder');
const { parseRecording, buildTimeline, snapshotAt, heldAt } = await import('../shared/replay.mjs');

let n = 0;
const assert = (c, m, extra) => { if (!c) { console.error('FEL: ' + m, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); } n++; console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// ---------- cleanHeld ----------
{
  const B = { x: 5, y: 4, z: 5 };
  const ok = cleanHeld({ img: 'abcdef0123456789', p: [0, 2, -9], n: [0, 0, 2], q: [0, 0, 0, 2], w: 9, h: 0.0001, s: 'vägg-norr\u202e' }, B);
  assert(ok && ok.p[2] === -5 && ok.n[2] === 1 && ok.q[3] === 1 && ok.w === 4 && ok.h === 0.01 && ok.s === 'vägg-norr', 'cleanHeld: position clamped to the room, normal/quaternion normalised, size clamped, surface without control chars', ok);
  assert(cleanHeld(null, B) === null, 'cleanHeld: null = let go');
  for (const bad of [{}, { img: 'x', p: [0, 0, 0], n: [0, 0, 1], q: [0, 0, 0, 1], w: 1, h: 1 }, { img: 'abcdef0123456789', p: [0, 0], n: [0, 0, 1], q: [0, 0, 0, 1], w: 1, h: 1 },
    { img: 'abcdef0123456789', p: [0, 0, 0], n: [0, 0, 0], q: [0, 0, 0, 1], w: 1, h: 1 }, { img: 'abcdef0123456789', p: [0, 0, 0], n: [0, 0, 1], q: [0, 0, 0, 1], w: 'a', h: 1 }, 'x', 5])
    if (cleanHeld(bad, B) !== undefined) assert(false, 'cleanHeld: malformed is dropped', bad);
  assert(true, 'cleanHeld: malformed input is dropped (undefined)');
}

// ---------- The replay (pure) ----------
{
  const img = { id: 'abcdef0123456789', url: '/uploads/abcdef0123456789.webp', width: 10, height: 10 };
  const H = (x) => ({ img: img.id, p: [x, 2, -5], n: [0, 0, 1], q: [0, 0, 0, 1], w: 0.3, h: 0.3, s: 'vägg-norr' });
  const head = { format: 'slapandtalk-rec', v: 1, players: [{ id: 'aa', name: 'Jens', p: [0, 1.6, 0], y: 0, pi: 0 }], stamps: [], images: {} };
  const lines = [head,
    { t: 1000, e: 'held', id: 'aa', h: H(0), image: img },
    { t: 1100, e: 'held', id: 'aa', h: H(1) },
    { t: 2000, e: 'stamp:add', by: 'aa', stamp: { id: 's1', imageId: img.id, position: [1, 2, -5], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr' }, image: img },
    { t: 3000, e: 'held', id: 'aa', h: null },
    { t: 3500, e: 'held', id: 'zz', h: H(0) }, // someone never in the room: ignored by snapshots
    { t: 4000, e: 'end', reason: 'stop' }];
  const tl = buildTimeline(parseRecording(lines.map((l) => JSON.stringify(l)).join('\n')));
  assert(heldAt(tl, 'aa', 999) === null, 'before pickup: nothing held');
  const a = heldAt(tl, 'aa', 1000);
  assert(a && a.image && a.image.url === img.url && a.p[0] === 0 && a.w === 0.3, 'from the moment of pickup the held sticker is there, with its design (image from the held line)', a);
  assert(near(heldAt(tl, 'aa', 1050).p[0], 0.5), 'between two updates it glides (half way at half time)');
  const s = snapshotAt(tl, 1500);
  assert(s.stamps.length === 0 && s.players[0].held && s.players[0].held.p[0] === 1, 'BEFORE the slap: no sticker on the wall yet, but the held one is in the snapshot at its aim');
  const s2 = snapshotAt(tl, 2500);
  assert(s2.stamps.length === 1 && s2.players[0].held, 'after the slap: placed + still held (as live: the preview stays while aiming)');
  assert(snapshotAt(tl, 3200).players[0].held === null, 'let go (null): gone');
  assert(snapshotAt(tl, 3600).players.length === 1, 'a held line for someone not in the room shows nobody');
  // the same time = the same answer (seeking)
  assert(JSON.stringify(heldAt(tl, 'aa', 1050)) === JSON.stringify(heldAt(tl, 'aa', 1050)), 'deterministic');
  // an older recording (no held lines) still plays: held is null for everybody
  const old = buildTimeline(parseRecording([head, { t: 500, e: 'move', id: 'aa', p: [1, 1.6, 0], y: 0, pi: 0 }, { t: 900, e: 'end', reason: 'stop' }].map((l) => JSON.stringify(l)).join('\n')));
  assert(snapshotAt(old, 700).players[0].held === null && heldAt(old, 'aa', 700) === null, 'older recordings without held lines: nothing held, nothing breaks');
  // a design only known from an earlier stamp:add (no image on the held line) is still found
  const tl2 = buildTimeline(parseRecording([{ ...head, images: { [img.id]: img } }, { t: 100, e: 'held', id: 'aa', h: H(2) }].map((l) => JSON.stringify(l)).join('\n')));
  assert(heldAt(tl2, 'aa', 150)?.image?.id === img.id, 'the design can also come from the header');
}

// ---------- The server: realtime + recorder ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-heldrec-'));
const store = createStore(new LocalAdapter(dir), { writeDelayMs: 20, log: { error: () => {}, log: () => {} } });
const recorder = createRecorder(store, { flushMs: 100, tickMs: 20 });
const app = createApp(store, { adminToken: 'held-admin', recorder, log: { log: () => {}, error: () => {}, warn: () => {} } });
const server = app.listen(0);
const rt = attachRealtime(server, { maxPlayers: 4, heartbeatMs: 500, recorder });
const base = `http://127.0.0.1:${server.address().port}`;
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const sockets = [];
const join = async (R, name) => {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${R}`); sockets.push(ws);
  const msgs = []; ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r)); ws.send(JSON.stringify({ t: 'hello', name, p: [0, 1.6, 0], y: 0 }));
  let w; for (let k = 0; k < 100 && !(w = msgs.find((m) => m.t === 'welcome')); k++) await sleep(20);
  return { ws, msgs, id: w.id, send: (m) => ws.send(JSON.stringify(m)) };
};
try {
  const fd = new FormData(); fd.append('file', new Blob([await sharp({ create: { width: 64, height: 32, channels: 4, background: '#ff00aa' } }).png().toBuffer()], { type: 'image/png' }), 'k.png');
  const img = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
  const { room: { id: R }, roomKey: KEY } = await (await post('/api/rooms', {})).json();
  const A = await join(R, 'Jens'), B = await join(R, 'Ulla');
  const H = (x) => ({ img: img.id, p: [x, 2, -5], n: [0, 0, 1], q: [0, 0, 0, 1], w: 0.3, h: 0.15, s: 'vägg-norr' });
  A.send({ t: 'held', h: H(0) }); await sleep(100); // not recording: goes nowhere
  const rec = (await (await post(`/api/rooms/${R}/recording/start`, {}, { 'x-room-key': KEY })).json()).recording;
  A.send({ t: 'held', h: H(0.1) }); await sleep(60);
  for (let k = 0; k < 10; k++) { A.send({ t: 'held', h: H(0.2 + k * 0.05) }); await sleep(10); } // a burst faster than 10/s
  await sleep(250);
  A.send({ t: 'held', h: { ...H(0), img: 'nothere000000000' } }); await sleep(100); // a design the server does not have
  A.send({ t: 'held', h: { bogus: 1 } });
  A.send({ t: 'held', h: null });
  await sleep(100);
  const sl = await (await post(`/api/rooms/${R}/stamps`, { imageId: img.id, position: [0.65, 2, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr', by: A.id })).json();
  await sleep(100);
  await post(`/api/rooms/${R}/recording/stop`, {}, { 'x-room-key': KEY });
  const text = await (await fetch(`${base}/api/rooms/${R}/recordings/${rec.recId}/log`)).text();
  const lines = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const held = lines.filter((l) => l.e === 'held');
  assert(held.length >= 2 && held[0].h && held[0].h.p[0] === 0.1, 'recording: the held sticker is logged from the first held message after the start (not before)', held.map((l) => l.h && l.h.p));
  assert(held[0].image && held[0].image.id === img.id && held[0].image.url && held.slice(1).every((l) => !l.image), 'the design rides on the first held line only', held.map((l) => !!l.image));
  const moving = held.filter((l) => l.h && l.h.p[0] >= 0.2);
  assert(moving.length >= 1 && moving.length <= 5 && moving[moving.length - 1].h.p[0] === 0.65, 'throttled (≤ ~10/s), and the latest aim always comes', moving.map((l) => [l.t, l.h.p[0]]));
  assert(!held.some((l) => l.h && l.h.img !== img.id), 'an unknown design / malformed held is not recorded');
  const iNull = lines.findIndex((l) => l.e === 'held' && l.h === null), iAdd = lines.findIndex((l) => l.e === 'stamp:add');
  assert(iNull > 0 && iAdd > iNull && held.every((l) => l.id === A.id), 'let go (null) is logged; the held sticker came BEFORE the stamp:add');
  assert(!B.msgs.some((m) => m.t === 'held' || (m.t === 'event' && m.e.type === 'held')), 'never relayed to the others live');
  const tl = buildTimeline(parseRecording(text));
  const tFirst = held[0].t, tAdd = lines[iAdd].t;
  const before = snapshotAt(tl, tFirst + 1);
  assert(before.stamps.every((s) => s.stamp.id !== sl.stamp.id) && before.players.find((p) => p.id === A.id).held?.image?.id === img.id, 'replay: right after pickup the held sticker is shown, before it is on the wall');
  assert(snapshotAt(tl, tAdd).stamps.some((s) => s.stamp.id === sl.stamp.id), '…and the placed one appears at the slap as before');
  // a watcher (room full) can't record a held sticker: only players
  const ok = recorder.isActive(R) === false; assert(ok, 'recording stopped');
} finally {
  for (const s of sockets) s.terminate(); await recorder.close(); rt.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\nheldrec: ${n} passed`);
process.exit(0);
