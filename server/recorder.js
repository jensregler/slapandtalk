// Sessionsinspelning: när någon med rätt (rummets skapare eller admin; Staden bara admin)
// trycker "Starta inspelning" skriver servern en logg med allt som behövs för att spela upp
// rummet igen: utseende, klibbor, kameror, vilka som är där, hur deras gubbar ser ut, var de
// står och åt vilket håll de tittar, och chatten. Röstchattens signalering spelas INTE in.
//
// Sparas via lagringslagret (disk eller R2):
//   recordings/<rum>/<recId>.jsonl       själva loggen, en JSON-rad per händelse
//   recordings/<rum>/<recId>.meta.json   start/stopp, längd, storlek, vilka som var med
//   recordings/<rum>/<recId>.shots.json  the auto-director's shot list (who talks when, which
//                                        angle), written when the recording stops (shared/director.mjs)
// Formatet (versionerat) beskrivs i docs/recording-format.md. Uppspelningen finns i shared/replay.mjs.
//
// Loggen hålls i minnet medan inspelningen pågår och skrivs till lagringen var 20:e sekund
// (och när den stoppas), så en omstart av servern tappar högst de sista sekunderna.
const crypto = require('crypto');
const { broadcast, onBroadcast } = require('./realtime');

const FORMAT = 'slapandtalk-rec';
const VERSION = 1;
const REC_ID_RE = /^[a-f0-9]{16}$/;
// Händelser från HTTP-API:t (app.js) som hör till rummet och ska med i loggen.
const ROOM_EVENTS = new Set(['stamp:add', 'stamp:remove', 'room:reset', 'image:remove', 'room:style', 'camera:add', 'camera:update', 'camera:remove']);

