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
  let now = Date.now();
  const reaper = createEmptyRoomReaper({ store, graceMs: GRACE, isOccupied: (id) => rt.occupied(id), keepIds: async () => keep, log: {}, clock: () => now });
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

    const d = await make(); // nobody ever joins: no timer – the sweep takes it
    await sleep(GRACE + 100);
    assert(await exists(d) && !reaper.pending().includes(d), 'a room nobody has walked into gets no timer…');
    const full = await make(); const inside = await join(full);
    const kept2 = await make(); keep.add(kept2);
    let swept = await reaper.sweep();
    assert(swept.length === 0 && await exists(d), '…and a sweep leaves rooms made in the last minute alone (the start card is still loading them)');
    now = Date.now() + 61_000;
    swept = await reaper.sweep();
    assert(swept.includes(d) && !(await exists(d)), 'the sweep (startup + every few minutes): an older room nobody is in is deleted – e.g. empty rooms from before a deploy/restart');
    assert(await exists(full) && await exists(kept2) && await exists(c) && !!(await store.peek('profil1')), '…not a room someone is in, a preset source room or a profile room');
    await store.createRoom({ id: 'demo1x', type: 'quick', extra: { demo: true } });
    assert(!(await reaper.sweep()).includes('demo1x') && !!(await store.peek('demo1x')), '…nor a demo room (the demo has its own expiry)');
    await leave(inside);
    console.log('\nAll empty-room tests passed');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  reaper.stop(); rt.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
  // The real server: rooms already empty at startup (e.g. from before a deploy) are swept away.
  if (!process.exitCode) {
    const { spawn } = require('child_process');
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-sweep-'));
    fs.mkdirSync(path.join(d2, 'rooms'), { recursive: true });
    const old = '2026-10-01T10:00:00.000Z';
    const put = (id, extra = {}) => fs.writeFileSync(path.join(d2, 'rooms', id + '.json'), JSON.stringify({ id, type: 'quick', owner: null, createdAt: old, lastVisitAt: new Date().toISOString(), // visited recently: the 24 h TTL cleanup leaves them, so it's the sweep
      stamps: [], ...extra }));
    put('oldaa1'); put('oldbb2'); put('demoq1', { demo: true }); put('profq1', { type: 'profile' });
    const port = 8960 + Math.floor(Math.random() * 30);
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: d2, STORAGE: 'local', EMPTY_ROOM_GRACE_SECONDS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (b) => { out += b; }); child.stderr.on('data', (b) => { out += b; });
    try {
      await sleep(9000);
      const left = fs.readdirSync(path.join(d2, 'rooms')).sort();
      assert(!left.includes('oldaa1.json') && !left.includes('oldbb2.json') && left.includes('demoq1.json') && left.includes('profq1.json'),
        'server startup: empty rooms from before are swept (after the grace period); demo and profile rooms stay');
    } catch (e) { console.error(e.message, out.slice(-600)); process.exitCode = 1; }
    child.kill(); fs.rmSync(d2, { recursive: true, force: true });
  }
  setTimeout(() => process.exit(process.exitCode || 0), 100);
})();
