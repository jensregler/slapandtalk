// The plain address → your most recently used room (client/src/landing.js) and the batch endpoint
// GET /api/rooms/recent?ids=… (server/app.js, store.lastActivity). Run: node tests/landing.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('✔ ' + name); };

// a tiny localStorage for the browser module
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const L = await import('../client/src/landing.js');

await test('my rooms: keys (made it / invited) + visited, most recent visit first, never the City, ≤ 100 visits kept', () => {
  mem.clear();
  localStorage.setItem('klibb.roomKeys', JSON.stringify({ aaaaaa: 'k1', stad: 'x' }));
  localStorage.setItem('klibb.memberKeys', JSON.stringify({ bbbbbb: 'm1' }));
  L.noteVisit('cccccc', 3000); L.noteVisit('bbbbbb', 2000); L.noteVisit('stad', 9999); L.noteVisit('BAD id', 1);
  assert.deepEqual(L.myRooms(), ['cccccc', 'bbbbbb', 'aaaaaa']);
  for (let i = 0; i < 120; i++) L.noteVisit(`r${i}`, 10000 + i);
  assert.equal(Object.keys(JSON.parse(localStorage.getItem('klibb.rooms'))).length, 100);
  L.forget(['aaaaaa', 'bbbbbb']);
  assert.ok(!('aaaaaa' in JSON.parse(localStorage.getItem('klibb.roomKeys'))) && !('bbbbbb' in JSON.parse(localStorage.getItem('klibb.memberKeys'))));
});
await test('pick: the latest server activity wins; gone rooms are skipped and forgotten; offline → the latest local visit; none → null (make a new room)', () => {
  const mine = ['a1', 'b2', 'c3'];
  const ans = { rooms: [{ id: 'a1', updatedAt: '2026-10-26T10:00:00Z' }, { id: 'b2', updatedAt: '2026-10-26T12:00:00Z' }], missing: ['c3'] };
  assert.deepEqual(L.pickRoom(mine, ans), { id: 'b2', forget: ['c3'] });
  assert.deepEqual(L.pickRoom(mine, { rooms: [], missing: mine }), { id: null, forget: mine });
  assert.equal(L.pickRoom(mine, null).id, 'a1', 'offline: the first = most recently visited');
  assert.deepEqual(L.pickRoom([], null), { id: null, forget: [] });
  assert.equal(L.pickRoom(mine, { rooms: [{ id: 'zz', updatedAt: '2030-01-01T00:00:00Z' }, ...ans.rooms], missing: [] }).id, 'b2', 'only rooms I asked about');
});

const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { makeEntitlements } = require('../server/entitlements');
const { demoSettings, createDemo } = require('../server/demo');
await test('GET /api/rooms/recent: existing rooms newest first (sticker, look, visit all count), unknown → missing, the City ignored, ≤ 50 ids, cleanup does not count', async () => {
  let now = Date.parse('2026-10-26T10:00:00Z');
  const clock = () => now;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-landing-'));
  const store = createStore(new LocalAdapter(dir), { clock });
  const app = createApp(store, { adminToken: 'adm', clock, entitle: makeEntitlements({}) });
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const J = (r) => r.json();
  const mk = async () => (await J(await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })));
  const recent = (ids) => fetch(`${base}/api/rooms/recent?ids=${ids.join(',')}`).then(J);
  try {
    const A = await mk(); now += 60_000; const B = await mk();
    let r = await recent([A.room.id, B.room.id, 'nosuchroom', 'stad', 'Bad Id!']);
    assert.deepEqual(r.rooms.map((x) => x.id), [B.room.id, A.room.id]);
    assert.deepEqual(r.missing, ['nosuchroom'], 'the City and bad ids are simply ignored');
    assert.ok(r.rooms.every((x) => x.type === 'quick' && Object.keys(x).sort().join() === 'id,type,updatedAt'), 'only the time, nothing about the content');
    now += 60_000;
    assert.equal((await fetch(`${base}/api/rooms/${A.room.id}/style`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': A.roomKey }, body: JSON.stringify({ style: { floor: 'parkett', wall: 'klassisk', ceiling: 'klassisk' } }) })).status, 200);
    r = await recent([A.room.id, B.room.id]);
    assert.equal(r.rooms[0].id, A.room.id, 'an edit makes it the latest');
    assert.equal(r.rooms[0].updatedAt, new Date(now).toISOString());
    now += 20 * 60_000;
    await fetch(`${base}/api/rooms/${B.room.id}/visit`, { method: 'POST' });
    assert.equal((await recent([A.room.id, B.room.id])).rooms[0].id, B.room.id, 'a visit counts too');
    const before = (await recent([A.room.id])).rooms[0].updatedAt;
    now += 60_000; await store.deleteStampsWithImage('nothing');
    await store.cleanupRooms({ quickTtlMs: 365 * 86400_000 });
    assert.equal((await recent([A.room.id])).rooms[0].updatedAt, before, 'the cleanup jobs are not activity');
    const many = Array.from({ length: 80 }, (_, i) => `x${i}`);
    const m = await recent(many); assert.equal(m.missing.length, 50);
    // without ?ids it is still the room info route (a room may be called "recent")
    const info = await J(await fetch(`${base}/api/rooms/recent`));
    assert.equal(info.room.id, 'recent');
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
await test('demo: an expired demo room counts as gone', async () => {
  let now = Date.parse('2026-10-26T10:00:00Z');
  const clock = () => now;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-landing-demo-'));
  const store = createStore(new LocalAdapter(dir), { clock });
  const demo = createDemo({ store, settings: { ...demoSettings({ DEMO_PROFILE: '1' }), roomMs: 60 * 60_000 }, clock, log: { log() {}, error() {} } });
  const app = createApp(store, { adminToken: 'adm', clock, demo, entitle: makeEntitlements({ DEMO_PROFILE: '1' }) });
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const A = await (await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    assert.equal((await (await fetch(`${base}/api/rooms/recent?ids=${A.room.id}`)).json()).rooms.length, 1);
    now += 61 * 60_000;
    assert.deepEqual((await (await fetch(`${base}/api/rooms/recent?ids=${A.room.id}`)).json()).missing, [A.room.id]);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
console.log(`landing: ${passed} passed`);
