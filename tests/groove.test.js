// The footstep groove as a room setting (PUT /api/rooms/:room/groove, shared/groove.mjs):
// permission (full version soundDesign + the room's creator, or admin; not in the demo), broadcast
// over the WebSocket, saved with the room, recorded (header + room:groove), and the welcome's clock.
// Run: node tests/groove.test.js (in npm test)
// Tests the free/full split, so OPEN ACCESS (shared/openaccess.mjs) is off here unless OPEN_ACCESS is set.
process.env.OPEN_ACCESS ??= '0';
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const { createRecorder } = require('../server/recorder');
const { makeEntitlements } = require('../server/entitlements');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN = 'hemligt-test', FULL = 'full-key-for-tests-1', FABRIC_ONLY = 'fabric-key-for-tests';
const quiet = { error: () => {}, log: () => {} };

function client(base, room) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${room}`);
  const c = { ws, msgs: [] };
  ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString())));
  c.wait = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(10); } return null; };
  c.ready = new Promise((r) => ws.on('open', r)).then(() => ws.send(JSON.stringify({ t: 'hello', name: 'Test' })));
  return c;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-groove-'));
  const entitle = makeEntitlements({ FULL_ACCESS_KEYS: `${FULL},${FABRIC_ONLY}:fabrics` });
  let store = createStore(new LocalAdapter(dir), { writeDelayMs: 10, log: quiet });
  const recorder = createRecorder(store, { flushMs: 100, tickMs: 20 });
  const app = createApp(store, { adminToken: ADMIN, recorder, entitle, log: quiet });
  const server = app.listen(0);
  const rt = attachRealtime(server, { heartbeatMs: 500, recorder, entitle });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (method, url, { key, admin, unlock, body } = {}) => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(key ? { 'x-room-key': key } : {}), ...(admin ? { 'x-admin-token': admin } : {}), ...(unlock ? { 'x-unlock': unlock } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const clients = [];
  try {
    const { room: { id: R, groove: g0 }, roomKey: KEY } = (await api('POST', '/api/rooms', { body: {} })).body;
    assert(g0 === undefined && (await api('GET', `/api/rooms/${R}/stamps`)).body.info.groove === undefined, 'a new room has no groove field (= the default 1.0×)');

    const a = client(base, R), b = client(base, R); clients.push(a, b);
    await Promise.all([a.ready, b.ready]);
    const w = await a.wait((m) => m.t === 'welcome');
    assert(w && Number.isFinite(w.now) && Math.abs(w.now - Date.now()) < 2000, 'the WebSocket welcome carries the server clock (now) for the shared bar');

    // ---------- Permission ----------
    const p = `/api/rooms/${R}/groove`;
    const none = await api('PUT', p, { body: { scale: 2 } });
    const keyOnly = await api('PUT', p, { key: KEY, body: { scale: 2 } });
    const fullOnly = await api('PUT', p, { unlock: FULL, body: { scale: 2 } });
    const fabric = await api('PUT', p, { key: KEY, unlock: FABRIC_ONLY, body: { scale: 2 } });
    const wrongKey = await api('PUT', p, { key: 'wrong', unlock: FULL, body: { scale: 2 } });
    assert(none.status === 403 && keyOnly.status === 403 && keyOnly.body.full === true && fabric.status === 403, 'free (even the creator) or a key without soundDesign: 403 "part of the full version"');
    assert(fullOnly.status === 403 && wrongKey.status === 403 && /creator/.test(wrongKey.body.error), 'the full version but not the room’s creator: 403');
    assert((await api('PUT', p, { key: KEY, unlock: FULL, body: { scale: 'x' } })).status === 400 && (await api('PUT', p, { key: KEY, unlock: FULL, body: {} })).status === 400, 'not a number: 400');
    assert(!a.msgs.some((m) => m.t === 'event' && m.e.type === 'room:groove'), 'nothing refused was broadcast');

    // ---------- Recording starts, then the creator (full version) changes it ----------
    const recStart = await api('POST', `/api/rooms/${R}/recording/start`, { key: KEY });
    assert(recStart.status === 200, 'recording started');
    const before = Date.now();
    const ok = await api('PUT', p, { key: KEY, unlock: FULL, body: { scale: 0.5 } });
    assert(ok.status === 200 && ok.body.groove.scale === 0.5 && ok.body.groove.at >= before - 5 && ok.body.groove.phase >= 0 && ok.body.groove.phase < 1, `the creator with the full version: ok ${JSON.stringify(ok.body.groove)}`);
    const ea = await a.wait((m) => m.t === 'event' && m.e.type === 'room:groove'), eb = await b.wait((m) => m.t === 'event' && m.e.type === 'room:groove');
    assert(ea && eb && JSON.stringify(ea.e.groove) === JSON.stringify(ok.body.groove) && JSON.stringify(eb.e.groove) === JSON.stringify(ok.body.groove), 'broadcast to everyone in the room (room:groove with the same state)');
    const G = await import('../shared/groove.mjs');
    assert(Math.abs(G.phaseAt(ok.body.groove, ok.body.groove.at) - G.phaseAt(G.DEFAULT_GROOVE, ok.body.groove.at)) < 1e-5, 'the server keeps the phase continuous across the change');
    const clamped = await api('PUT', p, { key: KEY, unlock: FULL, body: { scale: 1000 } });
    assert(clamped.status === 200 && clamped.body.groove.scale === 8, 'clamped to 8');
    const admin = await api('PUT', p, { admin: ADMIN, body: { scale: 0.25 } });
    assert(admin.status === 200 && admin.body.groove.scale === 0.25, 'admin may too');
    const stad = await api('PUT', '/api/rooms/stad/groove', { key: KEY, unlock: FULL, body: { scale: 2 } });
    assert(stad.status === 403, 'the City: only admin');

    // ---------- Persisted ----------
    assert((await api('GET', `/api/rooms/${R}/stamps`)).body.info.groove.scale === 0.25, 'GET …/stamps: info.groove (what a new visitor loads)');
    await store.flush();
    const store2 = createStore(new LocalAdapter(dir), { log: quiet });
    assert((await store2.getRoom(R)).groove.scale === 0.25, 'saved with the room (a fresh store reads it back)');

    // ---------- Recorded ----------
    const stop = await api('POST', `/api/rooms/${R}/recording/stop`, { key: KEY });
    const recId = stop.body.recording.recId;
    await api('POST', `/api/rooms/${R}/recording/start`, { key: KEY }); // a second one starts with the groove in its header
    const R2 = { body: { recId: (await api('POST', `/api/rooms/${R}/recording/stop`, { key: KEY })).body.recording.recId } };
    const { parseRecording, buildTimeline, snapshotAt } = await import('../shared/replay.mjs');
    const log1 = parseRecording(await (await fetch(`${base}/api/rooms/${R}/recordings/${recId}/log`, { headers: { "x-room-key": KEY } })).text());
    const evs = log1.events.filter((e) => e.e === 'room:groove');
    assert(evs.length === 3 && evs.map((e) => e.groove.scale).join() === '0.5,8,0.25', `the changes are in the recording (${evs.map((e) => e.groove.scale)})`);
    const tl = buildTimeline(log1);
    assert(snapshotAt(tl, 0).groove === null && snapshotAt(tl, evs[0].t).groove.scale === 0.5 && snapshotAt(tl, evs[2].t + 1).groove.scale === 0.25, 'the replay knows the groove at every moment');
    const log2 = parseRecording(await (await fetch(`${base}/api/rooms/${R}/recordings/${R2.body.recId}/log`, { headers: { "x-room-key": KEY } })).text());
    assert(log2.header.groove && log2.header.groove.scale === 0.25 && snapshotAt(buildTimeline(log2), 0).groove.scale === 0.25, 'a new recording starts with the room’s groove in its header');
  } finally {
    for (const c of clients) c.ws.terminate();
    await recorder.close(); rt.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
  // ---------- Demo: not there ----------
  {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-groove-d-'));
    const st = createStore(new LocalAdapter(d2), { log: quiet });
    const app2 = createApp(st, { adminToken: ADMIN, log: quiet, entitle: makeEntitlements({ FULL_ACCESS_KEYS: FULL }), demo: { settings: { style: { floor: 'betong', wall: 'kakel' } }, publicConfig: () => ({ demo: true }), newRoomFields: () => ({}), created: () => {} } });
    const s2 = app2.listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/rooms/abc/groove`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-unlock': FULL }, body: '{"scale":2}' });
      assert(r.status === 403 && (await r.json()).demo === true, 'the demo profile: 403 (no room editing there; footsteps play the default groove)');
    } finally { s2.close(); fs.rmSync(d2, { recursive: true, force: true }); }
  }
  console.log('groove (server): all ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
