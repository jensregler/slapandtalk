// Safety cap: at most MAX_STAMPS_PER_ROOM stickers per room (default 3000). A slap beyond it
// quietly removes the OLDEST sticker: broadcast as stamp:remove and written to storage.
// Körs med: node tests/cap.test.js (ingår i npm test)
process.env.MAX_STAMPS_PER_ROOM = '4';
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { execFileSync } = require('child_process');
const { LocalAdapter } = require('../server/storage/local');
const { createStore, MAX_STAMPS_PER_ROOM } = require('../server/store');
const { createApp } = require('../server/app');
const { onBroadcast } = require('../server/realtime');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };

(async () => {
  const env = { ...process.env }; delete env.MAX_STAMPS_PER_ROOM;
  const def = execFileSync(process.execPath, ['-e', "process.stdout.write(String(require('./server/store').MAX_STAMPS_PER_ROOM))"], { cwd: path.join(__dirname, '..'), env }).toString();
  assert(def === '3000' && MAX_STAMPS_PER_ROOM === 4, `taket är 3000 klibbor per rum som standard, och MAX_STAMPS_PER_ROOM ändrar det (${def} / ${MAX_STAMPS_PER_ROOM})`);
  const bad = execFileSync(process.execPath, ['-e', "process.stdout.write(String(require('./server/store').MAX_STAMPS_PER_ROOM))"], { cwd: path.join(__dirname, '..'), env: { ...env, MAX_STAMPS_PER_ROOM: 'nej' } }).toString();
  assert(bad === '3000', 'ett trasigt MAX_STAMPS_PER_ROOM ger standardtaket');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-cap-'));
  const adapter = new LocalAdapter(tmp);
  const store = createStore(adapter, { writeDelayMs: 20, log: { error: () => {}, log: () => {} } });
  const app = createApp(store, { quickTtlHours: 24 });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const events = [];
  const off = onBroadcast((room, e) => { if (room === 'tak') events.push(e); });
  try {
    const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff00aa' } }).png().toBuffer();
    const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'k.png');
    const img = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
    await (await fetch(`${base}/api/rooms/tak/stamps`)).json();
    const slap = (x) => fetch(`${base}/api/rooms/tak/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: img.id, position: [x, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr' }) }).then((r) => r.json());
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await slap(i * 0.1)).stamp.id);
    assert(!events.some((e) => e.type === 'stamp:remove'), 'upp till taket försvinner ingenting');
    const fifth = await slap(1), sixth = await slap(1.1);
    ids.push(fifth.stamp.id, sixth.stamp.id);
    const room = await (await fetch(`${base}/api/rooms/tak/stamps`)).json();
    assert(room.stamps.length === 4 && room.stamps.map((s) => s.id).join() === ids.slice(2).join(), 'över taket: rummet har kvar de 4 nyaste, de äldsta togs bort');
    const removes = events.filter((e) => e.type === 'stamp:remove').map((e) => e.id);
    assert(removes.join() === ids.slice(0, 2).join(), 'de borttagna skickas ut som vanliga stamp:remove (äldst först)');
    const iRem = events.findIndex((e) => e.type === 'stamp:remove' && e.id === ids[0]);
    const iAdd = events.findIndex((e) => e.type === 'stamp:add' && e.stamp.id === ids[4]);
    assert(iRem >= 0 && iRem < iAdd && !JSON.stringify(events).includes('max') , 'borttagningen kommer före den nya klibban, utan någon text om taket');
    await store.flush();
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'rooms', 'tak.json'), 'utf8'));
    assert(saved.stamps.length === 4 && !saved.stamps.some((s) => ids.slice(0, 2).includes(s.id)), 'borttagningen sparas i lagringen (write-behind)');
    const s2 = createStore(adapter, { log: { error: () => {}, log: () => {} } });
    const evicted = [];
    for (let i = 0; i < 3; i++) await s2.addStamp('liten', { imageId: img.id, size: 0.3 }, { maxStamps: 2, onEvict: (x) => evicted.push(...x) });
    const lit = await s2.getRoom('liten');
    assert(lit.stamps.length === 2 && evicted.length === 1 && lit.stamps[0].order === 2 && lit.stamps[1].order === 3, 'nya klibbor får fortfarande nästa nummer efter en borttagning');
  } finally { off(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
