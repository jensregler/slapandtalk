// Peels (baksidespapper) utan webbläsare: inställningen per rum (synk + sparas), att fallet och
// landningen blir samma från samma seed, överlappet (39 % går, 41 % nekas), att servern nekar,
// taket på 300 och att peelade klibbor lämnar pappret kvar. Körs med: node tests/peels.test.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { PEEL, peelPlan, peelPose, pathParams, overlapFraction, slapSide, flatQuat, stampFrame, peelFrame, maskFromAlpha } from '../shared/peels.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const ROOM = require('../shared/room.json');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// ---------- Fallet: samma seed = samma bana och landning ----------
{
  const from = { x: 1, z: 2, yaw: 0.4 }, target = [3, 1.5, -5];
  const a = peelPlan('abc123', from, target), b = peelPlan('abc123', from, target), c = peelPlan('xyz789', from, target);
  assert(JSON.stringify(a) === JSON.stringify(b) && (a.x !== c.x || a.z !== c.z), 'samma seed ger exakt samma landning, ett annat seed en annan');
  assert(JSON.stringify(pathParams('abc123')) === JSON.stringify(pathParams('abc123')), 'banan (svaj, tumling, falltid) är också bestämd av seedet');
  assert(a.start[1] === PEEL.birthHeight, `pappret föds i höfthöjd (${PEEL.birthHeight} m)`);
  let ok = 0; const durs = [], drifts = [];
  for (let i = 0; i < 300; i++) {
    const f = { x: (i % 7) - 3, z: (i % 5) - 2, yaw: i * 0.37 };
    const t = [f.x + Math.cos(i) * 2, 1.2, f.z + Math.sin(i) * 2];
    const p = peelPlan('s' + i, f, t), side = slapSide(f, t);
    const [rx, rz] = [Math.cos(f.yaw), -Math.sin(f.yaw)];
    const outward = ((p.start[0] - f.x) * rx + (p.start[2] - f.z) * rz) * side > 0;
    const d = Math.hypot(p.x - p.start[0], p.z - p.start[2]);
    drifts.push(d); durs.push(pathParams('s' + i).dur);
    const inside = Math.abs(p.x) <= ROOM.width / 2 - PEEL.wallMargin + 1e-9 && Math.abs(p.z) <= ROOM.depth / 2 - PEEL.wallMargin + 1e-9;
    if (outward && p.side === side && inside && d >= PEEL.driftMin - 1e-3 && d <= PEEL.driftMax + 1e-3 && p.yaw >= 0 && p.yaw < Math.PI * 2) ok++;
  }
  assert(ok === 300, 'föds på samma sida som armen som slappar, driver 0,3–1,0 m och landar inne i rummet med slumpad vridning');
  assert(Math.min(...durs) >= PEEL.fallMin && Math.max(...durs) <= PEEL.fallMax, `falltiden är ${PEEL.fallMin}–${PEEL.fallMax} s`);
  const peel = { seed: 'abc123', ...a };
  const p0 = peelPose(peel, 0), p1 = peelPose(peel, 1), mid = peelPose(peel, 0.5);
  const flat = flatQuat(a.yaw);
  assert(p0.p.every((v, i) => near(v, a.start[i])) && near(p1.p[0], a.x) && near(p1.p[2], a.z) && near(p1.p[1], PEEL.floorY) && p1.q.every((v, i) => near(v, flat[i])),
    'banan börjar vid höften och slutar platt på golvet exakt där servern sparade landningen');
  const straight = [a.start[0] + (a.x - a.start[0]) * 0.5, a.start[2] + (a.z - a.start[2]) * 0.5];
  let maxOff = 0, monotone = true, prevY = Infinity;
  for (let i = 0; i <= 50; i++) {
    const q = peelPose(peel, i / 50); const off = Math.abs((q.p[0] - a.start[0]) * (a.z - a.start[2]) - (q.p[2] - a.start[2]) * (a.x - a.start[0])) / Math.hypot(a.x - a.start[0], a.z - a.start[2]);
    maxOff = Math.max(maxOff, off); if (i > 25 && q.p[1] > prevY + 1e-9) monotone = false; prevY = q.p[1];
  }
  const tilt = Math.abs(peelPose(peel, 0.3).q[3] - flat[3]) + Math.abs(peelPose(peel, 0.3).q[0] - flat[0]);
  assert(maxOff > 0.02 && mid.p[1] > PEEL.floorY && mid.p[1] < PEEL.birthHeight && monotone && tilt > 0.05 && straight,
    `inte rakt ner: banan svänger (${maxOff.toFixed(2)} m från raka linjen), tumlar och sjunker mot golvet`);
}

