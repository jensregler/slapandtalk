// Tester av rummen, städjobbet, lagrings-adaptrarna och att samma bild bara sparas en gång.
// Körs utan webbläsare och utan riktig server-disk: allt i en tillfällig mapp och en låtsas-S3.
// Körs med: node tests/rooms.test.js (ingår i npm test)
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { LocalAdapter } = require('../server/storage/local');
const { S3Adapter } = require('../server/storage/s3');
const { createAdapter } = require('../server/storage');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const HOUR = 3600_000;

// En låtsas-S3 i minnet som förstår de kommandon S3Adapter använder.
function fakeS3() {
  const objects = new Map();
  const notFound = (name) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
  return {
    objects,
    async send(cmd) {
      const { Key, Prefix, Body } = cmd.input;
      switch (cmd.constructor.name) {
        case 'PutObjectCommand': objects.set(Key, Buffer.from(Body)); return {};
        case 'GetObjectCommand': {
          if (!objects.has(Key)) throw notFound('NoSuchKey');
          const b = objects.get(Key); return { Body: { transformToByteArray: async () => new Uint8Array(b) } };
        }
        case 'HeadObjectCommand': if (!objects.has(Key)) throw notFound('NotFound'); return {};
        case 'DeleteObjectCommand': objects.delete(Key); return {};
        case 'ListObjectsV2Command': return { Contents: [...objects.keys()].filter((k) => k.startsWith(Prefix)).map((k) => ({ Key: k })), IsTruncated: false };
        default: throw new Error('okänt kommando ' + cmd.constructor.name);
      }
    },
  };
}

async function adapterContract(name, a) {
  await a.put('rooms/x.json', Buffer.from('{"a":1}'), 'application/json');
  await a.put('rooms/y.json', Buffer.from('{}'));
  await a.put('uploads/z.webp', Buffer.from([1, 2, 3]), 'image/webp');
  const got = await a.get('rooms/x.json');
  const list = (await a.list('rooms/')).sort();
  const ok = got && got.toString() === '{"a":1}' && list.join() === 'rooms/x.json,rooms/y.json'
    && (await a.exists('uploads/z.webp')) && !(await a.exists('uploads/nej.webp')) && (await a.get('rooms/nej.json')) === null;
  await a.delete('rooms/x.json'); await a.delete('rooms/finns-inte.json');
  assert(ok && !(await a.exists('rooms/x.json')), `${name}-adaptern: spara, läsa, lista, finns, ta bort`);
}