function createRecorder(store, {
  clock = () => Date.now(),
  maxMs = 2 * 3600_000, // högst 2 timmar per inspelning
  maxBytes = 32 * 1024 * 1024, // högst 32 MB logg per inspelning
  maxActive = 4, // högst så här många inspelningar samtidigt på servern
  flushMs = 20_000,
  moveMs = 100, // positioner sparas högst 10 gånger per sekund och person
  emptyMs = 5 * 60_000, // står rummet tomt så här länge stoppas inspelningen
  tickMs = 100,
} = {}) {
  const active = new Map(); // rum -> inspelning
  let presence = () => [];
  const iso = (ms) => new Date(ms).toISOString();
  const keys = (room, id) => ({ log: `recordings/${room}/${id}.jsonl`, meta: `recordings/${room}/${id}.meta.json`, shots: `recordings/${room}/${id}.shots.json` });
  // The shot list from a finished log (shared/*.mjs are ES modules: imported once, lazily).
  let shared = null;
  const loadShared = () => (shared ||= Promise.all([import('../shared/replay.mjs'), import('../shared/director.mjs')]).then(([R, D]) => ({ R, D })));
  async function shotsOf(buf) {
    const { R, D } = await loadShared();
    return D.shotList(R.buildTimeline(R.parseRecording(buf.toString('utf8'))));
  }

  function metaOf(r) {
    return {
      v: VERSION, recId: r.id, room: r.room, status: r.status, startedAt: iso(r.start), stoppedAt: r.stoppedAt ? iso(r.stoppedAt) : null,
      durationMs: (r.stoppedAt || clock()) - r.start, bytes: r.fileBytes || r.bytes, events: r.lines.length, stopReason: r.reason || null,
      startedBy: r.by || null, participants: [...r.people.entries()].map(([id, name]) => ({ id, name })), cameras: r.cameraCount,
      limits: { maxMs, maxBytes },
    };
  }
  function body(r) {
    const head = JSON.stringify(r.header || { format: FORMAT, v: VERSION, id: r.id, room: r.room, startedAt: iso(r.start), pending: true });
    return Buffer.from([head, ...r.lines, ...(r.endLine ? [r.endLine] : [])].join('\n') + '\n');
  }
  // Skriv loggen och metadata (en skrivning i taget per inspelning).
  function flush(r) {
    r.writing = r.writing.then(async () => {
      const k = keys(r.room, r.id);
      const buf = body(r); r.fileBytes = buf.length;
      await store.adapter.put(k.log, buf, 'application/x-ndjson');
      await store.adapter.put(k.meta, Buffer.from(JSON.stringify(metaOf(r), null, 1)), 'application/json');
    }).catch((e) => console.error('Inspelningen kunde inte sparas:', e.message));
    return r.writing;
  }
  function write(r, e, data) {
    if (r.status !== 'recording') return;
    const line = JSON.stringify({ t: Math.max(0, clock() - r.start), e, ...data });
    r.lines.push(line); r.bytes += Buffer.byteLength(line) + 1;
    if (r.bytes >= maxBytes) stop(r.room, 'size');
  }
  function flushMove(r, id) {
    const m = r.moves.get(id); if (!m) return;
    r.moves.delete(id); r.lastMove.set(id, clock());
    write(r, 'move', m);
  }

  // Händelser från realtime.js (gubbar, positioner, chatt).
  function log(room, e, data) {
    const r = active.get(room); if (!r || r.status !== 'recording') return;
    if (e === 'move') {
      // Bara den senaste positionen sparas om de kommer tätare än var 100:e ms.
      r.moves.set(data.id, data);
      if (clock() - (r.lastMove.get(data.id) || 0) >= moveMs) flushMove(r, data.id);
      return;
    }
    if (e === 'leave') { flushMove(r, data.id); r.lastMove.delete(data.id); }
    if (e === 'join' || e === 'look') r.people.set(data.id, data.name);
    write(r, e, data);
  }
  const off = onBroadcast((roomId, ev) => {
    if (!ev || !ROOM_EVENTS.has(ev.type)) return;
    const list = roomId === '*' ? [...active.values()] : active.has(roomId) ? [active.get(roomId)] : [];
    const { type, ...data } = ev;
    for (const r of list) { if (type.startsWith('camera:')) r.cameraCount = Math.max(r.cameraCount, 1); write(r, type, data); }
  });

  async function start(room, { by = null, snapshot }) {
    if (active.has(room)) return { already: true, ...status(room) };
    if (active.size >= maxActive) throw Object.assign(new Error('The server is already recording as many rooms as it can. Try again later.'), { code: 'BUSY' });
    const now = clock();
    const r = {
      id: crypto.randomBytes(8).toString('hex'), room, start: now, by, status: 'recording', lines: [], bytes: 0, header: null, endLine: null,
      people: new Map(), moves: new Map(), lastMove: new Map(), writing: Promise.resolve(), reason: null, stoppedAt: null, emptySince: null, cameraCount: 0,
    };
    active.set(room, r);
    // Vilka är här just nu (med position och blickriktning) blir startläget.
    const players = presence(room);
    for (const p of players) r.people.set(p.id, p.name);
    // Klibbor och kameror hämtas från lagringen. Händelser som hinner komma under tiden
    // hamnar redan i loggen (uppspelningen tål att en klibba finns i båda).
    const snap = await snapshot();
    r.cameraCount = (snap.cameras || []).length;
    r.header = {
      format: FORMAT, v: VERSION, id: r.id, room, startedAt: iso(now), clock: 'ms', positions: 'eye',
      style: snap.style || null, stamps: snap.stamps || [], images: snap.images || {}, cameras: snap.cameras || [], players,
      tracks: [], // ljudspår per person kommer i steg 2 (se docs/recording-format.md)
      limits: { maxMs, maxBytes },
    };
    r.bytes += Buffer.byteLength(JSON.stringify(r.header)) + 1; // storleksgränsen gäller hela filen
    r.timer = setTimeout(() => stop(room, 'time'), maxMs); r.timer.unref?.();
    r.flusher = setInterval(() => flush(r), flushMs); r.flusher.unref?.();
    r.ticker = setInterval(() => {
      for (const id of [...r.moves.keys()]) if (clock() - (r.lastMove.get(id) || 0) >= moveMs) flushMove(r, id);
      const n = presence(room).length;
      if (n) r.emptySince = null; else if (r.emptySince === null) r.emptySince = clock(); else if (clock() - r.emptySince >= emptyMs) stop(room, 'empty');
    }, tickMs); r.ticker.unref?.();
    await flush(r);
    broadcast(room, { type: 'rec:start', recId: r.id, startedAt: iso(now), maxMs });
    return { already: false, ...status(room) };
  }

  // reason: 'stop' (någon tryckte stopp), 'time', 'size', 'empty' eller 'shutdown'
  async function stop(room, reason = 'stop') {
    const r = active.get(room); if (!r || r.status !== 'recording') return null;
    for (const id of [...r.moves.keys()]) flushMove(r, id);
    r.status = 'done'; r.reason = reason; r.stoppedAt = clock();
    r.endLine = JSON.stringify({ t: r.stoppedAt - r.start, e: 'end', reason });
    clearTimeout(r.timer); clearInterval(r.flusher); clearInterval(r.ticker);
    active.delete(room);
    broadcast(room, { type: 'rec:stop', recId: r.id, reason, durationMs: r.stoppedAt - r.start });
    await flush(r);
    // Raw material for editing: the shot list next to the log (best effort; GET …/shots can
    // always compute it again from the log).
    try { await store.adapter.put(keys(room, r.id).shots, Buffer.from(JSON.stringify(await shotsOf(body(r)), null, 1)), 'application/json'); }
    catch (e) { console.error('Shot list could not be saved:', e.message); }
    return metaOf(r);
  }

  function status(room) {
    const r = active.get(room); if (!r) return null;
    return { recId: r.id, startedAt: iso(r.start), durationMs: clock() - r.start, bytes: r.bytes, maxMs, maxBytes };
  }
  async function list(room) {
    const out = [];
    for (const k of await store.adapter.list(`recordings/${room}/`)) {
      if (!k.endsWith('.meta.json')) continue;
      const b = await store.adapter.get(k); if (!b) continue;
      try {
        const m = JSON.parse(b.toString('utf8'));
        if (m.status === 'recording' && !(active.get(room)?.id === m.recId)) m.status = 'interrupted'; // servern startade om mitt i
        out.push(m);
      } catch { /* trasig fil */ }
    }
    return out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  }
  async function meta(room, id) {
    if (!REC_ID_RE.test(id)) return null;
    const r = active.get(room); if (r && r.id === id) return metaOf(r);
    const b = await store.adapter.get(keys(room, id).meta); if (!b) return null;
    try { const m = JSON.parse(b.toString('utf8')); if (m.status === 'recording') m.status = 'interrupted'; return m; } catch { return null; }
  }
  async function read(room, id) {
    if (!REC_ID_RE.test(id)) return null;
    const r = active.get(room); if (r && r.id === id) return body(r); // pågår: allt hittills
    return store.adapter.get(keys(room, id).log);
  }
  // The shot list: the saved file, or computed from the log (a recording still running, or an old one).
  async function shots(room, id) {
    if (!REC_ID_RE.test(id)) return null;
    const r = active.get(room);
    if (!(r && r.id === id)) { const b = await store.adapter.get(keys(room, id).shots); if (b) { try { return JSON.parse(b.toString('utf8')); } catch { /* compute */ } } }
    const buf = await read(room, id); if (!buf) return null;
    return shotsOf(buf);
  }
  async function remove(room, id) {
    if (!REC_ID_RE.test(id) || active.get(room)?.id === id) return false;
    const k = keys(room, id);
    if (!(await store.adapter.exists(k.meta))) return false;
    await store.adapter.delete(k.log); await store.adapter.delete(k.meta); await store.adapter.delete(k.shots).catch(() => {});
    return true;
  }
  async function close() { off(); await Promise.all([...active.keys()].map((room) => stop(room, 'shutdown'))); }

  return { start, stop, status, log, list, meta, read, shots, remove, close, setPresence: (fn) => { presence = fn; }, isActive: (room) => active.has(room) };
}

module.exports = { createRecorder, REC_ID_RE, FORMAT, VERSION };
