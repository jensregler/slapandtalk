// Many cities (Jens, t479u, 2 Nov 2026; ids and layout in shared/city.mjs).
//  - A city is started by the first person going into one: after making their pack they name it
//    (POST /api/cities { name }) and walk in. Its outside is a room 'stad-<code>' (type 'stad', the
//    name in room.name); the first City ('stad', "The City") is still there and is kept for good.
//  - Its 8 houses are rooms too, started one at a time, in order: the next free number (1, 2 … 8) –
//    POST /api/cities/:id/houses. A house exists once it is started (an empty room, no preset).
//  - A city lives as long as somebody is in it (outside or in any of its houses); when the whole city
//    is empty it goes, houses and all (server/emptyrooms.js, the same grace logic as rooms).
const CITY = require('../shared/city.mjs');
const BUS = require('../shared/citybus.mjs');

const cleanCityName = (v) => Array.from(String(v ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, 32).join('').trim();
const err = (status, message) => Object.assign(new Error(message), { status });
const FIRST_NAME = 'The City';

// occupancy(id) → number of people in room id now (realtime); maxPlayers per room.
// presets: server/citypresets.js – a new city copies the default city preset (its outside now, house n when
// house n is started; t493u). The build city (CITY.BUILD_CITY) is always there and is not on the Join list.
// housePresets: server/housepresets.js – the room preset of kept house n (rebuild, 10 Nov 2026: 1, 3, 6, 8).
function createCities(store, { occupancy = () => 0, maxPlayers = 4, clock = () => Date.now(), log = console, presets = null, housePresets = null } = {}) {
  const fromPreset = async (layer) => (presets ? presets.layerFor(layer) : null);
  const presetExtra = (l) => (l ? { stamps: l.stamps, cityPreset: l.preset, ...(l.geo ? { geo: l.geo } : {}), ...(l.style ? { style: l.style } : {}), ...(Array.isArray(l.props) ? { props: l.props } : {}) } : {});
  const always = (city) => city === CITY.CITY_ROOM || city === CITY.BUILD_CITY || BUS.isTestBusCity(city);
  const peopleIn = (city) => [city, ...CITY.houseIds(city)].reduce((n, id) => n + (occupancy(id) || 0), 0);
  async function started(city) {
    const out = []; // (rebuild: only the kept houses count – an old house 2/4/5/7 room is no longer a house)
    for (const n of CITY.KEPT_HOUSES) { const r = await store.peek(CITY.houseId(city, n)).catch(() => null); if (r) out.push(n); }
    return out;
  }
  // Stickers + unique visitors across the city's outside and its houses (room.visitors already
  // tracked by POST /api/rooms/:id/visit → noteVisitor; newly exposed on the city list).
  async function cityStats(city, houses) {
    const ids = [city, ...houses.map((n) => CITY.houseId(city, n))];
    let stickers = 0;
    const seen = new Set();
    for (const id of ids) {
      const r = await store.peek(id).catch(() => null);
      if (!r) continue;
      stickers += Array.isArray(r.stamps) ? r.stamps.length : 0;
      for (const v of Array.isArray(r.visitors) ? r.visitors : []) if (v) seen.add(v);
    }
    return { stickers, visitors: seen.size };
  }
  async function info(city) {
    if (!CITY.isCityOutside(city)) return null;
    const room = await store.peek(city).catch(() => null);
    if (!room && !always(city)) return null;
    const houses = await started(city);
    const people = {};
    for (const n of CITY.KEPT_HOUSES) people[n] = occupancy(CITY.houseId(city, n)) || 0; // every kept house (0 = nobody / not started)
    const stats = await cityStats(city, houses);
    return {
      id: city, name: city === CITY.CITY_ROOM ? FIRST_NAME : (room && room.name) || (city === CITY.BUILD_CITY ? CITY.BUILD_CITY_NAME : 'A city'), first: city === CITY.CITY_ROOM, ...(city === CITY.BUILD_CITY ? { build: true } : {}),
      createdAt: (room && room.createdAt) || null, startedBy: (room && room.startedBy) || null,
      houses, next: CITY.nextHouse(houses), people: peopleIn(city), outside: occupancy(city) || 0, inHouses: people, max: maxPlayers,
      houseMax: Math.min(CITY.HOUSE_MAX, maxPlayers), space: Math.max(0, maxPlayers - (occupancy(city) || 0)), // the subway lists cities with space > 0
      stickers: stats.stickers, visitors: stats.visitors,
      ...(room && room.hallTint ? { hallTint: room.hallTint } : {}),
      ...(room && room.testBus ? { testBus: true } : {}),
    };
  }
  // Every city there is now (they go when empty, so "there" = alive), busiest first. The first City
  // only when somebody is in it (it is always there, but it is not one you are asked to join).
  async function list() {
    const ids = (await store.listRooms()).filter((id) => CITY.isCityOutside(id) && id !== CITY.CITY_ROOM && id !== CITY.BUILD_CITY); // the build city: by its URL only
    const out = [];
    for (const id of ids) { const i = await info(id); if (i) out.push(i); }
    if (peopleIn(CITY.CITY_ROOM) > 0) { const i = await info(CITY.CITY_ROOM); if (i) out.push(i); }
    out.sort((a, b) => b.people - a.people || String(b.createdAt).localeCompare(String(a.createdAt)));
    return out;
  }
  async function create({ name, by = null } = {}) {
    const n = cleanCityName(name);
    if (!n) throw err(400, 'Give your city a name');
    for (let tries = 0; tries < 20; tries++) {
      const id = CITY.newCityId();
      if (id === CITY.BUILD_CITY) continue;
      try {
        const l = await fromPreset('outside');
        await store.createRoom({ id, type: 'stad', extra: { name: n, ...(by ? { startedBy: by } : {}), ...presetExtra(l) } });
        log.log?.(`[city] ${id} "${n}" started`);
        return info(id);
      } catch (e) { if (e.code !== 'EXISTS') throw e; }
    }
    throw err(500, 'Could not find a free city code');
  }
  // Start a kept house (rebuild, 10 Nov 2026: 1, 3, 6, 8 – walking in through its black door starts it; any
  // order). n: that house; none = the lowest kept one not started yet. Answers { n, id, city }; an
  // already started house answers the same (two at once: same house). 409 when there is none left to start.
  async function startHouse(city, { by = null, n = null } = {}) {
    const i = await info(city);
    if (!i) throw err(404, 'That city is gone');
    const want = n == null || n === '' ? i.next : Number(n);
    if (!want) throw err(409, 'All the houses are started');
    if (!CITY.isKeptHouse(want)) throw err(400, 'That house is not a room any more');
    const id = CITY.houseId(city, want);
    if (i.houses.includes(want)) return { n: want, id, city: i };
    // a new city's house: a copy of the default city preset's house n (the build city's own houses start
    // empty) + the house's room preset (its look and baked walls; shared/city.mjs HOUSE_PRESETS)
    const l = city === CITY.BUILD_CITY ? null : await fromPreset(String(want));
    const room = housePresets ? await housePresets.extraFor(want) : null;
    const extra = { house: want, city, ...(by ? { startedBy: by } : {}), ...presetExtra(l), ...(room ? { preset: room.preset } : {}),
      ...(room && room.style ? { style: room.style } : {}), ...(room && room.props && !(l && Array.isArray(l.props)) ? { props: room.props } : {}) };
    try { await store.createRoom({ id, type: 'stad', extra }); }
    catch (e) { if (e.code !== 'EXISTS') throw e; } // two at once: the other one made it – same house
    return { n: want, id, city: await info(city) };
  }
    // The build city's outside as a room (with its name), made once (startup).
  async function ensureBuildCity() {
    try { await store.createRoom({ id: CITY.BUILD_CITY, type: 'stad', extra: { name: CITY.BUILD_CITY_NAME } }); return true; }
    catch (e) { if (e.code !== 'EXISTS') throw e; return false; }
  }
  return { list, info, create, startHouse, started, peopleIn, cleanCityName, ensureBuildCity, FIRST_NAME };
}
module.exports = { createCities, cleanCityName };