// ---------- Överlappet ----------
{
  const flatU = stampFrame(flatQuat(0));
  const fr = peelFrame(0);
  assert(near(flatU.u[0], fr.u[0]) && near(flatU.v[1], fr.v[1]), 'klibbans och pappets riktningar räknas på samma sätt');
  const peelAt = (x, z, mask = null) => ({ x, z, w: 1, h: 1, yaw: 0, mask });
  const sticker = (x, mask = null) => ({ x, z: 0, w: 1, h: 1, u: [1, 0], v: [0, -1], mask });
  const f39 = overlapFraction(sticker(0.61), [peelAt(0, 0)]), f41 = overlapFraction(sticker(0.59), [peelAt(0, 0)]);
  assert(near(f39, 0.39) && f39 <= PEEL.refuseOverlap && near(f41, 0.41) && f41 > PEEL.refuseOverlap, `39 % på papper fastnar, 41 % nekas (gräns ${PEEL.refuseOverlap * 100} %)`);
  assert(overlapFraction(sticker(5), [peelAt(0, 0)]) === 0 && overlapFraction(sticker(0), []) === 0 && near(overlapFraction(sticker(0), [peelAt(0, 0)]), 1), 'ingen överlapp långt bort, hel överlapp rakt ovanpå');
  // Formen räknas: en peel som bara är vänstra halvan (genomskinlig höger halva)
  const n = 32, alpha = new Uint8Array(n * n).map((_, i) => (i % n < n / 2 ? 255 : 0));
  const half = maskFromAlpha(alpha, n);
  assert(near(overlapFraction(sticker(0), [peelAt(0, 0, half)]), 0.5) && maskFromAlpha(new Uint8Array(n * n).fill(255), n) === null, 'genomskinliga delar av pappret räknas inte (formen, inte rektangeln)');
  assert(near(overlapFraction(sticker(0.5, half), [peelAt(0, 0)]), 1), 'bara klibbans egen form räknas');
  const two = overlapFraction(sticker(0), [peelAt(-0.3, 0), peelAt(0.3, 0)]);
  assert(near(two, 1), 'två papper som tillsammans täcker räknas som täckt (inte dubbelt)');
}

