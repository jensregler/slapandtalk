// Rum, stämplar och bilder. Allt sparas via ett lagrings-adapter (se storage/), så det
// spelar ingen roll för resten av appen om det ligger på disken eller i t.ex. Cloudflare R2.
// Vill vi senare ha en riktig databas för rummen är det bara funktionerna här som byts.
//
// RUMSTYPER
//   stad     Staden, det publika rummet ("stad"). Sparas alltid, rensas aldrig.
//   quick    Snabbrum. Vem som helst kan skapa ett, utan konto. Raderas automatiskt
//            när ingen har besökt det på QUICK_ROOM_TTL_HOURS timmar (standard 24).
//   profile  Profilrum. Hör till en användare (owner) och sparas. Rensas aldrig av
//            städjobbet. (Konton finns inte än; senare: påminnelse innan arkivering.)
//
// Ett rum sparas som "rooms/<id>.json":
//   { id, type, owner, createdAt, lastVisitAt, style, stamps: [...], cameras: [...] }
//   cameras = virtuella kameror för inspelning: { id, name, p, yaw, pitch, fov, aspect, createdAt }
//   owner = null, eller { id, name } när konton finns.
//   peelsOn = true om rummet har "peels" på (baksidespappret faller till golvet vid varje slap), annars saknas fältet.
//   peels = [{ id, imageId, w, h, seed, start, x, z, yaw, order, createdAt }] (högst maxPerRoom, de äldsta försvinner).
//     Peelar man klibban från väggen ligger pappret kvar. Saknas i äldre rum (= inga).
//   groove = { scale, at, phase } the footstep groove (shared/groove.mjs); missing = the default 1.0×.
//
// Bilder (designs) sparas EN gång och stämplarna pekar på dem med imageId.
//   "images/<id>.json"  metadata  { id, url, width, height, artist, createdAt }
//   "uploads/<id>.webp" själva bilden
//   id = början av SHA-256 av bildens innehåll, så samma bild två gånger blir samma design.
const crypto = require('crypto');

const ROOM_TYPES = ['stad', 'quick', 'profile'];
const PUBLIC_ROOM = 'stad';
const VISIT_WRITE_MS = 60_000; // skriv "senast besökt" högst en gång i minuten per rum
const PEEL_KEEP = 20; // så många av sina senaste stämplar per rum kan man peela
// Safety cap: at most this many stickers per room. A new slap beyond it quietly removes the
// OLDEST sticker (broadcast as an ordinary stamp:remove by app.js). Override: MAX_STAMPS_PER_ROOM.
const MAX_STAMPS_PER_ROOM = (() => {
  const n = Number.parseInt(process.env.MAX_STAMPS_PER_ROOM, 10);
  return Number.isFinite(n) && n > 0 ? n : 3000;
})();

const newId = () => crypto.randomBytes(8).toString('hex');
const contentId = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
// Korta rumskoder utan tecken som är lätta att blanda ihop (0/o, 1/l/i).
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const roomCode = (n = 6) => [...crypto.randomBytes(n)].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

