// The city's name + the city file (Jens t864u, 12 Nov 2026), over HTTP on a real app (createApp):
//  - a new city gets a fictional name (no name asked), names don't repeat
//  - the Town Hall rename works ONCE (first come first served), then 409 for good (persisted); The City keeps its name
//  - Export city → Import city into a FRESH data dir restores the rooms (stamps, name, lock, houses), the baked
//    tiles + archive segments, and the designs; admin only; a replaced room is backed up; local mode hands the
//    local token only to localhost.
const fs = require('fs'); const os = require('os'); const path = require('path');
const sharp = require('sharp');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const CITY = require('../shared/city.mjs');

const assert = (c, m, x) => { if (!c) throw new Error('FEL: ' + m + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 600) : '')); console.log('✔ ' + m); };
const quiet = { error() {}, log() {}, warn() {} };
const TOKEN = 'test-admin-token-0123456789abcdef';

async function boot(dir, opts = {}) {
  const store = createStore(new LocalAdapter(dir), { log: quiet });
  const app = createApp(store, { adminToken: TOKEN, log: quiet, ...opts });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { store, app, server, base, close: async () => { await store.flush(); await new Promise((r) => server.close(r)); } };
}
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

(async () => {
  const NAMES = await import('../shared/citynames.mjs');
  let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const many = Array.from({ length: 200 }, () => NAMES.fictionalCityName(rnd));
  assert(many.every((n) => typeof n === 'string' && n.length >= 4 && n.length <= 32 && /^[A-ZÅÄÖ]/.test(n)), 'fictional names: capitalised, 4–32 letters', many.slice(0, 8));
  assert(new Set(many).size > 60, 'fictional names: plenty of different ones', new Set(many).size);
  assert(NAMES.freshCityName(['Slapville'], () => 0.01) !== 'Slapville', 'a fresh name avoids a name already in use');

  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-cityfile-a-'));
  const A = await boot(dirA);
  try {
    // ---- a new city: no name asked, a fictional one given ----
    let r = await j(await fetch(`${A.base}/api/cities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ by: 'Jens' }) }));
    assert(r.status === 200 && /^stad-[a-z0-9]{6}$/.test(r.body.city.id) && r.body.city.name && r.body.city.name !== 'A city', 'POST /api/cities without a name → a city with a fictional name', r.body.city);
    assert(r.body.city.canRename === true, '…and its name can still be changed once');
    const C = r.body.city.id, born = r.body.city.name;
    r = await j(await fetch(`${A.base}/api/cities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Named By Script' }) }));
    assert(r.body.city.name === 'Named By Script', 'a name in the request is still taken (old clients / scripts)');

    // ---- the Town Hall rename: once ----
    r = await j(await fetch(`${A.base}/api/cities/${C}/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '   ' }) }));
    assert(r.status === 400, 'an empty name is refused (and does not use up the rename)', r);
    r = await j(await fetch(`${A.base}/api/cities/${C}/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Jensköping', by: 'Jens' }) }));
    assert(r.status === 200 && r.body.city.name === 'Jensköping' && r.body.city.canRename === false, `rename "${born}" → "Jensköping" works the first time, then canRename is false`, r.body);
    r = await j(await fetch(`${A.base}/api/cities/${C}/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Second Try' }) }));
    assert(r.status === 409, 'a second rename (anyone) → 409', r);
    r = await j(await fetch(`${A.base}/api/cities/${C}`));
    assert(r.body.city.name === 'Jensköping' && r.body.city.canRename === false, 'GET the city: the new name, rename gone', r.body.city);
    r = await j(await fetch(`${A.base}/api/cities/stad/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Nope' }) }));
    assert(r.status === 403, 'The City (stad) keeps its name', r);

    // ---- something to export: stickers outside + in house 1, a baked tile + a segment ----
    const design = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 120, b: 255, alpha: 1 } } }).webp().toBuffer();
    const IMG = { id: 'abcdefabcdef0123', url: '/uploads/abcdefabcdef0123.webp', width: 64, height: 64 };
    await A.store.addImage(IMG); await A.store.putImageFile(IMG.id, design);
    for (let i = 0; i < 5; i++) await A.store.addStamp(C, { imageId: IMG.id, position: [i, 0, 3], normal: [0, 1, 0], quaternion: [-0.7071, 0, 0, 0.7071], size: 0.4, surface: 'golv' });
    r = await j(await fetch(`${A.base}/api/cities/${C}/houses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n: 1 }) }));
    assert(r.status === 200 && r.body.id === `${C}-1`, 'house 1 started', r);
    await A.store.addStamp(`${C}-1`, { imageId: IMG.id, position: [0, 1, -7.9], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.4, surface: 'vägg-norr' });
    const tileHash = '0123456789abcdef', segHash = 'fedcba9876543210';
    const tile = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).webp({ lossless: true }).toBuffer();
    for (const k of ['', '-d', '-h']) await A.store.adapter.put(`surfacetex/img/${tileHash}${k}.webp`, tile, 'image/webp');
    await A.store.adapter.put(`surfacetex/seg/${segHash}.json`, Buffer.from(JSON.stringify({ room: C, stamps: [{ id: 'archived00000001', imageId: IMG.id, surface: 'golv' }] })), 'application/json');
    await A.store.editRoom(C, (room) => { room.surfaceTex = { v: 1, count: 1, rev: 1, tiles: { 'golv|5|6': { img: tileHash, px: 1024, rev: 1, segs: [segHash] } }, segs: [segHash], stale: [], removed: [] }; });

    // ---- export: admin only ----
    r = await fetch(`${A.base}/api/admin/cities/${C}/export`);
    assert(r.status === 403, 'export without the admin key → 403');
    r = await j(await fetch(`${A.base}/api/admin/cities/${C}/export?plan=1`, { headers: { 'x-admin-token': TOKEN } }));
    assert(r.body.rooms.length === 2 && r.body.stamps === 6 && r.body.painted === 1 && r.body.tiles === 1 && r.body.segments === 1 && r.body.designs === 1, 'the plan: 2 rooms, 6 live + 1 painted stickers, 1 tile, 1 segment, 1 design', r.body);
    r = await fetch(`${A.base}/api/admin/cities/${C}/export`, { headers: { 'x-admin-token': TOKEN } });
    assert(r.status === 200 && /application\/gzip/.test(r.headers.get('content-type')) && /\.satcity"/.test(r.headers.get('content-disposition')), 'export → a .satcity download', [r.status, r.headers.get('content-disposition')]);
    const file = Buffer.from(await r.arrayBuffer());
    assert(file[0] === 0x1f && file[1] === 0x8b && file.length > 200, 'the file is gzip', file.length);
    fs.writeFileSync(path.join(dirA, 'export.satcity'), file);
  } finally { await A.close(); }

  // ---- import into a FRESH data dir ----
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-cityfile-b-'));
  const B = await boot(dirB);
  try {
    const file = fs.readFileSync(path.join(dirA, 'export.satcity'));
    const C = JSON.parse(require('zlib').gunzipSync(file).subarray(512, 512 + 4000).toString('utf8').replace(/\0[\s\S]*$/, '')).city;
    let r = await j(await fetch(`${B.base}/api/admin/cities/import`, { method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: file }));
    assert(r.status === 403, 'import without the admin key → 403', r);
    r = await j(await fetch(`${B.base}/api/admin/cities/import`, { method: 'POST', headers: { 'Content-Type': 'application/gzip', 'x-admin-token': TOKEN }, body: Buffer.from('not a city file at all') }));
    assert(r.status === 400, 'junk → 400, nothing imported', r);
    r = await j(await fetch(`${B.base}/api/admin/cities/import?target=same`, { method: 'POST', headers: { 'Content-Type': 'application/gzip', 'x-admin-token': TOKEN }, body: file }));
    assert(r.status === 200 && r.body.city === C && r.body.rooms.length === 2 && r.body.name === 'Jensköping' && !r.body.backup, 'import into a fresh server: the same city id, 2 rooms, the name, nothing to back up', r.body);
    const info = (await j(await fetch(`${B.base}/api/cities/${C}`))).body.city;
    assert(info && info.name === 'Jensköping' && info.canRename === false && info.houses.includes(1), 'the city is there with its name, rename still used up, house 1 started', info);
    const st = (await j(await fetch(`${B.base}/api/rooms/${C}/stamps`))).body;
    assert(st.stamps.length === 5 && st.images[`abcdefabcdef0123`], 'the 5 live stickers outside + their design are back', { n: st.stamps.length });
    assert(st.surfaceTex && st.surfaceTex.count === 1 && st.surfaceTex.tiles['golv|5|6'], 'the baked tile manifest is back', st.surfaceTex);
    const t = await fetch(`${B.base}/api/surfacetex/0123456789abcdef-d.webp`);
    assert(t.status === 200 && (await t.arrayBuffer()).byteLength > 0, 'the tile picture is served from the fresh server');
    assert(fs.existsSync(path.join(dirB, 'surfacetex/seg/fedcba9876543210.json')), 'the archive segment is back');
    const h1 = (await j(await fetch(`${B.base}/api/rooms/${C}-1/stamps`))).body;
    assert(h1.stamps.length === 1, 'house 1 with its sticker is back', h1.stamps.length);
    const up = await fetch(`${B.base}/uploads/abcdefabcdef0123.webp`);
    assert(up.status === 200, 'the design file is served');

    // again into the same city: what is there is backed up first
    r = await j(await fetch(`${B.base}/api/admin/cities/import?target=same`, { method: 'POST', headers: { 'Content-Type': 'application/gzip', 'x-admin-token': TOKEN }, body: file }));
    assert(r.status === 200 && r.body.backup && fs.existsSync(path.join(dirB, r.body.backup, 'rooms', `${C}.json`)), 'importing over a city keeps a backup of the old rooms', r.body);
    // into a NEW city id: houses follow
    r = await j(await fetch(`${B.base}/api/admin/cities/import?target=new`, { method: 'POST', headers: { 'Content-Type': 'application/gzip', 'x-admin-token': TOKEN }, body: file }));
    const N = r.body.city;
    assert(r.status === 200 && N !== C && CITY.isCityOutside(N) && r.body.rooms.includes(`${N}-1`), 'target=new: a fresh city id, its house renamed with it', r.body);
    const ni = (await j(await fetch(`${B.base}/api/cities/${N}`))).body.city;
    assert(ni.name === 'Jensköping' && ni.houses.includes(1), 'the new copy has the name and its house', ni);
  } finally { await B.close(); }

  // ---- local mode: /api/config gives the local token only to localhost ----
  const dirC = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-cityfile-c-'));
  const L = await boot(dirC, { local: { token: TOKEN } });
  const getHost = (host) => new Promise((ok, no) => {
    const u = new URL(L.base);
    require('http').get({ host: u.hostname, port: u.port, path: '/api/config', headers: { Host: host } }, (res) => { let d = ''; res.on('data', (x) => { d += x; }); res.on('end', () => ok(JSON.parse(d))); }).on('error', no);
  });
  try {
    const c = (await j(await fetch(`${L.base}/api/config`))).body;
    assert(c.local === true && c.localToken === TOKEN, 'local mode: a page on this PC (127.0.0.1) gets the local admin token', { local: c.local, hasToken: !!c.localToken });
    const lh = await getHost('localhost:8790');
    assert(lh.localToken === TOKEN, 'local mode: http://localhost:<port> gets it too');
    const evil = await getHost('evil.example');
    assert(evil.local === true && !evil.localToken, 'local mode: another host name (DNS rebinding) gets no token', evil);
  } finally { await L.close(); }
  const off = await boot(fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-cityfile-d-')));
  try { const c = (await j(await fetch(`${off.base}/api/config`))).body; assert(c.demo === false && !c.local && !c.localToken, 'the live server (not local) never hands out a token', c); }
  finally { await off.close(); }
  console.log('cityfile: all ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