// ---------- Servern ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-peels-'));
let store = createStore(new LocalAdapter(dir), { writeDelayMs: 10 });
let app = createApp(store, { adminToken: 'hemligt-test' });
let server = app.listen(0);
let rt = attachRealtime(server, { maxPlayers: 5, heartbeatMs: 500 });
let base = `http://127.0.0.1:${server.address().port}`;
const clients = [];
try {
  const json = (r) => r.json().then((d) => ({ status: r.status, ...d }));
  const call = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }).then(json);
  const { room: { id: R }, roomKey: KEY } = await call('POST', '/api/rooms', {});
  const fd = new FormData();
  fd.append('file', new Blob([await sharp({ create: { width: 400, height: 400, channels: 4, background: '#ff2e63' } }).png().toBuffer()], { type: 'image/png' }), 'k.png');
  const img = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
  const client = (room) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${room}`); const c = { ws, msgs: [] }; clients.push(c);
    ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString())));
    c.wait = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(10); } return null; };
    c.ready = new Promise((r) => ws.on('open', r)).then(() => ws.send(JSON.stringify({ t: 'hello', name: 'B' })));
    return c;
  };
  const b = client(R); await b.ready; await b.wait((m) => m.t === 'welcome');
  const info0 = await call('GET', `/api/rooms/${R}`);
  assert(info0.room.peels === false, 'peels är av från början');
  const no = await call('PUT', `/api/rooms/${R}/peels`, { on: true });
  const bad = await call('PUT', `/api/rooms/${R}/peels`, { on: 'ja' }, { 'x-room-key': KEY });
  const stad = await call('PUT', '/api/rooms/stad/peels', { on: true }, { 'x-room-key': KEY });
  assert(no.status === 403 && bad.status === 400 && stad.status === 403, 'bara rummets skapare (rumsnyckeln) eller admin får slå på peels, och bara admin i Staden');
  const on = await call('PUT', `/api/rooms/${R}/peels`, { on: true }, { 'x-room-key': KEY });
  const ev = await b.wait((m) => m.t === 'event' && m.e.type === 'room:peels');
  assert(on.status === 200 && ev && ev.e.on === true && (await call('GET', `/api/rooms/${R}`)).room.peels === true, 'peels på: alla i rummet får veta det direkt (WebSocket) och rummet minns det');

  const FLOOR_Q = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // platt på golvet, bilden uppåt = −z
  const slap = (body) => call('POST', `/api/rooms/${R}/stamps`, { imageId: img.id, size: 1, normal: [0, 1, 0], quaternion: FLOOR_Q, surface: 'golv', ...body });
  const wall = await slap({ position: [2, 1.5, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], surface: 'vägg-norr', nonce: 'nonce0001', peelFrom: { p: [2.2, -3.5], yaw: 0 } });
  const expect = peelPlan('nonce0001', { x: 2.2, z: -3.5, yaw: 0 }, [2, 1.5, -5]);
  const evp = await b.wait((m) => m.t === 'event' && m.e.type === 'stamp:add' && m.e.peel);
  assert(wall.peel && wall.peel.seed === 'nonce0001' && wall.peel.x === expect.x && wall.peel.z === expect.z && wall.peel.yaw === expect.yaw && wall.peel.w === 1 && wall.peel.h === 1
    && evp && JSON.stringify(evp.e.peel) === JSON.stringify(wall.peel), 'en slap ger ett papper: servern räknar ut samma landning som klienten (seed = nonce) och skickar det till alla');
  const old = await slap({ position: [-2, 1.5, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], surface: 'vägg-norr' });
  assert(old.peel && old.peel.seed === old.stamp.id && Math.hypot(old.peel.start[0] + 2, old.peel.start[2] + 4.2) < 0.6, 'äldre klienter (inget peelFrom/nonce): pappret föds framför klibban, seed = stämpelns id');
  // Peela klibban: pappret ligger kvar
  await call('POST', `/api/rooms/${R}/peel`, { items: [{ id: wall.stamp.id, token: wall.peelToken }] });
  const after = await call('GET', `/api/rooms/${R}/stamps`);
  assert(!after.stamps.some((s) => s.id === wall.stamp.id) && after.peels.some((p) => p.id === wall.stamp.id) && after.images[img.id], 'peelar man klibban från väggen ligger pappret kvar på golvet');

  // Överlapp på golvet: lägg ett papper exakt i mitten (1 × 1 m) och slappa bredvid
  await store.clearPeels(R, () => true);
  await store.addPeel(R, { id: 'testpeel00000001', imageId: img.id, w: 1, h: 1, seed: 't', start: [0, 1, 0], x: 0, z: 0, yaw: 0 });
  const ok39 = await slap({ position: [0.61, 0, 0], peelFrom: { p: [4.5, 4.5], yaw: 0 } }); // dess papper hamnar långt bort
  const no41 = await slap({ position: [0.59, 0, 0], peelFrom: { p: [4.5, 4.5], yaw: 0 } });
  assert(ok39.status === 200 && no41.status === 409 && no41.nope === true && near(no41.overlap, 0.41, 1e-3), 'servern: 39 % på papper fastnar, 41 % nekas (409, går inte att komma runt från klienten)');
  const wallOk = await slap({ position: [0, 1.5, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], surface: 'vägg-norr' });
  assert(wallOk.status === 200, 'på väggen spelar papperet på golvet ingen roll');
  const offAgain = await call('PUT', `/api/rooms/${R}/peels`, { on: false }, { 'x-room-key': KEY });
  const offSlap = await slap({ position: [0.1, 0, 0] });
  const offRoom = await call('GET', `/api/rooms/${R}/stamps`);
  assert(offAgain.status === 200 && offSlap.status === 200 && !offSlap.peel && offRoom.peels.length === 0 && offRoom.info.peels === false, 'peels av: inga nya papper, inget nekas och golvet visas utan papper');
  await call('PUT', `/api/rooms/${R}/peels`, { on: true }, { 'x-room-key': KEY });
  const back = await call('GET', `/api/rooms/${R}/stamps`);
  assert(back.peels.length === 3, 'på igen: pappren som låg kvar syns igen');

  // Taket
  for (let i = 0; i < PEEL.maxPerRoom + 7; i++) await store.addPeel(R, { id: 'cap' + String(i).padStart(13, '0'), imageId: img.id, w: 0.1, h: 0.1, seed: 'c' + i, start: [0, 1, 0], x: 4, z: 4, yaw: 0 }, PEEL.maxPerRoom);
  const capped = await call('GET', `/api/rooms/${R}/stamps`);
  assert(capped.peels.length === PEEL.maxPerRoom && capped.peels[0].id === 'cap0000000000007' && capped.peels.at(-1).id === 'cap0000000000306', `högst ${PEEL.maxPerRoom} papper per rum, de äldsta försvinner först`);

  // Sparas: ny server på samma lagring
  await store.flush();
  rt.close?.(); server.close();
  store = createStore(new LocalAdapter(dir)); app = createApp(store, { adminToken: 'hemligt-test' }); server = app.listen(0); rt = attachRealtime(server, { maxPlayers: 5 });
  base = `http://127.0.0.1:${server.address().port}`;
  const reloaded = await call('GET', `/api/rooms/${R}/stamps`);
  assert(reloaded.info.peels === true && reloaded.peels.length === PEEL.maxPerRoom, 'inställningen och pappren sparas med rummet (finns kvar efter omstart)');
  const clr0 = await call('POST', `/api/rooms/${R}/peels/clear`, {});
  const clr = await call('POST', `/api/rooms/${R}/peels/clear`, {}, { 'x-room-key': KEY });
  assert(clr0.status === 403 && clr.status === 200 && clr.removed === PEEL.maxPerRoom && (await call('GET', `/api/rooms/${R}/stamps`)).peels.length === 0, '🧹 sopa golvet: bara skaparen/admin, och allt papper försvinner');
} finally {
  for (const c of clients) try { c.ws.close(); } catch { /* */ }
  rt.close?.(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
}
console.log('Alla peel-tester gick igenom.');
process.exit(0);
