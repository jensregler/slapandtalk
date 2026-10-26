// 📷 Photos (server/photos.js): upload → list → serve (/p/<id>, /p/<id>/file), size/type/rate
// limits, unguessable ids, retention, admin delete, and a demo room's photos outliving the room.
// Run: node tests/photos.test.js
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { makeEntitlements } = require('../server/entitlements');
const { demoSettings, createDemo } = require('../server/demo');
const { photoSettings, PHOTO_ID_RE } = require('../server/photos');

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('✔ ' + name); };
const jpeg = (w = 1920, h = 1080) => sharp({ create: { width: w, height: h, channels: 3, background: '#3366aa' } }).jpeg({ quality: 80 }).withMetadata({ exif: { IFD0: { Copyright: 'secret-gps' } } }).toBuffer();
const KEY = 'photo-test-key-12345';

(async () => {
  assert.deepEqual(photoSettings({}), { retentionDays: 30, maxMB: 8, perMinute: 6, perHour: 60, maxConcurrent: 3, publicUrl: '' });
  assert.equal(photoSettings({ VIDEO_RETENTION_DAYS: '14' }).retentionDays, 14, 'like the videos by default');
  assert.equal(photoSettings({ VIDEO_RETENTION_DAYS: '14', PHOTO_RETENTION_DAYS: '90' }).retentionDays, 90);

  let now = Date.parse('2026-10-29T18:00:00Z');
  const clock = () => now;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-photos-'));
  const store = createStore(new LocalAdapter(dir), { clock });
  const app = createApp(store, { adminToken: 'adm', clock, entitle: makeEntitlements({ FULL_ACCESS_KEYS: KEY }), photos: { ...photoSettings({}), perMinute: 7, maxMB: 1 } });
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const post = (room, body, { type = 'image/jpeg', q = 'source=live&view=eyes', headers = {} } = {}) => fetch(`${base}/api/rooms/${room}/photos?${q}`, { method: 'POST', headers: { 'Content-Type': type, ...headers }, body });
  try {
    const { room: { id: R }, roomKey: RK } = await (await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    let first;
    await test('upload: anyone in the room, JPEG re-encoded without metadata, a 64-bit random id and a /p/<id> share link', async () => {
      const r = await post(R, await jpeg()); assert.equal(r.status, 200);
      const j = await r.json(); first = j.photo;
      assert.ok(PHOTO_ID_RE.test(first.id) && j.shareUrl === `${base}/p/${first.id}` && first.url === `/p/${first.id}`);
      assert.ok(first.width === 1920 && first.height === 1080 && first.source === 'live' && first.view === 'eyes' && first.free === true && !('room' in first));
      assert.ok(Date.parse(first.expiresAt) === now + 30 * 86400_000, 'kept 30 days (VIDEO_RETENTION_DAYS default)');
      const file = path.join(dir, 'photos', R, `${first.id}.jpg`);
      assert.ok(fs.existsSync(file) && fs.existsSync(path.join(dir, 'photos', '_index', `${first.id}.json`)), 'stored as photos/<room>/<id>.jpg');
      const meta = await sharp(fs.readFileSync(file)).metadata();
      assert.ok(meta.format === 'jpeg' && !meta.exif, 'no EXIF kept');
      const png = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#f00' } }).png().toBuffer();
      const p2 = await (await post(R, png, { type: 'image/png', q: 'source=replay&rec=0123456789abcdef&view=autocam:ab12cd34ef', headers: { 'x-unlock': KEY } })).json();
      assert.ok(p2.photo.source === 'replay' && p2.photo.recId === '0123456789abcdef' && p2.photo.view === 'autocam:ab12cd34ef' && p2.photo.free === false, JSON.stringify(p2));
    });
    await test('list (the room’s creator only, like recordings), serve the page and the file (download name)', async () => {
      assert.equal((await fetch(`${base}/api/rooms/${R}/photos`)).status, 403);
      const l = await (await fetch(`${base}/api/rooms/${R}/photos`, { headers: { 'x-room-key': RK } })).json();
      assert.equal(l.photos.length, 2); assert.ok(l.photos.some((p) => p.id === first.id));
      const page = await fetch(`${base}/p/${first.id}`); const html = await page.text();
      assert.ok(page.status === 200 && html.includes(`/p/${first.id}/file`) && html.includes('og:image'));
      const f = await fetch(`${base}/p/${first.id}/file?download=1`);
      assert.ok(f.status === 200 && f.headers.get('content-type') === 'image/jpeg' && /attachment; filename="slapandtalk-[a-z0-9]+-\d{8}-\d{6}\.jpg"/.test(f.headers.get('content-disposition')), f.headers.get('content-disposition'));
      assert.ok((await f.arrayBuffer()).byteLength > 1000);
      assert.equal((await fetch(`${base}/p/0000000000000000`)).status, 404);
      assert.equal((await fetch(`${base}/p/NOT-AN-ID`)).status, 404);
      assert.equal((await (await fetch(`${base}/api/photos/${first.id}`)).json()).id, first.id);
    });
    await test('limits: not an image → 415, too big → 413, too small → 400, unknown room → 404, rate limit → 429', async () => {
      assert.equal((await post(R, Buffer.from('hello there, not a photo'))).status, 415);
      const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1.2 * 1024 * 1024)]);
      assert.equal((await post(R, big)).status, 413);
      assert.equal((await post(R, await jpeg(32, 32))).status, 400);
      assert.equal((await post('nosuchroom1', await jpeg(100, 100))).status, 404);
      let last = 200; for (let i = 0; i < 6 && last !== 429; i++) last = (await post(R, await jpeg(100, 100))).status;
      assert.equal(last, 429, 'per-IP uploads per minute');
    });
    await test('retention: gone after PHOTO_RETENTION_DAYS (read time + cleanup), admin may delete', async () => {
      const l = await (await fetch(`${base}/api/rooms/${R}/photos`, { headers: { 'x-room-key': RK } })).json();
      const other = l.photos.find((p) => p.id !== first.id);
      assert.equal((await fetch(`${base}/api/photos/${other.id}`, { method: 'DELETE' })).status, 403);
      assert.equal((await fetch(`${base}/api/photos/${other.id}`, { method: 'DELETE', headers: { 'x-admin-token': 'adm' } })).status, 200);
      now += 31 * 86400_000;
      assert.equal((await fetch(`${base}/p/${first.id}`)).status, 404);
      const gone = await app.locals.photos.cleanup();
      assert.ok(gone.includes(first.id) && !fs.existsSync(path.join(dir, 'photos', R, `${first.id}.jpg`)));
    });
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }

  await test('demo: photos are free there too, and they outlive the room (expiry deletes the room and recordings/, never photos/)', async () => {
    let t = Date.parse('2026-10-29T18:00:00Z');
    const dclock = () => t;
    const ddir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-photos-demo-'));
    const dstore = createStore(new LocalAdapter(ddir), { clock: dclock });
    const demo = createDemo({ store: dstore, settings: { ...demoSettings({ DEMO_PROFILE: '1' }), roomMs: 60 * 60_000 }, clock: dclock, log: { log() {}, error() {} } });
    const dapp = createApp(dstore, { adminToken: 'adm', demo, clock: dclock, entitle: makeEntitlements({ FULL_ACCESS_KEYS: KEY, DEMO_PROFILE: '1' }) });
    const s = dapp.listen(0); const b = `http://127.0.0.1:${s.address().port}`;
    try {
      const { room: { id: R } } = await (await fetch(`${b}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
      const up = await fetch(`${b}/api/rooms/${R}/photos?source=live`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-unlock': KEY }, body: await jpeg(640, 360) });
      assert.equal(up.status, 200); const { photo } = await up.json();
      assert.equal(photo.free, true, 'in the demo no key unlocks anything: a free photo');
      t += 61 * 60_000;
      assert.ok((await demo.sweep()).includes(R), 'the demo room expired');
      assert.equal(await dstore.peek(R).catch(() => null), null, 'the room is gone');
      assert.equal((await fetch(`${b}/p/${photo.id}`)).status, 200, 'the photo page still works');
      assert.equal((await fetch(`${b}/p/${photo.id}/file`)).status, 200);
      assert.ok(fs.existsSync(path.join(ddir, 'photos', R, `${photo.id}.jpg`)));
    } finally { s.close(); fs.rmSync(ddir, { recursive: true, force: true }); }
  });
  console.log(`photos: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
