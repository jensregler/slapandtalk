// Tester av sessionsinspelningen och kamerorna på servern (utan webbläsare).
// Körs med: node tests/recording.test.js (ingår i npm test)
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const { createRecorder } = require('../server/recorder');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN = 'hemligt-test';

function client(base, room, hello = {}) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${room}`);
  const c = { ws, msgs: [] };
  ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString())));
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(10); }
    return null;
  };
  c.ready = new Promise((r) => ws.on('open', r)).then(() => c.send({ t: 'hello', ...hello }));
  return c;
}
const ev = (type) => (m) => m.t === 'event' && m.e.type === type;

async function setup(recOpts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-rec-'));
  const store = createStore(new LocalAdapter(dir));
  const recorder = createRecorder(store, { flushMs: 150, tickMs: 20, ...recOpts });
  const app = createApp(store, { adminToken: ADMIN, recorder });
  const server = app.listen(0);
  const rt = attachRealtime(server, { maxPlayers: 5, heartbeatMs: 500, recorder });
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const join = (room, hello) => { const c = client(base, room, hello); clients.push(c); return c; };
  const api = (method, url, { key, admin, body } = {}) => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(key ? { 'x-room-key': key } : {}), ...(admin ? { 'x-admin-token': admin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const newRoom = async () => (await api('POST', '/api/rooms', { body: {} })).json();
  const close = async () => { for (const c of clients) c.ws.terminate(); await recorder.close(); rt.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { dir, store, recorder, base, join, api, newRoom, close };
}

(async () => {
  const { parseRecording, buildTimeline, snapshotAt, participants, poseAt } = await import('../shared/replay.mjs');
  const T = await setup();
  try {
    const { room: { id: R }, roomKey: KEY } = await T.newRoom();
    // En klibba som sitter där innan inspelningen startar
    const fd = new FormData(); fd.append('file', new Blob([await sharp({ create: { width: 32, height: 32, channels: 4, background: '#00aaff' } }).png().toBuffer()], { type: 'image/png' }), 'k.png');
    const img = await (await fetch(`${T.base}/api/stickers`, { method: 'POST', body: fd })).json();
    const stamp = (pos) => T.api('POST', `/api/rooms/${R}/stamps`, { body: { imageId: img.id, position: pos, normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3, surface: 'vägg-norr' } }).then((r) => r.json());
    const before = await stamp([0, 1.5, -5]);

    // ---------- Kameror: rättigheter, sparas med rummet, flytta, ta bort ----------
    const camBody = { p: [3, 2.2, 4], yaw: 0.6, pitch: -0.2, fov: 60, aspect: '16:9' };
    assert((await T.api('POST', `/api/rooms/${R}/cameras`, { body: camBody })).status === 403
      && (await T.api('POST', `/api/rooms/${R}/cameras`, { key: 'fel-nyckel', body: camBody })).status === 403
      && (await T.api('POST', '/api/rooms/stad/cameras', { body: camBody })).status === 403, 'kameror: bara rummets skapare (eller admin) får placera, i Staden bara admin');
    const cam1 = (await (await T.api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: camBody })).json()).camera;
    const cam2 = (await (await T.api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { p: [99, -3, 0], yaw: 7, pitch: 3, fov: 500, aspect: '9:16' } })).json()).camera;
    assert(cam1.name === 'Camera 1' && cam2.name === 'Camera 2' && cam1.aspect === '16:9' && cam2.p[0] === 4.95 && cam2.p[1] === 0.05 && cam2.pitch === 1.55 && cam2.fov === 120
      && Math.abs(cam2.yaw - (7 - 2 * Math.PI)) < 1e-3, 'kameror får namn (Kamera 1, 2), position, riktning och bildvinkel hålls inom rummet');
    assert((await T.api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { ...camBody, aspect: '4:3' } })).status === 400, 'okänt bildformat nekas');
    let loaded = await (await fetch(`${T.base}/api/rooms/${R}/stamps`)).json();
    assert(loaded.cameras.length === 2 && loaded.cameras[0].id === cam1.id, 'kamerorna sparas med rummet');

    // ---------- Inspelning: rättigheter ----------
    const a = T.join(R, { name: 'Anna', look: { outfit: 'kostym' }, p: [1, 1.6, 2], y: 0.5, pi: -0.3 });
    await a.ready; const wa = await a.wait((m) => m.t === 'welcome');
    assert(wa && wa.rec === null, 'ingen inspelning när man kommer in (rec: null)');
    assert((await T.api('POST', `/api/rooms/${R}/recording/start`)).status === 403 && (await T.api('POST', `/api/rooms/${R}/recording/start`, { key: 'fel' })).status === 403
      && (await T.api('POST', '/api/rooms/stad/recording/start', { key: KEY })).status === 403 && !T.recorder.isActive(R),
      'starta inspelning: utan rumsnyckel nekas det (403), i Staden bara admin');
    const st = await (await T.api('POST', `/api/rooms/${R}/recording/start`, { key: KEY })).json();
    const recId = st.recording && st.recording.recId;
    const aStart = await a.wait(ev('rec:start'));
    assert(/^[a-f0-9]{16}$/.test(recId) && aStart && aStart.e.recId === recId, 'skaparen startar inspelningen, och alla i rummet får rec:start (● REC)');
    assert((await (await T.api('POST', `/api/rooms/${R}/recording/start`, { key: KEY })).json()).already === true, 'start igen medan den pågår: samma inspelning (ingen dubbel)');
    assert((await (await fetch(`${T.base}/api/rooms/${R}/recording`)).json()).recording.recId === recId, 'alla kan se att en inspelning pågår');

    // Sen ankomling: får veta direkt att rummet spelas in
    await sleep(60);
    const b = T.join(R, { name: 'Bosse', look: { outfit: 'punk' }, p: [-1, 1.6, 0], y: 0 });
    await b.ready; const wb = await b.wait((m) => m.t === 'welcome');
    assert(wb.rec && wb.rec.recId === recId, 'den som kommer in under inspelningen får veta det direkt (welcome.rec)');
    // Rörelser (med pitch), byte av utseende, chatt, klibbor, peel, kameror, utseende
    for (let i = 1; i <= 10; i++) { b.send({ t: 'move', p: [-1 + i * 0.2, 1.6, 0], y: 0.1 * i, pi: 0.05 * i }); await sleep(25); }
    const mvA = await a.wait((m) => m.t === 'move' && m.id === wb.id && m.pi === 0.5);
    assert(mvA && mvA.p[0] === 1, 'blickriktningen upp/ner (pi) skickas med positionen till de andra');
    b.send({ t: 'look', name: 'Bosse B', look: { outfit: 'tshirt', hat: true } });
    a.send({ t: 'chat', text: 'Hej på inspelningen!' });
    a.send({ t: 'signal', to: wb.id, data: { sdp: 'hemligt-röstsamtal' } });
    await b.wait((m) => m.t === 'signal');
    await sleep(50);
    const during = await stamp([1, 2, -5]);
    await sleep(40);
    await T.api('DELETE', `/api/rooms/${R}/stamps/${before.stamp.id}/peel`, {}).then(() => fetch(`${T.base}/api/rooms/${R}/stamps/${before.stamp.id}/peel`, { method: 'DELETE', headers: { 'x-peel-token': before.peelToken } }));
    await sleep(40);
    const moved = (await (await T.api('PUT', `/api/rooms/${R}/cameras/${cam1.id}`, { key: KEY, body: { p: [-2, 1.8, 3], yaw: -0.4, name: '  Vida  ' } })).json()).camera;
    assert(moved.p[0] === -2 && moved.name === 'Vida' && moved.fov === 60 && moved.aspect === '16:9', 'flytta och byt namn på en kamera (resten behålls)');
    await sleep(40);
    assert((await T.api('DELETE', `/api/rooms/${R}/cameras/${cam2.id}`)).status === 403, 'ta bort kamera utan rumsnyckel nekas');
    await T.api('DELETE', `/api/rooms/${R}/cameras/${cam2.id}`, { key: KEY });
    await T.api('PUT', `/api/rooms/${R}/style`, { key: KEY, body: { style: { floor: 'betong', wall: 'tegel', ceiling: 'vit' } } });
    await sleep(60);
    assert((await T.api('POST', `/api/rooms/${R}/reset`, { body: { by: 'Anna' } })).status === 403, 'nollställ rummet utan rumsnyckel nekas');
    await T.api('POST', `/api/rooms/${R}/reset`, { key: KEY, body: { by: 'Anna' } });
    const aReset = await a.wait(ev('room:reset'));
    assert(aReset && aReset.e.by === 'Anna' && aReset.e.removed >= 1, 'skaparen nollställer rummet: alla i rummet får room:reset med namnet');
    await sleep(60);
    b.ws.close(); await a.wait((m) => m.t === 'leave');
    await sleep(60);
    loaded = await (await fetch(`${T.base}/api/rooms/${R}/stamps`)).json();
    assert(loaded.cameras.length === 1 && loaded.cameras[0].name === 'Vida' && loaded.cameras[0].p[0] === -2, 'kamerorna finns kvar (flyttade/borttagna) när rummet laddas igen');
    // Pågående inspelning kan läsas (det som spelats in hittills)
    const partial = parseRecording(await (await fetch(`${T.base}/api/rooms/${R}/recordings/${recId}/log`)).text());
    assert(partial.header.id === recId && partial.events.length > 5 && !partial.end, 'en pågående inspelning kan läsas (allt hittills, utan slut-rad)');
    assert((await T.api('POST', `/api/rooms/${R}/recording/stop`)).status === 403, 'stoppa utan rumsnyckel nekas');
    const stopRes = await (await T.api('POST', `/api/rooms/${R}/recording/stop`, { key: KEY })).json();
    const aStop = await a.wait(ev('rec:stop'));
    assert(stopRes.recording.status === 'done' && aStop && aStop.e.reason === 'stop' && !T.recorder.isActive(R), 'skaparen stoppar, och alla får rec:stop');
    assert((await T.api('POST', `/api/rooms/${R}/recording/stop`, { key: KEY })).status === 409, 'stoppa när ingen inspelning pågår: 409');

    // ---------- Loggen: innehåller det som behövs ----------
    const file = path.join(T.dir, 'recordings', R, `${recId}.jsonl`);
    const metaFile = path.join(T.dir, 'recordings', R, `${recId}.meta.json`);
    assert(fs.existsSync(file) && fs.existsSync(metaFile), `sparas som recordings/${R}/${recId}.jsonl + .meta.json`);
    const text = fs.readFileSync(file, 'utf8');
    const rec = parseRecording(text);
    const kinds = new Set(rec.events.map((e) => e.e));
    const h = rec.header;
    assert(h.format === 'slapandtalk-rec' && h.v === 1 && h.room === R && h.stamps.some((s) => s.id === before.stamp.id) && h.images[img.id] && !h.stamps.some((s) => s.peelHash)
      && h.cameras.length === 2 && h.players.length === 1 && h.players[0].name === 'Anna' && h.players[0].pi === -0.3 && h.style && Array.isArray(h.tracks),
      'startläget: version, rummets utseende, klibbor (utan peel-nycklar), kameror och vem som är där (med blickriktning)');
    assert(['join', 'move', 'look', 'chat', 'stamp:add', 'stamp:remove', 'camera:update', 'camera:remove', 'room:style', 'room:reset', 'leave'].every((k) => kinds.has(k)) && rec.end && rec.end.reason === 'stop',
      `loggen har alla händelser (${[...kinds].join(', ')}) och en slut-rad`);
    assert(!text.includes('hemligt-röstsamtal') && !kinds.has('signal') && !text.includes('peelHash') && !text.includes(KEY), 'röstens signalering, peel-nycklar och rumsnyckeln spelas aldrig in');
    const moves = rec.events.filter((e) => e.e === 'move' && e.id === wb.id);
    const gaps = moves.slice(1).map((m, i) => m.t - moves[i].t);
    assert(moves.length >= 2 && moves.length <= 10 && gaps.every((g) => g >= 80) && moves.at(-1).p[0] === 1 && moves.at(-1).pi === 0.5,
      `positioner sparas högst ~10 gånger per sekund, och den sista kommer alltid med (${moves.length} av 10, med pitch)`);
    const chat = rec.events.find((e) => e.e === 'chat');
    assert(chat.text === 'Hej på inspelningen!' && chat.name === 'Anna' && rec.events.find((e) => e.e === 'look').name === 'Bosse B', 'chatt och namnbyten finns med i loggen');
    const meta = await (await fetch(`${T.base}/api/rooms/${R}/recordings/${recId}`)).json();
    assert(meta.status === 'done' && meta.durationMs > 300 && meta.bytes === Buffer.byteLength(text) && meta.participants.map((p) => p.name).sort().join() === 'Anna,Bosse B'
      && meta.stopReason === 'stop' && meta.events === rec.events.length + 0, `meta.json: längd ${meta.durationMs} ms, ${meta.bytes} byte, deltagare ${meta.participants.map((p) => p.name).join(' och ')}`);
    assert((await T.api('GET', `/api/rooms/${R}/recordings`)).status === 403 && (await (await T.api('GET', `/api/rooms/${R}/recordings`, { key: KEY })).json()).recordings.length === 1,
      'listan över inspelningar: bara för den som får spela in');

    // ---------- Uppspelning: deterministisk ----------
    const tl = buildTimeline(rec);
    const tJoinB = rec.events.find((e) => e.e === 'join' && e.id === wb.id).t;
    const tLastMove = moves.at(-1).t, tAdd = rec.events.find((e) => e.e === 'stamp:add').t, tPeel = rec.events.find((e) => e.e === 'stamp:remove').t;
    const s0 = snapshotAt(tl, 0), sB = snapshotAt(tl, tLastMove + 1), sEnd = snapshotAt(tl, tl.duration);
    assert(s0.players.length === 1 && s0.players[0].name === 'Anna' && s0.stamps.length === 1 && s0.cameras.length === 2, 'vid start: Anna, en klibba och två kameror');
    const bAt = sB.players.find((p) => p.id === wb.id);
    assert(bAt && bAt.p[0] === 1 && bAt.pi === 0.5 && Math.abs(bAt.y - 1) < 1e-9 && !snapshotAt(tl, tJoinB - 1).players.some((p) => p.id === wb.id),
      'Bosse finns från när han kom in och står där han gick (x=1, pitch 0,5)');
    assert(snapshotAt(tl, tAdd).stamps.some((s) => s.stamp.id === during.stamp.id) && !snapshotAt(tl, tAdd - 1).stamps.some((s) => s.stamp.id === during.stamp.id)
      && snapshotAt(tl, tPeel - 1).stamps.some((s) => s.stamp.id === before.stamp.id) && !snapshotAt(tl, tPeel).stamps.some((s) => s.stamp.id === before.stamp.id),
      'klibbor kommer och peelas på rätt tid');
    assert(sEnd.cameras.length === 1 && sEnd.cameras[0].name === 'Vida' && sEnd.style.floor === 'betong' && !sEnd.players.some((p) => p.id === wb.id) && sEnd.chat.length === 1,
      'vid slutet: flyttad kamera, nytt utseende, Bosse har gått, chatten finns');
    const tReset = rec.events.find((e) => e.e === 'room:reset').t;
    assert(snapshotAt(tl, tReset - 1).stamps.length >= 1 && snapshotAt(tl, tReset).stamps.length === 0 && sEnd.stamps.length === 0, 'uppspelningen: alla klibbor försvinner när rummet nollställs');
    const times = [0, tJoinB, tLastMove - 30, tAdd + 5, tl.duration / 2, tl.duration];
    const a1 = times.map((t) => JSON.stringify(snapshotAt(tl, t)));
    const a2 = times.slice().reverse().map((t) => JSON.stringify(snapshotAt(buildTimeline(parseRecording(text)), t))).reverse();
    assert(a1.every((x, i) => x === a2[i]), 'samma tid ger alltid samma läge (framåt, bakåt, ny inläsning)');
    const track = tl.players.get(wb.id).track;
    const mid = poseAt(track, (moves[0].t + moves[1].t) / 2 + 1e-6);
    assert(mid.p[0] >= moves[0].p[0] && mid.p[0] <= moves[1].p[0], 'mellan två positioner glider gubben mjukt');
    assert(participants(tl).length === 2, 'deltagare att välja POV för: 2');
    // En avbruten sista rad (servern dog mitt i en skrivning) förstör inte resten
    const broken = parseRecording(text.trimEnd() + '\n{"t":99999,"e":"mo');
    assert(broken.bad === 1 && broken.events.length === rec.events.length, 'en trasig sista rad hoppas över');

    // ---------- Staden: admin får ----------
    const sa = await T.api('POST', '/api/rooms/stad/recording/start', { admin: ADMIN });
    const ss = await T.api('POST', '/api/rooms/stad/recording/stop', { admin: ADMIN });
    assert(sa.status === 200 && ss.status === 200, 'i Staden kan admin starta och stoppa en inspelning');
    a.ws.close();
  } finally { await T.close(); }

  // ---------- Gränser: längd, storlek, tomt rum, hur många samtidigt ----------
  const L = await setup({ maxMs: 400, maxBytes: 1200, emptyMs: 250, maxActive: 2 });
  try {
    const r1 = await L.newRoom(), r2 = await L.newRoom(), r3 = await L.newRoom();
    const c1 = L.join(r1.room.id, { name: 'Lång' }); await c1.ready; await c1.wait((m) => m.t === 'welcome');
    await L.api('POST', `/api/rooms/${r1.room.id}/recording/start`, { key: r1.roomKey });
    const c2 = L.join(r2.room.id, { name: 'Pratig' }); await c2.ready; await c2.wait((m) => m.t === 'welcome');
    await L.api('POST', `/api/rooms/${r2.room.id}/recording/start`, { key: r2.roomKey });
    const busy = await L.api('POST', `/api/rooms/${r3.room.id}/recording/start`, { key: r3.roomKey });
    assert(busy.status === 429, 'högst REC_MAX_ACTIVE inspelningar samtidigt (sedan 429)');
    for (let i = 0; i < 40; i++) { c2.send({ t: 'chat', text: 'x'.repeat(200) }); }
    const sizeStop = await c2.wait(ev('rec:stop'));
    const timeStop = await c1.wait(ev('rec:stop'), 2000);
    assert(sizeStop && sizeStop.e.reason === 'size', 'för stor logg: inspelningen stoppas av sig själv (size)');
    assert(timeStop && timeStop.e.reason === 'time' && timeStop.e.durationMs >= 400 && timeStop.e.durationMs < 1200, `för lång: stoppas efter maxlängden (time, ${timeStop && timeStop.e.durationMs} ms)`);
    const m2 = (await (await L.api('GET', `/api/rooms/${r2.room.id}/recordings`, { key: r2.roomKey })).json()).recordings[0];
    assert(m2.bytes <= 1200 + 400 && m2.stopReason === 'size', `storleken håller sig under gränsen (${m2.bytes} byte)`);
    await L.api('POST', `/api/rooms/${r3.room.id}/recording/start`, { key: r3.roomKey });
    const e3 = await (async () => { for (let i = 0; i < 100; i++) { const l = (await (await L.api('GET', `/api/rooms/${r3.room.id}/recordings`, { key: r3.roomKey })).json()).recordings; if (l[0] && l[0].status === 'done') return l[0]; await sleep(30); } return null; })();
    assert(e3 && e3.stopReason === 'empty', 'står rummet tomt stoppas inspelningen (empty)');
  } finally { await L.close(); }
  console.log('Alla inspelningstester gick igenom.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
