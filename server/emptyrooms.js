// Empty rooms go away (Jens, 2 Nov 2026: "Jag vill att rummen försvinner så fort dom är tomma"): when
// the last person leaves a room, it is deleted after a short grace period (EMPTY_ROOM_GRACE_SECONDS,
// default 10 – enough to survive a page reload) – unless someone came back meanwhile.
// Never deleted: the first City ('stad') and its houses, the build city ('stad-byggen', t493u) and its houses, profile rooms (only type 'quick' rooms go), a
// demo room (the demo has its own expiry), and the rooms Jens's presets were made from
// (preset.sourceRoom). A room made FROM a preset is an ordinary room and goes like the others.
// EMPTY_ROOM_DELETE=0 turns this off.
// Cities (Jens, t479u: "om en startad stad blir tom så försvinner den"; shared/city.mjs): a city is its
// outside + its 8 houses, and it goes as ONE: only when nobody is in any of them, after cityGraceMs
// (EMPTY_CITY_GRACE_SECONDS, default 30 – walking through a door is a page load, and a slow phone must
// not lose the city on the way), then the outside and every started house are deleted.
// sweep(): every room in storage that nobody is in right now goes too, with the same exclusions – run
// at startup (after a grace period, so people reconnecting after a restart keep their room) and every
// few minutes (EMPTY_ROOM_SWEEP_MINUTES). A room made in the last freshMs (default 60 s; nobody has
// walked in yet, e.g. the start card's "save and enter" is still loading it) is left for the next sweep.
const CITY = require('../shared/city.mjs');

function createEmptyRoomReaper({ store, isOccupied, keepIds = async () => new Set(), graceMs = 10_000, cityGraceMs = Math.max(graceMs, 30_000), freshMs = 60_000, clock = () => Date.now(), log = console, timers = { setTimeout, clearTimeout } } = {}) {
  const pending = new Map(); // id (a room, or a city id for a whole city) -> timer
  // the key a room's emptiness is tracked under: its city for city rooms (null = never deleted)
  const keyOf = (id) => { if (!id) return null; const c = CITY.cityOf(id); if (!c) return id; return c === CITY.CITY_ROOM || c === CITY.BUILD_CITY ? null : c; }; // the first City and the build city (t493u) stay
  function cancel(id) { const t = pending.get(id); if (t) { timers.clearTimeout(t); pending.delete(id); } }
  const tooFresh = (room, fresh) => fresh && room && room.createdAt && clock() - Date.parse(room.createdAt) < fresh;
  async function reapCity(city, { fresh = 0, why = `stood empty for ${Math.round(cityGraceMs / 1000)} s` } = {}) {
    pending.delete(city);
    if (!CITY.isCityOutside(city) || city === CITY.CITY_ROOM || city === CITY.BUILD_CITY) return false;
    const ids = [city, ...CITY.houseIds(city)];
    if (ids.some((id) => isOccupied(id))) return false;
    const rooms = [];
    for (const id of ids) { const r = await store.peek(id).catch(() => null); if (r) rooms.push(r); }
    if (!rooms.length) return false;
    if (rooms.some((r) => tooFresh(r, fresh))) return false;
    if (ids.some((id) => isOccupied(id))) return false; // someone came in while we looked
    for (const r of rooms) await store.deleteRoom(r.id);
    log.log?.(`[city] ${city} ${why} – deleted (${rooms.map((r) => r.id).join(', ')})`);
    return true;
  }
  async function reap(id, { keep = null, fresh = 0, why = `stood empty for ${Math.round(graceMs / 1000)} s` } = {}) {
    const key = keyOf(id);
    if (!key) return false;
    if (key !== id || CITY.isCityOutside(id)) return reapCity(key, { fresh });
    pending.delete(id);
    if (isOccupied(id)) return false;
    if ((keep || await keepIds()).has(id)) return false;
    const room = await store.peek(id).catch(() => null);
    if (!room || room.type !== 'quick' || room.demo) return false;
    if (tooFresh(room, fresh)) return false;
    if (isOccupied(id)) return false; // someone came in while we looked
    await store.deleteRoom(id);
    log.log?.(`[rooms] ${id} ${why} – deleted`);
    return true;
  }
  async function sweep() {
    const keep = await keepIds(), deleted = [], seen = new Set();
    for (const id of await store.listRooms()) {
      const key = keyOf(id);
      if (!key || pending.has(key) || seen.has(key)) continue; // its own timer takes it
      seen.add(key);
      try {
        if (key !== id || CITY.isCityOutside(id)) { if (await reapCity(key, { fresh: freshMs, why: 'was empty (sweep)' })) deleted.push(key); }
        else if (await reap(id, { keep, fresh: freshMs, why: 'was empty (sweep)' })) deleted.push(id);
      } catch (e) { log.error?.('[rooms] sweep: delete failed', id, e && e.message); }
    }
    return deleted;
  }
  return {
    // The realtime layer calls this when the last person left room id.
    empty(id) {
      const key = keyOf(id);
      if (!key) return;
      cancel(key);
      const city = key !== id || CITY.isCityOutside(id);
      const t = timers.setTimeout(() => { (city ? reapCity(key) : reap(id)).catch((e) => log.error?.('[rooms] delete failed', key, e && e.message)); }, city ? cityGraceMs : graceMs);
      if (t && t.unref) t.unref();
      pending.set(key, t);
    },
    joined: (id) => { const key = keyOf(id); if (key) cancel(key); }, // someone (re)joined: keep the room / the city
    pending: () => [...pending.keys()],
    reap,
    reapCity,
    sweep,
    stop() { for (const id of [...pending.keys()]) cancel(id); },
  };
}
module.exports = { createEmptyRoomReaper };
