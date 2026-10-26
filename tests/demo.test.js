// The demo profile (DEMO_PROFILE=1) on the server: config, no uploads, no room editing, free
// entitlements even with keys, invite-only rooms (single-use links, max 5 members), slots, the
// one-hour expiry (room + recordings deleted, videos/ untouched), the library and its importer.
// Run: node tests/demo.test.js (part of npm test)
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const { demoSettings, createDemo, DEMO } = require('../server/demo');
const { makeEntitlements } = require('../server/entitlements');
const { loadLibrary, seedLibrary } = require('../server/library');
const { createRecorder } = require('../server/recorder');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(base, room, hello = {}) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${room}`);
  const c = { ws, msgs: [], closed: null };
  ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString())));
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 2500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(10); } return null; };
  c.waitClosed = async (ms = 2500) => { const t0 = Date.now(); while (c.closed === null && Date.now() - t0 < ms) await sleep(10); return c.closed; };
  c.ready = new Promise((r) => ws.on('open', r)).then(() => { if (hello) c.send({ t: 'hello', ...hello }); });
  return c;
}

(async () => {
  // ---------- Settings and entitlements ----------
  assert(demoSettings({}) === null && demoSettings({ DEMO_PROFILE: '0' }) === null, 'DEMO_PROFILE unset/0: no demo (the normal app)');
  const st = demoSettings({ DEMO_PROFILE: '1' });
  assert(st && st.maxPlayers === 5 && st.maxMembers === 5 && st.roomMs === 3600_000 && st.warnMs === 300_000, 'DEMO_PROFILE=1: 5 per room, 5 members, 60 min, warn at 5 min');
  assert(demoSettings({ DEMO_PROFILE: '1', DEMO_ROOM_MINUTES: '2' }).roomMs === 120_000, 'DEMO_ROOM_MINUTES overrides the hour (tests/rehearsals)');
  assert(DEMO.style.floor === 'betong' && DEMO.style.wall === 'kakel' && DEMO.style.ceiling === 'klassisk', 'preset: concrete floor, tiled walls, classic ceiling');
  const KEY = 'demo-key-1234567890';
  const entFull = makeEntitlements({ FULL_ACCESS_KEYS: KEY, DEV_UNLOCK: '1' });
  const entDemo = makeEntitlements({ FULL_ACCESS_KEYS: KEY, DEV_UNLOCK: '1', DEMO_PROFILE: '1' });
  assert(entFull({ key: KEY }).fabrics && !Object.values(entDemo({ key: KEY })).some(Boolean) && !Object.values(entDemo({ dev: true })).some(Boolean) && !entDemo.devAllowed,
    'demo: every key and the dev unlock give the FREE version (flag off: keys work as before)');

  // ---------- Library ----------
  const lib = loadLibrary();
  assert(lib.length >= 6 && lib.every((s) => /^[a-f0-9]{16}$/.test(s.id) && fs.existsSync(s.file) && s.artist), `library/manifest.json: ${lib.length} stickers, each with an image and an artist`);

  // ---------- A demo server ----------
  let now = Date.parse('2026-10-29T18:00:00Z');
  const clock = () => now;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-demo-'));
  const adapter = new LocalAdapter(dir);
  const store = createStore(adapter, { clock });
  const seeded = await seedLibrary(store, lib, { log: { log() {}, error() {} } });
  assert(seeded.added === lib.length && (await seedLibrary(store, lib, { log: { log() {}, error() {} } })).added === 0, 'seedLibrary copies the library into storage once (idempotent)');
  const meta0 = await store.getImage(lib[0].id);
  assert(meta0.library === true && meta0.artist === lib[0].artist && await store.hasImageFile(lib[0].id), 'library images are stored like uploads, with library: true and the artist');
  let rt = null; const closedRooms = [];
  const recorder = createRecorder(store, { clock, flushMs: 60_000 });
  // As in index.js: everyone out, and a running recording stopped before the room is deleted.
  const demo = createDemo({ store, settings: { ...st, roomMs: 60 * 60_000 }, clock, onExpire: async (id) => { closedRooms.push(id); rt && rt.closeRoom(id); await recorder.stop(id, 'closed'); }, log: { log() {}, error() {} } });
  const app = createApp(store, { adminToken: 'admin-token-x', demo, library: lib, entitle: entDemo, quickTtlHours: 24, recorder });
  const server = app.listen(0);
  const gate = {
    admit: (room, pass, name) => demo.admit(room, pass, name),
    async onMessage(c, m, { send }) {
      if (m.action === 'create') { const r = await demo.createInvite(c.room, c.member); return send(r.token ? { t: 'invite', ok: true, token: r.token, status: r.status } : { t: 'invite', ok: false, code: r.code, error: r.error }); }
      send({ t: 'invite', ok: true, status: await demo.inviteStatus(c.room, c.member) });
    },
  };
  rt = attachRealtime(server, { maxPlayers: 5, heartbeatMs: 500, gate, entitle: entDemo, clock, recorder });
  const base = `http://127.0.0.1:${server.address().port}`;
  const all = [];
  const join = (room, hello) => { const c = client(base, room, hello); all.push(c); return c; };
  const J = (r) => r.json();
  try {
    const cfg = await J(await fetch(`${base}/api/config`));
    assert(cfg.demo === true && cfg.maxPlayers === 5 && cfg.roomMinutes === 60 && cfg.warnMinutes === 5 && cfg.style.wall === 'kakel', 'GET /api/config tells the web app it is the demo (5 per room, 60 min, preset)');
    const libRes = await J(await fetch(`${base}/api/library`));
    assert(libRes.stickers.length === lib.length && libRes.stickers.every((s) => s.url === `/uploads/${s.id}.webp` && s.artist && s.library), 'GET /api/library lists the curated stickers with url and artist');
    assert((await fetch(`${base}/uploads/${lib[0].id}.webp`)).status === 200, 'a library image is served from /uploads like any sticker');

    // No uploads, no editing
    const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#f00' } }).png().toBuffer();
    const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
    const up = await fetch(`${base}/api/stickers`, { method: 'POST', body: fd });
    assert(up.status === 403 && (await J(up)).demo, 'demo: POST /api/stickers (upload) → 403');
    const fd2 = new FormData(); fd2.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
    assert((await fetch(`${base}/api/fabrics`, { method: 'POST', body: fd2, headers: { 'x-unlock': KEY } })).status === 403, 'demo: fabrics → 403 even with a full-version key');

    const made = await J(await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style: { floor: 'parkett', wall: 'tegel' } }) }));
    const R = made.room.id, RK = made.roomKey;
    assert(made.room.style.floor === 'betong' && made.room.style.wall === 'kakel' && made.room.style.wallColor === 'vit' && made.room.style.ceiling === 'klassisk', 'demo: a new room always gets the empty preset (asked-for look ignored)');
    assert(Date.parse(made.room.expiresAt) === now + 3600_000, 'demo: the room expires one hour after it was made (expiresAt)');
    const edits = await Promise.all([
      fetch(`${base}/api/rooms/${R}/style`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': RK }, body: JSON.stringify({ style: { floor: 'parkett', wall: 'tegel' } }) }),
      fetch(`${base}/api/rooms/${R}/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': RK }, body: JSON.stringify({ on: true }) }),
      fetch(`${base}/api/rooms/${R}/cameras`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-room-key': RK }, body: JSON.stringify({ p: [0, 1.6, 0] }) }),
    ]);
    assert(edits.every((r) => r.status === 403), 'demo: changing the look, peels, cameras → 403 even for the creator');
    assert((await fetch(`${base}/api/rooms/${R}/style`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'admin-token-x' }, body: JSON.stringify({ style: { floor: 'parkett', wall: 'tegel' } }) })).status === 200, 'admin can still change a room look');
    await fetch(`${base}/api/rooms/${R}/style`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-token': 'admin-token-x' }, body: JSON.stringify({ style: DEMO.style }) });

    // ---------- Invites ----------
    const stranger = join(R, { name: 'Stranger' }); await stranger.ready;
    const den = await stranger.wait((m) => m.t === 'denied');
    assert(den && den.code === 'invite' && (await stranger.waitClosed()) === 4003 && !stranger.msgs.some((m) => m.t === 'welcome'), 'no invite, no key: denied ("invite-only"), socket closed 4003, never welcomed (no watching either)');
    const owner = join(R, { name: 'Jens', pass: { roomKey: RK } }); await owner.ready;
    const ow = await owner.wait((m) => m.t === 'welcome');
    assert(ow && ow.member === 'owner' && ow.expiresAt === made.room.expiresAt && ow.serverNow && ow.you.slot === 0 && ow.max === 5, 'the creator (room key) gets in as member "owner", slot 0, with expiresAt and the server time');
    owner.send({ t: 'invite', action: 'status' });
    const s0 = await owner.wait((m) => m.t === 'invite' && m.status);
    assert(s0.status.state === 'none' && s0.status.left === 4, 'invite status: none yet, 4 places left');
    owner.send({ t: 'invite', action: 'create' });
    const inv1 = await owner.wait((m) => m.t === 'invite' && m.token);
    assert(inv1 && /^[A-Za-z0-9_-]{20,}$/.test(inv1.token) && inv1.status.state === 'open', 'the creator gets a single-use invite token');
    owner.msgs.length = 0; owner.send({ t: 'invite', action: 'create' });
    const inv1b = await owner.wait((m) => m.t === 'invite' && m.token);
    assert(inv1b.token !== inv1.token, 'asking again gives a new link (the old unused one stops working)');
    const oldLink = join(R, { name: 'Old', pass: { invite: inv1.token } }); await oldLink.ready;
    assert((await oldLink.wait((m) => m.t === 'denied')).code === 'invite', 'the replaced link no longer works');
    const raw = JSON.stringify(await store.peek(R));
    assert(!raw.includes(inv1b.token) && !raw.includes(RK), 'only hashes of invite tokens and keys are stored');
    const marika = join(R, { name: 'Marika', pass: { invite: inv1b.token } }); await marika.ready;
    const mw = await marika.wait((m) => m.t === 'welcome');
    assert(mw && mw.pass && mw.member && mw.member !== 'owner' && mw.you.slot === 1, 'the invite admits Marika: she gets her own member key (pass) and slot 1');
    const jw = await owner.wait((m) => m.t === 'join' && m.player.name === 'Marika');
    assert(jw && jw.player.slot === 1, 'the others see her join with her slot');
    const thief = join(R, { name: 'Thief', pass: { invite: inv1b.token } }); await thief.ready;
    assert((await thief.wait((m) => m.t === 'denied')).code === 'used', 'the same link a second time: "already been used"');
    owner.msgs.length = 0; owner.send({ t: 'invite', action: 'create' });
    const again = await owner.wait((m) => m.t === 'invite');
    assert(again.ok === false && again.code === 'used', 'each person invites ONE friend: the creator cannot invite a second');
    owner.send({ t: 'invite', action: 'status' });
    const s1 = await owner.wait((m) => m.t === 'invite' && m.status && m.status.state === 'used');
    assert(s1 && s1.status.name === 'Marika', 'status shows who used my invite');
    // Marika reconnects with her member key
    marika.ws.close(); await marika.waitClosed();
    const marika2 = join(R, { name: 'Marika', pass: { member: mw.pass } }); await marika2.ready;
    const mw2 = await marika2.wait((m) => m.t === 'welcome');
    assert(mw2 && mw2.member === mw.member && !mw2.pass, 'Marika comes back (reload) with her member key: same member, no new key');
    // Chain: Marika → A → B → C. That makes 5; nobody can invite a sixth.
    const chain = [marika2]; const welSlots = [mw2.you.slot]; const names = ['Chattis', 'Ulla', 'Sylvester'];
    for (const n of names) {
      const inviter = chain[chain.length - 1]; inviter.msgs.length = 0; inviter.send({ t: 'invite', action: 'create' });
      const t = await inviter.wait((m) => m.t === 'invite' && m.token);
      const c = join(R, { name: n, pass: { invite: t.token } }); await c.ready;
      const w = await c.wait((m) => m.t === 'welcome'); welSlots.push(w && w.you.slot);
      assert(w, `${n} joins with ${chain.length === 1 ? 'Marika' : names[chain.length - 2]}'s invite`);
      chain.push(c);
    }
    const last = chain[chain.length - 1]; last.msgs.length = 0; last.send({ t: 'invite', action: 'create' });
    const full = await last.wait((m) => m.t === 'invite');
    assert(full.ok === false && full.code === 'full', 'five members (creator + 4): the fifth cannot invite a sixth ("full")');
    assert(new Set([0, ...welSlots]).size === 5, `five people, five different slots (${[0, ...welSlots].join(',')})`);

    // ---------- Slapping: only connected members, library artist wins ----------
    const body = (by) => ({ imageId: lib[1].id, position: [0, 1.5, -4.99], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'wall-back', artist: 'Not me', by });
    const anon = await fetch(`${base}/api/rooms/${R}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
    assert(anon.status === 403, 'demo: a stamp POST from someone not in the room → 403');
    const okSlap = await fetch(`${base}/api/rooms/${R}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(ow.id)) });
    const os1 = await J(okSlap);
    assert(okSlap.status === 200 && os1.stamp.artist === lib[1].artist, `a member slaps a library sticker: the stamp carries the library artist ("${os1.stamp.artist}"), not what the client sent`);
    const big = await J(await fetch(`${base}/api/rooms/${R}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-unlock': KEY }, body: JSON.stringify({ ...body(ow.id), size: 2.5 }) }));
    assert(big.stamp.size === 1, 'demo: stickers stay at most 1 m even with a full-version key');

    // ---------- Recording in the demo (videos with the auto-director) ----------
    const strangerRec = await fetch(`${base}/api/rooms/${R}/recording/start`, { method: 'POST' });
    const recStart = await fetch(`${base}/api/rooms/${R}/recording/start`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-room-key': RK } });
    const recId = (await J(recStart)).recording.recId;
    assert(strangerRec.status === 403 && recStart.status === 200 && /^[a-f0-9]{16}$/.test(recId), 'demo: the creator can record (others cannot)');
    for (let i = 0; i < 5; i++) { owner.send({ t: 'talk', l: 9 }); now += 80; }
    owner.send({ t: 'talk', l: 0 }); owner.send({ t: 'talk', l: 99 }); owner.send({ t: 'talk', l: 'x' });
    await sleep(150);
    const logNow = (await (await fetch(`${base}/api/rooms/${R}/recordings/${recId}/log`)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const talks = logNow.filter((e) => e.e === 'talk');
    assert(talks.length === 6 && talks.every((e) => e.id === ow.id && e.l >= 0 && e.l <= 15), 'voice levels go into the recording as talk events (my own id, 0…15; junk dropped) – no audio');
    const shots = await J(await fetch(`${base}/api/rooms/${R}/recordings/${recId}/shots`));
    assert(shots.format === 'slapandtalk-shots' && Array.isArray(shots.shots) && shots.recId === recId, 'GET …/recordings/<id>/shots: the shot list (also while recording)');

    // ---------- The hour ----------
    await adapter.put(`recordings/${R}/abc.jsonl`, Buffer.from('{}\n'));
    await adapter.put(`videos/${R}/keep.mp4`, Buffer.from('video'));
    now += 59 * 60_000; await demo.tick();
    assert(!closedRooms.length && await store.peek(R), 'after 59 minutes the room is still open');
    now += 61_000; const due = await demo.tick();
    assert(due.includes(R) && closedRooms.includes(R), 'after 60 minutes the tick closes it');
    const ev = await owner.wait((m) => m.t === 'event' && m.e.type === 'room:closed');
    assert(ev && (await owner.waitClosed()) === 4010 && (await last.waitClosed()) === 4010, 'everyone gets room:closed and their connection closes (4010)');
    await store.flush();
    assert(!(await adapter.exists(`rooms/${R}.json`)) && !(await adapter.get(`recordings/${R}/abc.jsonl`)) && (await adapter.list(`recordings/${R}/`)).length === 0 && !recorder.isActive(R),
      'the room JSON (stickers, peels, members, invites) and its recordings/ are deleted from storage – the running recording was stopped first (no files come back)');
    assert(!!(await adapter.get(`videos/${R}/keep.mp4`)) && await store.hasImageFile(lib[1].id, { fresh: true }), 'videos/ and the library images are untouched');
    const late = join(R, { name: 'Late', pass: { roomKey: RK } }); await late.ready;
    assert((await late.wait((m) => m.t === 'denied')).code === 'gone', 'joining a closed room: "gone"');
    const lateSlap = await fetch(`${base}/api/rooms/${R}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(ow.id)) });
    assert(lateSlap.status === 410, 'slapping into a closed room → 410');
    // A room that expired while the server was asleep: the sweep finds it in storage
    const m2 = await J(await fetch(`${base}/api/rooms`, { method: 'POST' }));
    await store.flush(); store.evictIdle(0);
    const fresh = createDemo({ store, settings: { ...st }, clock, log: { log() {}, error() {} } });
    now += 61 * 60_000;
    assert((await fresh.sweep()).includes(m2.room.id), 'start-up sweep: a room that expired while the server slept is deleted');
    // Not the City in the demo
    const city = join('stad', { name: 'X' }); await city.ready;
    assert((await city.wait((m) => m.t === 'denied')).code === 'gone', 'demo: the City is not open (everyone has their own room)');
  } finally {
    for (const c of all) try { c.ws.close(); } catch { /* */ }
    rt.close(); server.close(); demo.stop(); await recorder.close();
  }

  // ---------- Without the flag: unchanged ----------
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-nodemo-'));
  const store2 = createStore(new LocalAdapter(dir2));
  const app2 = createApp(store2, { library: lib, entitle: makeEntitlements({}) });
  const server2 = app2.listen(0); const rt2 = attachRealtime(server2, { maxPlayers: 10 });
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  try {
    assert((await J(await fetch(`${base2}/api/config`))).demo === false, 'flag off: /api/config says demo: false');
    const r2 = await J(await fetch(`${base2}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style: { floor: 'parkett', wall: 'tegel' } }) }));
    assert(r2.room.style.floor === 'parkett' && !r2.room.expiresAt, 'flag off: the chosen look is kept and rooms do not expire');
    const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#0f0' } }).png().toBuffer();
    const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
    assert((await fetch(`${base2}/api/stickers`, { method: 'POST', body: fd })).status === 200, 'flag off: uploads work');
    const c = client(base2, r2.room.id, { name: 'Anyone' }); await c.ready;
    assert(await c.wait((m) => m.t === 'welcome'), 'flag off: anyone with the link joins (no invite needed)');
    c.ws.close();
  } finally { rt2.close(); server2.close(); }

  // ---------- The importer ----------
  const imp = await import('../tools/import-library.mjs');
  const csv = imp.parseCsv('file,artist,link\n"cat, big.png",Marika M,https://example.com\nsub/dog.png,"Chattis",\n');
  assert(csv.get('cat, big.png').artist === 'Marika M' && csv.get('cat, big.png').link === 'https://example.com' && csv.get('dog.png').artist === 'Chattis', 'importer: CSV with quotes and commas');
  assert(imp.artistFor('x.png', { csv }).artist === '' && imp.artistFor('Jens Regler/x.png').artist === 'Jens Regler' && imp.artistFor('Sylvester - robot.png').artist === 'Sylvester'
    && imp.artistFor('ulla__heart.png').artist === 'ulla' && imp.artistFor('plain.png', { fallback: 'Jens' }).artist === 'Jens' && imp.artistFor('cat, big.png', { csv }).artist === 'Marika M',
  'importer: artist from CSV, else subfolder, else "Name - title" / "name__title", else --artist');
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-imp-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-impout-'));
  fs.mkdirSync(path.join(src, 'Jens'));
  await sharp({ create: { width: 2000, height: 1000, channels: 4, background: '#00f8' } }).png().toFile(path.join(src, 'Jens', 'wide.png'));
  await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fa0' } }).jpeg().toFile(path.join(src, 'Chattis - orange.jpg'));
  fs.copyFileSync(path.join(src, 'Chattis - orange.jpg'), path.join(src, 'Chattis - orange copy.jpg'));
  fs.writeFileSync(path.join(src, 'notes.txt'), 'hi');
  const rep = await imp.importFolder({ folder: src, out, replace: true, artist: '' }, () => {});
  const man = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const wide = man.stickers.find((s) => s.artist === 'Jens');
  assert(rep.added === 2 && rep.duplicates === 1 && rep.skipped.includes('notes.txt') && wide.width === 1024 && wide.height === 512, 'importer: re-encodes (max 1024 px), dedupes by content hash, skips non-images');
  const lib2 = loadLibrary(out);
  assert(lib2.length === 2 && lib2.every((s) => fs.existsSync(s.file)), 'importer output loads as a library');
  console.log('\nAlla demo-tester gick igenom.');
})().catch((e) => { console.error(e); process.exit(1); });
