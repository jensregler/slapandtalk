// 3D props on the server (Jens t491u + t509u, 4 Nov 2026): GET …/stamps gives a room's props (the table
// set by default), PUT/DELETE /api/rooms/:room/props/:id (build phase; admin, or the full version in your
// own room / the build city), the broadcast, the build city's props into the default city preset and a
// new city, and sitting on a chair over the WebSocket (one person per chair, leaving frees it).
// Run: node tests/props.test.js
const fs = require('fs'); const os = require('os'); const path = require('path');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const { makeEntitlements } = require('../server/entitlements');
const assert = (c, m, x) => { if (!c) throw new Error('FEL: ' + m + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 600) : '')); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADM = 'adm-props', FULL = 'full-key-props-1';
const quiet = { log() {}, error() {}, warn() {} };
function client(base, room, hello = {}) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${room}`);
  const c = { ws, msgs: [] };
  ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString())));
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(10); } return null; };
  c.ready = new Promise((r) => ws.on('open', r)).then(() => c.send({ t: 'hello', ...hello }));
  return c;
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-props-'));
  const store = createStore(new LocalAdapter(dir), { log: quiet });
  const app = createApp(store, { adminToken: ADM, entitle: makeEntitlements({ FULL_ACCESS_KEYS: FULL, OPEN_ACCESS: '0' }), log: quiet, autoPrune: false, cityAutosaveMs: 100 });
  const server = app.listen(0);
  attachRealtime(server, { maxPlayers: 4, heartbeatMs: 200 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const all = [];
  const call = async (m, u, body, h = {}) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', ...h }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  try {
    await sleep(100);
    const mk = await call('POST', '/api/rooms', { style: { floor: 'betong', wall: 'tegel' } });
    const R = mk.room.id, KEY = { 'x-room-key': mk.roomKey }, LIC = { 'x-unlock': FULL };
    let st = await call('GET', `/api/rooms/${R}/stamps`);
    assert(st.props.length === 5 && st.props.filter((p) => p.kind === 'chair').length === 4, 'a new room: the table with 4 chairs');
    const watcher = client(base, R, { name: 'W' }); all.push(watcher); await watcher.ready; await watcher.wait((m) => m.t === 'welcome');

    const box = { kind: 'box', x: 2, z: 3, yaw: 0.5, sx: 3, sy: 2.5, sz: 0.2, color: '#5fae4e' };
    assert((await call('PUT', `/api/rooms/${R}/props/abcdef0001`, { prop: box })).status === 403, 'no room key, no full version: not allowed');
    assert((await call('PUT', `/api/rooms/${R}/props/abcdef0001`, { prop: box }, KEY)).status === 403, 'own room but the free version: not allowed');
    assert((await call('PUT', `/api/rooms/${R}/props/abcdef0001`, { prop: box }, LIC)).status === 403, 'the full version but not my room: not allowed');
    let r = await call('PUT', `/api/rooms/${R}/props/abcdef0001`, { prop: box }, { ...KEY, ...LIC });
    assert(r.status === 200, 'own room + full version: a cuboid is placed', r);
    const ev = await watcher.wait((m) => m.t === 'event' && m.e && m.e.type === 'prop:set' && m.e.prop.id === 'abcdef0001');
    assert(ev, 'the others are told (prop:set)', watcher.msgs.slice(-3));
    st = await call('GET', `/api/rooms/${R}/stamps`);
    const sb = st.props.find((p) => p.id === 'abcdef0001');
    assert(st.props.length === 6 && sb.sx === 3 && sb.sy === 2.5 && sb.sz === 0.2 && sb.color === '#5fae4e', 'saved: the default set (now the room\'s own) + the cuboid with W/H/D + colour', st.props);
    assert((await call('PUT', `/api/rooms/${R}/props/abcdef0002`, { prop: { kind: 'nope', x: 0, z: 0 } }, { ...KEY, ...LIC })).status === 400, 'an unknown kind: 400');
    assert((await call('DELETE', `/api/rooms/${R}/props/d0000000a0`, null, { 'x-admin-token': ADM })).status === 200, 'admin removes the table');
    st = await call('GET', `/api/rooms/${R}/stamps`);
    assert(st.props.length === 5 && !st.props.some((p) => p.id === 'd0000000a0'), '…it stays removed');
    assert(await watcher.wait((m) => m.t === 'event' && m.e && m.e.type === 'prop:remove' && m.e.id === 'd0000000a0'), 'the others are told (prop:remove)');

    // the build city → the default city preset → a new city
    r = await call('PUT', '/api/rooms/stad-byggen/props/abcdef0003', { prop: { kind: 'sign-stop', x: 16, z: 20 } }, LIC);
    assert(r.status === 200, 'the full version places a stop sign in the build city', r);
    const other = (await call('POST', '/api/cities', { name: 'Other' })).city.id;
    assert((await call('PUT', `/api/rooms/${other}/props/abcdef0004`, { prop: { kind: 'bench', x: 16, z: 20 } }, LIC)).status === 403, '…not in another city\'s outside');
    assert((await call('GET', `/api/rooms/${other}/stamps`)).props.length === 0, 'a city outside without own props has none');
    await sleep(400);
    const pre = await call('GET', '/api/admin/citypresets', null, { 'x-admin-token': ADM });
    const dp = pre.presets.find((p) => p.default);
    assert(dp && dp.props && dp.props.outside === 1, 'the build city\'s props are saved into the default city preset', pre.presets);
    const c2 = (await call('POST', '/api/cities', { name: 'Fresh' })).city.id;
    st = await call('GET', `/api/rooms/${c2}/stamps`);
    assert(st.props.length === 1 && st.props[0].kind === 'sign-stop', 'a new city starts with the preset\'s props', st.props);

    // sitting
    const a = client(base, R, { name: 'A' }), b = client(base, R, { name: 'B' }); all.push(a, b);
    await a.ready; await b.ready;
    const wa = await a.wait((m) => m.t === 'welcome'); await b.wait((m) => m.t === 'welcome');
    a.send({ t: 'sit', chair: 'd0000000a1', draw: true });
    const seen = await b.wait((m) => m.t === 'sit' && m.chair === 'd0000000a1');
    assert(seen && seen.draw === true && seen.id === wa.id, 'sitting and drawing: the others see it', seen);
    b.send({ t: 'sit', chair: 'd0000000a1', draw: true });
    const no = await b.wait((m) => m.t === 'sit' && m.taken === 'd0000000a1');
    assert(no && no.chair === null, 'the chair is taken: the second one is told no', no);
    const c = client(base, R, { name: 'C' }); all.push(c); await c.ready;
    const wc = await c.wait((m) => m.t === 'welcome');
    const pa = wc && (wc.players || []).find((p) => p.id === wa.id);
    assert(pa && pa.sit && pa.sit.chair === 'd0000000a1', 'someone coming in sees who sits where', wc && wc.players);
    a.ws.close(); await sleep(300);
    b.msgs.length = 0; b.send({ t: 'sit', chair: 'd0000000a1', draw: false });
    const yes = await b.wait((m) => m.t === 'sit' && m.chair === 'd0000000a1');
    assert(yes && !yes.taken, 'leaving frees the chair', yes);
    console.log('\nprops (server): all good');
  } finally { for (const c of all) try { c.ws.close(); } catch {} server.close(); setTimeout(() => process.exit(0), 100).unref(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
