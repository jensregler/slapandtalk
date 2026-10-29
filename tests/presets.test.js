// Preset rooms, the server side (server/presets.js + the routes in server/app.js). Jens, 29 Oct 2026.
// Körs med: node tests/presets.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createPresets } = require('../server/presets');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const png = (w, h, alpha = 0) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 30, g: 140, b: 60, alpha } } }).png().toBuffer();
const quiet = { error: () => {}, log: () => {}, warn: () => {} };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-presets-'));
  const adapter = new LocalAdapter(tmp);
  const P = createPresets(adapter, { log: quiet });
  assert((await P.list()).length === 0 && (await P.pick()) === null, 'no presets: list empty, pick → null');
  let err = null; try { await P.create({ files: { floor: await png(16, 16) } }); } catch (e) { err = e; }
  assert(err && err.status === 400 && /ceiling/.test(err.message), 'all six images are needed');
  const files = {}; for (const f of P.FACES) files[f] = await png(f === 'floor' || f === 'ceiling' ? 160 : 160, f === 'floor' || f === 'ceiling' ? 160 : 64, f === 'north' ? 0.5 : 0);
  const p1 = await P.create({ name: 'A', sourceRoom: 'abc123', style: { floor: 'betong', wall: 'tegel' }, files });
  assert(/^[a-f0-9]{10}$/.test(p1.id) && Object.keys(p1.faces).length === 6 && p1.faces.north.startsWith(`/api/presets/${p1.id}/north.webp`), 'create: an id, six face URLs');
  const north = await P.image(p1.id, 'north'), meta = await sharp(north).metadata();
  assert(meta.format === 'webp' && meta.width === 160 && meta.height === 64 && meta.hasAlpha, 'stored as WebP, size and alpha kept');
  const P2 = createPresets(adapter, { log: quiet }); // a restart: read back from storage
  assert((await P2.list()).map((p) => p.id).join() === p1.id && (await P2.get(p1.id)).style.wall === 'tegel', 'survives a restart (presets/<id>.json)');
  assert((await P.get('../x')) === null && (await P.image(p1.id, 'evil')) === null, 'bad ids / faces are refused');

  // the routes
  const store = createStore(new LocalAdapter(fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-presets-app-'))), { writeDelayMs: 20, log: quiet });
  const app = createApp(store, { adminToken: 'adm-presets', log: quiet });
  const server = app.listen(0), base = `http://127.0.0.1:${server.address().port}`;
  let ip = 0;
  const mk = async (body) => (await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.1.${++ip}.1` }, body: JSON.stringify(body) })).json();
  try {
    const before = await mk({});
    assert(!before.room.preset, 'no presets: POST /api/rooms {} as before');
    const src = (await mk({ style: { floor: 'parkett', wall: 'tegel' } })).room;
    const send = async (token, fields = files) => {
      const fd = new FormData(); fd.append('sourceRoom', src.id); fd.append('name', 'Forest');
      for (const [f, b] of Object.entries(fields)) fd.append(f, new Blob([b], { type: 'image/png' }), `${f}.png`);
      return fetch(`${base}/api/admin/presets`, { method: 'POST', headers: token ? { 'x-admin-token': token } : {}, body: fd });
    };
    assert((await send(null)).status === 403 && (await send('wrong-token-xx')).status === 403, 'POST /api/admin/presets: admin only');
    const { floor, ...five } = files;
    assert((await send('adm-presets', five)).status === 400, '…five images → 400');
    const r = await send('adm-presets'); const { preset } = await r.json();
    assert(r.status === 200 && preset.sourceRoom === src.id && preset.style.floor === 'parkett', '…six images from a room code → a preset with that room\'s look');
    const img = await fetch(`${base}${preset.faces.floor}`);
    assert(img.status === 200 && img.headers.get('content-type') === 'image/webp', 'GET the face image (public, cached)');
    const nu = await mk({});
    assert(nu.room.preset && nu.room.preset.id === preset.id && nu.room.style.floor === 'parkett', 'a room asked for without a look gets the preset (look + faces)');
    const got = await (await fetch(`${base}/api/rooms/${nu.room.id}`)).json();
    assert(got.room.preset && got.room.preset.faces.north === preset.faces.north, 'GET /api/rooms/:room carries the preset');
    assert(!(await mk({ style: { floor: 'betong', wall: 'puts' } })).room.preset && !(await mk({ preset: false })).room.preset, 'a picked look / { preset: false }: none');
    assert((await mk({ preset: preset.id })).room.preset.id === preset.id && (await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.2.0.1' }, body: '{"preset":"nope00000"}' })).status === 404, '{ preset: id } asks for that one (unknown → 404)');
    const put = (key, admin) => fetch(`${base}/api/rooms/${nu.room.id}/style`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(key ? { 'x-room-key': key } : {}), ...(admin ? { 'x-admin-token': admin } : {}) }, body: JSON.stringify({ style: { floor: 'betong', wall: 'puts' } }) });
    const locked = await put(nu.roomKey);
    assert(locked.status === 403 && /preset/.test((await locked.json()).error), 'the walls are locked: the creator\'s key cannot change the look');
    assert((await put(null, 'adm-presets')).status === 200, '…admin still can');
    const del = await (await fetch(`${base}/api/admin/presets/${preset.id}`, { method: 'DELETE', headers: { 'x-admin-token': 'adm-presets' } })).json();
    assert(del.ok && !(await mk({})).room.preset, 'DELETE: gone, new rooms as before');
  } finally { server.close(); }
  console.log('presets: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