// SNABBHET (sedan R2): rummen hålls i minnet och är "sanningen" medan servern kör.
// En stämpling ändrar bara minnet och svarar direkt; själva skrivningen till lagringen
// sker strax efteråt i bakgrunden (write-behind), samlad om många stämplar kommer tätt,
// med nya försök om lagringen inte svarar. Vid avstängning (SIGTERM) skrivs allt ut: flush().
// Servern kör som EN process (Render), så minnet kan vara sanningen.
//   writeDelayMs   hur länge vi väntar innan ett ändrat rum skrivs (samlar ihop klibbor)
//   retryMs        första väntan efter ett misslyckat försök (dubblas, max 30 s)
function createStore(adapter, { clock = () => Date.now(), writeDelayMs = 200, retryMs = 1000, log = console } = {}) {
  const locks = new Map();
  // Ett rum i taget ändras: annars kan två samtidiga ändringar skriva över varandra.
  function withLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return run;
  }
  const readJson = async (key) => { const b = await adapter.get(key); if (!b) return null; try { return JSON.parse(b.toString('utf8')); } catch { return null; } };
  const writeJson = (key, data) => adapter.put(key, Buffer.from(JSON.stringify(data, null, 1)), 'application/json');
  const roomKey = (id) => `rooms/${id}.json`;
  const iso = () => new Date(clock()).toISOString();

  const defaultType = (id) => (id === PUBLIC_ROOM ? 'stad' : 'quick');
  // Fyller i fält som saknas i äldre rumsfiler (från före rumstyperna).
  function normalize(id, r) {
    const room = { id, type: defaultType(id), owner: null, createdAt: null, lastVisitAt: null, stamps: [], ...(r || {}) };
    if (id === PUBLIC_ROOM) room.type = 'stad';
    if (!ROOM_TYPES.includes(room.type)) room.type = 'quick';
    return room;
  }

  // ---------- Rum i minnet + skrivning i bakgrunden ----------
  // cache: id -> { room (null = borttaget), dirty, timer, failures, usedAt }
  const cache = new Map();
  const loading = new Map(); // id -> Promise (så två samtidiga läsningar bara frågar lagringen en gång)
  const chains = new Map(); // id -> Promise: skrivningar per rum i ordning
  const delays = new Set(); // väntande försöks-timers (så flush() kan avbryta dem)

  async function loadRoom(id) {
    const hit = cache.get(id);
    if (hit) { hit.usedAt = clock(); return hit.room; }
    if (!loading.has(id)) {
      const p = readJson(roomKey(id)).then((r) => {
        const room = r ? normalize(id, r) : null;
        // Även "finns inte" kommer vi ihåg (room: null), så första klibban i ett nytt rum inte
        // behöver fråga lagringen igen. Bara den här servern skriver rummen.
        if (!cache.has(id)) cache.set(id, { room, dirty: false, timer: null, failures: 0, usedAt: clock() });
        return cache.has(id) ? cache.get(id).room : room;
      }).finally(() => loading.delete(id));
      loading.set(id, p);
    }
    return loading.get(id);
  }

  function queue(id, fn) {
    const run = (chains.get(id) || Promise.resolve()).then(fn);
    const tail = run.catch(() => {});
    chains.set(id, tail);
    tail.then(() => { if (chains.get(id) === tail) chains.delete(id); });
    return run;
  }
  function schedule(id, ms = writeDelayMs) {
    const e = cache.get(id);
    if (!e || e.timer) return;
    e.timer = setTimeout(() => { e.timer = null; writeRoom(id).catch(() => {}); }, ms);
  }
  // Skriver rummet om det är ändrat. Misslyckas det ligger ändringen kvar i minnet och
  // ett nytt försök planeras (1 s, 2 s, 4 s … max 30 s).
  function writeRoom(id) {
    return queue(id, async () => {
      const e = cache.get(id);
      if (!e || !e.dirty) return;
      if (e.timer) { clearTimeout(e.timer); e.timer = null; }
      e.dirty = false;
      const del = e.room === null;
      const body = del ? null : Buffer.from(JSON.stringify(e.room, null, 1));
      try {
        if (del) await adapter.delete(roomKey(id)); else await adapter.put(roomKey(id), body, 'application/json');
        e.failures = 0;
      } catch (err) {
        if (cache.get(id) === e) {
          e.dirty = true; e.failures++;
          const wait = Math.min(30_000, retryMs * 2 ** (e.failures - 1));
          log.error(`[lagring] Kunde inte spara rummet ${id} (försök ${e.failures}), provar igen om ${wait} ms: ${err && err.message}`);
          schedule(id, wait);
        }
        throw err;
      }
    });
  }
  function markDirty(id, room) {
    let e = cache.get(id);
    if (!e) { e = { room, dirty: false, timer: null, failures: 0, usedAt: clock() }; cache.set(id, e); }
    e.room = room; e.dirty = true; e.usedAt = clock();
    schedule(id);
  }
  // Skriv ut alla ändrade rum nu (vid avstängning). Svar: { written, failed }.
  async function flush() {
    const ids = [...cache.keys()].filter((id) => cache.get(id).dirty || chains.has(id));
    let failed = 0;
    await Promise.all(ids.map(async (id) => {
      const e = cache.get(id);
      if (e && e.timer) { clearTimeout(e.timer); e.timer = null; }
      try { await writeRoom(id); } catch { failed++; }
      const left = cache.get(id);
      if (left && left.timer) { clearTimeout(left.timer); left.timer = null; } // inga fler försök efter flush
    }));
    return { written: ids.length - failed, failed };
  }
  // Hur många rum väntar på att skrivas (för hälsokoll och tester).
  const pendingWrites = () => [...cache.entries()].filter(([id, e]) => e.dirty || chains.has(id)).length;
  // Släpp rum ur minnet som är sparade och inte använts på maxIdleMs (så minnet inte växer).
  function evictIdle(maxIdleMs) {
    let n = 0;
    for (const [id, e] of cache) if (!e.dirty && !chains.has(id) && !locks.has(id) && clock() - e.usedAt > maxIdleMs) { cache.delete(id); n++; }
    return n;
  }

  // Utåt lämnas en kopia: ingen utanför store.js kan råka ändra rummet i minnet.
  async function getRoom(id) { const r = await loadRoom(id); return r && structuredClone(r); }
  // Läs ett rum utan att spara det i minnet (och utan att räkna det som använt).
  async function peekRoom(id) {
    const e = cache.get(id);
    if (e) return e.room;
    if (loading.has(id)) return loading.get(id);
    const r = await readJson(roomKey(id));
    return r ? normalize(id, r) : null;
  }
  // Som getRoom, men ger ett tomt (osparat) rum om det inte finns.
  async function roomOrEmpty(id) { return (await getRoom(id)) || { ...normalize(id, null), exists: false }; }
  // Every save is activity (a sticker, an edit, a visit …) and stamps updatedAt, except the
  // cleanup jobs (touch: false), so "my most recently updated room" means what people did there.
  async function saveRoom(room, { touch = true } = {}) { const { exists, ...data } = room; if (touch) data.updatedAt = iso(); markDirty(data.id, data); return data; }
  // Tar bort rummet från minnet och lagringen (väntar på lagringen, sker sällan).
  async function removeRoom(id) {
    markDirty(id, null);
    await writeRoom(id);
  }
  const roomTaken = async (c) => { const e = cache.get(c); if (e) return e.room !== null; return adapter.exists(roomKey(c)); };

  async function createRoom({ id, type = 'quick', owner = null, style = null, keyHash = null, extra: more = null } = {}) {
    if (!ROOM_TYPES.includes(type)) throw new Error('Unknown room type');
    for (let tries = 0; !id && tries < 20; tries++) {
      const c = roomCode();
      if (c !== PUBLIC_ROOM && !(await roomTaken(c))) id = c;
    }
    if (!id) throw new Error('Could not find a free room code');
    return withLock(id, async () => {
      if (await loadRoom(id)) throw Object.assign(new Error('That room already exists'), { code: 'EXISTS' });
      const now = iso();
      const extra = {};
      if (style) extra.style = style;
      if (keyHash) extra.keyHash = keyHash;
      if (more) Object.assign(extra, more);
      return saveRoom(normalize(id, { type: id === PUBLIC_ROOM ? 'stad' : type, owner, createdAt: now, lastVisitAt: now, ...extra, stamps: [] }));
    });
  }

  // Byt rummets utseende. canEdit(room) avgör om den som frågar får (rumsnyckel eller admin).
  // Svar: 'ok', 'forbidden' (eller rummet skapas om det är staden och admin frågar).
  async function setRoomStyle(id, style, canEdit) {
    return withLock(id, async () => {
      let room = await loadRoom(id);
      if (!room && id === PUBLIC_ROOM) room = normalize(id, { createdAt: iso() });
      if (!room) return 'notfound';
      if (!canEdit(room)) return 'forbidden';
      room.style = style;
      await saveRoom(room);
      return 'ok';
    });
  }

  // Peels på/av. canEdit som för utseendet. Svar: 'ok', 'notfound' eller 'forbidden'.
  async function setPeelsOn(id, on, canEdit) {
    return withLock(id, async () => {
      let room = await loadRoom(id);
      if (!room && id === PUBLIC_ROOM) room = normalize(id, { createdAt: iso() });
      if (!room) return 'notfound';
      if (!canEdit(room)) return 'forbidden';
      if (on) room.peelsOn = true; else delete room.peelsOn;
      await saveRoom(room);
      return 'ok';
    });
  }
  // The footstep groove (shared/groove.mjs). make(old groove | null) → the new one. canEdit as for the look.
  // Answer: the new groove, 'notfound' or 'forbidden'. The default (1.0×) is stored as no field.
  async function setGroove(id, make, canEdit) {
    return withLock(id, async () => {
      let room = await loadRoom(id);
      if (!room && id === PUBLIC_ROOM) room = normalize(id, { createdAt: iso() });
      if (!room) return 'notfound';
      if (!canEdit(room)) return 'forbidden';
      const g = make(room.groove || null);
      if (g.scale === 1 && !room.groove) return g; // nothing to save
      room.groove = g;
      await saveRoom(room);
      return g;
    });
  }
  // Ta bort allt baksidespapper på golvet. Svar: antal, 'notfound' eller 'forbidden'.
  async function clearPeels(id, canEdit) {
    return withLock(id, async () => {
      const room = await loadRoom(id);
      if (!room) return 'notfound';
      if (!canEdit(room)) return 'forbidden';
      const n = (room.peels || []).length;
      if (n) { room.peels = []; await saveRoom(room); }
      return n;
    });
  }
  // Ett nytt papper på golvet (bara om rummet har peels på). Svar: pappret eller null.
  async function addPeel(id, peel, max = 300) {
    return withLock(id, async () => {
      const room = await loadRoom(id);
      if (!room || !room.peelsOn) return null;
      room.peels = Array.isArray(room.peels) ? room.peels : [];
      const p = { order: (room.peels.at(-1)?.order ?? 0) + 1, createdAt: iso(), ...peel };
      room.peels.push(p);
      if (room.peels.length > max) room.peels.splice(0, room.peels.length - max);
      await saveRoom(room);
      return p;
    });
  }
  // Läs peels-läget utan kopia (bara för att läsa, t.ex. vid varje slap på golvet).
  async function peelState(id) { const r = await loadRoom(id); return { on: !!r?.peelsOn, peels: r?.peels || [] }; }

  // Ändra rummets kameror. fn(cameras, room) ändrar listan och returnerar svaret.
  // Svar: fn:s svar, 'notfound' eller 'forbidden'. Staden skapas om admin lägger en kamera där.
  async function editCameras(id, canEdit, fn) {
    return withLock(id, async () => {
      let room = await loadRoom(id);
      if (!room && id === PUBLIC_ROOM) room = normalize(id, { createdAt: iso() });
      if (!room) return 'notfound';
      if (!canEdit(room)) return 'forbidden';
      room.cameras = Array.isArray(room.cameras) ? room.cameras : [];
      const res = fn(room.cameras, room);
      if (res && res.save !== false) await saveRoom(room);
      return res;
    });
  }

  // Generic locked edit of an existing room (demo: members, invites). fn(room) returns the answer;
  // the room is saved unless the answer has save: false. Missing room: 'notfound'.
  async function editRoom(id, fn) {
    return withLock(id, async () => {
      const room = await loadRoom(id);
      if (!room) return 'notfound';
      const res = await fn(room);
      if (!res || res.save !== false) await saveRoom(room);
      return res;
    });
  }
  // Läs ett rum utan kopia och utan lås (bara för att läsa).
  async function peek(id) { return structuredClone(await peekRoom(id)); }

  // Någon är i rummet: uppdatera "senast besökt" (bara rum som finns, plus staden).
  async function touchRoom(id) {
    return withLock(id, async () => {
      let room = await loadRoom(id);
      if (!room && id !== PUBLIC_ROOM) return null;
      if (!room) room = normalize(id, { createdAt: iso() });
      const last = room.lastVisitAt ? Date.parse(room.lastVisitAt) : 0;
      if (clock() - last >= VISIT_WRITE_MS) { room.lastVisitAt = iso(); await saveRoom(room); }
      return structuredClone(room);
    });
  }

  // onEvict(ids): called (inside the room's lock) with the ids of the oldest stickers that were
  // dropped to stay within maxStamps, so the caller can broadcast stamp:remove for them.
  // onLeave(ids): the stickers that just left the peel history (nobody can peel them any more),
  // for the automatic cleanup of hidden stickers (server/hidden.js).
  async function addStamp(roomId, stamp, { maxStamps = MAX_STAMPS_PER_ROOM, onEvict = null, onLeave = null } = {}) {
    return withLock(roomId, async () => {
      const room = (await loadRoom(roomId)) || normalize(roomId, { createdAt: iso() });
      const s = { id: newId(), order: (room.stamps.at(-1)?.order ?? 0) + 1, createdAt: iso(), ...stamp };
      room.stamps.push(s);
      const over = room.stamps.length - Math.max(1, maxStamps);
      if (over > 0) { // stamps are kept in order: the first ones are the oldest
        const evicted = room.stamps.splice(0, over).map((x) => x.id);
        if (onEvict) onEvict(evicted);
      }
      // Bara de senaste PEEL_KEEP stämplarna per person och rum går att peela: äldre tappar sin
      // peel-nyckel (då kan bara admin ta bort dem).
      if (s.peelOwner) trimPeelable(room, s.peelOwner, onLeave);
      room.lastVisitAt = iso();
      await saveRoom(room);
      return s;
    });
  }
  // The peel history counts STEPS, not stickers: an auto-slap burst shares its first sticker's peel
  // key (POST …/stamps with join), so the whole burst is one step. (Rows from the removed sticker
  // arrays share a key the same way and still count as one step.) Keep the newest PEEL_KEEP distinct keys of this owner; older
  // stickers lose theirs (only admin can remove them then) and are reported to onLeave.
  function trimPeelable(room, owner, onLeave) {
    const mine = room.stamps.filter((x) => x.peelOwner === owner && x.peelHash);
    const keys = [...new Set(mine.map((x) => x.peelHash))]; // oldest first (stamps are kept in order)
    if (keys.length <= PEEL_KEEP) return;
    const drop = new Set(keys.slice(0, keys.length - PEEL_KEEP));
    const left = mine.filter((x) => drop.has(x.peelHash));
    for (const old of left) { delete old.peelHash; delete old.peelOwner; }
    if (onLeave && left.length) onLeave(left.map((x) => x.id));
  }
  async function deleteStamp(roomId, stampId) {
    return withLock(roomId, async () => {
      const room = await loadRoom(roomId);
      if (!room) return false;
      const before = room.stamps.length;
      room.stamps = room.stamps.filter((s) => s.id !== stampId);
      await saveRoom(room);
      return before !== room.stamps.length;
    });
  }
  // Peela (ta bort) egna stämplar. check(stamp) avgör om nyckeln stämmer.
  // Allt sker i rummets skrivkö. Svar per stämpel: 'ok', 'notfound' eller 'forbidden'.
  async function peelStamps(roomId, items, check) {
    return withLock(roomId, async () => {
      const room = await loadRoom(roomId);
      const result = {};
      const remove = new Set();
      for (const { id, token } of items) {
        const s = room?.stamps.find((x) => x.id === id);
        if (!s) result[id] = 'notfound';
        else if (!check(s, token)) result[id] = 'forbidden';
        else { result[id] = 'ok'; remove.add(id); }
      }
      if (remove.size) { room.stamps = room.stamps.filter((x) => !remove.has(x.id)); await saveRoom(room); }
      return result;
    });
  }
  // Ta bort alla stämplar i rummet. Svar: hur många som togs bort.
  async function resetStamps(roomId) {
    return withLock(roomId, async () => {
      const room = await loadRoom(roomId);
      if (!room || !room.stamps.length) return 0;
      const n = room.stamps.length;
      room.stamps = []; room.lastVisitAt = iso();
      await saveRoom(room);
      return n;
    });
  }
  // Rummen i lagringen plus de i minnet som inte hunnit skrivas, minus borttagna.
  async function listRooms() {
    const ids = new Set((await adapter.list('rooms/')).filter((k) => k.endsWith('.json')).map((k) => k.slice(6, -5)));
    for (const [id, e] of cache) { if (e.room === null) ids.delete(id); else ids.add(id); }
    return [...ids];
  }
  async function deleteRoom(id) { return withLock(id, () => removeRoom(id)); }
  // When was something last done in these rooms? (GET /api/rooms/recent) Reads without caching;
  // older files without updatedAt: the latest of the last visit, the last sticker and creation.
  // null = the room does not exist.
  async function lastActivity(ids) {
    return Promise.all(ids.map(async (id) => {
      const r = await peekRoom(id);
      if (!r) return null;
      const t = [r.updatedAt, r.lastVisitAt, r.createdAt, r.stamps && r.stamps.length ? r.stamps[r.stamps.length - 1].createdAt : null]
        .map((x) => (x ? Date.parse(x) : NaN)).filter(Number.isFinite);
      return { id, type: r.type, updatedAt: t.length ? new Date(Math.max(...t)).toISOString() : null, room: r };
    }));
  }
  async function deleteStampsWithImage(imageId) {
    let removed = 0;
    for (const id of await listRooms()) {
      await withLock(id, async () => {
        const room = await loadRoom(id);
        if (!room) return;
        const before = room.stamps.length, peelsBefore = (room.peels || []).length;
        room.stamps = room.stamps.filter((s) => s.imageId !== imageId);
        if (room.peels) room.peels = room.peels.filter((p) => p.imageId !== imageId);
        if (room.stamps.length !== before || (room.peels || []).length !== peelsBefore) { removed += before - room.stamps.length; await saveRoom(room, { touch: false }); }
      });
    }
    return removed;
  }

  // Städjobbet: tar bort snabbrum som ingen har besökt på quickTtlMs millisekunder.
  // Staden och profilrum rörs aldrig. Rum utan "senast besökt" (äldre filer) får den
  // tiden satt nu, så de får en hel period på sig.
  async function cleanupRooms({ quickTtlMs }) {
    const deleted = [];
    for (const id of await listRooms()) {
      await withLock(id, async () => {
        const room = await peekRoom(id); // städningen läser utan att lägga alla rum i minnet
        if (!room || room.type !== 'quick') return;
        if (!room.lastVisitAt) { room.lastVisitAt = iso(); await saveRoom(room, { touch: false }); return; }
        if (clock() - Date.parse(room.lastVisitAt) > quickTtlMs) { await removeRoom(id); deleted.push(id); }
      });
    }
    return deleted;
  }

  // ---------- Bilder ----------
  // En design ändras aldrig (id = hash av innehållet), så det vi vet finns kommer vi ihåg:
  // en klibba behöver då inte fråga lagringen om bilden varje gång.
  const imageMeta = new Map(); // id -> metadata
  const imageFiles = new Set(); // id:n vars bildfil vi vet finns
  const getImage = async (id) => {
    if (imageMeta.has(id)) return imageMeta.get(id);
    const m = await readJson(`images/${id}.json`);
    if (m) imageMeta.set(id, m);
    return m;
  };
  const addImage = async (img) => { await writeJson(`images/${img.id}.json`, img); imageMeta.set(img.id, img); return img; };
  const deleteImage = async (id) => { imageMeta.delete(id); await adapter.delete(`images/${id}.json`); };
  const putImageFile = async (id, buf) => { await adapter.put(`uploads/${id}.webp`, buf, 'image/webp'); imageFiles.add(id); };
  const getImageFile = (id) => adapter.get(`uploads/${id}.webp`);
  // fresh: fråga lagringen ändå (när rummet laddas), annars räcker det vi redan vet.
  const hasImageFile = async (id, { fresh = false } = {}) => {
    if (!fresh && imageFiles.has(id)) return true;
    const ok = await adapter.exists(`uploads/${id}.webp`);
    if (ok) imageFiles.add(id); else { imageFiles.delete(id); }
    return ok;
  };
  const deleteImageFile = async (id) => { imageFiles.delete(id); await adapter.delete(`uploads/${id}.webp`); };
  // Designs an admin removed on purpose (a tombstone in removed/<id>.json). Clients must not upload
  // them again by themselves (that is only for designs the server LOST), and they drop them from the
  // palette. Someone deliberately uploading the same image again clears the tombstone.
  const removedCache = new Map(); // id -> true/false
  const markRemoved = async (id) => { removedCache.set(id, true); await writeJson(`removed/${id}.json`, { id, removedAt: iso() }); };
  const isRemoved = async (id) => {
    if (removedCache.has(id)) return removedCache.get(id);
    const r = !!(await readJson(`removed/${id}.json`)); removedCache.set(id, r); return r;
  };
  const clearRemoved = async (id) => { if (!(await isRemoved(id))) return; removedCache.set(id, false); await adapter.delete(`removed/${id}.json`); };

  // Engångsflytt: äldre versioner sparade alla bilder i en fil, images.json.
  async function migrate() {
    const old = await readJson('images.json');
    if (!old) return 0;
    for (const img of Object.values(old)) if (img && img.id && !(await adapter.exists(`images/${img.id}.json`))) await addImage(img);
    await adapter.put('images.json.migrated', Buffer.from(JSON.stringify(old)), 'application/json');
    await adapter.delete('images.json');
    return Object.keys(old).length;
  }

  return {
    adapter, clock, emptyRoom: (id) => normalize(id, null), getRoom, editRoom, peek, roomOrEmpty, createRoom, setRoomStyle, editCameras, touchRoom, addStamp, deleteStamp, peelStamps, resetStamps, listRooms, deleteRoom, lastActivity,
    deleteStampsWithImage, cleanupRooms, setPeelsOn, clearPeels, setGroove, addPeel, peelState, getImage, addImage, deleteImage, putImageFile, getImageFile, hasImageFile,
    deleteImageFile, markRemoved, isRemoved, clearRemoved, migrate, flush, pendingWrites, evictIdle,
  };
}

module.exports = { MAX_STAMPS_PER_ROOM, createStore, newId, contentId, roomCode, ROOM_TYPES, PUBLIC_ROOM, PEEL_KEEP };