async function roomLifecycle(name, adapter) {
  let now = Date.parse('2026-10-24T12:00:00Z');
  const store = createStore(adapter, { clock: () => now });
  const ttl = 24 * HOUR;

  const a = await store.createRoom({ type: 'quick' });
  const b = await store.createRoom({ type: 'quick' });
  assert(/^[a-z2-9]{6}$/.test(a.id) && a.type === 'quick' && a.id !== b.id, `${name}: snabbrum får en kort kod (${a.id}, ${b.id})`);
  await store.touchRoom('stad');
  await store.addStamp('stad', { imageId: 'abc', size: 0.3 });
  const p = await store.createRoom({ id: 'jens-rum', type: 'profile', owner: { id: 'u1', name: 'Jens' } });
  assert(p.type === 'profile' && p.owner.name === 'Jens', `${name}: profilrum med ägare (förberett för konton)`);
  // Ett rum från före rumstyperna (ingen type och ingen lastVisitAt)
  await adapter.put('rooms/gammalt.json', Buffer.from(JSON.stringify({ id: 'gammalt', stamps: [] })));

  now += 23 * HOUR;
  await store.touchRoom(a.id); // någon är i rum a
  assert((await store.cleanupRooms({ quickTtlMs: ttl })).length === 0, `${name}: efter 23 h raderas inget`);
  now += 2 * HOUR; // 25 h: b har stått tomt för länge
  const d1 = await store.cleanupRooms({ quickTtlMs: ttl });
  assert(d1.join() === b.id && !(await store.getRoom(b.id)) && (await store.getRoom(a.id)), `${name}: efter 25 h raderas bara det tomma snabbrummet (${d1.join()})`);
  now += 100 * 24 * HOUR; // 100 dagar senare
  const d2 = (await store.cleanupRooms({ quickTtlMs: ttl })).sort();
  const left = (await store.listRooms()).sort();
  assert(d2.join() === [a.id, 'gammalt'].sort().join() && left.join() === 'jens-rum,stad',
    `${name}: Staden och profilrum raderas aldrig, alla gamla snabbrum gör det (kvar: ${left.join(', ')})`);
  assert((await store.getRoom('stad')).stamps.length === 1, `${name}: stämplarna i Staden finns kvar`);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-'));
  try {
    await adapterContract('disk', new LocalAdapter(path.join(tmp, 'a')));
    await adapterContract('S3', new S3Adapter({ bucket: 'test', prefix: 'sat/', client: fakeS3() }));
    let threw = false; try { createAdapter({ STORAGE: 's3' }); } catch { threw = true; }
    assert(threw && createAdapter({ DATA_DIR: path.join(tmp, 'd') }).kind === 'local', 'STORAGE väljer adapter (disk som standard, S3 kräver inställningar)');

    await roomLifecycle('disk', new LocalAdapter(path.join(tmp, 'b')));
    const s3 = fakeS3();
    await roomLifecycle('S3', new S3Adapter({ bucket: 'test', client: s3 }));

    // Gamla images.json flyttas till en fil per bild
    const legacy = new LocalAdapter(path.join(tmp, 'c'));
    await legacy.put('images.json', Buffer.from(JSON.stringify({ aaaaaaaaaaaaaaaa: { id: 'aaaaaaaaaaaaaaaa', url: '/uploads/aaaaaaaaaaaaaaaa.webp' } })));
    const ls = createStore(legacy);
    assert((await ls.migrate()) === 1 && (await ls.getImage('aaaaaaaaaaaaaaaa')) && !(await legacy.exists('images.json')), 'gamla images.json flyttas automatiskt');

    // HTTP: skapa snabbrum, profilrum (bara admin), samma bild = samma design, bilder via adaptern
    const store = createStore(new S3Adapter({ bucket: 'test', client: fakeS3() }));
    const app = createApp(store, { adminToken: 'hemligt-test', quickTtlHours: 24 });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const r = await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json();
      const info = await (await fetch(`${base}/api/rooms/${r.room.id}`)).json();
      assert(r.room.type === 'quick' && info.room.type === 'quick' && info.room.quickTtlHours === 24, `API: nytt snabbrum ${r.room.id}`);
      const stad = await (await fetch(`${base}/api/rooms/stad/stamps`)).json();
      assert(stad.info.type === 'stad' && stad.stamps.length === 0, 'API: Staden är typ stad');
      const deny = await fetch(`${base}/api/admin/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"id":"p1"}' });
      const okP = await (await fetch(`${base}/api/admin/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'hemligt-test' },
        body: JSON.stringify({ id: 'p1', owner: { id: 'u1', name: 'Jens' } }) })).json();
      assert(deny.status === 403 && okP.room.type === 'profile', 'API: profilrum kan bara skapas av admin tills konton finns');

      const png = (color) => sharp({ create: { width: 64, height: 64, channels: 4, background: color } }).png().toBuffer();
      const up = async (buf) => { const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/png' }), 'k.png'); return (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json(); };
      const red = await png('#ff0000');
      const i1 = await up(red), i2 = await up(red), i3 = await up(await png('#00ff00'));
      assert(i1.id && i1.id === i2.id && i3.id !== i1.id, `samma bild två gånger blir samma design (${i1.id})`);
      const img = await fetch(`${base}${i1.url}`);
      assert(img.status === 200 && img.headers.get('content-type') === 'image/webp' && (await img.arrayBuffer()).byteLength > 0, 'bilden hämtas via lagrings-adaptern');
      const st = await fetch(`${base}/api/rooms/${r.room.id}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: i1.id, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr' }) });
      const room = await (await fetch(`${base}/api/rooms/${r.room.id}/stamps`)).json();
      assert(st.status === 200 && room.stamps.length === 1 && room.stamps[0].imageId === i1.id && room.images[i1.id], 'stämplar pekar på designen med imageId');
    } finally { server.close(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
