// City presets + the build city (Jens, t492u + t493u, 3 Nov 2026; server/citypresets.js, shared/city.mjs):
// nature stickers in the city (24 m outside), the build city never goes when empty, every change in it is
// saved into the DEFAULT city preset, a new city (and its houses) copies that preset, survives the city
// being emptied and deleted, a server restart (a new store/app on the same storage), and players' changes
// in their city never touch the preset. Admin: snapshot as a new named preset, make it the default.
// Run: node tests/citypresets.test.js
const fs = require('fs'); const os = require('os'); const path = require('path');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const { createEmptyRoomReaper } = require('../server/emptyrooms');
const { loadLibrary, seedLibrary } = require('../server/library');
const { makeEntitlements } = require('../server/entitlements');
const assert = (c, m, x) => { if (!c) throw new Error('FEL: ' + m + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 600) : '')); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRACE = 300, AUTOSAVE = 150, ADM = 'adm-city';
const quiet = { log() {}, error() {} };
(async () => {
  const C = await import('../shared/city.mjs');
  assert(C.CITY_BUILD_PHASE === true && C.BUILD_CITY === 'stad-byggen' && C.isCityOutside(C.BUILD_CITY) && C.isBuildCity('stad-byggen-4') && !C.isBuildCity('stad-ab12cd'), 'the build phase is on; the build city is a city id (stad-byggen)');
  assert(C.cityLayerOf('stad-byggen') === 'outside' && C.cityLayerOf('stad-ab12cd-3') === '3' && C.cityLayerOf('abc123') === null, 'a city room\'s part: outside / house number');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-citypre-'));
  const lib = loadLibrary();
  const nat = lib.filter((s) => s.nature && s.width && s.height && s.width <= s.height * 1.05)[0] || lib.find((s) => s.nature), plain = lib.find((s) => !s.nature);
  assert(nat && plain, 'the library has a nature sticker and a normal one');
  const FULL = 'full-key-123456';
  const boot = async () => {
    const store = createStore(new LocalAdapter(dir), { log: quiet });
    await seedLibrary(store, lib, { log: quiet });
    const app = createApp(store, { adminToken: ADM, library: lib, entitle: makeEntitlements({ FULL_ACCESS_KEYS: FULL }), log: quiet, autoPrune: false, cityAutosaveMs: AUTOSAVE });
    const server = app.listen(0);
    let rt = null;
    const reaper = createEmptyRoomReaper({ store, graceMs: GRACE, cityGraceMs: GRACE, freshMs: 0, isOccupied: (id) => rt.occupied(id), log: quiet });
    rt = attachRealtime(server, { maxPlayers: 4, heartbeatMs: 200, onEmpty: reaper.empty, onJoin: reaper.joined });
    await sleep(100); // the build city is made at start
    return { store, app, server, rt, reaper, base: `http://127.0.0.1:${server.address().port}` };
  };
  let S = await boot();
  const H = (adm) => ({ 'Content-Type': 'application/json', 'x-license-key': FULL, ...(adm ? { 'x-admin-token': ADM } : {}) });
  const req = async (m, u, b, adm) => { const r = await fetch(S.base + u, { method: m, headers: H(adm), ...(b ? { body: JSON.stringify(b) } : {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const join = async (id) => { const ws = new WebSocket(`${S.base.replace('http', 'ws')}/ws?room=${id}`); await new Promise((r) => ws.on('open', r)); ws.send(JSON.stringify({ t: 'hello', name: 'Jens' })); await sleep(80); return ws; };
  const leave = async (ws) => { ws.close(); await sleep(80); };
  const slap = (room, img, size, position = [3, 0, 20], surface = 'golv') => req('POST', `/api/rooms/${room}/stamps`, { imageId: img.id, position, normal: [0, 1, 0], quaternion: [0, 0, 0, 1], size, surface, owner: 'jens-device-1' });
  const stamps = async (room) => (await req('GET', `/api/rooms/${room}/stamps`)).body.stamps || [];
  try {
    // ---- the build city: always there, by its URL, not on the Join list / city picker, never deleted
    const info = (await req('GET', `/api/cities/${C.BUILD_CITY}`)).body.city;
    assert(info && info.name === 'Build city' && info.build === true, 'the build city exists from the start (GET /api/cities/stad-byggen)', info);
    const ws = await join(C.BUILD_CITY);
    const tree = await slap(C.BUILD_CITY, nat, 20);
    assert(tree.status === 200 && Math.abs(tree.body.stamp.size - 20) < 1e-6, 'a 20 m nature sticker outside in the build city (up to 24 m there)', tree.body);
    const sign = await slap(C.BUILD_CITY, plain, 1, [-3, 2, 20], 'golv');
    assert(sign.status === 200, '…and a normal sticker');
    const h1 = (await req('POST', `/api/cities/${C.BUILD_CITY}/houses`)).body.id;
    const bush = await slap(h1, nat, 6, [0, 0, 0]);
    assert(h1 === 'stad-byggen-1' && bush.status === 200 && Math.abs(bush.body.stamp.size - 6) < 1e-6, 'a 6 m nature sticker in the build city\'s house 1');
    const big = await slap(h1, nat, 20, [1, 0, 1]);
    assert(Math.abs(big.body.stamp.size - 8 * Math.max(1, nat.width / nat.height)) < 1e-3, '…clamped to the house\'s 8 m height', big.body.stamp.size);
    assert((await req('GET', '/api/cities')).body.cities.every((c) => c.id !== C.BUILD_CITY), 'the build city is not in the city picker');
    assert(!((await req('GET', '/api/rooms/open')).body.rooms || []).some((r) => C.isBuildCity(r.id)), '…nor on the start card\'s Join list');
    await leave(ws); await sleep(GRACE + 200);
    assert(!S.reaper.pending().length && await S.store.peek(C.BUILD_CITY) && await S.store.peek(h1), 'the build city is never deleted when empty');
    assert(!(await S.reaper.sweep()).some((id) => C.isBuildCity(id)), '…nor by the sweep');

    // ---- autosave into the default city preset
    await sleep(AUTOSAVE + 300);
    let list = (await req('GET', '/api/admin/citypresets', null, true)).body;
    assert(list.presets.length === 1 && list.presets[0].default && list.presets[0].stickers.outside === 2 && list.presets[0].stickers['1'] === 2, 'every change in the build city is saved into the default city preset by itself', list);
    assert((await req('GET', '/api/admin/citypresets')).status === 403, 'the city presets are admin only');
    const defId = list.presets[0].id;
    const peel = await req('DELETE', `/api/rooms/${C.BUILD_CITY}/stamps/${sign.body.stamp.id}/peel`); // not with a token header → forbidden; use the body route
    assert(peel.status === 403, '(a peel needs the peel key)');
    const p2 = await fetch(`${S.base}/api/rooms/${C.BUILD_CITY}/stamps/${sign.body.stamp.id}/peel`, { method: 'DELETE', headers: { 'x-peel-token': sign.body.peelToken } });
    assert(p2.status === 200, 'peeling the normal sticker off in the build city');
    await sleep(AUTOSAVE + 300);
    list = (await req('GET', '/api/admin/citypresets', null, true)).body;
    assert(list.presets[0].stickers.outside === 1, '…the default preset follows (outside: just the tree)', list.presets[0]);

    // ---- a new city copies the default preset; it survives the city being emptied + deleted
    const newCity = async (name) => (await req('POST', '/api/cities', { name })).body.city.id;
    const a = await newCity('Slapville');
    let st = await stamps(a);
    assert(st.length === 1 && st[0].imageId === nat.id && Math.abs(st[0].size - 20) < 1e-6 && !('peelHash' in st[0]), 'a new city starts with the default preset\'s outside (the 20 m tree)', st);
    const ah1 = (await req('POST', `/api/cities/${a}/houses`)).body.id;
    assert((await stamps(ah1)).length === 2, '…its house 1, when started, gets the preset\'s house 1');
    const ah2 = (await req('POST', `/api/cities/${a}/houses`)).body.id;
    assert((await stamps(ah2)).length === 0, '…house 2 (nothing in the preset) starts empty');
    // a player in that city: their sticker stays in their city only; they can't peel the preset's (no key)
    const w2 = await join(a);
    const mine = await slap(a, plain, 1, [5, 0, 5]);
    const pk = await fetch(`${S.base}/api/rooms/${a}/stamps/${st[0].id}/peel`, { method: 'DELETE', headers: { 'x-peel-token': mine.body.peelToken } });
    assert(mine.status === 200 && pk.status === 403, 'a player\'s own sticker in a city; the preset\'s stickers can\'t be peeled by players');
    await leave(w2); await sleep(GRACE + 250);
    assert(!(await S.store.peek(a)) && !(await S.store.peek(ah1)), 'the empty city is deleted (outside + houses)');
    list = (await req('GET', '/api/admin/citypresets', null, true)).body;
    assert(list.presets.length === 1 && list.presets[0].stickers.outside === 1 && list.presets[0].stickers['1'] === 2, '…the preset is untouched (players\' changes never go into it)', list.presets[0]);
    const b = await newCity('Again');
    st = await stamps(b);
    assert(st.length === 1 && st[0].imageId === nat.id, 'a city started again afterwards: the tree is there again');

    // ---- admin: snapshot as a new named preset, make it the default
    const snap = await req('POST', '/api/admin/citypresets', { name: 'Empty test', from: b }, true);
    assert(snap.status === 200 && snap.body.preset.name === 'Empty test' && !snap.body.preset.default, 'admin snapshots a city as a new named preset (not the default)', snap.body);
    const mk = await req('PATCH', `/api/admin/citypresets/${snap.body.preset.id}`, { default: true }, true);
    list = (await req('GET', '/api/admin/citypresets', null, true)).body.presets;
    assert(mk.status === 200 && list.filter((p) => p.default).length === 1 && list.find((p) => p.default).id === snap.body.preset.id, '…and makes it THE default (one default only)');
    await req('PATCH', `/api/admin/citypresets/${defId}`, { default: true, name: 'The City' }, true);

    // ---- a restart (deploy): a new server on the same storage
    await S.app.locals.cityPresets.flush();
    await S.store.flush(); S.rt.close(); S.server.close();
    S = await boot();
    list = (await req('GET', '/api/admin/citypresets', null, true)).body.presets;
    const d = list.find((p) => p.default);
    assert(list.length === 2 && d.id === defId && d.name === 'The City' && d.stickers.outside === 1, 'after a restart the city presets are still there (storage, like the room presets)', list);
    const c = await newCity('After deploy');
    assert((await stamps(c)).length === 1 && (await stamps(C.BUILD_CITY)).length === 1, '…a new city still gets the tree; the build city kept its stickers');
    console.log('\nAlla city-preset-tester gick igenom.');
    S.rt.close(); S.server.close(); process.exit(0);
  } catch (e) { console.error(e.message); process.exit(1); }
})();
