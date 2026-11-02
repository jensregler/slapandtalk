// Empty rooms are deleted after a grace period (server/emptyrooms.js), with the real store + realtime.
// Run: node tests/emptyrooms.test.js
const fs = require('fs'); const os = require('os'); const path = require('path');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const { createEmptyRoomReaper } = require('../server/emptyrooms');
const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRACE = 300;
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-empty-'));
  const store = createStore(new LocalAdapter(dir));
  const app = createApp(store, { adminToken: 'x' });
  const server = app.listen(0);
  let rt = null; const keep = new Set();
  const reaper = createEmptyRoomReaper({ store, graceMs: GRACE, isOccupied: (id) => rt.occupied(id), keepIds: async () => keep, log: {} });
  rt = attachRealtime(server, { maxPlayers: 4, heartbeatMs: 200, onEmpty: reaper.empty, onJoin: reaper.joined });
  const base = `http://127.0.0.1:${server.address().port}`;
  const make = async (body = {}) => (await (await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()).room.id;
  const exists = async (id) => (await fetch(`${base}/api/rooms/${id}`)).status === 200 && !!(await store.peek(id));
  const join = async (id) => { const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${id}`); await new Promise((r) => ws.on('open', r)); ws.send(JSON.stringify({ t: 'hello', name: 'A' })); await sleep(80); return ws; };
  const leave = async (ws) => { ws.close(); await sleep(80); };
  try {
    const a = await make({ name: 'goes' });
    await leave(await join(a));
    assert(reaper.pending().includes(a) && await exists(a), 'the last one leaves: the room gets a grace timer and is still there');
    await sleep(GRACE + 200);
    assert(!(await exists(a)) && !reaper.pending().length, '…after the grace period the empty room is deleted');

    const b = await make();
    await leave(await join(b)); await sleep(GRACE / 3);
    const back = await join(b);
    assert(!reaper.pending().includes(b), 'someone comes back within the grace period: the timer is cancelled');
    await sleep(GRACE + 200);
    assert(await exists(b), '…and the room stays while someone is in it');
    const two = await join(b); await leave(back);
    assert(!reaper.pending().length, 'one of two leaves: no timer (still someone there)');
    await leave(two); await sleep(GRACE + 200);
    assert(!(await exists(b)), '…the last one leaves: deleted');

    const c = await make(); keep.add(c);
    await leave(await join(c)); await sleep(GRACE + 200);
    assert(await exists(c), 'a room a preset was made from (preset.sourceRoom) is kept');

    await leave(await join('stad')); await sleep(GRACE + 200);
    assert(!reaper.pending().length, 'the City never gets a timer');

    await store.createRoom({ id: 'profil1', type: 'profile' });
    assert(!(await reaper.reap('profil1')) && !!(await store.peek('profil1')), 'a profile room (not quick) is never deleted');

    const d = await make(); // nobody ever joins: no timer (the hourly TTL cleanup takes it)
    await sleep(GRACE + 100);
    assert(await exists(d) && !reaper.pending().includes(d), 'a room nobody has been in (e.g. already empty at deploy) gets no timer – left to the TTL cleanup');
    console.log('\nAll empty-room tests passed');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  reaper.stop(); rt.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode || 0), 100);
})();
