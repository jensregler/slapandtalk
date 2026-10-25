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

const newId = () => crypto.randomBytes(8).toString('hex');
const contentId = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
// Korta rumskoder utan tecken som är lätta att blanda ihop (0/o, 1/l/i).
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const roomCode = (n = 6) => [...crypto.randomBytes(n)].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

function createStore(adapter, { clock = () => Date.now() } = {}) {
  const locks = new Map();
  // Ett rum i taget skrivs: annars kan två samtidiga stämplingar skriva över varandra.
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

  async function getRoom(id) { const r = await readJson(roomKey(id)); return r ? normalize(id, r) : null; }
  // Som getRoom, men ger ett tomt (osparat) rum om det inte finns.
  async function roomOrEmpty(id) { return (await getRoom(id)) || { ...normalize(id, null), exists: false }; }
  async function saveRoom(room) { const { exists, ...data } = room; await writeJson(roomKey(room.id), data); return data; }

  async function createRoom({ id, type = 'quick', owner = null, style = null, keyHash = null } = {}) {
    if (!ROOM_TYPES.includes(type)) throw new Error('Unknown room type');
    for (let tries = 0; !id && tries < 20; tries++) {
      const c = roomCode();
      if (c !== PUBLIC_ROOM && !(await adapter.exists(roomKey(c)))) id = c;
    }
    if (!id) throw new Error('Could not find a free room code');
    return withLock(id, async () => {
      if (await getRoom(id)) throw Object.assign(new Error('That room already exists'), { code: 'EXISTS' });
      const now = iso();
      const extra = {};
      if (style) extra.style = style;
      if (keyHash) extra.keyHash = keyHash;
      return saveRoom(normalize(id, { type: id === PUBLIC_ROOM ? 'stad' : type, owner, createdAt: now, lastVisitAt: now, ...extra, stamps: [] }));
    });
  }

  // Byt rummets utseende. canEdit(room) avgör om den som frågar får (rumsnyckel eller admin).
  // Svar: 'ok', 'forbidden' (eller rummet skapas om det är staden och admin frågar).
  async function setRoomStyle(id, style, canEdit) {
    return withLock(id, async () => {
      let room = await getRoom(id);
      if (!room && id === PUBLIC_ROOM) room = normalize(id, { createdAt: iso() });
      if (!room) return 'notfound';
      if (!canEdit(room)) return 'forbidden';
      room.style = style;
      await saveRoom(room);
      return 'ok';
    });
  }

  // Ändra rummets kameror. fn(cameras, room) ändrar listan och returnerar svaret.
  // Svar: fn:s svar, 'notfound' eller 'forbidden'. Staden skapas om admin lägger en kamera där.
  async function editCameras(id, canEdit, fn) {
    return withLock(id, async () => {
      let room = await getRoom(id);
      if (!room && id === PUBLIC_ROOM) room = normalize(id, { createdAt: iso() });
      if (!room) return 'notfound';
      if (!canEdit(room)) return 'forbidden';
      room.cameras = Array.isArray(room.cameras) ? room.cameras : [];
      const res = fn(room.cameras, room);
      if (res && res.save !== false) await saveRoom(room);
      return res;
    });
  }

  // Någon är i rummet: uppdatera "senast besökt" (bara rum som finns, plus staden).
  async function touchRoom(id) {
    return withLock(id, async () => {
      let room = await getRoom(id);
      if (!room && id !== PUBLIC_ROOM) return null;
      if (!room) room = normalize(id, { createdAt: iso() });
      const last = room.lastVisitAt ? Date.parse(room.lastVisitAt) : 0;
      if (clock() - last >= VISIT_WRITE_MS) { room.lastVisitAt = iso(); await saveRoom(room); }
      return room;
    });
  }

  async function addStamp(roomId, stamp) {
    return withLock(roomId, async () => {
      const room = (await getRoom(roomId)) || normalize(roomId, { createdAt: iso() });
      const s = { id: newId(), order: (room.stamps.at(-1)?.order ?? 0) + 1, createdAt: iso(), ...stamp };
      room.stamps.push(s);
      // Bara de senaste PEEL_KEEP stämplarna per person och rum går att peela: äldre tappar sin
      // peel-nyckel (då kan bara admin ta bort dem).
      if (s.peelOwner) {
        const mine = room.stamps.filter((x) => x.peelOwner === s.peelOwner && x.peelHash);
        for (const old of mine.slice(0, Math.max(0, mine.length - PEEL_KEEP))) { delete old.peelHash; delete old.peelOwner; }
      }
      room.lastVisitAt = iso();
      await saveRoom(room);
      return s;
    });
  }
  async function deleteStamp(roomId, stampId) {
    return withLock(roomId, async () => {
      const room = await getRoom(roomId);
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
      const room = await getRoom(roomId);
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
      const room = await getRoom(roomId);
      if (!room || !room.stamps.length) return 0;
      const n = room.stamps.length;
      room.stamps = []; room.lastVisitAt = iso();
      await saveRoom(room);
      return n;
    });
  }
  async function listRooms() {
    return (await adapter.list('rooms/')).filter((k) => k.endsWith('.json')).map((k) => k.slice(6, -5));
  }
  async function deleteRoom(id) { return withLock(id, () => adapter.delete(roomKey(id))); }
  async function deleteStampsWithImage(imageId) {
    let removed = 0;
    for (const id of await listRooms()) {
      await withLock(id, async () => {
        const room = await getRoom(id);
        if (!room) return;
        const before = room.stamps.length;
        room.stamps = room.stamps.filter((s) => s.imageId !== imageId);
        if (room.stamps.length !== before) { removed += before - room.stamps.length; await saveRoom(room); }
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
        const room = await getRoom(id);
        if (!room || room.type !== 'quick') return;
        if (!room.lastVisitAt) { room.lastVisitAt = iso(); await saveRoom(room); return; }
        if (clock() - Date.parse(room.lastVisitAt) > quickTtlMs) { await adapter.delete(roomKey(id)); deleted.push(id); }
      });
    }
    return deleted;
  }

  // ---------- Bilder ----------
  const getImage = (id) => readJson(`images/${id}.json`);
  const addImage = async (img) => { await writeJson(`images/${img.id}.json`, img); return img; };
  const deleteImage = (id) => adapter.delete(`images/${id}.json`);
  const putImageFile = (id, buf) => adapter.put(`uploads/${id}.webp`, buf, 'image/webp');
  const getImageFile = (id) => adapter.get(`uploads/${id}.webp`);
  const hasImageFile = (id) => adapter.exists(`uploads/${id}.webp`);
  const deleteImageFile = (id) => adapter.delete(`uploads/${id}.webp`);

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
    adapter, clock, emptyRoom: (id) => normalize(id, null), getRoom, roomOrEmpty, createRoom, setRoomStyle, editCameras, touchRoom, addStamp, deleteStamp, peelStamps, resetStamps, listRooms, deleteRoom,
    deleteStampsWithImage, cleanupRooms, getImage, addImage, deleteImage, putImageFile, getImageFile, hasImageFile,
    deleteImageFile, migrate,
  };
}

module.exports = { createStore, newId, contentId, roomCode, ROOM_TYPES, PUBLIC_ROOM, PEEL_KEEP };
