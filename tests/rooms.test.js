// Tester av rummen, städjobbet, lagrings-adaptrarna och att samma bild bara sparas en gång.
// Körs utan webbläsare och utan riktig server-disk: allt i en tillfällig mapp och en låtsas-S3.
// Körs med: node tests/rooms.test.js (ingår i npm test)
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { LocalAdapter } = require('../server/storage/local');
const { S3Adapter, buildS3Config, normalizeEndpoint } = require('../server/storage/s3');
const { safeStep, checkStorage, installProcessGuards } = require('../server/startup');
const { EventEmitter } = require('events');
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

// ---------- Snabb klibba: svaret väntar inte på lagringen (R2 ligger långt bort) ----------
// En "långsam S3" (varje anrop tar 150 ms, som Render i USA mot R2 i Europa). En stämpling ska
// ändå svara och skickas ut direkt, skrivas till lagringen strax efter, försöka igen om det
// misslyckas, och allt ska finnas kvar efter flush() (det servern gör vid SIGTERM).
async function writeBehind() {
  const LAG = 150;
  const s3 = fakeS3();
  const calls = [];
  let failPuts = 0;
  const slow = {
    objects: s3.objects,
    async send(cmd) {
      calls.push(cmd.constructor.name + ' ' + (cmd.input.Key || cmd.input.Prefix));
      await new Promise((r) => setTimeout(r, LAG));
      if (cmd.constructor.name === 'PutObjectCommand' && cmd.input.Key.startsWith('rooms/') && failPuts > 0) { failPuts--; throw Object.assign(new Error('R2 svarar inte'), { code: 'ECONNRESET' }); }
      return s3.send(cmd);
    },
  };
  const adapter = new S3Adapter({ bucket: 'test', client: slow });
  const errs = [];
  const store = createStore(adapter, { writeDelayMs: 50, retryMs: 50, log: { error: (m) => errs.push(m), log: () => {} } });
  const app = createApp(store, { quickTtlHours: 24 });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff00aa' } }).png().toBuffer();
    const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'k.png');
    const img = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
    await (await fetch(`${base}/api/rooms/snabb/stamps`)).json(); // rummet laddas (som när man går in)
    const slap = (x) => fetch(`${base}/api/rooms/snabb/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: img.id, position: [x, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr' }) }).then((r) => r.json());
    calls.length = 0;
    const t0 = Date.now();
    const first = await slap(0);
    const ms = Date.now() - t0;
    assert(first.stamp && ms < LAG && calls.length === 0, `en klibba svarar direkt (${ms} ms) utan att vänta på lagringen (${LAG} ms per anrop, ${calls.length} anrop före svaret)`);
    const burst = await Promise.all([1, 2, 3, 4, 5].map(slap));
    assert(burst.every((b) => b.stamp) && new Set(burst.map((b) => b.stamp.order)).size === 5, 'fem klibbor samtidigt får var sitt nummer');
    assert(!s3.objects.has('rooms/snabb.json') && store.pendingWrites() === 1, 'när svaren kommit är inget skrivet än: skrivningen sker i bakgrunden');
    await new Promise((r) => setTimeout(r, 50 + LAG * 3));
    const puts = calls.filter((c) => c === 'PutObjectCommand rooms/snabb.json').length;
    const saved = JSON.parse(s3.objects.get('rooms/snabb.json')).stamps.length;
    assert(saved === 6 && puts <= 3, `strax efter ligger alla 6 i lagringen, sparade i ${puts} skrivningar (ihopsamlade, inte en per klibba)`);
    assert(!calls.some((c) => c.includes('images/') || c.includes('uploads/')), 'designen hämtas eller laddas inte upp igen vid varje klibba');
    // Lagringen strular: klibban syns ändå, och sparas när lagringen svarar igen.
    failPuts = 2;
    const during = await slap(7);
    await new Promise((r) => setTimeout(r, 50 + 4 * (LAG + 200)));
    const after = JSON.parse(s3.objects.get('rooms/snabb.json')).stamps;
    assert(during.stamp && after.some((x) => x.id === during.stamp.id) && errs.length >= 2 && store.pendingWrites() === 0,
      `misslyckad skrivning försöks igen tills den lyckas (${errs.length} fel loggade, sparad till slut)`);
    // Avstängning: det som inte hunnit skrivas skrivs av flush().
    const last = await slap(8);
    assert(store.pendingWrites() === 1, 'en ny klibba väntar på att skrivas');
    const fl = await store.flush();
    const fresh = createStore(adapter); // som en ny server efter omstart
    const reloaded = await fresh.getRoom('snabb');
    assert(fl.failed === 0 && reloaded.stamps.length === 8 && reloaded.stamps.some((x) => x.id === last.stamp.id) && store.pendingWrites() === 0,
      'flush() (vid SIGTERM) skriver ut allt som väntar: efter omstart finns alla 8 klibbor kvar');
    // Borttaget rum: syns inte i listan och kommer inte tillbaka från en sen skrivning.
    await store.deleteRoom('snabb');
    assert(!(await store.getRoom('snabb')) && !s3.objects.has('rooms/snabb.json') && !(await store.listRooms()).includes('snabb'), 'ett borttaget rum är borta både i minnet och i lagringen');
    // Kopian utåt går inte att ändra av misstag.
    await store.addStamp('kopia', { imageId: img.id, size: 0.3 });
    const c1 = await store.getRoom('kopia'); c1.stamps.length = 0;
    assert((await store.getRoom('kopia')).stamps.length === 1, 'getRoom ger en kopia: rummet i minnet ändras inte utifrån');
    await store.flush();
  } finally { server.close(); }
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

    // ---------- R2-kompatibel S3-klient ----------
    const ACC = 'https://85fe7ec7db7112e86d5654721a7f63e5.r2.cloudflarestorage.com';
    const cfg = buildS3Config({ bucket: 'slapandtalk', endpoint: ACC, accessKeyId: 'a', secretAccessKey: 'b' });
    assert(cfg.forcePathStyle === true && cfg.region === 'auto' && cfg.endpoint === ACC && cfg.requestChecksumCalculation === 'WHEN_REQUIRED' && cfg.responseChecksumValidation === 'WHEN_REQUIRED',
      'S3-inställningar för R2: path-style, region auto, checksummor bara när det krävs');
    assert(normalizeEndpoint(ACC + '/slapandtalk/', 'slapandtalk') === ACC && normalizeEndpoint(ACC + '/', 'slapandtalk') === ACC
      && normalizeEndpoint('https://slapandtalk.85fe7ec7db7112e86d5654721a7f63e5.r2.cloudflarestorage.com', 'slapandtalk') === ACC
      && normalizeEndpoint('85fe7ec7db7112e86d5654721a7f63e5.r2.cloudflarestorage.com', 'slapandtalk') === ACC && normalizeEndpoint('', 'x') === undefined
      && buildS3Config({ bucket: 'b', region: 'eu-north-1' }).region === 'eu-north-1',
      'S3_ENDPOINT städas: bucket-sökväg, snedstreck och bucket-subdomän tas bort, https:// läggs till');
    // Riktig S3Client: anropet ska gå till kontots värd med bucketen i sökvägen (stoppas innan nätverk).
    const real = new S3Adapter({ bucket: 'slapandtalk', endpoint: ACC + '/slapandtalk', accessKeyId: 'a', secretAccessKey: 'b' });
    let seen = null;
    real.client.middlewareStack.add(() => async (args) => { seen = args.request; const e = new Error('stopp'); e.name = 'Stopp'; throw e; }, { step: 'finalizeRequest', name: 'fanga', priority: 'low' });
    await real.get('rooms/x.json').catch(() => {});
    assert(seen && seen.hostname === '85fe7ec7db7112e86d5654721a7f63e5.r2.cloudflarestorage.com' && seen.path === '/slapandtalk/rooms/x.json' && !('x-amz-checksum-mode' in (seen.headers || {})),
      `S3Client anropar ${seen && seen.hostname}${seen && seen.path} (path-style, ingen bucket-subdomän)`);

    // ---------- Lagringsfel kraschar aldrig starten ----------
    const tlsErr = () => Object.assign(new Error('write EPROTO ssl3_read_bytes:tlsv1 alert handshake failure SSL alert number 40'), { code: 'EPROTO', $metadata: { attempts: 1 } });
    const broken = { kind: 's3', get: async () => { throw tlsErr(); }, put: async () => { throw tlsErr(); }, delete: async () => { throw tlsErr(); }, exists: async () => { throw tlsErr(); }, list: async () => { throw tlsErr(); } };
    const logs = [];
    const quiet = { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
    const bstore = createStore(broken);
    const mig = await safeStep('Flytt', () => bstore.migrate(), { log: quiet, fallback: 0 });
    const ok = await checkStorage(broken, { log: quiet });
    const hung = await checkStorage({ kind: 's3', list: () => new Promise(() => {}) }, { log: quiet, timeoutMs: 50 });
    assert(mig === 0 && ok === false && hung === false && logs.some((l) => l.includes('EPROTO')), 'trasig lagring (TLS-fel, eller inget svar) kastar inte ut ur starten utan loggas');
    const fakeProc = new EventEmitter();
    installProcessGuards({ log: quiet, proc: fakeProc });
    fakeProc.emit('unhandledRejection', tlsErr());
    assert(fakeProc.listenerCount('unhandledRejection') === 1 && logs.some((l) => l.includes('Ohanterat')), 'ohanterade promise-fel loggas i stället för att döda processen');
    const bapp = createApp(bstore, { quickTtlHours: 24 }).listen(0);
    try {
      const bbase = `http://127.0.0.1:${bapp.address().port}`;
      const origErr = console.error; console.error = () => {};
      let g1, g2, p1;
      try {
        g1 = await fetch(`${bbase}/api/rooms/stad/stamps`); g2 = await fetch(`${bbase}/api/rooms/stad`);
        p1 = await fetch(`${bbase}/api/rooms/stad/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: 'aaaaaaaaaaaaaaaa', position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr' }) });
      } finally { console.error = origErr; }
      const j1 = await g1.json(), j2 = await g2.json();
      assert(g1.status === 200 && j1.stamps.length === 0 && j1.storageUnavailable === true && g2.status === 200 && j2.storageUnavailable === true && p1.status >= 400,
        'när lagringen inte svarar visas rummet tomt (200), och nya klibbor nekas i stället för att skriva över');
    } finally { bapp.close(); }

    // HTTP: skapa snabbrum, profilrum (bara admin), samma bild = samma design, bilder via adaptern
    const s3a = new S3Adapter({ bucket: 'test', client: fakeS3() });
    const store = createStore(s3a);
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
      const big = await (await fetch(`${base}/api/rooms/${r.room.id}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: i1.id, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 6, surface: 'vägg-norr' }) })).json();
      assert(big.stamp && big.stamp.size === 4, `servern krymper för stora klibbor till väggens höjd i stället för att neka (6 m → ${big.stamp && big.stamp.size} m)`);
      await store.addStamp(r.room.id, { imageId: i1.id, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 5, surface: 'vägg-norr' });
      const loaded = await (await fetch(`${base}/api/rooms/${r.room.id}/stamps`)).json();
      assert(loaded.stamps.length === 3 && loaded.stamps.every((x) => x.size <= 4) && loaded.stamps[2].size === 4, 'gamla sparade stämplar större än väggen krymps när rummet laddas');
      room.stamps = loaded.stamps.slice(0, 1);

      // ---------- Rummets utseende ----------
      const mk = (body) => fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const sty = { floor: 'parkett', wall: 'malad', wallColor: 'bla', ceiling: 'vit', seed: 'abc12' };
      const made = await (await mk({ style: sty })).json();
      const seen = await (await fetch(`${base}/api/rooms/${made.room.id}`)).json();
      await store.flush(); // rummen skrivs i bakgrunden
      const rawRoom = (await s3a.get(`rooms/${made.room.id}.json`)).toString();
      assert(made.roomKey && Object.keys(sty).every((k) => seen.room.style[k] === sty[k]) && !JSON.stringify(seen).includes('keyHash') && !rawRoom.includes(made.roomKey) && rawRoom.includes('keyHash'),
        'rum skapas med utseende och en hemlig rumsnyckel (bara hash sparas)');
      const bad1 = await mk({ style: { floor: 'lava', wall: 'malad', wallColor: 'bla' } }), bad2 = await mk({ style: { floor: 'parkett', wall: 'malad' } });
      const plain = await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json();
      assert(bad1.status === 400 && bad2.status === 400 && plain.room.style.floor === 'klassisk', 'okänt utseende nekas; äldre appar utan utseende får standard');
      const put = (id, style, headers = {}) => fetch(`${base}/api/rooms/${id}/style`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ style }) });
      const ns = { floor: 'betong', wall: 'tegel', ceiling: 'betong' };
      const s1 = await put(made.room.id, ns), s2 = await put(made.room.id, ns, { 'x-room-key': plain.roomKey }), s3 = await put(made.room.id, ns, { 'x-room-key': made.roomKey });
      const afterSty = await (await fetch(`${base}/api/rooms/${made.room.id}`)).json();
      assert(s1.status === 403 && s2.status === 403 && s3.status === 200 && afterSty.room.style.wall === 'tegel', 'bara skaparen (rätt rumsnyckel) kan ändra utseendet');
      const st1 = await put('stad', ns, { 'x-room-key': made.roomKey }), st2 = await put('stad', ns, { 'x-admin-token': 'hemligt-test' });
      const stadNow = await (await fetch(`${base}/api/rooms/stad`)).json();
      assert(st1.status === 403 && st2.status === 200 && stadNow.room.style.floor === 'betong', 'Stadens utseende kan bara admin ändra');
      await s3a.put('rooms/gammalt2.json', Buffer.from(JSON.stringify({ id: 'gammalt2', stamps: [] })));
      const oldRoom = await (await fetch(`${base}/api/rooms/gammalt2`)).json();
      assert(oldRoom.room.style.floor === 'klassisk' && oldRoom.room.style.wall === 'klassisk', 'äldre rum utan utseende får dagens standardutseende');

      // ---------- Peel: bara egna stämplar, nyckeln läcker aldrig ----------
      const post = (body) => fetch(`${base}/api/rooms/${r.room.id}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: i1.id, position: [1, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr', ...body }) }).then((x) => x.json());
      const mine1 = await post({}), mine2 = await post({});
      assert(typeof mine1.peelToken === 'string' && mine1.peelToken.length >= 30 && !('peelHash' in mine1.stamp), 'ny stämpel ger en hemlig peel-nyckel (bara till den som stämplade)');
      const listing = await (await fetch(`${base}/api/rooms/${r.room.id}/stamps`)).text();
      await store.flush(); // rummen skrivs i bakgrunden
      const raw = (await s3a.get(`rooms/${r.room.id}.json`)).toString();
      assert(!listing.includes(mine1.peelToken) && !listing.includes('peelHash') && !raw.includes(mine1.peelToken) && raw.includes('peelHash'),
        'nyckeln syns aldrig i rummets lista, och servern sparar bara en hash');
      const del1 = (id, token) => fetch(`${base}/api/rooms/${r.room.id}/stamps/${id}/peel`, { method: 'DELETE', headers: token ? { 'x-peel-token': token } : {} });
      const wrong = await del1(mine1.stamp.id, mine2.peelToken), none = await del1(mine1.stamp.id, ''), old = await del1(loaded.stamps[0].id, mine1.peelToken);
      assert(wrong.status === 403 && none.status === 403 && old.status === 403, 'fel eller ingen nyckel nekas (403), även för stämplar utan nyckel');
      const ok1 = await del1(mine1.stamp.id, mine1.peelToken), again = await del1(mine1.stamp.id, mine1.peelToken);
      assert(ok1.status === 200 && again.status === 404, 'rätt nyckel peelar (200), en gång till ger 404');
      const batch = await (await fetch(`${base}/api/rooms/${r.room.id}/peel`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: mine2.stamp.id, token: 'fel' }, { id: 'ffffffffffffffff', token: 'x' }] }) })).json();
      const batch2 = await (await fetch(`${base}/api/rooms/${r.room.id}/peel`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: mine2.stamp.id, token: mine2.peelToken }] }) })).json();
      const after = await (await fetch(`${base}/api/rooms/${r.room.id}/stamps`)).json();
      assert(batch.results[mine2.stamp.id] === 'forbidden' && batch.results.ffffffffffffffff === 'notfound' && batch2.results[mine2.stamp.id] === 'ok'
        && !after.stamps.some((x) => x.id === mine1.stamp.id || x.id === mine2.stamp.id) && after.stamps.length === 3, 'flera på en gång (Peela alla): bara rätt nyckel räknas');
      // ---------- Bara de senaste 20 per person och rum går att peela ----------
      const a25 = []; for (let i = 0; i < 25; i++) a25.push(await post({ owner: 'enhet-anna-123' }));
      const b2 = [await post({ owner: 'enhet-bosse-456' }), await post({ owner: 'enhet-bosse-456' })];
      await store.flush(); // rummen skrivs i bakgrunden
      const raw2 = (await s3a.get(`rooms/${r.room.id}.json`)).toString();
      const list2 = await (await fetch(`${base}/api/rooms/${r.room.id}/stamps`)).text();
      const ids2 = new Set([...a25, ...b2].map((x) => x.stamp.id)); const keyed = JSON.parse(raw2).stamps.filter((x) => x.peelHash && ids2.has(x.id));
      assert(keyed.length === 22 && !raw2.includes('enhet-anna') && !list2.includes('peelOwner') && !a25[0].stamp.peelOwner,
        `servern sparar peel-nycklar bara för de senaste 20 per person (${keyed.length} = 20 + 2), och ägaren syns aldrig`);
      const pAll = await (await fetch(`${base}/api/rooms/${r.room.id}/peel`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [...a25, ...b2].map((x) => ({ id: x.stamp.id, token: x.peelToken })) }) })).json();
      const resA = a25.map((x) => pAll.results[x.stamp.id]);
      assert(resA.slice(0, 5).every((x) => x === 'forbidden') && resA.slice(5).every((x) => x === 'ok') && b2.every((x) => pAll.results[x.stamp.id] === 'ok'),
        'de 5 äldsta av 25 går inte längre att peela (403), de senaste 20 går, och en annan persons gräns är egen');
      // ---------- Konstnärens namn och länk: tvättas på servern ----------
      const { cleanArtistLink, linkLabel } = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'shared', 'artistlink.mjs')).href);
      const GOOD = [['@ulla.k', 'https://www.instagram.com/ulla.k'], ['instagram.com/ulla', 'https://instagram.com/ulla'], ['x.com/ulla', 'https://x.com/ulla'],
        ['https://www.tiktok.com/@ulla', 'https://www.tiktok.com/@ulla'], ['youtube.com/@ulla', 'https://youtube.com/@ulla'], ['http://ulla.se/konst', 'https://ulla.se/konst'], ['  https://ulla.se  ', 'https://ulla.se/']];
      const BAD = ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd', 'ftp://ulla.se',
        'https://user:pw@ulla.se', 'https://127.0.0.1/', 'https://localhost/', 'https://ulla.se:8080/', 'https://ulla.se/"onmouseover=x', 'https://ulla.se/<script>', '@a b', '@' + 'a'.repeat(31),
        'https://ulla.se/' + 'x'.repeat(200), 'hej', '', 42, null, { href: 'https://x.com' }];
      assert(GOOD.every(([i, o]) => cleanArtistLink(i) === o) && BAD.every((i) => cleanArtistLink(i) === ''),
        'länk: @namn blir Instagram, instagram/x/tiktok/youtube/https godkänns, javascript:, data:, inloggning, IP, port, för långt m.m. nekas');
      assert(linkLabel('https://www.instagram.com/ulla.k') === '@ulla.k · Instagram' && linkLabel('https://x.com/ulla') === '@ulla · X' && linkLabel('https://ulla.se/konst') === 'ulla.se/konst',
        'etiketten visar @namn · tjänst, annars adressen kort');
      const withLink = await post({ artist: '  Ulla\u0000 K\u202e ', artistLink: '@ulla.k' });
      const evil = await post({ artist: 'x'.repeat(100), artistLink: 'javascript:alert(document.cookie)' });
      const noLink = await post({ artist: '' });
      const listed = (await (await fetch(`${base}/api/rooms/${r.room.id}/stamps`)).json()).stamps;
      const lw = listed.find((x) => x.id === withLink.stamp.id), le = listed.find((x) => x.id === evil.stamp.id), ln = listed.find((x) => x.id === noLink.stamp.id);
      assert(withLink.stamp.artistLink === 'https://www.instagram.com/ulla.k' && withLink.stamp.artist === 'Ulla K' && lw.artistLink === withLink.stamp.artistLink && lw.artist === 'Ulla K',
        'stämpeln sparar konstnärens namn och länk (tvättade), och rummets lista har dem');
      assert(!('artistLink' in evil.stamp) && !('artistLink' in le) && le.artist.length === 60 && !JSON.stringify(listed).includes('javascript') && !('artistLink' in ln) && ln.artist === '',
        'en javascript:-länk sparas aldrig, namnet kortas till 60 tecken, och utan länk finns ingen länk');
      // ---------- Nollställ rummet (alla klibbor bort): bara skaparen eller admin, Staden bara admin ----------
      const reset = (id, headers = {}, by = 'Ulla') => fetch(`${base}/api/rooms/${id}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ by }) });
      const postIn = (id) => fetch(`${base}/api/rooms/${id}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: i1.id, position: [1, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr' }) });
      await postIn(made.room.id); await postIn(made.room.id); await postIn('stad');
      const rNo = await reset(made.room.id), rWrong = await reset(made.room.id, { 'x-room-key': 'fel' }), rOther = await reset(made.room.id, { 'x-room-key': (await (await mk({})).json()).roomKey });
      const keptN = (await (await fetch(`${base}/api/rooms/${made.room.id}/stamps`)).json()).stamps.length;
      const rOk = await reset(made.room.id, { 'x-room-key': made.roomKey }, '  Ulla\u200b  ');
      const okBody = await rOk.json();
      const leftN = (await (await fetch(`${base}/api/rooms/${made.room.id}/stamps`)).json()).stamps.length;
      assert(rNo.status === 403 && rWrong.status === 403 && rOther.status === 403 && keptN >= 2 && rOk.status === 200 && okBody.removed === keptN && leftN === 0,
        `nollställ rummet: utan, med fel eller med ett annat rums nyckel nekas (403); skaparens nyckel tar bort alla ${keptN}`);
      const stadKey = await reset('stad', { 'x-room-key': made.roomKey }), stadNone = await reset('stad');
      const stadBefore = (await (await fetch(`${base}/api/rooms/stad/stamps`)).json()).stamps.length;
      const stadAdmin = await reset('stad', { 'x-admin-token': 'hemligt-test' });
      const stadAfter = (await (await fetch(`${base}/api/rooms/stad/stamps`)).json()).stamps.length;
      const anyAdmin = await reset(r.room.id, { 'x-admin-token': 'hemligt-test' });
      assert(stadKey.status === 403 && stadNone.status === 403 && stadBefore >= 1 && stadAdmin.status === 200 && stadAfter === 0 && anyAdmin.status === 200 && (await reset('finns-inte-alls', { 'x-admin-token': 'hemligt-test' })).status === 404,
        'Staden kan bara admin nollställa; admin kan nollställa alla rum; okänt rum ger 404');
      assert(st.status === 200 && room.stamps.length === 1 && room.stamps[0].imageId === i1.id && room.images[i1.id], 'stämplar pekar på designen med imageId');
    } finally { server.close(); }
    await writeBehind();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
